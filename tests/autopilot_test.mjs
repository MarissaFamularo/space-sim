// 🤖 Interstellar autopilot tests: fly the WHOLE Sol→Youngcow trip in 1D with the
// pure policy (Physics.autopilotStep) driving throttle/aim, real rocket-equation
// fuel drain, and main.js's exact brake-zone test. Prove: it arrives, it arrives
// SLOW, the half-tank reserve holds, and a fuel-starved engage fails HONESTLY
// (flies through fast, no magic). Run: node tests/autopilot_test.mjs
import { Physics } from "../js/physics.js";
import { PARTS } from "../js/parts.js";
import { findPart } from "../js/state.js";
import { interstellarVector } from "../js/stargen.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

const ARRIVE_R = 4e12; // mirror main.js
const YEAR = 365.25 * 86400;

// The HANDOFF's suggested starship: pod + Annihilation Beam Drive + 6 Mega tanks.
function ship() {
  const pod = findPart(PARTS, "command_pod"), eng = findPart(PARTS, "engine_antimatter"),
        tank = findPart(PARTS, "tank_mega");
  return {
    dry: pod.dryMass + eng.dryMass + 6 * tank.dryMass,
    fuel: 6 * tank.fuelMass,
    thrust: eng.thrust,             // kN
    ve: eng.exhaustVelocity,        // m/s
  };
}

// 1D trip: x from 0 to D, v is the closing speed, policy drives.
function flyTrip({ dry, fuel, thrust, ve }, D, v0) {
  const engageFuel = fuel;
  const mdot = thrust / ve;         // t/s (kN / (m/s) = t/s)
  let x = 0, v = v0, t = 0, fuelMin = fuel, accelSpent = 0;
  const phases = [];
  let fuelAtFirstBrake = null;
  for (let i = 0; i < 2e6; i++) {
    const rem = D - x;
    if (rem < ARRIVE_R) return { arrived: true, v, t, fuel, fuelMin, accelSpent, phases, fuelAtFirstBrake };
    const remEdge = Math.max(0, rem - ARRIVE_R);
    const m = dry + fuel;
    const a = thrust / m;           // kN/t = m/s²
    const brakeDist = v > 0 && a > 0 ? (v * v) / (2 * a) : 0;
    const braking = brakeDist > 0 && remEdge < Math.max(brakeDist * 1.15, rem * 0.15);
    const plan = Physics.autopilotStep({ rem, remEdge, arriveR: ARRIVE_R, vTo: v, vLat: 0,
                                         fuel, engageFuel, braking });
    if (!phases.length || phases[phases.length - 1] !== plan.phase) phases.push(plan.phase);
    if (plan.phase === "brake" && fuelAtFirstBrake === null) fuelAtFirstBrake = fuel;
    // Step size: burns resolve to ~0.5% of the tank; coasts to ~5% of what's left.
    const dt = plan.throttle > 0
      ? Math.max(1, (0.005 * engageFuel) / (mdot * plan.throttle))
      : Math.max(1, Math.min(1e7, remEdge / Math.max(v, 1) / 20));
    const burn = Math.min(fuel, mdot * plan.throttle * dt);
    const dv = burn > 0 ? ve * Math.log(m / (m - burn)) : 0; // exact Tsiolkovsky per step
    v += plan.aim * dv * (plan.throttle > 0 ? 1 : 0);
    if (plan.aim > 0) accelSpent += burn; // fuel spent speeding up (incl. trims)
    fuel -= burn;
    fuelMin = Math.min(fuelMin, fuel);
    x += v * dt;
    t += dt;
  }
  return { arrived: false, v, t, fuel, fuelMin, accelSpent, phases, fuelAtFirstBrake };
}

// --- 1. The flagship trip: Sol -> Youngcow, solar-escape leftover speed ---
{
  const vec = interstellarVector(null, "Youngcow");
  const s = ship();
  const trip = flyTrip(s, vec.meters, 30000);
  const yrs = trip.t / YEAR;
  check("arrives at Youngcow", trip.arrived, `phases=${trip.phases.join("→")}`);
  check("arrival is SLOW (≤ 35 km/s — ready to explore)", trip.v <= 35000,
    `v=${(trip.v / 1000).toFixed(1)} km/s`);
  check("trip is decades, not millennia (honest but flyable)", yrs > 5 && yrs < 200,
    `${yrs.toFixed(1)} game-years over ${vec.ly.toFixed(2)} ly`);
  check("fuel never goes negative", trip.fuelMin >= 0, `min=${trip.fuelMin.toFixed(2)} t`);
  check("half-tank rule: accel spends ≤ 55% of the tank", trip.accelSpent <= s.fuel * 0.55,
    `spent=${trip.accelSpent.toFixed(1)} of ${s.fuel} t`);
  check("the reserve is waiting at the flip", trip.fuelAtFirstBrake !== null && trip.fuelAtFirstBrake >= s.fuel * 0.4,
    `atFlip=${trip.fuelAtFirstBrake && trip.fuelAtFirstBrake.toFixed(1)} t`);
  check("flies the real profile: burn → coast → brake → glide",
    ["burn", "coast", "brake", "glide"].every((p) => trip.phases.includes(p)),
    trip.phases.join("→"));
  check("arrives with fuel to spare (it can still maneuver)", trip.fuel > 0,
    `left=${trip.fuel.toFixed(1)} t`);
}

// --- 2. Honest failure: engaged already screaming, almost no fuel ---
{
  const s = ship();
  const vec = interstellarVector(null, "Youngcow");
  const trip = flyTrip({ ...s, fuel: 2 }, vec.meters, 2.5e6); // 2,500 km/s, 2 t of fuel
  check("fuel-starved trip still terminates (screams through the system)", trip.arrived, "");
  check("…fast — no magic braking", trip.v > 100000, `v=${(trip.v / 1000).toFixed(0)} km/s`);
  check("…and the policy admits it (dry phase reported)", trip.phases.includes("dry"),
    trip.phases.join("→"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
