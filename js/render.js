// render.js — Three.js renderer. Owns ALL Three.js. API frozen in ../ARCHITECTURE.md.
// Coordinate conventions (from ARCHITECTURE.md):
//   - Physics is planar 2D {x,y} in meters; world origin = Earth center.
//   - Render lifts 2D -> 3D as (x, y, 0); the orbital plane is the XY plane.
//   - Craft angle is radians, 0 = pointing along +Y, increasing CCW (rotation about +Z).
//   - Units are meters. Earth radius is large (~637 km in forgiving mode).
import * as THREE from "three";
import { BODIES, moonStateAt } from "./state.js";
import { PARTS } from "./mods.js"; // merged catalog: stock + the kid's mods (same shape as parts.js)

// ---- Module-private Three.js state (no other module touches three) ----
let renderer = null;
let scene = null;
let camera = null;
let canvas = null;

let earthMesh = null;
let atmosphereMesh = null;
let moonMesh = null;       // the Moon — a second world, orbits Earth (positioned per frame)
let moonOrbitLine = null;  // faint ring tracing the Moon's path around Earth
let launchpad = null;
let ground = null;         // build-mode ground plane (so the pad isn't floating in stars)
let mapMarker = null;      // bright dot marking the craft in map view
let moonMapDot = null;     // grey dot marking the Moon in map view (the real Moon is sub-pixel
                           // when zoomed out to the whole system — 173 km in a 38,000 km frame)
let moonMapLabel = null;   // "Moon" label sprite beside the dot
let flightView = "follow"; // "follow" | "map"
let mapFrame = 0;          // map-view scale actually used this frame (base * user zoom)
let mapBase = 0;           // auto-fit scale (grow-only): keeps Earth + ship + orbit in view
let mapZoom = 1;           // user zoom: >1 = zoomed OUT (toward the Moon), <1 = zoomed IN
let headingArrow = null;   // cyan: where the nose points
let progradeArrow = null;  // green: where the ship is actually moving
let targetArrow = null;    // gold: where to AIM (gravity-turn director)
let showTarget = true, showHeading = true, showPrograde = true; // per-arrow visibility toggles

let craftGroup = null;     // current rocket THREE.Group (null if 0 parts)
let craftHeight = 0;       // total stacked height of current craft (meters)

let connieMesh = null;     // the Connie (snake astronaut). Beside the pad in build mode;
                           // comes out for an EVA next to the craft when landed.

let heatGlow = null;       // reentry plasma glow around the craft (opacity/size from sim.heat)
let chuteCanopy = null;    // deployed parachute canopy (shown when sim.chuteOpen)

let snapGhost = null;      // translucent attach indicator (build mode)

let orbitLine = null;      // predicted orbit ellipse (THREE.Line)

let mode = "build";        // "build" | "flight"

const EARTH = BODIES.earth;
const R = EARTH.radius;
const MOON = BODIES.moon;

// ---- Simple mouse-drag orbit camera for build mode (self-contained, no addons) ----
const buildCam = {
  // spherical offset around the rocket target
  azimuth: Math.PI * 0.25,   // around +Y
  elevation: 0.25,           // tilt up from horizon (radians)
  distance: 12,              // meters from target — close so a few-meter rocket is visible
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
  // Low metalness (no env map to reflect, else metals render black) + self-lit emissive so
  // parts are always visible against black space regardless of lighting angle.
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

// =====================================================================
// Render.init — scene, camera, lights, starfield, Earth + atmosphere.
// =====================================================================
function init(canvasEl) {
  canvas = canvasEl;
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05070f, 1);

  scene = new THREE.Scene();

  // Logarithmic-friendly near/far: rocket is ~10m, planet is ~640km, orbits ~1000km+.
  camera = new THREE.PerspectiveCamera(55, 1, 1, 1e9);
  camera.position.set(0, R + 12, 12);
  camera.lookAt(0, R, 0);

  // Lighting: sun-like directional + soft ambient.
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(1, 0.6, 0.8).normalize();
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x404a66, 0.9));
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x202830, 0.6)); // soft sky/ground fill

  // Starfield — lots of points on a huge sphere shell. Cosmetic random is fine.
  scene.add(makeStarfield());

  // Earth: blue sphere of radius R centered at origin (physics origin = Earth center).
  const earthGeo = new THREE.SphereGeometry(R, 96, 64);
  const earthMat = new THREE.MeshStandardMaterial({
    color: 0x2a6cc4, roughness: 0.95, metalness: 0.0, emissive: 0x06122a, emissiveIntensity: 0.4,
  });
  earthMesh = new THREE.Mesh(earthGeo, earthMat);
  scene.add(earthMesh);

  // Faint atmosphere shell — slightly larger, additive, backside so it reads as a halo.
  const atmoR = R + (EARTH.atmosphere ? EARTH.atmosphere.height : R * 0.02);
  const atmoGeo = new THREE.SphereGeometry(atmoR, 96, 64);
  const atmoMat = new THREE.MeshBasicMaterial({
    color: 0x6fb4ff, transparent: true, opacity: 0.12,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  atmosphereMesh = new THREE.Mesh(atmoGeo, atmoMat);
  scene.add(atmosphereMesh);

  // The Moon — a second world to fly to (Phase 2). Real-to-scale: ~60 Earth-radii out and
  // ~0.5° wide seen from low orbit, just like the real Moon. Positioned each frame from
  // moonStateAt(sim.time); it rides a fixed circular orbit. Grey, cratered, no atmosphere.
  const moonGeo = new THREE.SphereGeometry(MOON.radius, 64, 48);
  const moonMat = new THREE.MeshStandardMaterial({
    color: 0x9aa0a8, roughness: 1.0, metalness: 0.0, emissive: 0x15171c, emissiveIntensity: 0.5,
  });
  moonMesh = new THREE.Mesh(moonGeo, moonMat);
  moonMesh.visible = false; // shown in flight only
  scene.add(moonMesh);

  // Faint ring tracing the Moon's orbit so it reads as a destination, not a stray dot.
  moonOrbitLine = makeMoonOrbit(MOON.orbitRadius);
  moonOrbitLine.visible = false;
  scene.add(moonOrbitLine);

  // Simple launchpad at the surface (top of Earth, +Y).
  launchpad = makeLaunchpad();
  launchpad.position.set(0, R, 0);
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

  // Deployed parachute: red/white canopy dome + shroud lines, positioned above the craft
  // (opposite the velocity) while sim.chuteOpen. Built once, repositioned per frame.
  chuteCanopy = makeChuteCanopy();
  chuteCanopy.visible = false;
  scene.add(chuteCanopy);

  // Build-mode ground: a large flat disc at y=0 so the pad rests on a surface (night sky
  // above, ground below) instead of floating in stars. Hidden during flight.
  const groundGeo = new THREE.CircleGeometry(2000, 64);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x232c3c, roughness: 1, metalness: 0, side: THREE.DoubleSide,
  });
  ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2; // lie flat in the XZ plane at y=0
  ground.position.y = 0;
  ground.visible = false;
  scene.add(ground);

  // Map-view marker: a bright dot we scale up so the craft is visible from far away.
  mapMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb347 })
  );
  mapMarker.frustumCulled = false;
  mapMarker.visible = false;
  scene.add(mapMarker);

  // Direction arrows: green = prograde (where you're going), cyan = heading (where the nose points).
  // Lining them up is the gravity turn. Shown in both flight views, sized per view each frame.
  const UP = new THREE.Vector3(0, 1, 0);
  progradeArrow = new THREE.ArrowHelper(UP, new THREE.Vector3(), 1, 0x6effa0, 0.35, 0.25);
  headingArrow = new THREE.ArrowHelper(UP, new THREE.Vector3(), 1, 0x6fd0ff, 0.35, 0.25);
  targetArrow = new THREE.ArrowHelper(UP, new THREE.Vector3(), 1, 0xffd24a, 0.35, 0.25); // gold "aim here"
  for (const a of [progradeArrow, headingArrow, targetArrow]) { a.frustumCulled = false; a.visible = false; scene.add(a); }

  makeMaterials();

  // Resize handling.
  window.addEventListener("resize", onResize);
  onResize();

  // Build-mode drag-orbit controls.
  attachBuildControls();
}

function makeStarfield() {
  const COUNT = 4000;
  const positions = new Float32Array(COUNT * 3);
  // Far beyond Earth AND the Moon (else the Moon renders amongst the stars), inside far plane.
  const shell = Math.max(R * 60, MOON.orbitRadius * 1.5);
  for (let i = 0; i < COUNT; i++) {
    // Random direction on a sphere (cosmetic — Math.random acceptable for stars).
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const x = s * Math.cos(theta);
    const y = s * Math.sin(theta);
    const z = u;
    positions[i * 3 + 0] = x * shell;
    positions[i * 3 + 1] = y * shell;
    positions[i * 3 + 2] = z * shell;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: R * 0.06, sizeAttenuation: true, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// A flat circle in the XY plane (Earth-centered) tracing the Moon's orbit.
function makeMoonOrbit(radius) {
  const SEG = 256;
  const positions = new Float32Array((SEG + 1) * 3);
  for (let i = 0; i <= SEG; i++) {
    const t = (i / SEG) * Math.PI * 2;
    positions[i * 3 + 0] = radius * Math.cos(t);
    positions[i * 3 + 1] = radius * Math.sin(t);
    positions[i * 3 + 2] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x555f70, transparent: true, opacity: 0.35 });
  const line = new THREE.LineLoop(geo, mat);
  line.frustumCulled = false;
  return line;
}

// A Connie: coiled green snake, head up, inside a clear bubble helmet (his design).
// Built from primitives, ~1.6 m tall, base of the coil at the group's y=0.
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

  // Coiled body: three stacked rings, wide at the bottom.
  const coils = [
    { R: 0.42, tube: 0.155, y: 0.15 },
    { R: 0.30, tube: 0.135, y: 0.42 },
    { R: 0.19, tube: 0.115, y: 0.64 },
  ];
  for (const c of coils) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(c.R, c.tube, 12, 28), snakeMat);
    ring.rotation.x = Math.PI / 2; // lie flat (hole pointing up)
    ring.position.y = c.y;
    g.add(ring);
  }

  // Neck rising out of the coil, leaning slightly forward (+Z = her front).
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.13, 0.55, 14), snakeMat);
  neck.position.set(0, 0.95, 0.05);
  neck.rotation.x = 0.18;
  g.add(neck);

  // Head + snout.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 18, 14), snakeMat);
  head.position.set(0, 1.26, 0.12);
  g.add(head);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.10, 14, 10), bellyMat);
  snout.position.set(0, 1.22, 0.24);
  g.add(snout);

  // Eyes — big and friendly, looking forward.
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

  // Forked tongue — a thin red sliver, because of course.
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.14), new THREE.MeshBasicMaterial({ color: 0xd03a4a }));
  tongue.position.set(0, 1.18, 0.34);
  g.add(tongue);

  // Bubble helmet: clear sphere around the head, on a white suit collar.
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
  // Little backpack (life support) behind the neck.
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.12), suitMat);
  pack.position.set(0, 0.86, -0.18);
  g.add(pack);

  return g;
}

// Deployed parachute canopy: hemisphere dome, alternating red/white gores suggested by a
// striped second shell, plus shroud lines converging to the group's origin (the craft).
function makeChuteCanopy() {
  const g = new THREE.Group();
  const RIG = 7;    // shroud line length: canopy rim sits this far up
  const RAD = 4.5;  // canopy radius
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0xe8564a, metalness: 0, roughness: 0.9, side: THREE.DoubleSide,
    emissive: 0x772620, emissiveIntensity: 0.45,
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(RAD, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.y = RIG;
  g.add(dome);
  // White stripe band near the rim (reads as gores from a distance).
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xf2f4f8, metalness: 0, roughness: 0.9, side: THREE.DoubleSide,
    emissive: 0x6a6f78, emissiveIntensity: 0.4,
  });
  const stripe = new THREE.Mesh(
    new THREE.SphereGeometry(RAD * 1.01, 24, 3, 0, Math.PI * 2, Math.PI * 0.30, Math.PI * 0.12), stripeMat);
  stripe.position.y = RIG;
  g.add(stripe);
  // Shroud lines from craft (origin) to the canopy rim.
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

// Place the Connie standing on a surface: feet (coil base) at `basePos`, body up along `up`.
function placeConnie(basePos, up) {
  if (!connieMesh) return;
  connieMesh.position.copy(basePos);
  connieMesh.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), _v2.copy(up).normalize());
  connieMesh.visible = true;
}

function makeLaunchpad() {
  const g = new THREE.Group();
  // Small pad sized for a few-meter rocket (NOT a 14m slab that fills the view).
  const padGeo = new THREE.CylinderGeometry(1.8, 2.2, 0.5, 24);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.9 });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.position.y = 0.25; // pad top at y=0.5
  g.add(pad);
  return g;
}

function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h); // updateStyle=true: sets canvas CSS size to match the window
  // (was setSize(w,h,false): buffer set but display size left at 2x, overflowing bottom-right)
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
    } else if (mode === "flight" && flightView === "map") {
      // Scroll to zoom the map: down/away = zoom out (toward the Moon), up = zoom in.
      e.preventDefault();
      zoomMap(Math.exp(e.deltaY * 0.0015));
    }
  }, { passive: false });
}

// =====================================================================
// Render.buildCraftMesh — (re)build rocket Group, bottom->top, centered.
// =====================================================================
function buildCraftMesh(craft) {
  // Remove previous group.
  if (craftGroup) {
    scene.remove(craftGroup);
    disposeGroup(craftGroup);
    craftGroup = null;
  }
  craftHeight = 0;

  if (!craft || !craft.parts || craft.parts.length === 0) {
    return; // robust: 0 parts -> no mesh
  }

  // Resolve PartDefs: each PartInstance carries partId; look up in the PARTS catalog.
  const defs = resolveDefs(craft);
  if (defs.length === 0) return;

  // Total height for centering.
  let total = 0;
  for (const d of defs) total += (d.height || 0);
  craftHeight = total;

  const group = new THREE.Group();

  // Stack bottom->top along +Y. parts[0] = bottom. Center the whole stack on origin.
  let cursor = -total / 2; // y of the bottom face of current part
  for (const def of defs) {
    const h = def.height || 1;
    const r = def.radius || 0.5;
    const cy = cursor + h / 2; // center of this part
    const partObj = makePartObject(def, h, r);
    partObj.position.y = cy;
    group.add(partObj);
    cursor += h;
  }

  craftGroup = group;
  scene.add(group);

  // Reset snap ghost position relative to new stack top.
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

// Build the THREE.Object3D for one part based on its shape.
function makePartObject(def, h, r) {
  const mat = materialForPart(def);
  switch (def.shape) {
    case "cone": {
      // Pod / nose cone: cone pointing +Y.
      const geo = new THREE.ConeGeometry(r, h, 24);
      return new THREE.Mesh(geo, mat);
    }
    case "cylinder": {
      const geo = new THREE.CylinderGeometry(r, r, h, 24);
      return new THREE.Mesh(geo, mat);
    }
    case "nozzle": {
      // Engine bell: cylinder tapering wider at the BOTTOM (narrow top, flared bottom).
      // CylinderGeometry(radiusTop, radiusBottom, height). Open-ended -> render both sides.
      const geo = new THREE.CylinderGeometry(r * 0.55, r, h, 24, 1, true);
      const bellMat = mat.clone();
      bellMat._isClone = true;
      bellMat.side = THREE.DoubleSide;
      return new THREE.Mesh(geo, bellMat);
    }
    case "chute": {
      // Packed parachute: a small red-and-white striped dome canister on the pod's tip.
      const grp = new THREE.Group();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.75, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      dome.scale.y = h / (r * 0.75); // stretch hemisphere to the part height
      dome.position.y = -h / 2;      // dome base at the part's bottom face
      grp.add(dome);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.76, r * 0.76, h * 0.22, 20),
        MAT ? MAT.tank : mat);
      band.position.y = -h / 2 + h * 0.11;
      grp.add(band);
      return grp;
    }
    case "fin": {
      // Thin triangular-ish fin attached to the side. Use a thin box offset on +X.
      const grp = new THREE.Group();
      const finGeo = new THREE.BoxGeometry(r * 1.2, h, 0.08);
      const fin = new THREE.Mesh(finGeo, mat);
      // Offset so the inner edge sits near the stack surface, fin sticks out on +X.
      fin.position.x = r * 0.9;
      grp.add(fin);
      // Mirror on -X so it reads as a pair (cosmetic stabilizers).
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
  if (mode === "build") {
    // Build happens near the ORIGIN against the stars (Earth hidden) so the framing is
    // robust regardless of planet scale — at the surface (y~637000) precision/framing break.
    // Rocket rests on a small pad with its bottom at the pad top (~1.2m).
    if (earthMesh) earthMesh.visible = false;
    if (atmosphereMesh) atmosphereMesh.visible = false;
    if (moonMesh) moonMesh.visible = false;
    if (moonOrbitLine) moonOrbitLine.visible = false;
    if (launchpad) { launchpad.visible = true; launchpad.position.set(0, 0, 0); }
    if (ground) ground.visible = true;
    // Connie waits beside the pad, watching you build her ride.
    if (connieMesh) {
      connieMesh.position.set(2.7, 0, 1.4);
      connieMesh.quaternion.identity();
      connieMesh.rotation.y = -0.5; // angled toward the rocket
      connieMesh.visible = true;
    }
    const baseY = 0.2; // seat the rocket onto the pad (pad top ~0.5; slight overlap looks planted)
    if (craftGroup) {
      craftGroup.position.set(0, baseY + craftHeight / 2, 0);
      craftGroup.rotation.set(0, 0, 0);
      buildCam.target.set(0, baseY + craftHeight / 2, 0);
    } else {
      buildCam.target.set(0, baseY + 1, 0);
    }
    // Frame the rocket up close.
    buildCam.distance = Math.max(8, craftHeight * 2.2 + 6);
    if (orbitLine) orbitLine.visible = false;
    if (heatGlow) heatGlow.visible = false;
    if (chuteCanopy) chuteCanopy.visible = false;
    if (mapMarker) mapMarker.visible = false;
    if (moonMapDot) { moonMapDot.visible = false; moonMapLabel.visible = false; }
    if (progradeArrow) progradeArrow.visible = false;
    if (headingArrow) headingArrow.visible = false;
    if (targetArrow) targetArrow.visible = false;
  } else {
    // Flight: show the planet again; the launchpad would overlap the craft at the surface.
    if (earthMesh) earthMesh.visible = true;
    if (atmosphereMesh) atmosphereMesh.visible = true;
    if (moonMesh) moonMesh.visible = true;
    if (moonOrbitLine) moonOrbitLine.visible = true;
    if (launchpad) launchpad.visible = false;
    if (ground) ground.visible = false;
    if (connieMesh) connieMesh.visible = false; // she's inside the capsule now
    if (orbitLine) orbitLine.visible = true;
    flightView = "follow"; // launches start in follow-cam
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

  // Predicted orbit ellipse (only when sim.orbit exists and we're in flight).
  if (mode === "flight" && sim && sim.orbit) {
    updateOrbitLine(sim);
  } else {
    if (orbitLine) orbitLine.visible = false;
    if (apMarker) apMarker.visible = false;
    if (peMarker) peMarker.visible = false;
  }

  // Transfer "Burn" marker: gold dot on the current orbit where the Moon burn should start
  // (map view only — that's where you plan the trip). main.js fills sim.transfer each frame
  // from Physics.transferWindow; null means no guidance (wrong orbit / already going).
  updateBurnMarker(sim);

  renderer.render(scene, camera);
}

function updateBuildCamera() {
  // Spherical -> Cartesian offset around the build target.
  const ce = Math.cos(buildCam.elevation);
  const se = Math.sin(buildCam.elevation);
  const ca = Math.cos(buildCam.azimuth);
  const sa = Math.sin(buildCam.azimuth);
  const d = buildCam.distance;
  const ox = d * ce * sa;
  const oy = d * se;
  const oz = d * ce * ca;
  camera.position.set(
    buildCam.target.x + ox,
    buildCam.target.y + oy,
    buildCam.target.z + oz
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(buildCam.target);
}

function updateFlight(sim) {
  if (!sim || !sim.craft) return;
  const px = sim.craft.pos.x;
  const py = sim.craft.pos.y;
  const angle = sim.craft.angle || 0;

  // Place the Moon for this instant (rides its fixed circular orbit around Earth).
  if (moonMesh) {
    const m = moonStateAt(sim.time || 0);
    moonMesh.position.set(m.pos.x, m.pos.y, 0);
  }

  if (craftGroup) {
    // Place craft: 2D -> 3D as (x, y, 0).
    craftGroup.position.set(px, py, 0);
    // Rotate by angle about Z so local +Y aligns with craft facing.
    craftGroup.rotation.set(0, 0, angle);
  }

  // Reentry glow: fades in with sim.heat, hugs the craft, stretches slightly along velocity.
  if (heatGlow) {
    const heat = sim.heat || 0;
    if (heat > 0.06 && sim.status !== "landed" && sim.status !== "crashed") {
      const size = Math.max(2.5, craftHeight * (0.8 + heat * 1.2));
      heatGlow.position.set(px, py, 0);
      heatGlow.scale.set(size, size * 1.35, size);
      heatGlow.rotation.z = angle; // stretch roughly along the hull
      heatGlow.material.opacity = Math.min(0.85, heat * 1.1);
      // shift color orange -> white-hot as heat climbs
      heatGlow.material.color.setHSL(0.07, 1.0, 0.5 + heat * 0.35);
      heatGlow.visible = true;
    } else {
      heatGlow.visible = false;
    }
  }

  // Open parachute: canopy above the craft, pointing opposite the velocity (or radially up
  // when nearly stopped), anchored at the craft's top.
  if (chuteCanopy) {
    if (sim.chuteOpen && sim.status !== "landed" && sim.status !== "crashed") {
      const v = sim.craft.vel, vm = Math.hypot(v.x, v.y);
      let ux, uy;
      if (vm > 3) { ux = -v.x / vm; uy = -v.y / vm; }
      else { const rm = Math.hypot(px, py) || 1; ux = px / rm; uy = py / rm; }
      chuteCanopy.position.set(px + ux * craftHeight * 0.5, py + uy * craftHeight * 0.5, 0);
      chuteCanopy.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), _v2.set(ux, uy, 0).normalize());
      chuteCanopy.visible = true;
    } else {
      chuteCanopy.visible = false;
    }
  }

  // Landed EVA: the Connie comes out and stands beside the ship (the reward moment).
  if (connieMesh) {
    if (sim.status === "landed") {
      // Local "up" = radial from whichever body she's standing on.
      let bx = 0, by = 0;
      if (sim.landed && sim.landed.body === "moon") {
        const m = moonStateAt(sim.time || 0);
        bx = m.pos.x; by = m.pos.y;
      }
      const rl = Math.hypot(px - bx, py - by) || 1;
      const ux = (px - bx) / rl, uy = (py - by) / rl;
      // Stand 3 m to the side of the craft (along the surface tangent), feet at craft's radius.
      placeConnie(
        new THREE.Vector3(px + -uy * 3.0, py + ux * 3.0, 0),
        new THREE.Vector3(ux, uy, 0)
      );
    } else {
      connieMesh.visible = false;
    }
  }

  if (flightView === "map") {
    updateMapCamera(sim, px, py);          // sets mapFrame + marker
    updateDirArrows(sim, px, py, angle, true);
    return;
  }
  if (mapMarker) mapMarker.visible = false;
  if (moonMapDot) { moonMapDot.visible = false; moonMapLabel.visible = false; }
  updateDirArrows(sim, px, py, angle, false);

  // Follow-cam: a little behind/above the craft, with the world below.
  // "Up" = radial from whichever body owns the craft (Earth, or the Moon near it).
  const cx = (sim.orbit && sim.orbit.center) ? sim.orbit.center.x : 0;
  const cy = (sim.orbit && sim.orbit.center) ? sim.orbit.center.y : 0;
  _v1.set(px - cx, py - cy, 0);
  const radial = _v2.copy(_v1).normalize(); // points away from the dominant body's center
  if (!isFinite(radial.x) || radial.lengthSq() < 0.5) radial.set(0, 1, 0);

  const camDist = Math.max(20, craftHeight * 4 + 30);
  // Offset: pull back along radial (above the craft) and out along +Z (behind, out of plane)
  // so the curved Earth is visible below the craft.
  camera.position.set(
    px + radial.x * camDist * 0.35,
    py + radial.y * camDist * 0.35,
    camDist
  );
  camera.up.copy(radial); // keep planet-down orientation
  camera.lookAt(px, py, 0);
}

// Map view: top-down of the orbital (XY) plane — Earth centered, the orbit ellipse around it,
// and a bright marker for the craft moving along it. This is where "you're in orbit" becomes
// visible: the craft tracks around the planet.
function updateMapCamera(sim, px, py) {
  // Earth-relative apoapsis (only when Earth owns the orbit; a Moon orbit is tiny on this map).
  // As the kid raises apoapsis toward the Moon, this grows the frame so the transfer path
  // visibly stretches out — he can SEE where he's heading without touching zoom.
  const apoR = (sim.orbit && sim.orbit.bodyName === "Earth" && isFinite(sim.orbit.apoapsis))
    ? (R + sim.orbit.apoapsis) : 0;
  const craftR = Math.hypot(px, py);
  // Auto-fit base scale: keep Earth + ship + orbit in view. Grow-only so it doesn't jitter.
  let base = Math.max(apoR, craftR, R * 2.5) * 1.15;
  if (base < mapBase) base = mapBase;
  mapBase = base;
  // Apply the user's zoom on top (scroll / +- keys). This is what lets him pull all the way
  // back to the whole Earth-Moon system to aim the burn.
  mapFrame = base * mapZoom;
  const vHalf = ((camera.fov * Math.PI) / 180) / 2;
  const dist = mapFrame / Math.tan(vHalf);
  camera.position.set(0, 0, dist); // fixed point out of the orbital plane, looking at Earth's center
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  if (mapMarker) {
    mapMarker.visible = true;
    mapMarker.position.set(px, py, mapFrame * 0.02); // sit above the orbit line
    mapMarker.scale.setScalar(mapFrame * 0.018);
  }
  // Moon dot + label: the real Moon disappears at system zoom, so give it a marker like the
  // ship's — but never SMALLER than the true Moon (zoomed in close, reality takes over).
  ensureMoonMapDot();
  const m = moonStateAt(sim.time || 0);
  moonMapDot.visible = true;
  moonMapDot.position.set(m.pos.x, m.pos.y, mapFrame * 0.015);
  moonMapDot.scale.setScalar(Math.max(MOON.radius, mapFrame * 0.014));
  moonMapLabel.visible = true;
  const lblS = mapFrame * 0.05;
  moonMapLabel.position.set(m.pos.x, m.pos.y + Math.max(MOON.radius, mapFrame * 0.014) + lblS * 0.7, mapFrame * 0.015);
  moonMapLabel.scale.set(lblS, lblS, 1);
}

function ensureMoonMapDot() {
  if (moonMapDot) return;
  moonMapDot = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xb8bec8 })
  );
  moonMapDot.frustumCulled = false;
  moonMapDot.visible = false;
  scene.add(moonMapDot);
  moonMapLabel = makeLabelSprite("Moon", "#b8bec8", 34);
  scene.add(moonMapLabel);
}

// User map zoom (scroll wheel or +/- keys). factor > 1 zooms out toward the Moon.
function zoomMap(factor) {
  mapZoom = Math.max(0.12, Math.min(80, mapZoom * factor));
}

// Place the prograde (green, velocity) and heading (cyan, nose) arrows at the ship, sized for
// the current view. Lining them up — burning along prograde — is the gravity turn / circularize.
function updateDirArrows(sim, px, py, angle, inMap) {
  // Map: arrows are a fraction of the whole view. Follow: small markers ~1.6x the rocket,
  // with slim heads, so they read as nose indicators instead of filling the screen.
  const len = inMap ? mapFrame * 0.12 : Math.max(5, craftHeight * 1.6);
  const headLen = len * (inMap ? 0.28 : 0.3);
  const headW = len * (inMap ? 0.18 : 0.1);
  const z = inMap ? mapFrame * 0.02 : 0;
  if (headingArrow) {
    if (showHeading) {
      headingArrow.position.set(px, py, z);
      headingArrow.setDirection(new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0));
      headingArrow.setLength(len, headLen, headW);
      headingArrow.visible = true;
    } else headingArrow.visible = false;
  }
  if (progradeArrow) {
    const v = sim.craft.vel, vm = Math.hypot(v.x, v.y);
    if (showPrograde && vm > 1) {
      progradeArrow.position.set(px, py, z);
      progradeArrow.setDirection(new THREE.Vector3(v.x / vm, v.y / vm, 0));
      progradeArrow.setLength(len, headLen, headW);
      progradeArrow.visible = true;
    } else progradeArrow.visible = false;
  }
  // Gold "aim here" director. Two regimes:
  //  1) TRANSFER WINDOW OPEN (sim.transfer.open): the ship is at the Moon-burn point, so
  //     the gold arrow rides PROGRADE — "point at gold and burn" now means the translunar
  //     injection burn, same muscle memory as the gravity turn.
  //  2) Otherwise: the gravity-turn schedule — straight up low, lean to the horizon as you
  //     climb (fully horizontal by ~60 km). Point the cyan nose at it.
  if (targetArrow && showTarget && sim.transfer && sim.transfer.open) {
    const v = sim.craft.vel, vm = Math.hypot(v.x, v.y);
    if (vm > 1) {
      targetArrow.position.set(px, py, z);
      targetArrow.setDirection(new THREE.Vector3(v.x / vm, v.y / vm, 0));
      targetArrow.setLength(len * 1.1, headLen, headW);
      targetArrow.visible = true;
      return;
    }
  }
  if (targetArrow && showTarget) {
    const r = Math.hypot(px, py) || 1;
    const rox = px / r, roy = py / r;             // radial out (up, away from Earth)
    let tx = roy, ty = -rox;                       // horizontal tangent, default eastward (+x at the top)
    const v = sim.craft.vel;
    if (v.x * tx + v.y * ty < 0) { tx = -tx; ty = -ty; } // align with the way you're already turning
    const f = Math.max(0, Math.min(1, ((sim.altitude || 0) - 3000) / 57000)); // up→horizon over 3–60km
    let dx = rox * (1 - f) + tx * f, dy = roy * (1 - f) + ty * f;
    const dm = Math.hypot(dx, dy) || 1;
    targetArrow.position.set(px, py, z);
    targetArrow.setDirection(new THREE.Vector3(dx / dm, dy / dm, 0));
    targetArrow.setLength(len * 1.1, headLen, headW);
    targetArrow.visible = true;
  } else if (targetArrow) {
    targetArrow.visible = false;
  }
}

// =====================================================================
// Predicted orbit ellipse in the XY plane from apo/peri.
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
  // Can't draw a closed ellipse for an escape/hyperbolic path — hide it (and the markers).
  if (!isFinite(o.apoapsis) || !isFinite(o.periapsis)) {
    orbitLine.visible = false;
    if (apMarker) apMarker.visible = false;
    if (peMarker) peMarker.visible = false;
    return;
  }
  // The ellipse is drawn around whichever body owns the craft (Earth, or the Moon in its SOI).
  const bodyR = o.bodyRadius || R;
  const fx = o.center ? o.center.x : 0;   // focus (body center) in Earth-centered world coords
  const fy = o.center ? o.center.y : 0;
  // apoapsis/periapsis are altitudes ABOVE THAT BODY'S SURFACE (meters).
  const ra = bodyR + (o.apoapsis || 0);   // apoapsis radius from body center
  const rp = bodyR + (o.periapsis || 0);  // periapsis radius from body center
  const a = (ra + rp) / 2;            // semi-major axis
  const c = (ra - rp) / 2;            // center offset (focus at body center)
  const b = Math.sqrt(Math.max(0, a * a - c * c)); // semi-minor

  // Orientation: physics now supplies the TRUE periapsis direction (eccentricity vector),
  // so the ellipse sits still in space as the craft moves along it. Fall back to the old
  // craft-radial approximation only if periAngle is missing (near-circular: doesn't matter).
  let rot = 0;
  if (typeof o.periAngle === "number" && isFinite(o.periAngle) && (o.eccentricity || 0) > 1e-4) {
    rot = o.periAngle;
  } else if (sim.craft && sim.craft.pos) {
    rot = Math.atan2(sim.craft.pos.y - fy, sim.craft.pos.x - fx);
  }
  // Focus at the body center (fx,fy); ellipse center sits at (-c) along the periapsis axis.
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  const attr = orbitLine.geometry.getAttribute("position");
  const SEG = (attr.count) - 1;
  const cx = -c; // center along local periapsis (+X) axis, focus at body center
  for (let i = 0; i <= SEG; i++) {
    const t = (i / SEG) * Math.PI * 2;
    // Local ellipse coords (periapsis along +X).
    const lx = cx + a * Math.cos(t);
    const ly = b * Math.sin(t);
    // Rotate into world XY by rot, then translate so the focus lands on the body center.
    const wx = lx * cosR - ly * sinR + fx;
    const wy = lx * sinR + ly * cosR + fy;
    attr.setXYZ(i, wx, wy, 0);
  }
  attr.needsUpdate = true;
  orbitLine.geometry.computeBoundingSphere();
  orbitLine.visible = true;

  // Ap/Pe markers (map view only): dots + labels on the ellipse so "burn at Ap to raise Pe"
  // becomes something you can SEE. Periapsis at local +X (t=0), apoapsis opposite.
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

// Text sprite ("Ap"/"Pe"/"Burn") drawn onto a small canvas — the classic Three.js label
// trick. fontPx shrinks for longer words so they still fit inside the dot.
let apMarker = null, peMarker = null;
let burnMarker = null; // gold "Burn" dot: where on the orbit to start the Moon transfer burn
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
function ensureApPeMarkers() {
  if (apMarker) return;
  apMarker = makeLabelSprite("Ap", "#8fb7ff");
  peMarker = makeLabelSprite("Pe", "#ffd24a");
  scene.add(apMarker);
  scene.add(peMarker);
}

// Gold "Burn" marker on the current orbit at the transfer-burn start point (map view only).
// Reads sim.transfer (set by main.js from Physics.transferWindow each frame).
function updateBurnMarker(sim) {
  const tw = sim && sim.transfer;
  if (!(mode === "flight" && flightView === "map" && tw && tw.burnPos && mapFrame > 0)) {
    if (burnMarker) burnMarker.visible = false;
    return;
  }
  if (!burnMarker) {
    burnMarker = makeLabelSprite("Burn", "#ffd24a", 36); // smaller font: 4 letters in the dot
    scene.add(burnMarker);
  }
  const s = mapFrame * 0.05;
  burnMarker.position.set(tw.burnPos.x, tw.burnPos.y, mapFrame * 0.02);
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
  // Position at top (or bottom) of the current stack, in the craftGroup's world frame.
  const half = craftHeight / 2;
  const yLocal = atTop === false ? -half - 0.2 : half + 0.2;
  if (craftGroup) {
    snapGhost.position.set(
      craftGroup.position.x,
      craftGroup.position.y + yLocal,
      craftGroup.position.z
    );
  } else {
    // No craft yet: ghost sits on the launchpad surface.
    snapGhost.position.set(0, R + 1.4, 0);
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
    if (moonMapDot) { moonMapDot.visible = false; moonMapLabel.visible = false; }
  }
}

// ---- Disposal helper ----
function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    // Only dispose cloned/per-part materials, not the shared MAT.* set.
    if (obj.material && obj.material._isClone) obj.material.dispose();
  });
}

// ---- Debug snapshot (temporary, for diagnosing the build view) ----
function debug() {
  const rnd = (n) => Math.round(n * 10) / 10;
  // Where does the rocket actually project on screen? NDC: (0,0)=center, edges at ±1.
  let ndc = "n/a";
  if (craftGroup && camera) {
    const p = craftGroup.position.clone().project(camera);
    ndc = [rnd(p.x), rnd(p.y), rnd(p.z)]; // z>1 means behind camera / clipped
  }
  return {
    mode,
    earthHidden: earthMesh ? !earthMesh.visible : null,
    craft: craftGroup ? [rnd(craftGroup.position.x), rnd(craftGroup.position.y), rnd(craftGroup.position.z)] : "NONE",
    craftHeight: rnd(craftHeight),
    cam: camera ? [rnd(camera.position.x), rnd(camera.position.y), rnd(camera.position.z)] : null,
    target: [rnd(buildCam.target.x), rnd(buildCam.target.y), rnd(buildCam.target.z)],
    rocketOnScreen: ndc,
    canvas: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
    aspect: camera ? rnd(camera.aspect) : null,
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
