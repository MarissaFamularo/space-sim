// state.js — shared data shapes, body constants, and derived-stat math.
// This is the contract backbone. See ../ARCHITECTURE.md.

// G in SI. Forgiving Earth: scaled down so reaching orbit is fun (KSP-style training wheels).
// Flip SCALE to 1 for real Earth later.
const SCALE = 0.1; // 0.1 = forgiving (smaller planet, lower orbital speeds). 1.0 = real Earth.

const G = 6.674e-11;
const REAL_EARTH = { mass: 5.972e24, radius: 6.371e6 };
// Real Moon. g0 = surface gravity (1.62 m/s²); orbitRadius = mean Earth distance (semi-major).
const REAL_MOON = { radius: 1.737e6, g0: 1.62, orbitRadius: 3.844e8 };

function makeEarth(scale) {
  // Scale radius down; keep surface gravity g0 ~9.81 so rockets feel right, which sets mass.
  const radius = REAL_EARTH.radius * scale;
  const g0 = 9.81;
  const mu = g0 * radius * radius;     // mu = g0 * r^2  (so surface gravity stays 9.81)
  const mass = mu / G;
  return {
    name: "Earth",
    radius, mass, mu, g0,
    atmosphere: { height: 70000 * scale, seaLevelDensity: 1.225 }, // exponential falloff in physics
  };
}

// The Moon: a second world to travel to. Scaled the SAME way as Earth — shrink radius by
// `scale`, keep real surface gravity, recompute mu (so Moon physics is real, only size shrinks).
// Distance is scaled too, so the Moon stays at ~60 Earth-radii — geometrically faithful.
function makeMoon(scale, earth) {
  const radius = REAL_MOON.radius * scale;
  const g0 = REAL_MOON.g0;
  const mu = g0 * radius * radius;        // mu = g0 * r^2 (keeps real lunar surface gravity)
  const mass = mu / G;
  const orbitRadius = REAL_MOON.orbitRadius * scale;
  // Angular rate of the Moon around Earth (two-body, lunar mass negligible): omega = sqrt(mu_E/a^3).
  const omega = Math.sqrt(earth.mu / (orbitRadius * orbitRadius * orbitRadius));
  // Sphere of influence (patched conics): r_soi = a * (m_moon / m_earth)^(2/5). Inside it, the
  // Moon's gravity dominates and we'll switch the craft's reference body to the Moon.
  const soiRadius = orbitRadius * Math.pow(mu / earth.mu, 0.4);
  return {
    name: "Moon",
    radius, mass, mu, g0,
    atmosphere: null,
    parent: "earth",
    orbitRadius, omega,
    phase0: 0,            // orbital angle at t=0 (0 = along +X)
    soiRadius,
  };
}

const _earth = makeEarth(SCALE);
export const BODIES = {
  earth: _earth,
  moon: makeMoon(SCALE, _earth),
};

// Which body "owns" a craft at Earth-centered position `pos` and time `t` — Earth normally,
// the Moon once inside the Moon's sphere of influence. Used for the predicted-orbit display
// and Navigator messaging (the integrator itself uses real superposed gravity, no switching).
// Returns { body, rel:{x,y} relative to that body's center, vel:{x,y} of that body }.
export function dominantBody(pos, t = 0) {
  const m = moonStateAt(t);
  const rel = { x: pos.x - m.pos.x, y: pos.y - m.pos.y };
  if (Math.hypot(rel.x, rel.y) < BODIES.moon.soiRadius) {
    return { body: BODIES.moon, rel, vel: m.vel };
  }
  return { body: BODIES.earth, rel: { x: pos.x, y: pos.y }, vel: { x: 0, y: 0 } };
}

// Moon center state in the EARTH-centered frame at sim time `t` (seconds): position {x,y} (m)
// and velocity {x,y} (m/s). The Moon rides a fixed circular orbit (CCW). Used by render now,
// and by the patched-conic SOI switch later.
export function moonStateAt(t = 0, moon = BODIES.moon) {
  const a = moon.orbitRadius;
  const th = (moon.phase0 || 0) + moon.omega * t;
  const v = a * moon.omega;
  return {
    pos: { x: a * Math.cos(th), y: a * Math.sin(th) },
    vel: { x: -v * Math.sin(th), y: v * Math.cos(th) }, // perpendicular, CCW
    angle: th,
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

// ---- Fresh SimState for a launch ----
export function newSimState(body = BODIES.earth) {
  return {
    mode: "build",
    body,
    craft: { pos: { x: 0, y: body.radius }, vel: { x: 0, y: 0 }, angle: 0,
             throttle: 0, fuelRemaining: 0, mass: 0, currentStage: 0 },
    orbit: null,
    altitude: 0, speed: 0,
    heat: 0,               // hull heating 0..1 (reentry); 1 = burned up
    time: 0, timeWarp: 1,
    status: "prelaunch",
  };
}
