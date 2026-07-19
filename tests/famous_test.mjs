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
    ["Luhman 16", "Luhman 16"], ["luhman", "Luhman 16"], ["Brown Dwarf", "Luhman 16"],
    ["the brown dwarfs", "Luhman 16"], ["Twilight", "Luhman 16"],
    ["Owius", "Owius"], ["pulsar", "Owius"], ["The Pulsar System", "Owius"],
    ["Sera", "Owius"], ["donk", "Owius"], ["the silent spire", "Owius"],
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

// --- 3. Role keys + flyability rules hold in every famous system ---
for (const seed of ["Kerbol", "Pandora", "Youngcow", "Luhman 16", "Owius"]) {
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

// --- 5c. The Youngcow System (his design): a baby solar system ---
{
  for (const [alias, want] of [["Youngcow", "Youngcow"], ["hundun", "Youngcow"],
    ["The Youngcow System", "Youngcow"], ["Sia", "Youngcow"], ["Centdra", "Youngcow"]]) {
    const sys = generateSystem(alias);
    check(`"${alias}" → ${want}`, sys.seed === want && sys.famous === "youngcow", `got seed=${sys.seed}`);
  }
  const sys = generateSystem("Youngcow");
  const B = sys.bodies;
  check("Youngcow is flagged young (extra asteroids/comets)", sys.young === true, "");
  check("star wears a protoplanetary disc (style.protoDisc inner<outer)",
    !!B.sun.style.protoDisc && B.sun.style.protoDisc.inner < B.sun.style.protoDisc.outer, "");
  check("four planet-slots: Sia, Hundun, Comet Konnie, Centdra",
    ["sia", "earth", "comet", "centdra"].every((k) => B[k] && B[k].parent === "sun"), "");
  check("Sia is the innermost, tidally-locked lava world",
    B.sia.orbitRadius < B.earth.orbitRadius && B.sia.face.kind === "lavaLocked", "");
  check("Hundun has a ring + life + two ground bases (one wrecked)",
    B.earth.style.rings === true && B.earth.style.life === "dinobird" &&
    Array.isArray(B.earth.style.bases) && B.earth.style.bases.length === 2 &&
    B.earth.style.bases.filter((b) => b.wrecked).length === 1, "");
  // Ember: the first body on a real elliptical rail
  check("Ember rides an elliptical rail (e=0.45)", B.moon.ecc === 0.45, "");
  check("Ember's whole ellipse stays inside Hundun's SOI",
    B.moon.orbitRadius * (1 + B.moon.ecc) < B.earth.soiRadius,
    `apo=${(B.moon.orbitRadius * 1.45).toExponential(2)} soi=${B.earth.soiRadius.toExponential(2)}`);
  check("Ember's periapsis clears Hundun itself",
    B.moon.orbitRadius * (1 - B.moon.ecc) > B.earth.radius * 3, "");
  // Pebble: lumpy accreting moonlet inside the ring — formation flying only
  check("Pebble is a tinyMoon (can't be orbited — fly formation)",
    B.pebble.tinyMoon === true && B.pebble.style.lumpy === true, "");
  check("Pebble sits closer than Ember (inside the ring region)",
    B.pebble.orbitRadius < B.moon.orbitRadius * (1 - B.moon.ecc), "");
  // Comet Konnie: low-but-nonzero gravity, orbitable, dives inside home's orbit
  check("Comet Konnie is eccentric and dives inside Hundun's orbit",
    B.comet.ecc === 0.6 && B.comet.orbitRadius * (1 - B.comet.ecc) < B.earth.orbitRadius, "");
  check("comet is NOT a tinyMoon (you can orbit + land on it)", !B.comet.tinyMoon,
    `soi=${(B.comet.soiRadius / 1000).toFixed(1)} km vs r=${(B.comet.radius / 1000).toFixed(1)} km`);
  {
    const vEsc = Math.sqrt(2 * B.comet.mu / B.comet.radius);
    check("comet escape speed ≈ bike speed (1–10 m/s)", vEsc > 1 && vEsc < 10,
      `${vEsc.toFixed(1)} m/s`);
  }
  // Centdra: still forming, inside the protoplanetary disc, own material disc
  check("Centdra orbits inside the protoplanetary disc",
    B.centdra.orbitRadius > B.sun.style.protoDisc.inner &&
    B.centdra.orbitRadius < B.sun.style.protoDisc.outer, "");
  check("Centdra wears its own forming disc", B.centdra.style.formingDisc === true, "");
}

// --- 5d. Luhman 16 (his ask: "hybrid planet-stars") — real brown dwarf numbers ---
{
  const sys = generateSystem("brown dwarf");
  const B = sys.bodies;
  const G = 6.674e-11, MJ = 1.898e27, RJ_GAME = 7.0e7; // entered radius, real meters
  check("both brown dwarfs present, star-styled, ember-flagged, no surface",
    ["sun", "luhb"].every((k) => B[k] && B[k].style.star && B[k].style.ember && !B[k].solid), "");
  check("A's gravity matches G·M/R² for 35.4 Jupiter masses at 1 R♃",
    approx(B.sun.g0, G * 35.4 * MJ / RJ_GAME ** 2, 0.005), `g0=${B.sun.g0}`);
  check("B's gravity matches G·M/R² for 29.4 Jupiter masses at 1 R♃",
    approx(B.luhb.g0, G * 29.4 * MJ / RJ_GAME ** 2, 0.005), `g0=${B.luhb.g0}`);
  check("the Jupiter-size quirk: both dwarfs the same radius, ~1 R♃",
    B.sun.radius === B.luhb.radius && approx(B.sun.radius, RJ_GAME * 0.1, 0.01),
    `r=${B.sun.radius.toExponential(2)}`);
  check("B is targetable (in planetKeys)", sys.planetKeys.includes("luhb"), "");
  // Companion SOI at the gravity-balance point (same property as Alpha Centauri B).
  {
    const soi = B.luhb.soiRadius, a = B.luhb.orbitRadius;
    const gStar = B.luhb.mu / soi ** 2, gSun = B.sun.mu / (a - soi) ** 2;
    check("B's SOI sits at the gravity-balance point", approx(gStar, gSun, 1e-9),
      `soi=${(soi / 1.496e10).toFixed(2)} AU`);
    check("Twilight's orbit never enters B's SOI", B.earth.orbitRadius < a - soi, "");
  }
  // The headline fact, predicted before running: a warm world by a dim brown dwarf
  // huddles at 0.008 AU, so its year is T = 2π·√(a³/mu) ≈ 38,900 s ≈ 10.8 h —
  // "about half a day" in the blurb must be honest.
  {
    const T = 2 * Math.PI * Math.sqrt(B.earth.orbitRadius ** 3 / B.sun.mu);
    check("Twilight's year ≈ 10.8 hours (predicted 38,900 s)", approx(T, 38900, 0.02),
      `T=${Math.round(T)} s = ${(T / 3600).toFixed(1)} h`);
    check("…which is honestly 'about half a day'", T < 12.5 * 3600, "");
  }
  check("Firefly is orbitable (not a tinyMoon)", !B.moon.tinyMoon,
    `soi=${Math.round(B.moon.soiRadius / 1000)} km vs 2r=${Math.round(B.moon.radius * 2 / 1000)} km`);
  check("the blurb confesses Twilight is imagined", /imagined/i.test(sys.blurb), "");
}

// --- 5e. Owius (HIS design: a pulsar system) — neutron-star numbers are real ---
{
  const sys = generateSystem("pulsar");
  const B = sys.bodies;
  const G = 6.674e-11, MSUN = 1.989e30, R_NS = 1.2e4; // entered radius, real meters
  check("Owius is a pulsar (star-styled, flagged, wrapped in a remnant)",
    B.sun.style.star && B.sun.style.pulsar && !!B.sun.style.remnant && !B.sun.solid, "");
  check("the pulsar is CITY-sized: 12 km real → 1.2 km in the scaled universe",
    B.sun.radius === R_NS * 0.1, `r=${B.sun.radius} m`);
  check("pulsar gravity matches G·M/R² for 1.4 solar masses at 12 km",
    approx(B.sun.g0, G * 1.4 * MSUN / R_NS ** 2, 0.005), `g0=${B.sun.g0.toExponential(3)}`);
  check("his five planets are all present, in his order",
    ["Donk", "Monk", "Sera", "Menia", "Ka"].every((n, i) =>
      B[["donk", "monk", "earth", "menia", "ka"][i]] &&
      B[["donk", "monk", "earth", "menia", "ka"][i]].name === n), "");
  // Sera's year, predicted before running: T = 2π·√(a³/mu) at 0.55 AU around
  // mu = g0·r² = 1.29e12·(1.2e3)² → 3.44e6 s ≈ 39.8 game-days.
  {
    const T = 2 * Math.PI * Math.sqrt(B.earth.orbitRadius ** 3 / B.sun.mu);
    check("Sera's year ≈ 39.8 days (predicted 3.44e6 s)", approx(T, 3.441e6, 0.01),
      `T=${(T / 86400).toFixed(1)} days`);
  }
  check("Sera wears its small ring and hosts the Silent Spire (alien base)",
    B.earth.style.rings === true &&
    Array.isArray(B.earth.style.bases) && B.earth.style.bases.some((b) => b.alien), "");
  check("Splinter is orbitable (not a tinyMoon)", !B.moon.tinyMoon,
    `soi=${Math.round(B.moon.soiRadius / 1000)} km vs 2r=${Math.round(B.moon.radius * 2 / 1000)} km`);
  check("Monk carries its bones (flag + fossil face)",
    B.monk.style.bones === true && B.monk.face.kind === "fossil", "");
  check("Donk's face is the cracked one (the lake lives in the paint)",
    B.donk.face.kind === "cracked", "");
  check("Menia is honestly a gas world: no surface to land on",
    B.menia.gas === undefined ? !B.menia.solid : !B.menia.solid, "");
  check("the blurb confesses the warm-Sera compromise",
    /confession/i.test(sys.blurb) && /gave Sera air/i.test(sys.blurb), "");
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
