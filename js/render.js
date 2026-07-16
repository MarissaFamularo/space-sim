// render.js — Three.js renderer. Owns ALL Three.js. API frozen in ../ARCHITECTURE.md.
// Coordinate conventions (from ARCHITECTURE.md):
//   - Physics is planar 2D {x,y} in meters; WORLD origin = center of the SUN (Phase 4).
//   - Render lifts 2D -> 3D as (x, y, 0); the orbital plane is the XY plane.
//   - Craft angle is radians, 0 = pointing along +Y, increasing CCW (rotation about +Z).
//
// FLOATING ORIGIN (Phase 4): world coordinates reach 4.5e11 m (Neptune), far beyond
// float32 mesh precision. Every scene position is therefore WORLD MINUS ORIGIN, where
// ORIGIN = the craft's position in flight (so the rocket always sits at (0,0,0) with
// perfect precision) and (0,0) in build mode. The subtraction happens in float64 here,
// BEFORE numbers ever touch a THREE.Vector3.
import * as THREE from "three";
// Post-processing (vendored from three r160 examples, same no-internet rule as three itself).
import { EffectComposer } from "../vendor/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/postprocessing/OutputPass.js";
import { BODIES, PLANET_KEYS, SYSTEM, bodyStateAt, dominantBody } from "./state.js";
import { PARTS } from "./mods.js"; // merged catalog: stock + the kid's mods
import { Physics } from "./physics.js"; // pure math only (satellite propagation)

// ---- Module-private Three.js state (no other module touches three) ----
let renderer = null;
let scene = null;
let camera = null;
let canvas = null;
let composer = null;      // post chain: render -> bloom -> tone map/sRGB (OutputPass)
let _renderPass = null;   // kept so the station-interior scene can borrow the chain
// HDR philosophy: bloom threshold sits at 1.0, so ONLY things pushed past white glow —
// the Sun, engine plumes, reentry plasma, city lights. Normal surfaces never bloom.
const BLOOM = { strength: 0.55, radius: 0.4, threshold: 1.0 };
let fancyGraphics = true;  // Settings "Fast" mode skips the composer (bloom + post) per frame

let ALL_KEYS = ["sun", ...PLANET_KEYS]; // recomputed by buildWorldObjects on system swap
let bodyGroups = {};       // key -> THREE.Group (planet mesh + halo + rings), positioned per frame
let orbitRings = {};       // key -> LineLoop around its parent (positioned at parent per frame)
let mapDots = {};          // key -> { dot, label } markers for map view
let sunLight = null;       // point light riding the Sun
let launchpad = null;
let ground = null;         // build-mode ground plane
let mapMarker = null;      // bright dot marking the craft in map view
let flightView = "follow"; // "follow" | "map"
let mapFrame = 0;          // map-view scale actually used this frame (base * user zoom)
let mapBase = 0;           // auto-fit scale (grow-only)
let mapZoom = 1;           // user zoom: >1 = zoomed OUT (toward the planets), <1 = in
let followZoom = 1;        // follow-view zoom (scroll / +/-): pull back to see the planet
let followDist = 60;       // current follow camera distance (arrows scale with it)
// Drag-to-look in follow view (play-test bug #3: on Mars approach the planet sat exactly
// behind the camera with no way to turn around). Angles are in the craft's LOCAL frame:
// azimuth swings around local-up (the radial), elevation tips above/below the horizon.
const followCam = { azimuth: 0, elevation: 0.34, dragging: false, lastX: 0, lastY: 0 };
let headingArrow = null;   // cyan: where the nose points
let progradeArrow = null;  // green: where the ship is actually moving (vs the local world)
let targetArrow = null;    // gold: where to AIM
let showTarget = true, showHeading = true, showPrograde = true;

let craftGroup = null;
let craftHeight = 0;

let earthClouds = null;    // drifting cloud shell (child of Earth's group, async-loaded)
let bhDisk = null;         // black hole accretion disk (spun in updateFlight)
// Young-system dressing (the Youngcow build, 2026-07-16) — all children of body
// groups, so dispose rides along; these are just per-frame animation handles.
let protoDisc = null;      // protoplanetary dust disc around a young star (slow spin)
let youngSwarm = null;     // leftover asteroid/comet rubble band (very slow spin)
let formingDiscs = [];     // [{mesh}] fast circumplanetary discs on still-forming worlds
let cometTails = [];       // [{key, group, len}] tails aimed away from the star per frame
let lockedShells = [];     // [{key, mesh}] molten hemispheres aimed AT the star (tidal lock)

// Galaxy layer: OTHER star systems drawn on the map when zoomed way out. Positions
// come from main (relative to the ACTIVE system); clicking one travels there.
const GALAXY_ZOOM = 4.5e11;  // map frame beyond which the neighborhood fades in (past Pluto)
let galaxy = { entries: [], onPick: null };

// Engine exhaust plume: rebuilt with the craft mesh, rides the stack's bottom.
let plume = null;          // { group, core, outer, glow, light, points, pdata, r }
let _plumeLastT = 0;

let connieMesh = null;

let heatGlow = null;
let chuteCanopy = null;

let snapGhost = null;

let orbitLine = null;      // predicted orbit ellipse (THREE.Line)

let mode = "build";        // "build" | "flight"

// Floating origin (world coords, float64). All scene positions subtract this.
const ORIGIN = { x: 0, y: 0 };
// Per-body looks: color, optional stripes (gas bands), rings, atmosphere halo color.
const BODY_STYLE = {
  sun:     { color: 0xffd75e, star: true },
  mercury: { color: 0x9c8e82 },
  venus:   { color: 0xe8c98e, halo: 0xf2d9a0 },
  earth:   { color: 0x2a6cc4, halo: 0x6fb4ff },
  moon:    { color: 0x9aa0a8 },
  mars:    { color: 0xc1552f, halo: 0xd98a5e },
  phobos:  { color: 0x8a7f74 },
  deimos:  { color: 0x9d9186 },
  jupiter: { color: 0xc9a97a, stripes: ["#c9a97a", "#a8875d", "#e0c396", "#b5713f"], halo: 0xc9a97a },
  io:       { color: 0xd8c35a },  // sulfur yellow (most volcanic world in the solar system)
  europa:   { color: 0xd9e2e8 },  // cracked ice shell
  ganymede: { color: 0x9a948a },
  callisto: { color: 0x6f665c },  // the most cratered surface anywhere
  saturn:  { color: 0xd9c08a, stripes: ["#d9c08a", "#c2a86f", "#e8d5a8"], rings: true, halo: 0xd9c08a },
  titan:    { color: 0xd8a04a, halo: 0xe0b060 }, // hazy orange — air thicker than Earth's
  pluto:    { color: 0xd8c0ae }, // pale tan with the famous heart
  uranus:  { color: 0x9ad4d6, halo: 0x9ad4d6 },
  neptune: { color: 0x3f66d4, halo: 0x5f86e4 },
};

// Style lookup: generated bodies carry their own style (from stargen); Sol bodies
// use the hand-tuned BODY_STYLE table above; anything else gets a gray fallback.
function styleFor(key) {
  const b = BODIES[key];
  return (b && b.style) || BODY_STYLE[key] || { color: 0x999999 };
}

// ---- Simple mouse-drag orbit camera for build mode ----
const buildCam = {
  azimuth: Math.PI * 0.25,
  elevation: 0.25,
  distance: 12,
  target: new THREE.Vector3(0, 0, 0),
  dragging: false,
  lastX: 0,
  lastY: 0,
};

let _ptrDown = null; // pointerdown position, to tell clicks from drags

// ---- Reusable scratch objects (avoid per-frame allocation) ----
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _s3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _m4 = new THREE.Matrix4();

// Phase 5 scene objects: near-surface rocks, landing reticle, deployed rover, satellites.
let rockField = null;
let plantField = null;     // instanced plant tufts on living worlds (Hundun)
let dinoFlock = null;      // [{group, neck}] armored dino-bird grazers
const PLANT_COUNT = 64;
let meteors = [];          // ☄️ falling ring rocks: {p0, p1, t0, life, line, flash}
let interMarker = null;    // 🌌 interstellar destination beacon {sprite, label}
const ROCK_COUNT = 240;
const ROCK_ARC = 130; // meters of ground between rock slots
let reticle = null;
// High-res ground patch under the craft when low. The body spheres are coarse (48x32
// segments), so between vertices the DRAWN surface sags up to ~R/470 below the true
// radius (~560 m on Ganymede!) — physics, rocks, and the Connie all sit at the true
// radius and appeared to FLOAT (his Ganymede bug report). This cap is tessellated
// finely enough (~1-3 m sag) that the ground under you is where physics says it is.
let groundPatch = null, groundPatchKey = null;
const _groundTexCache = {};
let surfaceRover = null;
let roverTrackL = null, roverTrackR = null;
const TRACK_N = 48;
let satPool = []; // [{ group, dot, label, name }]
let stationPool = {}; // id -> { group, ring, blink, dot, label, abandoned }

// ---- Materials (created once in init) ----
let MAT = null;
function makeMaterials() {
  // Emissive floor keeps parts readable on night sides; lowered from 0.35 now that the
  // key light is brighter under ACES — parts get shading contrast back.
  const m = (color, metalness, roughness) => new THREE.MeshStandardMaterial({
    color, metalness, roughness, emissive: color, emissiveIntensity: 0.22,
  });
  MAT = {
    engine: m(0x4a5058, 0.5, 0.4),
    tank: m(0xdfe3ea, 0.1, 0.6),
    pod: m(0xff8a3d, 0.2, 0.5),
    decoupler: m(0x8a8f99, 0.3, 0.5),
    fin: m(0xc24b3a, 0.1, 0.7),
    chute: m(0xe8564a, 0.05, 0.8),
    legs: m(0x5a6068, 0.4, 0.5),
    rope: m(0x4a4238, 0.1, 0.9),
    solar: m(0x2456c8, 0.6, 0.3),
    probe: m(0xc8a03a, 0.6, 0.4),   // gold foil, like real spacecraft
    rover: m(0xd8dde8, 0.2, 0.6),
    generic: m(0xb6c0d0, 0.2, 0.6),
  };
}

function materialForPart(def) {
  if (!MAT) makeMaterials();
  switch (def.type) {
    case "engine": return MAT.engine;
    case "tank": return MAT.tank;
    case "command": return def.uncrewed ? MAT.probe : MAT.pod;
    case "decoupler": return MAT.decoupler;
    case "fin": return MAT.fin;
    case "chute": return MAT.chute;
    case "legs": return MAT.legs;
    case "solar": return MAT.solar;
    case "rover": return MAT.rover;
    default: return MAT.generic;
  }
}

// =====================================================================
// Procedural planet faces (Phase 5, "he'd like the planets to look better").
// Each world gets a 512x256 equirect canvas painted ONCE at init with a
// per-body seeded RNG, so its continents/craters are the same every boot.
// =====================================================================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function makePlanetCanvas(key) {
  const W = 512, H = 256;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const rng = mulberry32(hashStr((BODIES[key] && BODIES[key].gen ? SYSTEM.key + "/" : "") + key));
  const fill = (c) => { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); };
  // Blobby landmass / patch: a random walk of overlapping circles (wraps horizontally).
  const blob = (cx, cy, r, color, n = 26, alpha = 1) => {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    let x = cx, y = cy;
    for (let i = 0; i < n; i++) {
      const rr = r * (0.35 + rng() * 0.5);
      const xw = ((x % W) + W) % W;
      ctx.beginPath(); ctx.arc(xw, y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(xw - W, y, rr, 0, Math.PI * 2); ctx.fill(); // wrap seam
      x += (rng() - 0.5) * r * 1.7; y += (rng() - 0.5) * r * 1.1;
    }
    ctx.globalAlpha = 1;
  };
  const craters = (n, dark, light, rMax = 9) => {
    for (let i = 0; i < n; i++) {
      const x = rng() * W, y = H * (0.06 + rng() * 0.88), r = 1.5 + rng() * rng() * rMax;
      ctx.globalAlpha = 0.6; // was 0.45 — too faint once ACES lighting flattened the mids
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = light; ctx.lineWidth = Math.max(1, r * 0.28);
      ctx.beginPath(); ctx.arc(x, y, r, -2.4, -0.6); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };
  const caps = (color, frac = 0.09) => { // fuzzy polar ice
    ctx.fillStyle = color;
    for (const top of [true, false]) {
      for (let x = 0; x < W; x += 5) {
        const h = H * frac * (0.55 + rng() * 0.9);
        ctx.fillRect(x, top ? 0 : H - h, 5, h);
      }
    }
  };
  const streaks = (colors, n, len, thick, wobble = 16) => { // wind-blown horizontal wisps
    for (let i = 0; i < n; i++) {
      const y0 = H * (0.06 + rng() * 0.88), x0 = rng() * W;
      ctx.strokeStyle = colors[Math.floor(rng() * colors.length)];
      ctx.globalAlpha = 0.14 + rng() * 0.22;
      ctx.lineWidth = thick * (0.5 + rng());
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + len * 0.33, y0 + (rng() - 0.5) * wobble,
                        x0 + len * 0.66, y0 + (rng() - 0.5) * wobble,
                        x0 + len, y0 + (rng() - 0.5) * wobble * 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  const bands = (colors, wiggle = 5) => { // gas-giant latitude bands with a lazy wave
    const n = colors.length * 3;
    const bh = H / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[i % colors.length];
      const y = i * bh;
      ctx.beginPath(); ctx.moveTo(0, y + Math.sin(i * 2.1) * wiggle);
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, y + Math.sin(x / 43 + i * 2.1) * wiggle);
      ctx.lineTo(W, y + bh * 1.6); ctx.lineTo(0, y + bh * 1.6); ctx.closePath(); ctx.fill();
    }
  };

  switch (key) {
    case "earth": { // blue marble: oceans, continents, deserts, ice caps, wispy clouds
      fill("#1b5ec2");
      for (let i = 0; i < 6; i++) blob(rng() * W, H * (0.18 + rng() * 0.6), 24 + rng() * 14, "#3e8a3a", 30);
      for (let i = 0; i < 4; i++) blob(rng() * W, H * (0.3 + rng() * 0.4), 12, "#a8935a", 14, 0.8);
      caps("#eef4ff", 0.1);
      streaks(["#ffffff"], 30, 160, 8);
      break;
    }
    case "mars": {
      fill("#c1552f");
      for (let i = 0; i < 5; i++) blob(rng() * W, H * (0.25 + rng() * 0.5), 20, "#7d3018", 22, 0.7);
      craters(45, "#8a3a20", "#d98a5e", 6);
      caps("#f0e8e0", 0.07);
      break;
    }
    case "moon": {
      fill("#9aa0a8");
      for (let i = 0; i < 6; i++) blob(rng() * W, H * (0.2 + rng() * 0.6), 24, "#767c86", 22, 0.8); // maria
      craters(150, "#63696f", "#c9cfd8", 11);
      break;
    }
    case "mercury": { fill("#9c8e82"); craters(120, "#6f6358", "#c4b8aa", 8); break; }
    case "venus": { fill("#e8c98e"); streaks(["#f2dcab", "#d9b273", "#f7e7c3"], 46, 260, 12, 9); break; }
    case "io": {
      fill("#d8c35a");
      for (let i = 0; i < 4; i++) blob(rng() * W, H * (0.2 + rng() * 0.6), 18, "#e8e2b8", 16, 0.7);
      for (let i = 0; i < 22; i++) { // volcanoes: dark heart, orange splash ring
        const x = rng() * W, y = H * (0.1 + rng() * 0.8), r = 2 + rng() * 6;
        ctx.fillStyle = "#c1552f"; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#54341c";
        ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "europa": {
      fill("#dde6ec");
      for (let i = 0; i < 30; i++) { // the famous rusty cracks
        ctx.strokeStyle = "#b06a4a"; ctx.globalAlpha = 0.35 + rng() * 0.3;
        ctx.lineWidth = 0.8 + rng() * 1.6;
        const x0 = rng() * W, y0 = rng() * H;
        ctx.beginPath(); ctx.moveTo(x0, y0);
        ctx.bezierCurveTo(x0 + (rng() - 0.5) * 300, y0 + (rng() - 0.5) * 120,
                          x0 + (rng() - 0.5) * 300, y0 + (rng() - 0.5) * 120,
                          x0 + (rng() - 0.5) * 420, y0 + (rng() - 0.5) * 160);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "ganymede": {
      fill("#9a948a");
      for (let i = 0; i < 6; i++) blob(rng() * W, H * (0.15 + rng() * 0.7), 24, "#77706a", 22, 0.8);
      craters(35, "#5f5952", "#c8c0b4", 6);
      break;
    }
    case "callisto": { fill("#6f665c"); craters(150, "#524a42", "#a89c8c", 6); break; }
    case "titan": {
      fill("#d8a04a");
      streaks(["#e6b45e", "#c8903e"], 26, 220, 14, 8);
      blob(W * 0.5, H * 0.5, 30, "#a87830", 26, 0.3); // dark equatorial dunes
      break;
    }
    case "pluto": {
      fill("#d8c0ae");
      for (let i = 0; i < 3; i++) blob(rng() * W, H * (0.15 + rng() * 0.5), 22, "#8a6a52", 20, 0.7);
      craters(25, "#a3856c", "#eadbc8", 5);
      { // Tombaugh Regio: the heart ♥ (two lobes + a soft point)
        const hx = W * 0.58, hy = H * 0.55, s = 26;
        ctx.fillStyle = "#f4ece0"; ctx.globalAlpha = 0.95;
        ctx.beginPath(); ctx.arc(hx - s * 0.55, hy - s * 0.3, s * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(hx + s * 0.55, hy - s * 0.3, s * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(hx - s * 1.12, hy - s * 0.12);
        ctx.lineTo(hx, hy + s * 1.05); ctx.lineTo(hx + s * 1.12, hy - s * 0.12); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "jupiter": {
      bands(["#c9a97a", "#a8875d", "#e0c396", "#b5713f"], 5);
      streaks(["#e8d5ae", "#96703f"], 30, 300, 8, 6);
      { // the Great Red Spot
        const x = W * 0.31, y = H * 0.62;
        ctx.fillStyle = "#b34a28"; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.ellipse(x, y, 26, 13, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#e0c396"; ctx.lineWidth = 3; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.ellipse(x, y, 30, 16, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "saturn": {
      bands(["#d9c08a", "#c2a86f", "#e8d5a8"], 3);
      streaks(["#efe0b8", "#b89d68"], 20, 320, 10, 5);
      break;
    }
    case "uranus": { fill("#9ad4d6"); streaks(["#8ac8cc", "#b0e0e2"], 14, 320, 20, 6); break; }
    case "neptune": {
      fill("#3f66d4");
      streaks(["#2f52b8", "#6086e8", "#d8e4ff"], 18, 300, 12, 8);
      ctx.fillStyle = "#24418f"; ctx.globalAlpha = 0.85; // the Great Dark Spot
      ctx.beginPath(); ctx.ellipse(W * 0.62, H * 0.42, 20, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case "phobos": {
      fill("#8a7f74");
      craters(70, "#655c52", "#b3a89a", 7);
      ctx.fillStyle = "#5d554c"; ctx.globalAlpha = 0.8; // Stickney, the giant crater
      ctx.beginPath(); ctx.arc(W * 0.3, H * 0.5, 34, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case "deimos": { fill("#9d9186"); craters(50, "#756b60", "#c2b6a8", 6); break; }
    default: {
      // Generated worlds: painted from their stargen `face` descriptor with the same
      // brushes the Sol planets use. Seeded per system + body: same face every visit.
      const face = BODIES[key] && BODIES[key].face;
      if (!face) return null;
      switch (face.kind) {
        case "terra": {
          fill(face.base);
          for (let i = 0; i < 6; i++) blob(rng() * W, H * (0.15 + rng() * 0.65), 22 + rng() * 16, face.accent, 28);
          for (let i = 0; i < 4; i++) blob(rng() * W, H * (0.3 + rng() * 0.4), 12, face.accent2, 14, 0.8);
          caps("#eef4ff", 0.06 + rng() * 0.08);
          streaks(["#ffffff"], 26 + Math.floor(rng() * 14), 160, 8);
          break;
        }
        case "lava": {
          fill(face.base);
          streaks([face.accent, face.accent2], 42, 140, 3, 24); // glowing rivers
          for (let i = 0; i < 18; i++) {
            const x = rng() * W, y = H * (0.1 + rng() * 0.8), r = 2 + rng() * 7;
            ctx.fillStyle = face.accent; ctx.globalAlpha = 0.9;
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
          }
          craters(30, "#241010", face.accent, 6);
          break;
        }
        case "lavaLocked": {
          // The base sphere is the FROZEN night side (a molten shell covers the day
          // side, aimed at the star per frame): near-black rock, dull ember veins
          // leaking through where the crust cracked.
          fill(face.base);
          craters(50, "#140a08", "#3a2418", 7);
          streaks([face.accent], 10, 90, 1.5, 30);
          ctx.globalAlpha = 0.35;
          streaks([face.accent2], 6, 60, 1, 30);
          ctx.globalAlpha = 1;
          break;
        }
        case "desert": {
          fill(face.base);
          streaks([face.accent, face.accent2], 34, 240, 10, 8);
          for (let i = 0; i < 4; i++) blob(rng() * W, H * (0.25 + rng() * 0.5), 16, face.accent, 18, 0.5);
          if (rng() > 0.5) caps("#f0e8e0", 0.05);
          craters(25, face.accent, face.accent2, 5);
          break;
        }
        case "ice": {
          fill(face.base);
          for (let i = 0; i < 26; i++) { // cracked shell, europa-style
            ctx.strokeStyle = face.accent2; ctx.globalAlpha = 0.3 + rng() * 0.3;
            ctx.lineWidth = 0.8 + rng() * 1.6;
            const x0 = rng() * W, y0 = rng() * H;
            ctx.beginPath(); ctx.moveTo(x0, y0);
            ctx.bezierCurveTo(x0 + (rng() - 0.5) * 300, y0 + (rng() - 0.5) * 120,
                              x0 + (rng() - 0.5) * 300, y0 + (rng() - 0.5) * 120,
                              x0 + (rng() - 0.5) * 420, y0 + (rng() - 0.5) * 160);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          blob(rng() * W, H * (0.3 + rng() * 0.4), 20, face.accent, 20, 0.4);
          break;
        }
        case "gas":
        case "gasish": {
          const palette = face.bands || [face.base, face.accent, face.accent2];
          bands(palette, 3 + rng() * 4);
          streaks(palette, 24, 280, 9, 6);
          if (face.spot) { // every giant deserves its Great Spot
            ctx.fillStyle = palette[palette.length - 1]; ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.ellipse(W * (0.2 + rng() * 0.6), H * (0.3 + rng() * 0.4),
                        18 + rng() * 14, 9 + rng() * 7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          break;
        }
        default: { // rocky, and anything stargen invents later
          fill(face.base);
          for (let i = 0; i < 5; i++) blob(rng() * W, H * (0.2 + rng() * 0.6), 20, face.accent, 20, 0.7);
          craters(70 + Math.floor(rng() * 60), face.accent, face.accent2, 8);
          break;
        }
      }
      break;
    }
  }
  return cv;
}

// Detail pass: upscale the painted 512x256 face to 1024x512 and shade it with two
// octaves of horizontally-wrapping value noise — reads as terrain mottling / storm
// texture instead of flat poster color. Runs once per body at init (~30 ms each).
function refinePlanetCanvas(cv, key) {
  const W = 1024, H = 512;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  ctx.drawImage(cv, 0, 0, W, H);

  // Gas/cloud worlds get a whisper of mottling; rocky worlds get real texture.
  const gassy = ["jupiter", "saturn", "uranus", "neptune", "venus", "titan"].includes(key) ||
    !!(BODIES[key] && BODIES[key].face && /gas/.test(BODIES[key].face.kind));
  const amp = gassy ? 0.07 : 0.16;

  const rng = mulberry32(hashStr(key + "-detail"));
  // Two lattices of random values; x wraps so there's no seam at the date line.
  const mk = (n) => {
    const g = new Float32Array(n * (n / 2 + 2));
    for (let i = 0; i < g.length; i++) g[i] = rng() * 2 - 1;
    return g;
  };
  const lat = [
    { n: 24, g: mk(24), w: 0.62 },
    { n: 96, g: mk(96), w: 0.38 },
  ];
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (const L of lat) {
        const fx = (x / W) * L.n, fy = (y / H) * (L.n / 2);
        const x0 = fx | 0, y0 = fy | 0;
        const tx = fx - x0, ty = fy - y0;
        const x1 = (x0 + 1) % L.n;
        const row = L.n;
        const a = L.g[y0 * row + x0], bb = L.g[y0 * row + x1];
        const c = L.g[(y0 + 1) * row + x0], dd = L.g[(y0 + 1) * row + x1];
        n += L.w * ((a + (bb - a) * tx) * (1 - ty) + (c + (dd - c) * tx) * ty);
      }
      const f = 1 + n * amp;
      const i = (y * W + x) * 4;
      d[i] = Math.min(255, d[i] * f);
      d[i + 1] = Math.min(255, d[i + 1] * f);
      d[i + 2] = Math.min(255, d[i + 2] * f);
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

const _texCache = {};
function planetTexture(key) {
  if (key in _texCache) return _texCache[key];
  const cv = makePlanetCanvas(key);
  let tex = null;
  if (cv) {
    tex = new THREE.CanvasTexture(refinePlanetCanvas(cv, key));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  }
  _texCache[key] = tex;
  return tex;
}

// =====================================================================
// Render.init — scene, camera, lights, starfield, the whole solar system.
// =====================================================================
function init(canvasEl) {
  canvas = canvasEl;
  // Logarithmic depth: near=1 to far=5e12 in one camera gives a linear depth buffer
  // ~500 km buckets at map-view range — the atmosphere halo z-fought the planet limb
  // in ugly blocks the moment Earth got a real face. Log depth keeps ~meters of
  // precision at every distance, which a solar-system-in-one-scene renderer needs.
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05070f, 1);
  // Filmic tone mapping: sunlit tanks roll off gently instead of clipping to flat white.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();

  // Far plane must contain the whole zoomed-out solar system (Neptune at 4.5e11 m).
  camera = new THREE.PerspectiveCamera(55, 1, 1, 5e12);
  camera.position.set(0, 12, 12);
  camera.lookAt(0, 0, 0);

  // Sunlight comes FROM THE SUN's direction: a DirectionalLight re-aimed every frame from
  // the Sun's scene position toward the craft (a PointLight at astronomical distance won't
  // survive three's physical falloff — planets rendered black). Same brightness everywhere,
  // a kid-friendly exposure setting; plus soft fill so night sides aren't void-black.
  // (Intensities re-tuned for ACES: filmic curve eats ~1 stop in the mids.)
  sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
  sunLight.target.position.set(0, 0, 0); // the craft rides the scene origin in flight
  scene.add(sunLight);
  scene.add(sunLight.target);
  scene.add(new THREE.AmbientLight(0x404a66, 0.5));
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x202830, 0.45));

  // Starfield — screen-size points on a huge shell centered on the floating origin
  // (the craft), so the stars are always around you no matter where you fly.
  scene.add(makeStarfield());

  // Milky Way skysphere behind the point stars: a real night-sky panorama as the scene
  // background (renders at infinity, no geometry, floating-origin-proof by construction).
  new THREE.TextureLoader().load("./vendor/textures/milkyway.jpg", (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    scene.backgroundIntensity = 0.35; // dim: the painted clear-color look, but with the galaxy in it
  });

  // Post chain: scene -> bloom -> tone map + sRGB. Bloom threshold 1.0 = HDR-only.
  composer = new EffectComposer(renderer);
  _renderPass = new RenderPass(scene, camera);
  composer.addPass(_renderPass);
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    BLOOM.strength, BLOOM.radius, BLOOM.threshold));
  composer.addPass(new OutputPass());

  // Build every body: the star, the planets, the moons.
  buildWorldObjects();

  // Simple launchpad (build mode).
  launchpad = makeLaunchpad();
  launchpad.position.set(0, 0, 0);
  scene.add(launchpad);

  // The Connie — waits beside the pad in build mode, EVAs beside the craft after a landing.
  connieMesh = makeConnie();
  connieMesh.visible = false;
  scene.add(connieMesh);

  // Reentry plasma glow: additive orange shell around the craft, driven by sim.heat.
  heatGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 18),
    new THREE.MeshBasicMaterial({
      color: 0xff7a2a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  heatGlow.frustumCulled = false;
  heatGlow.visible = false;
  scene.add(heatGlow);

  // Deployed parachute canopy.
  chuteCanopy = makeChuteCanopy();
  chuteCanopy.visible = false;
  scene.add(chuteCanopy);

  // Near-surface rock field: the "how close is the ground?" depth cue. One instanced
  // mesh, repositioned deterministically around the sub-craft point every frame.
  rockField = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 1, metalness: 0,
      emissive: 0x808080, emissiveIntensity: 0.12 }),
    ROCK_COUNT
  );
  rockField.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rockField.frustumCulled = false;
  rockField.visible = false;
  scene.add(rockField);

  // Landing reticle: a ring on the ground under the ship — green means "this descent
  // speed survives", amber "close", red "you'd crater".
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.78, 1, 40),
    new THREE.MeshBasicMaterial({ color: 0x6effa0, transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false })
  );
  reticle.frustumCulled = false;
  reticle.visible = false;
  scene.add(reticle);

  // The deployed rover + its wheel tracks (visible after he stages a Rover while landed).
  surfaceRover = makeRoverMesh(1);
  surfaceRover.visible = false;
  scene.add(surfaceRover);
  const mkTrack = () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRACK_N * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x2e2620, transparent: true, opacity: 0.85 }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    return line;
  };
  roverTrackL = mkTrack();
  roverTrackR = mkTrack();

  // Build-mode ground disc.
  const groundGeo = new THREE.CircleGeometry(2000, 64);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x232c3c, roughness: 1, metalness: 0, side: THREE.DoubleSide,
  });
  ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.visible = false;
  scene.add(ground);

  // Map-view marker for the craft.
  mapMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb347 })
  );
  mapMarker.frustumCulled = false;
  mapMarker.visible = false;
  scene.add(mapMarker);

  // Direction arrows.
  const UP = new THREE.Vector3(0, 1, 0);
  progradeArrow = new THREE.ArrowHelper(UP, new THREE.Vector3(), 1, 0x6effa0, 0.35, 0.25);
  headingArrow = new THREE.ArrowHelper(UP, new THREE.Vector3(), 1, 0x6fd0ff, 0.35, 0.25);
  targetArrow = new THREE.ArrowHelper(UP, new THREE.Vector3(), 1, 0xffd24a, 0.35, 0.25);
  for (const a of [progradeArrow, headingArrow, targetArrow]) { a.frustumCulled = false; a.visible = false; scene.add(a); }

  makeMaterials();

  window.addEventListener("resize", onResize);
  onResize();

  attachBuildControls();
}

// =====================================================================
// World (re)building — the active system's meshes. Called at init, and again by
// Render.rebuildWorld() after a Starmap jump swaps the BODIES catalog in place.
// =====================================================================
function buildWorldObjects() {
  ALL_KEYS = ["sun", ...PLANET_KEYS];
  bhDisk = null; // re-created by makeBodyGroup if this system has one
  protoDisc = null; youngSwarm = null; formingDiscs = []; cometTails = []; lockedShells = [];
  // Black hole systems are lit by the accretion disk: dimmer, colder key light.
  if (sunLight) {
    const bh = !!(BODIES.sun && BODIES.sun.blackHole);
    sunLight.intensity = bh ? 1.15 : 2.0;
    sunLight.color.set(bh ? 0xd8e2ff : 0xffffff);
  }
  for (const key of ALL_KEYS) bodyGroups[key] = makeBodyGroup(key);
  for (const key of PLANET_KEYS) orbitRings[key] = makeOrbitRing(key);
  // Map dots + name labels for every body (the real spheres are sub-pixel at system zoom).
  for (const key of ALL_KEYS) {
    const style = styleFor(key);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: style.color })
    );
    dot.frustumCulled = false;
    dot.visible = false;
    scene.add(dot);
    const label = makeTextSprite(BODIES[key].name, "#" + new THREE.Color(style.color).getHexString());
    scene.add(label);
    mapDots[key] = { dot, label };
  }
}

function disposeWorldObject(obj) {
  scene.remove(obj);
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const slot of ["map", "emissiveMap", "alphaMap"]) if (m[slot]) m[slot].dispose();
      m.dispose();
    }
  });
}

function rebuildWorld() {
  if (!scene) return;
  for (const key of Object.keys(bodyGroups)) disposeWorldObject(bodyGroups[key]);
  for (const key of Object.keys(orbitRings)) disposeWorldObject(orbitRings[key]);
  for (const key of Object.keys(mapDots)) {
    disposeWorldObject(mapDots[key].dot);
    disposeWorldObject(mapDots[key].label);
  }
  bodyGroups = {}; orbitRings = {}; mapDots = {};
  // Face/ground textures are per-system ("earth" is a different world out there).
  for (const k of Object.keys(_texCache)) delete _texCache[k];
  for (const k of Object.keys(_groundTexCache)) delete _groundTexCache[k];
  if (groundPatch) {
    scene.remove(groundPatch);
    groundPatch.geometry.dispose();
    groundPatch.material.dispose();
    groundPatch = null; groundPatchKey = null;
  }
  earthClouds = null;          // died with its planet's group
  for (const id of Object.keys(stationPool)) { // stations are per-system too
    const e = stationPool[id];
    disposeWorldObject(e.group);
    disposeWorldObject(e.dot);
    disposeWorldObject(e.label);
  }
  stationPool = {};
  mapBase = 0; mapFrame = 0;   // the map auto-fit re-learns the new system's scale
  buildWorldObjects();
}

// One body: sphere (+ stripes for gas giants), optional atmosphere halo, optional rings.
// Group positioned per frame at bodyStateAt(key) - ORIGIN. Hidden in build mode.
function makeBodyGroup(key) {
  const b = BODIES[key];
  const style = styleFor(key);
  const g = new THREE.Group();

  const detail = key === "earth" ? [96, 64] : [48, 32];
  let mat;
  const tex = (style.star || b.blackHole) ? null : planetTexture(key);
  if (b.blackHole) {
    // A black hole is the one thing here that is TRULY black — no light, no texture,
    // no tone mapping. Just a hole in the starfield. Everything you "see" is the disk.
    mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  } else if (style.star) {
    // The Sun glows by itself — it IS the light source. Color pushed past white (HDR)
    // so the bloom pass flares it into something you squint at, like the real thing.
    mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(style.color).lerp(new THREE.Color(0xffffff), 0.45).multiplyScalar(2.5),
    });
  } else if (tex) {
    // Painted face; emissiveMap = same texture so the night side shows it dimly
    // (flat-color emissive would wash the detail out).
    mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.95, metalness: 0,
      emissive: 0xffffff, emissiveIntensity: 0.1, emissiveMap: tex,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: style.color, roughness: 0.95, metalness: 0,
      emissive: style.color, emissiveIntensity: key === "moon" ? 0.12 : 0.18,
    });
  }
  const geo = new THREE.SphereGeometry(b.radius, detail[0], detail[1]);
  // Lumpy bodies (a still-accreting moonlet like Pebble): displace every vertex by
  // seeded noise keyed on its DIRECTION (not its index), so the sphere's duplicated
  // seam vertices move together and the mesh stays watertight. Squash one axis a bit —
  // small young bodies haven't pulled themselves round yet (that takes ~400+ km of
  // self-gravity; real Arrokoth/67P are exactly this kind of potato).
  if (style.lumpy) {
    const pos = geo.getAttribute("position");
    const ph = (hashStr(key) % 628) / 100; // seeded phase, same potato every visit
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / b.radius, y = pos.getY(i) / b.radius, z = pos.getZ(i) / b.radius;
      // Smooth low-frequency bumps, a continuous function of DIRECTION only — the
      // sphere's duplicated seam vertices share positions, so the mesh stays watertight.
      const f = 1
        + 0.22 * Math.sin(2.3 * x + ph) * Math.sin(1.9 * y + ph * 1.7) * Math.sin(2.6 * z + ph * 0.6)
        + 0.14 * Math.sin(4.1 * x + 5.0 * y + ph) * Math.sin(3.3 * z + 2.2 * y)
        + 0.07 * Math.sin(7.2 * x + 6.1 * z + ph * 2.3);
      pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.8, pos.getZ(i) * f);
    }
    geo.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geo, mat);
  // Texture poles point along world +/-X, not +/-Y: the launchpad sits at the body's
  // +Y, and he rightly complained he was launching from the north-pole ice cap.
  // Now the pad is on the EQUATOR (and equators face the orbital plane, like reality).
  mesh.rotation.z = Math.PI / 2;
  g.add(mesh);

  // Earth gets the real thing: NASA Blue Marble day map, city lights at night, and a
  // slowly drifting cloud shell. Loads async; if the files are missing (someone zipped
  // just the js/), the painted canvas face above stays — graceful either way.
  if (key === "earth" && !b.gen) loadEarthTextures(mat, g, b);

  if (b.blackHole) {
    addBlackHoleDressing(g, b);
  } else if (style.star) {
    // Soft additive glow sprite so the Sun reads as blinding, not a yellow ball.
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const ctx = cv.getContext("2d");
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    const glowRgb = style.glow || "255,215,94"; // star-class tint (red dwarfs glow red)
    grad.addColorStop(0, "rgba(255,240,208,0.9)");
    grad.addColorStop(0.4, `rgba(${glowRgb},0.35)`);
    grad.addColorStop(1, `rgba(${glowRgb},0)`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true,
    }));
    glow.scale.setScalar(b.radius * 7);
    g.add(glow);
  }

  if (style.halo && b.atmosphere) {
    const atmoR = b.radius + b.atmosphere.height * 4; // exaggerated a touch so it reads
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(atmoR, 48, 32),
      new THREE.MeshBasicMaterial({
        color: style.halo, transparent: true, opacity: 0.12,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    g.add(halo);
  }

  if (style.rings) {
    // Saturn's rings: banded annulus with the Cassini Division, tilted so it reads in
    // both follow and map views. RingGeometry UVs are planar, so rewrite u = radial
    // fraction to stripe the texture into concentric rings.
    const inner = b.radius * 1.25, outer = b.radius * 2.3;
    const geo = new THREE.RingGeometry(inner, outer, 128, 4);
    const pos = geo.getAttribute("position"), uv = geo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      const rr = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (rr - inner) / (outer - inner), 0.5);
    }
    const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: ringTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
    ring.rotation.x = 0.45; // tilt out of the orbital plane
    g.add(ring);
  }

  // ---- Young-system dressing (the Youngcow build) ----

  // Protoplanetary dust disc around a young star: DUST, not plasma — warm tans at low
  // alpha, normal blending (the black-hole disk's past-white additive look would lie;
  // this is the stuff planets are made FROM, lit by the star inside it).
  if (style.protoDisc) {
    const { inner, outer } = style.protoDisc;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const ctx = cv.getContext("2d");
    const rng = mulberry32(hashStr(key + "-protodisc"));
    const grad = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
    grad.addColorStop(0.0, "rgba(210,180,140,0)");
    grad.addColorStop(0.15, "rgba(214,186,148,0.34)");
    grad.addColorStop(0.55, "rgba(190,158,120,0.26)");
    grad.addColorStop(0.85, "rgba(150,122,96,0.14)");
    grad.addColorStop(1.0, "rgba(120,100,84,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    // Carve the gaps real ALMA images show — lanes where baby planets are sweeping
    // up dust (HL Tauri's rings made astronomers gasp in 2014).
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 4; i++) {
      const r = 52 + rng() * 68;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 2 + rng() * 4;
      ctx.beginPath(); ctx.arc(128, 128, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    protoDisc = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 96),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      })
    );
    // Map planar ring UVs radially so the painted radial gradient lands as annuli.
    {
      const pos = protoDisc.geometry.getAttribute("position"), uv = protoDisc.geometry.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) {
        const rr = Math.hypot(pos.getX(i), pos.getY(i));
        const frac = (rr - inner) / (outer - inner);
        // sample the radial gradient along a canvas radius: u from disc center outward
        uv.setXY(i, 0.5 + frac * 0.34 + 0.15, 0.5);
      }
    }
    protoDisc.frustumCulled = false;
    g.add(protoDisc);
  }

  // Leftover rubble: a sparse band of asteroid/comet points across the young system.
  if (style.young) {
    const COUNT = 900;
    const positions = new Float32Array(COUNT * 3);
    const rng = mulberry32(hashStr(key + "-swarm"));
    // Band limits: from half the innermost planet's orbit out past the disc.
    let aMin = Infinity, aMax = 0;
    for (const k of PLANET_KEYS) {
      const bb = BODIES[k];
      if (bb.parent === "sun") { aMin = Math.min(aMin, bb.orbitRadius); aMax = Math.max(aMax, bb.orbitRadius); }
    }
    if (!isFinite(aMin)) { aMin = b.radius * 50; aMax = b.radius * 500; }
    for (let i = 0; i < COUNT; i++) {
      const rr = aMin * 0.5 + Math.pow(rng(), 0.7) * (aMax * 1.25 - aMin * 0.5);
      const th = rng() * Math.PI * 2;
      positions[i * 3 + 0] = rr * Math.cos(th);
      positions[i * 3 + 1] = rr * Math.sin(th);
      positions[i * 3 + 2] = (rng() - 0.5) * rr * 0.04; // thin, slightly puffy band
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    youngSwarm = new THREE.Points(pgeo, new THREE.PointsMaterial({
      color: 0xcabfa8, size: 2.5, sizeAttenuation: false,
      transparent: true, opacity: 0.75, depthWrite: false,
    }));
    youngSwarm.frustumCulled = false;
    g.add(youngSwarm);
  }

  // A still-forming world's own fast disc of infalling material (a real
  // circumplanetary disk — the Moon likely condensed from one after the big impact).
  if (style.formingDisc) {
    const inner = b.radius * 1.4, outer = b.radius * 3.6;
    const dgeo = new THREE.RingGeometry(inner, outer, 96, 3);
    const pos = dgeo.getAttribute("position"), uv = dgeo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      const rr = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (rr - inner) / (outer - inner), 0.5);
    }
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 8;
    const ctx = cv.getContext("2d");
    const rng = mulberry32(hashStr(key + "-formdisc"));
    for (let x = 0; x < 256; x++) {
      const hot = 1 - x / 256; // inner edge glows — infalling rock runs HOT
      const a = (0.12 + 0.5 * hot) * (0.55 + rng() * 0.45);
      ctx.fillStyle = `rgba(${Math.round(255 - 40 * (1 - hot))},${Math.round(170 + 50 * hot)},${Math.round(90 + 60 * hot)},${a})`;
      ctx.fillRect(x, 0, 1, 8);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const disc = new THREE.Mesh(dgeo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: new THREE.Color(1.15, 1.0, 0.85), // a whisper past white: the hot rim blooms
    }));
    disc.rotation.x = 0.35;
    formingDiscs.push({ mesh: disc });
    g.add(disc);
  }

  // A comet: fuzzy coma + an ion tail aimed away from the star per frame, growing as
  // it dives sunward (real tails are the sun's doing — they always point AWAY).
  if (style.comet) {
    const tailGroup = new THREE.Group();
    const len = b.radius * 60;
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(b.radius * 2.2, len, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x9fd8f0, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    // Cone points +Y with its middle at origin: shift so the TIP sits at the nucleus
    // and the skirt streams behind, then flip so "behind" is -Y of the group.
    tail.rotation.z = Math.PI;
    tail.position.y = len * 0.5;
    tailGroup.add(tail);
    const coma = new THREE.Sprite(new THREE.SpriteMaterial({
      map: plumeGlowTexture(), color: 0xcfeeff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    coma.scale.setScalar(b.radius * 8);
    tailGroup.add(coma);
    tailGroup.frustumCulled = false;
    cometTails.push({ key, group: tailGroup, len });
    g.add(tailGroup);
  }

  // Ground bases (Hundun): little surface outposts, parented to the body group at
  // fixed surface angles so they ride the planet for free. One alive, one wrecked.
  if (style.bases) {
    for (const base of style.bases) {
      const bg = new THREE.Group();
      const S = Math.max(12, b.radius * 3e-5); // structure scale (~15 m on Hundun)
      const domeMat = new THREE.MeshStandardMaterial({
        color: base.wrecked ? 0x5a524a : 0xd8dde6, roughness: 0.6, metalness: 0.2,
        emissive: base.wrecked ? 0x000000 : 0x2a3a4a, emissiveIntensity: 0.4,
      });
      if (base.wrecked) {
        // The wreck: a dome with a bite out of it, a toppled habitat, scattered
        // debris, a bent mast. Ruined, not scary — the story lives inside.
        const dome = new THREE.Mesh(new THREE.SphereGeometry(S, 20, 12, 0.7, Math.PI * 1.5, 0, Math.PI / 2), domeMat);
        bg.add(dome);
        const fallen = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.35, S * 0.35, S * 1.6, 12), domeMat);
        fallen.rotation.z = Math.PI / 2 - 0.15;
        fallen.position.set(S * 1.6, S * 0.3, S * 0.4);
        bg.add(fallen);
        for (let i = 0; i < 5; i++) {
          const junk = new THREE.Mesh(new THREE.BoxGeometry(S * 0.3, S * 0.2, S * 0.25), domeMat);
          junk.position.set((i - 2) * S * 0.7, S * 0.1, ((i * 7) % 3 - 1) * S * 0.6);
          junk.rotation.set(i, i * 2.3, 0);
          bg.add(junk);
        }
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.04, S * 0.06, S * 1.4, 6), domeMat);
        mast.rotation.z = 0.7; // bent
        mast.position.set(-S * 1.2, S * 0.5, 0);
        bg.add(mast);
      } else {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(S, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
        bg.add(dome);
        for (const sx of [-1, 1]) { // habitat tubes off the dome
          const hab = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.35, S * 0.35, S * 1.5, 12), domeMat);
          hab.rotation.z = Math.PI / 2;
          hab.position.set(sx * S * 1.4, S * 0.35, 0);
          bg.add(hab);
        }
        const green = new THREE.Mesh( // the greenhouse — it glows green, life inside
          new THREE.BoxGeometry(S * 0.9, S * 0.5, S * 0.9),
          new THREE.MeshStandardMaterial({
            color: 0x9adba8, roughness: 0.3, metalness: 0,
            emissive: 0x3adb6a, emissiveIntensity: 0.8, transparent: true, opacity: 0.85,
          }));
        green.position.set(0, S * 0.25, S * 1.5);
        bg.add(green);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.04, S * 0.06, S * 1.8, 6), domeMat);
        mast.position.set(-S * 1.2, S * 0.9, 0);
        bg.add(mast);
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(S * 0.1, 8, 6),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.4) })); // blooms
        beacon.position.set(-S * 1.2, S * 1.8, 0);
        bg.add(beacon);
      }
      // Sit on the surface at the base's fixed angle, local "up" = radial.
      const ux = Math.cos(base.phi), uy = Math.sin(base.phi);
      bg.position.set(ux * b.radius, uy * b.radius, 0);
      bg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ux, uy, 0));
      g.add(bg);
    }
  }

  // Tidal lock (Sia): a molten hemisphere shell aimed at the star every frame. The
  // star-facing side never changes — that's what tidally locked MEANS — so the day
  // side is a lava ocean and the far side (painted on the base sphere) is frozen rock.
  if (style.lockedLava) {
    const shellGeo = new THREE.SphereGeometry(b.radius * 1.004, 48, 32, 0, Math.PI);
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 128;
    const ctx = cv.getContext("2d");
    const rng = mulberry32(hashStr(key + "-lockedlava"));
    ctx.fillStyle = "#4a1c0c"; ctx.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 40; i++) { // molten rivers + hot pools
      ctx.strokeStyle = rng() > 0.5 ? "#ff5a1a" : "#ffc24a";
      ctx.globalAlpha = 0.5 + rng() * 0.5;
      ctx.lineWidth = 1 + rng() * 3;
      const x0 = rng() * 256, y0 = rng() * 128;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + (rng() - 0.5) * 120, y0 + (rng() - 0.5) * 60,
                        x0 + (rng() - 0.5) * 120, y0 + (rng() - 0.5) * 60,
                        x0 + (rng() - 0.5) * 180, y0 + (rng() - 0.5) * 90);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const shell = new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({
      map: tex, roughness: 1, metalness: 0,
      emissive: 0xff6a22, emissiveIntensity: 0.55, emissiveMap: tex,
    }));
    lockedShells.push({ key, mesh: shell });
    g.add(shell);
  }

  g.visible = false; // shown in flight
  scene.add(g);
  return g;
}

// Real Earth: swap the painted face for NASA's Blue Marble when it loads, wire the
// night-lights map into the emissive channel (cities bright enough to catch bloom),
// and hang a cloud shell that drifts with game time.
function loadEarthTextures(mat, group, b) {
  const loader = new THREE.TextureLoader();
  const srgb = (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  };
  loader.load("./vendor/textures/earth_day.jpg", (tex) => {
    mat.map = srgb(tex);
    mat.needsUpdate = true;
  });
  loader.load("./vendor/textures/earth_night.jpg", (tex) => {
    mat.emissiveMap = srgb(tex);
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveIntensity = 1.3; // city cores cross the bloom threshold and twinkle
    mat.needsUpdate = true;
  });
  loader.load("./vendor/textures/earth_clouds.jpg", (tex) => {
    earthClouds = new THREE.Mesh(
      new THREE.SphereGeometry(b.radius * 1.012, 64, 48),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, alphaMap: tex, transparent: true, depthWrite: false,
        roughness: 1, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.06,
      })
    );
    earthClouds.rotation.z = Math.PI / 2; // same equator-at-the-pad alignment as the surface
    group.add(earthClouds);
  });
}

// Saturn's ring strip: icy bands + the Cassini Division, painted once. Alpha lives in
// the canvas so the gap is genuinely see-through.
let _ringTex = null;
function ringTexture() {
  if (_ringTex) return _ringTex;
  const W = 512;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = 2;
  const ctx = cv.getContext("2d");
  const rng = mulberry32(hashStr("saturn-rings"));
  for (let x = 0; x < W; x++) {
    const f = x / W; // 0 = inner edge, 1 = outer
    // Broad structure: C ring (dim) -> B ring (bright) -> Cassini gap -> A ring.
    let a =
      f < 0.18 ? 0.25 + f * 1.2 :
      f < 0.55 ? 0.75 :
      f < 0.63 ? 0.06 :            // the Cassini Division
      f < 0.94 ? 0.55 : 0.55 * (1 - (f - 0.94) / 0.06);
    a *= 0.75 + rng() * 0.45;      // fine ringlet grain
    const shade = 200 + Math.floor(rng() * 40);
    ctx.fillStyle = `rgba(${shade},${shade - 18},${shade - 52},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
    ctx.fillRect(x, 0, 1, 2);
  }
  _ringTex = new THREE.CanvasTexture(cv);
  _ringTex.colorSpace = THREE.SRGBColorSpace;
  return _ringTex;
}

// The named neighborhood: dots + labels for systems he's visited (and Sol), shown
// in map view past GALAXY_ZOOM. Rebuilt by main after every Starmap jump.
function setGalaxy(list, onPick) {
  for (const e of galaxy.entries) {
    disposeWorldObject(e.dot);
    disposeWorldObject(e.label);
  }
  galaxy = { entries: [], onPick };
  if (!scene) return;
  for (const item of list || []) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: item.color })
    );
    dot.frustumCulled = false;
    dot.visible = false;
    scene.add(dot);
    const label = makeTextSprite(
      (item.blackHole ? "⚫ " : "⭐ ") + item.name,
      "#" + new THREE.Color(item.color).getHexString());
    scene.add(label);
    galaxy.entries.push({ dot, label, pos: item.pos, seed: item.seed });
  }
}

// Project galaxy dots to screen and pick the one within reach of a click.
function pickGalaxyStar(px, py) {
  if (!galaxy.onPick || mode !== "flight" || flightView !== "map" || mapFrame <= GALAXY_ZOOM) return false;
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  let best = null, bestD = 30; // px radius
  for (const e of galaxy.entries) {
    if (!e.dot.visible) continue;
    _v1.copy(e.dot.position).project(camera);
    // Tolerance matters: with a 5e12 far plane, visible dots project to z = 1 + 1e-13
    // float noise — a strict "> 1 means behind the camera" check rejected every star.
    if (_v1.z > 1.001) continue;
    const sx = (_v1.x * 0.5 + 0.5) * w, sy = (-_v1.y * 0.5 + 0.5) * hgt;
    const d = Math.hypot(sx - px, sy - py);
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best) { galaxy.onPick(best.seed); return true; }
  return false;
}

// Debug hook for automated tests (harmless in normal play).
if (typeof window !== "undefined") {
  window.__galaxyDebug = () => {
    const w = canvas ? canvas.clientWidth : 0, hgt = canvas ? canvas.clientHeight : 0;
    return {
      mode, flightView, mapFrame, entries: galaxy.entries.map((e) => {
        _v1.copy(e.dot.position).project(camera);
        return { seed: e.seed, visible: e.dot.visible, z: _v1.z,
                 px: (_v1.x * 0.5 + 0.5) * w, py: (-_v1.y * 0.5 + 0.5) * hgt };
      }),
      hasPick: !!galaxy.onPick,
      stations: Object.keys(stationPool).map((id) => {
        const e = stationPool[id];
        _v1.copy(e.group.position).project(camera);
        return { id, visible: e.group.visible, inScene: e.group.parent === scene,
                 pos: [e.group.position.x, e.group.position.y, e.group.position.z],
                 px: (_v1.x * 0.5 + 0.5) * (canvas ? canvas.clientWidth : 0),
                 py: (-_v1.y * 0.5 + 0.5) * (canvas ? canvas.clientHeight : 0),
                 z: _v1.z,
                 children: e.group.children.length };
      }),
    };
  };
  window.__pickGalaxy = (x, y) => pickGalaxyStar(x, y);
}

// Black hole dressing: the spinning accretion disk (drawn far larger than the hole,
// like every real black-hole picture — the M87 photo is all disk), a photon ring for
// anyone brave enough to fly close, and a cool glow. HDR colors so the bloom flares it.
function addBlackHoleDressing(g, b) {
  // Disk size: readable from the innermost planet, not physical scale.
  let aMin = Infinity;
  for (const k of PLANET_KEYS) {
    if (BODIES[k].parent === "sun") aMin = Math.min(aMin, BODIES[k].orbitRadius);
  }
  const outer = Math.max(b.radius * 300, isFinite(aMin) ? aMin * 0.035 : b.radius * 5000);

  // Painted disk: white-hot inner edge cooling to deep orange-violet, with spiral
  // streaks so the spin reads. Planar UVs on RingGeometry map it like a picture.
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const ctx = cv.getContext("2d");
  const rng = mulberry32(hashStr("bh-disk"));
  const grad = ctx.createRadialGradient(128, 128, 24, 128, 128, 128);
  grad.addColorStop(0.0, "rgba(255,250,235,0.95)");
  grad.addColorStop(0.25, "rgba(255,190,110,0.8)");
  grad.addColorStop(0.6, "rgba(220,110,60,0.45)");
  grad.addColorStop(0.85, "rgba(150,90,160,0.18)");
  grad.addColorStop(1.0, "rgba(120,80,180,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalCompositeOperation = "destination-out"; // carve dark spiral lanes
  for (let i = 0; i < 26; i++) {
    const a0 = rng() * Math.PI * 2, r0 = 26 + rng() * 100;
    ctx.strokeStyle = "rgba(0,0,0," + (0.25 + rng() * 0.3) + ")";
    ctx.lineWidth = 1.5 + rng() * 3;
    ctx.beginPath();
    for (let t = 0; t < 1.6; t += 0.1) {
      const r = r0 + t * 18, a = a0 + t * 1.5;
      const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
      t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  bhDisk = new THREE.Mesh(
    new THREE.RingGeometry(outer * 0.16, outer, 64),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
      color: new THREE.Color(1.5, 1.25, 1.0), // pushed past white -> the disk blooms
    })
  );
  bhDisk.rotation.x = 0.45; // same readable tilt as Saturn's rings
  g.add(bhDisk);

  // Photon ring: a thin white-hot circle hugging the horizon — you only see it up
  // close, which is exactly when you should be turning around.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(b.radius * 2.6, b.radius * 0.3, 8, 48),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.8, 1.7, 1.6), blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.9, depthWrite: false,
    })
  );
  g.add(ring);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: plumeGlowTexture(), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, opacity: 0.5,
  }));
  glow.scale.setScalar(outer * 2.2);
  g.add(glow);
}

// Line tracing a body's orbit, centered on its PARENT (positioned per frame).
// Circular for most bodies; bodies with `ecc` get their true ellipse (parent at the
// focus — the ring visibly swings close and far, matching where the body really flies).
function makeOrbitRing(key) {
  const b = BODIES[key];
  const SEG = 256;
  const positions = new Float32Array((SEG + 1) * 3);
  const e = b.ecc || 0, w = b.periAngle || 0;
  const s = Math.sqrt(1 - e * e), cw = Math.cos(w), sw = Math.sin(w);
  for (let i = 0; i <= SEG; i++) {
    const t = (i / SEG) * Math.PI * 2; // eccentric anomaly (circle when e=0)
    const px = b.orbitRadius * (Math.cos(t) - e), py = b.orbitRadius * s * Math.sin(t);
    positions[i * 3 + 0] = px * cw - py * sw;
    positions[i * 3 + 1] = px * sw + py * cw;
    positions[i * 3 + 2] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x555f70, transparent: true, opacity: 0.3 });
  const line = new THREE.LineLoop(geo, mat);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return line;
}

function makeStarfield() {
  const COUNT = 4000;
  const positions = new Float32Array(COUNT * 3);
  const shell = 1.5e12; // beyond Neptune's orbit; the shell rides the floating origin
  for (let i = 0; i < COUNT; i++) {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    positions[i * 3 + 0] = s * Math.cos(theta) * shell;
    positions[i * 3 + 1] = s * Math.sin(theta) * shell;
    positions[i * 3 + 2] = u * shell;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  // Fixed pixel size (no attenuation): stars stay stars from LEO to Neptune.
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: 1.6, sizeAttenuation: false, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// =====================================================================
// Engine exhaust plume — the thing every launch is really about.
// Two additive cones (white-hot core inside an orange sheath), a glow sprite at the
// nozzle, a flickering light so the flame paints the rocket, and a spark trail.
// Lives at the bottom of the craft stack in craft-local coords (exhaust = -Y), so it
// pivots with the rocket and survives staging (rebuilt with the mesh).
// =====================================================================
const _plumeGlowTexCache = {};
function plumeGlowTexture(cool = false) {
  const key = cool ? "cool" : "warm";
  if (_plumeGlowTexCache[key]) return _plumeGlowTexCache[key];
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d");
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  if (cool) { // fusion/ion exhaust: blue-white
    grad.addColorStop(0, "rgba(220,235,255,1)");
    grad.addColorStop(0.35, "rgba(130,180,255,0.55)");
    grad.addColorStop(1, "rgba(90,140,255,0)");
  } else {
    grad.addColorStop(0, "rgba(255,240,200,1)");
    grad.addColorStop(0.35, "rgba(255,180,80,0.55)");
    grad.addColorStop(1, "rgba(255,140,40,0)");
  }
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
  _plumeGlowTexCache[key] = new THREE.CanvasTexture(cv);
  return _plumeGlowTexCache[key];
}

const PLUME_PARTICLES = 150;
function makeExhaustPlume(r, len, hot = false, beam = false) {
  const group = new THREE.Group();

  // HDR colors (pushed past 1.0) so the flame catches the bloom pass. `hot` engines
  // (ion / fusion torch, exhaust >= 20 km/s) burn BLUE-white — hotter flame, bluer
  // light, same physics as a gas stove vs a candle. `beam` engines (antimatter,
  // exhaust >= 1,000 km/s) fire a violet-white LASER LANCE — annihilation makes
  // gamma rays, the brightest beam physics allows.
  const coreMat = new THREE.MeshBasicMaterial({
    color: beam ? new THREE.Color(1.8, 1.4, 2.4) : hot ? new THREE.Color(1.3, 1.6, 2.0) : new THREE.Color(1.6, 1.35, 0.95),
    transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const outerMat = new THREE.MeshBasicMaterial({
    color: beam ? new THREE.Color(1.0, 0.45, 1.9) : hot ? new THREE.Color(0.45, 0.95, 1.9) : new THREE.Color(1.5, 0.55, 0.16),
    transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  // Cones: wide at the nozzle (top, y=0), tapering down the exhaust (-Y).
  const core = new THREE.Mesh(new THREE.ConeGeometry(r * 0.42, len, 16, 1, true), coreMat);
  core.rotation.x = Math.PI; // apex points down
  core.position.y = -len / 2;
  group.add(core);
  const outer = new THREE.Mesh(new THREE.ConeGeometry(r * 0.8, len * 1.55, 16, 1, true), outerMat);
  outer.rotation.x = Math.PI;
  outer.position.y = -len * 0.775;
  group.add(outer);

  // The laser lance: one ultra-long skinny cone past both flame cones. Purely a
  // LOOK — the thrust the physics applies is the PartDef's, beam or no beam.
  let beamMesh = null;
  if (beam) {
    const beamLen = len * 6;
    beamMesh = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.16, beamLen, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.2, 1.7, 2.6), transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    beamMesh.rotation.x = Math.PI;
    beamMesh.position.y = -beamLen / 2;
    group.add(beamMesh);
  }

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: plumeGlowTexture(hot || beam), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false,
  }));
  glow.scale.setScalar(r * 4.5);
  group.add(glow);

  // The flame lights the rocket: warm (or fusion-blue / annihilation-violet) light.
  const light = new THREE.PointLight(beam ? 0xc09aff : hot ? 0x86b8ff : 0xffa040, 600, 400, 2);
  light.position.set(0, -1.2, 0);
  group.add(light);

  // Spark/smoke trail: recycled points streaming down -Y. Per-particle fade is done
  // through vertex COLOR (additive blending: dark == invisible), no custom shader.
  const pdata = [];
  const posArr = new Float32Array(PLUME_PARTICLES * 3);
  const colArr = new Float32Array(PLUME_PARTICLES * 3);
  for (let i = 0; i < PLUME_PARTICLES; i++) {
    pdata.push({ life: Math.random(), max: 0.5 + Math.random() * 0.5,
                 vx: 0, vy: 0, vz: 0 });
    posArr[i * 3 + 1] = -Math.random() * len;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: Math.max(0.25, r * 0.38), vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  points.frustumCulled = false;
  group.add(points);

  group.visible = false;
  return { group, core, outer, glow, light, points, pdata, r, len, hot, beam, beamMesh };
}

// Called every flight frame. Throttle drives length/brightness; a per-frame flicker
// keeps it alive; vacuum fattens the sheath (no air pressure squeezing the exhaust —
// real, and he'll notice).
function updatePlume(sim, dom) {
  if (!plume) return;
  const c = sim.craft || {};
  const burning = mode === "flight" && sim.status !== "crashed" &&
    (c.throttle || 0) > 0 && (c.thrust || 0) > 0 && (c.fuelRemaining || 0) > 0;
  plume.group.visible = burning;
  if (!burning) { plume.light.intensity = 0; return; }

  const t = sim.time || 0;
  let dt = t - _plumeLastT;
  _plumeLastT = t;
  if (!(dt > 0) || dt > 0.08) dt = 0.016; // first frame / time-warp jump: just keep animating

  const throttle = Math.max(0.15, Math.min(1, c.throttle || 0));
  const flick = 0.9 + 0.1 * Math.sin(t * 47.0) * Math.sin(t * 31.7) + (Math.random() - 0.5) * 0.12;
  const inVacuum = !(dom && dom.body.atmosphere && (sim.altitude || 0) < dom.body.atmosphere.height);
  const widen = inVacuum ? 1.8 : 1.0; // exhaust balloons where there's no air to hold it

  plume.core.scale.set(flick, throttle * flick, flick);
  plume.outer.scale.set(widen * flick, throttle * (0.9 + 0.2 * flick), widen * flick);
  plume.outer.material.opacity = (inVacuum ? 0.22 : 0.32) * (0.8 + 0.4 * Math.random());
  plume.glow.scale.setScalar(plume.r * (4.5 + throttle * 2.5) * flick);
  plume.light.intensity = 500 * throttle * (0.85 + 0.3 * Math.random());
  if (plume.beamMesh) { // the lance barely flickers — lasers don't gutter like flames
    plume.beamMesh.scale.set(0.9 + 0.15 * flick, 0.7 + 0.35 * throttle, 0.9 + 0.15 * flick);
    plume.beamMesh.material.opacity = 0.6 + 0.25 * throttle;
  }

  // Trail particles: spawn at the nozzle, stream down, cool from white-orange to ember.
  const pos = plume.points.geometry.getAttribute("position");
  const col = plume.points.geometry.getAttribute("color");
  const speed = plume.len * (2.2 + 1.5 * throttle);
  for (let i = 0; i < PLUME_PARTICLES; i++) {
    const p = plume.pdata[i];
    p.life += dt;
    if (p.life >= p.max) { // respawn at the nozzle with a fresh kick
      p.life = 0;
      p.max = (0.45 + Math.random() * 0.55) * (inVacuum ? 0.7 : 1);
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * plume.r * 0.35;
      pos.setXYZ(i, Math.cos(a) * rr, -Math.random() * 0.5, Math.sin(a) * rr);
      const spread = (inVacuum ? 0.85 : 0.35) * plume.len;
      p.vx = Math.cos(a) * spread * Math.random();
      p.vz = Math.sin(a) * spread * Math.random();
      p.vy = -speed * (0.75 + Math.random() * 0.5);
    }
    pos.setXYZ(i, pos.getX(i) + p.vx * dt, pos.getY(i) + p.vy * dt, pos.getZ(i) + p.vz * dt);
    const f = 1 - p.life / p.max; // 1 fresh -> 0 dead
    if (plume.beam) col.setXYZ(i, 1.6 * f, 0.7 * f * f, 2.2 * f);          // violet sparks
    else if (plume.hot) col.setXYZ(i, 0.8 * f * f, 1.2 * f * f, 2.0 * f);  // blue sparks
    else col.setXYZ(i, 1.7 * f, (1.25 * f) * f, 0.55 * f * f * f);         // embers
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

// A Connie: coiled green snake, head up, inside a clear bubble helmet (his design).
function makeConnie() {
  const g = new THREE.Group();
  const snakeMat = new THREE.MeshStandardMaterial({
    color: 0x4fae54, metalness: 0.1, roughness: 0.55, emissive: 0x1d5a24, emissiveIntensity: 0.5,
  });
  const bellyMat = new THREE.MeshStandardMaterial({
    color: 0xd8e8b0, metalness: 0.05, roughness: 0.7, emissive: 0x55663a, emissiveIntensity: 0.4,
  });
  const suitMat = new THREE.MeshStandardMaterial({
    color: 0xf2f4f8, metalness: 0.15, roughness: 0.5, emissive: 0x666a72, emissiveIntensity: 0.35,
  });

  const coils = [
    { R: 0.42, tube: 0.155, y: 0.15 },
    { R: 0.30, tube: 0.135, y: 0.42 },
    { R: 0.19, tube: 0.115, y: 0.64 },
  ];
  for (const c of coils) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(c.R, c.tube, 12, 28), snakeMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = c.y;
    g.add(ring);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.13, 0.55, 14), snakeMat);
  neck.position.set(0, 0.95, 0.05);
  neck.rotation.x = 0.18;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 18, 14), snakeMat);
  head.position.set(0, 1.26, 0.12);
  g.add(head);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.10, 14, 10), bellyMat);
  snout.position.set(0, 1.22, 0.24);
  g.add(snout);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x101418 });
  const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const side of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), eyeWhiteMat);
    white.position.set(side * 0.085, 1.32, 0.23);
    g.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), eyeMat);
    pupil.position.set(side * 0.085, 1.32, 0.27);
    g.add(pupil);
  }

  const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.14), new THREE.MeshBasicMaterial({ color: 0xd03a4a }));
  tongue.position.set(0, 1.18, 0.34);
  g.add(tongue);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.30, 24, 18),
    new THREE.MeshBasicMaterial({
      color: 0xbfe4ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  helmet.position.set(0, 1.27, 0.10);
  g.add(helmet);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.05, 10, 24), suitMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 1.01, 0.08);
  g.add(collar);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.12), suitMat);
  pack.position.set(0, 0.86, -0.18);
  g.add(pack);

  return g;
}

// A little six-wheeled rover (Curiosity-ish): body, wheels, camera mast, solar deck.
// Used both as the buildable part and as the deployed explorer on the surface.
function makeRoverMesh(s = 1) {
  if (!MAT) makeMaterials();
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 0.35 * s, 0.6 * s), MAT.rover);
  body.position.y = 0.42 * s;
  g.add(body);
  const wheelGeo = new THREE.CylinderGeometry(0.16 * s, 0.16 * s, 0.1 * s, 12);
  for (const wx of [-0.36, 0, 0.36]) {
    for (const wz of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, MAT.engine);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx * s, 0.16 * s, wz * 0.38 * s);
      g.add(w);
    }
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.5 * s, 8), MAT.decoupler);
  mast.position.set(0.3 * s, 0.85 * s, 0);
  g.add(mast);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.1 * s, 0.1 * s), MAT.rover);
  head.position.set(0.3 * s, 1.12 * s, 0);
  g.add(head);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.03 * s, 0.5 * s), MAT.solar);
  deck.position.set(-0.15 * s, 0.62 * s, 0);
  g.add(deck);
  return g;
}

// Deployed parachute canopy.
function makeChuteCanopy() {
  const g = new THREE.Group();
  const RIG = 7;
  const RAD = 4.5;
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0xe8564a, metalness: 0, roughness: 0.9, side: THREE.DoubleSide,
    emissive: 0x772620, emissiveIntensity: 0.45,
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(RAD, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.y = RIG;
  g.add(dome);
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xf2f4f8, metalness: 0, roughness: 0.9, side: THREE.DoubleSide,
    emissive: 0x6a6f78, emissiveIntensity: 0.4,
  });
  const stripe = new THREE.Mesh(
    new THREE.SphereGeometry(RAD * 1.01, 24, 3, 0, Math.PI * 2, Math.PI * 0.30, Math.PI * 0.12), stripeMat);
  stripe.position.y = RIG;
  g.add(stripe);
  const linePts = [];
  const LINES = 8;
  for (let i = 0; i < LINES; i++) {
    const a = (i / LINES) * Math.PI * 2;
    linePts.push(0, 0, 0, Math.cos(a) * RAD * 0.92, RIG, Math.sin(a) * RAD * 0.92);
  }
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePts), 3));
  const lines = new THREE.LineSegments(lgeo,
    new THREE.LineBasicMaterial({ color: 0xd8dde8, transparent: true, opacity: 0.8 }));
  g.add(lines);
  return g;
}

// Place the Connie standing on a surface: feet at scene `basePos`, body up along `up`.
function placeConnie(basePos, up) {
  if (!connieMesh) return;
  connieMesh.position.copy(basePos);
  connieMesh.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), _v2.copy(up).normalize());
  connieMesh.visible = true;
}

function makeLaunchpad() {
  const g = new THREE.Group();
  const mk = (color, rough = 0.85, metal = 0.05) => new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, emissive: color, emissiveIntensity: 0.12,
  });
  const concrete = mk(0x3a3f48, 0.95);
  const white = mk(0xe8ebf0, 0.7);
  const gray = mk(0x8a919c, 0.8);
  const dark = mk(0x2a2e36, 0.9);

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 0.5, 24), concrete);
  pad.position.y = 0.25;
  g.add(pad);

  // His space center. The VAB — every real spaceport has one giant white box.
  const vab = new THREE.Mesh(new THREE.BoxGeometry(6, 7, 5), white);
  vab.position.set(11, 3.5, -7);
  g.add(vab);
  const vabDoor = new THREE.Mesh(new THREE.BoxGeometry(3.2, 5.6, 0.15), gray);
  vabDoor.position.set(11, 2.8, -4.42);
  g.add(vabDoor);
  const vabStripe = new THREE.Mesh(new THREE.BoxGeometry(6.04, 0.9, 5.04), mk(0x2456c8, 0.7));
  vabStripe.position.set(11, 6.1, -7);
  g.add(vabStripe);

  // Crawler-way from the VAB to the pad.
  const way = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 2.6), dark);
  way.position.set(6, 0.04, -3.4);
  way.rotation.y = 0.35;
  g.add(way);

  // Mission control bunker + tracking dish.
  const bunker = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 2.4), gray);
  bunker.position.set(7.5, 0.65, 5.5);
  g.add(bunker);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), white);
  dish.rotation.x = -Math.PI / 3;
  dish.position.set(8.4, 1.9, 5.2);
  g.add(dish);

  // Water tower (for the launch sound-suppression deluge — real pads dump a lake).
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), white);
  tank.position.set(-6, 3.1, 4);
  g.add(tank);
  for (const a of [0.3, 1.9, 3.5, 5.1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.8, 6), gray);
    leg.position.set(-6 + Math.cos(a) * 0.55, 1.4, 4 + Math.sin(a) * 0.55);
    g.add(leg);
  }

  // Propellant farm: two horizontal tanks behind a berm.
  for (const dz of [-1, 1]) {
    const fuel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.6, 14), white);
    fuel.rotation.z = Math.PI / 2;
    fuel.position.set(-5.5, 0.5, -3.5 + dz * 1.4);
    g.add(fuel);
  }

  // The flag.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 6), gray);
  pole.position.set(-3, 1.2, 2.6);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.02),
    mk(0xd23a3a, 0.6));
  flag.position.set(-2.58, 2.1, 2.6);
  g.add(flag);

  return g;
}

function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 2 || h < 2) return; // minimized/zero-size window: aspect 0 NaNs the projection
  renderer.setSize(w, h); // updateStyle=true (see HANDOFF gotchas)
  if (composer) composer.setSize(w, h);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  if (interior) {
    interior.cam.aspect = w / Math.max(1, h);
    interior.cam.updateProjectionMatrix();
  }
}

// =====================================================================
// Build-mode drag-orbit camera controls
// =====================================================================
function attachBuildControls() {
  if (!canvas) return;
  canvas.addEventListener("pointerdown", (e) => {
    _ptrDown = { x: e.clientX, y: e.clientY };
    if (mode === "build") {
      buildCam.dragging = true;
      buildCam.lastX = e.clientX;
      buildCam.lastY = e.clientY;
    } else if (mode === "flight" && flightView === "follow") {
      followCam.dragging = true;
      followCam.lastX = e.clientX;
      followCam.lastY = e.clientY;
    }
  });
  window.addEventListener("pointerup", (e) => {
    // A click (not a drag) on a galaxy star travels there.
    if (_ptrDown && Math.hypot(e.clientX - _ptrDown.x, e.clientY - _ptrDown.y) < 6) {
      pickGalaxyStar(e.clientX, e.clientY);
    }
    _ptrDown = null;
    buildCam.dragging = false; followCam.dragging = false;
  });
  window.addEventListener("pointermove", (e) => {
    const lim = Math.PI / 2 - 0.05;
    if (buildCam.dragging && mode === "build") {
      const dx = e.clientX - buildCam.lastX;
      const dy = e.clientY - buildCam.lastY;
      buildCam.lastX = e.clientX;
      buildCam.lastY = e.clientY;
      buildCam.azimuth -= dx * 0.01;
      buildCam.elevation += dy * 0.01;
      buildCam.elevation = Math.max(-lim, Math.min(lim, buildCam.elevation));
    } else if (followCam.dragging && mode === "flight" && flightView === "follow") {
      const dx = e.clientX - followCam.lastX;
      const dy = e.clientY - followCam.lastY;
      followCam.lastX = e.clientX;
      followCam.lastY = e.clientY;
      followCam.azimuth -= dx * 0.01;
      followCam.elevation += dy * 0.01;
      followCam.elevation = Math.max(-lim, Math.min(lim, followCam.elevation));
    }
  });
  canvas.addEventListener("wheel", (e) => {
    if (mode === "build") {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.001);
      buildCam.distance = Math.max(3, Math.min(200, buildCam.distance * factor));
    } else if (mode === "flight") {
      // Scroll zooms BOTH flight views (zoomMap routes): map frame, or follow camera.
      e.preventDefault();
      zoomMap(Math.exp(e.deltaY * 0.0015));
    }
  }, { passive: false });
}

// =====================================================================
// Render.buildCraftMesh — (re)build rocket Group, bottom->top, centered.
// =====================================================================
function buildCraftMesh(craft) {
  if (craftGroup) {
    scene.remove(craftGroup);
    disposeGroup(craftGroup);
    craftGroup = null;
  }
  plume = null; // its geometries died with the group; rebuilt below
  craftHeight = 0;

  if (!craft || !craft.parts || craft.parts.length === 0) {
    return;
  }

  const defs = resolveDefs(craft);
  if (defs.length === 0) return;

  // Sky-crane bridle: a crane above a rover (directly, or across the release-latch
  // decoupler) leaves an air gap spanned by ropes — the rover HANGS, like the real
  // MSL landing ("no rope" bug report).
  const ROPE_GAP = 2.2;
  const gapBefore = (i) => i > 0 && defs[i - 1].type === "rover" &&
    (defs[i].shape === "crane" ||
     (defs[i].type === "decoupler" && defs[i + 1] && defs[i + 1].shape === "crane"));

  let total = 0;
  for (let i = 0; i < defs.length; i++) {
    total += (defs[i].height || 0);
    if (gapBefore(i)) total += ROPE_GAP;
  }
  craftHeight = total;

  const group = new THREE.Group();
  if (!MAT) makeMaterials();

  let cursor = -total / 2;
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const h = def.height || 1;
    const r = def.radius || 0.5;
    if (gapBefore(i)) {
      const roverTop = cursor;
      cursor += ROPE_GAP;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.5;
        const from = _v1.set(0, roverTop - 0.15, 0);
        const to = _v2.set(Math.cos(a) * r * 0.7, cursor + 0.1, Math.sin(a) * r * 0.7);
        const dir = _v3.copy(to).sub(from);
        const len = dir.length();
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), MAT.rope);
        rope.position.copy(from).add(to).multiplyScalar(0.5);
        rope.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), dir.normalize());
        group.add(rope);
      }
    }
    const cy = cursor + h / 2;
    const partObj = makePartObject(def, h, r);
    partObj.position.y = cy;
    group.add(partObj);
    cursor += h;
  }

  // Exhaust plume at the stack's bottom (defs[0] — the stage that's actually firing).
  // Sized by the bottom-most engine's bell; harmless if this stage has none (it only
  // shows when sim thrust + throttle + fuel say the engines are truly burning).
  const eng = defs.find((d) => d.type === "engine") || defs[0];
  plume = makeExhaustPlume(eng.radius || 0.5, Math.max(3.5, total * 0.85),
    (eng.exhaustVelocity || 0) >= 20000,
    (eng.exhaustVelocity || 0) >= 1000000);
  plume.group.position.y = -total / 2;
  group.add(plume.group);

  craftGroup = group;
  craftSpinners.length = 0; // centrifuge wheels etc — spun each frame in update()
  group.traverse((o) => { if (o.userData && o.userData.spin) craftSpinners.push(o); });
  scene.add(group);

  if (snapGhost) snapGhost.visible = false;
}
const craftSpinners = [];

function resolveDefs(craft) {
  const out = [];
  for (const inst of craft.parts) {
    const def = PARTS.find((p) => p.id === inst.partId);
    if (def) out.push(def);
  }
  return out;
}

// =====================================================================
// Part looks (the "fancier rocket parts" pass): painted-canvas details —
// panel seams, rivets, hazard stripes, gold foil, solar cells — on lathe
// profiles with domed shoulders, real engine bells, and greebles. All
// procedural (no model files, boots offline), all cached and shared.
// Every part still fits exactly inside its def's height × radius box, so
// stacking, physics, and the kid's modded parts are untouched.
// =====================================================================
const _partMats = {};
function partMat(key, painter, opts = {}) {
  if (_partMats[key]) return _partMats[key];
  const cv = document.createElement("canvas");
  cv.width = opts.w || 256; cv.height = opts.h || 256;
  painter(cv.getContext("2d"), cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  const m = new THREE.MeshStandardMaterial({
    map: tex, metalness: opts.metalness ?? 0.25, roughness: opts.roughness ?? 0.55,
    emissive: 0xffffff, emissiveIntensity: 0.16, emissiveMap: tex, // night-side readability
    ...(opts.side ? { side: opts.side } : {}),
  });
  _partMats[key] = m;
  return m;
}
const brushNoise = (ctx, W, H, alpha = 0.05) => { // vertical brushed-metal streaks
  const rng = mulberry32(hashStr("brush"));
  for (let i = 0; i < 260; i++) {
    ctx.globalAlpha = alpha * rng();
    ctx.fillStyle = rng() > 0.5 ? "#ffffff" : "#5a6270";
    const x = rng() * W;
    ctx.fillRect(x, rng() * H, 1 + rng() * 2, 12 + rng() * 60);
  }
  ctx.globalAlpha = 1;
};
const rivetRow = (ctx, W, y, n = 26, c = "#7d8492") => {
  ctx.fillStyle = c;
  for (let i = 0; i < n; i++) {
    ctx.beginPath(); ctx.arc((i + 0.5) * (W / n), y, 1.6, 0, Math.PI * 2); ctx.fill();
  }
};

function tankMat() {
  return partMat("tank", (ctx, W, H) => {
    ctx.fillStyle = "#e6e9ef"; ctx.fillRect(0, 0, W, H);
    brushNoise(ctx, W, H);
    // Panel seams + rivets; the texture repeats vertically every ~0.9 m of tank.
    ctx.fillStyle = "#c3c9d4"; ctx.fillRect(0, H * 0.48, W, 3);
    rivetRow(ctx, W, H * 0.48 - 5); rivetRow(ctx, W, H * 0.48 + 9);
    ctx.fillStyle = "#d7dbe4"; ctx.fillRect(0, H * 0.02, W, 2); // faint minor seam
  }, { metalness: 0.35, roughness: 0.45 });
}
function podMat() {
  return partMat("pod", (ctx, W, H) => {
    // v=0 bottom: charcoal heat shield, then the classic orange, white crown stripe.
    ctx.fillStyle = "#3a3d44"; ctx.fillRect(0, 0, W, H);              // shield (v 0–0.12)
    ctx.fillStyle = "#f08a3d"; ctx.fillRect(0, H * 0.12, W, H);       // orange body
    ctx.fillStyle = "#d96f28"; ctx.fillRect(0, H * 0.12, W, 4);       // shield trim line
    ctx.fillStyle = "#f4f6f9"; ctx.fillRect(0, H * 0.74, W, H * 0.1); // white stripe
    brushNoise(ctx, W, H, 0.04);
    rivetRow(ctx, W, H * 0.4, 20, "#c86a2a"); rivetRow(ctx, W, H * 0.7, 20, "#c86a2a");
  }, { metalness: 0.2, roughness: 0.5 });
}
function bellMat() {
  return partMat("bell", (ctx, W, H) => {
    // v=0 = rim of the bell, v=1 = throat: darken toward the throat, faint ribs.
    const g = ctx.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, "#23262c"); g.addColorStop(0.55, "#454b56"); g.addColorStop(1, "#6a7280");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.25; ctx.fillStyle = "#141619";
    for (let x = 0; x < W; x += 8) ctx.fillRect(x, 0, 2, H); // cooling ribs
    ctx.globalAlpha = 1;
  }, { metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
}
function hazardMat() {
  return partMat("hazard", (ctx, W, H) => {
    ctx.fillStyle = "#8a8f99"; ctx.fillRect(0, 0, W, H);
    brushNoise(ctx, W, H, 0.06);
    // Yellow/black warning band across the middle — "this thing SEPARATES".
    const y0 = H * 0.3, bh = H * 0.4;
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0, W, bh); ctx.clip();
    ctx.fillStyle = "#e8c02a"; ctx.fillRect(0, y0, W, bh);
    ctx.fillStyle = "#22242a";
    for (let x = -H; x < W + H; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, y0 + bh); ctx.lineTo(x + 14, y0 + bh); ctx.lineTo(x + 14 + bh, y0); ctx.lineTo(x + bh, y0);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }, { metalness: 0.3, roughness: 0.55 });
}
function foilMat() {
  return partMat("foil", (ctx, W, H) => {
    // Crinkled gold MLI foil, like every real deep-space probe.
    ctx.fillStyle = "#c99a35"; ctx.fillRect(0, 0, W, H);
    const rng = mulberry32(hashStr("foil"));
    for (let i = 0; i < 900; i++) {
      ctx.globalAlpha = 0.16 + rng() * 0.2;
      ctx.fillStyle = ["#e8c05a", "#a87c25", "#f2d47e", "#8f6a20"][Math.floor(rng() * 4)];
      const x = rng() * W, y = rng() * H;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 26, y + (rng() - 0.5) * 12);
      ctx.lineTo(x + (rng() - 0.5) * 26, y + (rng() - 0.5) * 12);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // metalness kept modest: at 0.75 the sun's specular glint crossed the bloom
    // threshold and the whole probe burned like a lamp.
  }, { metalness: 0.45, roughness: 0.6 });
}
function solarMat() {
  return partMat("solar", (ctx, W, H) => {
    ctx.fillStyle = "#172c66"; ctx.fillRect(0, 0, W, H);
    const rng = mulberry32(hashStr("cells"));
    const cw = W / 8, ch = H / 5;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) { // individual cells, subtly varied
      ctx.fillStyle = rng() > 0.5 ? "#1b357a" : "#142857";
      ctx.fillRect(i * cw + 2, j * ch + 2, cw - 4, ch - 4);
      ctx.fillStyle = "rgba(120,160,255,0.25)"; // cell sheen corner
      ctx.fillRect(i * cw + 2, j * ch + 2, cw * 0.35, 2);
    }
  }, { metalness: 0.5, roughness: 0.45 });
}
function chuteMat() {
  return partMat("chute", (ctx, W, H) => {
    const gores = 12; // alternating red/white canopy wedges
    for (let i = 0; i < gores; i++) {
      ctx.fillStyle = i % 2 ? "#f4f6f8" : "#e8564a";
      ctx.fillRect(Math.floor(i * W / gores), 0, Math.ceil(W / gores), H);
    }
    ctx.globalAlpha = 0.12; ctx.fillStyle = "#803028";
    for (let i = 0; i <= gores; i++) ctx.fillRect(Math.floor(i * W / gores), 0, 2, H); // seams
    ctx.globalAlpha = 1;
  }, { metalness: 0.05, roughness: 0.8 });
}

// Lathe helper: profile points as [radius, yFraction 0..1] over the part's height h,
// centered on the part origin like every primitive the stacker places.
function lathe(points, h, mat, segs = 28) {
  const pts = points.map(([pr, fy]) => new THREE.Vector2(Math.max(0.001, pr), fy * h - h / 2));
  return new THREE.Mesh(new THREE.LatheGeometry(pts, segs), mat);
}

function makePartObject(def, h, r) {
  const mat = materialForPart(def);
  switch (def.shape) {
    case "cone": {
      // The Acorn: heat-shield lip, curved orange capsule, rounded crown — plus
      // portholes the Connie can look out of and a docking ring on the nose.
      const grp = new THREE.Group();
      grp.add(lathe([
        [0.001, 0], [r * 0.84, 0], [r, 0.1], [r * 0.96, 0.3], [r * 0.78, 0.56],
        [r * 0.52, 0.78], [r * 0.3, 0.92], [r * 0.14, 0.985], [0.001, 1],
      ], h, podMat()));
      const winMat = MAT ? MAT.engine : mat;
      for (const a of [-0.55, 0, 0.55]) { // portholes, front-facing like the real capsules
        const win = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.12, 12), winMat);
        win.position.set(Math.sin(a) * r * 0.85, h * 0.05, Math.cos(a) * r * 0.85);
        win.rotation.x = Math.PI / 2; win.rotation.z = -a; // face outward along its angle
        grp.add(win);
      }
      const dock = new THREE.Mesh(new THREE.TorusGeometry(r * 0.15, 0.03, 8, 18), winMat);
      dock.rotation.x = Math.PI / 2;
      dock.position.y = h * 0.485;
      grp.add(dock);
      return grp;
    }
    case "cylinder": {
      if (def.type === "decoupler") {
        // Warning-striped separation ring with explosive bolts around it.
        const grp = new THREE.Group();
        grp.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28), hazardMat()));
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.1, h * 0.5, 0.06), MAT ? MAT.legs : mat);
          bolt.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          bolt.rotation.y = -a + Math.PI / 2;
          grp.add(bolt);
        }
        return grp;
      }
      // Tanks (and modded cylinders): domed shoulders within the same height box,
      // riveted panel skin, seam rings, and a fuel line running up the side.
      const grp = new THREE.Group();
      const skin = tankMat();
      const body = lathe([
        [0.001, 0], [r * 0.8, 0], [r, 0.045], [r, 0.955], [r * 0.8, 1], [0.001, 1],
      ], h, skin);
      skin.map.repeat.set(2, 1); // skin wraps twice around (shared texture, set once is fine)
      grp.add(body);
      for (const fy of h > 2.4 ? [0.3, 0.62] : [0.48]) { // raised seam rings
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.012, 0.018, 6, 28), MAT ? MAT.decoupler : mat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = fy * h - h / 2;
        grp.add(ring);
      }
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, h * 0.86, 8), MAT ? MAT.legs : mat);
      pipe.position.set(r * 0.99, 0, 0.12);
      grp.add(pipe);
      for (const fy of [-0.3, 0.3]) { // pipe clamps
        const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.09), MAT ? MAT.decoupler : mat);
        clamp.position.set(r * 0.99, fy * h, 0.12);
        grp.add(clamp);
      }
      return grp;
    }
    case "nozzle": {
      // A real engine: powerhead with plumbing up top, gimbal ring, then a properly
      // curved bell. Vacuum engines (high exhaust velocity) get the long wide bell
      // with the skinny throat — the shape IS the spec, tell him why.
      const grp = new THREE.Group();
      const vac = (def.exhaustVelocity || 0) >= 4000;
      const throat = r * (vac ? 0.22 : 0.34);
      const bellTop = vac ? 0.78 : 0.66; // fraction of h the bell occupies
      const prof = [];
      const N = 10;
      for (let i = 0; i <= N; i++) {
        const t = i / N; // 0 = throat (top), 1 = rim (bottom)
        prof.push([throat + (r * 0.98 - throat) * Math.pow(t, vac ? 2.0 : 1.6), (1 - t) * bellTop]);
      }
      const bell = lathe(prof.reverse(), h, bellMat());
      grp.add(bell);
      const headMat = MAT ? MAT.engine : mat;
      const head = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.55, r * 0.45, h * (1 - bellTop) + 0.02, 20), headMat);
      head.position.y = h / 2 - (h * (1 - bellTop)) / 2;
      grp.add(head);
      const gimbal = new THREE.Mesh(new THREE.TorusGeometry(throat + 0.06, 0.035, 8, 20), headMat);
      gimbal.rotation.x = Math.PI / 2;
      gimbal.position.y = h * bellTop - h / 2;
      grp.add(gimbal);
      for (let i = 0; i < 4; i++) { // turbopump plumbing
        const a = (i / 4) * Math.PI * 2 + 0.3;
        const pipe = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, h * (1 - bellTop) * 0.95, 6), MAT ? MAT.legs : mat);
        pipe.position.set(Math.cos(a) * r * 0.5, h / 2 - (h * (1 - bellTop)) / 2, Math.sin(a) * r * 0.5);
        grp.add(pipe);
      }
      return grp;
    }
    case "dock": {
      // Apollo-style port: base drum, latch ring, three guide petals angled inward.
      const grp = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, h * 0.55, 20), tankMat());
      drum.position.y = -h * 0.22;
      grp.add(drum);
      const ringM = new THREE.Mesh(new THREE.TorusGeometry(r * 0.55, r * 0.14, 10, 22), hazardMat());
      ringM.rotation.x = Math.PI / 2;
      ringM.position.y = h * 0.18;
      grp.add(ringM);
      for (let i = 0; i < 3; i++) { // guide petals
        const a = (i / 3) * Math.PI * 2;
        const petal = new THREE.Mesh(new THREE.BoxGeometry(r * 0.34, h * 0.42, 0.04), MAT ? MAT.legs : mat);
        petal.position.set(Math.cos(a) * r * 0.5, h * 0.3, Math.sin(a) * r * 0.5);
        petal.lookAt(0, h * 1.4, 0); // lean inward, funnel-shaped
        grp.add(petal);
      }
      return grp;
    }
    case "torch": {
      // Far-future fusion torch: a compact reactor over an OPEN magnetic nozzle —
      // three field coils where a chemical engine would have a bell, and a fusion
      // throat that glows past white (the bloom pass flares it) even at idle.
      const grp = new THREE.Group();
      const headMat = MAT ? MAT.engine : mat;
      const reactor = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.55, h * 0.4, 20), headMat);
      reactor.position.y = h * 0.3;
      grp.add(reactor);
      const throat = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.24, 14, 10),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.2, 1.8) })
      );
      throat.position.y = h * 0.05;
      grp.add(throat);
      for (let i = 0; i < 3; i++) { // magnetic coils, flaring downward
        const fy = h * (0.05 - 0.16 * (i + 1));
        const cr = r * (0.4 + 0.2 * (i + 1));
        const coil = new THREE.Mesh(new THREE.TorusGeometry(cr, r * 0.07, 8, 24), foilMat());
        coil.rotation.x = Math.PI / 2;
        coil.position.y = fy;
        grp.add(coil);
      }
      for (let i = 0; i < 3; i++) { // struts holding the coils
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, h * 0.62, 6), headMat);
        strut.position.set(Math.cos(a) * r * 0.6, -h * 0.18, Math.sin(a) * r * 0.6);
        strut.rotation.z = Math.cos(a) * -0.35;
        strut.rotation.x = Math.sin(a) * 0.35;
        grp.add(strut);
      }
      return grp;
    }
    case "beam": {
      // Annihilation drive: an armored antimatter trap (magnetic bottle — the fuel
      // must NEVER touch the walls) over a gamma-ray focusing dish. Violet accents;
      // the "nozzle" is just a ring — the beam itself is the engine bell.
      const grp = new THREE.Group();
      const headMat = MAT ? MAT.engine : mat;
      const trap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, h * 0.42, 20), headMat);
      trap.position.y = h * 0.26;
      grp.add(trap);
      const bottleMat = new THREE.MeshStandardMaterial({
        color: 0x8a6ae0, metalness: 0.4, roughness: 0.35,
        emissive: 0x6a3ae0, emissiveIntensity: 0.5,
      });
      for (let i = 0; i < 2; i++) { // containment hoops around the trap
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(r * 0.66, r * 0.06, 8, 24), bottleMat);
        hoop.rotation.x = Math.PI / 2;
        hoop.position.y = h * (0.14 + 0.24 * i);
        grp.add(hoop);
      }
      const core = new THREE.Mesh( // the annihilation point, glowing past white
        new THREE.SphereGeometry(r * 0.2, 14, 10),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 2.2) })
      );
      core.position.y = -h * 0.05;
      grp.add(core);
      const dish = new THREE.Mesh( // gamma dish, open end down
        new THREE.CylinderGeometry(r * 0.9, r * 0.34, h * 0.34, 22, 1, true),
        headMat
      );
      dish.position.y = -h * 0.28;
      grp.add(dish);
      const exitRing = new THREE.Mesh(new THREE.TorusGeometry(r * 0.88, r * 0.07, 8, 26), bottleMat);
      exitRing.rotation.x = Math.PI / 2;
      exitRing.position.y = -h * 0.46;
      grp.add(exitRing);
      return grp;
    }
    case "chute": {
      // Packed canopy in red/white gores, strapped down over its band.
      const grp = new THREE.Group();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.75, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), chuteMat());
      dome.scale.y = h / (r * 0.75);
      dome.position.y = -h / 2;
      grp.add(dome);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.76, r * 0.76, h * 0.22, 20), tankMat());
      band.position.y = -h / 2 + h * 0.11;
      grp.add(band);
      for (let i = 0; i < 3; i++) { // hold-down straps over the pack
        const strap = new THREE.Mesh(new THREE.TorusGeometry(r * 0.75, 0.02, 6, 20, Math.PI), MAT ? MAT.legs : mat);
        strap.rotation.y = (i / 3) * Math.PI; // 0..π arc is already the over-the-top half
        strap.scale.y = h / (r * 0.75);
        strap.position.y = -h / 2;
        grp.add(strap);
      }
      return grp;
    }
    case "fin": {
      // Swept delta fins (extruded + beveled) bolted to a structural sleeve. The
      // sleeve matters: a fin "part" occupies a slot in the one-column stack, and
      // without a body section the fuselage looked broken in half at that slot.
      const grp = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), tankMat());
      grp.add(sleeve);
      const s = new THREE.Shape();
      s.moveTo(0, h * 0.5);
      s.lineTo(r * 1.15, h * 0.05);
      s.lineTo(r * 1.15, -h * 0.32);
      s.lineTo(0, -h * 0.5);
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, {
        depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.03, bevelSegments: 2,
      });
      geo.translate(0, 0, -0.025);
      for (const side of [1, -1]) {
        const fin = new THREE.Mesh(geo, mat);
        fin.position.x = side * r * 0.9; // root buried in the sleeve wall
        if (side < 0) fin.rotation.y = Math.PI;
        grp.add(fin);
      }
      return grp;
    }
    case "legs": {
      // Four splayed struts with footpads, reaching down past the part below (they
      // visually wrap the engine, like a real lander).
      const grp = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, h * 2.6, 8), mat);
        strut.position.set(Math.cos(a) * r * 0.95, -h * 0.55, Math.sin(a) * r * 0.95);
        strut.quaternion.setFromAxisAngle(tangent, 0.5);
        grp.add(strut);
        // Shock-absorber sleeve over the upper strut — legs read as suspension now.
        const sleeve = new THREE.Mesh(
          new THREE.CylinderGeometry(0.085, 0.085, h * 1.0, 8), MAT ? MAT.decoupler : mat);
        sleeve.position.set(Math.cos(a) * r * 0.72, -h * 0.12, Math.sin(a) * r * 0.72);
        sleeve.quaternion.setFromAxisAngle(tangent, 0.5);
        grp.add(sleeve);
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.08, 10), mat);
        pad.position.set(Math.cos(a) * r * 1.5, -h * 1.55, Math.sin(a) * r * 1.5);
        grp.add(pad);
      }
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.85, h * 0.5, 16), tankMat());
      grp.add(collar);
      return grp;
    }
    case "probe": {
      // Gold-foil box (real MLI insulation look), paraboloid high-gain dish, whip
      // antenna with a tip ball, and little RCS thruster blocks on the corners.
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(r * 1.3, h * 0.85, r * 1.3), foilMat());
      grp.add(body);
      const dishMat = MAT ? MAT.tank : mat;
      const dish = new THREE.Mesh(new THREE.LatheGeometry(
        Array.from({ length: 7 }, (_, i) => {
          const t = i / 6;
          return new THREE.Vector2(Math.max(0.001, r * 0.5 * t), r * 0.28 * t * t); // paraboloid
        }), 20), dishMat);
      dish.rotation.x = Math.PI / 2; // aim the dish outward (+z), concave side out
      dish.position.set(0, h * 0.1, r * 0.9);
      grp.add(dish);
      const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, r * 0.4, 6), dishMat);
      feed.rotation.x = Math.PI / 2;
      feed.position.set(0, h * 0.1, r * 0.72);
      grp.add(feed);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h * 1.5, 6), MAT ? MAT.decoupler : mat);
      ant.position.y = h * 0.8;
      grp.add(ant);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), MAT ? MAT.decoupler : mat);
      tip.position.y = h * 1.55;
      grp.add(tip);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { // corner RCS blocks
        const rcs = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), MAT ? MAT.engine : mat);
        rcs.position.set(sx * r * 0.65, h * 0.32, sz * r * 0.65);
        grp.add(rcs);
      }
      return grp;
    }
    case "panels": {
      // Real cell-grid texture on the wings, silver frame border, tiny hinge arms.
      const grp = new THREE.Group();
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, h * 0.8, 12), MAT ? MAT.decoupler : mat);
      grp.add(hub);
      for (const s of [-1, 1]) {
        const cx = s * (r * 0.5 + r * 1.65);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(r * 3.28, h * 0.86, 0.045), MAT ? MAT.legs : mat);
        frame.position.x = cx;
        grp.add(frame);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(r * 3.2, h * 0.8, 0.06), solarMat());
        wing.position.x = cx;
        grp.add(wing);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, r * 0.55, 6), MAT ? MAT.legs : mat);
        arm.rotation.z = Math.PI / 2;
        arm.position.x = s * r * 0.72;
        grp.add(arm);
      }
      return grp;
    }
    case "crane": {
      // A flat frame ringed by four outward-splayed thrusters — cargo hangs BELOW.
      // It packs its own fuel: the silver spheres ARE the tanks (the real MSL
      // descent stage carried spherical hydrazine tanks too).
      const grp = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, h * 0.5, 16), foilMat());
      grp.add(frame);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
        const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.17, h * 0.7, 10), bellMat());
        noz.position.set(Math.cos(a) * r * 1.0, -h * 0.1, Math.sin(a) * r * 1.0);
        noz.quaternion.setFromAxisAngle(tangent, -0.45); // canted out so the plume misses the cargo
        grp.add(noz);
        const tank = new THREE.Mesh(new THREE.SphereGeometry(h * 0.32, 12, 10), MAT ? MAT.tank : mat);
        const ta = a + Math.PI / 4;
        tank.position.set(Math.cos(ta) * r * 0.62, h * 0.12, Math.sin(ta) * r * 0.62);
        grp.add(tank);
      }
      return grp;
    }
    case "rover": {
      const grp = makeRoverMesh(0.9);
      grp.scale.setScalar(Math.max(0.6, r));
      return grp;
    }
    case "shield": {
      // Ablative heat shield: a wide blunt dish under the stack — copper-brown top
      // ring, charred dark face on the business end (blunt end first, like Apollo).
      const grp = new THREE.Group();
      const body = lathe([
        [0.001, 0], [r * 0.9, 0.02], [r, 0.28], [r * 0.98, 0.62], [r * 0.82, 0.95], [0.001, 1],
      ], h, new THREE.MeshStandardMaterial({
        color: 0x9a5b32, metalness: 0.25, roughness: 0.55,
        emissive: 0x9a5b32, emissiveIntensity: 0.22,
      }));
      body.material._isClone = true;
      grp.add(body);
      const char = new THREE.Mesh(new THREE.CircleGeometry(r * 0.88, 24),
        new THREE.MeshStandardMaterial({ color: 0x2b2320, roughness: 0.95,
          emissive: 0x2b2320, emissiveIntensity: 0.15 }));
      char.material._isClone = true;
      char.rotation.x = Math.PI / 2; // faces DOWN — the side that takes the fire
      char.position.y = -h * 0.49;
      grp.add(char);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.94, 0.045, 8, 28),
        MAT ? MAT.decoupler : mat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = h * 0.12;
      grp.add(rim);
      return grp;
    }
    case "wing": {
      // Delta Wings for the Hangar: a structural sleeve (same trick as the fins —
      // the fuselage must read continuous) with big swept lifting surfaces.
      const grp = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.65, r * 0.65, h, 24), tankMat());
      grp.add(sleeve);
      const s = new THREE.Shape();
      s.moveTo(0, h * 0.55);
      s.lineTo(r * 2.6, -h * 0.1);
      s.lineTo(r * 2.75, -h * 0.42);
      s.lineTo(0, -h * 0.55);
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, {
        depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.04, bevelSegments: 2,
      });
      geo.translate(0, 0, -0.035);
      const wingMat = MAT ? MAT.tank : mat;
      for (const side of [1, -1]) {
        const wing = new THREE.Mesh(geo, wingMat);
        wing.position.x = side * r * 0.5;
        if (side < 0) wing.rotation.y = Math.PI;
        grp.add(wing);
        // red leading-edge stripe so they read as wings, not slabs
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(r * 2.0, 0.06, 0.09), MAT ? MAT.fin : mat);
        stripe.position.set(side * (r * 0.5 + r * 1.15), h * 0.28, 0);
        stripe.rotation.z = side * -0.24;
        grp.add(stripe);
      }
      return grp;
    }
    case "hub": {
      // Station Hub: a fat core with four radial docking stubs and a blinking beacon —
      // the part that makes a build count as a SPACE STATION.
      const grp = new THREE.Group();
      grp.add(lathe([
        [0.001, 0], [r * 0.7, 0.04], [r, 0.22], [r, 0.78], [r * 0.7, 0.96], [0.001, 1],
      ], h, tankMat()));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const stub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.34, r * 0.7, 12),
          MAT ? MAT.decoupler : mat);
        stub.position.set(Math.cos(a) * r * 1.05, 0, Math.sin(a) * r * 1.05);
        stub.rotation.z = Math.PI / 2;
        stub.rotation.y = -a;
        grp.add(stub);
        const ringM = new THREE.Mesh(new THREE.TorusGeometry(r * 0.26, 0.035, 8, 18),
          MAT ? MAT.engine : mat);
        ringM.position.set(Math.cos(a) * r * 1.42, 0, Math.sin(a) * r * 1.42);
        ringM.rotation.y = -a + Math.PI / 2;
        grp.add(ringM);
      }
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.4, 0.3) })); // HDR: blooms
      beacon.position.y = h * 0.58;
      grp.add(beacon);
      return grp;
    }
    case "ring": {
      // Centrifuge Ring: a spinning habitat wheel on spokes — the ONLY honest way to
      // make gravity in space (the physics lesson is in the interior + Navigator).
      const grp = new THREE.Group();
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, h, 16), foilMat());
      grp.add(axle);
      const wheel = new THREE.Group();
      const torus = new THREE.Mesh(new THREE.TorusGeometry(r, h * 0.22, 12, 40), tankMat());
      torus.rotation.x = Math.PI / 2;
      wheel.add(torus);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, r, 8),
          MAT ? MAT.decoupler : mat);
        spoke.position.set(Math.cos(a) * r * 0.5, 0, Math.sin(a) * r * 0.5);
        spoke.rotation.z = Math.PI / 2;
        spoke.rotation.y = -a;
        wheel.add(spoke);
      }
      // Lit habitat windows around the rim — someone could LIVE out there.
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05),
          new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
        win.position.set(Math.cos(a) * r, h * 0.1, Math.sin(a) * r);
        wheel.add(win);
      }
      wheel.userData.spin = 0.5; // rad/s — buildCraftMesh tags it; updateFlight spins it
      grp.add(wheel);
      return grp;
    }
    default: {
      const geo = new THREE.CylinderGeometry(r, r, h, 24);
      return new THREE.Mesh(geo, mat);
    }
  }
}

// =====================================================================
// Render.setMode — build vs flight camera regimes.
// =====================================================================
function setMode(m) {
  mode = m === "flight" ? "flight" : "build";
  const showWorld = mode === "flight";
  for (const key of ALL_KEYS) if (bodyGroups[key]) bodyGroups[key].visible = showWorld;
  for (const key of PLANET_KEYS) if (orbitRings[key]) orbitRings[key].visible = showWorld;
  if (sunLight) sunLight.visible = true; // lights both modes (build uses it as a key light)

  if (mode === "build") {
    // Build happens near the scene origin against the stars (world hidden): the framing is
    // robust regardless of where Earth is. ORIGIN resets to (0,0).
    ORIGIN.x = 0; ORIGIN.y = 0;
    if (sunLight) sunLight.position.set(3e3, 2e3, 4e3); // pleasant studio angle
    if (launchpad) { launchpad.visible = true; launchpad.position.set(0, 0, 0); }
    if (ground) ground.visible = true;
    if (connieMesh) {
      connieMesh.position.set(2.7, 0, 1.4);
      connieMesh.quaternion.identity();
      connieMesh.rotation.y = -0.5;
      connieMesh.visible = true;
    }
    const baseY = 0.2;
    if (craftGroup) {
      craftGroup.position.set(0, baseY + craftHeight / 2, 0);
      craftGroup.rotation.set(0, 0, 0);
      buildCam.target.set(0, baseY + craftHeight / 2, 0);
    } else {
      buildCam.target.set(0, baseY + 1, 0);
    }
    buildCam.distance = Math.max(8, craftHeight * 2.2 + 6);
    if (orbitLine) orbitLine.visible = false;
    if (heatGlow) heatGlow.visible = false;
    if (chuteCanopy) chuteCanopy.visible = false;
    if (mapMarker) mapMarker.visible = false;
    hideMapDots();
    if (progradeArrow) progradeArrow.visible = false;
    if (headingArrow) headingArrow.visible = false;
    if (targetArrow) targetArrow.visible = false;
    if (rockField) rockField.visible = false;
    if (reticle) reticle.visible = false;
    if (groundPatch) groundPatch.visible = false;
    if (surfaceRover) surfaceRover.visible = false;
    if (roverTrackL) roverTrackL.visible = false;
    if (roverTrackR) roverTrackR.visible = false;
    for (const e of satPool) {
      if (e) { e.group.visible = false; e.dot.visible = false; if (e.label) e.label.visible = false; }
    }
  } else {
    if (launchpad) launchpad.visible = false;
    if (ground) ground.visible = false;
    if (connieMesh) connieMesh.visible = false;
    if (orbitLine) orbitLine.visible = true;
    flightView = "follow";
    followZoom = 1; // every launch starts framed on the rocket...
    followCam.azimuth = 0; followCam.elevation = 0.34; // ...from the standard angle
  }
}

function hideMapDots() {
  for (const key of ALL_KEYS) {
    if (mapDots[key]) { mapDots[key].dot.visible = false; mapDots[key].label.visible = false; }
  }
  for (const e of galaxy.entries) { e.dot.visible = false; e.label.visible = false; }
  for (const id of Object.keys(stationPool)) {
    stationPool[id].dot.visible = false;
    stationPool[id].label.visible = false;
  }
}

// =====================================================================
// Render.update — per-frame placement, camera, orbit ellipse, draw.
// =====================================================================
function update(sim) {
  if (!renderer || !scene || !camera) return;
  if (interior) { updateInterior(); return; } // aboard a station: the room is the world

  if (mode === "build" && flightView !== "map") {
    updateBuildCamera();
  } else if (sim) {
    // Flight — or the pad-side map (build mode + map view): same world placement,
    // ORIGIN = the craft sitting on the pad, marker shows "you are here".
    updateFlight(sim);
  }

  if (mode === "flight" && sim && sim.orbit) {
    updateOrbitLine(sim);
  } else {
    if (orbitLine) orbitLine.visible = false;
    if (apMarker) apMarker.visible = false;
    if (peMarker) peMarker.visible = false;
  }

  updateBurnMarker(sim);

  if (eva) updateEva(); // the Connie outside, moving through the frozen scene

  if (composer && fancyGraphics) composer.render();
  else renderer.render(scene, camera);
}

function updateBuildCamera() {
  const ce = Math.cos(buildCam.elevation);
  const se = Math.sin(buildCam.elevation);
  const ca = Math.cos(buildCam.azimuth);
  const sa = Math.sin(buildCam.azimuth);
  const d = buildCam.distance;
  camera.position.set(
    buildCam.target.x + d * ce * sa,
    buildCam.target.y + d * se,
    buildCam.target.z + d * ce * ca
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(buildCam.target);
}

function updateFlight(sim) {
  if (!sim || !sim.craft) return;
  const t = sim.time || 0;

  // FLOATING ORIGIN: the craft. Everything else is drawn relative to it (float64 math
  // here, so a 10 m rocket at Neptune renders as crisply as on the pad).
  ORIGIN.x = sim.craft.pos.x;
  ORIGIN.y = sim.craft.pos.y;
  const angle = sim.craft.angle || 0;

  // The local world: who owns the craft right now (arrows, cameras, EVA all use it).
  const dom = dominantBody(sim.craft.pos, t);

  // Place every body and its orbit ring.
  const states = {};
  for (const key of ALL_KEYS) {
    const st = bodyStateAt(key, t);
    states[key] = st;
    bodyGroups[key].position.set(st.pos.x - ORIGIN.x, st.pos.y - ORIGIN.y, 0);
  }
  for (const key of PLANET_KEYS) {
    const parent = states[BODIES[key].parent];
    orbitRings[key].position.set(parent.pos.x - ORIGIN.x, parent.pos.y - ORIGIN.y, 0);
  }
  sunLight.position.copy(bodyGroups.sun.position);

  // The physics point is the craft's BASE (that's what touches the ground), so the
  // mesh — which is built centered — shifts half a length up its own axis. Centered
  // rendering buried the rocket to its waist once the ground patch made the surface
  // accurate (and made it hover before that).
  const oxC = -Math.sin(angle) * craftHeight * 0.5;
  const oyC = Math.cos(angle) * craftHeight * 0.5;
  if (craftGroup) {
    craftGroup.position.set(oxC, oyC, 0);
    craftGroup.rotation.set(0, 0, angle);
  }

  // Reentry glow.
  if (heatGlow) {
    const heat = sim.heat || 0;
    if (heat > 0.06 && sim.status !== "landed" && sim.status !== "crashed") {
      const size = Math.max(2.5, craftHeight * (0.8 + heat * 1.2));
      heatGlow.position.set(oxC, oyC, 0); // wrap the visible rocket, not its base point
      heatGlow.scale.set(size, size * 1.35, size);
      heatGlow.rotation.z = angle;
      heatGlow.material.opacity = Math.min(0.85, heat * 1.1);
      // Pushed past white at high heat so the bloom pass flares the plasma sheath.
      heatGlow.material.color.setHSL(0.07, 1.0, 0.5 + heat * 0.35).multiplyScalar(1 + heat * 0.9);
      heatGlow.visible = true;
    } else {
      heatGlow.visible = false;
    }
  }

  // Open parachute: canopy opposite the AIR-relative velocity.
  if (chuteCanopy) {
    if (sim.chuteOpen && sim.status !== "landed" && sim.status !== "crashed") {
      const rvx = sim.craft.vel.x - dom.vel.x, rvy = sim.craft.vel.y - dom.vel.y;
      const vm = Math.hypot(rvx, rvy);
      let ux, uy;
      if (vm > 3) { ux = -rvx / vm; uy = -rvy / vm; }
      else { const rm = Math.hypot(dom.rel.x, dom.rel.y) || 1; ux = dom.rel.x / rm; uy = dom.rel.y / rm; }
      chuteCanopy.position.set(oxC + ux * craftHeight * 0.5, oyC + uy * craftHeight * 0.5, 0);
      chuteCanopy.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), _v2.set(ux, uy, 0).normalize());
      chuteCanopy.visible = true;
    } else {
      chuteCanopy.visible = false;
    }
  }

  // Engine flame + spark trail (rides the craft group, so it's already placed).
  updatePlume(sim, dom);

  // Earth's clouds drift with game time (time-warp spins the weather — a feature).
  if (earthClouds) earthClouds.rotation.y = (t * 0.0012) % (Math.PI * 2);

  // The accretion disk spins (fast near a black hole — truthfully, much faster).
  if (bhDisk) bhDisk.rotation.set(0.45, 0, (t * 0.05) % (Math.PI * 2));

  // Young-system dressing animation (all cheap: rotations + one quaternion each).
  if (protoDisc) protoDisc.rotation.z = (t * 0.002) % (Math.PI * 2);   // dust creeps
  if (youngSwarm) youngSwarm.rotation.z = (t * 0.0012) % (Math.PI * 2);
  for (const fd of formingDiscs) {
    fd.mesh.rotation.set(0.35, 0, (t * 0.4) % (Math.PI * 2));          // infall is FAST
  }
  for (const ct of cometTails) {
    const st = states[ct.key];
    if (!st) continue;
    const sun = states.sun || { pos: { x: 0, y: 0 } };
    const dx = st.pos.x - sun.pos.x, dy = st.pos.y - sun.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    // Point the tail AWAY from the star, and let it grow as the comet dives sunward
    // (at periapsis it's ~3x the apoapsis tail — the sun boils the ice off).
    ct.group.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), _v2.set(dx / d, dy / d, 0));
    const a = BODIES[ct.key].orbitRadius || d;
    const grow = Math.min(3.5, Math.max(0.6, a / d));
    ct.group.scale.set(Math.sqrt(grow), grow, Math.sqrt(grow));
  }
  for (const ls of lockedShells) {
    const st = states[ls.key];
    if (!st) continue;
    const sun = states.sun || { pos: { x: 0, y: 0 } };
    const dx = sun.pos.x - st.pos.x, dy = sun.pos.y - st.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    // The molten hemisphere faces the star — always the same face: tidal lock.
    ls.mesh.quaternion.setFromUnitVectors(_v1.set(0, 0, 1), _v2.set(dx / d, dy / d, 0));
  }
  updateMeteors(t); // ☄️ falling ring rocks (Hundun)

  // 🌌 Interstellar destination beacon: the target star, drawn as a nav marker along
  // its true BEARING (the real point sits ~1000x past the far plane — direction is
  // what a pilot needs, and the panel carries the honest distance).
  if (sim.interstellar) {
    if (!interMarker) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: plumeGlowTexture(), color: 0xfff2c0, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      sprite.frustumCulled = false;
      scene.add(sprite);
      const label = makeTextSprite("→ destination", "#ffe9a8");
      scene.add(label);
      interMarker = { sprite, label, name: "" };
    }
    const it = sim.interstellar;
    if (interMarker.name !== it.name) { // re-bake label text on course change
      interMarker.name = it.name;
      scene.remove(interMarker.label);
      interMarker.label = makeTextSprite("→ " + it.name, "#ffe9a8");
      scene.add(interMarker.label);
    }
    const dx = it.dest.x - sim.craft.pos.x, dy = it.dest.y - sim.craft.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const R = 2e11; // beacon range: far beyond every ship, safely inside the far plane
    interMarker.sprite.position.set((dx / d) * R, (dy / d) * R, 0);
    interMarker.sprite.scale.setScalar(R * 0.02);
    interMarker.label.position.set((dx / d) * R * 0.92, (dy / d) * R * 0.92 + R * 0.03, 0);
    interMarker.label.scale.set(R * 0.06, R * 0.022, 1); // text-sprite aspect (like map labels)
    interMarker.sprite.visible = true;
    interMarker.label.visible = true;
  } else if (interMarker) {
    interMarker.sprite.visible = false;
    interMarker.label.visible = false;
  }
  // Centrifuge wheels turn with game time — steady spin, that's the gravity trick.
  for (const sp of craftSpinners) sp.rotation.y = (t * sp.userData.spin) % (Math.PI * 2);

  // Phase 5: surface detail + deployed rover + satellites + stations.
  updateSurfaceExtras(sim, dom);
  updateRover(sim, states);
  updateSatellites(sim);
  updateStations(sim);

  // Landed EVA: the Connie stands beside the ship on WHATEVER world she landed on
  // (only when someone's actually aboard — probes carry no Connie).
  if (connieMesh) {
    if (sim.status === "landed" && sim.landed && sim.crew && states[sim.landed.body]) {
      const bs = states[sim.landed.body];
      const rl = Math.hypot(sim.craft.pos.x - bs.pos.x, sim.craft.pos.y - bs.pos.y) || 1;
      const ux = (sim.craft.pos.x - bs.pos.x) / rl, uy = (sim.craft.pos.y - bs.pos.y) / rl;
      placeConnie(
        _v1.set(-uy * 3.0, ux * 3.0, 0).clone(),
        new THREE.Vector3(ux, uy, 0)
      );
    } else {
      connieMesh.visible = false;
    }
  }

  if (flightView === "map") {
    updateMapCamera(sim, dom, states);
    updateDirArrows(sim, dom, angle, true);
    return;
  }
  if (mapMarker) mapMarker.visible = false;
  hideMapDots();
  updateDirArrows(sim, dom, angle, false);

  // Follow-cam: orbits the CRAFT, which is always dead-center (bug #1: it may never leave
  // the frame). Drag to look around — swing the camera to put Mars in the background on
  // approach (bug #3) — and scroll to zoom. Angles live in the craft's local frame so
  // "up on screen" stays "away from the planet" no matter where you are:
  //   up = radial from the dominant body; azimuth swings around it; elevation tips over it.
  const rl = Math.hypot(dom.rel.x, dom.rel.y);
  const radial = _v2.set(dom.rel.x, dom.rel.y, 0);
  if (rl > 0.5) radial.multiplyScalar(1 / rl); else radial.set(0, 1, 0);

  const camDist = Math.max(20, craftHeight * 4 + 30) * followZoom;
  followDist = camDist; // arrows scale with it so guides stay readable zoomed out
  const se = Math.sin(followCam.elevation), ce = Math.cos(followCam.elevation);
  const sa = Math.sin(followCam.azimuth), ca = Math.cos(followCam.azimuth);
  // Basis: radial (local up), tangent (along-track, in-plane), and world +Z (out of plane).
  const tx = -radial.y, ty = radial.x;
  camera.position.set(
    camDist * (se * radial.x + ce * sa * tx),
    camDist * (se * radial.y + ce * sa * ty),
    camDist * (ce * ca)
  );
  camera.up.copy(radial);
  camera.lookAt(0, 0, 0);
}

// Local dirt texture for the ground patch: the body's color with dusty speckle. Up
// close, ground looks like ground — the map-scale continents live on the big sphere.
function groundTexture(key) {
  if (_groundTexCache[key]) return _groundTexCache[key];
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const ctx = cv.getContext("2d");
  const rng = mulberry32(hashStr(key + "-ground"));
  const style = styleFor(key);
  const base = new THREE.Color(style.color).multiplyScalar(0.82);
  ctx.fillStyle = "#" + base.getHexString();
  ctx.fillRect(0, 0, 256, 256);
  const tint = new THREE.Color();
  for (let i = 0; i < 700; i++) {
    ctx.globalAlpha = 0.05 + rng() * 0.1;
    tint.set(style.color).multiplyScalar(rng() > 0.5 ? 0.95 : 0.6);
    ctx.fillStyle = "#" + tint.getHexString();
    ctx.beginPath();
    ctx.arc(rng() * 256, rng() * 256, 1 + rng() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(28, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  _groundTexCache[key] = tex;
  return tex;
}

function ensureGroundPatch(body) {
  if (groundPatchKey === body.key) return;
  if (groundPatch) {
    scene.remove(groundPatch);
    groundPatch.geometry.dispose();
    groundPatch.material.dispose();
  }
  // Spherical cap around the +Y pole, re-aimed at the sub-craft point each frame.
  // 0.28 rad covers the horizon from any altitude the patch shows at; 48 radial
  // divisions keep the near-field sag to ~1-3 m (vs ~R/470 on the coarse sphere).
  const tex = groundTexture(body.key);
  groundPatch = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius, 96, 48, 0, Math.PI * 2, 0, 0.28),
    new THREE.MeshStandardMaterial({
      map: tex, roughness: 1, metalness: 0,
      emissive: 0xffffff, emissiveIntensity: 0.12, emissiveMap: tex,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })
  );
  groundPatch.frustumCulled = false;
  groundPatch.visible = false;
  scene.add(groundPatch);
  groundPatchKey = body.key;
}

// ☄️ A ring rock falls out of the sky near (or onto) the craft. Pure spectacle —
// main.js decides whether it broke anything. World coords; animated in updateFlight.
function spawnMeteor(sim, hitShip) {
  if (!scene || !sim || !sim.craft) return;
  const t = sim.time || 0;
  const dom = dominantBody(sim.craft.pos, t);
  const rm = Math.hypot(dom.rel.x, dom.rel.y) || 1;
  const ux = dom.rel.x / rm, uy = dom.rel.y / rm;      // local up
  const tx = -uy, ty = ux;                             // along-surface direction
  const Rb = dom.body.radius;
  const groundX = dom.center.x + ux * Rb, groundY = dom.center.y + uy * Rb;
  const off = hitShip ? 0 : (60 + Math.random() * 800) * (Math.random() < 0.5 ? -1 : 1);
  const p1 = hitShip
    ? { x: sim.craft.pos.x, y: sim.craft.pos.y }
    : { x: groundX + tx * off, y: groundY + ty * off };
  const p0 = { x: p1.x + ux * 9000 + tx * 2500 * (Math.random() - 0.5),
               y: p1.y + uy * 9000 + ty * 2500 * (Math.random() - 0.5) };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: new THREE.Color(2.2, 1.8, 1.2), transparent: true, opacity: 0.95, // blooms
  }));
  line.frustumCulled = false;
  scene.add(line);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: plumeGlowTexture(), color: 0xffd090, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flash.position.set(0, 0, 0);
  flash.frustumCulled = false;
  scene.add(flash);
  meteors.push({ p0, p1, t0: t, life: 1.3, line, flash });
}

function updateMeteors(t) {
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    const f = (t - m.t0) / m.life;
    if (f >= 1.4 || f < 0) { // done (or the clock warped away) — clean up
      scene.remove(m.line); m.line.geometry.dispose(); m.line.material.dispose();
      scene.remove(m.flash); m.flash.material.dispose();
      meteors.splice(i, 1);
      continue;
    }
    const fall = Math.min(1, f / 0.75); // falls for 75% of life, then the flash
    const hx = m.p0.x + (m.p1.x - m.p0.x) * fall, hy = m.p0.y + (m.p1.y - m.p0.y) * fall;
    const tf = Math.max(0, fall - 0.22);
    const tx0 = m.p0.x + (m.p1.x - m.p0.x) * tf, ty0 = m.p0.y + (m.p1.y - m.p0.y) * tf;
    const pos = m.line.geometry.getAttribute("position");
    pos.setXYZ(0, tx0 - ORIGIN.x, ty0 - ORIGIN.y, 0);
    pos.setXYZ(1, hx - ORIGIN.x, hy - ORIGIN.y, 0);
    pos.needsUpdate = true;
    m.line.material.opacity = fall >= 1 ? 0 : 0.95;
    if (fall >= 1) { // impact flash swells and fades
      const g = Math.min(1, (f - 0.75) / 0.55);
      m.flash.position.set(m.p1.x - ORIGIN.x, m.p1.y - ORIGIN.y, 0);
      m.flash.scale.setScalar(40 + g * 260);
      m.flash.material.opacity = 0.9 * (1 - g);
    }
  }
}

// One armored dino-bird: a big plant-eater — bird bones, dinosaur size, scale
// armor down the back (his design). Built once, repositioned per frame.
function makeDinoBird(i) {
  const g = new THREE.Group();
  const hide = new THREE.MeshStandardMaterial({
    color: [0x7a6a4a, 0x6a7a4a, 0x8a705a][i % 3], roughness: 0.9, metalness: 0,
    emissive: 0x3a3020, emissiveIntensity: 0.25,
  });
  const plate = new THREE.MeshStandardMaterial({
    color: 0x9aa2aa, roughness: 0.5, metalness: 0.3,
    emissive: 0x4a5058, emissiveIntensity: 0.2,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.4, 14, 10), hide);
  body.scale.set(1.7, 1.0, 0.9);
  body.position.y = 2.2;
  g.add(body);
  for (let k = 0; k < 4; k++) { // armor scales down the spine
    const sc = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.7, 5), plate);
    sc.position.set(-1.2 + k * 0.85, 3.3 - Math.abs(k - 1.5) * 0.12, 0);
    g.add(sc);
  }
  for (const sx of [-0.7, 0.7]) { // two stout legs
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 8), hide);
    leg.position.set(sx, 1.1, sx * 0.35);
    g.add(leg);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 8), hide);
  tail.rotation.z = Math.PI / 2 - 0.25;
  tail.position.set(-2.6, 2.4, 0);
  g.add(tail);
  const neck = new THREE.Group(); // pivots at the shoulder so the head can graze
  const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 2.0, 8), hide);
  nk.rotation.z = -0.9;
  nk.position.set(0.8, 0.7, 0);
  neck.add(nk);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 8), hide); // beaky
  head.rotation.z = -Math.PI / 2 + 0.2;
  head.position.set(1.75, 1.25, 0);
  neck.add(head);
  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 5), plate);
  crest.position.set(1.5, 1.75, 0);
  neck.add(crest);
  for (const sz of [-0.18, 0.18]) { // kind eyes — it only eats plants
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x1a1408 }));
    eye.position.set(1.55, 1.45, sz);
    neck.add(eye);
  }
  neck.position.set(1.4, 2.6, 0);
  g.add(neck);
  g.visible = false;
  return { group: g, neck };
}

function ensureDinoLife() {
  if (plantField) return;
  plantField = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.9, 2.4, 6),
    new THREE.MeshStandardMaterial({
      color: 0x3f8a3a, roughness: 0.9, metalness: 0,
      emissive: 0x1e4a1c, emissiveIntensity: 0.3,
    }),
    PLANT_COUNT);
  plantField.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  plantField.frustumCulled = false;
  plantField.visible = false;
  scene.add(plantField);
  dinoFlock = [];
  for (let i = 0; i < 5; i++) {
    const d = makeDinoBird(i);
    scene.add(d.group);
    dinoFlock.push(d);
  }
}

// =====================================================================
// Phase 5: near-surface rocks + landing reticle (the "how close am I" cues),
// the deployed rover with wheel tracks, and satellites.
// =====================================================================
function updateSurfaceExtras(sim, dom) {
  const solid = dom.body.solid;
  const alt = sim.altitude || 0;
  const near = mode === "flight" && flightView === "follow" && solid &&
               alt < 6000 && sim.status !== "crashed";
  // Accurate ground under you (appears well before the rocks so there's no pop).
  const showPatch = mode === "flight" && flightView === "follow" && solid &&
                    alt < 25000 && sim.status !== "crashed";
  if (showPatch) {
    ensureGroundPatch(dom.body);
    const rm0 = Math.hypot(dom.rel.x, dom.rel.y) || 1;
    groundPatch.position.set(dom.center.x - ORIGIN.x, dom.center.y - ORIGIN.y, 0);
    groundPatch.quaternion.setFromUnitVectors(_v1.set(0, 1, 0),
      _v2.set(dom.rel.x / rm0, dom.rel.y / rm0, 0));
    groundPatch.visible = true;
  } else if (groundPatch) {
    groundPatch.visible = false;
  }
  // Rocks: deterministic per ground "slot" so they hold still while you descend past them.
  if (rockField) {
    if (near) {
      const Rb = dom.body.radius;
      const cx = dom.center.x - ORIGIN.x, cy = dom.center.y - ORIGIN.y;
      const phi = Math.atan2(dom.rel.y, dom.rel.x);
      const style = styleFor(dom.body.key);
      if (style) rockField.material.color.set(style.color).multiplyScalar(0.55);
      rockField.material.emissive.copy(rockField.material.color);
      const bodySeed = hashStr(dom.body.key);
      // Two tiers: a DENSE strip right along the ground track (the ground-rush cue as
      // you come down) plus sparse far boulders for horizon depth.
      const NEAR = 170;
      for (let i = 0; i < ROCK_COUNT; i++) {
        const nearTier = i < NEAR;
        const arc = nearTier ? 24 : ROCK_ARC;   // meters of ground per rock slot
        const spread = nearTier ? 240 : 2600;   // out-of-plane scatter (m)
        const j = nearTier ? i : i - NEAR;
        const count = nearTier ? NEAR : ROCK_COUNT - NEAR;
        const slot = Math.round((phi * Rb) / arc) - count / 2 + j;
        const rr = mulberry32(((slot * 2654435761) ^ bodySeed ^ (nearTier ? 0 : 0x9e37)) >>> 0);
        const phiK = (slot * arc) / Rb + ((rr() - 0.5) * arc * 0.8) / Rb;
        const psi = ((rr() - 0.5) * spread) / Rb;
        const size = (nearTier ? 0.7 : 1.2) + rr() * rr() * 7; // pebbles + the odd boulder
        const cpk = Math.cos(phiK), spk = Math.sin(phiK);
        const cps = Math.cos(psi), sps = Math.sin(psi);
        _v3.set(cx + Rb * cpk * cps, cy + Rb * spk * cps, Rb * sps);
        _q1.setFromEuler(_e1.set(rr() * 3.14, rr() * 3.14, rr() * 3.14));
        _s3.set(size, size * (0.6 + rr() * 0.6), size);
        _m4.compose(_v3, _q1, _s3);
        rockField.setMatrixAt(i, _m4);
      }
      rockField.instanceMatrix.needsUpdate = true;
      rockField.visible = true;
    } else rockField.visible = false;
  }
  // LIFE (Hundun): armored dino-birds grazing among plant tufts. Deterministic per
  // ground slot like the rocks; they amble a little and dip their heads to eat.
  const lively = near && dom.body.style && dom.body.style.life === "dinobird";
  if (lively) {
    ensureDinoLife();
    const Rb = dom.body.radius;
    const cx = dom.center.x - ORIGIN.x, cy = dom.center.y - ORIGIN.y;
    const phi = Math.atan2(dom.rel.y, dom.rel.x);
    const t = sim.time || 0;
    // Plant tufts: instanced cones in a band along the ground track.
    const P_ARC = 26;
    for (let i = 0; i < PLANT_COUNT; i++) {
      const slot = Math.round((phi * Rb) / P_ARC) - PLANT_COUNT / 2 + i;
      const rr = mulberry32(((slot * 2654435761) ^ hashStr(dom.body.key) ^ 0x51ee) >>> 0);
      const phiK = (slot * P_ARC) / Rb + ((rr() - 0.5) * P_ARC * 0.9) / Rb;
      const psi = ((rr() - 0.5) * 260) / Rb;
      const size = 0.8 + rr() * 1.6;
      const cpk = Math.cos(phiK), spk = Math.sin(phiK);
      const cps = Math.cos(psi), sps = Math.sin(psi);
      _v3.set(cx + Rb * cpk * cps, cy + Rb * spk * cps, Rb * sps);
      _q1.setFromUnitVectors(_v1.set(0, 1, 0), _v2.set(cpk, spk, 0));
      _s3.set(size, size * (1.1 + rr() * 0.7), size);
      _m4.compose(_v3, _q1, _s3);
      plantField.setMatrixAt(i, _m4);
    }
    plantField.instanceMatrix.needsUpdate = true;
    plantField.visible = true;
    // The flock: a few big grazers spread along the track, each ambling ±40 m.
    const D_ARC = 210;
    for (let i = 0; i < dinoFlock.length; i++) {
      const d = dinoFlock[i];
      const slot = Math.round((phi * Rb) / D_ARC) - Math.floor(dinoFlock.length / 2) + i;
      const rr = mulberry32(((slot * 2654435761) ^ hashStr(dom.body.key) ^ 0xd1d0) >>> 0);
      const wander = Math.sin(t * 0.012 + rr() * 6.28) * 40; // slow amble along the track
      const phiK = (slot * D_ARC + (rr() - 0.5) * D_ARC * 0.5 + wander) / Rb;
      const psi = ((rr() - 0.5) * 200) / Rb;
      const cpk = Math.cos(phiK), spk = Math.sin(phiK);
      const cps = Math.cos(psi), sps = Math.sin(psi);
      d.group.position.set(cx + Rb * cpk * cps, cy + Rb * spk * cps, Rb * sps);
      d.group.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), _v2.set(cpk, spk, 0));
      // Graze cycle: head dips to the plants and comes back up, offset per animal.
      const dip = Math.max(0, Math.sin(t * 0.11 + i * 2.1));
      d.neck.rotation.z = -0.25 - dip * 0.85;
      d.group.visible = true;
    }
  } else {
    if (plantField) plantField.visible = false;
    if (dinoFlock) for (const d of dinoFlock) d.group.visible = false;
  }

  // Reticle: where you'll touch down, colored by whether this fall speed survives.
  if (reticle) {
    const showR = near && alt < 3000 && alt > 2 && sim.status !== "landed";
    if (showR) {
      const rm = Math.hypot(dom.rel.x, dom.rel.y) || 1;
      const ux = dom.rel.x / rm, uy = dom.rel.y / rm;
      const Rb = dom.body.radius;
      reticle.position.set(dom.center.x - ORIGIN.x + ux * Rb, dom.center.y - ORIGIN.y + uy * Rb, 0);
      reticle.quaternion.setFromUnitVectors(_v1.set(0, 0, 1), _v2.set(ux, uy, 0));
      const s = Math.max(4, alt * 0.12);
      reticle.scale.set(s, s, 1);
      const vr = (sim.craft.vel.x - dom.vel.x) * ux + (sim.craft.vel.y - dom.vel.y) * uy;
      const down = Math.max(0, -vr);
      const safe = (sim.craft.legCount || 0) > 0 ? 12 : 5;
      reticle.material.color.set(down <= safe ? 0x6effa0 : down <= safe * 1.8 ? 0xffc24a : 0xff5a4a);
      reticle.visible = true;
    } else reticle.visible = false;
  }
}

// The freed rover creeps along the surface leaving wheel tracks. Faster than a real
// rover (0.35 m/s vs Curiosity's 0.04) purely so he can SEE it move; it parks at 900 m.
function updateRover(sim, states) {
  const active = surfaceRover && sim.rover && BODIES[sim.rover.body] && states[sim.rover.body];
  if (!active) {
    if (surfaceRover) surfaceRover.visible = false;
    if (roverTrackL) roverTrackL.visible = false;
    if (roverTrackR) roverTrackR.visible = false;
    return;
  }
  const b = BODIES[sim.rover.body];
  const bs = states[sim.rover.body];
  const Rb = b.radius;
  const cx = bs.pos.x - ORIGIN.x, cy = bs.pos.y - ORIGIN.y;
  const phi0 = Math.atan2(sim.rover.offset.y, sim.rover.offset.x);
  const driven = Math.min(900, 0.35 * Math.max(0, (sim.time || 0) - sim.rover.t0));
  const phiR = phi0 + driven / Rb;
  surfaceRover.position.set(cx + Rb * Math.cos(phiR), cy + Rb * Math.sin(phiR), 0);
  surfaceRover.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), _v2.set(Math.cos(phiR), Math.sin(phiR), 0));
  surfaceRover.visible = true;
  const showTracks = driven > 1;
  for (const [line, zOff] of [[roverTrackL, 0.28], [roverTrackR, -0.28]]) {
    if (!showTracks) { line.visible = false; continue; }
    const attr = line.geometry.getAttribute("position");
    for (let i = 0; i < TRACK_N; i++) {
      const p = phi0 + ((driven * i) / (TRACK_N - 1)) / Rb;
      attr.setXYZ(i, cx + (Rb + 0.05) * Math.cos(p), cy + (Rb + 0.05) * Math.sin(p), zOff);
    }
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    line.visible = true;
  }
}

// =====================================================================
// Space stations: dockable outposts on fixed circular orbits (state.js STATIONS,
// propagated by main into sim.stationsView). A working one spins its ring and
// blinks a green docking light. The ABANDONED one is the story: a meteor tore a
// bite out of the ring, the panels hang dead, and years of litter tumble around it.
// =====================================================================
function makeStationMesh(abandoned) {
  const g = new THREE.Group();
  const skin = abandoned
    ? new THREE.MeshStandardMaterial({ color: 0x4a4e56, roughness: 0.95, metalness: 0.2,
        emissive: 0x14161a, emissiveIntensity: 0.4 })
    : tankMat();
  if (abandoned) skin._isClone = true; // per-station material: dispose with the pool

  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.6, 16), skin);
  core.rotation.z = Math.PI / 2;
  g.add(core);

  // The habitat ring. Working: full circle. Abandoned: a Pi*1.3 arc — the meteor
  // took the rest, and you can SEE the bite.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.0, 0.32, 10, 28, abandoned ? Math.PI * 1.3 : Math.PI * 2), skin);
  ring.rotation.y = Math.PI / 2;
  g.add(ring);
  for (let i = 0; i < (abandoned ? 2 : 3); i++) { // spokes
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.9, 6), skin);
    spoke.position.set(0, Math.cos(a) * 0.95, Math.sin(a) * 0.95);
    spoke.rotation.x = -a;
    ring.add(spoke.clone());
  }

  // Solar wings: crisp on a live station; one snapped, one missing on the wreck.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 3.4),
    abandoned ? skin : solarMat());
  wing.position.set(-1.9, 0, 0);
  g.add(wing);
  if (!abandoned) {
    const wing2 = wing.clone();
    wing2.position.x = 1.9;
    g.add(wing2);
  } else {
    wing.rotation.x = 0.8; // hangs broken
    wing.position.y = -0.4;
    // The meteor's exit wound: a dark scar plate on the core.
    const scar = new THREE.Mesh(new THREE.CircleGeometry(0.45, 10),
      new THREE.MeshBasicMaterial({ color: 0x08090c }));
    scar.position.set(0.4, 0.55, 0.62);
    scar.lookAt(2, 2.5, 3);
    g.add(scar);
    // Litter: a slow cloud of junk that never got cleaned up.
    const N = 90;
    const pos = new Float32Array(N * 3);
    const rng = mulberry32(hashStr("kestrel-junk"));
    for (let i = 0; i < N; i++) {
      const rr = 3 + rng() * 9, th = rng() * Math.PI * 2, ph = (rng() - 0.5) * 1.6;
      pos[i * 3] = Math.cos(th) * Math.cos(ph) * rr;
      pos[i * 3 + 1] = Math.sin(ph) * rr * 0.5;
      pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * rr;
    }
    const jg = new THREE.BufferGeometry();
    jg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const junk = new THREE.Points(jg, new THREE.PointsMaterial({
      color: 0x9aa0a8, size: 0.14, sizeAttenuation: true, depthWrite: false,
    }));
    g.add(junk);
    for (let i = 0; i < 5; i++) { // bigger debris chunks
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.3 + rng() * 0.4, 0.2 + rng() * 0.3, 0.25), skin);
      const rr = 3.5 + rng() * 6, th = rng() * Math.PI * 2;
      chunk.position.set(Math.cos(th) * rr, (rng() - 0.5) * 3, Math.sin(th) * rr);
      chunk.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      g.add(chunk);
    }
  }

  // Docking port + light on the +X end.
  const port = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.4, 12),
    abandoned ? skin : hazardMat());
  port.rotation.z = Math.PI / 2;
  port.position.x = 1.5;
  g.add(port);
  let blink = null;
  if (!abandoned) {
    blink = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.0, 0.6) })); // HDR: it blooms
    blink.position.x = 1.85;
    g.add(blink);
  }
  return { group: g, ring, blink };
}

function ensureStation(st) {
  if (stationPool[st.id]) return stationPool[st.id];
  const m = makeStationMesh(!!st.abandoned);
  m.group.scale.setScalar(3.5); // stations DWARF capsules (the ISS is ~30 rockets wide)
  m.group.visible = false;
  scene.add(m.group);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({ color: st.abandoned ? 0x8a93a8 : st.yours ? 0xffd24a : 0x7fe8a8 }));
  dot.frustumCulled = false;
  dot.visible = false;
  scene.add(dot);
  const label = makeTextSprite((st.abandoned ? "⚠ " : "🛰 ") + st.name + (st.yours ? " ⭐" : ""),
    st.abandoned ? "#8a93a8" : st.yours ? "#ffd24a" : "#7fe8a8");
  scene.add(label);
  stationPool[st.id] = { ...m, dot, label, abandoned: !!st.abandoned };
  return stationPool[st.id];
}

function updateStations(sim) {
  const list = (sim && sim.stationsView) || [];
  const t = (sim && sim.time) || 0;
  const seen = new Set();
  for (const st of list) {
    seen.add(st.id);
    const e = ensureStation(st);
    const sx = st.pos.x - ORIGIN.x, sy = st.pos.y - ORIGIN.y;
    if (flightView === "map") {
      e.group.visible = false;
      const b = BODIES[st.body];
      const inFrame = mapFrame > 0 && Math.hypot(sx, sy) < mapFrame * 6;
      const show = inFrame && b && mapFrame < b.soiRadius * 12; // same declutter as satellites
      e.dot.visible = show; e.label.visible = show;
      if (show) {
        e.dot.position.set(sx, sy, mapFrame * 0.015);
        e.dot.scale.setScalar(mapFrame * 0.006);
        const lblS = mapFrame * 0.03;
        e.label.position.set(sx, sy - mapFrame * 0.03, mapFrame * 0.015);
        e.label.scale.set(lblS * 2.6, lblS * 0.9, 1);
      }
    } else {
      e.dot.visible = false; e.label.visible = false;
      const d = Math.hypot(sx, sy);
      e.group.visible = mode === "flight" && d < 80000;
      if (e.group.visible) {
        e.group.position.set(sx, sy, 0);
        if (e.abandoned) {
          e.group.rotation.set(t * 0.013 % 6.283, t * 0.007 % 6.283, t * 0.019 % 6.283); // dead tumble
        } else {
          e.ring.rotation.x = (t * 0.12) % (Math.PI * 2); // gravity ring spin
          if (e.blink) e.blink.visible = Math.sin(t * 4) > -0.2; // docking beacon
        }
      }
    }
  }
  for (const id of Object.keys(stationPool)) { // hide anything not in this system
    if (!seen.has(id)) {
      const e = stationPool[id];
      e.group.visible = false; e.dot.visible = false; e.label.visible = false;
    }
  }
}

// Satellites: the real little spacecraft up close in follow view; dot + name in map view.
function ensureSatEntry(i) {
  if (satPool[i]) return satPool[i];
  if (!MAT) makeMaterials();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.8), MAT.probe));
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 0.05), MAT.solar);
    wing.position.x = s * 1.8;
    g.add(wing);
  }
  g.visible = false;
  scene.add(g);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0x7fe8ff }));
  dot.frustumCulled = false;
  dot.visible = false;
  scene.add(dot);
  satPool[i] = { group: g, dot, label: null, name: null };
  return satPool[i];
}
function updateSatellites(sim) {
  const sats = (sim && sim.satellites) || [];
  const n = Math.max(satPool.length, sats.length);
  for (let i = 0; i < n; i++) {
    if (i >= sats.length) {
      const e = satPool[i];
      if (e) { e.group.visible = false; e.dot.visible = false; if (e.label) e.label.visible = false; }
      continue;
    }
    const sat = sats[i];
    const e = ensureSatEntry(i);
    if (e.name !== sat.name) { // (re)bake the name label
      if (e.label) { scene.remove(e.label); if (e.label.material.map) e.label.material.map.dispose(); e.label.material.dispose(); }
      e.label = makeTextSprite(sat.name || "Sat", sat.hasPower ? "#7fe8ff" : "#8a93a8");
      scene.add(e.label);
      e.name = sat.name;
    }
    const w = Physics.satellitePos(sat, sim.time || 0);
    const sx = w.x - ORIGIN.x, sy = w.y - ORIGIN.y;
    if (flightView === "map") {
      e.group.visible = false;
      const soi = BODIES[sat.bodyKey] ? BODIES[sat.bodyKey].soiRadius : 0;
      const inFrame = mapFrame > 0 && Math.hypot(sx, sy) < mapFrame * 6;
      const show = inFrame && mapFrame < soi * 12; // declutter: only when zoomed near its world
      e.dot.visible = show;
      e.label.visible = show;
      if (show) {
        e.dot.position.set(sx, sy, mapFrame * 0.015);
        e.dot.scale.setScalar(mapFrame * 0.006);
        const lblS = mapFrame * 0.03;
        e.label.position.set(sx, sy + mapFrame * 0.022, mapFrame * 0.015);
        e.label.scale.set(lblS * 2.2, lblS * 0.8, 1);
      }
    } else {
      e.dot.visible = false;
      e.label.visible = false;
      const d = Math.hypot(sx, sy);
      e.group.visible = d < 60000; // close enough to see the actual spacecraft
      if (e.group.visible) {
        e.group.position.set(sx, sy, 0);
        e.group.rotation.z = ((sim.time || 0) * 0.08) % (Math.PI * 2); // lazy tumble
      }
    }
  }
}

// Map view: top-down of the orbital plane, centered on the DOMINANT body (Earth in LEO,
// the Sun once you've escaped). Zoom out to see the whole solar system.
function updateMapCamera(sim, dom, states) {
  const bodyR = dom.body.radius;
  const craftR = Math.hypot(dom.rel.x, dom.rel.y);
  const apoR = (sim.orbit && sim.orbit.bodyKey === dom.body.key && isFinite(sim.orbit.apoapsis))
    ? (bodyR + sim.orbit.apoapsis) : 0;
  let base = Math.max(apoR, craftR, bodyR * 2.5) * 1.15;
  if (base < mapBase) base = mapBase;
  mapBase = base;
  mapFrame = base * mapZoom;
  const vHalf = ((camera.fov * Math.PI) / 180) / 2;
  const dist = mapFrame / Math.tan(vHalf);
  // Center on the dominant body (scene coords = world - ORIGIN).
  const cx = dom.center.x - ORIGIN.x;
  const cy = dom.center.y - ORIGIN.y;
  camera.position.set(cx, cy, dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(cx, cy, 0);

  if (mapMarker) {
    mapMarker.visible = true;
    mapMarker.position.set(0, 0, mapFrame * 0.02); // the craft IS the origin
    mapMarker.scale.setScalar(mapFrame * 0.018);
  }

  // The galaxy neighborhood: his named systems as stars, past the last planet.
  const showGal = mapFrame > GALAXY_ZOOM;
  for (const e of galaxy.entries) {
    e.dot.visible = showGal;
    e.label.visible = showGal;
    if (!showGal) continue;
    const gx = e.pos.x - ORIGIN.x, gy = e.pos.y - ORIGIN.y;
    e.dot.position.set(gx, gy, mapFrame * 0.012);
    e.dot.scale.setScalar(mapFrame * 0.009);
    const lblS = mapFrame * 0.038;
    e.label.position.set(gx, gy + lblS * 0.8, mapFrame * 0.012);
    e.label.scale.set(lblS * 2.2, lblS * 0.8, 1);
  }

  // Body dots + labels — never smaller than the true sphere (zoomed close, reality wins).
  // DECLUTTER RULE: a body only gets its dot+label once it visually SEPARATES from its
  // parent at this zoom (> ~4.5% of the frame). Otherwise Jupiter and its four moons pile
  // onto one pixel and the stacked names read as alphabet soup (first play-test bug #2).
  for (const key of ALL_KEYS) {
    const b = BODIES[key];
    const st = states[key];
    const { dot, label } = mapDots[key];
    const separated = key === "sun" || b.orbitRadius > mapFrame * 0.045;
    if (!separated) { dot.visible = false; label.visible = false; continue; }
    const sx = st.pos.x - ORIGIN.x, sy = st.pos.y - ORIGIN.y;
    const dotSize = mapFrame * (key === "sun" ? 0.02 : 0.012);
    const size = Math.max(b.radius, dotSize);
    // Zoomed close, reality wins: once the TRUE sphere is bigger than the dot would be,
    // hide the dot — a flat-color stand-in intersecting the textured planet reads as
    // shattered-glass z-fighting (showed up the moment planets got real faces).
    dot.visible = b.radius < dotSize;
    if (dot.visible) {
      dot.position.set(sx, sy, mapFrame * 0.012);
      dot.scale.setScalar(dotSize);
    }
    const lblS = mapFrame * 0.045;
    // Label only when the body is plausibly in frame (within ~3 half-widths of center).
    const inView = Math.hypot(sx - cx, sy - cy) < mapFrame * 3;
    label.visible = inView;
    if (inView) {
      label.position.set(sx, sy + size + lblS * 0.6, mapFrame * 0.012);
      label.scale.set(lblS * 2.2, lblS * 0.8, 1);
    }
  }
}

// User zoom (scroll wheel or +/- keys). factor > 1 zooms out. Routes to whichever flight
// view is active: the map's frame, or the follow camera's distance.
function zoomMap(factor) {
  if (mode === "flight" && flightView === "follow") {
    followZoom = Math.max(0.4, Math.min(50000, followZoom * factor));
  } else {
    mapZoom = Math.max(0.05, Math.min(2e6, mapZoom * factor));
  }
}

// Guide arrows, sized per view. Directions are measured RELATIVE TO THE DOMINANT BODY —
// "prograde" next to the Moon means your motion vs the Moon, not vs the Sun.
function updateDirArrows(sim, dom, angle, inMap) {
  // Follow view: arrows scale with the camera distance so the guides stay readable
  // when the kid zooms way out to see the planet.
  const len = inMap ? mapFrame * 0.12 : Math.max(5, craftHeight * 1.6, followDist * 0.22);
  const headLen = len * (inMap ? 0.28 : 0.3);
  const headW = len * (inMap ? 0.18 : 0.1);
  const z = inMap ? mapFrame * 0.02 : 0;
  const rvx = sim.craft.vel.x - dom.vel.x;
  const rvy = sim.craft.vel.y - dom.vel.y;
  const rvm = Math.hypot(rvx, rvy);

  if (headingArrow) {
    if (showHeading) {
      headingArrow.position.set(0, 0, z);
      headingArrow.setDirection(_v1.set(-Math.sin(angle), Math.cos(angle), 0));
      headingArrow.setLength(len, headLen, headW);
      headingArrow.visible = true;
    } else headingArrow.visible = false;
  }
  if (progradeArrow) {
    if (showPrograde && rvm > 1) {
      progradeArrow.position.set(0, 0, z);
      progradeArrow.setDirection(_v1.set(rvx / rvm, rvy / rvm, 0));
      progradeArrow.setLength(len, headLen, headW);
      progradeArrow.visible = true;
    } else progradeArrow.visible = false;
  }
  // Gold "aim here" director:
  //  1) TRANSFER WINDOW OPEN: gold rides prograde (outward trips) or retrograde (coming
  //     home from beyond) — "point at gold and burn" starts the trip either way.
  //  2) Otherwise: the gravity-turn schedule vs the local world.
  if (targetArrow && showTarget && sim.transfer && sim.transfer.open && rvm > 1) {
    const s = sim.transfer.dir === "retrograde" ? -1 : 1;
    targetArrow.position.set(0, 0, z);
    targetArrow.setDirection(_v1.set((s * rvx) / rvm, (s * rvy) / rvm, 0));
    targetArrow.setLength(len * 1.1, headLen, headW);
    targetArrow.visible = true;
    return;
  }
  //  1b) MID-COURSE CORRECTION: cruising toward the target but predicted to miss — gold
  //      points along the burn vector that shrinks the miss ("point at gold, gentle burn").
  if (targetArrow && showTarget && sim.course && !sim.course.onTarget && sim.course.burnVec) {
    targetArrow.position.set(0, 0, z);
    targetArrow.setDirection(_v1.set(sim.course.burnVec.x, sim.course.burnVec.y, 0).normalize());
    targetArrow.setLength(len * 1.1, headLen, headW);
    targetArrow.visible = true;
    return;
  }
  if (targetArrow && showTarget) {
    const r = Math.hypot(dom.rel.x, dom.rel.y) || 1;
    const rox = dom.rel.x / r, roy = dom.rel.y / r;      // radial out (local up)
    let tx = roy, ty = -rox;                              // horizontal tangent
    if (rvx * tx + rvy * ty < 0) { tx = -tx; ty = -ty; }  // align with your turn direction
    const f = Math.max(0, Math.min(1, ((sim.altitude || 0) - 3000) / 57000)); // up→horizon 3–60 km
    let dx = rox * (1 - f) + tx * f, dy = roy * (1 - f) + ty * f;
    const dm = Math.hypot(dx, dy) || 1;
    targetArrow.position.set(0, 0, z);
    targetArrow.setDirection(_v1.set(dx / dm, dy / dm, 0));
    targetArrow.setLength(len * 1.1, headLen, headW);
    targetArrow.visible = true;
  } else if (targetArrow) {
    targetArrow.visible = false;
  }
}

// =====================================================================
// Predicted orbit ellipse around the dominant body.
// =====================================================================
function ensureOrbitLine() {
  if (orbitLine) return;
  const geo = new THREE.BufferGeometry();
  const SEG = 256;
  const positions = new Float32Array((SEG + 1) * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x6fe0ff, transparent: true, opacity: 0.7 });
  orbitLine = new THREE.LineLoop(geo, mat);
  orbitLine.frustumCulled = false;
  scene.add(orbitLine);
}

function updateOrbitLine(sim) {
  ensureOrbitLine();
  const o = sim.orbit;
  if (!isFinite(o.apoapsis) || !isFinite(o.periapsis)) {
    orbitLine.visible = false;
    if (apMarker) apMarker.visible = false;
    if (peMarker) peMarker.visible = false;
    return;
  }
  const bodyR = o.bodyRadius || BODIES.earth.radius;
  // Focus (body center) in SCENE coords: world minus the floating origin.
  const fx = (o.center ? o.center.x : 0) - ORIGIN.x;
  const fy = (o.center ? o.center.y : 0) - ORIGIN.y;
  const ra = bodyR + (o.apoapsis || 0);
  const rp = bodyR + (o.periapsis || 0);
  const a = (ra + rp) / 2;
  const c = (ra - rp) / 2;
  const b = Math.sqrt(Math.max(0, a * a - c * c));

  let rot = 0;
  if (typeof o.periAngle === "number" && isFinite(o.periAngle) && (o.eccentricity || 0) > 1e-4) {
    rot = o.periAngle;
  } else {
    rot = Math.atan2(-fy, -fx) + Math.PI; // craft (scene origin) direction from the focus
  }
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  const attr = orbitLine.geometry.getAttribute("position");
  const SEG = (attr.count) - 1;
  const cx = -c;
  for (let i = 0; i <= SEG; i++) {
    const tt = (i / SEG) * Math.PI * 2;
    const lx = cx + a * Math.cos(tt);
    const ly = b * Math.sin(tt);
    const wx = lx * cosR - ly * sinR + fx;
    const wy = lx * sinR + ly * cosR + fy;
    attr.setXYZ(i, wx, wy, 0);
  }
  attr.needsUpdate = true;
  orbitLine.geometry.computeBoundingSphere();
  orbitLine.visible = true;

  ensureApPeMarkers();
  const showMarks = flightView === "map" && mapFrame > 0;
  if (showMarks) {
    const periW = { x: rp * cosR + fx, y: rp * sinR + fy };
    const apoW = { x: -ra * cosR + fx, y: -ra * sinR + fy };
    const s = mapFrame * 0.045;
    peMarker.position.set(periW.x, periW.y, mapFrame * 0.02);
    peMarker.scale.set(s, s, 1);
    peMarker.visible = true;
    apMarker.position.set(apoW.x, apoW.y, mapFrame * 0.02);
    apMarker.scale.set(s, s, 1);
    apMarker.visible = true;
  } else {
    if (apMarker) apMarker.visible = false;
    if (peMarker) peMarker.visible = false;
  }
}

// Round label sprite ("Ap"/"Pe"/"Burn") — dot with text inside.
let apMarker = null, peMarker = null;
let burnMarker = null;
function makeLabelSprite(text, color, fontPx = 56) {
  const cv = document.createElement("canvas");
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext("2d");
  ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 8; ctx.strokeStyle = "#0b1220"; ctx.stroke();
  ctx.font = "800 " + fontPx + "px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#0b1220";
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(cv);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.frustumCulled = false;
  sprite.visible = false;
  return sprite;
}

// Plain floating name text (no dot) for map-view body labels.
function makeTextSprite(text, color) {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 96;
  const ctx = cv.getContext("2d");
  ctx.font = "700 44px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 8; ctx.strokeStyle = "rgba(5,7,15,0.85)";
  ctx.strokeText(text, 128, 48);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(cv);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.frustumCulled = false;
  sprite.visible = false;
  return sprite;
}

function ensureApPeMarkers() {
  if (apMarker) return;
  apMarker = makeLabelSprite("Ap", "#8fb7ff");
  peMarker = makeLabelSprite("Pe", "#ffd24a");
  scene.add(apMarker);
  scene.add(peMarker);
}

// Gold "Burn" marker at the transfer-burn start point (map view only).
function updateBurnMarker(sim) {
  const tw = sim && sim.transfer;
  if (!(mode === "flight" && flightView === "map" && tw && tw.burnPos && mapFrame > 0)) {
    if (burnMarker) burnMarker.visible = false;
    return;
  }
  if (!burnMarker) {
    burnMarker = makeLabelSprite("Burn", "#ffd24a", 36);
    scene.add(burnMarker);
  }
  const s = mapFrame * 0.05;
  burnMarker.position.set(tw.burnPos.x - ORIGIN.x, tw.burnPos.y - ORIGIN.y, mapFrame * 0.02);
  burnMarker.scale.set(s, s, 1);
  burnMarker.visible = true;
}

// =====================================================================
// Render.highlightSnap — translucent ghost at top of stack.
// =====================================================================
function ensureSnapGhost() {
  if (snapGhost) return;
  const geo = new THREE.CylinderGeometry(0.65, 0.65, 0.4, 20);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x7fffd0, transparent: true, opacity: 0.35, depthWrite: false,
  });
  snapGhost = new THREE.Mesh(geo, mat);
  snapGhost.visible = false;
  scene.add(snapGhost);
}

function highlightSnap(yes, atTop) {
  ensureSnapGhost();
  if (!yes) {
    snapGhost.visible = false;
    return;
  }
  const half = craftHeight / 2;
  const yLocal = atTop === false ? -half - 0.2 : half + 0.2;
  if (craftGroup) {
    snapGhost.position.set(
      craftGroup.position.x,
      craftGroup.position.y + yLocal,
      craftGroup.position.z
    );
  } else {
    snapGhost.position.set(0, 1.4, 0);
  }
  snapGhost.visible = true;
}

// =====================================================================
// Render.screenToBuildIntent — optional helper; null is acceptable.
// =====================================================================
function screenToBuildIntent(e) {
  return null;
}

// Toggle an individual guide arrow: which ∈ "target" | "heading" | "prograde".
function setArrow(which, on) {
  if (which === "target") showTarget = !!on;
  else if (which === "heading") showHeading = !!on;
  else if (which === "prograde") showPrograde = !!on;
}

// Switch flight camera between "follow" (chase the rocket) and "map" (top-down orbit view).
function setFlightView(v) {
  flightView = v === "map" ? "map" : "follow";
  if (flightView === "map") {
    mapFrame = 0; mapBase = 0; // recompute auto-fit; keep user zoom
    if (mode === "build") {
      // Pad-side map: reveal the solar system, tuck the pad scenery away.
      for (const key of ALL_KEYS) if (bodyGroups[key]) bodyGroups[key].visible = true;
      for (const key of PLANET_KEYS) if (orbitRings[key]) orbitRings[key].visible = true;
      if (launchpad) launchpad.visible = false;
      if (ground) ground.visible = false;
      if (connieMesh) connieMesh.visible = false;
    }
  } else {
    if (mapMarker) mapMarker.visible = false;
    hideMapDots();
    if (mode === "build") setMode("build"); // restore the pad scene exactly
  }
}

// =====================================================================
// 🚪 STATION INTERIORS — dock, press E, and the Connie floats INSIDE.
// A seeded little world per station (never identical): module size, wall tint,
// windows, cargo, plant racks, science consoles. Derelicts are dark, red-lit, and
// full of drifting junk. Some stations out in the generated systems have a RESIDENT.
// Zero-g: arrow keys nudge the Connie, she coasts, walls bounce softly. Drift close
// to a glowing console and science HAPPENS (callback to main). E exits.
// =====================================================================
let interior = null; // { scene, cam, connie, vel, consoles, alien, keys, hintEl, cb, len, rad, t0 }

function interiorKeyDown(e) {
  if (!interior) return;
  interior.keys[e.key] = true;
  if (e.key === "e" || e.key === "E" || e.key === "Escape") {
    const cb = interior.cb;
    exitStation();
    if (cb && cb.onExit) cb.onExit();
  }
}
function interiorKeyUp(e) { if (interior) interior.keys[e.key] = false; }

function enterStation(info, cb) {
  if (interior) exitStation();
  const rng = mulberry32(hashStr("interior:" + info.seedKey));
  const iScene = new THREE.Scene();
  const len = 8 + rng() * 6;       // every module a different length
  const rad = 2.6 + rng() * 0.8;
  const derelict = !!info.abandoned;

  // ARCHETYPES (his fix: "the stations are all the same inside"). Every station is
  // now a KIND of place — a cargo hub, a fuel depot, a greenhouse, an observatory,
  // or a science lab — with its own furniture, lighting, windows, and experiments.
  // The famous addresses are hand-assigned; everywhere else it's seeded, so the
  // same station is the same place forever.
  const ARCH_PINNED = {
    "sol/harbor": "hub",            // Harbor Station: the freight yard of Earth orbit
    "sol/selene": "depot",          // Selene Depot: it's in the NAME
    "gen:kerbol/st_home": "hub",    // Gene's Station: mission control energy
    "gen:kerbol/st_far": "lab",     // Jool Research Outpost
    "gen:pandora/st_home": "garden",   // Hell's Gate: jungle moon below, jungle inside
    "gen:youngcow/st_home": "garden",  // Cradle Station: a nursery for a baby system
  };
  let arch = "lab";
  if (info.ground) arch = "base";
  else if (!derelict) {
    const kinds = ["hub", "depot", "garden", "observatory", "lab"];
    arch = ARCH_PINNED[info.seedKey] || kinds[Math.floor(rng() * kinds.length)];
  }

  // Hull: a cylinder seen from INSIDE, with end caps. Wall tint says what kind of
  // place this is (seeded pastel only for labs/bases, like before).
  const ARCH_WALL = { hub: 0x7e8894, depot: 0x9a8e78, garden: 0xaac8a2, observatory: 0x39415a };
  const wallColor = derelict ? 0x3a3236
    : ARCH_WALL[arch] || new THREE.Color().setHSL(rng(), 0.12, 0.72).getHex();
  const wallMat = new THREE.MeshStandardMaterial({
    color: wallColor, roughness: 0.9, metalness: 0.1, side: THREE.BackSide,
  });
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 28, 1, true), wallMat);
  hull.rotation.z = Math.PI / 2; // axis along X
  iScene.add(hull);
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(rad, 28), wallMat.clone());
    cap.material.side = THREE.FrontSide;
    cap.material._isClone = true;
    cap.position.x = sx * len / 2;
    cap.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    iScene.add(cap);
  }
  // Ring frames every couple of meters, like every real module.
  for (let x = -len / 2 + 1.2; x < len / 2 - 0.8; x += 2.2) {
    const frame = new THREE.Mesh(new THREE.TorusGeometry(rad - 0.06, 0.055, 6, 24),
      new THREE.MeshStandardMaterial({ color: derelict ? 0x2a2426 : 0x9aa2ae, roughness: 0.8 }));
    frame.material._isClone = true;
    frame.rotation.y = Math.PI / 2;
    frame.position.x = x;
    iScene.add(frame);
  }

  // Windows: starfield outside (tiny baked canvas) — or, in a GROUND base, the
  // planet itself. Hubs and gardens look DOWN at their world (stations orbit
  // something); the observatory skips portholes for one giant cupola (built below).
  const nWin = derelict ? 1 : arch === "observatory" ? 0 : 2 + Math.floor(rng() * 3);
  const planetView = arch === "hub" || arch === "garden";
  const planetHue = rng(); // this station's world, same color in every window
  for (let i = 0; i < nWin; i++) {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 48;
    const ctx = cv.getContext("2d");
    if (planetView) {
      ctx.fillStyle = "#050a18"; ctx.fillRect(0, 0, 64, 48);
      ctx.fillStyle = "#fff";
      for (let k = 0; k < 14; k++) ctx.fillRect(rng() * 64, rng() * 26, 1, 1);
      // the world below: a bright limb filling the window's lower half
      const pc = new THREE.Color().setHSL(planetHue, 0.5, 0.55);
      ctx.fillStyle = "#" + pc.getHexString();
      ctx.beginPath(); ctx.arc(32, 88, 62, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)"; // cloud swirls
      for (let k = 0; k < 6; k++) {
        ctx.beginPath();
        ctx.ellipse(rng() * 64, 34 + rng() * 14, 6 + rng() * 8, 2 + rng() * 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (info.ground) {
      const sky = ctx.createLinearGradient(0, 0, 0, 30);
      sky.addColorStop(0, "#7ab0d8"); sky.addColorStop(1, "#c8d8a8");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 64, 30);
      ctx.fillStyle = "#4a7a44"; ctx.fillRect(0, 30, 64, 18); // the plains
      ctx.fillStyle = "#3a5a34";
      for (let k = 0; k < 8; k++) ctx.fillRect(rng() * 64, 32 + rng() * 12, 2, 3); // plant tufts
      if (rng() > 0.5) { // a grazing dino-bird silhouette, far off
        const dx = 10 + rng() * 40;
        ctx.fillStyle = "#2a3a28";
        ctx.fillRect(dx, 26, 6, 3); ctx.fillRect(dx + 5, 22, 2, 5); ctx.fillRect(dx + 1, 29, 1, 3); ctx.fillRect(dx + 4, 29, 1, 3);
      }
    } else {
      ctx.fillStyle = "#050a18"; ctx.fillRect(0, 0, 64, 48);
      ctx.fillStyle = "#fff";
      for (let k = 0; k < 30; k++) ctx.fillRect(rng() * 64, rng() * 48, 1, 1);
    }
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
    const wx = -len / 2 + 1.5 + (i + 0.5) * (len - 3) / nWin;
    win.position.set(wx, 0.3 + rng() * 0.8, -rad + 0.08);
    iScene.add(win);
  }

  // A wrecked GROUND base wears its story: long claw-scrape marks down the walls
  // (three parallel gouges — something big and armored shouldered through here).
  if (info.ground && derelict) {
    const gougeMat = new THREE.MeshStandardMaterial({ color: 0x1c1518, roughness: 1 });
    for (let s = 0; s < 3; s++) {
      const gx = -len / 2 + 2 + s * (len - 4) / 3;
      for (let k = 0; k < 3; k++) {
        const gouge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.05), gougeMat);
        gouge.material._isClone = true;
        gouge.position.set(gx + k * 0.28, 0.2 + rng() * 0.5, -rad + 0.1);
        gouge.rotation.z = 0.35 + rng() * 0.2;
        iScene.add(gouge);
      }
    }
  }

  // Science consoles: glowing racks the Connie floats up to. Kinds rotate; the
  // derelict has ONE faint salvage log instead; an alien brings its own console.
  const consoles = [];
  const addConsole = (x, y, kind, screenColor) => {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.5),
      new THREE.MeshStandardMaterial({ color: derelict ? 0x2f2b2e : 0x6a7280, roughness: 0.7 }));
    rack.material._isClone = true;
    rack.position.set(x, y, -rad + 0.5);
    iScene.add(rack);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42),
      new THREE.MeshBasicMaterial({ color: screenColor }));
    screen.position.set(x, y + 0.22, -rad + 0.78);
    iScene.add(screen);
    consoles.push({ x, y, kind, screen, done: false });
  };
  // In ANY gravity interior — a ground base OR a spinning centrifuge station (his
  // rule: gravity means nothing floats) — everything stands at FLOOR height, where
  // a standing, jumping Connie can actually reach the screens.
  const grounded = !!info.ground || !!info.spin;
  const floorY = -(rad - 0.95);
  const conY = grounded ? floorY + 0.55 : null;
  if (derelict) {
    addConsole(0.5, conY != null ? conY : -0.4,
      info.ground ? "basewreck" : "salvage", new THREE.Color(0.5, 0.12, 0.1)); // dying ember
  } else {
    // Each kind of station runs its own science: gardens grow, observatories look,
    // depots test materials, hubs and labs dabble.
    const ARCH_CONSOLES = {
      hub: ["materials", "astro"], depot: ["materials", "materials"],
      garden: ["bio", "bio"], observatory: ["astro", "astro"],
      lab: ["bio", "materials", "astro"], base: ["bio", "materials", "astro"],
    };
    const kindList = ARCH_CONSOLES[arch] || ARCH_CONSOLES.lab;
    const n = arch === "lab" || arch === "base" ? 1 + Math.floor(rng() * 3) : kindList.length;
    for (let i = 0; i < n; i++) {
      addConsole(-len / 2 + 1.6 + i * (len - 3) / Math.max(1, n - 0.5) + rng(),
        conY != null ? conY : -0.6 + rng() * 1.2, kindList[i % kindList.length],
        new THREE.Color(0.15, 1.6, 0.8)); // HDR: it blooms
    }
    // A plant rack, where plants belong — gardens overflow with them (built below),
    // labs keep a small one, ground bases run a proper greenhouse shelf.
    if (arch === "garden" || arch === "lab" || arch === "base") {
    const shelfY = grounded ? floorY + 0.05 : -1.1;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x8a919c }));
    shelf.material._isClone = true;
    shelf.position.set(len * 0.22, shelfY, -rad + 0.6);
    iScene.add(shelf);
    const nSprout = grounded ? 9 : 5;
    for (let i = 0; i < nSprout; i++) {
      const sprout = new THREE.Mesh(new THREE.SphereGeometry(0.09 + rng() * 0.08, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x4fae54, roughness: 0.8 }));
      sprout.material._isClone = true;
      sprout.position.set(len * 0.22 - 0.55 + i * (1.1 / nSprout) + rng() * 0.06,
        shelfY + 0.12 + rng() * 0.1, -rad + 0.6);
      iScene.add(sprout);
    }
    } // end plant-rack gate (garden / lab / base only)
  }

  // Clutter: FLOATING cargo in zero-g — but anywhere with gravity (a ground base,
  // or a spinning centrifuge station) everything sits properly on the floor
  // (his rule: gravity means nothing floats — spin gravity counts, that's the point).
  const nJunk = derelict ? 16 : 5 + Math.floor(rng() * 4);
  const drifters = [];
  for (let i = 0; i < nJunk; i++) {
    const bh = 0.15 + rng() * 0.25;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.2 + rng() * 0.3, bh, 0.2),
      new THREE.MeshStandardMaterial({
        color: derelict ? 0x4a4448 : [0xc8b48a, 0xdfe3ea, 0x8fa8c8][Math.floor(rng() * 3)],
        roughness: 0.85,
      }));
    box.material._isClone = true;
    if (grounded) {
      box.position.set((rng() - 0.5) * (len - 2), -(rad - 0.95) - 0.35 + bh / 2, (rng() - 0.5) * rad * 0.5);
      box.rotation.set(0, rng() * 3, derelict ? (rng() - 0.5) * 0.5 : 0); // wreck junk lies askew
      iScene.add(box);
      drifters.push({ m: box, w: 0 }); // grounded: it does NOT drift
    } else {
      box.position.set((rng() - 0.5) * (len - 2), (rng() - 0.5) * (rad), (rng() - 0.5) * rad * 0.8);
      box.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      iScene.add(box);
      drifters.push({ m: box, w: (rng() - 0.5) * (derelict ? 0.8 : 0.25) });
    }
  }

  // ---- Archetype furniture: what makes a hub a hub and a garden a garden ----
  if (arch === "hub") {
    // Cargo hub: strapped crate stacks, a loading arm, hazard stripes by the door.
    const crateMat = new THREE.MeshStandardMaterial({ color: 0xc8a45a, roughness: 0.85 });
    crateMat._isClone = true;
    for (let s = 0; s < 3; s++) {
      const sx = -len / 2 + 1.6 + s * (len - 3) / 3;
      for (let k = 0; k < 4; k++) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.5), crateMat);
        crate.position.set(sx + (k % 2) * 0.6, -rad + 1.15 + Math.floor(k / 2) * 0.55, -(rad - 1.05));
        crate.rotation.y = (rng() - 0.5) * 0.15;
        iScene.add(crate);
      }
      const strap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.15, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xd8b83a, roughness: 0.7, transparent: true, opacity: 0.5 }));
      strap.material._isClone = true;
      strap.position.set(sx + 0.3, -rad + 1.4, -(rad - 0.78));
      iScene.add(strap);
    }
    const armMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.5 });
    armMat._isClone = true;
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.4, 8), armMat);
    shoulder.position.set(len * 0.28, rad - 1.0, -0.4);
    shoulder.rotation.z = 0.8;
    iScene.add(shoulder);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8), armMat);
    forearm.position.set(len * 0.28 + 0.9, rad - 1.7, -0.4);
    forearm.rotation.z = -0.6;
    iScene.add(forearm);
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), armMat);
    claw.position.set(len * 0.28 + 1.35, rad - 2.1, -0.4);
    iScene.add(claw);
  } else if (arch === "depot") {
    // Fuel depot: big spherical tanks, a pipe run the length of the module, gauges.
    const tankMatI = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.4, metalness: 0.35 });
    tankMatI._isClone = true;
    for (let s = 0; s < 3; s++) {
      const tank = new THREE.Mesh(new THREE.SphereGeometry(0.85, 18, 14), tankMatI);
      tank.position.set(-len / 2 + 2 + s * (len - 3.4) / 2, -rad + 0.75, -(rad - 1.0));
      iScene.add(tank);
      const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.9, 0.2) })); // amber, blooms
      gauge.position.set(tank.position.x, tank.position.y + 1.0, -(rad - 1.05));
      
      iScene.add(gauge);
    }
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, len - 1.4, 10), tankMatI);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, rad - 0.75, -(rad - 1.0));
    iScene.add(pipe);
    for (let s = 0; s < 4; s++) { // hazard collars on the pipe
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.18, 10),
        new THREE.MeshStandardMaterial({ color: 0xd8b83a, roughness: 0.6 }));
      collar.material._isClone = true;
      collar.rotation.z = Math.PI / 2;
      collar.position.set(-len / 2 + 1.6 + s * (len - 2.4) / 3, rad - 0.75, -(rad - 1.0));
      iScene.add(collar);
    }
  } else if (arch === "garden") {
    // Greenhouse: plant rows down BOTH walls, hanging vines, grow-light bars.
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4fae54, roughness: 0.8 });
    leafMat._isClone = true;
    for (const zSide of [-1, 1]) {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(len - 2, 0.12, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x7a6a52, roughness: 0.9 }));
      bed.material._isClone = true;
      bed.position.set(0, -rad + 0.7, zSide * (rad - 0.75));
      iScene.add(bed);
      for (let i = 0; i < 14; i++) {
        const sprout = new THREE.Mesh(new THREE.SphereGeometry(0.08 + rng() * 0.1, 8, 6), leafMat);
        sprout.position.set(-len / 2 + 1.3 + i * (len - 2.4) / 14,
          -rad + 0.85 + rng() * 0.12, zSide * (rad - 0.75));
        iScene.add(sprout);
      }
    }
    for (let i = 0; i < 5; i++) { // vines hang from the ceiling — zero-g doesn't care
      const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.9 + rng() * 0.8, 6), leafMat);
      vine.position.set(-len / 2 + 2 + i * (len - 3.5) / 4, rad - 1.0, (rng() - 0.5) * 1.4);
      vine.rotation.z = (rng() - 0.5) * 0.3;
      iScene.add(vine);
    }
    for (let s = 0; s < 2; s++) { // grow-light bars: pink-white, bright enough to bloom
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len * 0.35, 0.06, 0.2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.1, 1.35) }));
      bar.position.set(-len * 0.22 + s * len * 0.44, rad - 0.7, 0);
      iScene.add(bar);
    }
  } else if (arch === "observatory") {
    // Observatory: one HUGE cupola window (nebula + a ringed world), a telescope
    // aimed through it, and dim RED lighting — astronomers guard their night eyes.
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#04070f"; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#fff";
    for (let k = 0; k < 130; k++) {
      ctx.globalAlpha = 0.4 + rng() * 0.6;
      ctx.fillRect(rng() * 128, rng() * 128, 1, 1);
    }
    ctx.globalAlpha = 0.35; // a painted nebula smear
    const neb = ctx.createRadialGradient(48, 60, 4, 48, 60, 44);
    neb.addColorStop(0, "#b06de0"); neb.addColorStop(0.6, "#3a4ac0"); neb.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = neb;
    ctx.beginPath(); ctx.arc(48, 60, 44, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#d8c89a"; // a far-off ringed world
    ctx.beginPath(); ctx.arc(96, 40, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(216,200,154,0.8)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(96, 40, 13, 4, -0.4, 0, Math.PI * 2); ctx.stroke();
    const cupola = new THREE.Mesh(new THREE.CircleGeometry(1.7, 28),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
    cupola.position.set(len * 0.12, 0.25, -rad + 0.06);
    iScene.add(cupola);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.07, 8, 30),
      new THREE.MeshStandardMaterial({ color: 0x9aa2ae, roughness: 0.7 }));
    rim.material._isClone = true;
    rim.position.copy(cupola.position);
    iScene.add(rim);
    const scopeMat = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.45 });
    scopeMat._isClone = true;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.7, 14), scopeMat);
    tube.position.set(len * 0.12 - 0.6, -0.5, -rad + 1.6);
    tube.lookAt(cupola.position.x, cupola.position.y, cupola.position.z);
    tube.rotateX(Math.PI / 2); // cylinder axis onto the look direction
    iScene.add(tube);
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 1.1, 8), scopeMat);
    mount.position.set(len * 0.12 - 0.6, -1.1, -rad + 1.6);
    iScene.add(mount);
  }

  // The RESIDENT. 👽 Friendly — big eyes like a Connie, its own glyph console,
  // and it hums in prime numbers (the Navigator explains).
  let alien = null;
  if (info.alien && !derelict) {
    alien = new THREE.Group();
    const hue = rng();
    const skin = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.55, 0.55), roughness: 0.5,
      emissive: new THREE.Color().setHSL(hue, 0.6, 0.25), emissiveIntensity: 0.7,
    });
    skin._isClone = true;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), skin);
    body.scale.y = 1.25;
    alien.add(body);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const tent = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.09, 0.7, 8), skin);
      tent.position.set(Math.cos(a) * 0.22, -0.6, Math.sin(a) * 0.22);
      tent.rotation.z = Math.cos(a) * 0.5;
      tent.rotation.x = -Math.sin(a) * 0.5;
      alien.add(tent);
    }
    for (const sx of [-1, 1]) { // big friendly eyes, Connie-style
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      white.position.set(sx * 0.17, 0.28, 0.33);
      alien.add(white);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x101418 }));
      pupil.position.set(sx * 0.17, 0.28, 0.44);
      alien.add(pupil);
    }
    alien.position.set(len * 0.32, 0.3, -0.4);
    iScene.add(alien);
    addConsole(len * 0.32 + 1.1, -0.2, "alien", new THREE.Color(1.8, 0.3, 1.6)); // glyph screen
  }

  // Light: every kind of place has its own mood. Wrecks flicker red; observatories
  // run dim red ON PURPOSE (real astronomers protect their night vision); gardens
  // glow greenhouse-bright; depots sit in workshop amber; hubs in cool freight-bay
  // white; labs keep the warm even light they always had.
  if (derelict) {
    iScene.add(new THREE.AmbientLight(0x201418, 1.2));
    const red = new THREE.PointLight(0xff3020, 30, 30, 2);
    red.position.set(-len * 0.3, 0.8, 0);
    iScene.add(red);
    interiorFlicker = red;
  } else {
    const MOOD = {
      hub: { amb: 0xe4ecf6, ambI: 1.35, pt: 0xdfe8ff, ptI: 42 },
      depot: { amb: 0xf0e2c8, ambI: 1.25, pt: 0xffc878, ptI: 44 },
      garden: { amb: 0xe8f6e2, ambI: 1.5, pt: 0xf2ffe8, ptI: 46 },
      observatory: { amb: 0x2a2430, ambI: 1.0, pt: 0xff4838, ptI: 14 },
    };
    const m = MOOD[arch] || { amb: 0xf4efe6, ambI: 1.4, pt: 0xfff0d8, ptI: 40 };
    iScene.add(new THREE.AmbientLight(m.amb, m.ambI));
    const pt = new THREE.PointLight(m.pt, m.ptI, 40, 2);
    pt.position.set(0, rad * 0.6, 0.5);
    iScene.add(pt);
    interiorFlicker = null;
  }

  // The Connie herself, floating free.
  const connie = makeConnie();
  connie.scale.setScalar(0.9);
  connie.position.set(-len * 0.3, 0, 0);
  iScene.add(connie);

  const cam = new THREE.PerspectiveCamera(70, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 100);
  cam.position.set(0, 0.25, rad * 0.85);
  cam.lookAt(0, 0, -rad * 0.4);

  const hintEl = document.createElement("div");
  hintEl.style.cssText = "position:absolute;bottom:70px;left:50%;transform:translateX(-50%);" +
    "background:rgba(12,18,34,0.86);border:1px solid #24304d;border-radius:8px;color:#9fb3da;" +
    "padding:6px 14px;font:600 13px system-ui,sans-serif;z-index:15;";
  const ARCH_LABEL = { hub: "📦 cargo hub", depot: "⛽ fuel depot", garden: "🌿 greenhouse",
    observatory: "🔭 observatory", lab: "🔬 science lab" };
  hintEl.textContent = "🐍 " + info.name + (ARCH_LABEL[arch] ? " · " + ARCH_LABEL[arch] : "") +
    " — arrows float · drift to a glowing screen for science · E to return to your ship";
  document.getElementById("app").appendChild(hintEl);

  interior = { scene: iScene, cam, connie, vel: { x: 0, y: 0 }, consoles, alien,
               keys: {}, hintEl, cb, len, rad, drifters, last: 0,
               spin: !!info.spin, ground: !!info.ground };
  if (info.spin) {
    // Centrifuge station: the ring's spin presses you to the floor — gravity you can
    // stand on. Same room, different physics; the hint teaches the difference.
    hintEl.textContent = "🐍🌀 " + info.name + " — the ring is SPINNING, you have gravity! ← → walk · ↑ jump · E to return";
    connie.position.set(-len * 0.3, -(rad - 0.95), 0); // start standing, not floating
  } else if (info.ground) {
    // Ground base: PLANET gravity — the honest kind. Walk, jump, nothing floats.
    hintEl.textContent = "🐍🏠 " + info.name + " — real ground, real gravity! ← → walk · ↑ jump · walk to a glowing screen · E to go back out";
    connie.position.set(-len * 0.3, -(rad - 0.95), 0); // standing on the floor
  }
  window.addEventListener("keydown", interiorKeyDown);
  window.addEventListener("keyup", interiorKeyUp);
  if (_renderPass) { _renderPass.scene = iScene; _renderPass.camera = cam; }
}
let interiorFlicker = null;

function exitStation() {
  if (!interior) return;
  window.removeEventListener("keydown", interiorKeyDown);
  window.removeEventListener("keyup", interiorKeyUp);
  interior.hintEl.remove();
  interior.scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { if (m.map) m.map.dispose(); if (m._isClone || m.map) m.dispose(); }
  });
  if (_renderPass) { _renderPass.scene = scene; _renderPass.camera = camera; }
  interior = null;
  interiorFlicker = null;
}

// True while any "person mode" owns time and the keys: aboard a station OR out on EVA.
// main.js freezes physics and ignores flight keys whenever this is true.
function isInside() { return !!interior || !!eva; }

function updateInterior() {
  const it = interior;
  const now = performance.now() / 1000;
  const dt = it.last ? Math.min(now - it.last, 0.05) : 0.016;
  it.last = now;
  const c = it.connie;
  const mx = it.len / 2 - 0.8, my = it.rad - 0.9;
  if (it.spin || it.ground) {
    // Centrifuge OR planet gravity: walk on the floor, jump, come back DOWN — spin
    // gravity is real gravity as far as your boots can tell (that's the whole lesson).
    const onFloor = c.position.y <= -my + 0.03;
    const want = (it.keys.ArrowRight ? 2.0 : 0) - (it.keys.ArrowLeft ? 2.0 : 0);
    it.vel.x += (want - it.vel.x) * Math.min(1, (onFloor ? 9 : 1.2) * dt);
    if (it.keys.ArrowUp && onFloor) it.vel.y = 2.6;
    it.vel.y -= 3.4 * dt;
    c.position.x += it.vel.x * dt;
    c.position.y += it.vel.y * dt;
    if (c.position.x > mx || c.position.x < -mx) { c.position.x = Math.sign(c.position.x) * mx; it.vel.x = 0; }
    if (c.position.y < -my) { c.position.y = -my; it.vel.y = 0; }
    if (c.position.y > my) { c.position.y = my; it.vel.y *= -0.4; }
  } else {
    // Zero-g drift: arrows nudge, motion coasts, walls bounce softly.
    const A = 2.2;
    if (it.keys.ArrowLeft) it.vel.x -= A * dt;
    if (it.keys.ArrowRight) it.vel.x += A * dt;
    if (it.keys.ArrowUp) it.vel.y += A * dt;
    if (it.keys.ArrowDown) it.vel.y -= A * dt;
    it.vel.x *= 0.995; it.vel.y *= 0.995;
    c.position.x += it.vel.x * dt;
    c.position.y += it.vel.y * dt;
    if (Math.abs(c.position.x) > mx) { c.position.x = Math.sign(c.position.x) * mx; it.vel.x *= -0.4; }
    if (Math.abs(c.position.y) > my) { c.position.y = Math.sign(c.position.y) * my; it.vel.y *= -0.4; }
  }
  c.rotation.z = Math.max(-0.5, Math.min(0.5, -it.vel.x * 0.4)); // lean into the drift
  c.rotation.x = Math.max(-0.4, Math.min(0.4, it.vel.y * 0.25));

  for (const d of it.drifters) { d.m.rotation.z += d.w * dt; d.m.rotation.x += d.w * 0.6 * dt; }
  if (it.alien) it.alien.position.y = 0.3 + Math.sin(now * 1.3) * 0.12; // gentle bob
  if (interiorFlicker) interiorFlicker.intensity = 18 + Math.random() * 22;

  // Camera eases along the module to keep her in frame.
  it.cam.position.x += (c.position.x * 0.7 - it.cam.position.x) * 0.04;
  it.cam.lookAt(c.position.x * 0.85, 0, -it.rad * 0.3);

  // Science: drift close to a live screen and it fires (once each per visit).
  for (const con of it.consoles) {
    if (con.done) continue;
    if (Math.hypot(c.position.x - con.x, c.position.y - con.y) < 1.15) {
      con.done = true;
      con.screen.material.color = new THREE.Color(2.0, 1.8, 0.4); // flashes gold
      if (it.cb && it.cb.onScience) it.cb.onScience(con.kind);
    }
  }
  if (composer && fancyGraphics) composer.render();
  else renderer.render(it.scene, it.cam);
}

// =====================================================================
// EVA ANYWHERE (his ask): press E undocked and the Connie herself goes OUTSIDE —
// floating on a tether in space, or walking/hopping on the ground when landed.
// Physics/time freeze while she's out (same rule as station interiors), so this is
// pure render state: the Connie moves in the frozen scene around the parked ship.
// =====================================================================
let eva = null; // { kind, connie, tether, up, walk, h, vw, vh, ox, oy, vx, vy, g, keys, hintEl, cb, last }

function evaKeyDown(e) {
  if (!eva) return;
  eva.keys[e.key] = true;
  if (e.key === "e" || e.key === "E" || e.key === "Escape") {
    const cb = eva.cb;
    exitEva();
    if (cb && cb.onExit) cb.onExit();
  }
}
function evaKeyUp(e) { if (eva) eva.keys[e.key] = false; }

function enterEva(sim, cb) {
  if (interior || eva) return;
  const kind = sim.status === "landed" ? "ground" : "space";
  const connie = makeConnie();
  connie.scale.setScalar(1.0);
  scene.add(connie);

  let up = { x: 0, y: 1 }, g = 9.81;
  if (kind === "ground" && sim.landed && BODIES[sim.landed.body]) {
    const bs = bodyStateAt(sim.landed.body, sim.time || 0);
    const rl = Math.hypot(sim.craft.pos.x - bs.pos.x, sim.craft.pos.y - bs.pos.y) || 1;
    up = { x: (sim.craft.pos.x - bs.pos.x) / rl, y: (sim.craft.pos.y - bs.pos.y) / rl };
    g = BODIES[sim.landed.body].g0 || 1;
  }

  // Space EVA gets a visible tether back to the ship (astronauts are ALWAYS clipped on).
  let tether = null;
  if (kind === "space") {
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    tether = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xf0e6c8 }));
    tether.frustumCulled = false;
    scene.add(tether);
  }

  const hintEl = document.createElement("div");
  hintEl.style.cssText = "position:absolute;bottom:70px;left:50%;transform:translateX(-50%);" +
    "background:rgba(12,18,34,0.86);border:1px solid #24304d;border-radius:8px;color:#9fb3da;" +
    "padding:6px 14px;font:600 13px system-ui,sans-serif;z-index:15;";
  hintEl.textContent = kind === "ground"
    ? "🐍 EVA — ← → walk · ↑ hop · E back inside"
    : "🐍 SPACEWALK — arrows nudge (you coast!) · the tether keeps you safe · E back inside";
  document.getElementById("app").appendChild(hintEl);

  eva = { kind, connie, tether, up, g, cb, hintEl, keys: {}, last: 0,
          walk: 3.2, h: 0, vw: 0, vh: 0,           // ground: along-surface + height
          ox: 5, oy: 3, vx: 0.4, vy: 0.15 };       // space: free drift offsets
  window.addEventListener("keydown", evaKeyDown);
  window.addEventListener("keyup", evaKeyUp);
}

function exitEva() {
  if (!eva) return;
  window.removeEventListener("keydown", evaKeyDown);
  window.removeEventListener("keyup", evaKeyUp);
  eva.hintEl.remove();
  scene.remove(eva.connie);
  disposeGroup(eva.connie);
  if (eva.tether) {
    scene.remove(eva.tether);
    eva.tether.geometry.dispose();
    eva.tether.material.dispose();
  }
  eva = null;
}

function updateEva() {
  const ev = eva;
  const now = performance.now() / 1000;
  const dt = ev.last ? Math.min(now - ev.last, 0.05) : 0.016;
  ev.last = now;
  const base = craftGroup ? craftGroup.position : _s3.set(0, 0, 0);
  const c = ev.connie;

  if (ev.kind === "ground") {
    // Walk along the surface tangent, hop against the REAL local gravity — the same
    // g0 the lander fought. Weak-world hops go high and come down slowly (Phobos!).
    const onFloor = ev.h <= 0.001;
    const want = (ev.keys.ArrowRight ? 2.2 : 0) - (ev.keys.ArrowLeft ? 2.2 : 0);
    ev.vw += (want - ev.vw) * Math.min(1, (onFloor ? 8 : 1.5) * dt);
    if (ev.keys.ArrowUp && onFloor) ev.vh = Math.min(4.5, 1.6 + ev.g * 0.35);
    ev.vh -= ev.g * dt;
    ev.h = Math.max(0, ev.h + ev.vh * dt);
    if (ev.h === 0 && ev.vh < 0) ev.vh = 0;
    ev.walk = Math.max(-70, Math.min(70, ev.walk + ev.vw * dt));
    const tx = -ev.up.y, ty = ev.up.x;
    c.position.set(
      base.x + tx * ev.walk + ev.up.x * (0.55 + ev.h),
      base.y + ty * ev.walk + ev.up.y * (0.55 + ev.h), 0.6);
    c.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), _v2.set(ev.up.x, ev.up.y, 0));
    c.rotateZ(Math.max(-0.4, Math.min(0.4, -ev.vw * 0.12))); // lean into the walk
  } else {
    // Zero-g drift: a nudge coasts forever; past the tether length it tugs you home.
    const A = 1.6, LEASH = 42;
    if (ev.keys.ArrowLeft) ev.vx -= A * dt;
    if (ev.keys.ArrowRight) ev.vx += A * dt;
    if (ev.keys.ArrowUp) ev.vy += A * dt;
    if (ev.keys.ArrowDown) ev.vy -= A * dt;
    ev.ox += ev.vx * dt;
    ev.oy += ev.vy * dt;
    const d = Math.hypot(ev.ox, ev.oy);
    if (d > LEASH) {
      const pull = (d - LEASH) * 0.5;
      ev.vx -= (ev.ox / d) * pull * dt * 4;
      ev.vy -= (ev.oy / d) * pull * dt * 4;
    }
    c.position.set(base.x + ev.ox, base.y + ev.oy, 0.6);
    c.rotation.z = Math.max(-0.6, Math.min(0.6, -ev.vx * 0.25));
    c.rotation.x = Math.max(-0.5, Math.min(0.5, ev.vy * 0.2));
    if (ev.tether) {
      const p = ev.tether.geometry.attributes.position.array;
      p[0] = base.x; p[1] = base.y + 0.5; p[2] = 0.4;
      p[3] = c.position.x; p[4] = c.position.y; p[5] = c.position.z;
      ev.tether.geometry.attributes.position.needsUpdate = true;
    }
  }
  // Only ONE Connie outside at a time — the landed decoration stands down during EVA.
  if (connieMesh) connieMesh.visible = false;
}

// ---- Disposal helper ----
function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material && obj.material._isClone) obj.material.dispose();
  });
}

// ---- Debug snapshot ----
function debug() {
  const rnd = (n) => Math.round(n * 10) / 10;
  let ndc = "n/a";
  if (craftGroup && camera) {
    const p = craftGroup.position.clone().project(camera);
    ndc = [rnd(p.x), rnd(p.y), rnd(p.z)];
  }
  return {
    mode, flightView,
    origin: [Math.round(ORIGIN.x), Math.round(ORIGIN.y)],
    craft: craftGroup ? [rnd(craftGroup.position.x), rnd(craftGroup.position.y), rnd(craftGroup.position.z)] : "NONE",
    craftHeight: rnd(craftHeight),
    cam: camera ? [rnd(camera.position.x), rnd(camera.position.y), rnd(camera.position.z)] : null,
    mapFrame: Math.round(mapFrame), mapZoom: rnd(mapZoom),
    rocketOnScreen: ndc,
    canvas: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
    sceneChildren: scene ? scene.children.length : 0,
  };
}

// Settings toggle (menu.js "Graphics"): "fast" renders without the composer —
// no bloom/post — for school laptops. Contract extension recorded in ARCHITECTURE.md.
function setQuality(q) { fancyGraphics = q !== "fast"; }

// =====================================================================
// Frozen public API — exactly the methods in ARCHITECTURE.md.
// =====================================================================
export const Render = Object.freeze({
  init,
  rebuildWorld,
  setGalaxy,
  enterStation,
  exitStation,
  enterEva,
  exitEva,
  isInside,
  buildCraftMesh,
  setMode,
  update,
  highlightSnap,
  screenToBuildIntent,
  setFlightView,
  setArrow,
  zoomMap,
  setQuality,
  spawnMeteor, // ☄️ ring-rock strikes (recorded in ARCHITECTURE.md, 2026-07-16)
  debug,
});
