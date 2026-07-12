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
    ["Polyphemus", "Pandora"], ["Proxima", "Pandora"], ["proxima centauri", "Pandora"],
    ["Alpha Centauri B", "Pandora"],
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

// --- 5b. The triple star (his ask): all three Alpha Centauri stars, honest SOIs ---
{
  const sys = generateSystem("Pandora");
  const B = sys.bodies;
  check("three stars: A + B + Proxima all present", !!(B.sun && B.acb && B.proxima), "");
  check("companions are star-styled, orbit A, and have no surface to land on",
    ["acb", "proxima"].every((k) =>
      B[k].style && B[k].style.star && B[k].parent === "sun" && !B[k].solid), "");
  check("companions are targetable (in planetKeys)",
    ["acb", "proxima"].every((k) => sys.planetKeys.includes(k)), "");
  check("B rides at the true A–B average separation (23.5 AU)",
    approx(B.acb.orbitRadius / B.polyphemus.orbitRadius, 23.5 / 1.22, 0.001),
    `ratio=${(B.acb.orbitRadius / B.polyphemus.orbitRadius).toFixed(2)}`);
  check("B's gravity matches 274·m/r² for 0.907 M☉ / 0.865 R☉",
    approx(B.acb.g0, 274 * 0.907 / (0.865 ** 2), 0.01), `g0=${B.acb.g0}`);
  check("Proxima's gravity matches 274·m/r² for 0.122 M☉ / 0.154 R☉",
    approx(B.proxima.g0, 274 * 0.122 / (0.154 ** 2), 0.01), `g0=${B.proxima.g0}`);
  // Companion SOIs use the gravity-balance point (Laplace assumes a tiny mass ratio;
  // B is 0.82x A). Property: at the SOI edge, the companion's pull equals A's.
  for (const k of ["acb", "proxima"]) {
    const soi = B[k].soiRadius, a = B[k].orbitRadius;
    const gStar = B[k].mu / (soi * soi);
    const gSun = B.sun.mu / ((a - soi) * (a - soi));
    check(`${k}'s SOI sits at the gravity-balance point`, approx(gStar, gSun, 1e-9),
      `g(star)=${gStar.toExponential(3)} g(A)=${gSun.toExponential(3)}`);
  }
  // Readouts near any planet must never flip to a companion star.
  const planets = ["prometheus", "polyphemus", "boreas"];
  check("no planet's orbit ever enters a companion star's SOI",
    ["acb", "proxima"].every((s) =>
      planets.every((p) => B[p].orbitRadius < B[s].orbitRadius - B[s].soiRadius)), "");
  check("Polyphemus's SOI (home's whole neighborhood) clears B's SOI",
    B.polyphemus.orbitRadius + B.polyphemus.soiRadius < B.acb.orbitRadius - B.acb.soiRadius, "");
  check("the two companions' SOIs never overlap each other",
    B.proxima.orbitRadius - B.acb.orbitRadius > B.proxima.soiRadius + B.acb.soiRadius, "");
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
