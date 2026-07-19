// 🧑‍🚀 Astronaut Complex tests: unlock ladder, crew-save tolerance, pick logic,
// pod seat counting. Run: node tests/crew_test.mjs
import { CONNIES, isUnlocked, unlockedConnies, parseCrewSave, pickCrew } from "../js/connies.js";
import { PARTS } from "../js/parts.js";
import { newCraft, makeInstance, computeStats } from "../js/state.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// --- 1. The unlock ladder ---
{
  const free = CONNIES.filter((c) => (c.unlock || 0) === 0);
  check("at least 3 Connies fly from day one", free.length >= 3, `free=${free.length}`);
  check("ladder is sorted (roster reads as a progression)",
    CONNIES.every((c, i) => i === 0 || (c.unlock || 0) >= (CONNIES[i - 1].unlock || 0)));
  check("zero science unlocks exactly the free ones",
    unlockedConnies(0).length === free.length);
  const top = Math.max(...CONNIES.map((c) => c.unlock || 0));
  check("top unlock is reachable but not day-one", top >= 150 && top <= 500, `top=${top}`);
  check("everything unlocked at top score", unlockedConnies(top).length === CONNIES.length);
  check("a Connie with no unlock field counts as unlocked (kid-added customs fly)",
    isUnlocked({ name: "Konnie the Bold" }, 0));
}

// --- 2. Crew save is garbage-tolerant (Rule 2 spirit: junk never crashes a load) ---
{
  const empty = { v: 1, picked: [] };
  const cases = [
    ["null", null], ["junk string", "hisssss"], ["wrong version", '{"v":9,"picked":["Sally Slide"]}'],
    ["picked not array", '{"v":1,"picked":"Sally Slide"}'], ["number entries", '{"v":1,"picked":[1,2]}'],
  ];
  for (const [label, raw] of cases) {
    const got = parseCrewSave(raw);
    check(`garbage load (${label}) -> empty picks`, JSON.stringify(got) === JSON.stringify(empty),
      JSON.stringify(got));
  }
  const good = parseCrewSave('{"v":1,"picked":["Sally Slide","Nobody Real","Sally Slide","Buzz Coildrin"]}');
  check("good save keeps real names, drops unknowns and dupes, keeps order",
    JSON.stringify(good.picked) === JSON.stringify(["Sally Slide", "Buzz Coildrin"]),
    JSON.stringify(good.picked));
}

// --- 3. pickCrew: order, locks, seat cap, fallback ---
{
  const rand = () => 0; // deterministic fallback pick
  const c3 = pickCrew(["Sally Slide", "Buzz Coildrin", "Sneil Armstrong"], 0, 3, rand);
  check("picked order = seating order (first pick is commander)",
    c3.map((c) => c.name).join(",") === "Sally Slide,Buzz Coildrin,Sneil Armstrong");
  const capped = pickCrew(["Sally Slide", "Buzz Coildrin", "Sneil Armstrong"], 1000, 2, rand);
  check("seat cap bites (3 picked, 2 seats -> 2 fly)", capped.length === 2);
  const locked = pickCrew(["Boa Lovell", "Sally Slide"], 0, 3, rand);
  check("locked picks quietly stay home",
    locked.map((c) => c.name).join(",") === "Sally Slide", locked.map((c) => c.name).join(","));
  const fallback = pickCrew([], 0, 3, rand);
  check("nobody picked -> one random unlocked Connie flies (launch never stalls)",
    fallback.length === 1 && (fallback[0].unlock || 0) === 0, fallback[0] && fallback[0].name);
  const allLocked = pickCrew(["Boa Lovell"], 0, 3, rand);
  check("all picks locked -> fallback Connie still flies", allLocked.length === 1);
  check("no seats -> nobody aboard (probe rule)", pickCrew(["Sally Slide"], 0, 0, rand).length === 0);
}

// --- 4. Pod seats via computeStats ---
{
  const mk = (...ids) => {
    const c = newCraft("test");
    ids.forEach((id, i) => c.parts.push(makeInstance(id, 0)));
    return computeStats(c, PARTS);
  };
  check("Acorn pod seats 3 (Apollo!)", mk("engine_sparrow", "tank_small", "command_pod").seatCount === 3);
  check("Swift cockpit seats 2", mk("engine_sparrow", "tank_small", "cockpit_swift").seatCount === 2);
  check("probe core seats 0 (robots fly empty)", mk("engine_sparrow", "tank_small", "probe_core").seatCount === 0);
  check("pod + cockpit stack sums seats", mk("command_pod", "cockpit_swift").seatCount === 5);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
