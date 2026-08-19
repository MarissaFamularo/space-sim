// Exploration Mode: deterministic resource surveys, tech thresholds, bounded rewards,
// small-world targeting, and garbage-tolerant persistence.
import {
  EXPLORATION_TECH, isTechUnlocked, resourceProfile, isSmallWorld,
  scienceYield, parseExplorationSave,
} from "../js/exploration.js";
import { PARTS } from "../js/parts.js";

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { console.log("✓", name); pass++; }
  else { console.error("✗", name, detail); fail++; }
}

const moon = { key: "moon", name: "Moon", solid: true, radius: 173700, atmosphere: null };
const earth = { key: "earth", name: "Earth", solid: true, radius: 637100, atmosphere: { height: 7000 } };
const gas = { key: "jupiter", name: "Jupiter", solid: false, radius: 6991100, atmosphere: {} };
const pebble = { key: "phobos", name: "Phobos", solid: true, radius: 1127, atmosphere: null, tinyMoon: true };

const a = resourceProfile("sol", moon);
const b = resourceProfile("sol", moon);
check("same system + world always returns the same survey", JSON.stringify(a) === JSON.stringify(b));
check("resource quality stays between 1 and 5", a.quality >= 1 && a.quality <= 5, a.quality);
check("survey names two different resources", a.resources.length === 2 && a.resources[0] !== a.resources[1], a.resources);
check("gas giants cannot be surface-survey targets", resourceProfile("sol", gas) === null);
check("a generated system can have a different deterministic result",
  JSON.stringify(resourceProfile("Youngcow", moon)) !== JSON.stringify(a));

check("Moon counts as a small-world laser target", isSmallWorld(moon, earth.radius));
check("Earth does not count as a small-world laser target", !isSmallWorld(earth, earth.radius));
check("tinyMoon flag always counts", isSmallWorld(pebble, earth.radius));
check("gas giant never counts as a small world", !isSmallWorld(gas, earth.radius));

for (const t of EXPLORATION_TECH) {
  check(t.name + " locked one point early", !isTechUnlocked(t.id, t.science - 1));
  check(t.name + " unlocks exactly at threshold", isTechUnlocked(t.id, t.science));
  const part = PARTS.find((p) => p.id === t.id);
  check(t.name + " has a matching stock rocket part", !!part && part.unlockScience === t.science);
}
check("unknown tech never unlocks", !isTechUnlocked("warp_potato", 9999));

for (let q = 1; q <= 5; q++) {
  check("probe reward grows with quality " + q, scienceYield("probe", q) === 10 + q * 5);
  check("laser reward grows with quality " + q, scienceYield("laser", q) === 8 + q * 4);
}
check("survey scanner earns the promised scan bonus",
  scienceYield("scan", 3, true) - scienceYield("scan", 3, false) === 3);
check("nonsense quality is safely bounded", scienceYield("colony", 999) === scienceYield("colony", 5));

const good = parseExplorationSave(JSON.stringify({ v: 1,
  scans: { "sol:moon": true, "bad key!": true, nope: "yes" },
  probes: { "sol:mars": true }, laserSamples: null, colonies: { "sol:pluto": true },
}));
check("valid one-time mission records survive", good.scans["sol:moon"] && good.probes["sol:mars"] && good.colonies["sol:pluto"]);
check("invalid keys and non-boolean completions are dropped", !good.scans["bad key!"] && !good.scans.nope);
check("broken JSON degrades to an empty save", Object.keys(parseExplorationSave("{oops").scans).length === 0);
check("wrong save version degrades safely", Object.keys(parseExplorationSave({ v: 99, scans: { "sol:moon": true } }).scans).length === 0);

console.log(`\nExploration Mode: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
