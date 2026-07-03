// Parachute physics tests (node, no browser). Run: node chute_test.mjs
import { Physics } from "../js/physics.js";
import { BODIES, newSimState, bodyStateAt } from "../js/state.js";

const E = BODIES.earth;
const EW = (t = 0) => bodyStateAt("earth", t); // heliocentric world: offset by Earth's state
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

function fallFrom(altStart, { chutes = 0, deployed = false, mass = 1.5 } = {}) {
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying";
  const r = E.radius + altStart;
  const e = EW(0);
  sim.craft.pos = { x: e.pos.x, y: e.pos.y + r }; sim.craft.vel = { x: e.vel.x, y: e.vel.y };
  sim.craft.mass = mass; sim.craft.throttle = 0;
  sim.craft.chuteCount = chutes; sim.craft.chuteDeployed = deployed;
  let maxSpeed = 0, steps = 0, lastSpeed = 0;
  while (sim.status !== "landed" && sim.status !== "crashed" && steps < 400000) {
    Physics.step(sim, 0.05); steps++;
    maxSpeed = Math.max(maxSpeed, sim.speed);
    lastSpeed = sim.speed;
  }
  return { sim, maxSpeed, lastSpeed };
}

// --- 1. Free fall from 3 km with a DEPLOYED chute: soft landing ---
{
  const { sim, lastSpeed } = fallFrom(3000, { chutes: 1, deployed: true });
  check("chute drop from 3 km lands softly", sim.status === "landed",
    `status=${sim.status} touchdown speed≈${lastSpeed.toFixed(1)} m/s`);
}

// --- 2. Same drop with NO chute: crash ---
{
  const { sim, lastSpeed } = fallFrom(3000, { chutes: 0 });
  check("same drop without chute crashes", sim.status === "crashed",
    `status=${sim.status} impact≈${lastSpeed.toFixed(1)} m/s`);
}

// --- 3. Deployed chute does NOT open in vacuum high above the atmosphere ---
{
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "orbit";
  const r = E.radius + E.atmosphere.height + 100000;
  const v = Math.sqrt(E.mu / r);
  const e = EW(0);
  sim.craft.pos = { x: e.pos.x + r, y: e.pos.y }; sim.craft.vel = { x: e.vel.x, y: e.vel.y + v };
  sim.craft.mass = 1.5; sim.craft.throttle = 0;
  sim.craft.chuteCount = 1; sim.craft.chuteDeployed = true;
  for (let i = 0; i < 2000; i++) Physics.step(sim, 0.05);
  const altNow = sim.altitude;
  check("chute never opens in vacuum (orbit unchanged)",
    sim.chuteOpen === false && Math.abs(altNow - (E.atmosphere.height + 100000)) < 2000,
    `chuteOpen=${sim.chuteOpen} alt=${(altNow/1000).toFixed(1)}km`);
}

// --- 4. Chute doesn't open above 250 m/s, opens after drag slows the craft ---
{
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying";
  const e4 = EW(0);
  sim.craft.pos = { x: e4.pos.x, y: e4.pos.y + E.radius + 6000 };
  sim.craft.vel = { x: e4.vel.x, y: e4.vel.y - 400 }; // diving at 400 m/s inside the atmosphere
  sim.craft.mass = 1.5; sim.craft.throttle = 0;
  sim.craft.chuteCount = 1; sim.craft.chuteDeployed = true;
  Physics.step(sim, 0.05);
  const closedAtSpeed = sim.chuteOpen === false;
  let opened = false, steps = 0;
  while (sim.status === "flying" && steps < 20000) {
    Physics.step(sim, 0.05); steps++;
    if (sim.chuteOpen) { opened = true; break; }
  }
  check("chute stays shut >250 m/s, opens once slowed", closedAtSpeed && opened,
    `closedAt400=${closedAtSpeed} openedLater=${opened} status=${sim.status}`);
}

// --- 5. Chute on the MOON does nothing (no air): fast fall stays fast, crashes ---
{
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying";
  const m0 = bodyStateAt("moon", 0); // world (Sun-centered) state of the Moon
  const M = BODIES.moon;
  // 5 km above the lunar surface, falling at 30 m/s relative to the Moon.
  const r = M.radius + 5000;
  sim.craft.pos = { x: m0.pos.x + r, y: m0.pos.y };
  sim.craft.vel = { x: m0.vel.x - 30, y: m0.vel.y };
  sim.craft.mass = 1.5; sim.craft.throttle = 0;
  sim.craft.chuteCount = 1; sim.craft.chuteDeployed = true;
  let everOpen = false, steps = 0;
  while (sim.status !== "landed" && sim.status !== "crashed" && steps < 100000) {
    Physics.step(sim, 0.05); steps++;
    if (sim.chuteOpen) everOpen = true;
  }
  check("chute useless on the airless Moon", sim.status === "crashed" && !everOpen,
    `status=${sim.status} everOpen=${everOpen}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
