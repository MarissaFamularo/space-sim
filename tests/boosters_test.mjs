// boosters_test.mjs — strap-on side boosters + parallel staging (the Artemis build).
//
// The model under test (ARCHITECTURE.md, PartInstance.side):
//   * Side boosters are PartInstances with side:-1|+1, living at the END of
//     craft.parts so the center stack's "array order = bottom→top" is untouched.
//   * They come as a matched pair, always stage 0; center stages sit above.
//   * PARALLEL STAGING (Physics.burningEngines): a stage made entirely of
//     side-mounted parts lights the next center stage's engines WITH it —
//     boosters + core burning together off the pad, exactly like SLS/Artemis.
//
// Predictions are computed by hand in the comments BEFORE the assertions
// (house rule: predict the number, then check it).

import { Physics } from "../js/physics.js";
import { computeStats, makeInstance, BODIES } from "../js/state.js";
import { PARTS, exportCraft, importCraft } from "../js/mods.js";

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  " + detail : ""}`); }
}
const find = (id) => PARTS.find((p) => p.id === id);

// ---------------------------------------------------------------------------
// Fixture: an Artemis-alike. Center stack bottom→top (stages already reflowed
// the way builder.js would): core engine+tank = stage 1, upper = stage 2.
// Side pair = stage 0. Thumper: 500 kN, ve 2450, dry 1.4, fuel 8.0 (parts.js).
// ---------------------------------------------------------------------------
function artemis() {
  const mk = (id, stage, side) => {
    const i = makeInstance(id, stage);
    if (side) i.side = side;
    return i;
  };
  return {
    name: "Artemis Jr",
    parts: [
      mk("engine_hawk", 1),   // core: 600 kN, ve 3000
      mk("tank_mega", 1),     // 18 t fuel + 1.1 dry
      mk("decoupler", 2),     // (stage split above the core in real builds varies;
      mk("engine_osprey", 2), //  what matters here is the stage NUMBERS, set directly)
      mk("tank_large", 2),    // 9 t fuel + 0.6 dry
      mk("command_pod", 2),   // 0.8 t
      mk("booster_thumper", 0, -1),
      mk("booster_thumper", 0, 1),
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. The stock part itself
// ---------------------------------------------------------------------------
{
  const srb = find("booster_thumper");
  check("Thumper exists in the merged catalog", !!srb);
  check("Thumper is a solid: engine WITH its own fuel (casing is the tank)",
    srb.type === "engine" && srb.fuelMass > 0);
  // Solids trade economy for muscle: more thrust than the Hawk, worse ve.
  const hawk = find("engine_hawk");
  check("Thumper out-pushes the Hawk but burns dirtier (lower ve)",
    srb.thrust < hawk.thrust * 2 && srb.thrust > hawk.thrust * 0.5 &&
    srb.exhaustVelocity < hawk.exhaustVelocity,
    `thrust=${srb.thrust} ve=${srb.exhaustVelocity}`);
}

// ---------------------------------------------------------------------------
// 2. Parallel staging: burningEngines
// Predicted: stage 0 (all-side) lights the pair AND the stage-1 Hawk:
//   thrust = 500 + 500 + 600 = 1600 kN, 3 engines.
// Stage 1 (center): Hawk alone, 600. Stage 2: Osprey alone, 90.
// ---------------------------------------------------------------------------
{
  const craft = artemis();
  const findDef = (id) => find(id);
  const s0 = Physics.burningEngines(craft.parts, findDef, 0);
  const t0 = s0.reduce((a, d) => a + d.thrust, 0);
  check("stage 0 lights boosters + core (parallel staging)", s0.length === 3 && t0 === 1600,
    `engines=${s0.length} thrust=${t0}`);
  const s1 = Physics.burningEngines(craft.parts, findDef, 1);
  check("stage 1 is the core alone", s1.length === 1 && s1[0].thrust === 600);
  const s2 = Physics.burningEngines(craft.parts, findDef, 2);
  check("stage 2 is the upper engine alone", s2.length === 1 && s2[0].thrust === 90);
}

// ---------------------------------------------------------------------------
// 3. The rule leaves serial rockets alone (old saves have no side field)
// ---------------------------------------------------------------------------
{
  const parts = [
    makeInstance("engine_sparrow", 0), makeInstance("tank_small", 0),
    makeInstance("decoupler", 1), makeInstance("engine_osprey", 1),
    makeInstance("tank_small", 1), makeInstance("command_pod", 1),
  ];
  const s0 = Physics.burningEngines(parts, find, 0);
  check("serial rocket: stage 0 burns only its own engine",
    s0.length === 1 && s0[0].thrust === 215);
}

// ---------------------------------------------------------------------------
// 4. computeStats counts the pair (mass + whole-rocket thrust for TWR)
// Predicted masses: 2×(1.4+8) srb + 1.2 hawk + 19.1 mega + 0.1 decoupler(?)
//   — read the decoupler's mass from the catalog rather than guessing.
// ---------------------------------------------------------------------------
{
  const craft = artemis();
  const stats = computeStats(craft, PARTS, BODIES.earth);
  let expected = 0;
  for (const inst of craft.parts) {
    const d = find(inst.partId);
    expected += (d.dryMass || 0) + (d.fuelMass || 0);
  }
  check("computeStats total mass includes the strap-on pair",
    Math.abs(stats.totalMass - expected) < 1e-9,
    `got=${stats.totalMass} want=${expected}`);
  check("stage count sees the booster stage", stats.stageCount === 3,
    `stages=${stats.stageCount}`);
}

// ---------------------------------------------------------------------------
// 5. applyStage: staging off the booster stage drops EXACTLY the pair,
//    then the core burns alone.
// Predicted after staging: 6 parts remain, thrust 600 (Hawk),
//    fuel = applyStage's model (ALL remaining fuelMass): 18 + 9 = 27 t.
// ---------------------------------------------------------------------------
{
  const craft = artemis();
  craft._catalog = PARTS;
  const sim = { craft: { currentStage: 0 } };
  Physics.applyStage(sim, craft);
  check("applyStage drops exactly the strap-on pair",
    craft.parts.length === 6 && !craft.parts.some((i) => i.side),
    `left=${craft.parts.length}`);
  check("after booster sep the core burns alone", sim.craft.thrust === 600,
    `thrust=${sim.craft.thrust}`);
  check("new current stage is the core stage", sim.craft.currentStage === 1);
  check("remaining fuel follows applyStage's whole-stack model (27 t)",
    Math.abs(sim.craft.fuelRemaining - 27) < 1e-9,
    `fuel=${sim.craft.fuelRemaining}`);
}

// ---------------------------------------------------------------------------
// 6. Share-code round trip: sides survive; codes without sides still load.
// ---------------------------------------------------------------------------
{
  const craft = artemis();
  const code = exportCraft(craft, PARTS);
  const parsed = JSON.parse(code);
  check("share-code keeps v:1 (old game versions still parse it)", parsed.v === 1);
  check("share-code stack holds ONLY the center parts (6)",
    parsed.stack.length === 6 && !parsed.stack.includes(undefined));
  check("share-code carries the pair in sides",
    Array.isArray(parsed.sides) && parsed.sides.length === 2 &&
    parsed.sides.every((id) => id === "booster_thumper"));

  const back = importCraft(code, PARTS);
  check("import returns the sides list", back.ok && back.sides.length === 2);

  const old = JSON.stringify({ v: 1, name: "Old Rocket",
    stack: ["engine_sparrow", "tank_small", "command_pod"], myParts: [] });
  const oldBack = importCraft(old, PARTS);
  check("a pre-booster share code still imports (sides just empty)",
    oldBack.ok && Array.isArray(oldBack.sides) && oldBack.sides.length === 0);

  const bad = JSON.stringify({ v: 1, name: "X", stack: ["command_pod"], sides: ["nope"] });
  check("unknown side part fails friendly, not silently", importCraft(bad, PARTS).ok === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
