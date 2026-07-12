// Crew tests — the 🐍 Astronaut Complex: specialties, the crew LINEUP (multi-seat pods),
// the flight log, and science-milestone recruits (what the science is FOR).
// Run: node crew_test.mjs   (crew.js guards localStorage + DOM, so a node import is safe;
// we install a localStorage shim FIRST so persistence round-trips are really exercised.)

let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { Crew, ROLE_INFO, roleOf, normalizeCrewData, MAX_LINEUP } = await import("../js/crew.js");
const { CONNIES, RECRUITS, pickConnie } = await import("../js/connies.js");
const { PARTS: STOCK } = await import("../js/parts.js");
const { validatePartDef } = await import("../js/mods.js");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};
const setScience = (n) => localStorage.setItem("spacesim.science.v1", String(n));

// --- the roster data (connies.js is his editable file — the shape must hold) ---
{
  check("every stock Connie has a name and a hero fact",
    CONNIES.every((c) => c.name && c.hero));
  check("stock Connie names are unique (recruits included)",
    new Set([...CONNIES, ...RECRUITS].map((c) => c.name)).size === CONNIES.length + RECRUITS.length);
  check("every stock Connie's role is a real ROLE_INFO specialty",
    CONNIES.every((c) => !!ROLE_INFO[c.role]));
  check("all four real jobs are represented (pilot/scientist/engineer/navigator)",
    ["Pilot", "Scientist", "Engineer", "Navigator"].every((r) => CONNIES.some((c) => c.role === r)));
  check("roleOf maps a missing/bogus role to Rookie (kid-added Connies fly fine)",
    roleOf({ name: "X" }) === "Rookie" && roleOf({ name: "X", role: "Wizard" }) === "Rookie" &&
    roleOf(CONNIES[0]) === CONNIES[0].role);
  check("every recruit has a milestone, role and hero fact",
    RECRUITS.every((r) => isFinite(r.joinsAt) && r.joinsAt > 0 && !!ROLE_INFO[r.role] && !!r.hero));
}

// --- the Trio Pod (his ask: pods that hold three) ---
{
  const trio = STOCK.find((p) => p.id === "command_trio");
  const acorn = STOCK.find((p) => p.id === "command_pod");
  check("Trio Command Pod exists: crewed, seats 3, heavier than the Acorn",
    !!trio && trio.type === "command" && !trio.uncrewed && trio.seats === 3 && trio.dryMass > acorn.dryMass);
  check("Acorn seats 1 (Mercury-style)", acorn.seats === 1);
  const v = validatePartDef({ ...acorn, seats: 2 });
  check("modding seats validates (a 2-seat pod is legal)", v.ok && v.def.seats === 2);
  check("seats bounds read as a fact (9 seats rejected, Shuttle held 8)",
    validatePartDef({ ...acorn, seats: 9 }).ok === false);
}

// --- normalize (pure): mangled storage degrades to defaults, never a crash ---
{
  const d = normalizeCrewData(null);
  check("null storage -> empty defaults", Array.isArray(d.picks) && d.picks.length === 0 &&
    Object.keys(d.log).length === 0);
  check("garbage types rejected", normalizeCrewData({ picks: "x", log: [1, 2] }).picks.length === 0);
  const legacy = normalizeCrewData({ pick: "Sally Slide", log: { a: "3" } });
  check("earlier single-pick shape migrates to a lineup", legacy.picks.length === 1 &&
    legacy.picks[0] === "Sally Slide" && legacy.log.a === 3);
  const n = normalizeCrewData({ picks: ["A", "A", "B", 7, "C", "D"], log: { b: -2, c: 1e9, d: NaN } });
  check("lineup deduped, non-strings dropped, capped at MAX_LINEUP",
    n.picks.length === MAX_LINEUP && n.picks.join() === "A,B,C");
  check("negative/NaN counts dropped, huge counts clamped",
    !("b" in n.log) && !("d" in n.log) && n.log.c === 99999);
}

// --- the lineup (his picks at the Astronaut Complex / 🐍 Crew button) ---
{
  setScience(0);
  Crew._reload();
  check("default lineup is empty (Surprise-me)", Crew.lineup().length === 0);
  Crew.togglePick("Sally Slide");
  Crew.togglePick("Boa Lovell");
  check("taps build an ordered lineup", Crew.lineup().join() === "Sally Slide,Boa Lovell");
  Crew.togglePick("Sally Slide");
  check("tapping again steps out of the lineup", Crew.lineup().join() === "Boa Lovell");
  Crew.togglePick("Sally Slide");
  Crew.togglePick("Mae Slitherson");
  Crew.togglePick("Yuri Gliderin"); // 4th tap on a full lineup: newest takes the last seat
  check("lineup caps at 3 — newest pick replaces the last seat",
    Crew.lineup().join() === "Boa Lovell,Sally Slide,Yuri Gliderin");
  check("picking nonsense is ignored", Crew.togglePick("Nobody Real").length === 3);
  Crew._reload();
  check("lineup survives a reload (localStorage round-trip)", Crew.lineup().length === 3 &&
    Crew.lineup()[0] === "Boa Lovell");

  const three = Crew.chooseCrewForLaunch(3);
  check("3-seat launch flies the lineup in order, commander first",
    three.map((c) => c.name).join() === "Boa Lovell,Sally Slide,Yuri Gliderin");
  const one = Crew.chooseCrewForLaunch(1);
  check("1-seat launch takes just the commander", one.length === 1 && one[0].name === "Boa Lovell");
  Crew.clearPicks();
  const filled = Crew.chooseCrewForLaunch(3);
  check("Surprise-me fills every seat with distinct real Connies",
    filled.length === 3 && new Set(filled.map((c) => c.name)).size === 3 &&
    filled.every((c) => CONNIES.some((k) => k.name === c.name)));
  Crew.togglePick("Sally Slide");
  const topped = Crew.chooseCrewForLaunch(3);
  check("a 1-pick lineup on a 3-seat pod gets 2 fill-ins, no repeats",
    topped[0].name === "Sally Slide" && topped.length === 3 &&
    new Set(topped.map((c) => c.name)).size === 3);
  check("chooseForLaunch (single) still honors the commander",
    Crew.chooseForLaunch().name === "Sally Slide");
}

// --- the flight log (missions flown — his real history) ---
{
  check("fresh Connie has 0 missions", Crew.missions("Chris Rattlefield") === 0);
  Crew.recordMission("Chris Rattlefield");
  Crew.recordMission("Chris Rattlefield");
  check("two flights -> 2 in the log", Crew.missions("Chris Rattlefield") === 2);
  Crew._reload();
  check("the log survives a reload", Crew.missions("Chris Rattlefield") === 2);
  check("roster merges counts onto every Connie",
    Crew.roster().find((c) => c.name === "Chris Rattlefield").missions === 2);
  Crew.recordMission(null); // no-throw, no ghost entries
  check("garbage mission names are ignored", !Object.keys(normalizeCrewData(
    JSON.parse(localStorage.getItem("spacesim.crew.v1"))).log).includes("null"));
}

// --- science milestones recruit new astronauts (what science is FOR) ---
{
  setScience(0);
  const locked = Crew.roster().filter((c) => c.locked);
  check("with 0 science every recruit is locked (mystery cards)",
    locked.length === RECRUITS.length && locked.every((c) => c.joinsAt > 0));
  check("locked recruits cannot be picked", Crew.togglePick(RECRUITS[0].name).indexOf(RECRUITS[0].name) === -1);
  check("nextRecruitInfo points at the first milestone",
    Crew.nextRecruitInfo().at === Math.min(...RECRUITS.map((r) => r.joinsAt)));

  const first = [...RECRUITS].sort((a, b) => a.joinsAt - b.joinsAt)[0];
  setScience(first.joinsAt);
  check("reaching a milestone graduates that recruit into the roster",
    Crew.roster().some((c) => c.name === first.name && !c.locked) &&
    Crew.roster().filter((c) => c.locked).length === RECRUITS.length - 1);
  check("a graduate can be picked and flown",
    Crew.togglePick(first.name).includes(first.name) &&
    Crew.chooseCrewForLaunch(1)[0].name === "Sally Slide"); // commander unchanged (she's #1)
  Crew.clearPicks();
  check("newGraduates fires exactly on the crossing award",
    Crew.newGraduates(first.joinsAt - 5, first.joinsAt).length === 1 &&
    Crew.newGraduates(first.joinsAt, first.joinsAt + 10).length === 0);
  setScience(9999);
  check("with huge science all recruits are unlocked and nextRecruitInfo is null",
    Crew.roster().every((c) => !c.locked) && Crew.nextRecruitInfo() === null);
  setScience(0);
}

// --- failing safely when HE edits connies.js (it's his file) ---
{
  CONNIES.push({ name: "Wiggles" }); // a kid-added Connie: no role, no hero
  check("a kid-added Connie joins the roster as a Rookie",
    Crew.roster().find((c) => c.name === "Wiggles").role === "Rookie");
  Crew.togglePick("Wiggles");
  check("a kid-added Connie can be picked and flies", Crew.chooseCrewForLaunch(1)[0].name === "Wiggles");
  CONNIES.pop(); // he deletes her again — the stale pick must not break a launch
  const survivors = Crew.chooseCrewForLaunch(3);
  check("a lineup naming a deleted Connie still fills every seat with real ones",
    survivors.length === 3 && survivors.every((c) => CONNIES.some((k) => k.name === c.name)));
  Crew.clearPicks();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
