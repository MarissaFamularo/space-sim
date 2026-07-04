// ✨ Teleport tests: Physics.parkingOrbit must hand back a stable low orbit around
// EVERY pickable world, at any sim time. Run: node tests/teleport_test.mjs
import { Physics } from "../js/physics.js";
import { BODIES, PLANET_KEYS, bodyStateAt, dominantBody } from "../js/state.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// --- 1. Placement basics (Mars as the worked example) ---
{
  const MARS = BODIES.mars;
  const p = Physics.parkingOrbit("mars", 0);
  const ms = bodyStateAt("mars", 0);
  const r = Math.hypot(p.pos.x - ms.pos.x, p.pos.y - ms.pos.y);
  check("Mars parking orbit sits well above the ground", r > MARS.radius * 1.2,
    `r=${(r / 1e3).toFixed(0)} km vs radius ${(MARS.radius / 1e3).toFixed(0)} km`);
  check("…and above the atmosphere", r - MARS.radius > MARS.atmosphere.height * 2,
    `alt=${((r - MARS.radius) / 1e3).toFixed(0)} km atmoTop=${(MARS.atmosphere.height / 1e3).toFixed(0)} km`);
  const vrel = Math.hypot(p.vel.x - ms.vel.x, p.vel.y - ms.vel.y);
  check("speed is circular for that radius", Math.abs(vrel - Math.sqrt(MARS.mu / r)) < 1,
    `v=${vrel.toFixed(1)} m/s`);
  check("enters on the sunlit side (between Sun and planet)",
    Math.hypot(p.pos.x, p.pos.y) < Math.hypot(ms.pos.x, ms.pos.y));
  check("nose starts prograde", (() => {
    const hd = { x: -Math.sin(p.angle), y: Math.cos(p.angle) };
    const vr = { x: p.vel.x - ms.vel.x, y: p.vel.y - ms.vel.y };
    const vm = Math.hypot(vr.x, vr.y);
    return (hd.x * vr.x + hd.y * vr.y) / vm > 0.999;
  })());
  check("no teleporting into the Sun", Physics.parkingOrbit("sun") === null);
  check("unknown key returns null", Physics.parkingOrbit("krypton") === null);
}

// --- 2. Fly one full lap around EVERY pickable world: stay owned by it, stay aloft.
// Tiny moons (Phobos, Deimos) can't be orbited at all — the teleporter instead parks you
// in FORMATION (matching Mars orbit, co-moving). For those, fly 20 minutes and check we
// stay close by without crashing. ---
for (const key of PLANET_KEYS) {
  const t0 = 5000; // not t=0 — catches anything that assumed epoch positions
  const b = BODIES[key];
  const p = Physics.parkingOrbit(key, t0);
  if (b.tinyMoon) {
    check(`${b.name} teleport is a co-orbit (formation flying)`, p.coOrbit === true,
      `off=${(p.radius / b.radius).toFixed(1)} radii`);
    const sim = {
      body: b,
      craft: { pos: { ...p.pos }, vel: { ...p.vel }, angle: p.angle, throttle: 0,
               fuelRemaining: 0, mass: 5, currentStage: 0 },
      altitude: p.altitude, speed: 0, time: t0, status: "flying", orbit: null, target: key,
    };
    let ok = true, maxD = 0;
    for (let i = 0; i < 240; i++) {
      Physics.step(sim, 5); // 20 minutes total
      if (sim.status === "crashed") { ok = false; break; }
      const ms = bodyStateAt(key, sim.time);
      const d = Math.hypot(sim.craft.pos.x - ms.pos.x, sim.craft.pos.y - ms.pos.y);
      maxD = Math.max(maxD, d);
    }
    check(`formation with ${b.name} holds ~20 min (drifts, never crashes)`,
      ok && maxD < b.radius * 60,
      `maxDist=${(maxD / b.radius).toFixed(1)} radii status=${sim.status}`);
    continue;
  }
  const sim = {
    body: b,
    craft: { pos: { ...p.pos }, vel: { ...p.vel }, angle: p.angle, throttle: 0,
             fuelRemaining: 0, mass: 5, currentStage: 0 },
    altitude: p.altitude, speed: p.speed, time: t0, status: "flying", orbit: null, target: key,
  };
  const period = 2 * Math.PI * Math.sqrt(p.radius ** 3 / b.mu);
  let ok = true, whyNot = "", minAlt = Infinity, maxAlt = -Infinity;
  const N = 400;
  for (let i = 0; i < N; i++) {
    Physics.step(sim, period / N);
    if (sim.status === "crashed" || sim.status === "landed") { ok = false; whyNot = sim.status; break; }
    minAlt = Math.min(minAlt, sim.altitude); maxAlt = Math.max(maxAlt, sim.altitude);
    if (dominantBody(sim.craft.pos, sim.time).body.key !== key) { ok = false; whyNot = "left the SOI"; break; }
  }
  const drift = (maxAlt - minAlt) / p.altitude;
  const orbit = Physics.computeOrbit(sim);
  check(`teleport orbit around ${b.name} survives a full lap`,
    ok && orbit && orbit.isOrbit && drift < 0.35,
    whyNot || `drift=${(drift * 100).toFixed(1)}% ecc=${orbit ? orbit.eccentricity.toFixed(3) : "?"} period=${(period / 60).toFixed(0)} min`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
