// physics.js — planar 2D orbital integrator for the space sim.
// API frozen in ../ARCHITECTURE.md. PURE module: no DOM, no Three.js.
//
// Conventions (see ARCHITECTURE.md):
//   - WORLD origin = center of the SUN (Phase 4 heliocentric). Positions/velocities in m & m/s.
//   - Every body rides a fixed circular CCW orbit around its parent (state.js bodyStateAt).
//   - Gravity is SUPERPOSED from every body, every step — no patched-conic hand-off.
//     "Dominant body" (SOI) is only a display/readout concept.
//   - Mass in tonnes (t), thrust in kN, exhaust velocity in m/s, time in seconds.
//   - Angle in radians, 0 = pointing along +Y, increasing CCW.
//     => thrust/heading unit vector = (-sin angle, cos angle).
//
// INTEGRATOR NOTE — thrust/fuel inputs the integrator (main.js) must set at launch:
//   sim.craft reads the active stage's propulsion from two OPTIONAL live fields:
//       sim.craft.thrust            — active total thrust in kN (already throttle-able)
//       sim.craft.exhaustVelocity   — effective exhaust velocity in m/s (Isp*g0)
//   If either is missing/zero, step() runs gravity-only (coast).
//   Fuel is tracked as sim.craft.fuelRemaining (t); at 0, thrust is forced to 0.

import { BODIES, PLANET_KEYS, bodyStateAt, dominantBody } from "./state.js";

// --- small vector helpers (plain {x,y}) ---
function mag(v) { return Math.hypot(v.x, v.y); }

const LAND_SPEED = 5;        // m/s descent-rate threshold for a soft landing (vs the surface)
const LAND_TOTAL = 12;       // m/s total surface-relative speed bound (sideways skids count)
const LEGS_LAND_SPEED = 12;  // with landing legs aboard: struts soak up a harder hit
const LEGS_LAND_TOTAL = 18;

// --- Reentry heating ---
// Hull heat (sim.heat, 0..1; 1 = burned up) RELAXES toward an equilibrium set by the
// instantaneous heat flux rho * v^3 (v RELATIVE to the atmosphere's body). Peak flux,
// not total energy, is what melts ships — see HANDOFF for the tuning rationale.
const HEAT_EQ_K = 3.8e-9; // equilibrium heat per (kg/m^3 * (m/s)^3)
const HEAT_TAU = 4;       // seconds to relax toward equilibrium (up and down)

// --- Parachute ---
// A deployed chute adds huge drag area — but ONLY where there's air (Earth yes, Moon no,
// Mars barely: that contrast is the lesson). It won't open above CHUTE_MAX_SPEED.
const CHUTE_CDA = 1200;      // m^2 effective drag area per parachute
const CHUTE_MAX_SPEED = 250; // m/s (relative to the air) — faster and it streams uselessly

// All body keys including the Sun, for gravity + collision sweeps.
const ALL_KEYS = ["sun", ...PLANET_KEYS];

// Heading unit vector for a given angle (0 = +Y, CCW positive).
function headingVec(angle) {
  return { x: -Math.sin(angle), y: Math.cos(angle) };
}

// Gravitational acceleration at `pos` toward a body at `bpos` with parameter mu. {x,y} m/s^2.
function gravToward(pos, bpos, mu) {
  const dx = bpos.x - pos.x, dy = bpos.y - pos.y;
  const r2 = dx * dx + dy * dy;
  const r = Math.sqrt(r2);
  if (r <= 0) return { x: 0, y: 0 };
  const a = mu / (r2 * r);
  return { x: a * dx, y: a * dy };
}

// Atmospheric density via simple exponential model. 0 at/above atmosphere top.
// Scale height ~ height/5 keeps density a few % of sea level at the top.
function airDensity(altitude, atmosphere) {
  if (!atmosphere || altitude >= atmosphere.height) return 0;
  const H = atmosphere.height / 5;
  return atmosphere.seaLevelDensity * Math.exp(-Math.max(0, altitude) / H);
}

// Positions+velocities of every body at time t, computed ONCE per substep and shared by
// gravity, air, and collision checks. [{key, body, pos, vel}]
function allBodyStates(t) {
  const out = [];
  for (const key of ALL_KEYS) {
    const st = bodyStateAt(key, t);
    out.push({ key, body: BODIES[key], pos: st.pos, vel: st.vel });
  }
  return out;
}

// Which body's atmosphere (if any) is the craft inside? Returns {state, rho, alt} or null.
function airAt(pos, states) {
  for (const s of states) {
    if (!s.body.atmosphere) continue;
    const alt = Math.hypot(pos.x - s.pos.x, pos.y - s.pos.y) - s.body.radius;
    if (alt < s.body.atmosphere.height) {
      const rho = airDensity(alt, s.body.atmosphere);
      if (rho > 0) return { state: s, rho, alt };
    }
  }
  return null;
}

export const Physics = {
  // Largest stable integration substep (seconds) for the craft's CURRENT situation.
  // Three limits, take the smallest:
  //   1) dynamics: a fixed small fraction of the dominant body's local orbital rate
  //      (fine steps in LEO, hour-long steps cruising between planets);
  //   2) anti-tunneling: never cross more than ~10% of the gap to any body's surface
  //      in one step (this is also what makes landings precise);
  //   3) thrust/air: burning or flying through atmosphere always integrates finely.
  maxStableStep(sim) {
    const c = sim.craft;
    const t = sim.time || 0;
    const dom = dominantBody(c.pos, t);
    const r = Math.max(1, mag(dom.rel));
    const om = Math.sqrt(dom.body.mu / (r * r * r));
    let h = 0.003 / om; // ~2000 substeps per local orbit
    const states = allBodyStates(t);
    for (const s of states) {
      const d = Math.hypot(c.pos.x - s.pos.x, c.pos.y - s.pos.y) - s.body.radius;
      if (d < 0) continue;
      const vrel = Math.hypot(c.vel.x - s.vel.x, c.vel.y - s.vel.y);
      h = Math.min(h, Math.max(0.05, (0.1 * d) / (vrel + 1)));
    }
    const air = airAt(c.pos, states);
    if (air) h = Math.min(h, 0.05);
    const thrusting = (c.throttle || 0) > 0 && (c.thrust || 0) > 0 && (c.fuelRemaining || 0) > 0;
    if (thrusting) h = Math.min(h, 0.1);
    return Math.max(0.02, Math.min(h, 20000));
  },

  // Advance sim.craft one timestep dt (seconds) under gravity + thrust + drag.
  step(sim, dt) {
    if (!sim || !sim.craft || !(dt > 0)) return sim;
    const c = sim.craft;

    // --- Landed: stay glued to the surface, co-moving with the body as it flies its orbit.
    // Throttling up with fuel lifts back off — that's how you fly home. ---
    if (sim.status === "landed" && sim.landed) {
      const wantsLiftoff = c.throttle > 0 && c.thrust > 0 &&
        (c.fuelRemaining || 0) > 0 && (c.exhaustVelocity || 0) > 0;
      if (!wantsLiftoff) {
        const t2 = (sim.time || 0) + dt;
        const bs = bodyStateAt(sim.landed.body, t2);
        c.pos = { x: bs.pos.x + sim.landed.offset.x, y: bs.pos.y + sim.landed.offset.y };
        c.vel = { x: bs.vel.x, y: bs.vel.y };
        sim.time = t2;
        this._refreshReadouts(sim);
        sim.orbit = this.computeOrbit(sim);
        return sim;
      }
      // Lifting off again: resume normal integration.
      sim.status = "flying";
      sim.landed = null;
    }

    // --- propulsion for this step ---
    const throttle = clamp01(c.throttle == null ? 0 : c.throttle);
    const fuel = c.fuelRemaining == null ? 0 : c.fuelRemaining; // tonnes
    const ve = c.exhaustVelocity || 0; // m/s
    let thrustKN = 0;
    if (c.thrust && ve > 0 && fuel > 0 && throttle > 0) {
      thrustKN = c.thrust * throttle; // kN
    }
    let thrustN = thrustKN * 1000; // N
    let massKg = (c.mass || 0) * 1000; // kg

    // Fuel burn by mass: massFlow = thrust_N / ve (kg/s). Cap by remaining fuel.
    let burnKg = 0;
    if (thrustN > 0 && ve > 0) {
      burnKg = (thrustN / ve) * dt; // kg burned this step
      const fuelKg = fuel * 1000;
      if (burnKg >= fuelKg) {
        const frac = fuelKg > 0 ? fuelKg / burnKg : 0;
        thrustN *= frac;
        burnKg = fuelKg;
      }
    }

    // --- integrate (semi-implicit / symplectic Euler with ADAPTIVE sub-stepping) ---
    // The stable substep spans 0.02 s (landing burn in LEO) to hours (coasting between
    // planets), so half-million-x time warp stays cheap AND launches stay precise.
    // Substeps per call are capped; if the cap bites we integrate less than dt and say so
    // (sim.warpLimited) — main.js shows the warp as "physics-limited" instead of lying.
    const hStable = this.maxStableStep(sim);
    const MAX_SUBSTEPS = 5000;
    let steps = Math.max(1, Math.ceil(dt / hStable));
    let h = dt / steps;
    sim.warpLimited = false;
    if (steps > MAX_SUBSTEPS) {
      steps = MAX_SUBSTEPS;
      h = hStable;
      sim.warpLimited = true; // we'll advance steps*h < dt of sim time this frame
    }

    let pos = { x: c.pos.x, y: c.pos.y };
    let vel = { x: c.vel.x, y: c.vel.y };
    const angle = c.angle || 0;
    let tNow = sim.time || 0; // advances each substep so every body is where it really is

    let crashed = false, landed = false, landedInfo = null;
    let airInfo = null; // last substep's air contact (for heat + chute readouts)
    // Body states refresh at the END of each substep (post-integration) so the collision
    // sweep compares the craft's NEW position against where each body actually IS.
    // Checking against start-of-substep positions made touchdown trigger up to
    // ~|v_body|*h ≈ 500 m early or late depending on which side of the world you landed.
    let states = allBodyStates(tNow);
    for (let i = 0; i < steps; i++) {

      // Gravity from EVERYONE (restricted n-body superposition).
      const acc = { x: 0, y: 0 };
      for (const s of states) {
        const g = gravToward(pos, s.pos, s.body.mu);
        acc.x += g.x; acc.y += g.y;
      }

      // Thrust along heading.
      if (thrustN > 0 && massKg > 0) {
        const hv = headingVec(angle);
        const at = thrustN / massKg;
        acc.x += hv.x * at;
        acc.y += hv.y * at;
      }

      // Atmosphere: drag (and the parachute) push against the LOCAL AIR, which moves with
      // its planet — a landed craft in wind-still air feels no drag even though the planet
      // is tearing around the Sun.
      airInfo = airAt(pos, states);
      sim.chuteOpen = false;
      if (airInfo && massKg > 0) {
        const av = airInfo.state.vel;
        const rvx = vel.x - av.x, rvy = vel.y - av.y;
        const rspeed = Math.hypot(rvx, rvy);
        let chuteCdA = 0;
        if (c.chuteDeployed && (c.chuteCount || 0) > 0 &&
            airInfo.rho > 0.001 && rspeed < CHUTE_MAX_SPEED) {
          chuteCdA = CHUTE_CDA * c.chuteCount;
          sim.chuteOpen = true;
        }
        if (rspeed > 0) {
          const CdA = 2.0 + chuteCdA; // m^2 (hull drag + open parachute, if any)
          const dragMag = 0.5 * airInfo.rho * rspeed * rspeed * CdA; // Newtons
          let ad = dragMag / massKg;
          ad = Math.min(ad, (0.9 * rspeed) / h); // may slow but never reverse in one step
          acc.x -= (rvx / rspeed) * ad;
          acc.y -= (rvy / rspeed) * ad;
        }
      }

      // semi-implicit Euler: update velocity first, then position.
      vel.x += acc.x * h;
      vel.y += acc.y * h;
      pos.x += vel.x * h;
      pos.y += vel.y * h;
      tNow += h;
      states = allBodyStates(tNow); // fresh positions: collision now + gravity next substep

      // --- Surface collision against every body (all of them move) ---
      for (const s of states) {
        const relX = pos.x - s.pos.x, relY = pos.y - s.pos.y;
        const rM = Math.hypot(relX, relY);
        if (rM > s.body.radius) continue;
        const ur = rM > 0 ? { x: relX / rM, y: relY / rM } : { x: 0, y: 1 };
        const vrel = { x: vel.x - s.vel.x, y: vel.y - s.vel.y };
        const vRadial = vrel.x * ur.x + vrel.y * ur.y; // negative = descending into it
        // Only "contact" when moving INTO the surface (lets a liftoff climb out cleanly).
        if (vRadial > 0) continue;
        pos.x = s.pos.x + ur.x * s.body.radius;
        pos.y = s.pos.y + ur.y * s.body.radius;
        if (!s.body.solid) {
          // No surface to stand on: the Sun melts you, gas giants swallow you.
          crashed = true;
          sim.crashedInto = s.key;
          if (s.key === "sun") sim.burnedUp = true;
          else sim.sankIntoClouds = true;
        } else {
          const descentSpeed = Math.abs(vRadial);
          // Landing legs raise the survivable touchdown speeds — that's their whole job.
          const legs = (c.legCount || 0) > 0;
          const maxDown = legs ? LEGS_LAND_SPEED : LAND_SPEED;
          const maxTotal = legs ? LEGS_LAND_TOTAL : LAND_TOTAL;
          if (descentSpeed > maxDown || mag(vrel) > maxTotal) {
            crashed = true;
            sim.crashedInto = s.key;
          } else {
            landed = true;
            landedInfo = { body: s.key, offset: { x: ur.x * s.body.radius, y: ur.y * s.body.radius } };
          }
        }
        vel.x = s.vel.x; vel.y = s.vel.y; // co-move with the body
        break;
      }
      if (crashed || landed) break;
    }

    // commit state
    c.pos = pos;
    c.vel = vel;
    if (landed && landedInfo) sim.landed = landedInfo;

    // --- Reentry heating: rho * v_rel^3 while in ANY body's atmosphere ---
    if (typeof sim.heat !== "number") sim.heat = 0;
    if (!crashed && !landed) {
      let eq = 0;
      if (airInfo) {
        const av = airInfo.state.vel;
        const vRel = Math.hypot(vel.x - av.x, vel.y - av.y);
        eq = HEAT_EQ_K * airInfo.rho * vRel * vRel * vRel;
      }
      sim.heat = Math.max(0, Math.min(1, sim.heat + ((eq - sim.heat) / HEAT_TAU) * dt));
      if (sim.heat >= 1) {
        crashed = true;
        sim.burnedUp = true; // tells the UI this was a fireball, not a ground impact
      }
    } else if (landed) {
      // On the ground: relax to cold.
      sim.heat = Math.max(0, sim.heat - (sim.heat / HEAT_TAU) * dt);
    }

    // burn fuel + reduce mass (only if we actually integrated a thrusting step)
    if (burnKg > 0) {
      const frac = sim.warpLimited ? (tNow - (sim.time || 0)) / dt : 1; // only what we flew
      c.fuelRemaining = Math.max(0, fuel - (burnKg * frac) / 1000);
      c.mass = Math.max(0, (c.mass || 0) - (burnKg * frac) / 1000);
    }

    // advance sim clock to the END of what we actually integrated.
    sim.time = tNow;

    // If we just touched down, peg the craft to the (moving) surface at the final clock.
    if (landed && landedInfo) {
      const bs = bodyStateAt(landedInfo.body, sim.time);
      c.pos = { x: bs.pos.x + landedInfo.offset.x, y: bs.pos.y + landedInfo.offset.y };
      c.vel = { x: bs.vel.x, y: bs.vel.y };
    }

    // convenience readouts (altitude/speed relative to whichever body owns you now)
    this._refreshReadouts(sim);

    // status
    if (crashed) {
      sim.status = "crashed";
    } else if (landed) {
      sim.status = "landed";
    }

    // refresh orbit (best-effort)
    const orbit = this.computeOrbit(sim);
    if (orbit) {
      sim.orbit = orbit;
      // promote status to "orbit" if we're in a stable orbit and not on the ground
      if (!crashed && !landed && orbit.isOrbit && sim.altitude > 0) {
        if (sim.status === "flying" || sim.status === "prelaunch") sim.status = "orbit";
      }
    }

    return sim;
  },

  // Refresh convenience readouts: altitude above and speed relative to the body that
  // currently owns the craft, the SOI label, and distance to the current target.
  _refreshReadouts(sim) {
    const c = sim.craft;
    const t = sim.time || 0;
    const dom = dominantBody(c.pos, t);
    sim.altitude = mag(dom.rel) - dom.body.radius;
    // Speed RELATIVE to the body that owns you — parked on the Moon must read 0, not the
    // Moon's own orbital speed (the readout confused the first Moon landing otherwise).
    sim.speed = Math.hypot(c.vel.x - dom.vel.x, c.vel.y - dom.vel.y);
    sim.soi = dom.body.name;
    const m = bodyStateAt("moon", t);
    sim.distMoon = Math.hypot(c.pos.x - m.pos.x, c.pos.y - m.pos.y);
    if (sim.target && BODIES[sim.target]) {
      const ts = bodyStateAt(sim.target, t);
      sim.distTarget = Math.hypot(c.pos.x - ts.pos.x, c.pos.y - ts.pos.y);
    } else sim.distTarget = null;
  },

  // Compute orbital elements about the DOMINANT body (deepest SOI: Moon > Earth > Sun...).
  // apo/peri are ALTITUDES above that body's surface (m). Also returns the body's name,
  // its center in world coords, and its radius so render can draw the ellipse there.
  computeOrbit(sim) {
    if (!sim || !sim.craft) return null;
    const dom = dominantBody(sim.craft.pos, sim.time || 0);
    const body = dom.body;
    const mu = body.mu;
    // Position & velocity RELATIVE to the dominant body (everything is moving).
    const center = dom.center || { x: 0, y: 0 };
    const pos = { x: dom.rel.x, y: dom.rel.y };
    const vel = { x: sim.craft.vel.x - dom.vel.x, y: sim.craft.vel.y - dom.vel.y };

    const r = mag(pos);
    const v = mag(vel);
    if (!(r > 0) || !isFinite(r) || !isFinite(v)) return null;

    // specific orbital energy: eps = v^2/2 - mu/r
    const eps = (v * v) / 2 - mu / r;

    // specific angular momentum (z-component in 2D): h = x*vy - y*vx
    const hz = pos.x * vel.y - pos.y * vel.x;
    const h2 = hz * hz;

    let semiMajor, eccentricity, apoRadius, periRadius;

    if (Math.abs(eps) < 1e-9) {
      // ~parabolic; treat as escape
      semiMajor = Infinity;
      eccentricity = 1;
      periRadius = h2 / (2 * mu); // parabola periapsis = p/2 = h^2/(2*mu)
      apoRadius = Infinity;
    } else {
      semiMajor = -mu / (2 * eps);
      const eArg = 1 + (2 * eps * h2) / (mu * mu);
      eccentricity = Math.sqrt(Math.max(0, eArg));
      if (eps < 0) {
        periRadius = semiMajor * (1 - eccentricity);
        apoRadius = semiMajor * (1 + eccentricity);
      } else {
        periRadius = semiMajor * (1 - eccentricity); // still valid (a<0, e>1)
        apoRadius = Infinity;
      }
    }

    // Eccentricity vector (points from focus toward periapsis) — the ellipse's true
    // orientation so render can draw it (and the Ap/Pe markers) in the right place.
    const rv = pos.x * vel.x + pos.y * vel.y;
    const exv = ((v * v - mu / r) * pos.x - rv * vel.x) / mu;
    const eyv = ((v * v - mu / r) * pos.y - rv * vel.y) / mu;
    const periAngle = Math.atan2(eyv, exv); // angle of periapsis direction about the body

    const atmoTop = body.atmosphere ? body.atmosphere.height : 0;
    const apoapsis = (apoRadius === Infinity) ? Infinity : apoRadius - body.radius;
    const periapsis = periRadius - body.radius;

    // A REAL captured orbit must fit inside the body's sphere of influence — otherwise
    // it's a flyby the parent will reclaim. (The Sun has no SOI bound.)
    let fitsSOI = true;
    if (body.soiRadius) fitsSOI = isFinite(apoRadius) && apoRadius < body.soiRadius;

    const isOrbit = isFinite(periapsis) && periapsis > atmoTop && eps < 0 && fitsSOI;

    return {
      apoapsis, periapsis, eccentricity, semiMajor, isOrbit, periAngle,
      bodyName: body.name, bodyKey: body.key, bodyRadius: body.radius, center,
    };
  },

  // --- Transfer window (the "when do I burn?" question, for ANY destination) ---
  // Hohmann phasing from a (near-)circular orbit around a CENTRAL body out (or in) to a
  // TARGET body circling that same central body:
  //   Moon trip:   central = Earth, target = Moon  (the classic Apollo TLI)
  //   Mars trip:   central = Sun,   target = Mars  (escape Earth first, then this)
  //   Coming home: central = Sun,   target = Earth
  // Transfer time = half-period of the ellipse touching the target's orbit radius:
  // t = PI*sqrt(aT^3/mu), aT = (r_now + r_target)/2. You burn when the target leads you
  // by (PI - omega_target * t) so you both arrive at the same spot together.
  //
  // Pure function (node-testable). Returns null when the guidance doesn't apply: not in a
  // stable orbit, the target doesn't circle your current dominant body, retrograde orbit,
  // or you're already most of the way out. Otherwise:
  //   { open, degToGo, timeToWindow_s, transferTime_s, leadAngle_deg, burnPos:{x,y},
  //     dir: "prograde"|"retrograde",   // outward trips burn prograde, inward retrograde
  //     targetKey, centralKey }
  transferWindow(sim, targetKey) {
    if (!sim || !sim.craft) return null;
    const target = BODIES[targetKey || sim.target || "moon"];
    if (!target || !target.parent) return null;
    const orbit = this.computeOrbit(sim);
    if (!orbit || !orbit.isOrbit) return null;
    if (orbit.bodyKey !== target.parent) return null; // must orbit the target's parent
    if (!isFinite(orbit.apoapsis) || !isFinite(orbit.semiMajor) || orbit.semiMajor <= 0) return null;

    const central = BODIES[target.parent];
    const t = sim.time || 0;
    const cState = bodyStateAt(central.key, t);
    const pos = { x: sim.craft.pos.x - cState.pos.x, y: sim.craft.pos.y - cState.pos.y };
    const vel = { x: sim.craft.vel.x - cState.vel.x, y: sim.craft.vel.y - cState.vel.y };

    const r = mag(pos);
    if (!(r > 0)) return null;
    const outward = target.orbitRadius > r;

    // Only guide while the orbit hasn't already stretched most of the way there — once the
    // burn is underway the job is "keep burning", not "wait for a window". "Most of the way"
    // is measured from the CURRENT radius toward the target's (an Earth-radius Sun orbit is
    // already 66% of Mars's radius before you've burned at all).
    const apoRadius = central.radius + orbit.apoapsis;
    const periRadius = central.radius + orbit.periapsis;
    if (outward && apoRadius >= r + 0.7 * (target.orbitRadius - r)) return null;
    if (!outward && periRadius <= r - 0.7 * (r - target.orbitRadius)) return null;

    // Direction of travel: hz > 0 = CCW, the way every body goes. A retrograde orbit
    // can't do this transfer — no guidance rather than bad guidance.
    const hz = pos.x * vel.y - pos.y * vel.x;
    if (hz <= 0) return null;

    // Hohmann half-ellipse from the CURRENT radius to the target's orbit radius.
    const aT = (r + target.orbitRadius) / 2;
    const tTransfer = Math.PI * Math.sqrt((aT * aT * aT) / central.mu);

    // Required lead: target ahead of the ship by (PI - omega_t * t) at the burn moment.
    const lead = wrapPi(Math.PI - target.omega * tTransfer);

    // Current phase: how far the target leads the ship right now (CCW).
    const thetaShip = Math.atan2(pos.y, pos.x);
    const tState = bodyStateAt(target.key, t);
    const thetaTarget = Math.atan2(tState.pos.y - cState.pos.y, tState.pos.x - cState.pos.x);
    const phase = wrap2pi(thetaTarget - thetaShip);

    // Phase closes at (n_ship - omega_target): positive when we circle faster (outward
    // trips), negative when the target laps us (inward trips). Either way it must move.
    const n = Math.sqrt(central.mu / (orbit.semiMajor ** 3)); // mean motion of the ship
    const closing = n - target.omega;
    if (Math.abs(closing) < 1e-12) return null;

    const toGo = closing > 0 ? wrap2pi(phase - wrap2pi(lead)) : wrap2pi(wrap2pi(lead) - phase);
    const timeToWindow = toGo / Math.abs(closing);
    const degToGo = ((n * timeToWindow) % (2 * Math.PI)) * 180 / Math.PI; // arc of YOUR orbit

    // Where on the CURRENT orbit will the ship be at the window? Advance the ship's angle
    // by n * timeToWindow (near-circular approximation — guidance, not gospel), then read
    // the radius off the true conic r(θ) = p / (1 + e cos(θ - periAngle)).
    const thetaBurn = thetaShip + n * timeToWindow;
    const ecc = orbit.eccentricity || 0;
    const p = orbit.semiMajor * (1 - ecc * ecc);
    const denom = 1 + ecc * Math.cos(thetaBurn - (orbit.periAngle || 0));
    const rBurn = denom > 1e-6 ? p / denom : r;
    const burnPos = {
      x: cState.pos.x + rBurn * Math.cos(thetaBurn),
      y: cState.pos.y + rBurn * Math.sin(thetaBurn),
    };

    // "Open" = within ~15 deg either side of the burn point.
    const open = degToGo <= 15 || degToGo >= 345;

    return {
      open,
      degToGo,
      timeToWindow_s: timeToWindow,
      transferTime_s: tTransfer,
      leadAngle_deg: (lead * 180) / Math.PI,
      burnPos,
      dir: outward ? "prograde" : "retrograde",
      targetKey: target.key,
      centralKey: central.key,
    };
  },

  // --- Mid-course correction (the Apollo 13 move) ---
  // Once the transfer burn is done, the window guidance goes quiet — but a kid's burn is
  // never perfect, and at interplanetary scale a 2° timing slip misses Mars by 40 SOI
  // radii. This predicts the CLOSEST APPROACH to the target over the coming cruise by
  // Kepler-propagating the craft's current conic (two-body about the dominant central —
  // pure math, no integration), and numerically finds whether a small prograde or
  // retrograde nudge shrinks the miss.
  //
  // Returns null when it doesn't apply (wrong SOI, retrograde, hyperbolic, or the orbit
  // never gets near the target). Otherwise:
  //   { miss,            // predicted closest approach to the target's CENTER (m)
  //     tClosest_s,      // sim-seconds from now until that closest approach
  //     onTarget,        // miss < target SOI: you'll be captured-able, stop correcting
  //     dir,             // "prograde"|"retrograde": which small burn shrinks the miss
  //     perDv,           // m of miss removed per m/s of burn in that direction (rough)
  //     targetKey }
  courseCorrection(sim, targetKey) {
    if (!sim || !sim.craft) return null;
    const target = BODIES[targetKey || sim.target || "moon"];
    if (!target || !target.parent) return null;
    const central = BODIES[target.parent];
    const t = sim.time || 0;
    const dom = dominantBody(sim.craft.pos, t);
    if (dom.body.key !== central.key) return null;

    const cState = bodyStateAt(central.key, t);
    const pos = { x: sim.craft.pos.x - cState.pos.x, y: sim.craft.pos.y - cState.pos.y };
    const vel = { x: sim.craft.vel.x - cState.vel.x, y: sim.craft.vel.y - cState.vel.y };

    const base = predictClosest(pos, vel, central, target, t);
    if (!base) return null;
    // Only meaningful when the orbit actually attempts the trip.
    if (base.miss > 0.35 * target.orbitRadius) return null;

    const soi = target.soiRadius || 0;
    if (base.miss < soi) {
      return { miss: base.miss, tClosest_s: base.tMin, onTarget: true, burnVec: null, dirLabel: null, perDv: 0, targetKey: target.key };
    }

    // Which way does a nudge help? A purely prograde/retrograde fix can't always close a
    // late transfer — probe 8 compass directions (in the velocity frame) and keep the one
    // that shrinks the predicted miss the most. The kid just points at the gold arrow.
    const vm = Math.hypot(vel.x, vel.y) || 1;
    const uv = { x: vel.x / vm, y: vel.y / vm };   // prograde
    const un = { x: -uv.y, y: uv.x };              // 90° left of travel
    const DV = 5; // m/s probe
    let best = null;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const dx = Math.cos(a) * uv.x + Math.sin(a) * un.x;
      const dy = Math.cos(a) * uv.y + Math.sin(a) * un.y;
      const v2 = { x: vel.x + DV * dx, y: vel.y + DV * dy };
      const p = predictClosest(pos, v2, central, target, t);
      if (p && (!best || p.miss < best.miss)) best = { ...p, dx, dy, a };
    }
    if (!best || best.miss >= base.miss) {
      return { miss: base.miss, tClosest_s: base.tMin, onTarget: false, burnVec: null, dirLabel: null, perDv: 0, targetKey: target.key };
    }
    // Human-readable flavor for the Navigator ("mostly prograde", "pull inward", ...).
    const labels = ["prograde", "prograde-out", "radial-out", "retrograde-out",
                    "retrograde", "retrograde-in", "radial-in", "prograde-in"];
    return {
      miss: base.miss,
      tClosest_s: base.tMin,
      onTarget: false,
      burnVec: { x: best.dx, y: best.dy }, // world-frame unit vector: burn THIS way
      dirLabel: labels[Math.round(best.a / (Math.PI / 4)) % 8],
      perDv: (base.miss - best.miss) / DV,
      targetKey: target.key,
    };
  },

  // Staging: drop the spent lowest stage's parts, recompute thrust/fuel/mass for the
  // new current stage, and advance sim.craft.currentStage. (Unchanged from Phase 1.)
  applyStage(sim, craft) {
    if (!sim || !sim.craft) return sim;
    const live = sim.craft;
    const leaving = live.currentStage || 0;

    const catalog = (craft && craft._catalog) || null;
    if (!craft || !Array.isArray(craft.parts) || !catalog) {
      live.currentStage = leaving + 1;
      return sim;
    }

    const findDef = (id) => catalog.find((p) => p.id === id);

    const dropped = [];
    const remaining = [];
    for (const inst of craft.parts) {
      if ((inst.stage || 0) === leaving) dropped.push(inst);
      else remaining.push(inst);
    }

    let dryMass = 0, fuelMass = 0, thrust = 0, veSum = 0, engineCount = 0;
    let newStage = Infinity;
    for (const inst of remaining) newStage = Math.min(newStage, inst.stage || 0);
    if (!isFinite(newStage)) newStage = leaving + 1;

    for (const inst of remaining) {
      const def = findDef(inst.partId);
      if (!def) continue;
      dryMass += def.dryMass || 0;
      fuelMass += def.fuelMass || 0;
      if (def.type === "engine" && (inst.stage || 0) === newStage) {
        thrust += def.thrust || 0;
        veSum += def.exhaustVelocity || 0;
        engineCount++;
      }
    }

    const ve = engineCount ? veSum / engineCount : 0;

    craft.parts = remaining;
    live.mass = dryMass + fuelMass;
    live.fuelRemaining = fuelMass;
    live.thrust = thrust;             // kN
    live.exhaustVelocity = ve;        // m/s
    live.currentStage = newStage;

    return sim;
  },

  // Parking orbit for the ✨ Teleport shortcut: a circular CCW orbit just above `key`,
  // entered on the SUNLIT side so the world greets you lit up, not as a black disc.
  // Pure — main.js applies it to the live sim; tests fly it. Not for the Sun itself.
  parkingOrbit(key, t = 0) {
    const b = BODIES[key];
    if (!b || !b.parent) return null;
    const bs = bodyStateAt(key, t);
    const th = Math.atan2(bs.pos.y, bs.pos.x) + Math.PI; // toward the Sun: sunlit side
    // Tiny moons (Phobos, Deimos) can't be orbited — their gravity is too weak to hold
    // you against Mars's pull (true SOI < their radius). Real probes fly ALONGSIDE in a
    // matching Mars orbit, so that's what the teleporter gives: parked a few radii off,
    // co-moving with the moon. Nudge over gently and land.
    if (b.tinyMoon) {
      const off = b.radius * 5;
      return {
        pos: { x: bs.pos.x + off * Math.cos(th), y: bs.pos.y + off * Math.sin(th) },
        vel: { x: bs.vel.x, y: bs.vel.y }, // fly formation with the moon
        angle: th + Math.PI / 2, // heading (-sin a, cos a) = -(cos th, sin th): nose AT the moon
        radius: off, altitude: off - b.radius, speed: 0, coOrbit: true,
      };
    }
    // Clear of the ground AND well above any atmosphere (3x its height — no stray drag).
    const r = Math.max(b.radius * 1.35, b.radius + 3 * ((b.atmosphere && b.atmosphere.height) || 0));
    const v = Math.sqrt(b.mu / r);
    return {
      pos: { x: bs.pos.x + r * Math.cos(th), y: bs.pos.y + r * Math.sin(th) },
      vel: { x: bs.vel.x - v * Math.sin(th), y: bs.vel.y + v * Math.cos(th) }, // CCW
      angle: th, // heading convention (-sin a, cos a): nose starts prograde
      radius: r, altitude: r - b.radius, speed: v,
    };
  },

  // --- Satellites (Phase 5): a jettisoned probe-core stage left in a stable orbit ---
  // becomes a tracked satellite. We freeze its two-body conic about the body it orbits
  // at the moment of release; satellitePos Kepler-propagates it for display. Both pure.
  makeSatellite(sim) {
    if (!sim || !sim.craft || !sim.orbit || !sim.orbit.isOrbit) return null;
    const t = sim.time || 0;
    const dom = dominantBody(sim.craft.pos, t);
    const el = keplerElements(
      { x: dom.rel.x, y: dom.rel.y },
      { x: sim.craft.vel.x - dom.vel.x, y: sim.craft.vel.y - dom.vel.y },
      dom.body.mu
    );
    if (!el) return null; // hyperbolic/retrograde: not a keepable orbit
    return { bodyKey: dom.body.key, epoch: t,
             a: el.a, e: el.e, periAngle: el.periAngle, M0: el.M0, n: el.n };
  },
  satellitePos(sat, t) {
    const bs = bodyStateAt(sat.bodyKey, t);
    const p = keplerPosAt({ a: sat.a, e: sat.e, periAngle: sat.periAngle, M0: sat.M0, n: sat.n },
                          t - sat.epoch);
    return { x: bs.pos.x + p.x, y: bs.pos.y + p.y };
  },

  // Deterministic sanity check: a craft placed in a known CIRCULAR Earth orbit with
  // throttle 0 should stay at ~constant altitude over a revolution (solar tide is tiny).
  _selfTest() {
    const body = BODIES.earth;
    const mu = body.mu;
    const alt = body.atmosphere.height + 100000;
    const r = body.radius + alt;
    const vCirc = Math.sqrt(mu / r);

    const e0 = bodyStateAt("earth", 0);
    const sim = {
      body,
      craft: {
        pos: { x: e0.pos.x + r, y: e0.pos.y },
        vel: { x: e0.vel.x, y: e0.vel.y + vCirc },
        angle: 0, throttle: 0, fuelRemaining: 0, mass: 5, currentStage: 0,
      },
      altitude: alt, speed: vCirc, time: 0, status: "orbit", orbit: null,
    };

    const period = 2 * Math.PI * Math.sqrt((r * r * r) / mu);
    const dt = 0.05;
    let minAlt = Infinity, maxAlt = -Infinity;
    const n = Math.round(period / dt);
    for (let i = 0; i < n; i++) {
      Physics.step(sim, dt);
      if (sim.altitude < minAlt) minAlt = sim.altitude;
      if (sim.altitude > maxAlt) maxAlt = sim.altitude;
    }

    const orbit = Physics.computeOrbit(sim);
    const altDriftPct = (Math.abs(maxAlt - minAlt) / alt) * 100;
    const pass = orbit && orbit.eccentricity < 0.02 && orbit.isOrbit === true && altDriftPct < 1.5;
    console.log(`[physics self-test] ${pass ? "PASS" : "FAIL"} drift=${altDriftPct.toFixed(3)}% ecc=${orbit && orbit.eccentricity.toFixed(4)} isOrbit=${orbit && orbit.isOrbit}`);
    return pass;
  },
};

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function wrap2pi(a) { const t = a % (2 * Math.PI); return t < 0 ? t + 2 * Math.PI : t; }
function wrapPi(a) { const t = wrap2pi(a); return t > Math.PI ? t - 2 * Math.PI : t; }

// --- Kepler two-body propagation (elliptic, CCW) for the course-correction predictor ---
// From state (pos, vel) relative to a body with parameter mu, give the position `dt`
// seconds later on the SAME conic. Pure math: elements -> Kepler's equation -> position.
function keplerElements(pos, vel, mu) {
  const r = Math.hypot(pos.x, pos.y);
  const v2 = vel.x * vel.x + vel.y * vel.y;
  const eps = v2 / 2 - mu / r;
  if (eps >= 0) return null;                    // parabolic/hyperbolic: not handled here
  const hz = pos.x * vel.y - pos.y * vel.x;
  if (hz <= 0) return null;                     // retrograde: guidance stays quiet
  const a = -mu / (2 * eps);
  const rv = pos.x * vel.x + pos.y * vel.y;
  const ex = ((v2 - mu / r) * pos.x - rv * vel.x) / mu;
  const ey = ((v2 - mu / r) * pos.y - rv * vel.y) / mu;
  const e = Math.hypot(ex, ey);
  if (e >= 0.995) return null;
  const periAngle = Math.atan2(ey, ex);
  // True anomaly now, then eccentric anomaly, then mean anomaly.
  const theta0 = wrap2pi(Math.atan2(pos.y, pos.x) - periAngle);
  const E0 = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(theta0), e + Math.cos(theta0));
  const M0 = E0 - e * Math.sin(E0);
  const n = Math.sqrt(mu / (a * a * a));
  return { a, e, periAngle, M0, n };
}
function keplerPosAt(el, dt) {
  const M = el.M0 + el.n * dt;
  // Newton's method on Kepler's equation M = E - e sinE (converges in a few steps).
  let E = M;
  for (let i = 0; i < 8; i++) {
    const f = E - el.e * Math.sin(E) - M;
    E -= f / (1 - el.e * Math.cos(E));
  }
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const rr = el.a * (1 - el.e * cosE);
  const theta = Math.atan2(Math.sqrt(1 - el.e * el.e) * sinE, cosE - el.e);
  const ang = el.periAngle + theta;
  return { x: rr * Math.cos(ang), y: rr * Math.sin(ang) };
}

// Closest approach of the craft's conic (rel to `central`) to `target`'s circle over the
// coming cruise. Coarse scan + local refinement. Returns { miss, tMin } or null.
function predictClosest(pos, vel, central, target, tNow) {
  const el = keplerElements(pos, vel, central.mu);
  if (!el) return null;
  const period = (2 * Math.PI) / el.n;
  // Enough horizon to cover an outbound half-ellipse (or a whole lap, whichever is less).
  const rNow = Math.hypot(pos.x, pos.y);
  const aT = (rNow + target.orbitRadius) / 2;
  const horizon = Math.min(period, 1.4 * Math.PI * Math.sqrt((aT * aT * aT) / central.mu));
  const cAt = (dt) => bodyStateAt(central.key, tNow + dt).pos;
  const tAt = (dt) => bodyStateAt(target.key, tNow + dt).pos;
  const missAt = (dt) => {
    const p = keplerPosAt(el, dt);
    const c = cAt(dt), g = tAt(dt);
    return Math.hypot(c.x + p.x - g.x, c.y + p.y - g.y);
  };
  const N = 240;
  let minD = Infinity, tMin = 0;
  for (let i = 1; i <= N; i++) {
    const dt = (i / N) * horizon;
    const d = missAt(dt);
    if (d < minD) { minD = d; tMin = dt; }
  }
  // Refine around the best sample (golden-section-ish trisection).
  let lo = Math.max(0, tMin - horizon / N), hi = Math.min(horizon, tMin + horizon / N);
  for (let i = 0; i < 24; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (missAt(m1) < missAt(m2)) hi = m2; else lo = m1;
  }
  const tBest = (lo + hi) / 2;
  return { miss: missAt(tBest), tMin: tBest };
}
