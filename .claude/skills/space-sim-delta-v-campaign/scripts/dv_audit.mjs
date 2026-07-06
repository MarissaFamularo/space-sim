// dv_audit.mjs — PHASE 0 baseline for the Δv/fuel balance campaign.
//
// What it does (pure node, no browser, no side effects):
//   1. Builds reference stock stacks and computes the TRUE per-stage Δv/TWR ladder
//      (replicating builder.js reflowStages + main.js activeStage staging math).
//   2. Compares against the HUD number (state.js computeStats) so you know how far
//      the number the kid SEES diverges from staged truth.
//   3. FLIES a scripted gravity-turn ascent to LEO with Physics.step (losses included),
//      and a Mars surface->orbit ascent with the lander stage — real integrator, real
//      drag, real staging. Δv spent is measured by the rocket equation per step.
//   4. Derives the Mars round-trip requirement ledger analytically from BODIES
//      (taught flow: escape, then Hohmann window — matching the game's guidance),
//      walks it against the stage ladder, and prints the MARGIN.
//
// Run:  node .claude/skills/space-sim-delta-v-campaign/scripts/dv_audit.mjs
// (from the repo root or anywhere — imports are relative to this file)

import { Physics } from "../../../../js/physics.js";
import { BODIES, bodyStateAt, computeStats } from "../../../../js/state.js";
import { PARTS } from "../../../../js/parts.js";

const E = BODIES.earth, MARS = BODIES.mars, SUN = BODIES.sun, MOON = BODIES.moon;
const fmt = (x, d = 0) => (x == null || !isFinite(x)) ? "  n/a" : x.toFixed(d);
const line = (s = "") => console.log(s);

// ---------------------------------------------------------------------------
// Reference stacks (part ids bottom -> top, exactly the builder's array order).
// Engine-on-engine = cluster (same stage); decoupler ends the stage below it.
// ---------------------------------------------------------------------------
const STACKS = {
  "Trainer (Moon-class, 2 stages)": [
    "engine_hawk", "tank_large", "decoupler",
    "engine_sparrow", "tank_small", "landing_legs", "command_pod", "parachute",
  ],
  "Kestrel Mars ship (3 stages, Mega/Hawk/Osprey)": [
    "engine_hawk", "tank_mega", "decoupler",
    "engine_hawk", "tank_mega", "decoupler",
    "engine_osprey", "tank_small", "landing_legs", "command_pod", "parachute",
  ],
  "Heavy Mars variant (clustered booster)": [
    "engine_hawk", "engine_hawk", "tank_mega", "tank_mega", "decoupler",
    "engine_hawk", "tank_mega", "decoupler",
    "engine_osprey", "tank_small", "landing_legs", "command_pod", "parachute",
  ],
};

const findDef = (id) => PARTS.find((p) => p.id === id);

// Replicates builder.js reflowStages (incl. the bottom-rover-cargo exception).
function stampStages(ids) {
  let stage = 0, bottomCargo = true;
  const insts = ids.map((partId) => ({ partId, stage: 0 }));
  for (const inst of insts) {
    inst.stage = stage;
    const def = findDef(inst.partId);
    if (!def) continue;
    if (def.type === "decoupler") {
      if (bottomCargo) bottomCargo = false;
      else stage += 1;
    } else if (def.type !== "rover") bottomCargo = false;
  }
  return insts;
}

// Replicates main.js activeStage for stage n.
function stageStats(insts, n) {
  let thrust = 0, veSum = 0, engines = 0, fuel = 0, startMass = 0;
  for (const inst of insts) {
    const def = findDef(inst.partId);
    if (!def) continue;
    if (inst.stage >= n) startMass += (def.dryMass || 0) + (def.fuelMass || 0);
    if (inst.stage === n) {
      if (def.type === "engine") { thrust += def.thrust || 0; veSum += def.exhaustVelocity || 0; engines++; }
      fuel += def.fuelMass || 0;
    }
  }
  return { thrust, ve: engines ? veSum / engines : 0, fuel, startMass };
}

function stageLadder(ids) {
  const insts = stampStages(ids);
  const maxStage = insts.reduce((m, i) => Math.max(m, i.stage), 0);
  const ladder = [];
  for (let n = 0; n <= maxStage; n++) {
    const s = stageStats(insts, n);
    const endMass = s.startMass - s.fuel;
    const dv = s.ve > 0 && s.fuel > 0 ? s.ve * Math.log(s.startMass / endMass) : 0;
    ladder.push({ n, ...s, endMass, dv,
      twrEarth: s.thrust / (s.startMass * E.g0),
      twrMars: s.thrust / (s.startMass * MARS.g0) });
  }
  return { insts, ladder, totalDv: ladder.reduce((a, s) => a + s.dv, 0) };
}

// ---------------------------------------------------------------------------
// Scripted ascent: pitch-program gravity turn -> coast to apoapsis -> circularize.
// Measures Δv actually SPENT (ve * ln(m0/m1) per step): gravity + drag + steering
// losses all land in the number, because the real integrator flies it.
// ---------------------------------------------------------------------------
function flyToOrbit(stages, bodyKey, targetAlt, t0 = 0) {
  const B = BODIES[bodyKey];
  const bs = bodyStateAt(bodyKey, t0);
  const sim = {
    mode: "flight", status: "flying", time: t0, timeWarp: 1, heat: 0,
    body: B, orbit: null, altitude: 0, speed: 0, target: "moon",
    craft: { pos: { x: bs.pos.x, y: bs.pos.y + B.radius }, vel: { x: bs.vel.x, y: bs.vel.y },
             angle: 0, throttle: 0, fuelRemaining: 0, mass: 0, currentStage: 0 },
  };
  let sn = 0, dv = 0;
  const load = (n) => { const s = stages[n];
    sim.craft.mass = s.startMass; sim.craft.fuelRemaining = s.fuel;
    sim.craft.thrust = s.thrust; sim.craft.exhaustVelocity = s.ve; sim.craft.currentStage = n; };
  load(0);
  const step = (dt) => {
    const m0 = sim.craft.mass, ve = sim.craft.exhaustVelocity || 0;
    Physics.step(sim, dt);
    if (ve > 0 && sim.craft.mass < m0 && sim.craft.mass > 0)
      dv += ve * Math.log(m0 / sim.craft.mass);
    while (sim.craft.fuelRemaining <= 1e-9 && sn < stages.length - 1) { sn++; load(sn); }
  };
  const rel = () => { const b = bodyStateAt(bodyKey, sim.time);
    return { p: { x: sim.craft.pos.x - b.pos.x, y: sim.craft.pos.y - b.pos.y },
             v: { x: sim.craft.vel.x - b.vel.x, y: sim.craft.vel.y - b.vel.y } }; };
  const dead = () => sim.craft.fuelRemaining <= 1e-9 && sn >= stages.length - 1;
  const atmoTop = (B.atmosphere && B.atmosphere.height) || 0;
  const turnEnd = targetAlt * 0.8;

  // Phase 1: burn on the pitch program until apoapsis reaches the target.
  sim.craft.throttle = 1;
  for (let g = 0; g < 60000; g++) {
    const { p } = rel();
    const r = Math.hypot(p.x, p.y), alt = r - B.radius;
    const ur = { x: p.x / r, y: p.y / r }, ut = { x: -ur.y, y: ur.x }; // CCW "east"
    const th = (Math.PI / 2) * Math.pow(Math.min(1, Math.max(0, alt / turnEnd)), 0.65);
    const d = { x: ur.x * Math.cos(th) + ut.x * Math.sin(th),
                y: ur.y * Math.cos(th) + ut.y * Math.sin(th) };
    sim.craft.angle = Math.atan2(-d.x, d.y);
    step(0.2);
    if (sim.status === "crashed") return { ok: false, why: "crashed during ascent", dv, sim, sn };
    const o = sim.orbit;
    if (o && isFinite(o.apoapsis) && o.apoapsis >= targetAlt) break;
    if (dead()) return { ok: false, why: "out of fuel during ascent", dv, sim, sn };
  }
  sim.craft.throttle = 0;

  // Phase 2: coast to apoapsis.
  for (let g = 0; g < 60000; g++) {
    const { p, v } = rel();
    const r = Math.hypot(p.x, p.y);
    const vr = (v.x * p.x + v.y * p.y) / r;
    const o = sim.orbit;
    if (o && isFinite(o.apoapsis) &&
        (r - B.radius) >= o.apoapsis - Math.max(500, 0.01 * targetAlt)) break;
    if (vr < 0) break; // passed apoapsis
    step(2);
    if (sim.status === "crashed") return { ok: false, why: "fell back during coast", dv, sim, sn };
  }

  // Phase 3: circularize (prograde burn at apoapsis until the orbit is real).
  for (let g = 0; g < 60000; g++) {
    const { v } = rel();
    sim.craft.angle = Math.atan2(-v.x, v.y);
    sim.craft.throttle = 1;
    step(0.2);
    const o = sim.orbit;
    if (o && o.isOrbit && o.periapsis > atmoTop + 0.02 * B.radius) break;
    if (dead()) return { ok: false, why: "out of fuel circularizing", dv, sim, sn };
  }
  sim.craft.throttle = 0;

  // Remaining IDEAL Δv: current stage's leftover fuel + all stages above, rocket eq.
  let remDv = 0;
  {
    const cur = stages[sn];
    const dry = cur.startMass - cur.fuel;
    const mNow = sim.craft.mass;
    if (cur.ve > 0 && mNow > dry) remDv += cur.ve * Math.log(mNow / dry);
    for (let k = sn + 1; k < stages.length; k++) {
      const s = stages[k];
      if (s.ve > 0 && s.fuel > 0) remDv += s.ve * Math.log(s.startMass / (s.startMass - s.fuel));
    }
  }
  return { ok: true, dv, remDv, sim, sn, orbit: sim.orbit };
}

// ---------------------------------------------------------------------------
// Analytic mission ledger (scaled universe, straight from BODIES — no hardcoding).
// TAUGHT FLOW: the game's guidance is "escape the planet, cut engine, then Hohmann
// from the Sun orbit at the window" (HANDOFF key decisions). That flow forgoes the
// Oberth effect; the direct-injection number is printed alongside for comparison.
// ---------------------------------------------------------------------------
function marsLedger(leoAlt, flownAscent, flownMarsAscent) {
  const rL = E.radius + leoAlt;
  const vC = Math.sqrt(E.mu / rL);
  const vEsc = Math.sqrt(2 * E.mu / rL);

  const r1 = E.orbitRadius, r2 = MARS.orbitRadius, aT = (r1 + r2) / 2;
  const vE1 = Math.sqrt(SUN.mu / r1);                 // Earth's solar speed
  const vT1 = Math.sqrt(SUN.mu * (2 / r1 - 1 / aT));  // transfer speed at departure
  const vinfOut = vT1 - vE1;
  const vM = Math.sqrt(SUN.mu / r2);
  const vT2 = Math.sqrt(SUN.mu * (2 / r2 - 1 / aT));
  const vinfIn = vM - vT2;                            // arrival excess at Mars

  const rLM = Math.max(MARS.radius * 1.35,
    MARS.radius + 3 * (MARS.atmosphere ? MARS.atmosphere.height : 0)); // parkingOrbit rule
  const vCM = Math.sqrt(MARS.mu / rLM);
  const vEscM = Math.sqrt(2 * MARS.mu / rLM);
  const dvCapture = Math.sqrt(vinfIn * vinfIn + vEscM * vEscM) - vCM;

  const tTransfer = Math.PI * Math.sqrt(aT ** 3 / SUN.mu);

  // Direct (Oberth) injections, for the comparison row only:
  const dvTmiDirect = Math.sqrt(vinfOut * vinfOut + vEsc * vEsc) - vC;
  const dvTeiDirect = Math.sqrt(vinfOut * vinfOut + vEscM * vEscM) - vCM; // symmetric Hohmann

  const rows = [
    ["Launch to LEO (FLOWN, incl. gravity+drag losses)", flownAscent, "measured by this script"],
    ["Escape Earth from LEO (taught: burn to escape, cut)", vEsc - vC, "analytic"],
    ["Hohmann departure burn at the window (Sun orbit)", vinfOut, "analytic"],
    ["Mid-course corrections, outbound", 150, "ALLOWANCE (est.)"],
    ["Mars capture into low orbit (retro at periapsis)", dvCapture, "analytic"],
    ["Deorbit + powered landing (chute assists, can't finish)", 350, "ALLOWANCE (est.)"],
    ["Mars ascent to low orbit (FLOWN, losses incl.)", flownMarsAscent, "measured by this script"],
    ["Escape Mars from low orbit (taught flow)", vEscM - vCM, "analytic"],
    ["Hohmann return burn (Sun orbit)", vinfIn, "analytic"],
    ["Mid-course corrections, inbound", 150, "ALLOWANCE (est.)"],
    ["Earth arrival (aerobrake + chute)", 0, "free — air does it"],
  ];
  return { rows, total: rows.reduce((a, r) => a + r[1], 0),
           vC, vEsc, rL, rLM, vCM, vEscM, vinfOut, vinfIn, tTransfer,
           dvTmiDirect, dvTeiDirect };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
line("=".repeat(78));
line("Δv AUDIT — stock catalog vs the Mars round trip (scaled universe, SCALE=" +
  (E.radius / 6.371e6).toFixed(2) + ")");
line("Generated " + new Date().toISOString().slice(0, 10) +
  " | Earth R=" + fmt(E.radius / 1000, 1) + " km, mu=" + E.mu.toExponential(3));
line("=".repeat(78));

const results = {};
for (const [name, ids] of Object.entries(STACKS)) {
  const { insts, ladder, totalDv } = stageLadder(ids);
  results[name] = { insts, ladder, totalDv };
  line("\n## " + name);
  line("   stage |  start t |  fuel t | thrust kN |  ve m/s | TWR(E) | TWR(M) |  Δv m/s");
  for (const s of ladder) {
    line("   " + [String(s.n).padStart(5), fmt(s.startMass, 2).padStart(8),
      fmt(s.fuel, 1).padStart(7), fmt(s.thrust).padStart(9), fmt(s.ve).padStart(7),
      fmt(s.twrEarth, 2).padStart(6), fmt(s.twrMars, 2).padStart(6),
      fmt(s.dv).padStart(7)].join(" | "));
  }
  const hud = computeStats({ name, parts: insts }, PARTS);
  line("   staged total Δv = " + fmt(totalDv) + " m/s   (HUD computeStats says " +
    fmt(hud.deltaV) + " m/s — whole-rocket approximation, not staged truth)");
}

// --- Flown ascents ---------------------------------------------------------
const mars3 = results["Kestrel Mars ship (3 stages, Mega/Hawk/Osprey)"];
const leoAlt = E.atmosphere.height + 50000; // same LEO the node tests use
line("\n" + "-".repeat(78));
line("FLOWN ASCENT — Kestrel Mars ship, Earth pad -> " + fmt(leoAlt / 1000) + " km LEO");
const asc = flyToOrbit(mars3.ladder, "earth", leoAlt);
if (asc.ok) {
  line("  reached orbit: Ap " + fmt(asc.orbit.apoapsis / 1000, 1) + " km x Pe " +
    fmt(asc.orbit.periapsis / 1000, 1) + " km, on stage " + asc.sn);
  line("  Δv SPENT to orbit = " + fmt(asc.dv) + " m/s  (ideal circular speed there: " +
    fmt(Math.sqrt(E.mu / (E.radius + leoAlt))) + " m/s -> losses ≈ " +
    fmt(asc.dv - Math.sqrt(E.mu / (E.radius + leoAlt))) + " m/s)");
  line("  ideal Δv remaining in the tanks = " + fmt(asc.remDv) + " m/s");
} else line("  ASCENT FAILED: " + asc.why + " (Δv spent " + fmt(asc.dv) + ")");

// Mars ascent: the lander stage alone (stage 2), full tank, surface -> low Mars orbit.
const landerStage = mars3.ladder[2];
const rLM = Math.max(MARS.radius * 1.35,
  MARS.radius + 3 * (MARS.atmosphere ? MARS.atmosphere.height : 0));
line("\nFLOWN ASCENT — lander stage alone, Mars surface -> " +
  fmt((rLM - MARS.radius) / 1000) + " km orbit (parkingOrbit altitude)");
const mAsc = flyToOrbit([landerStage], "mars", rLM - MARS.radius);
if (mAsc.ok) {
  line("  reached orbit: Ap " + fmt(mAsc.orbit.apoapsis / 1000, 1) + " km x Pe " +
    fmt(mAsc.orbit.periapsis / 1000, 1) + " km");
  line("  Δv SPENT = " + fmt(mAsc.dv) + " m/s (circular there: " +
    fmt(Math.sqrt(MARS.mu / rLM)) + " m/s); ideal Δv left in lander = " + fmt(mAsc.remDv) + " m/s");
} else line("  MARS ASCENT FAILED: " + mAsc.why + " (Δv spent " + fmt(mAsc.dv) + ")");

// --- Requirement ledger + margin --------------------------------------------
const led = marsLedger(leoAlt, asc.ok ? asc.dv : NaN, mAsc.ok ? mAsc.dv : NaN);
line("\n" + "-".repeat(78));
line("MARS ROUND-TRIP REQUIREMENT LEDGER (taught flow: escape, then window)");
for (const [what, dv, basis] of led.rows)
  line("  " + what.padEnd(56) + fmt(dv).padStart(6) + " m/s  [" + basis + "]");
line("  " + "TOTAL REQUIRED".padEnd(56) + fmt(led.total).padStart(6) + " m/s");
line("\n  Reference numbers: LEO v_circ=" + fmt(led.vC) + ", v_esc=" + fmt(led.vEsc) +
  "; Mars low orbit v_circ=" + fmt(led.vCM) + ", v_esc=" + fmt(led.vEscM));
line("  Transfer coast (one way): " + fmt(led.tTransfer / 86400, 1) + " game-days" +
  " (real Mars trip ≈ 8.5 months — teach both!)");
line("  Oberth comparison: direct TMI from LEO would be " + fmt(led.dvTmiDirect) +
  " m/s vs taught " + fmt(led.vEsc - led.vC + led.vinfOut) + " m/s (escape+window);");
line("  direct TEI from low Mars orbit " + fmt(led.dvTeiDirect) + " m/s vs taught " +
  fmt(led.vEscM - led.vCM + led.vinfIn) + " m/s. The taught flow is the requirement.");

line("\n" + "-".repeat(78));
line("MARGIN (capability = staged ideal Δv; requirement includes flown losses)");
for (const [name, r] of Object.entries(results)) {
  const margin = (r.totalDv - led.total) / led.total * 100;
  line("  " + name.padEnd(48) + fmt(r.totalDv).padStart(6) + " m/s vs " +
    fmt(led.total) + " m/s  -> margin " + (margin >= 0 ? "+" : "") + fmt(margin, 1) + "%");
}

// Ledger walk: which stage pays for which leg (Kestrel Mars ship).
line("\nLEDGER WALK — Kestrel Mars ship: which stage pays for which leg");
{
  let si = 0, avail = mars3.ladder.map((s) => s.dv), spentInStage = 0;
  for (const [what, dv] of led.rows) {
    let need = dv, used = [];
    while (need > 1e-9 && si < avail.length) {
      const left = avail[si] - spentInStage;
      const take = Math.min(left, need);
      spentInStage += take; need -= take;
      used.push("S" + si + ":" + fmt(take));
      if (spentInStage >= avail[si] - 1e-9) { si++; spentInStage = 0; }
    }
    line("  " + what.slice(0, 52).padEnd(54) + (need > 1e-9 ?
      "SHORT by " + fmt(need) + " m/s <-- CAMPAIGN TARGET" : used.join(" + ")));
  }
  if (si < avail.length) {
    const left = avail[si] - spentInStage +
      avail.slice(si + 1).reduce((a, b) => a + b, 0);
    line("  Unspent capability after Earth aerobrake: " + fmt(left) + " m/s");
  }
}
line("\nDone. Numbers above are the Phase 0 gate for the Δv campaign skill.");
