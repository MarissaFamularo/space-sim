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
import { BODIES, newSimState } from "../js/state.js";

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

// ---- 2. The card deck covers the stack exactly (no unbuildable card, no missing card) ----
{
  const deck = SchoolCore.CARDS.map((c) => c.partId).sort();
  const stack = [...SchoolCore.SCHOOL_STACK].sort();
  check("cards == stack parts", JSON.stringify(deck) === JSON.stringify(stack));
  const ids = new Set(PARTS.map((p) => p.id));
  check("every school part is a real stock part", SchoolCore.SCHOOL_STACK.every((id) => ids.has(id)));
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
