// Worked orbital numbers for the scaled Space Sim universe, computed live from the
// game's own BODIES catalog (js/state.js). Run from the repo root:
//   node .claude/skills/orbital-mechanics-reference/scripts/worked_numbers.mjs
// If any number here disagrees with SKILL.md's table, the catalog drifted — update the skill.
import { BODIES } from "../../../../js/state.js";

const SQRT_SCALE = Math.sqrt(0.1); // speed/period ratio game:real (see SKILL.md derivation)

console.log("body      R_km    mu(m^3/s^2)  rLow_km  vCirc_mps  T_low_min  vEsc_surf  g0");
for (const k of ["earth", "moon", "mars", "titan"]) {
  const b = BODIES[k];
  // rLow = Physics.parkingOrbit's radius rule (physics.js): clear of ground AND 3x atmo height.
  const rLow = Math.max(b.radius * 1.35, b.radius + 3 * ((b.atmosphere && b.atmosphere.height) || 0));
  const v = Math.sqrt(b.mu / rLow);                       // circular orbit speed
  const T = 2 * Math.PI * Math.sqrt(rLow ** 3 / b.mu);    // orbital period
  const vesc = Math.sqrt(2 * b.mu / b.radius);            // escape speed at the surface
  console.log(
    [k.padEnd(8), (b.radius / 1e3).toFixed(1).padStart(6), b.mu.toExponential(3).padStart(12),
     (rLow / 1e3).toFixed(1).padStart(8), v.toFixed(0).padStart(9),
     (T / 60).toFixed(1).padStart(10), vesc.toFixed(0).padStart(9), String(b.g0).padStart(6)].join("  "));
}

const E = BODIES.earth, M = BODIES.moon, Ma = BODIES.mars, S = BODIES.sun;
console.log("\nEarth year:", (2 * Math.PI / E.omega / 86400).toFixed(1), "game days",
  "(real 365.25 d x sqrt(0.1) =", (365.25 * SQRT_SCALE).toFixed(1) + ")");
console.log("Moon month:", (2 * Math.PI / M.omega / 86400).toFixed(2), "game days");

const aT = (E.orbitRadius + Ma.orbitRadius) / 2;
const tT = Math.PI * Math.sqrt(aT ** 3 / S.mu);
console.log("Earth->Mars Hohmann:", (tT / 86400).toFixed(1), "game days;",
  "lead angle:", ((Math.PI - Ma.omega * tT) * 180 / Math.PI).toFixed(1), "deg (scale-invariant)");

const rLEO = E.radius + E.atmosphere.height + 50000; // the test suites' standard LEO
const aM = (rLEO + M.orbitRadius) / 2;
const tM = Math.PI * Math.sqrt(aM ** 3 / E.mu);
console.log("LEO->Moon transfer:", (tM / 3600).toFixed(1), "game hours;",
  "lead angle:", ((Math.PI - M.omega * tM) * 180 / Math.PI).toFixed(1), "deg (Apollo TLI was ~120)");

console.log("Moon SOI:", (M.soiRadius / 1e3).toFixed(0), "km; Mars SOI:", (Ma.soiRadius / 1e3).toFixed(0), "km");
console.log("Moon orbit / Earth radius:", (M.orbitRadius / E.radius).toFixed(1), "(real ~60.3: geometry preserved)");
