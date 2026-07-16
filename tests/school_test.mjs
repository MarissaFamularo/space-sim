// 🎒 Space School tests (node, no browser). Run: node tests/school_test.mjs
//
// Two halves:
//   1. SchoolCore pure logic — the build-order checker, the sticker-book validator,
//      and the flight phase machine (wrong taps are friendly, garbage saves are safe).
//   2. THE SCHOOL FLIGHT, flown with the real Physics — predict-then-check, house
//      style. The school rocket (Sparrow + small tank + pod + chute, one stage) goes
//      STRAIGHT UP; the teacher cuts the engine at the top of the air (space!); it
//      falls back; the chute opens; it lands softly. A 5-year-old's first mission
//      must be un-loseable BY PHYSICS, not by fudge — this suite is the proof.
//
// Predictions (first-principles, before running):
//   m0 = 0.8(pod)+0.1(chute)+0.05(decoupler)+0.3+4.0(tank)+0.5(engine) = 5.75 t,
//   thrust 215 kN, ve 2800 -> TWR ≈ 3.8, mdot ≈ 76.8 kg/s. Ignoring drag, cut at
//   7.1 km comes ~21 s in at ~500-700 m/s -> apogee ≈ 7.1 km + v²/2g ≈ 18-35 km.
//   Falling back hits the 7 km air at well under 1 km/s — far below the ~2.5 km/s
//   of a real orbital reentry — so heating stays mild (heat << 1).
//   WHY THE DECOUPLER IS LOAD-BEARING: unstaged, ~2.3 t of unburned fuel rides home
//   (ballistic coefficient m/CdA ≈ 2900 kg/m²) — the stack never slows below the
//   chute's 250 m/s opening limit in 7 km of air and hits the ground at ~500 m/s.
//   Staged, the pod+chute is 0.9 t (m/CdA ≈ 450): it settles toward ~100 m/s
//   terminal velocity, the chute opens, and it sinks in at ~3.5 m/s — under the
//   5 m/s bare-hull landing limit. Staging IS the survival mechanism.

import { SchoolCore } from "../js/school.js";
import { Physics } from "../js/physics.js";
import { PARTS } from "../js/parts.js";
import { BODIES, newSimState, bodyStateAt } from "../js/state.js";

const E = BODIES.earth;
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// ---- 1. Build order: bottom-up, wrong taps rejected kindly ----
{
  const st = SchoolCore.makeBuildState();
  const wrong = SchoolCore.tryPlace(st, "command_pod");
  check("pod before engine is rejected", !wrong.ok && !wrong.done, `say="${wrong.say}"`);
  check("rejection points at the right part", /ENGINE/.test(wrong.say));
  check("wrong tap doesn't advance the build", st.placed === 0);

  const says = [];
  let done = false;
  for (const pid of SchoolCore.SCHOOL_STACK) {
    const r = SchoolCore.tryPlace(st, pid);
    says.push(r.say);
    check(`placing ${pid} in order is accepted`, r.ok);
    done = r.done;
  }
  check("rocket is done after all five parts", done && st.placed === SchoolCore.SCHOOL_STACK.length);
  check("finished build celebrates", /built a REAL rocket/i.test(says[says.length - 1]));
  const extra = SchoolCore.tryPlace(st, "engine_sparrow");
  check("extra tap after done is harmless", !extra.ok && extra.done);
}

// ---- 2. The card deck covers both stacks (every slot has a card, every card is real) ----
{
  const deck = new Set(SchoolCore.CARDS.map((c) => c.partId));
  const ids = new Set(PARTS.map((p) => p.id));
  for (const [name, stack] of [["up", SchoolCore.SCHOOL_STACK], ["orbit", SchoolCore.ORBIT_STACK]]) {
    check(`every ${name}-stack part has a card`, stack.every((id) => deck.has(id)));
    check(`every ${name}-stack part is a real stock part`, stack.every((id) => ids.has(id)));
  }
  check("every card is a real stock part", [...deck].every((id) => ids.has(id)));
  // The orbit build can be completed with its own deal of cards (per-stack state).
  const st = SchoolCore.makeBuildState(SchoolCore.ORBIT_STACK);
  let done = false;
  for (const pid of SchoolCore.ORBIT_STACK) done = SchoolCore.tryPlace(st, pid).done;
  check("orbit stack builds in order (6 slots incl. BIG FUEL + SHIELD)", done && st.placed === 6);
}

// ---- 3. Sticker book: garbage in storage can never break the school ----
{
  for (const junk of [null, 42, "hi", [], { name: 9, stickers: "x" }, { stickers: { build: "yes" } }]) {
    const c = SchoolCore.validateSaved(junk);
    const okShape = c && c.v === 1 && typeof c.name === "string" &&
      [c.stickers.build, c.stickers.space, c.stickers.land].every((v) => v === false || v === true);
    check(`junk save (${JSON.stringify(junk)}) -> clean book`, okShape);
  }
  const good = SchoolCore.validateSaved({ v: 1, name: "ABCDEFGHIJKLMNOP", stickers: { build: true, space: true, land: false } });
  check("real save round-trips (name capped at 12)",
    good.name === "ABCDEFGHIJKL" && good.stickers.build && good.stickers.space && !good.stickers.land);
}

// ---- 4. Flight phase machine ----
{
  const S = SchoolCore.spaceAltitude();
  check("space line sits just past the top of the air", S > E.atmosphere.height && S < E.atmosphere.height + 1000,
    `line=${S} m, air top=${E.atmosphere.height} m`);
  const f = SchoolCore.flightEvent;
  check("boost below the line: no event", f("boost", { alt: S - 500, status: "flying", descending: false, staged: false, chuteDeployed: false }) === null);
  check("boost past the line -> space", f("boost", { alt: S + 10, status: "flying", descending: false, staged: false, chuteDeployed: false }) === "space");
  check("space + descending -> falling", f("space", { alt: S + 9000, status: "flying", descending: true, staged: false, chuteDeployed: false }) === "falling");
  check("falling + booster dropped -> staged", f("falling", { alt: 15000, status: "flying", descending: true, staged: true, chuteDeployed: false }) === "staged");
  check("staged + chute out -> chute", f("staged", { alt: 2000, status: "flying", descending: true, staged: true, chuteDeployed: true }) === "chute");
  check("chute + landed -> landed", f("chute", { alt: 0, status: "landed", descending: false, staged: true, chuteDeployed: true }) === "landed");
  check("crash interrupts any phase once", f("boost", { alt: 100, status: "crashed" }) === "crashed" &&
    f("crashed", { alt: 0, status: "crashed" }) === null);
  check("engine-out early (never reached space) still coaches the fall",
    f("boost", { alt: 4000, status: "flying", descending: true, staged: false, chuteDeployed: false }) === "falling");
  check("teacher-assist stage altitude leaves room for the auto-chute below it",
    SchoolCore.ASSIST_STAGE_ALT > 2500);
}

// ---- 5. THE SCHOOL FLIGHT, real physics end to end ----
// Mirrors exactly what School + main.js do: full throttle straight up, teacher cuts
// the engine at the space line; on the way down the booster is staged off (her tap,
// or the teacher's assist at 3 km) and the chute opens (her tap, or auto below 2.5 km).
// Stage sums follow the same rule as main.js activeStage + builder reflowStages:
// parts above the decoupler are stage 1; the decoupler falls with the booster.
function stageNumbers(stageNum) {
  const cut = SchoolCore.SCHOOL_STACK.indexOf("decoupler");
  let mass = 0, thrust = 0, ve = 0, engines = 0, fuel = 0, chutes = 0;
  SchoolCore.SCHOOL_STACK.forEach((id, i) => {
    const stage = i > cut ? 1 : 0;
    if (stage < stageNum) return;
    const d = PARTS.find((p) => p.id === id);
    mass += (d.dryMass || 0) + (d.fuelMass || 0);
    if (stage === stageNum) {
      fuel += d.fuelMass || 0;
      if (d.type === "engine") { thrust += d.thrust; ve += d.exhaustVelocity; engines++; }
    }
    if (d.type === "chute") chutes++;
  });
  return { mass, thrust, ve: engines ? ve / engines : 0, fuel, chutes };
}

function flySchoolMission({ kidTaps }) {
  const S = SchoolCore.spaceAltitude();
  const n0 = stageNumbers(0);
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying";
  sim.craft.mass = n0.mass; sim.craft.thrust = n0.thrust; sim.craft.exhaustVelocity = n0.ve;
  sim.craft.fuelRemaining = n0.fuel; sim.craft.chuteCount = n0.chutes;
  sim.craft.throttle = 1;
  const doStage = () => {  // what main.js loadStage(1) computes for the upper stage
    const n1 = stageNumbers(1);
    sim.craft.currentStage = 1;
    sim.craft.mass = n1.mass; sim.craft.thrust = n1.thrust; sim.craft.exhaustVelocity = n1.ve;
    sim.craft.fuelRemaining = n1.fuel; sim.craft.stageFuelMax = n1.fuel; sim.craft.chuteCount = n1.chutes;
  };
  let maxAlt = 0, maxHeat = 0, cut = false, cutSpeed = 0, lastAlt = 0, touchdown = 0, steps = 0;
  let staged = false, stagedAt = 0;
  while (sim.status !== "landed" && sim.status !== "crashed" && steps < 400000) {
    touchdown = sim.speed; // impact speed = the speed going INTO the landing step
    Physics.step(sim, 0.05); steps++;
    maxAlt = Math.max(maxAlt, sim.altitude);
    maxHeat = Math.max(maxHeat, sim.heat || 0);
    const descending = sim.altitude < lastAlt;
    lastAlt = sim.altitude;
    if (!cut && sim.altitude >= S) { cut = true; cutSpeed = sim.speed; sim.craft.throttle = 0; }
    if (!staged && descending && cut &&
        (kidTaps || sim.altitude < SchoolCore.ASSIST_STAGE_ALT)) {
      staged = true; stagedAt = sim.altitude; doStage(); // her ✂ tap, or teacher assist
    }
    if (staged && !sim.craft.chuteDeployed && descending &&
        (kidTaps || (sim.altitude < 2500 && sim.speed < 240))) {
      sim.craft.chuteDeployed = true; // her ☂ tap, or main.js's auto-chute
    }
  }
  return { sim, maxAlt, maxHeat, cut, cutSpeed, touchdown, staged, stagedAt };
}

for (const kidTaps of [true, false]) {
  const label = kidTaps ? "kid taps ✂ and ☂ right away" : "kid never taps (teacher + auto-chute save it)";
  const r = flySchoolMission({ kidTaps });
  check(`[${label}] reaches space (engine cut at the line)`, r.cut,
    `cut at ${(SchoolCore.spaceAltitude() / 1000).toFixed(1)} km doing ${r.cutSpeed.toFixed(0)} m/s`);
  check(`[${label}] apogee in the predicted band (10-60 km)`, r.maxAlt > 10000 && r.maxAlt < 60000,
    `apogee=${(r.maxAlt / 1000).toFixed(1)} km`);
  check(`[${label}] heating stays mild — never burns`, r.maxHeat < 0.5, `maxHeat=${r.maxHeat.toFixed(2)}`);
  check(`[${label}] booster staged on the way down`, r.staged, `staged at ${(r.stagedAt / 1000).toFixed(1)} km`);
  check(`[${label}] chute actually OPENED (not just armed)`, r.sim.chuteOpen === true,
    `chuteOpen=${r.sim.chuteOpen}`);
  check(`[${label}] pod lands softly (predicted ~3.5 m/s chute sink)`,
    r.sim.status === "landed" && r.touchdown < 5,
    `status=${r.sim.status} touchdown≈${r.touchdown.toFixed(1)} m/s`);
}

// The negative that proves the lesson: NEVER staging = the chute can't save you.
{
  const S = SchoolCore.spaceAltitude();
  const n0 = stageNumbers(0);
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying";
  sim.craft.mass = n0.mass; sim.craft.thrust = n0.thrust; sim.craft.exhaustVelocity = n0.ve;
  sim.craft.fuelRemaining = n0.fuel; sim.craft.chuteCount = n0.chutes;
  sim.craft.throttle = 1;
  let cut = false, steps = 0, lastAlt = 0;
  while (sim.status !== "landed" && sim.status !== "crashed" && steps < 400000) {
    Physics.step(sim, 0.05); steps++;
    if (!cut && sim.altitude >= S) { cut = true; sim.craft.throttle = 0; }
    if (cut && sim.altitude < lastAlt) sim.craft.chuteDeployed = true; // armed on the way down
    lastAlt = sim.altitude;
  }
  check("unstaged heavy stack really is unsavable (the decoupler is load-bearing)",
    sim.status === "crashed" && sim.chuteOpen === false,
    `status=${sim.status} — never slowed below the chute's 250 m/s limit`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

// ---- 6. LESSON 4: GO AROUND THE WORLD ----
// Steering-law sanity (pure math, exact):
{
  const A = SchoolCore.ascentAngle, R = SchoolCore.retroAngle;
  // On the pad (+Y from Earth), zero speed: point straight up = angle 0 (+Y).
  check("ascent angle on the pad is vertical", Math.abs(A({ rx: 0, ry: 1, speed: 0, vTarget: 2373 })) < 1e-9);
  // At full orbital speed the nose lies flat along CCW-prograde (+90° from vertical).
  check("ascent angle at v_orbit is horizontal-prograde",
    Math.abs(A({ rx: 0, ry: 1, speed: 2373, vTarget: 2373 }) - Math.PI / 2) < 1e-9);
  // Retro: headingVec(a) = (-sin a, cos a) must equal -v̂.
  const a = R({ vx: -2373, vy: 0 }); // flying -X => nose must point +X
  check("retro angle points against the velocity",
    Math.abs(-Math.sin(a) - 1) < 1e-9 && Math.abs(Math.cos(a)) < 1e-9);
}

// Orbit phase machine:
{
  const f = (p, s) => SchoolCore.orbitEvent(p, s);
  const base = { alt: 0, speed: 0, status: "flying", fuel: 9, isOrbit: false, pe: -1,
                 swept: 0, staged: false, chuteDeployed: false, heat: 0,
                 halfSaid: false, glowSaid: false, descending: false };
  check("moving fast on the way up -> leanReady", f("boost", { ...base, speed: 150 }) === "leanReady");
  check("apoapsis reaches orbit height -> apoSet (engine off, coast)",
    f("turn", { ...base, speed: 1600, apo: SchoolCore.orbitAltitude() + 500 }) === "apoSet");
  check("top of the coast -> pushReady", f("coastUp", { ...base, vr: 40, pushShown: false }) === "pushReady");
  check("push missed at the top -> teacher assists", f("coastUp", { ...base, vr: -40, pushShown: true }) === "pushAssist");
  check("orbit closes -> orbitIn", f("circle", { ...base, speed: 2400, isOrbit: true, pe: SchoolCore.orbitPeGate() + 1000 }) === "orbitIn");
  check("orbit gate demands a safe periapsis", f("circle", { ...base, speed: 2400, isOrbit: true, pe: 9000 }) === null);
  check("tank dry before orbit -> fuelOut", f("circle", { ...base, speed: 1500, fuel: 0 }) === "fuelOut");
  check("half a lap -> lapHalf once", f("lap", { ...base, swept: Math.PI + 0.1 }) === "lapHalf" &&
    f("lap", { ...base, swept: Math.PI + 0.1, halfSaid: true }) === null);
  check("full lap -> lapDone", f("lap", { ...base, swept: 2 * Math.PI + 0.01, halfSaid: true }) === "lapDone");
  check("deorbit burn done when pe dips into the air", f("homeburn", { ...base, pe: 1500 }) === "deorbitCut");
  check("booster off on the way down -> staged", f("coastdown", { ...base, staged: true }) === "staged");
  check("reentry glow says its line once", f("reenter", { ...base, staged: true, heat: 0.2 }) === "glow" &&
    f("reenter", { ...base, staged: true, heat: 0.2, glowSaid: true }) === null);
  check("chute + landed close out the mission",
    f("reenter", { ...base, staged: true, glowSaid: true, chuteDeployed: true }) === "chute" &&
    f("chute", { ...base, status: "landed" }) === "landed");
}

// THE ORBIT MISSION, real physics end to end (predict-then-check):
//   Stack: sparrow + BIG tank + decoupler + shield + pod + chute = 11.35 t wet,
//   TWR ≈ 1.9, Δv = 2800*ln(11.35/2.35) ≈ 4409 m/s. Insertion to a ~70 km orbit
//   costs ~2373 m/s of orbital speed plus gravity/drag losses (~600-1000 m/s here),
//   so the tank should close the orbit with >1 t of fuel to spare — plenty for the
//   ~100 m/s deorbit burn. Reentry from orbit hits the air at ~2.5 km/s: fatal bare
//   (reentry_test), survivable behind the shield (0.25 heat factor). Chute sink at
//   the capsule's 1.2 t ≈ 4.0 m/s < the 5 m/s bare-hull landing limit.
{
  const cut = SchoolCore.ORBIT_STACK.indexOf("decoupler");
  const nums = (stageNum) => {
    let mass = 0, thrust = 0, ve = 0, engines = 0, fuel = 0, chutes = 0, shields = 0;
    SchoolCore.ORBIT_STACK.forEach((id, i) => {
      const stage = i > cut ? 1 : 0;
      if (stage < stageNum) return;
      const d = PARTS.find((p) => p.id === id);
      mass += (d.dryMass || 0) + (d.fuelMass || 0);
      if (stage === stageNum) {
        fuel += d.fuelMass || 0;
        if (d.type === "engine") { thrust += d.thrust; ve += d.exhaustVelocity; engines++; }
      }
      if (d.type === "chute") chutes++;
      if (d.type === "shield") shields++;
    });
    return { mass, thrust, ve: engines ? ve / engines : 0, fuel, chutes, shields };
  };

  const E2 = BODIES.earth;
  const vTarget = Math.sqrt(E2.mu / (E2.radius + SchoolCore.orbitAltitude()));
  const n0 = nums(0);
  const sim = newSimState(E2);
  sim.mode = "flight"; sim.status = "flying";
  sim.craft.mass = n0.mass; sim.craft.thrust = n0.thrust; sim.craft.exhaustVelocity = n0.ve;
  sim.craft.fuelRemaining = n0.fuel; sim.craft.chuteCount = n0.chutes; sim.craft.shieldCount = n0.shields;
  sim.craft.throttle = 1;

  const relEarth = () => {
    const e = bodyStateAt("earth", sim.time || 0);
    return { rx: sim.craft.pos.x - e.pos.x, ry: sim.craft.pos.y - e.pos.y,
             vx: sim.craft.vel.x - e.vel.x, vy: sim.craft.vel.y - e.vel.y };
  };

  // Ascent, the two-burn profile the school flies (a single continuous burn was
  // tried first and ESCAPED — this stack carries more than escape Δv):
  //   1. gravity-turn burn until apoapsis reaches orbit height, engine off;
  //   2. coast up the hill; 3. sideways push at the top until the orbit closes.
  let maxHeatUp = 0, steps = 0, o = null;
  // burn 1: set the apoapsis
  while (steps++ < 40000 && sim.craft.fuelRemaining > 0) {
    const r = relEarth();
    sim.craft.angle = sim.speed < SchoolCore.LEAN_READY_SPEED
      ? SchoolCore.ascentAngle({ ...r, speed: 0, vTarget: 1 })
      : SchoolCore.ascentAngle({ ...r, speed: sim.speed, vTarget });
    Physics.step(sim, 0.05);
    maxHeatUp = Math.max(maxHeatUp, sim.heat || 0);
    o = Physics.computeOrbit(sim);
    if (o && isFinite(o.apoapsis) && o.apoapsis >= SchoolCore.orbitAltitude()) break;
  }
  const fuelAfterBurn1 = sim.craft.fuelRemaining;
  check("burn 1 sets the apoapsis at orbit height with fuel in hand", fuelAfterBurn1 > 1.5,
    o ? `apo=${(o.apoapsis / 1000).toFixed(1)} km, fuel left=${fuelAfterBurn1.toFixed(2)} t` : "?");
  // coast to the top (engine off) until the climb rate dies away
  sim.craft.throttle = 0;
  while (steps++ < 40000) {
    Physics.step(sim, 0.5);
    if (SchoolCore.radialSpeed(relEarth()) < 50) break;
  }
  // burn 2: the sideways push
  sim.craft.throttle = 1;
  let orbitMade = false;
  while (steps++ < 40000 && sim.craft.fuelRemaining > 0) {
    const r = relEarth();
    sim.craft.angle = SchoolCore.ascentAngle({ ...r, speed: vTarget, vTarget });
    Physics.step(sim, 0.05);
    o = Physics.computeOrbit(sim);
    if (o && o.isOrbit && o.periapsis > SchoolCore.orbitPeGate()) { orbitMade = true; break; }
  }
  sim.craft.throttle = 0;
  const fuelAtOrbit = sim.craft.fuelRemaining;
  check("the sideways push at the top closes a real orbit", orbitMade,
    o ? `pe=${(o.periapsis / 1000).toFixed(1)} km ap=${isFinite(o.apoapsis) ? (o.apoapsis / 1000).toFixed(1) : "∞"} km after ${sim.time.toFixed(0)} s` : "tank ran dry first");
  check("insertion leaves a fuel margin for the ride home", fuelAtOrbit > 0.3,
    `fuel left=${fuelAtOrbit.toFixed(2)} t of ${n0.fuel} t`);
  check("ascent never overheats", maxHeatUp < 0.5, `maxHeat=${maxHeatUp.toFixed(2)}`);

  // A full lap, engine off: assert it comes back around without decaying.
  sim.craft.throttle = 0;
  let swept = 0, prevPhi = null, minAlt = Infinity;
  while (swept < 2 * Math.PI && steps++ < 90000) {
    Physics.step(sim, 5);
    const r = relEarth();
    const phi = Math.atan2(r.ry, r.rx);
    if (prevPhi != null) {
      let d = phi - prevPhi;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      swept += Math.abs(d);
    }
    prevPhi = phi;
    minAlt = Math.min(minAlt, sim.altitude);
  }
  check("a full lap around the world holds its orbit", swept >= 2 * Math.PI && minAlt > SchoolCore.orbitPeGate(),
    `lap in ${(sim.time / 60).toFixed(0)} game-min, lowest point ${(minAlt / 1000).toFixed(1)} km`);

  // Deorbit: burn retrograde until the periapsis dips deep into the air.
  sim.craft.throttle = 1;
  let deorbitOk = false;
  while (steps++ < 60000) {
    const r = relEarth();
    sim.craft.angle = SchoolCore.retroAngle(r);
    Physics.step(sim, 0.05);
    const oo = Physics.computeOrbit(sim);
    if (oo && oo.periapsis < SchoolCore.DEORBIT_PE) { deorbitOk = true; break; }
    if (sim.craft.fuelRemaining <= 0) break;
  }
  sim.craft.throttle = 0;
  check("deorbit burn dips the periapsis into the air with fuel to spare",
    deorbitOk && sim.craft.fuelRemaining > 0, `fuel left=${sim.craft.fuelRemaining.toFixed(2)} t`);

  // Stage the booster off, fall, reenter behind the shield, chute, land.
  const n1 = nums(1);
  sim.craft.currentStage = 1;
  sim.craft.mass = n1.mass; sim.craft.thrust = n1.thrust; sim.craft.exhaustVelocity = n1.ve;
  sim.craft.fuelRemaining = n1.fuel; sim.craft.chuteCount = n1.chutes; sim.craft.shieldCount = n1.shields;
  let maxHeatDown = 0, maxSpeedDown = 0, lastAlt2 = sim.altitude, touchdown = 0;
  while (sim.status !== "landed" && sim.status !== "crashed" && steps++ < 300000) {
    touchdown = sim.speed;
    Physics.step(sim, 0.05);
    maxHeatDown = Math.max(maxHeatDown, sim.heat || 0);
    maxSpeedDown = Math.max(maxSpeedDown, sim.speed);
    const descending = sim.altitude < lastAlt2;
    lastAlt2 = sim.altitude;
    if (!sim.craft.chuteDeployed && descending && sim.altitude < 2500 && sim.speed < 240) {
      sim.craft.chuteDeployed = true; // her tap / the auto-chute
    }
  }
  check("reentry from orbit really is a fireball regime (~2.5 km/s in air)", maxSpeedDown > 2000,
    `max speed on the way down=${maxSpeedDown.toFixed(0)} m/s`);
  check("the shield survives it (heat < 1)", maxHeatDown < 1 && !sim.burnedUp,
    `maxHeat=${maxHeatDown.toFixed(2)}`);
  check("capsule lands softly under the chute (predicted ~4.0 m/s)",
    sim.status === "landed" && touchdown < 5,
    `status=${sim.status} touchdown≈${touchdown.toFixed(1)} m/s`);
}
