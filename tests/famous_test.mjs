// Famous-systems tests: the hand-built Kerbol (KSP) and Pandora (Avatar) systems must
// obey every rule the generator guarantees, plus their own canon numbers.
// Run: node tests/famous_test.mjs
import { generateSystem } from "../js/stargen.js";
import { famousSystem, FAMOUS_LIST } from "../js/famous.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};
const approx = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);

// --- 1. Aliases all land on the same canonical system ---
{
  for (const [alias, want] of [
    ["Kerbol", "Kerbol"], ["kerbin", "Kerbol"], ["The Kerbal System", "Kerbol"],
    ["KSP", "Kerbol"], ["Kerbal Space Program", "Kerbol"],
    ["Pandora", "Pandora"], ["AVATAR", "Pandora"], ["alpha centauri", "Pandora"],
    ["Polyphemus", "Pandora"],
  ]) {
    const sys = generateSystem(alias);
    check(`"${alias}" → ${want}`, sys.seed === want && sys.famous, `got seed=${sys.seed}`);
  }
}

// --- 2. Non-famous names still hit the seeded generator, unchanged ---
{
  const a = generateSystem("Snakestar");
  const b = generateSystem("Snakestar");
  check("ordinary seeds bypass the registry", !a.famous && a.seed === "Snakestar", "");
  check("ordinary seeds stay deterministic",
    JSON.stringify(Object.keys(a.bodies)) === JSON.stringify(Object.keys(b.bodies)) &&
    a.bodies.earth.radius === b.bodies.earth.radius, "");
}

// --- 3. Role keys + flyability rules hold in both famous systems ---
for (const seed of ["Kerbol", "Pandora"]) {
  const sys = generateSystem(seed);
  const B = sys.bodies;
  check(`${seed}: roles sun/earth/moon exist`, !!(B.sun && B.earth && B.moon), "");
  check(`${seed}: home is launchable`, B.earth.solid && B.earth.g0 >= 7 && B.earth.g0 <= 11,
    `g0=${B.earth.g0}`);
  check(`${seed}: home air is chuteable`,
    !!B.earth.atmosphere && B.earth.atmosphere.seaLevelDensity >= 0.9,
    `rho=${B.earth.atmosphere && B.earth.atmosphere.seaLevelDensity}`);
  check(`${seed}: moon orbits home inside home's SOI`,
    B.moon.parent === "earth" && B.moon.orbitRadius < B.earth.soiRadius,
    `a=${B.moon.orbitRadius.toExponential(2)} soi=${B.earth.soiRadius.toExponential(2)}`);
  check(`${seed}: every body's parent exists and precedes it`,
    sys.planetKeys.every((k) => B[k].parent && B[B[k].parent]), "");
  check(`${seed}: fresh objects per call (no shared refs)`,
    generateSystem(seed).bodies.earth !== B.earth, "");
  check(`${seed}: has a home station`, sys.stations.some((s) => s.body === "earth"), "");
}

// --- 4. Kerbol canon spot-checks (the ×10 defs must land on true KSP values) ---
{
  const B = generateSystem("Kerbol").bodies;
  check("Kerbin radius = 600 km", approx(B.earth.radius, 600000, 0.001),
    `${(B.earth.radius / 1000).toFixed(0)} km`);
  check("Kerbin gravity = 9.81", approx(B.earth.g0, 9.81, 0.001), "");
  check("Mun at 12,000 km", approx(B.moon.orbitRadius, 12000000, 0.001), "");
  check("Kerbin mu canon (3.53e12)", approx(B.earth.mu, 3.5316e12, 0.01),
    B.earth.mu.toExponential(3));
  check("Kerbin SOI ≈ 84,000 km canon", approx(B.earth.soiRadius, 8.4159e7, 0.02),
    (B.earth.soiRadius / 1000).toFixed(0) + " km");
  const year = 2 * Math.PI / B.earth.omega;
  check("Kerbin year ≈ canon 9,203,545 s", approx(year, 9203545, 0.01),
    Math.round(year).toLocaleString() + " s");
  check("Jool is a gas giant with 5 moons",
    !B.jool.solid && ["laythe", "vall", "tylo", "bop", "pol"].every((k) => B[k] && B[k].parent === "jool"), "");
  check("Laythe has air", !!B.laythe.atmosphere, "");
  check("Eve's air is thick (harder to leave than land)",
    B.eve.atmosphere.seaLevelDensity > 4, `rho=${B.eve.atmosphere.seaLevelDensity}`);
}

// --- 5. Pandora canon-shape checks: home is a MOON of the gas giant ---
{
  const sys = generateSystem("Avatar");
  const B = sys.bodies;
  check("Pandora's parent is Polyphemus (a gas giant)",
    B.earth.parent === "polyphemus" && !B.polyphemus.solid, "");
  check("Pandora orbits inside Polyphemus's SOI",
    B.earth.orbitRadius < B.polyphemus.soiRadius,
    `a=${B.earth.orbitRadius.toExponential(2)} soi=${B.polyphemus.soiRadius.toExponential(2)}`);
  check("Pandora gravity ≈ 0.8 g (canon)", approx(B.earth.g0, 7.85, 0.01), "");
  check("Pandora's air is thicker than Earth's",
    B.earth.atmosphere.seaLevelDensity > 1.225, "");
  check("Little Sister isn't a tinyMoon (readouts stay honest)", !B.moon.tinyMoon,
    `soi=${(B.moon.soiRadius / 1000).toFixed(0)} km vs r=${(B.moon.radius / 1000).toFixed(0)} km`);
}

// --- 6. FAMOUS_LIST entries resolve and match their builders ---
{
  for (const f of FAMOUS_LIST) {
    const sys = famousSystem(f.seed);
    check(`FAMOUS_LIST "${f.seed}" resolves`, !!sys && sys.name === f.name, "");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
