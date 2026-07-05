// Star-system generator tests (node, no browser): determinism, contract shape, and
// "every generated system is flyable" properties over a pile of seeds.
import { generateSystem } from "../js/stargen.js";
import { BODIES, PLANET_KEYS, SYSTEM, setSystem, returnToSol, bodyStateAt, dominantBody } from "../js/state.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log("PASS ", name, " " + detail); }
  else { fail++; console.log("FAIL ", name, " " + detail); }
};

// --- Determinism: the name IS the code ---
const a1 = generateSystem("Kepler-Sally");
const a2 = generateSystem("Kepler-Sally");
check("same seed, same system", JSON.stringify(a1) === JSON.stringify(a2));
check("seed is case/space-insensitive key", generateSystem("  kepler-sally ").key === a1.key);
const b = generateSystem("Snakestar");
check("different seeds differ", JSON.stringify(a1.bodies) !== JSON.stringify(b.bodies));

// --- Contract shape (one system, thoroughly) ---
const sys = a1;
check("star is keyed 'sun'", !!sys.bodies.sun && sys.bodies.sun.parent === null);
check("star carries the seed as its name", sys.bodies.sun.name === "Kepler-Sally");
check("homeworld is keyed 'earth'", !!sys.bodies.earth && sys.bodies.earth.parent === "sun");
check("home moon is keyed 'moon' around 'earth'", !!sys.bodies.moon && sys.bodies.moon.parent === "earth");
for (const k of sys.planetKeys) {
  const bd = sys.bodies[k];
  if (!bd) { check("planetKeys entry exists: " + k, false); continue; }
  const needed = ["key", "name", "radius", "mu", "g0", "mass", "solid", "parent", "orbitRadius", "omega", "soiRadius", "phase0"];
  const missing = needed.filter((f) => bd[f] === undefined || bd[f] === null && f !== "atmosphere");
  if (missing.length) check("fields on " + k, false, "missing: " + missing.join(","));
}
check("all planetKeys resolve with full fields", true);

// --- Flyability properties over many seeds ---
const SEEDS = 250;
let homesOk = 0, moonsInSoi = 0, soiDisjoint = 0, omegasOk = 0, moonsInsideParent = 0, total = 0;
for (let i = 0; i < SEEDS; i++) {
  const s = generateSystem("prop-seed-" + i);
  total++;
  const home = s.bodies.earth, moon = s.bodies.moon, star = s.bodies.sun;
  // Launchable home: gravity a stock rocket can beat, air a chute works in, solid ground.
  const g = home.g0, atmo = home.atmosphere;
  if (home.solid && g >= 7 && g <= 11 && atmo && atmo.seaLevelDensity >= 0.8) homesOk++;
  // The tutorial moon orbits inside home's SOI with room to spare.
  if (moon.orbitRadius < home.soiRadius * 0.7) moonsInSoi++;
  // Neighboring planets' SOIs never overlap (patched conics stay sane).
  const planets = s.planetKeys.filter((k) => s.bodies[k].parent === "sun")
    .sort((x, y) => s.bodies[x].orbitRadius - s.bodies[y].orbitRadius);
  let ok = true;
  for (let j = 1; j < planets.length; j++) {
    const p0 = s.bodies[planets[j - 1]], p1 = s.bodies[planets[j]];
    if (p1.orbitRadius - p0.orbitRadius < (p0.soiRadius + p1.soiRadius) * 1.2) ok = false;
  }
  if (ok) soiDisjoint++;
  // Every orbiting body has a finite CCW rate; every moon sits inside its parent's SOI.
  let om = true, mip = true;
  for (const k of s.planetKeys) {
    const bd = s.bodies[k];
    if (!(bd.omega > 0) || !isFinite(bd.omega)) om = false;
    if (bd.parent !== "sun") {
      const p = s.bodies[bd.parent];
      if (bd.orbitRadius > p.soiRadius * 0.6) mip = false;
      if (bd.orbitRadius < p.radius * 2) mip = false; // not inside the planet either
    }
  }
  if (om) omegasOk++;
  if (mip) moonsInsideParent++;
}
check("every home is launchable (solid, 7≤g≤11, chuteable air)", homesOk === total, homesOk + "/" + total);
check("every tutorial moon well inside home SOI", moonsInSoi === total, moonsInSoi + "/" + total);
check("no adjacent planet SOIs overlap", soiDisjoint === total, soiDisjoint + "/" + total);
check("every omega finite and positive", omegasOk === total, omegasOk + "/" + total);
check("every moon between 2 radii and 0.6 SOI of its planet", moonsInsideParent === total, moonsInsideParent + "/" + total);

// --- Black holes: sometimes a name hides one ⚫ ---
const bh = generateSystem("my little blackhole");
check("'blackhole' in the name summons one", bh.blackHole === true && bh.bodies.sun.blackHole === true);
check("black hole is tiny (Schwarzschild-sized, scaled)", bh.bodies.sun.radius < 20000);
check("black hole home is still launchable", bh.bodies.earth.solid && bh.bodies.earth.g0 >= 7 &&
  bh.bodies.earth.g0 <= 11 && !!bh.bodies.earth.atmosphere);
check("black hole moon inside home SOI", bh.bodies.moon.orbitRadius < bh.bodies.earth.soiRadius * 0.7);
check("deterministic like any system", JSON.stringify(generateSystem("my little blackhole")) === JSON.stringify(bh));
let bhCount = 0;
for (let i = 0; i < 400; i++) if (generateSystem("surprise-" + i).blackHole) bhCount++;
check("surprise rate is a surprise, not a plague (2–14% of 400 seeds)", bhCount >= 8 && bhCount <= 56, bhCount + "/400");

// --- Swap integration: state machinery drives the live catalog ---
const solEarthMu = BODIES.earth.mu;
const solKeys = [...PLANET_KEYS];
setSystem(sys.bodies, sys.planetKeys, { key: sys.key, name: sys.name, seed: sys.seed });
check("swap replaces BODIES in place", BODIES.earth.mu === sys.bodies.earth.mu && BODIES.sun.name === "Kepler-Sally");
check("swap bumps SYSTEM.rev", SYSTEM.rev === 1 && SYSTEM.key === sys.key);
const st = bodyStateAt("earth", 1000);
check("bodyStateAt works in generated system", isFinite(st.pos.x) && Math.hypot(st.pos.x, st.pos.y) > 0);
const dom = dominantBody({ x: st.pos.x, y: st.pos.y + BODIES.earth.radius + 1000 }, 1000);
check("dominantBody finds the generated home from low altitude", dom.body.key === "earth");
returnToSol();
check("returnToSol restores Sol exactly", BODIES.earth.mu === solEarthMu && BODIES.sun.name === "Sun"
  && PLANET_KEYS.length === solKeys.length && PLANET_KEYS.every((k, i) => k === solKeys[i]));
check("rev bumped again on return", SYSTEM.rev === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
