// Phase 4 solar-system tests (node, no browser). Run: node planets_test.mjs
// Covers: body hierarchy, SOI dominance, launchpad co-motion, deep-space warp stability,
// the Mars transfer window + mission, Mars sky-crane lesson, and gas-giant "no surface".
import { Physics } from "../js/physics.js";
import { BODIES, PLANET_KEYS, newSimState, bodyStateAt, dominantBody } from "../js/state.js";

const E = BODIES.earth, SUN = BODIES.sun, MARS = BODIES.mars, M = BODIES.moon;
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// --- 1. Hierarchy sanity ---
{
  const e = bodyStateAt("earth", 0);
  check("Earth rides its solar orbit", Math.abs(Math.hypot(e.pos.x, e.pos.y) - E.orbitRadius) < 1,
    `r=${(Math.hypot(e.pos.x, e.pos.y) / 1e9).toFixed(3)} Gm`);
  const t = 12345;
  const m = bodyStateAt("moon", t), e2 = bodyStateAt("earth", t);
  const dEM = Math.hypot(m.pos.x - e2.pos.x, m.pos.y - e2.pos.y);
  check("Moon circles the moving Earth", Math.abs(dEM - M.orbitRadius) < 1,
    `d=${(dEM / 1e6).toFixed(2)} Mm`);
  const speedE = Math.hypot(e.vel.x, e.vel.y);
  check("Earth's solar speed plausible", Math.abs(speedE - Math.sqrt(SUN.mu / E.orbitRadius)) < 1,
    `${speedE.toFixed(0)} m/s`);
  let ok = true;
  for (const k of PLANET_KEYS) if (!(BODIES[k].soiRadius > BODIES[k].radius)) ok = false;
  check("every planet's SOI clears its own surface", ok);
  check("Moon orbit fits inside Earth's SOI", M.orbitRadius < E.soiRadius,
    `moon=${(M.orbitRadius / 1e6).toFixed(0)} Mm SOI=${(E.soiRadius / 1e6).toFixed(0)} Mm`);
}

// --- 2. SOI dominance ---
{
  const e = bodyStateAt("earth", 0);
  check("LEO belongs to Earth", dominantBody({ x: e.pos.x, y: e.pos.y + E.radius + 1e5 }, 0).body.key === "earth");
  const m = bodyStateAt("moon", 0);
  check("low lunar orbit belongs to the Moon", dominantBody({ x: m.pos.x + M.radius + 1e4, y: m.pos.y }, 0).body.key === "moon");
  const mid = { x: (E.orbitRadius + MARS.orbitRadius) / 2, y: 2e10 };
  check("interplanetary space belongs to the Sun", dominantBody(mid, 0).body.key === "sun");
  const ms = bodyStateAt("mars", 0);
  check("low Mars orbit belongs to Mars", dominantBody({ x: ms.pos.x + MARS.radius + 1e4, y: ms.pos.y }, 0).body.key === "mars");
}

// --- 3. Launchpad co-moves with Earth (you're standing on a planet flying around the Sun) ---
{
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying"; sim.craft.mass = 6;
  for (let i = 0; i < 200; i++) Physics.step(sim, 0.05);
  check("parked on the pad: altitude ~0, local speed ~0",
    Math.abs(sim.altitude) < 5 && sim.speed < 1,
    `alt=${sim.altitude.toFixed(1)} m speed=${sim.speed.toFixed(2)} m/s status=${sim.status}`);

  // TWR>1 straight up must climb away from the MOVING Earth.
  const sim2 = newSimState(E);
  sim2.mode = "flight"; sim2.status = "flying";
  sim2.craft.mass = 6; sim2.craft.throttle = 1;
  sim2.craft.thrust = 215; sim2.craft.exhaustVelocity = 2800; sim2.craft.fuelRemaining = 4;
  for (let t = 0; t < 30; t += 0.05) Physics.step(sim2, 0.05);
  check("launch climbs off the moving Earth", sim2.altitude > 3000 && sim2.soi === "Earth",
    `alt=${(sim2.altitude / 1000).toFixed(1)} km after 30 s`);
}

// --- 4. Deep-space time warp: big adaptive steps stay stable for a full solar orbit ---
{
  const r = E.orbitRadius;
  const v = Math.sqrt(SUN.mu / r);
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "orbit"; sim.target = "mars";
  sim.craft.pos = { x: -r, y: 0 }; sim.craft.vel = { x: 0, y: -v }; // far from Earth, CCW
  sim.craft.mass = 6; sim.craft.throttle = 0;
  const period = 2 * Math.PI * Math.sqrt(r ** 3 / SUN.mu);
  let minR = Infinity, maxR = -Infinity, calls = 0;
  while (sim.time < period && calls < 20000) {
    Physics.step(sim, 8000); calls++;
    const rr = Math.hypot(sim.craft.pos.x, sim.craft.pos.y);
    if (rr < minR) minR = rr;
    if (rr > maxR) maxR = rr;
  }
  check("one full solar orbit under 8000-s warp steps stays circular",
    (maxR - minR) / r < 0.02, `drift=${(((maxR - minR) / r) * 100).toFixed(2)}% calls=${calls}`);
  check("year length ≈ 2pi/omega", Math.abs(period - 2 * Math.PI / E.omega) / period < 1e-6,
    `${(period / 86400).toFixed(1)} days (scaled)`);

  const simL = newSimState(E); // physics-limited warp is reported, not silently wrong
  simL.mode = "flight"; simL.status = "flying"; simL.craft.mass = 6;
  Physics.step(simL, 1e9);
  check("absurd warp near a planet gets clamped + flagged", simL.warpLimited === true);
}

// --- 5. Mars transfer window from a Sun orbit: sane fields, then THE mission ---
{
  const r = E.orbitRadius;
  const v = Math.sqrt(SUN.mu / r);
  const mk = (t, th) => {
    const sim = newSimState(E, t);
    sim.mode = "flight"; sim.status = "orbit"; sim.time = t; sim.target = "mars";
    sim.craft.pos = { x: r * Math.cos(th), y: r * Math.sin(th) };
    sim.craft.vel = { x: -v * Math.sin(th), y: v * Math.cos(th) };
    sim.craft.mass = 6; sim.craft.throttle = 0;
    return sim;
  };
  const sim0 = mk(0, Math.PI / 2); // 90 deg away from Earth so Earth's gravity is irrelevant
  const tw = Physics.transferWindow(sim0, "mars");
  check("Mars window exists from Sun orbit", !!tw && tw.centralKey === "sun" && tw.dir === "prograde",
    tw ? `degToGo=${tw.degToGo.toFixed(1)} lead=${tw.leadAngle_deg.toFixed(1)}°` : "null");
  check("Mars transfer time ≈ scaled Hohmann (~82 days)", tw && Math.abs(tw.transferTime_s - 7.07e6) / 7.07e6 < 0.02,
    tw && `${(tw.transferTime_s / 86400).toFixed(1)} days`);
  check("no window while orbiting Earth and targeting Mars",
    Physics.transferWindow(mkLEO(), "mars") === null);
  function mkLEO() {
    const e = bodyStateAt("earth", 0);
    const rl = E.radius + E.atmosphere.height + 50000;
    const vl = Math.sqrt(E.mu / rl);
    const s = newSimState(E);
    s.mode = "flight"; s.status = "orbit";
    s.craft.pos = { x: e.pos.x + rl, y: e.pos.y }; s.craft.vel = { x: e.vel.x, y: e.vel.y + vl };
    s.craft.mass = 6;
    return s;
  }

  // THE mission: coast to the window, burn prograde to Mars-distance apoapsis, coast, arrive.
  const sim = mk(0, Math.PI / 2);
  sim.craft.thrust = 215; sim.craft.exhaustVelocity = 2800; sim.craft.fuelRemaining = 4;

  let tw2 = null, guard = 0;
  while (guard++ < 200000) {
    tw2 = Physics.transferWindow(sim, "mars");
    if (!tw2) break;
    if (tw2.degToGo <= 0.05 || tw2.degToGo >= 359.95) break;
    // Adaptive coast: jump most of the remaining time, never past the window.
    Physics.step(sim, Math.max(200, Math.min(8000, tw2.timeToWindow_s * 0.5)));
  }
  check("coasted to an open Mars window", !!tw2 && (tw2.degToGo <= 0.05 || tw2.degToGo >= 359.95),
    tw2 ? `degToGo=${tw2.degToGo.toFixed(3)} after ${(sim.time / 86400).toFixed(1)} days` : "window vanished");

  let burnT = 0;
  while (burnT < 120) {
    const vv = sim.craft.vel; // Sun-relative = world (the Sun sits at the origin)
    sim.craft.angle = Math.atan2(-vv.x, vv.y);
    sim.craft.throttle = 1;
    Physics.step(sim, 0.1);
    burnT += 0.1;
    const o = Physics.computeOrbit(sim);
    if (o && isFinite(o.apoapsis) && SUN.radius + o.apoapsis >= MARS.orbitRadius) break;
  }
  sim.craft.throttle = 0;
  const oAfter = Physics.computeOrbit(sim);
  const apoR = SUN.radius + (oAfter ? oAfter.apoapsis : 0);
  check("burn raised solar apoapsis to ~Mars distance", oAfter && apoR >= MARS.orbitRadius * 0.99 && apoR <= MARS.orbitRadius * 1.1,
    `apoR=${(apoR / 1e9).toFixed(2)} Gm vs Mars at ${(MARS.orbitRadius / 1e9).toFixed(2)} Gm, burn ${burnT.toFixed(1)}s`);

  const tLimit = sim.time + 1.6 * tw2.transferTime_s;
  let minD = Infinity;
  while (sim.time < tLimit && sim.soi !== "Mars" && sim.status !== "crashed") {
    Physics.step(sim, 4000);
    const ms = bodyStateAt("mars", sim.time);
    const d = Math.hypot(sim.craft.pos.x - ms.pos.x, sim.craft.pos.y - ms.pos.y);
    if (d < minD) minD = d;
  }
  check("arrived at Mars (inside or grazing its SOI)", sim.soi === "Mars" || minD < 2 * MARS.soiRadius,
    `soi=${sim.soi} closest=${(minD / 1e6).toFixed(1)} Mm (SOI=${(MARS.soiRadius / 1e6).toFixed(1)} Mm)`);
}

// --- 5b. Mid-course correction rescues a SLOPPY transfer (the kid reality) ---
{
  const r = E.orbitRadius;
  const v = Math.sqrt(SUN.mu / r);
  const sim = newSimState(E, 0);
  sim.mode = "flight"; sim.status = "orbit"; sim.target = "mars";
  sim.craft.pos = { x: 0, y: r }; sim.craft.vel = { x: -v, y: 0 }; // CCW, 90° from Earth
  sim.craft.mass = 6; sim.craft.throttle = 0;
  sim.craft.thrust = 215; sim.craft.exhaustVelocity = 2800; sim.craft.fuelRemaining = 4;

  // Coast to the window SLOPPILY: stop ~2 degrees early (a kid's reflexes).
  let tw = null, guard = 0;
  while (guard++ < 100000) {
    tw = Physics.transferWindow(sim, "mars");
    if (!tw) break;
    if (tw.degToGo <= 8 || tw.degToGo >= 358) break; // VERY sloppy: 8 degrees early
    Physics.step(sim, Math.max(200, Math.min(8000, tw.timeToWindow_s * 0.5)));
  }
  // Burn prograde to Mars-distance apoapsis (also sloppy: cut a hair over).
  let burnT = 0;
  while (burnT < 120) {
    const vv = sim.craft.vel;
    sim.craft.angle = Math.atan2(-vv.x, vv.y);
    sim.craft.throttle = 1;
    Physics.step(sim, 0.1); burnT += 0.1;
    const o = Physics.computeOrbit(sim);
    if (o && isFinite(o.apoapsis) && SUN.radius + o.apoapsis >= MARS.orbitRadius * 1.02) break; // and overshoots
  }
  sim.craft.throttle = 0;

  const c0 = Physics.courseCorrection(sim, "mars");
  check("sloppy burn: course check reports a real miss with a fix direction",
    !!c0 && !c0.onTarget && !!c0.burnVec,
    c0 ? `miss=${(c0.miss / 1e6).toFixed(0)} Mm dir=${c0.dirLabel}` : "null");

  // Follow the guidance: short tangential burns in the suggested direction until onTarget.
  let fixes = 0;
  let c = c0;
  while (c && !c.onTarget && c.burnVec && fixes < 400) {
    sim.craft.angle = Math.atan2(-c.burnVec.x, c.burnVec.y); // nose along the gold arrow
    sim.craft.throttle = 0.3;
    Physics.step(sim, 0.1);
    sim.craft.throttle = 0;
    c = Physics.courseCorrection(sim, "mars");
    fixes++;
  }
  check("following the gold arrow converges to on-target", !!c && c.onTarget === true,
    c ? `after ${fixes} nudges, miss=${(c.miss / 1e6).toFixed(1)} Mm (SOI=${(MARS.soiRadius / 1e6).toFixed(1)} Mm)` : "lost the plot");

  // Cruise: must actually enter Mars's SOI now.
  const tLimit = sim.time + 1.5 * (tw ? tw.transferTime_s : 7.1e6);
  while (sim.time < tLimit && sim.soi !== "Mars" && sim.status !== "crashed") {
    Physics.step(sim, 4000);
  }
  check("corrected cruise arrives inside Mars's SOI", sim.soi === "Mars", `soi=${sim.soi}`);
}

// --- 6. Mars landing: chute alone is NOT enough (thin air) — engines + chute land it ---
{
  const drop = (useEngine) => {
    const ms = bodyStateAt("mars", 0);
    const sim = newSimState(E);
    sim.mode = "flight"; sim.status = "flying"; sim.target = "mars";
    const r = MARS.radius + 8000;
    sim.craft.pos = { x: ms.pos.x + r, y: ms.pos.y };
    sim.craft.vel = { x: ms.vel.x - 40, y: ms.vel.y }; // falling at 40 m/s toward Mars
    sim.craft.mass = 1.5; sim.craft.throttle = 0;
    sim.craft.chuteCount = 1; sim.craft.chuteDeployed = true;
    if (useEngine) { sim.craft.thrust = 215; sim.craft.exhaustVelocity = 2800; sim.craft.fuelRemaining = 2; }
    let everOpen = false, steps = 0;
    while (sim.status !== "landed" && sim.status !== "crashed" && steps++ < 200000) {
      if (useEngine) {
        const msN = bodyStateAt("mars", sim.time);
        const rel = { x: sim.craft.pos.x - msN.pos.x, y: sim.craft.pos.y - msN.pos.y };
        const rm = Math.hypot(rel.x, rel.y), ur = { x: rel.x / rm, y: rel.y / rm };
        const vr = (sim.craft.vel.x - msN.vel.x) * ur.x + (sim.craft.vel.y - msN.vel.y) * ur.y;
        const alt = rm - MARS.radius;
        sim.craft.angle = Math.atan2(-ur.x, ur.y);
        // Proportional throttle — bang-bang with a 143 m/s^2 engine on a 1.5 t capsule
        // just bounces. Hover throttle here is ~0.03, so cap low.
        const targetVr = -Math.max(2, Math.min(12, alt / 30));
        sim.craft.throttle = Math.min(0.2, Math.max(0, (targetVr - vr) * 0.1));
      }
      Physics.step(sim, 0.05);
      if (sim.chuteOpen) everOpen = true;
    }
    return { sim, everOpen };
  };
  const a = drop(false);
  check("Mars: chute opens in the thin air but can't land you alone (sky-crane lesson)",
    a.everOpen && a.sim.status === "crashed",
    `chuteOpened=${a.everOpen} status=${a.sim.status} impact≈${a.sim.speed.toFixed(1)} m/s`);
  const b = drop(true);
  check("Mars: chute + engine braking lands softly", b.sim.status === "landed" && b.sim.landed.body === "mars",
    `status=${b.sim.status} on=${b.sim.landed && b.sim.landed.body}`);
}

// --- 6b. Moons of other planets: hierarchy, SOI nesting, and the Titan chute lesson ---
{
  const IO = BODIES.io, TITAN = BODIES.titan;
  let ok = true;
  for (const k of ["io", "europa", "ganymede", "callisto", "titan"])
    if (!(BODIES[k].soiRadius > BODIES[k].radius * 2)) ok = false;
  check("every added moon's SOI comfortably clears its surface", ok);

  const t = 5000;
  const io = bodyStateAt("io", t), ju = bodyStateAt("jupiter", t);
  check("Io circles the moving Jupiter", Math.abs(Math.hypot(io.pos.x - ju.pos.x, io.pos.y - ju.pos.y) - IO.orbitRadius) < 1);
  check("low Io orbit belongs to Io", dominantBody({ x: io.pos.x + IO.radius + 5e4, y: io.pos.y }, t).body.key === "io");
  const between = { x: ju.pos.x + IO.orbitRadius * 1.3, y: ju.pos.y }; // outside Io, inside Jupiter SOI
  check("between the moons belongs to Jupiter", dominantBody(between, t).body.key === "jupiter");

  // Titan: air thicker than Earth's — a parachute ALONE lands you (the Huygens lesson).
  const ts = bodyStateAt("titan", 0);
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying"; sim.target = "titan";
  // 3 km up, not 30: under the chute Titan's descent is ~0.8 m/s (Huygens really did take
  // 2.5 hours) and the test budget can't afford the full scenic route.
  const r = TITAN.radius + 3000;
  sim.craft.pos = { x: ts.pos.x + r, y: ts.pos.y };
  sim.craft.vel = { x: ts.vel.x - 50, y: ts.vel.y };
  sim.craft.mass = 1.5; sim.craft.throttle = 0;
  sim.craft.chuteCount = 1; sim.craft.chuteDeployed = true;
  let everOpen = false, steps = 0;
  while (sim.status !== "landed" && sim.status !== "crashed" && steps++ < 400000) {
    Physics.step(sim, 0.05);
    if (sim.chuteOpen) everOpen = true;
  }
  check("Titan: parachute alone lands softly (Huygens 2005)",
    sim.status === "landed" && sim.landed.body === "titan" && everOpen,
    `status=${sim.status} on=${sim.landed && sim.landed.body} chute=${everOpen}`);
}

// --- 7. Gas giants have no surface ---
{
  const js = bodyStateAt("jupiter", 0);
  const J = BODIES.jupiter;
  const sim = newSimState(E);
  sim.mode = "flight"; sim.status = "flying"; sim.target = "jupiter";
  sim.craft.pos = { x: js.pos.x + J.radius + J.atmosphere.height + 50000, y: js.pos.y };
  sim.craft.vel = { x: js.vel.x - 3000, y: js.vel.y }; // diving in
  sim.craft.mass = 2; sim.craft.throttle = 0;
  let steps = 0;
  while (sim.status !== "crashed" && sim.status !== "landed" && steps++ < 400000) Physics.step(sim, 0.05);
  check("diving into Jupiter never 'lands' — you burn or sink", sim.status === "crashed" &&
    (sim.sankIntoClouds === true || sim.burnedUp === true),
    `status=${sim.status} sank=${!!sim.sankIntoClouds} burned=${!!sim.burnedUp}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
