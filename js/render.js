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
import { BODIES, PLANET_KEYS, bodyStateAt, dominantBody } from "./state.js";
import { PARTS } from "./mods.js"; // merged catalog: stock + the kid's mods

// ---- Module-private Three.js state (no other module touches three) ----
let renderer = null;
let scene = null;
let camera = null;
let canvas = null;

const ALL_KEYS = ["sun", ...PLANET_KEYS];
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
let headingArrow = null;   // cyan: where the nose points
let progradeArrow = null;  // green: where the ship is actually moving (vs the local world)
let targetArrow = null;    // gold: where to AIM
let showTarget = true, showHeading = true, showPrograde = true;

let craftGroup = null;
let craftHeight = 0;

let connieMesh = null;

let heatGlow = null;
let chuteCanopy = null;

let snapGhost = null;

let orbitLine = null;      // predicted orbit ellipse (THREE.Line)

let mode = "build";        // "build" | "flight"

// Floating origin (world coords, float64). All scene positions subtract this.
const ORIGIN = { x: 0, y: 0 };
const EARTH = BODIES.earth;
const R = EARTH.radius;

// Per-body looks: color, optional stripes (gas bands), rings, atmosphere halo color.
const BODY_STYLE = {
  sun:     { color: 0xffd75e, star: true },
  mercury: { color: 0x9c8e82 },
  venus:   { color: 0xe8c98e, halo: 0xf2d9a0 },
  earth:   { color: 0x2a6cc4, halo: 0x6fb4ff },
  moon:    { color: 0x9aa0a8 },
  mars:    { color: 0xc1552f, halo: 0xd98a5e },
  jupiter: { color: 0xc9a97a, stripes: ["#c9a97a", "#a8875d", "#e0c396", "#b5713f"], halo: 0xc9a97a },
  io:       { color: 0xd8c35a },  // sulfur yellow (most volcanic world in the solar system)
  europa:   { color: 0xd9e2e8 },  // cracked ice shell
  ganymede: { color: 0x9a948a },
  callisto: { color: 0x6f665c },  // the most cratered surface anywhere
  saturn:  { color: 0xd9c08a, stripes: ["#d9c08a", "#c2a86f", "#e8d5a8"], rings: true, halo: 0xd9c08a },
  titan:    { color: 0xd8a04a, halo: 0xe0b060 }, // hazy orange — air thicker than Earth's
  uranus:  { color: 0x9ad4d6, halo: 0x9ad4d6 },
  neptune: { color: 0x3f66d4, halo: 0x5f86e4 },
};

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

// ---- Reusable scratch objects (avoid per-frame allocation) ----
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// ---- Materials (created once in init) ----
let MAT = null;
function makeMaterials() {
  const m = (color, metalness, roughness) => new THREE.MeshStandardMaterial({
    color, metalness, roughness, emissive: color, emissiveIntensity: 0.35,
  });
  MAT = {
    engine: m(0x4a5058, 0.5, 0.4),
    tank: m(0xdfe3ea, 0.1, 0.6),
    pod: m(0xff8a3d, 0.2, 0.5),
    decoupler: m(0x8a8f99, 0.3, 0.5),
    fin: m(0xc24b3a, 0.1, 0.7),
    chute: m(0xe8564a, 0.05, 0.8),
    generic: m(0xb6c0d0, 0.2, 0.6),
  };
}

function materialForPart(def) {
  if (!MAT) makeMaterials();
  switch (def.type) {
    case "engine": return MAT.engine;
    case "tank": return MAT.tank;
    case "command": return MAT.pod;
    case "decoupler": return MAT.decoupler;
    case "fin": return MAT.fin;
    case "chute": return MAT.chute;
    default: return MAT.generic;
  }
}

// Horizontal-band canvas texture for gas giants (latitude stripes on the sphere's V axis).
function stripeTexture(colors) {
  const cv = document.createElement("canvas");
  cv.width = 8; cv.height = 128;
  const ctx = cv.getContext("2d");
  const bandCount = 9;
  for (let i = 0; i < bandCount; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(0, Math.floor((i / bandCount) * 128), 8, Math.ceil(128 / bandCount));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// =====================================================================
// Render.init — scene, camera, lights, starfield, the whole solar system.
// =====================================================================
function init(canvasEl) {
  canvas = canvasEl;
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05070f, 1);

  scene = new THREE.Scene();

  // Far plane must contain the whole zoomed-out solar system (Neptune at 4.5e11 m).
  camera = new THREE.PerspectiveCamera(55, 1, 1, 5e12);
  camera.position.set(0, 12, 12);
  camera.lookAt(0, 0, 0);

  // Sunlight comes FROM THE SUN's direction: a DirectionalLight re-aimed every frame from
  // the Sun's scene position toward the craft (a PointLight at astronomical distance won't
  // survive three's physical falloff — planets rendered black). Same brightness everywhere,
  // a kid-friendly exposure setting; plus soft fill so night sides aren't void-black.
  sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
  sunLight.target.position.set(0, 0, 0); // the craft rides the scene origin in flight
  scene.add(sunLight);
  scene.add(sunLight.target);
  scene.add(new THREE.AmbientLight(0x404a66, 0.7));
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x202830, 0.5));

  // Starfield — screen-size points on a huge shell centered on the floating origin
  // (the craft), so the stars are always around you no matter where you fly.
  scene.add(makeStarfield());

  // Build every body: the Sun, the planets, the Moon.
  for (const key of ALL_KEYS) bodyGroups[key] = makeBodyGroup(key);
  for (const key of PLANET_KEYS) orbitRings[key] = makeOrbitRing(key);

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

  // Map dots + name labels for every body (the real spheres are sub-pixel at system zoom).
  for (const key of ALL_KEYS) {
    const style = BODY_STYLE[key];
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: style.color })
    );
    dot.frustumCulled = false;
    dot.visible = false;
    scene.add(dot);
    const label = makeTextSprite(BODIES[key].name, "#" + style.color.toString(16).padStart(6, "0"));
    scene.add(label);
    mapDots[key] = { dot, label };
  }

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

// One body: sphere (+ stripes for gas giants), optional atmosphere halo, optional rings.
// Group positioned per frame at bodyStateAt(key) - ORIGIN. Hidden in build mode.
function makeBodyGroup(key) {
  const b = BODIES[key];
  const style = BODY_STYLE[key];
  const g = new THREE.Group();

  const detail = key === "earth" ? [96, 64] : [48, 32];
  let mat;
  if (style.star) {
    // The Sun glows by itself — it IS the light source.
    mat = new THREE.MeshBasicMaterial({ color: style.color });
  } else if (style.stripes) {
    mat = new THREE.MeshStandardMaterial({
      map: stripeTexture(style.stripes), roughness: 0.9, metalness: 0,
      emissive: style.color, emissiveIntensity: 0.22,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: style.color, roughness: 0.95, metalness: 0,
      emissive: style.color, emissiveIntensity: key === "moon" ? 0.12 : 0.18,
    });
  }
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(b.radius, detail[0], detail[1]), mat);
  g.add(mesh);

  if (style.star) {
    // Soft additive glow sprite so the Sun reads as blinding, not a yellow ball.
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const ctx = cv.getContext("2d");
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,235,170,0.9)");
    grad.addColorStop(0.4, "rgba(255,200,90,0.35)");
    grad.addColorStop(1, "rgba(255,180,60,0)");
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
    // Saturn's rings: flat annulus, tilted so it reads in both follow and map views.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(b.radius * 1.25, b.radius * 2.3, 96),
      new THREE.MeshBasicMaterial({
        color: 0xcdbb96, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = 0.45; // tilt out of the orbital plane
    g.add(ring);
  }

  g.visible = false; // shown in flight
  scene.add(g);
  return g;
}

// Circle tracing a body's orbit, centered on its PARENT (positioned per frame).
function makeOrbitRing(key) {
  const b = BODIES[key];
  const SEG = 256;
  const positions = new Float32Array((SEG + 1) * 3);
  for (let i = 0; i <= SEG; i++) {
    const t = (i / SEG) * Math.PI * 2;
    positions[i * 3 + 0] = b.orbitRadius * Math.cos(t);
    positions[i * 3 + 1] = b.orbitRadius * Math.sin(t);
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
  const padGeo = new THREE.CylinderGeometry(1.8, 2.2, 0.5, 24);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.9 });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.position.y = 0.25;
  g.add(pad);
  return g;
}

function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h); // updateStyle=true (see HANDOFF gotchas)
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}

// =====================================================================
// Build-mode drag-orbit camera controls
// =====================================================================
function attachBuildControls() {
  if (!canvas) return;
  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "build") return;
    buildCam.dragging = true;
    buildCam.lastX = e.clientX;
    buildCam.lastY = e.clientY;
  });
  window.addEventListener("pointerup", () => { buildCam.dragging = false; });
  window.addEventListener("pointermove", (e) => {
    if (!buildCam.dragging || mode !== "build") return;
    const dx = e.clientX - buildCam.lastX;
    const dy = e.clientY - buildCam.lastY;
    buildCam.lastX = e.clientX;
    buildCam.lastY = e.clientY;
    buildCam.azimuth -= dx * 0.01;
    buildCam.elevation += dy * 0.01;
    const lim = Math.PI / 2 - 0.05;
    buildCam.elevation = Math.max(-lim, Math.min(lim, buildCam.elevation));
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
  craftHeight = 0;

  if (!craft || !craft.parts || craft.parts.length === 0) {
    return;
  }

  const defs = resolveDefs(craft);
  if (defs.length === 0) return;

  let total = 0;
  for (const d of defs) total += (d.height || 0);
  craftHeight = total;

  const group = new THREE.Group();

  let cursor = -total / 2;
  for (const def of defs) {
    const h = def.height || 1;
    const r = def.radius || 0.5;
    const cy = cursor + h / 2;
    const partObj = makePartObject(def, h, r);
    partObj.position.y = cy;
    group.add(partObj);
    cursor += h;
  }

  craftGroup = group;
  scene.add(group);

  if (snapGhost) snapGhost.visible = false;
}

function resolveDefs(craft) {
  const out = [];
  for (const inst of craft.parts) {
    const def = PARTS.find((p) => p.id === inst.partId);
    if (def) out.push(def);
  }
  return out;
}

function makePartObject(def, h, r) {
  const mat = materialForPart(def);
  switch (def.shape) {
    case "cone": {
      const geo = new THREE.ConeGeometry(r, h, 24);
      return new THREE.Mesh(geo, mat);
    }
    case "cylinder": {
      const geo = new THREE.CylinderGeometry(r, r, h, 24);
      return new THREE.Mesh(geo, mat);
    }
    case "nozzle": {
      const geo = new THREE.CylinderGeometry(r * 0.55, r, h, 24, 1, true);
      const bellMat = mat.clone();
      bellMat._isClone = true;
      bellMat.side = THREE.DoubleSide;
      return new THREE.Mesh(geo, bellMat);
    }
    case "chute": {
      const grp = new THREE.Group();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.75, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      dome.scale.y = h / (r * 0.75);
      dome.position.y = -h / 2;
      grp.add(dome);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.76, r * 0.76, h * 0.22, 20),
        MAT ? MAT.tank : mat);
      band.position.y = -h / 2 + h * 0.11;
      grp.add(band);
      return grp;
    }
    case "fin": {
      const grp = new THREE.Group();
      const finGeo = new THREE.BoxGeometry(r * 1.2, h, 0.08);
      const fin = new THREE.Mesh(finGeo, mat);
      fin.position.x = r * 0.9;
      grp.add(fin);
      const fin2 = fin.clone();
      fin2.position.x = -r * 0.9;
      grp.add(fin2);
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
  } else {
    if (launchpad) launchpad.visible = false;
    if (ground) ground.visible = false;
    if (connieMesh) connieMesh.visible = false;
    if (orbitLine) orbitLine.visible = true;
    flightView = "follow";
    followZoom = 1; // every launch starts framed on the rocket
  }
}

function hideMapDots() {
  for (const key of ALL_KEYS) {
    if (mapDots[key]) { mapDots[key].dot.visible = false; mapDots[key].label.visible = false; }
  }
}

// =====================================================================
// Render.update — per-frame placement, camera, orbit ellipse, draw.
// =====================================================================
function update(sim) {
  if (!renderer || !scene || !camera) return;

  if (mode === "build") {
    updateBuildCamera();
  } else {
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

  renderer.render(scene, camera);
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

  if (craftGroup) {
    craftGroup.position.set(0, 0, 0);
    craftGroup.rotation.set(0, 0, angle);
  }

  // Reentry glow.
  if (heatGlow) {
    const heat = sim.heat || 0;
    if (heat > 0.06 && sim.status !== "landed" && sim.status !== "crashed") {
      const size = Math.max(2.5, craftHeight * (0.8 + heat * 1.2));
      heatGlow.position.set(0, 0, 0);
      heatGlow.scale.set(size, size * 1.35, size);
      heatGlow.rotation.z = angle;
      heatGlow.material.opacity = Math.min(0.85, heat * 1.1);
      heatGlow.material.color.setHSL(0.07, 1.0, 0.5 + heat * 0.35);
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
      chuteCanopy.position.set(ux * craftHeight * 0.5, uy * craftHeight * 0.5, 0);
      chuteCanopy.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), _v2.set(ux, uy, 0).normalize());
      chuteCanopy.visible = true;
    } else {
      chuteCanopy.visible = false;
    }
  }

  // Landed EVA: the Connie stands beside the ship on WHATEVER world she landed on.
  if (connieMesh) {
    if (sim.status === "landed" && sim.landed && states[sim.landed.body]) {
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

  // Follow-cam: a little behind/above the craft. "Up" = radial from the dominant body.
  // The camera tips gently toward the local world, but THE ROCKET MUST NEVER LEAVE THE
  // FRAME (the first public play-test lost it seconds after launch): the tilt is capped
  // at ~0.4x the camera distance, which keeps the craft within ~18° of the view axis.
  // To see the whole planet from up high, scroll out — follow view zooms now too.
  const rl = Math.hypot(dom.rel.x, dom.rel.y);
  const radial = _v2.set(dom.rel.x, dom.rel.y, 0);
  if (rl > 0.5) radial.multiplyScalar(1 / rl); else radial.set(0, 1, 0);

  const camDist = Math.max(20, craftHeight * 4 + 30) * followZoom;
  followDist = camDist; // arrows scale with it so guides stay readable zoomed out
  camera.position.set(radial.x * camDist * 0.35, radial.y * camDist * 0.35, camDist);
  camera.up.copy(radial);
  const distSurface = Math.max(0, rl - dom.body.radius);
  const L = Math.min(distSurface * 0.8, camDist * 0.4);
  camera.lookAt(-radial.x * L, -radial.y * L, 0);
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

  // Body dots + labels — never smaller than the true sphere (zoomed close, reality wins).
  for (const key of ALL_KEYS) {
    const b = BODIES[key];
    const st = states[key];
    const { dot, label } = mapDots[key];
    const sx = st.pos.x - ORIGIN.x, sy = st.pos.y - ORIGIN.y;
    const size = Math.max(b.radius, mapFrame * (key === "sun" ? 0.02 : 0.012));
    dot.visible = true;
    dot.position.set(sx, sy, mapFrame * 0.012);
    dot.scale.setScalar(size);
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
  const bodyR = o.bodyRadius || R;
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
  if (flightView === "map") { mapFrame = 0; mapBase = 0; } // recompute auto-fit; keep user zoom
  else {
    if (mapMarker) mapMarker.visible = false;
    hideMapDots();
  }
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

// =====================================================================
// Frozen public API — exactly the methods in ARCHITECTURE.md.
// =====================================================================
export const Render = Object.freeze({
  init,
  buildCraftMesh,
  setMode,
  update,
  highlightSnap,
  screenToBuildIntent,
  setFlightView,
  setArrow,
  zoomMap,
  debug,
});
