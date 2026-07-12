// Crew tests — the 🐍 Astronaut Complex: specialties, the launch pick, and the flight log.
// Run: node crew_test.mjs   (crew.js guards localStorage + DOM, so a node import is safe;
// we install a localStorage shim FIRST so persistence round-trips are really exercised.)

let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { Crew, ROLE_INFO, roleOf, normalizeCrewData } = await import("../js/crew.js");
const { CONNIES, pickConnie } = await import("../js/connies.js");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// --- the roster data (connies.js is his editable file — the shape must hold) ---
{
  check("every stock Connie has a name and a hero fact",
    CONNIES.every((c) => c.name && c.hero));
  check("stock Connie names are unique",
    new Set(CONNIES.map((c) => c.name)).size === CONNIES.length);
  check("every stock Connie's role is a real ROLE_INFO specialty",
    CONNIES.every((c) => !!ROLE_INFO[c.role]));
  check("all four real jobs are represented (pilot/scientist/engineer/navigator)",
    ["Pilot", "Scientist", "Engineer", "Navigator"].every((r) => CONNIES.some((c) => c.role === r)));
  check("roleOf maps a missing/bogus role to Rookie (kid-added Connies fly fine)",
    roleOf({ name: "X" }) === "Rookie" && roleOf({ name: "X", role: "Wizard" }) === "Rookie" &&
    roleOf(CONNIES[0]) === CONNIES[0].role);
}

// --- normalize (pure): mangled storage degrades to defaults, never a crash ---
{
  const d = normalizeCrewData(null);
  check("null storage -> empty defaults", d.pick === null && Object.keys(d.log).length === 0);
  check("garbage types rejected", normalizeCrewData({ pick: 123, log: [1, 2] }).pick === null &&
    Object.keys(normalizeCrewData({ pick: 123, log: [1, 2] }).log).length === 0);
  const n = normalizeCrewData({ pick: "Sally Slide", log: { a: "3", b: -2, c: 1e9, d: NaN } });
  check("valid pick kept, string counts coerced", n.pick === "Sally Slide" && n.log.a === 3);
  check("negative/NaN counts dropped, huge counts clamped",
    !("b" in n.log) && !("d" in n.log) && n.log.c === 99999);
}

// --- the pick (his choice at the Astronaut Complex / 🐍 Crew button) ---
{
  check("default pick is Surprise-me (null)", Crew.getPick() === null);
  Crew.setPick("Sally Slide");
  check("picking a real Connie sticks", Crew.getPick() === "Sally Slide");
  Crew._reload();
  check("pick survives a reload (localStorage round-trip)", Crew.getPick() === "Sally Slide");
  const chosen = Crew.chooseForLaunch();
  check("chooseForLaunch honors the pick (with her hero + role aboard)",
    chosen.name === "Sally Slide" && !!chosen.hero && chosen.role === "Scientist");
  check("picking nonsense falls back to Surprise-me", Crew.setPick("Nobody Real") === null &&
    Crew.getPick() === null);
  const random = Crew.chooseForLaunch();
  check("Surprise-me still launches a real Connie", CONNIES.some((c) => c.name === random.name));
}

// --- the flight log (missions flown — his real history) ---
{
  check("fresh Connie has 0 missions", Crew.missions("Boa Lovell") === 0);
  Crew.recordMission("Boa Lovell");
  Crew.recordMission("Boa Lovell");
  check("two flights -> 2 in the log", Crew.missions("Boa Lovell") === 2);
  Crew._reload();
  check("the log survives a reload", Crew.missions("Boa Lovell") === 2);
  check("roster merges counts onto every Connie", Crew.roster().find((c) => c.name === "Boa Lovell").missions === 2 &&
    Crew.roster().every((c) => typeof c.missions === "number" && !!ROLE_INFO[c.role]));
  Crew.recordMission(null); // no-throw, no ghost entries
  check("garbage mission names are ignored", !Object.keys(normalizeCrewData(
    JSON.parse(localStorage.getItem("spacesim.crew.v1"))).log).includes("null"));
}

// --- failing safely when HE edits connies.js (it's his file) ---
{
  CONNIES.push({ name: "Wiggles" }); // a kid-added Connie: no role, no hero
  check("a kid-added Connie joins the roster as a Rookie",
    Crew.roster().find((c) => c.name === "Wiggles").role === "Rookie");
  Crew.setPick("Wiggles");
  check("a kid-added Connie can be picked and flies", Crew.chooseForLaunch().name === "Wiggles");
  CONNIES.pop(); // he deletes her again — the stale pick must not break a launch
  const survivor = Crew.chooseForLaunch();
  check("a pick naming a deleted Connie falls back to a real one (launch never breaks)",
    CONNIES.some((c) => c.name === survivor.name));
  Crew.setPick(null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
