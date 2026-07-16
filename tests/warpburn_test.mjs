// Burn-under-time-warp tests (his ask: "burn while time warping — a straight line
// toward your target"). Proves the new adaptive substep caps keep long cruise burns
// HONEST: Tsiolkovsky-accurate fuel/Δv bookkeeping, a genuinely near-straight
// brachistochrone when thrust beats gravity, and a truthful warpLimited flag.
// Run: node tests/warpburn_test.mjs
import { Physics } from "../js/physics.js";
import { BODIES, newSimState } from "../js/state.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// A deep-space cruiser on the Annihilation Beam Drive: 2 AU (scaled) solar orbit,
// prograde, engine lit. Thrust/gravity ≈ 39,000 — gravity is a rounding error here.
function cruiserSim() {
  const r = 2 * 1.496e11 * 0.1; // 2 AU scaled
  const v = Math.sqrt(BODIES.sun.mu / r); // circular solar orbit speed
  const sim = newSimState(BODIES.earth, 0);
  sim.mode = "flight"; sim.status = "flying"; sim.time = 0;
  sim.craft.pos = { x: r, y: 0 };
  sim.craft.vel = { x: 0, y: v };          // CCW prograde = +Y here
  sim.craft.angle = 0;                     // heading 0 = +Y = prograde: burn along track
  sim.craft.mass = 12; sim.craft.fuelRemaining = 6; // tonnes
  sim.craft.thrust = 700; sim.craft.exhaustVelocity = 2e6; // the antimatter drive
  sim.craft.throttle = 1;
  return sim;
}

// --- 1. Substep caps: thrusting no longer pins to 0.1 s in deep space ---
{
  const sim = cruiserSim();
  const h = Physics.maxStableStep(sim);
  // hDv = 80·m/thrustN = 80·12000/700000 ≈ 1.37 s should dominate out here.
  check("cruise-burn substep ≈ 1.4 s (not 0.1)", h > 1.0 && h < 2.0, `h=${h.toFixed(2)} s`);
  sim.craft.throttle = 0;
  check("coasting substep is far larger", Physics.maxStableStep(sim) > 1000,
    `h=${Physics.maxStableStep(sim).toFixed(0)} s`);
}

// --- 2. A full warp burn: Tsiolkovsky-honest and near-straight ---
{
  const sim = cruiserSim();
  const m0 = sim.craft.mass, ve = sim.craft.exhaustVelocity;
  const v0 = Math.hypot(sim.craft.vel.x, sim.craft.vel.y);
  const start = { ...sim.craft.pos };
  const pts = [];
  // Predicted BEFORE running: burn time 6000/(700000/2e6) ≈ 17,143 s;
  // Δv = 2e6·ln(12/6) ≈ 1.386e6 m/s.
  let guard = 0;
  while (sim.craft.fuelRemaining > 1e-6 && guard++ < 40) {
    Physics.step(sim, 5000); // one big warped frame at a time
    pts.push({ ...sim.craft.pos });
  }
  check("tank runs dry in ~4 warped frames (17,143 s of burn)",
    guard >= 4 && guard <= 8 && sim.craft.fuelRemaining <= 1e-6,
    `frames=${guard} fuel=${sim.craft.fuelRemaining}`);
  const v1 = Math.hypot(sim.craft.vel.x, sim.craft.vel.y);
  const dvWant = ve * Math.log(m0 / (m0 - 6));
  check("Δv matches Tsiolkovsky within 1%",
    Math.abs((v1 - v0) - dvWant) / dvWant < 0.01,
    `got ${((v1 - v0) / 1000).toFixed(0)} km/s want ${(dvWant / 1000).toFixed(0)} km/s`);
  check("mass bookkeeping: 6 t of fuel became exhaust",
    Math.abs(sim.craft.mass - (m0 - 6)) < 1e-6, `mass=${sim.craft.mass}`);
  // Straightness: max perpendicular deviation from the start→end chord, vs its length.
  const end = pts[pts.length - 1];
  const cx = end.x - start.x, cy = end.y - start.y;
  const clen = Math.hypot(cx, cy);
  let worst = 0;
  for (const p of pts) {
    const dev = Math.abs((p.x - start.x) * cy - (p.y - start.y) * cx) / clen;
    worst = Math.max(worst, dev / clen);
  }
  check("the burn path is a near-straight line (deviation < 0.5% of chord)",
    worst < 0.005, `worst ${(worst * 100).toFixed(3)}%`);
  check("still flying (no phantom collisions out there)", sim.status === "flying", sim.status);
}

// --- 3. warpLimited stays honest when the frame asks too much ---
{
  const sim = cruiserSim();
  const t0 = sim.time;
  Physics.step(sim, 5e6); // one absurd frame: 5M seconds of full-throttle burning
  check("physics caps the frame and says so", sim.warpLimited === true, "");
  check("time advanced only as far as the substeps flew", sim.time - t0 < 5e6,
    `advanced ${(sim.time - t0).toExponential(2)} s`);
}

// --- 4. Launches keep their fine integration: thrusting near the ground stays tight ---
{
  const sim = newSimState(BODIES.earth, 0);
  sim.mode = "flight"; sim.status = "flying";
  sim.craft.mass = 12; sim.craft.fuelRemaining = 8;
  sim.craft.thrust = 600; sim.craft.exhaustVelocity = 3000; // chemical booster
  sim.craft.throttle = 1;
  const h = Physics.maxStableStep(sim);
  check("thrusting at the pad still integrates finely (h ≤ 0.1 s)", h <= 0.1,
    `h=${h.toFixed(3)} s`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
