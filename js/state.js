// state.js — shared data shapes, body constants, and derived-stat math.
// This is the contract backbone. See ../ARCHITECTURE.md.
//
// PHASE 4: the world is now HELIOCENTRIC. The Sun sits at the world origin and every
// planet rides a fixed circular CCW orbit around it (the Moon around Earth). The same
// forgiving-scale rule applies to the whole solar system: every RADIUS and every ORBIT
// DISTANCE is shrunk by SCALE, and every surface gravity is kept REAL (mu = g0*r^2).
// Geometry stays faithful — the Moon is still ~60 Earth-radii out, Mars is still ~1.5x
// Earth's distance from the Sun — the whole system is just 10x smaller and, as a side
// effect of the scaling, runs about sqrt(10) ≈ 3.2x faster.

// G in SI. Flip SCALE to 1 for the real-size universe later.
const SCALE = 0.1; // 0.1 = forgiving (smaller worlds, lower orbital speeds). 1.0 = real.

const G = 6.674e-11;

// Real solar-system data: radius (m), surface gravity g0 (m/s^2), orbit semi-major axis
// a (m) around the parent, atmosphere (height m, sea-level density kg/m^3) or null.
// solid: can you stand on it? (gas giants and the Sun have no surface to land on)
// phase0: starting angle on its orbit (radians, deterministic — scatters the sky).
const REAL = {
  sun:     { radius: 6.957e8,  g0: 274.0, parent: null,    a: 0,         solid: false, atmo: null, phase0: 0 },
  mercury: { radius: 2.4397e6, g0: 3.70,  parent: "sun",   a: 5.791e10,  solid: true,  atmo: null, phase0: 0.8 },
  venus:   { radius: 6.0518e6, g0: 8.87,  parent: "sun",   a: 1.0821e11, solid: true,  atmo: { height: 250000, seaLevelDensity: 65 }, phase0: 2.4 },
  earth:   { radius: 6.371e6,  g0: 9.81,  parent: "sun",   a: 1.4960e11, solid: true,  atmo: { height: 70000, seaLevelDensity: 1.225 }, phase0: 0 },
  moon:    { radius: 1.737e6,  g0: 1.62,  parent: "earth", a: 3.844e8,   solid: true,  atmo: null, phase0: 0 },
  mars:    { radius: 3.3895e6, g0: 3.71,  parent: "sun",   a: 2.2794e11, solid: true,  atmo: { height: 125000, seaLevelDensity: 0.020 }, phase0: 5.2 },
  // Mars's moons: so tiny their TRUE sphere of influence is smaller than their own radius
  // (you can't really orbit them — real probes orbit MARS and fly alongside). buildBodies
  // clamps their SOI to 2x radius purely so readouts measure from them up close/landed;
  // it marks them tinyMoon so guidance knows orbits here aren't a thing.
  phobos:  { radius: 1.1267e4, g0: 0.0057, parent: "mars", a: 9.376e6,   solid: true,  atmo: null, phase0: 1.5 },
  deimos:  { radius: 6.2e3,    g0: 0.003,  parent: "mars", a: 2.3463e7,  solid: true,  atmo: null, phase0: 4.7 },
  jupiter: { radius: 6.9911e7, g0: 24.79, parent: "sun",   a: 7.7857e11, solid: false, atmo: { height: 1000000, seaLevelDensity: 0.16 }, phase0: 1.7 },
  // Jupiter's Galilean moons (Phobos/Deimos skipped: so tiny their SOI is smaller than
  // their radius; Triton skipped: retrograde, and this engine's orbits are CCW-only).
  io:       { radius: 1.8216e6, g0: 1.796, parent: "jupiter", a: 4.217e8,   solid: true, atmo: null, phase0: 0.3 },
  europa:   { radius: 1.5608e6, g0: 1.314, parent: "jupiter", a: 6.711e8,   solid: true, atmo: null, phase0: 2.1 },
  ganymede: { radius: 2.6341e6, g0: 1.428, parent: "jupiter", a: 1.0704e9,  solid: true, atmo: null, phase0: 4.4 },
  callisto: { radius: 2.4103e6, g0: 1.235, parent: "jupiter", a: 1.8827e9,  solid: true, atmo: null, phase0: 5.6 },
  saturn:  { radius: 5.8232e7, g0: 10.44, parent: "sun",   a: 1.4335e12, solid: false, atmo: { height: 1000000, seaLevelDensity: 0.19 }, phase0: 3.9 },
  // Titan: air THICKER than Earth's — the one world where a parachute alone lands you
  // softly (that's exactly how the real Huygens probe did it in 2005).
  titan:    { radius: 2.5747e6, g0: 1.352, parent: "saturn", a: 1.22187e9, solid: true, atmo: { height: 600000, seaLevelDensity: 5.3 }, phase0: 1.2 },
  uranus:  { radius: 2.5362e7, g0: 8.87,  parent: "sun",   a: 2.8725e12, solid: false, atmo: { height: 900000, seaLevelDensity: 0.42 }, phase0: 5.8 },
  neptune: { radius: 2.4622e7, g0: 11.15, parent: "sun",   a: 4.4951e12, solid: false, atmo: { height: 900000, seaLevelDensity: 0.45 }, phase0: 0.5 },
  // Pluto: a dwarf planet, but there is NO version of this game without Pluto. Real orbit
  // is stretched and tilted (it even dips inside Neptune's) — ours is circular at its
  // semi-major axis, like every body here; the Navigator teaches the real shape.
  pluto:   { radius: 1.1883e6, g0: 0.62,  parent: "sun",   a: 5.9064e12, solid: true,  atmo: null, phase0: 2.9 },
};

// Build a scaled BODIES table from REAL-style defs. Parents must come before children
// in `order` so omega and SOI can read the parent's mu. Exported so the star-system
// generator (stargen.js) uses THE SAME math — one source of truth for mu/omega/SOI.
// Extra def fields the generator uses: name (display), style/face (render hints), gen.
export function buildCatalog(defs, order, scale = SCALE) {
  const out = {};
  for (const key of order) {
    const d = defs[key];
    const radius = d.radius * scale;
    const mu = d.g0 * radius * radius; // keep REAL surface gravity; size sets mu
    const body = {
      key,
      name: d.name || key[0].toUpperCase() + key.slice(1),
      radius, mu, g0: d.g0, mass: mu / G,
      solid: d.solid,
      atmosphere: d.atmo ? { height: d.atmo.height * scale, seaLevelDensity: d.atmo.seaLevelDensity } : null,
      parent: d.parent,
      orbitRadius: d.a * scale,
      phase0: d.phase0,
      omega: 0, soiRadius: 0,
    };
    if (d.style) body.style = d.style;
    if (d.face) body.face = d.face;
    if (d.gen) body.gen = true;
    if (d.parent) {
      const p = out[d.parent];
      body.omega = Math.sqrt(p.mu / (body.orbitRadius ** 3)); // circular two-body rate, CCW
      // Sphere of influence (patched conics): r_soi = a * (mu/mu_parent)^(2/5).
      body.soiRadius = body.orbitRadius * Math.pow(body.mu / p.mu, 0.4);
      // Tiny moons (Phobos, Deimos): true SOI < their own radius — no orbit is possible
      // around them (real!). Clamp the DISPLAY SOI to 2x radius so standing on / hovering
      // beside one reads distances and speeds from IT, and flag it for guidance.
      if (body.soiRadius < radius * 2) {
        body.soiRadius = radius * 2;
        body.tinyMoon = true;
      }
    }
    out[key] = body;
  }
  return out;
}

const SOL_ORDER = ["sun", "mercury", "venus", "earth", "moon", "mars", "phobos", "deimos",
                   "jupiter", "io", "europa", "ganymede", "callisto",
                   "saturn", "titan", "uranus", "neptune", "pluto"];

// THE ACTIVE SYSTEM. BODIES and PLANET_KEYS are swapped IN PLACE by setSystem() so
// every module's existing `import { BODIES }` keeps working — same object identity,
// new contents. The star is ALWAYS keyed "sun", the homeworld (launch pad, TWR
// reference, "fly home" logic) is ALWAYS keyed "earth", and the homeworld's first
// moon is ALWAYS keyed "moon" (the transfer tutorial works in every system). Display
// names differ; keys are stable roles, not names.
export const BODIES = buildCatalog(REAL, SOL_ORDER);

// Every body except the star, ordered for target pickers / map labels.
export const PLANET_KEYS = ["mercury", "venus", "earth", "moon", "mars", "phobos", "deimos",
  "jupiter", "io", "europa", "ganymede", "callisto", "saturn", "titan", "uranus", "neptune", "pluto"];

// Active-system metadata. `rev` bumps on every swap — modules that cache anything
// derived from BODIES/PLANET_KEYS (physics' body list, render's world meshes) key
// their cache on it.
export const SYSTEM = { key: "sol", name: "The Solar System", seed: null, rev: 0 };

// Pristine Sol snapshot for returnToSol() — deep-copied so no one can mutate it.
const SOL_SNAPSHOT = JSON.parse(JSON.stringify(BODIES));
const SOL_KEYS = [...PLANET_KEYS];

export function setSystem(catalog, planetKeys, meta = {}) {
  for (const k of Object.keys(BODIES)) delete BODIES[k];
  for (const k of Object.keys(catalog)) BODIES[k] = catalog[k];
  PLANET_KEYS.length = 0;
  PLANET_KEYS.push(...planetKeys);
  SYSTEM.key = meta.key || "custom";
  SYSTEM.name = meta.name || "Unknown System";
  SYSTEM.seed = meta.seed ?? null;
  SYSTEM.rev++;
}

export function returnToSol() {
  setSystem(JSON.parse(JSON.stringify(SOL_SNAPSHOT)), SOL_KEYS,
    { key: "sol", name: "The Solar System", seed: null });
}

export function isSol() { return SYSTEM.key === "sol"; }

// World (Sun-centered) position/velocity of a body's CENTER at sim time t (seconds).
// Recursive through the parent chain: Moon = Earth's state + Moon's circle around Earth.
export function bodyStateAt(key, t = 0) {
  const b = BODIES[key];
  if (!b || !b.parent) return { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0 };
  const parent = bodyStateAt(b.parent, t);
  const th = (b.phase0 || 0) + b.omega * t;
  const a = b.orbitRadius;
  const v = a * b.omega;
  return {
    pos: { x: parent.pos.x + a * Math.cos(th), y: parent.pos.y + a * Math.sin(th) },
    vel: { x: parent.vel.x - v * Math.sin(th), y: parent.vel.y + v * Math.cos(th) }, // CCW
    angle: th,
  };
}

// Back-compat helper: the Moon's state RELATIVE TO EARTH (its classic Phase-2 meaning).
export function moonStateAt(t = 0, moon = BODIES.moon) {
  const a = moon.orbitRadius;
  const th = (moon.phase0 || 0) + moon.omega * t;
  const v = a * moon.omega;
  return {
    pos: { x: a * Math.cos(th), y: a * Math.sin(th) },
    vel: { x: -v * Math.sin(th), y: v * Math.cos(th) },
    angle: th,
  };
}

// Which body "owns" a craft at WORLD position `pos` and time `t` — the DEEPEST sphere of
// influence containing the point (Moon beats Earth beats Sun). Used for orbit display,
// readouts, and Navigator messaging; the integrator itself superposes ALL gravity.
// Returns { body, rel:{x,y} relative to that body's center, vel:{x,y} of that body }.
export function dominantBody(pos, t = 0) {
  let best = BODIES.sun, bestState = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } };
  for (const key of PLANET_KEYS) {
    const b = BODIES[key];
    const st = bodyStateAt(key, t);
    const d = Math.hypot(pos.x - st.pos.x, pos.y - st.pos.y);
    if (d < b.soiRadius && (best.key === "sun" || b.soiRadius < best.soiRadius)) {
      best = b; bestState = st;
    }
  }
  return {
    body: best,
    rel: { x: pos.x - bestState.pos.x, y: pos.y - bestState.pos.y },
    vel: { x: bestState.vel.x, y: bestState.vel.y },
    center: bestState.pos,
  };
}

export const CONFIG = { SCALE };

// ---- Shared factory helpers ----
let _instanceCounter = 0;
export function makeInstance(partId, stage = 0) {
  return { instanceId: "p" + (++_instanceCounter), partId, stage };
}

export function newCraft(name = "My Rocket") {
  return { name, parts: [] };
}

// Look up a PartDef by id from a catalog array.
export function findPart(catalog, partId) {
  return catalog.find((p) => p.id === partId);
}

// ---- Derived stats. UI + copilot read this. ----
// catalog: array of PartDef. craft: Craft.
export function computeStats(craft, catalog, body = BODIES.earth) {
  let dryMass = 0, fuelMass = 0, thrust = 0;
  const stages = new Set();
  for (const inst of craft.parts) {
    const def = findPart(catalog, inst.partId);
    if (!def) continue;
    dryMass += def.dryMass || 0;
    fuelMass += def.fuelMass || 0;
    if (def.type === "engine") thrust += def.thrust || 0;
    stages.add(inst.stage);
  }
  const totalMass = dryMass + fuelMass;
  // TWR at liftoff: thrust(kN)->N divided by weight(N).
  const twr = totalMass > 0 ? (thrust * 1000) / (totalMass * 1000 * body.g0) : 0;
  // Whole-rocket dV (Tsiolkovsky), thrust-weighted exhaust velocity as approximation.
  let ve = 0, engineCount = 0;
  for (const inst of craft.parts) {
    const def = findPart(catalog, inst.partId);
    if (def && def.type === "engine") { ve += def.exhaustVelocity || 0; engineCount++; }
  }
  ve = engineCount ? ve / engineCount : 0;
  const deltaV = ve && totalMass > 0 && dryMass > 0 ? ve * Math.log(totalMass / dryMass) : 0;
  return { totalMass, dryMass, fuelMass, thrust, twr, deltaV, stageCount: stages.size || 1 };
}

// ---- Fresh SimState for a launch (on Earth's launchpad, wherever Earth is right now) ----
// The pad sits at Earth's local +Y (Earth doesn't rotate in this game), and the craft
// starts co-moving with Earth — you're standing on a planet that's flying around the Sun.
export function newSimState(body = BODIES.earth, t = 0) {
  const e = bodyStateAt("earth", t);
  return {
    mode: "build",
    body,
    craft: { pos: { x: e.pos.x, y: e.pos.y + body.radius }, vel: { x: e.vel.x, y: e.vel.y },
             angle: 0, throttle: 0, fuelRemaining: 0, mass: 0, currentStage: 0 },
    orbit: null,
    altitude: 0, speed: 0,
    heat: 0,               // hull heating 0..1 (reentry); 1 = burned up
    time: t, timeWarp: 1,
    status: "prelaunch",
    target: "moon",        // current destination for guidance / distance readout
  };
}
