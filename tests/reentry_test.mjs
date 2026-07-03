// Reentry heating + Ap/Pe orientation test for space-sim physics (node, no browser).
import { pathToFileURL } from "url";
const base = "/Users/marissafamularo/Desktop/CoworkProjects/Kids Games/space-sim/js/";
const { Physics } = await import(pathToFileURL(base + "physics.js"));
const { BODIES, newSimState, bodyStateAt } = await import(pathToFileURL(base + "state.js"));

const E = BODIES.earth;
const EW = (t = 0) => bodyStateAt("earth", t); // heliocentric world: offset by Earth's state
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// --- 1. LEO regression: circular orbit stays circular, no spurious heating in vacuum ---
{
  const alt = E.atmosphere.height + 100000;
  const r = E.radius + alt;
  const v = Math.sqrt(E.mu / r);
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "orbit";
  const e = EW(0);
  sim.craft.pos = { x: e.pos.x + r, y: e.pos.y }; sim.craft.vel = { x: e.vel.x, y: e.vel.y + v };
  sim.craft.mass = 2; sim.craft.throttle = 0;
  const period = 2 * Math.PI * Math.sqrt(r * r * r / E.mu);
  for (let t = 0; t < period; t += 0.05) Physics.step(sim, 0.05);
  const altNow = sim.altitude;
  check("LEO circular orbit stable", Math.abs(altNow - alt) / alt < 0.01, `alt drift ${((altNow-alt)/alt*100).toFixed(2)}%`);
  check("no heating in vacuum", (sim.heat || 0) === 0, `heat=${sim.heat}`);
  const o = Physics.computeOrbit(sim);
  check("periAngle present + finite", typeof o.periAngle === "number" && isFinite(o.periAngle));
}

// --- 2. Ap/Pe orientation: elliptical orbit's periapsis direction must be FIXED in space ---
{
  const rPeri = E.radius + 20000;
  const rApo = E.radius + 200000;
  const a = (rPeri + rApo) / 2;
  const vPeri = Math.sqrt(E.mu * (2 / rPeri - 1 / a));
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "orbit";
  // periapsis on +X axis (Earth-relative), moving +Y -> periAngle should be ~0 and stay ~0
  const e = EW(0);
  sim.craft.pos = { x: e.pos.x + rPeri, y: e.pos.y }; sim.craft.vel = { x: e.vel.x, y: e.vel.y + vPeri };
  sim.craft.mass = 2; sim.craft.throttle = 0;
  const angles = [];
  for (let i = 0; i < 5; i++) {
    for (let t = 0; t < 300; t += 0.05) Physics.step(sim, 0.05);
    angles.push(Physics.computeOrbit(sim).periAngle);
  }
  const maxDev = Math.max(...angles.map(x => Math.abs(x)));
  check("periapsis direction fixed in space", maxDev < 0.02, `max |periAngle| = ${maxDev.toFixed(4)} rad (want ~0)`);
}

// --- 3. Normal shallow deorbit from LEO: glows but SURVIVES to the ground ---
{
  // Elliptical orbit dipping into the atmosphere: peri 2 km, apo 30 km. A plausible kid deorbit.
  const rPeri = E.radius + 2000;
  const rApo = E.radius + 30000;
  const a = (rPeri + rApo) / 2;
  const vApo = Math.sqrt(E.mu * (2 / rApo - 1 / a));
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying";
  const e = EW(0);
  sim.craft.pos = { x: e.pos.x + rApo, y: e.pos.y }; sim.craft.vel = { x: e.vel.x, y: e.vel.y - vApo }; // heading down-orbit
  sim.craft.mass = 1.5; sim.craft.throttle = 0;
  let maxHeat = 0, steps = 0;
  while (sim.status !== "landed" && sim.status !== "crashed" && steps < 400000) {
    Physics.step(sim, 0.05); maxHeat = Math.max(maxHeat, sim.heat || 0); steps++;
  }
  check("shallow reentry survives", sim.status !== "crashed" || !sim.burnedUp,
    `status=${sim.status} burnedUp=${!!sim.burnedUp} maxHeat=${maxHeat.toFixed(2)}`);
  check("shallow reentry glows visibly", maxHeat > 0.15, `maxHeat=${maxHeat.toFixed(2)} (want >0.15)`);
}

// --- 4. Steep, fast dive (Moon-return speed straight down): BURNS UP ---
{
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying";
  const r0 = E.radius + 50000;
  const vEsc = Math.sqrt(2 * E.mu / (E.radius + 8000)); // ~escape speed = lunar return energy
  const e = EW(0);
  sim.craft.pos = { x: e.pos.x + r0, y: e.pos.y };
  sim.craft.vel = { x: e.vel.x - vEsc, y: e.vel.y + vEsc * 0.05 }; // nearly straight down, tiny sideways
  sim.craft.mass = 1.5; sim.craft.throttle = 0;
  let maxHeat = 0, steps = 0;
  while (sim.status !== "landed" && sim.status !== "crashed" && steps < 200000) {
    Physics.step(sim, 0.05); maxHeat = Math.max(maxHeat, sim.heat || 0); steps++;
  }
  check("steep lunar-return dive burns up", sim.burnedUp === true,
    `status=${sim.status} burnedUp=${!!sim.burnedUp} maxHeat=${maxHeat.toFixed(2)}`);
}

// --- 5. Ascent through atmosphere does NOT cook the ship ---
{
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying";
  const e = EW(0);
  sim.craft.pos = { x: e.pos.x, y: e.pos.y + E.radius };
  sim.craft.vel = { x: e.vel.x, y: e.vel.y };
  sim.craft.mass = 6; sim.craft.throttle = 1;
  sim.craft.thrust = 215; sim.craft.exhaustVelocity = 2800; sim.craft.fuelRemaining = 4;
  let maxHeat = 0;
  for (let t = 0; t < 120; t += 0.05) { Physics.step(sim, 0.05); maxHeat = Math.max(maxHeat, sim.heat || 0); if (sim.status === "crashed") break; }
  check("launch ascent stays cool", maxHeat < 0.2, `maxHeat=${maxHeat.toFixed(3)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
