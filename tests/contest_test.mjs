// 🔨 Rocket Forge Duel tests: Δv scoring vs hand-computed rocket-equation numbers,
// the Pandora liftoff gate, rival ladder, the Pelican craft code, and the new
// spacesim.pelican.v1 save's garbage tolerance. Run: node tests/contest_test.mjs
import {
  CONTEST_IDS, MAX_PARTS, PANDORA_G0, RIVALS, CHAMPION_SCORE,
  scoreStack, beatsChampion, PELICAN_CODE, PELICAN_PARTS, parsePelicanSave,
} from "../js/contest.js";
import { PARTS } from "../js/parts.js";
import { importCraft, validatePartDef } from "../js/mods.js";
import { famousSystem } from "../js/famous.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- 1. The gravity bar matches Pandora's real catalog number (no silent drift) ---
{
  const sys = famousSystem("pandora");
  check("PANDORA_G0 matches famous.js Pandora g0", sys.bodies.earth.g0 === PANDORA_G0,
    `contest=${PANDORA_G0} catalog=${sys.bodies.earth.g0}`);
}

// --- 2. Δv scores against hand-computed Tsiolkovsky numbers ---
// Model (same as main.js loadStage): thrust sums; ve is the MEAN across engines;
// every part's fuelMass feeds one shared tank; Δv = ve·ln(m0/m1).
{
  // Sparrow + 2 Large + Pod: m0 = 0.8+0.5+2(0.6+9) = 20.5 t, fuel 18, m1 2.5.
  // Δv = 2800·ln(20.5/2.5) = 2800·2.1041 ≈ 5891.  TWR = 215/(20.5·7.85) ≈ 1.34.
  const s1 = scoreStack(["command_pod", "engine_sparrow", "tank_large", "tank_large"], PARTS);
  check("sparrow+2 large scores ~5891", s1.ok && near(s1.score, 5891, 5), `score=${s1.score}`);
  check("sparrow+2 large lifts off Pandora", s1.liftsOff && near(s1.twr, 1.336, 0.01), `twr=${s1.twr.toFixed(3)}`);

  // Hawk + 2 Mega + Pod: m0 = 0.8+1.2+2(1.1+18) = 40.2, fuel 36, m1 4.2.
  // Δv = 3000·ln(40.2/4.2) ≈ 6778 — an honest first "big" build that still LOSES to Vex.
  const s2 = scoreStack(["command_pod", "engine_hawk", "tank_mega", "tank_mega"], PARTS);
  check("hawk+2 mega scores ~6778 (loses to the champion!)",
    s2.ok && near(s2.score, 6778, 5) && s2.score < CHAMPION_SCORE, `score=${s2.score}`);

  // Hawk + 3 Mega + Pod (5 parts): m0 = 59.3, fuel 54, m1 5.3.
  // Δv = 3000·ln(59.3/5.3) ≈ 7245, TWR = 600/465.5 ≈ 1.29 — the discoverable winner.
  const s3 = scoreStack(["command_pod", "engine_hawk", "tank_mega", "tank_mega", "tank_mega"], PARTS);
  check("hawk+3 mega scores ~7245 and beats the champion",
    s3.ok && near(s3.score, 7245, 5) && beatsChampion(s3.score), `score=${s3.score}`);
  check("hawk+3 mega still clears the liftoff bar", s3.liftsOff && near(s3.twr, 1.289, 0.01),
    `twr=${s3.twr.toFixed(3)}`);

  // Hawk + Osprey + 3 Mega + Pod (6 parts, the clever mixed build): ve = 3700,
  // m0 = 60.2, m1 6.2 → Δv = 3700·ln(60.2/6.2) ≈ 8410.
  const s4 = scoreStack(["command_pod", "engine_hawk", "engine_osprey",
    "tank_mega", "tank_mega", "tank_mega"], PARTS);
  check("hawk+osprey+3 mega scores ~8410 (vacuum-engine mix pays)",
    s4.ok && near(s4.score, 8410, 5), `score=${s4.score}`);

  // Osprey alone + Mega: 90 kN vs 20·7.85 ≈ 158 kN of weight — never leaves the pad.
  // Δv still computes (honest number) but the SCORE is zero.
  const s5 = scoreStack(["command_pod", "engine_osprey", "tank_mega"], PARTS);
  check("osprey-only build computes Δv but scores 0 (TWR < 1)",
    s5.ok && !s5.liftsOff && s5.dv > 0 && s5.score === 0,
    `twr=${s5.twr.toFixed(2)} dv=${s5.dv}`);

  // Sky-crane's built-in fuelMass counts as fuel (same as loadStage's stageFuel).
  const s6 = scoreStack(["probe_core", "engine_crane", "engine_sparrow"], PARTS);
  // m0 = 0.3 + (0.35+1.5) + 0.5 = 2.65, fuel 1.5, m1 1.15, ve = (2600+2800)/2 = 2700,
  // Δv = 2700·ln(2.65/1.15) ≈ 2254. TWR = 260/(2.65·7.85) = 12.5.
  check("crane fuel feeds the tank; probe core counts as the brain",
    s6.ok && near(s6.score, 2254, 5), `score=${s6.score}`);
}

// --- 3. The forge rules refuse kindly (friendly errors, never throws) ---
{
  check("empty stack refused", scoreStack([], PARTS).ok === false);
  check("7 parts refused", scoreStack(Array(7).fill("tank_small"), PARTS).ok === false);
  check("far-future engine refused (chemical-only duel)",
    scoreStack(["command_pod", "engine_ion", "tank_mega"], PARTS).ok === false);
  check("no engine refused", scoreStack(["command_pod", "tank_mega"], PARTS).ok === false);
  check("no brain refused", scoreStack(["engine_hawk", "tank_mega"], PARTS).ok === false);
  const errs = [scoreStack([], PARTS), scoreStack(["x"], PARTS)];
  check("errors carry kid-readable messages", errs.every((e) => typeof e.error === "string" && e.error.length > 10));
}

// --- 4. The rival ladder climbs to a beatable champion ---
{
  check("rivals climb", RIVALS.every((r, i) => i === 0 || r.score > RIVALS[i - 1].score));
  const best = scoreStack(["command_pod", "engine_hawk", "engine_osprey",
    "tank_mega", "tank_mega", "tank_mega"], PARTS);
  check("champion beatable inside forge rules", best.ok && best.score > CHAMPION_SCORE,
    `best=${best.score} champion=${CHAMPION_SCORE}`);
  check("ties lose (best score WINS means beat it)", !beatsChampion(CHAMPION_SCORE));
  check("contest shelf only lists real stock ids",
    CONTEST_IDS.every((id) => PARTS.some((p) => p.id === id)));
  check("MAX_PARTS is 6", MAX_PARTS === 6);
}

// --- 5. The Pelican craft code rides the proven share-code path ---
{
  const v = importCraft(PELICAN_CODE, PARTS);
  check("PELICAN_CODE imports cleanly", v.ok === true, v.ok ? "" : v.error);
  check("Pelican is named Pelican", v.ok && v.name === "Pelican");
  check("Pelican carries its two special engines as new parts",
    v.ok && v.newParts.length === 2 &&
    v.newParts.some((p) => p.id === "pelican_lift") &&
    v.newParts.some((p) => p.id === "pelican_main"));
  check("Pelican stack: boosters at the BOTTOM (they land it)",
    v.ok && v.stack[0] === "pelican_lift");
  check("Pelican carries a Rover (it's a vehicle carrier)",
    v.ok && v.stack.includes("rover"));
  for (const def of PELICAN_PARTS) {
    const chk = validatePartDef(def);
    check(`pelican part ${def.id} validates`, chk.ok, chk.ok ? "" : chk.error);
    check(`pelican part ${def.id} keeps its engineMode tag through validation`,
      chk.ok && chk.def.engineMode === def.engineMode);
  }
  const lift = PELICAN_PARTS.find((p) => p.id === "pelican_lift");
  const main = PELICAN_PARTS.find((p) => p.id === "pelican_main");
  check("lift boosters out-punch the cruise drive (VTOL logic)",
    lift.thrust > 2 * main.thrust);
  check("cruise drive out-sips the boosters (efficiency logic)",
    main.exhaustVelocity > 1.5 * lift.exhaustVelocity);
  // The whole Pelican on belly boosters must hover at Pandora: thrust > m0·g0.
  let m0 = 0;
  const all = [...PARTS, ...PELICAN_PARTS];
  for (const id of JSON.parse(PELICAN_CODE).stack) {
    const d = all.find((p) => p.id === id);
    m0 += (d.dryMass || 0) + (d.fuelMass || 0);
  }
  check("Pelican belly boosters lift the full ship off Pandora",
    lift.thrust > m0 * PANDORA_G0 * 1.5, `thrust=${lift.thrust} need>${(m0 * PANDORA_G0).toFixed(0)}`);
}

// --- 6. spacesim.pelican.v1 is garbage-tolerant (Rule 2 spirit) ---
{
  const locked = { v: 1, unlocked: false, best: 0 };
  const cases = [
    ["null", null], ["junk", "hisssss"], ["array", "[1,2]"],
    ["unlocked-as-string", '{"v":1,"unlocked":"yes","best":"lots"}'],
    ["negative best", '{"v":1,"unlocked":false,"best":-50}'],
  ];
  for (const [label, raw] of cases) {
    const got = parsePelicanSave(raw);
    check(`garbage save (${label}) -> locked, never a crash`,
      JSON.stringify(got) === JSON.stringify(locked), JSON.stringify(got));
  }
  const good = parsePelicanSave('{"v":1,"unlocked":true,"best":7245.4}');
  check("good save round-trips (best rounds to a whole number)",
    good.unlocked === true && good.best === 7245, JSON.stringify(good));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
