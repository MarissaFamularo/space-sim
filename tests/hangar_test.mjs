// Hangar-phase tests: wing lift physics + new part validity + player-station math.
// Run: node tests/hangar_test.mjs
import { Physics } from "../js/physics.js";
import { BODIES, newSimState, bodyStateAt } from "../js/state.js";
import { PARTS as STOCK } from "../js/parts.js";
import { validatePartDef } from "../js/mods.js";

const E = BODIES.earth;
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// Level flight through Earth air: nose pitched slightly above the direction of travel.
// Returns altitude after `seconds` of gliding (throttle 0, starting horizontal).
// NOTE the scaled Earth's air tops out at 7,000 m (70 km × SCALE) — glide low.
function glide({ wings = 0, seconds = 6, alt0 = 2000, speed = 120, mass = 3 }) {
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying";
  const e = bodyStateAt("earth", 0);
  const r = E.radius + alt0;
  sim.craft.pos = { x: e.pos.x, y: e.pos.y + r };
  sim.craft.vel = { x: e.vel.x + speed, y: e.vel.y };       // flying local-horizontal (+X)
  sim.craft.angle = -Math.PI / 2 + 0.15;                    // nose ~8.6° above the airflow
  sim.craft.mass = mass; sim.craft.throttle = 0;
  sim.craft.wingCount = wings;
  const steps = Math.round(seconds / 0.02);
  for (let i = 0; i < steps && sim.status === "flying"; i++) Physics.step(sim, 0.02);
  return sim;
}

// --- 1. Wings make lift: the winged glider holds its height far better ---
{
  const plain = glide({ wings: 0 });
  const plane = glide({ wings: 2 });
  check("wings hold altitude vs no wings",
    plane.altitude > plain.altitude + 100,
    `winged alt=${plane.altitude.toFixed(0)}m vs plain=${plain.altitude.toFixed(0)}m after 6s`);
}

// --- 2. No air, no lift: same setup over the Moon changes nothing ---
{
  const M = BODIES.moon;
  const run = (wings) => {
    const sim = newSimState(E);
    sim.mode = "flight"; sim.status = "flying";
    const m = bodyStateAt("moon", 0);
    const r = M.radius + 5000;
    sim.craft.pos = { x: m.pos.x, y: m.pos.y + r };
    sim.craft.vel = { x: m.vel.x + 100, y: m.vel.y };
    sim.craft.angle = -Math.PI / 2 + 0.15;
    sim.craft.mass = 3; sim.craft.throttle = 0;
    sim.craft.wingCount = wings;
    for (let i = 0; i < 200; i++) Physics.step(sim, 0.02);
    return sim.craft.pos;
  };
  const a = run(0), b = run(4);
  const drift = Math.hypot(a.x - b.x, a.y - b.y);
  check("wings do NOTHING over the airless Moon", drift < 0.5,
    `trajectory difference after 4s: ${drift.toFixed(3)} m`);
}

// --- 3. Stall: a huge angle of attack must not give runaway lift (CL is capped) ---
{
  const gentle = glide({ wings: 2, seconds: 3 });
  const simSteep = (() => {
    const sim = newSimState(E);
    sim.mode = "flight"; sim.status = "flying";
    const e = bodyStateAt("earth", 0);
    sim.craft.pos = { x: e.pos.x, y: e.pos.y + E.radius + 2000 };
    sim.craft.vel = { x: e.vel.x + 120, y: e.vel.y };
    sim.craft.angle = -Math.PI / 2 + 1.2; // ~69° — deep past the stall
    sim.craft.mass = 3; sim.craft.throttle = 0; sim.craft.wingCount = 2;
    for (let i = 0; i < 150 && sim.status === "flying"; i++) Physics.step(sim, 0.02);
    return sim;
  })();
  check("stalled wing gains no extra height over gentle AoA",
    isFinite(simSteep.altitude) && simSteep.altitude < gentle.altitude + 2500,
    `stalled alt=${simSteep.altitude.toFixed(0)}m gentle(3s)=${gentle.altitude.toFixed(0)}m`);
}

// --- 4. New Hangar parts are valid PartDefs per the modding validator ---
{
  const NEW_IDS = ["cockpit_swift", "wing_delta", "station_hub", "habitat_module", "centrifuge_ring"];
  for (const id of NEW_IDS) {
    const def = STOCK.find((p) => p.id === id);
    const v = def ? validatePartDef(def) : { ok: false, error: "missing from parts.js" };
    check(`part ${id} exists and validates`, !!def && v.ok, v.ok ? "" : v.error);
  }
}

// --- 5. Player-station math: phase0 = θ − n·t reproduces the deploy point exactly ---
{
  // Deploy at t=5000s from a circular orbit at 2.1 Earth radii, θ=1.234 rad.
  const t = 5000, r = E.radius * 2.1, th = 1.234;
  const n = Math.sqrt(E.mu / (r * r * r));
  const st = { body: "earth", altR: r / E.radius, phase0: th - n * t };
  const stationPosAt = (tt) => {
    const bs = bodyStateAt(st.body, tt);
    const rr = E.radius * st.altR;
    const nn = Math.sqrt(E.mu / (rr * rr * rr));
    const a = st.phase0 + nn * tt;
    return { x: bs.pos.x + rr * Math.cos(a), y: bs.pos.y + rr * Math.sin(a) };
  };
  const bs = bodyStateAt("earth", t);
  const deployPoint = { x: bs.pos.x + r * Math.cos(th), y: bs.pos.y + r * Math.sin(th) };
  const got = stationPosAt(t);
  const err = Math.hypot(got.x - deployPoint.x, got.y - deployPoint.y);
  check("deployed station sits exactly where you deployed it", err < 1,
    `error=${err.toExponential(2)} m`);
  // And a full lap later it's back (circular orbit, same spot in the rotating angle).
  const period = 2 * Math.PI / n;
  const bs2 = bodyStateAt("earth", t + period);
  const expect2 = { x: bs2.pos.x + r * Math.cos(th), y: bs2.pos.y + r * Math.sin(th) };
  const got2 = stationPosAt(t + period);
  const err2 = Math.hypot(got2.x - expect2.x, got2.y - expect2.y);
  check("one full lap returns it to the same local spot", err2 < 1,
    `error=${err2.toExponential(2)} m`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
