// Phase 5 tests: landing legs touchdown thresholds, satellite freeze + propagation,
// Phobos/Deimos data sanity, new stock parts. Run: node tests/phase5_test.mjs
import { Physics } from "../js/physics.js";
import { BODIES, bodyStateAt, dominantBody } from "../js/state.js";
import { PARTS as STOCK } from "../js/parts.js";
import { validatePartDef } from "../js/mods.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// Drop a craft straight down onto the Moon at a chosen touchdown speed.
function dropOnMoon(speed, legCount) {
  const t0 = 1000;
  const m = bodyStateAt("moon", t0);
  const M = BODIES.moon;
  const startAlt = 0.5; // touch down almost immediately so gravity barely adds speed
  const ux = 0, uy = 1; // land at the moon's local +Y
  const sim = {
    body: M,
    craft: {
      pos: { x: m.pos.x + ux * 0, y: m.pos.y + (M.radius + startAlt) },
      vel: { x: m.vel.x, y: m.vel.y - speed }, // descending radially at `speed`
      angle: 0, throttle: 0, fuelRemaining: 0, mass: 5, currentStage: 0,
      legCount,
    },
    altitude: startAlt, speed, time: t0, status: "flying", orbit: null, target: "moon",
  };
  for (let i = 0; i < 400 && sim.status === "flying"; i++) Physics.step(sim, 0.05);
  return sim.status;
}

// --- 1. Landing legs raise the survivable touchdown speed ---
{
  check("4 m/s touchdown lands without legs", dropOnMoon(4, 0) === "landed");
  check("9 m/s touchdown CRASHES without legs", dropOnMoon(9, 0) === "crashed");
  check("9 m/s touchdown LANDS with legs", dropOnMoon(9, 4) === "landed");
  check("16 m/s still crashes even with legs", dropOnMoon(16, 4) === "crashed");
}

// --- 2. Satellites: freeze a LEO conic, propagate a full period, come back around ---
{
  const t0 = 2000;
  const E = BODIES.earth;
  const e0 = bodyStateAt("earth", t0);
  const r = E.radius * 1.4;
  const v = Math.sqrt(E.mu / r);
  const sim = {
    craft: { pos: { x: e0.pos.x + r, y: e0.pos.y }, vel: { x: e0.vel.x, y: e0.vel.y + v } },
    orbit: { isOrbit: true },
    time: t0,
  };
  const sat = Physics.makeSatellite(sim);
  check("makeSatellite freezes a LEO conic", !!sat && sat.bodyKey === "earth",
    sat ? `a=${(sat.a / 1e3).toFixed(0)} km e=${sat.e.toFixed(4)}` : "null");
  const period = (2 * Math.PI) / sat.n;
  const pNow = Physics.satellitePos(sat, t0);
  const pLater = Physics.satellitePos(sat, t0 + period);
  const eLater = bodyStateAt("earth", t0 + period);
  const relNow = { x: pNow.x - e0.pos.x, y: pNow.y - e0.pos.y };
  const relLater = { x: pLater.x - eLater.pos.x, y: pLater.y - eLater.pos.y };
  const drift = Math.hypot(relLater.x - relNow.x, relLater.y - relNow.y);
  check("satellite returns to its start point after one period", drift < r * 0.01,
    `drift=${drift.toFixed(1)} m over period=${(period / 60).toFixed(1)} min`);
  const rMid = Math.hypot(
    Physics.satellitePos(sat, t0 + period / 3).x - bodyStateAt("earth", t0 + period / 3).pos.x,
    Physics.satellitePos(sat, t0 + period / 3).y - bodyStateAt("earth", t0 + period / 3).pos.y);
  check("…and stays at its circular radius in between", Math.abs(rMid - r) < r * 0.01,
    `r=${(rMid / 1e3).toFixed(1)} km vs ${(r / 1e3).toFixed(1)} km`);
  const hyper = Physics.makeSatellite({
    craft: { pos: { x: e0.pos.x + r, y: e0.pos.y }, vel: { x: e0.vel.x, y: e0.vel.y + v * 2 } },
    orbit: { isOrbit: true }, time: t0,
  });
  check("escaping trajectory can't become a satellite", hyper === null);
}

// --- 3. Phobos & Deimos sanity ---
{
  const P = BODIES.phobos, D = BODIES.deimos;
  check("Phobos & Deimos circle Mars", P.parent === "mars" && D.parent === "mars");
  check("both are flagged tinyMoon (SOI clamped to 2x radius)",
    P.tinyMoon === true && D.tinyMoon === true &&
    Math.abs(P.soiRadius - P.radius * 2) < 1 && Math.abs(D.soiRadius - D.radius * 2) < 1);
  check("Phobos orbits inside Deimos, both inside Mars's SOI",
    P.orbitRadius < D.orbitRadius && D.orbitRadius < BODIES.mars.soiRadius);
  // Standing on Phobos must read Phobos-relative (the whole point of the SOI clamp).
  const t = 777;
  const ps = bodyStateAt("phobos", t);
  const surf = { x: ps.pos.x, y: ps.pos.y + P.radius * 1.01 };
  check("on Phobos's surface, Phobos owns you", dominantBody(surf, t).body.key === "phobos");
  // Phobos's escape speed really is bicycle speed — the fact the Navigator teaches.
  const vEsc = Math.sqrt((2 * P.mu) / P.radius);
  check("Phobos escape speed ≈ bike speed", vEsc > 1 && vEsc < 10, `${vEsc.toFixed(1)} m/s`);
}

// --- 4. New stock parts exist and validate ---
{
  for (const id of ["landing_legs", "probe_core", "solar_panel", "engine_crane", "rover"]) {
    const def = STOCK.find((p) => p.id === id);
    const v = def && validatePartDef(def);
    check(`stock part "${id}" exists and validates`, !!def && v.ok, v && v.error ? v.error : "");
  }
  const probe = STOCK.find((p) => p.id === "probe_core");
  check("probe core is an UNCREWED command part", probe.type === "command" && probe.uncrewed === true);
  const crane = STOCK.find((p) => p.id === "engine_crane");
  check("sky-crane thrusters allow cargo below (attachBottom)", crane.attachBottom === true);
  // The crane packs its own fuel (so did the real MSL descent stage) — and it must be
  // enough to land a crane+rover+probe stack from low Mars orbit (~965 m/s + margin).
  check("sky crane packs its own fuel", (crane.fuelMass || 0) > 0, `fuel=${crane.fuelMass} t`);
  const wet = crane.dryMass + crane.fuelMass + 0.5 + 0.3; // + rover + probe core
  const dry = crane.dryMass + 0.5 + 0.3;
  const dv = crane.exhaustVelocity * Math.log(wet / dry);
  check("…enough Δv for a Mars sky-crane landing", dv > 1400, `Δv=${dv.toFixed(0)} m/s`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
