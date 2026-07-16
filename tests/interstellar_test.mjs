// Interstellar Phase B tests: real (scaled) star distances from the galaxy map's own
// geometry — calibrated so Pandora sits at Alpha Centauri's true 4.37 ly — and the
// flip-and-brake dynamics the nav panel coaches.
// Run: node tests/interstellar_test.mjs
import { interstellarVector, galaxyPos, GAME_LY } from "../js/stargen.js";
import { Physics } from "../js/physics.js";
import { BODIES, newSimState } from "../js/state.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};
const approx = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);

// --- 1. The calibration: Pandora sits at the REAL Alpha Centauri distance ---
{
  const v = interstellarVector(null, "Pandora");
  check("Sol → Pandora = 4.37 ly (real Alpha Centauri)", approx(v.ly, 4.37, 1e-9), `${v.ly}`);
  check("meters = ly × GAME_LY (10x-scaled universe)",
    approx(v.meters, 4.37 * GAME_LY, 1e-9), v.meters.toExponential(3));
  const p = galaxyPos("Pandora"), m = Math.hypot(p.x, p.y);
  check("direction matches the galaxy map's own geometry",
    approx(v.dir.x, p.x / m, 1e-9) && approx(v.dir.y, p.y / m, 1e-9), "");
}

// --- 2. The neighborhood is deterministic, sane, and symmetric ---
{
  for (const seed of ["Youngcow", "Kerbol", "Snakestar", "Neon"]) {
    const v = interstellarVector(null, seed);
    const v2 = interstellarVector(null, seed);
    check(`Sol → ${seed}: deterministic, believable (0.5–20 ly)`,
      v.ly === v2.ly && v.ly > 0.5 && v.ly < 20, `${v.ly.toFixed(2)} ly`);
  }
  const ab = interstellarVector("Youngcow", "Pandora");
  const ba = interstellarVector("Pandora", "Youngcow");
  check("A→B distance equals B→A", approx(ab.ly, ba.ly, 1e-12), `${ab.ly.toFixed(3)}`);
  check("A→B direction is the reverse of B→A",
    approx(ab.dir.x, -ba.dir.x, 1e-9) && approx(ab.dir.y, -ba.dir.y, 1e-9), "");
  check("same star → null (no zero-length course)", interstellarVector("Pandora", "Pandora") === null, "");
  check("@sol aliases Sol on both ends",
    approx(interstellarVector("@sol", "Youngcow").ly, interstellarVector(null, "Youngcow").ly, 1e-12), "");
}

// --- 3. Flip-and-brake dynamics: the panel's stop-distance is honestly conservative ---
{
  // A beam-drive cruiser in deep interstellar space (star gravity ~1e-11 m/s² here).
  const sim = newSimState(BODIES.earth, 0);
  sim.mode = "flight"; sim.status = "flying"; sim.time = 0;
  sim.craft.pos = { x: 4e14, y: 0 };
  sim.craft.vel = { x: 0, y: 0 };
  sim.craft.angle = 0; // heading +Y
  sim.craft.mass = 40; sim.craft.fuelRemaining = 30;
  sim.craft.thrust = 700; sim.craft.exhaustVelocity = 2e6;
  sim.craft.throttle = 1;
  // Accelerate along +Y for exactly two 4,000 s warped frames (8,000 s of burn).
  Physics.step(sim, 4000);
  Physics.step(sim, 4000);
  const vCruise = Math.hypot(sim.craft.vel.x, sim.craft.vel.y);
  // Predicted BEFORE running: Δv = ve·ln(m0/m1) = 2e6·ln(40/37.2) ≈ 145.1 km/s.
  check("cruise Δv matches Tsiolkovsky (~145 km/s)", approx(vCruise, 145100, 0.01),
    `${(vCruise / 1000).toFixed(1)} km/s`);
  // The UI's stop-distance estimate at THIS instant (initial accel, mass as-is):
  const a0 = (sim.craft.thrust * 1000) / (sim.craft.mass * 1000);
  const brakeEst = (vCruise * vCruise) / (2 * a0);
  // Flip and burn until the closing speed is dead.
  sim.craft.angle = Math.PI; // heading -Y: retrograde
  const y0 = sim.craft.pos.y;
  let guard = 0;
  while (sim.craft.vel.y > 0 && guard++ < 400 && sim.craft.fuelRemaining > 1e-9) {
    Physics.step(sim, 200);
  }
  const stopped = sim.craft.vel.y <= 0;
  const brakeReal = sim.craft.pos.y - y0;
  check("flip-and-burn kills the closing speed before the tank dies", stopped,
    `vy=${sim.craft.vel.y.toFixed(1)} fuel=${sim.craft.fuelRemaining.toFixed(2)}`);
  check("real stop-distance ≤ the panel's estimate (ship lightens as it brakes)",
    brakeReal <= brakeEst * 1.02, `real=${brakeReal.toExponential(2)} est=${brakeEst.toExponential(2)}`);
  check("estimate is tight, not wildly padded (within 2x)", brakeReal > brakeEst * 0.5,
    `ratio=${(brakeReal / brakeEst).toFixed(2)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
