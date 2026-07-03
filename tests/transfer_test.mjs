// Moon-transfer window tests (node, no browser). Run: node transfer_test.mjs
// Verifies Physics.transferWindow: sane fields, guarded cases, periodicity, and the real
// proof — burning prograde at the indicated moment from circular LEO reaches the Moon's SOI.
import { Physics } from "../js/physics.js";
import { BODIES, newSimState, bodyStateAt } from "../js/state.js";
// The world is heliocentric now (Phase 4): Earth-relative test coordinates get offset by
// Earth's world state at the sim's time.
const EW = (t = 0) => bodyStateAt("earth", t);

const E = BODIES.earth;
const M = BODIES.moon;
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// Build a sim coasting in a circular Earth orbit of radius r at time t.
// dir=+1 CCW (same way as the Moon), dir=-1 CW (retrograde).
function circularSim(r, t = 0, angleOnOrbit = 0, dir = +1) {
  const v = Math.sqrt(E.mu / r);
  const e = EW(t);
  const sim = newSimState(E, t);
  sim.mode = "flight"; sim.status = "orbit"; sim.time = t;
  sim.craft.pos = { x: e.pos.x + r * Math.cos(angleOnOrbit), y: e.pos.y + r * Math.sin(angleOnOrbit) };
  sim.craft.vel = { x: e.vel.x - dir * v * Math.sin(angleOnOrbit), y: e.vel.y + dir * v * Math.cos(angleOnOrbit) };
  sim.craft.mass = 6; sim.craft.throttle = 0;
  return sim;
}

const rLEO = E.radius + E.atmosphere.height + 50000; // comfortable circular LEO

// --- 1. No guidance on the launchpad (not in orbit) ---
{
  const sim = newSimState(E);
  check("null when not in orbit", Physics.transferWindow(sim) === null);
}

// --- 2. Sane fields from circular LEO ---
{
  const sim = circularSim(rLEO);
  const tw = Physics.transferWindow(sim);
  const e = EW(sim.time);
  const rBurn = tw ? Math.hypot(tw.burnPos.x - e.pos.x, tw.burnPos.y - e.pos.y) : 0;
  check("window object from LEO", !!tw, tw ? `degToGo=${tw.degToGo.toFixed(1)}` : "null");
  check("degToGo in [0,360)", tw && tw.degToGo >= 0 && tw.degToGo < 360, tw && tw.degToGo.toFixed(1));
  check("transfer time positive & plausible", tw && tw.transferTime_s > 0 &&
    tw.transferTime_s < Math.PI * Math.sqrt(M.orbitRadius ** 3 / E.mu), // < half a Moon-radius-orbit period
    tw && `${(tw.transferTime_s / 3600).toFixed(1)} h`);
  check("burnPos sits on the current orbit", tw && Math.abs(rBurn - rLEO) / rLEO < 0.01,
    tw && `rBurn=${(rBurn / 1000).toFixed(0)} km vs r=${(rLEO / 1000).toFixed(0)} km`);
  // Apollo's real TLI lead angle was ~120 deg; the scaled world should be the same ballpark.
  check("lead angle plausible (90..180 deg)", tw && tw.leadAngle_deg > 90 && tw.leadAngle_deg < 180,
    tw && `${tw.leadAngle_deg.toFixed(0)} deg`);
}

// --- 3. Retrograde (CW) orbit: no guidance, gracefully ---
{
  const sim = circularSim(rLEO, 0, 0, -1);
  check("null for retrograde orbit", Physics.transferWindow(sim) === null);
}

// --- 4. Apoapsis already near the Moon: no guidance ---
{
  // Ellipse from LEO out to 0.8x the Moon's distance — well past the "well below" bar.
  const rApo = M.orbitRadius * 0.8;
  const a = (rLEO + rApo) / 2;
  const vP = Math.sqrt(E.mu * (2 / rLEO - 1 / a));
  const e = EW(0);
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "orbit";
  sim.craft.pos = { x: e.pos.x + rLEO, y: e.pos.y }; sim.craft.vel = { x: e.vel.x, y: e.vel.y + vP };
  sim.craft.mass = 6; sim.craft.throttle = 0;
  check("null once apoapsis reaches high", Physics.transferWindow(sim) === null);
}

// --- 5. Periodicity: the window recurs once per synodic period, degToGo stays sane ---
{
  // Propagate the circular orbit ANALYTICALLY (angle = n*t) and sample the pure function.
  const n = Math.sqrt(E.mu / (rLEO ** 3));
  const synodic = (2 * Math.PI) / (n - M.omega);
  const dt = 5;
  let opens = [], prevOpen = false, allSane = true;
  for (let t = 0; t < 2.5 * synodic; t += dt) {
    const sim = circularSim(rLEO, t, n * t);
    const tw = Physics.transferWindow(sim);
    if (!tw || !(tw.degToGo >= 0 && tw.degToGo < 360)) { allSane = false; break; }
    if (tw.open && !prevOpen) opens.push(t);
    prevOpen = tw.open;
  }
  check("window fields sane over 2.5 synodic periods", allSane);
  check("window recurs each synodic period", opens.length >= 2,
    `openings at t=${opens.map((t) => (t / 3600).toFixed(2) + "h").join(", ")}`);
  if (opens.length >= 2) {
    const gap = opens[1] - opens[0];
    check("recurrence gap ≈ synodic period", Math.abs(gap - synodic) / synodic < 0.05,
      `gap=${(gap / 3600).toFixed(2)}h vs synodic=${(synodic / 3600).toFixed(2)}h`);
  }
}

// --- 6. THE mission test: coast to the window, burn prograde, reach the Moon's SOI ---
{
  const sim = circularSim(rLEO);
  // One Sparrow: ~36 m/s^2 — near-impulsive vs the 30-min orbit, but gentle enough that a
  // 0.1 s controller step (~4 m/s) can cut the burn precisely AT Moon-distance apoapsis.
  // (A Hawk at 0.5 s steps adds 50 m/s per step; near-Hohmann speed that one step is the
  // difference between apo at the Moon and apo near escape — the phasing gets wrecked.)
  sim.craft.thrust = 215; sim.craft.exhaustVelocity = 2800;
  sim.craft.fuelRemaining = 4; sim.craft.mass = 6;
  sim.craft.throttle = 0;

  // Phase A: coast until the window is nearly centered (tight threshold: the test is the
  // proof the MOMENT is right, so burn as close to it as stepping allows).
  let tw = null, steps = 0;
  while (steps < 500000) {
    Physics.step(sim, 2);
    steps++;
    tw = Physics.transferWindow(sim);
    if (tw && (tw.degToGo <= 3 || tw.degToGo >= 357)) break;
  }
  check("coasted to an open window", !!tw && (tw.degToGo <= 3 || tw.degToGo >= 357),
    tw ? `degToGo=${tw.degToGo.toFixed(2)} after ${(sim.time / 60).toFixed(0)} min` : "never");

  // Phase B: coarse burn controller — point prograde, full throttle, until apoapsis
  // reaches the Moon's orbit radius; then cut and coast.
  let burnT = 0;
  while (burnT < 600) {
    // Prograde RELATIVE TO EARTH — world velocity is dominated by Earth's solar orbit.
    const eNow = EW(sim.time);
    const v = { x: sim.craft.vel.x - eNow.vel.x, y: sim.craft.vel.y - eNow.vel.y };
    sim.craft.angle = Math.atan2(-v.x, v.y); // heading vec (-sin a, cos a) parallel to v
    sim.craft.throttle = 1;
    Physics.step(sim, 0.1);
    burnT += 0.1;
    const o = Physics.computeOrbit(sim);
    if (o && isFinite(o.apoapsis) && E.radius + o.apoapsis >= M.orbitRadius) break;
  }
  sim.craft.throttle = 0;
  const oAfter = Physics.computeOrbit(sim);
  check("burn raised apoapsis to ~Moon distance (no wild overshoot)",
    oAfter && isFinite(oAfter.apoapsis) &&
    E.radius + oAfter.apoapsis >= M.orbitRadius * 0.98 &&
    E.radius + oAfter.apoapsis <= M.orbitRadius * 1.6,
    `apoR=${((E.radius + (oAfter ? oAfter.apoapsis : 0)) / 1e6).toFixed(1)} Mm vs Moon at ${(M.orbitRadius / 1e6).toFixed(1)} Mm, burn ${burnT.toFixed(1)}s`);

  // Phase C: coast — we must fall into the Moon's SOI within a few transfer times.
  const tLimit = sim.time + 3 * tw.transferTime_s;
  let minMoonDist = Infinity;
  while (sim.time < tLimit && sim.soi !== "Moon" && sim.status !== "crashed") {
    Physics.step(sim, 10);
    if (sim.distMoon < minMoonDist) minMoonDist = sim.distMoon;
  }
  check("reached the Moon's SOI", sim.soi === "Moon",
    `soi=${sim.soi} closest=${(minMoonDist / 1000).toFixed(0)} km (SOI=${(M.soiRadius / 1000).toFixed(0)} km)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
