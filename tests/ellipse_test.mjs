// Elliptical-rail tests: bodies with `ecc` must ride a REAL Kepler ellipse —
// focus at the parent, vis-viva speeds, second-law timing — and e=0 must
// reproduce the classic circular rail exactly.
// Run: node tests/ellipse_test.mjs
import { buildCatalog, setSystem, returnToSol, bodyStateAt, solveKepler, BODIES } from "../js/state.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};
const approx = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);

// A toy system: one star, one planet, two moons — a circular control and an
// eccentric test moon (e = 0.45, periapsis rotated).
const defs = {
  sun: { name: "TestStar", radius: 7e8, g0: 274, parent: null, a: 0, solid: false, atmo: null, phase0: 0, gen: true },
  earth: { name: "TestHome", radius: 6.4e6, g0: 9.8, parent: "sun", a: 1.5e11, solid: true,
           atmo: { height: 7e4, seaLevelDensity: 1.2 }, phase0: 0, gen: true },
  moon: { name: "CircMoon", radius: 1.7e6, g0: 1.6, parent: "earth", a: 3.8e8, solid: true, atmo: null, phase0: 0.5, gen: true },
  lava: { name: "EccMoon", radius: 1.2e6, g0: 1.4, parent: "earth", a: 6.0e8, solid: true, atmo: null,
          phase0: 0, gen: true, ecc: 0.45, periAngle: 1.1 },
};
const order = ["sun", "earth", "moon", "lava"];
const catalog = buildCatalog(defs, order, 1);
setSystem(catalog, order.slice(1), { key: "gen:ellipsetest", name: "Ellipse Test", seed: "EllipseTest" });

const L = BODIES.lava, E = BODIES.earth;
const a = L.orbitRadius, e = L.ecc, n = L.omega;
const period = (2 * Math.PI) / n;

// relative state helper (moon minus parent), plus scalar r and speed
const rel = (key, t) => {
  const m = bodyStateAt(key, t), p = bodyStateAt("earth", t);
  const rx = m.pos.x - p.pos.x, ry = m.pos.y - p.pos.y;
  const vx = m.vel.x - p.vel.x, vy = m.vel.y - p.vel.y;
  return { rx, ry, vx, vy, r: Math.hypot(rx, ry), v: Math.hypot(vx, vy) };
};

// --- 1. Kepler solver sanity ---
check("solveKepler(M, 0) = M", solveKepler(1.234, 0) === 1.234, "");
{
  const M = 2.1, e0 = 0.6, Ek = solveKepler(M, e0);
  check("solveKepler satisfies E - e·sinE = M", Math.abs(Ek - e0 * Math.sin(Ek) - M) < 1e-9, "");
}

// --- 2. e=0 bodies keep the exact classic circle ---
{
  const m = rel("moon", 123456);
  check("circular moon stays at a", approx(m.r, BODIES.moon.orbitRadius, 1e-9), "");
  check("circular moon speed = a·omega", approx(m.v, BODIES.moon.orbitRadius * BODIES.moon.omega, 1e-9), "");
}

// --- 3. The eccentric rail: geometry ---
{
  let rMin = Infinity, rMax = 0;
  for (let i = 0; i < 720; i++) {
    const s = rel("lava", (i / 720) * period);
    rMin = Math.min(rMin, s.r); rMax = Math.max(rMax, s.r);
  }
  check("periapsis ≈ a(1-e)", approx(rMin, a * (1 - e), 0.002), rMin.toExponential(3));
  check("apoapsis ≈ a(1+e)", approx(rMax, a * (1 + e), 0.002), rMax.toExponential(3));
  const s0 = rel("lava", 0), sT = rel("lava", period);
  check("orbit closes after one period",
    Math.hypot(s0.rx - sT.rx, s0.ry - sT.ry) < a * 1e-6, "");
  check("starts at periapsis when phase0=0 (M=0)", approx(s0.r, a * (1 - e), 1e-6), "");
  // periapsis direction respects periAngle
  check("periapsis points along periAngle",
    approx(Math.atan2(s0.ry, s0.rx), L.periAngle, 1e-6), `${Math.atan2(s0.ry, s0.rx)}`);
}

// --- 4. The eccentric rail: real dynamics ---
{
  const mu = E.mu;
  let ok = true, hRef = null, worstVis = 0;
  for (let i = 0; i < 360; i++) {
    const s = rel("lava", (i / 360) * period);
    // vis-viva: v² = mu(2/r − 1/a)
    const vv = Math.sqrt(mu * (2 / s.r - 1 / a));
    worstVis = Math.max(worstVis, Math.abs(s.v - vv) / vv);
    // angular momentum h = r × v is conserved (and CCW-positive)
    const h = s.rx * s.vy - s.ry * s.vx;
    if (hRef === null) hRef = h;
    if (!(h > 0) || !approx(h, hRef, 1e-6)) ok = false;
  }
  check("vis-viva speed everywhere on the rail", worstVis < 1e-6, `worst ${worstVis.toExponential(2)}`);
  check("angular momentum constant + CCW", ok, "");
  const peri = rel("lava", 0), apo = rel("lava", period / 2);
  check("second law: faster at periapsis than apoapsis",
    peri.v / apo.v > (1 + e) / (1 - e) - 0.01, `ratio ${(peri.v / apo.v).toFixed(3)}`);
  // velocity really is the time-derivative of position
  const dt = 1;
  const s1 = rel("lava", 1000), s2 = rel("lava", 1000 + dt);
  check("velocity = d(pos)/dt (numeric)",
    approx((s2.rx - s1.rx) / dt, s1.vx, 1e-3) && approx((s2.ry - s1.ry) / dt, s1.vy, 1e-3), "");
}

// --- 5. buildCatalog caps runaway eccentricity ---
{
  const wild = buildCatalog({
    sun: defs.sun,
    earth: defs.earth,
    moon: { ...defs.moon, ecc: 0.99 },
  }, ["sun", "earth", "moon"], 1);
  check("ecc capped at 0.9", wild.moon.ecc <= 0.9, `${wild.moon.ecc}`);
}

returnToSol();
check("returnToSol restores Sol (moon circular)", !BODIES.moon.ecc && BODIES.earth.name === "Earth", "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
