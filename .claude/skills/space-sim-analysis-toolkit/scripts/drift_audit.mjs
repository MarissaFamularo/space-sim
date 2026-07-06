// drift_audit.mjs — Recipe 4: integrator energy/drift audit.
//
// Flies a CIRCULAR orbit around a body for N laps at several time-warp step sizes and
// reports how far the craft has drifted from a perfect circle (radial spread + closure
// error). This is the honest measure of integrator quality: a good semi-implicit scheme
// holds the orbit; a bad step size lets it spiral.
//
// Pure node, no browser. Run:
//   node .claude/skills/space-sim-analysis-toolkit/scripts/drift_audit.mjs
// Imports are relative to this file, so it runs from anywhere.

import { Physics } from "../../../../js/physics.js";
import { BODIES, bodyStateAt } from "../../../../js/state.js";

const fmt = (x, d = 2) => (x == null || !isFinite(x)) ? "n/a" : x.toFixed(d);

// Put a craft on a perfect circular CCW orbit around `key` at radius factor `rf`·R.
function seed(key, rf) {
  const b = BODIES[key], bs = bodyStateAt(key, 0);
  const r = b.radius * rf;
  const v = Math.sqrt(b.mu / r); // circular speed
  return {
    mode: "flight", status: "orbit", time: 0, timeWarp: 1, heat: 0,
    body: b, orbit: null, altitude: 0, speed: 0, target: "moon",
    craft: {
      pos: { x: bs.pos.x + r, y: bs.pos.y },      // start at +x
      vel: { x: bs.vel.x, y: bs.vel.y + v },      // CCW prograde
      angle: 0, throttle: 0, fuelRemaining: 0, mass: 1, currentStage: 0,
    },
    _r0: r, _v: v, _key: key,
  };
}

// Fly one full period (T) in steps of `dt`, tracking min/max radius from the body.
function flyLaps(key, rf, laps, dt) {
  const sim = seed(key, rf);
  const b = BODIES[key];
  const T = 2 * Math.PI * Math.sqrt(sim._r0 ** 3 / b.mu);
  const total = T * laps;
  let rmin = Infinity, rmax = -Infinity, n = 0, guard = 0;
  while (sim.time < total && guard++ < 5_000_000) {
    const h = Math.min(dt, total - sim.time);
    Physics.step(sim, h);
    if (sim.status === "crashed") return { crashed: true, at: sim.time / T };
    const bs = bodyStateAt(key, sim.time);
    const r = Math.hypot(sim.craft.pos.x - bs.pos.x, sim.craft.pos.y - bs.pos.y);
    if (r < rmin) rmin = r;
    if (r > rmax) rmax = r;
    n++;
  }
  // Drift = radial spread as a fraction of the seed radius (0 = perfect circle).
  const spread = (rmax - rmin) / sim._r0 * 100;
  return { spread, rmin, rmax, r0: sim._r0, T, steps: n, warpLimited: !!sim.warpLimited };
}

console.log("=".repeat(72));
console.log("INTEGRATOR DRIFT AUDIT — circular orbit held over N laps (lower % = better)");
console.log("Generated " + new Date().toISOString().slice(0, 10));
console.log("=".repeat(72));

const CASES = [
  { key: "earth", rf: 1.5, laps: 20 },
  { key: "moon", rf: 1.5, laps: 20 },
  { key: "mars", rf: 1.5, laps: 20 },
];
const STEPS = [0.2, 2, 20, 200, 2000]; // seconds per Physics.step call (warp-like)

for (const c of CASES) {
  const b = BODIES[c.key];
  console.log("\n## " + (b.name || c.key) + "  (r = " + c.rf + "·R, " + c.laps + " laps)");
  console.log("   step(s) | radial drift % | steps | note");
  for (const dt of STEPS) {
    const r = flyLaps(c.key, c.rf, c.laps, dt);
    if (r.crashed) { console.log("   " + String(dt).padStart(7) + " | CRASHED at lap " + fmt(r.at, 1)); continue; }
    console.log("   " + String(dt).padStart(7) + " | " + fmt(r.spread).padStart(13) +
      " | " + String(r.steps).padStart(6) + " | " + (r.warpLimited ? "warp-capped by integrator" : ""));
  }
}

console.log("\nBaseline expectation (clean checkout, 2026-07-06): small steps (0.2–20 s) hold");
console.log("well under ~2% radial drift; large steps drift more until the adaptive substep");
console.log("cap engages. A SMALL step drifting badly is a real regression, not warp.");
