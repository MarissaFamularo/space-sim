// physics.js — planar 2D orbital integrator for the space sim.
// API frozen in ../ARCHITECTURE.md. PURE module: no DOM, no Three.js.
//
// Conventions (see ARCHITECTURE.md):
//   - World origin = center of the body. Positions/velocities in meters & m/s.
//   - Mass in tonnes (t), thrust in kN, exhaust velocity in m/s, time in seconds.
//   - Angle in radians, 0 = pointing along +Y (rocket "up"), increasing CCW.
//     => thrust/heading unit vector = (-sin angle, cos angle).
//   - mu = G*M lives on body.mu (SI: m^3/s^2). Gravity accel = mu / r^2 toward origin.
//
// INTEGRATOR NOTE — thrust/fuel inputs the integrator (main.js) must set at launch:
//   sim.craft does NOT carry the full part list. step() reads the active stage's
//   propulsion from two OPTIONAL live fields on sim.craft:
//       sim.craft.thrust            — active total thrust in kN (already throttle-able)
//       sim.craft.exhaustVelocity   — effective exhaust velocity in m/s (Isp*g0)
//   If either is missing/zero, step() runs gravity-only (coast). This keeps the frozen
//   step(sim, dt) signature intact. main.js should set craft.thrust (kN) and
//   craft.exhaustVelocity (m/s) when launching, and update them on staging via applyStage().
//   Fuel is tracked as sim.craft.fuelRemaining (t); when it hits 0, thrust is forced to 0.

import { BODIES, moonStateAt, dominantBody } from "./state.js";

// --- small vector helpers (plain {x,y}) ---
function mag(v) { return Math.hypot(v.x, v.y); }

const LAND_SPEED = 5; // m/s descent-rate threshold for a soft landing (vs the surface)

// --- Reentry heating (Phase 2) ---
// Hull heat (sim.heat, 0..1; 1 = burned up) RELAXES toward an equilibrium set by the
// instantaneous heat flux rho * v^3 (Sutton-Graves style): heat' = (eq - heat) / tau.
// Why relaxation instead of accumulating the integral: a shallow skim and a steep dive
// dissipate the SAME total energy (measured: ~1e9 both), but the steep dive's PEAK flux is
// ~20x higher — peak, not total, is what melts ships. Tuned on the forgiving Earth
// (orbital speed ~2500 m/s): a prograde deorbit glows ~0.5 and survives; slamming straight
// down at Moon-return speed spikes equilibrium ~10 and burns up in under a second.
const HEAT_EQ_K = 3.8e-9; // equilibrium heat per (kg/m^3 * (m/s)^3)
const HEAT_TAU = 4;       // seconds to relax toward equilibrium (up and down)

// --- Parachute ---
// A deployed chute adds a huge drag area — but ONLY where there's air (Earth yes, Moon no:
// that contrast is the lesson). It won't open above CHUTE_MAX_SPEED (the airflow would just
// shred it); once the craft slows below that, it blossoms. CdA sized so a ~1.5 t capsule
// falls at ~4.5 m/s terminal — under the 5 m/s soft-landing threshold.
const CHUTE_CDA = 1200;      // m^2 effective drag area per parachute
const CHUTE_MAX_SPEED = 250; // m/s — too fast and the chute streams uselessly

// Heading unit vector for a given angle (0 = +Y, CCW positive).
function headingVec(angle) {
  return { x: -Math.sin(angle), y: Math.cos(angle) };
}

// Gravitational acceleration vector at position `pos` for gravitational parameter mu.
// Points toward the origin (center of body). Returns {x,y} in m/s^2.
function gravAccel(pos, mu) {
  const r = mag(pos);
  if (r <= 0) return { x: 0, y: 0 };
  const a = -mu / (r * r * r); // (-mu/r^2) * (pos/r)  ==  -mu/r^3 * pos
  return { x: a * pos.x, y: a * pos.y };
}

// Atmospheric density via simple exponential model. 0 at/above atmosphere top.
// Scale height ~ height/5 keeps density a few % of sea level at the top.
function airDensity(altitude, atmosphere) {
  if (!atmosphere || altitude >= atmosphere.height || altitude < 0) {
    if (!atmosphere || altitude >= atmosphere.height) return 0;
  }
  const H = atmosphere.height / 5;
  return atmosphere.seaLevelDensity * Math.exp(-Math.max(0, altitude) / H);
}

// Superposed gravity (m/s^2) from BOTH Earth (at origin) and the Moon (at its orbital
// position at time t). This is a real restricted-three-body field — both worlds pull at
// once, no patched-conic hand-off. `t` is sim seconds so the Moon is where it actually is.
function gravityAt(pos, t) {
  const acc = gravAccel(pos, BODIES.earth.mu); // Earth at the origin
  const m = moonStateAt(t);
  const rel = { x: pos.x - m.pos.x, y: pos.y - m.pos.y };
  const am = gravAccel(rel, BODIES.moon.mu);   // Moon at m.pos (accel points toward the Moon)
  acc.x += am.x; acc.y += am.y;
  return acc;
}

// Total acceleration (m/s^2) from gravity + thrust + drag at a given state.
// thrustN is current thrust in NEWTONS (0 if no fuel / no engine), massKg in kg.
// `body` is the atmosphere/drag reference (Earth); `t` places the Moon for gravity.
// `chuteCdA` is extra drag area from an OPEN parachute (0 when stowed/closed/no air).
// `hStep` (s) caps the drag impulse per substep: drag may slow the craft but never reverse
// it within a step — without this, a big open chute makes Euler integration oscillate.
function totalAccel(pos, vel, massKg, thrustN, angle, body, t, chuteCdA = 0, hStep = 0) {
  const acc = gravityAt(pos, t);

  // Thrust along heading.
  if (thrustN > 0 && massKg > 0) {
    const h = headingVec(angle);
    const at = thrustN / massKg;
    acc.x += h.x * at;
    acc.y += h.y * at;
  }

  // Simple exponential atmospheric drag below atmosphere top.
  if (body.atmosphere && massKg > 0) {
    const altitude = mag(pos) - body.radius;
    const rho = airDensity(altitude, body.atmosphere);
    if (rho > 0) {
      const speed = mag(vel);
      if (speed > 0) {
        // F_drag = 0.5 * rho * v^2 * Cd * A, opposing velocity.
        // Lumped Cd*A constant; tuned small so forgiving atmosphere isn't punishing.
        const CdA = 2.0 + chuteCdA; // m^2 (hull drag + open parachute, if any)
        const dragMag = 0.5 * rho * speed * speed * CdA; // Newtons
        let ad = dragMag / massKg;
        if (hStep > 0) ad = Math.min(ad, (0.9 * speed) / hStep); // can't reverse motion in one step
        acc.x -= (vel.x / speed) * ad;
        acc.y -= (vel.y / speed) * ad;
      }
    }
  }

  return acc;
}

export const Physics = {
  // Advance sim.craft one timestep dt (seconds) under gravity + thrust + drag.
  step(sim, dt) {
    if (!sim || !sim.craft || !(dt > 0)) return sim;
    const c = sim.craft;
    const body = sim.body || BODIES.earth;   // frame/atmosphere reference = Earth
    const moon = BODIES.moon;

    // --- Landed: stay glued to the surface. On the Moon that means co-moving with it as it
    // orbits Earth (otherwise the ship would be left behind in inertial space). Throttling up
    // with fuel lifts back off — that's how you fly home from the Moon. ---
    if (sim.status === "landed" && sim.landed) {
      const wantsLiftoff = c.throttle > 0 && c.thrust > 0 &&
        (c.fuelRemaining || 0) > 0 && (c.exhaustVelocity || 0) > 0;
      if (!wantsLiftoff) {
        const t2 = (sim.time || 0) + dt;
        if (sim.landed.body === "moon") {
          const mN = moonStateAt(t2);
          c.pos = { x: mN.pos.x + sim.landed.offset.x, y: mN.pos.y + sim.landed.offset.y };
          c.vel = { x: mN.vel.x, y: mN.vel.y };
        }
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
        // Not enough fuel to thrust for the whole step: scale thrust to what fuel allows.
        // Use the fraction of dt fuel supports; simplest stable approach is to burn all
        // remaining fuel and proportionally reduce impulse.
        const frac = fuelKg > 0 ? fuelKg / burnKg : 0;
        thrustN *= frac;
        burnKg = fuelKg;
      }
    }

    // --- integrate (semi-implicit / symplectic Euler with optional sub-stepping) ---
    // dt is small (~0.016s) but may be sub-stepped by the caller. We also internally
    // sub-step if dt is large (time warp) to keep the orbit stable.
    const maxSub = 0.05; // s, internal substep ceiling
    let steps = Math.max(1, Math.ceil(dt / maxSub));
    const h = dt / steps;

    let pos = { x: c.pos.x, y: c.pos.y };
    let vel = { x: c.vel.x, y: c.vel.y };
    const angle = c.angle || 0;
    let tNow = sim.time || 0; // advances each substep so the Moon is current under time-warp

    let crashed = false, landed = false, landedInfo = null;
    for (let i = 0; i < steps; i++) {
      // Parachute: open only if deployed AND in air AND slow enough to blossom.
      // Recomputed per substep — sim.chuteOpen carries the last state for render/UI.
      let chuteCdA = 0;
      sim.chuteOpen = false;
      if (c.chuteDeployed && (c.chuteCount || 0) > 0 && body.atmosphere) {
        const altC = mag(pos) - body.radius;
        const rhoC = airDensity(altC, body.atmosphere);
        if (rhoC > 0.001 && mag(vel) < CHUTE_MAX_SPEED) {
          chuteCdA = CHUTE_CDA * c.chuteCount;
          sim.chuteOpen = true;
        }
      }
      const acc = totalAccel(pos, vel, massKg, thrustN, angle, body, tNow, chuteCdA, h);
      // semi-implicit Euler: update velocity first, then position.
      vel.x += acc.x * h;
      vel.y += acc.y * h;
      pos.x += vel.x * h;
      pos.y += vel.y * h;
      tNow += h;

      // --- Moon surface collision (checked first; the Moon is a moving target) ---
      const mN = moonStateAt(tNow);
      const relM = { x: pos.x - mN.pos.x, y: pos.y - mN.pos.y };
      const rM = mag(relM);
      if (rM <= moon.radius) {
        const ur = rM > 0 ? { x: relM.x / rM, y: relM.y / rM } : { x: 0, y: 1 };
        // Velocity RELATIVE to the moving Moon decides soft-land vs crash.
        const vrel = { x: vel.x - mN.vel.x, y: vel.y - mN.vel.y };
        const vRadial = vrel.x * ur.x + vrel.y * ur.y; // negative = descending toward surface
        // Only "contact" when moving INTO the surface. If we're climbing out (just lifted off),
        // let the craft keep ascending instead of spuriously re-landing the same frame.
        if (vRadial <= 0) {
          pos.x = mN.pos.x + ur.x * moon.radius;
          pos.y = mN.pos.y + ur.y * moon.radius;
          const descentSpeed = Math.abs(vRadial);
          if (descentSpeed > LAND_SPEED || mag(vrel) > 12) crashed = true;
          else { landed = true; landedInfo = { body: "moon", offset: { x: ur.x * moon.radius, y: ur.y * moon.radius } }; }
          vel.x = mN.vel.x; vel.y = mN.vel.y; // co-move with the Moon
          break;
        }
      }

      // --- Earth surface collision ---
      const r = mag(pos);
      if (r <= body.radius) {
        const ur = r > 0 ? { x: pos.x / r, y: pos.y / r } : { x: 0, y: 1 };
        const vRadial = vel.x * ur.x + vel.y * ur.y; // negative = descending
        // Only contact when descending into the surface (lets a liftoff climb out cleanly).
        if (vRadial <= 0) {
          pos.x = ur.x * body.radius;
          pos.y = ur.y * body.radius;
          const descentSpeed = Math.abs(vRadial);
          // Soft if coming down slowly; horizontal skimming at speed still crashes.
          if (descentSpeed > LAND_SPEED || mag(vel) > 12) crashed = true;
          else { landed = true; landedInfo = { body: "earth", offset: { x: pos.x, y: pos.y } }; }
          vel.x = 0; vel.y = 0;
          break;
        }
      }
    }

    // commit state
    c.pos = pos;
    c.vel = vel;
    if (landed && landedInfo) sim.landed = landedInfo;

    // --- Reentry heating: rho * v^3 while in Earth's atmosphere, cooling otherwise ---
    if (typeof sim.heat !== "number") sim.heat = 0;
    if (!crashed && !landed) {
      const altNow = mag(pos) - body.radius;
      const rho = body.atmosphere ? airDensity(altNow, body.atmosphere) : 0;
      const vNow = mag(vel);
      const eq = HEAT_EQ_K * rho * vNow * vNow * vNow; // equilibrium hull heat for this flux
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
      c.fuelRemaining = Math.max(0, fuel - burnKg / 1000);
      c.mass = Math.max(0, (c.mass || 0) - burnKg / 1000);
    }

    // advance sim clock BEFORE readouts so they reflect end-of-step time (the Moon moved).
    if (typeof sim.time === "number") sim.time += dt;

    // If we just touched down on the (moving) Moon, peg the craft to the surface at the new
    // clock so distance-to-Moon and the orbit readout are exact this very frame.
    if (landed && landedInfo && landedInfo.body === "moon") {
      const mN = moonStateAt(sim.time || 0);
      c.pos = { x: mN.pos.x + landedInfo.offset.x, y: mN.pos.y + landedInfo.offset.y };
      c.vel = { x: mN.vel.x, y: mN.vel.y };
    }

    // convenience readouts (altitude is above whichever body owns you now)
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

  // Refresh convenience readouts: altitude above the body that currently owns the craft,
  // inertial speed, the SOI label, and distance to the Moon's center.
  _refreshReadouts(sim) {
    const c = sim.craft;
    const dom = dominantBody(c.pos, sim.time || 0);
    sim.altitude = mag(dom.rel) - dom.body.radius;
    sim.speed = mag(c.vel);
    sim.soi = dom.body.name;
    const m = moonStateAt(sim.time || 0);
    sim.distMoon = Math.hypot(c.pos.x - m.pos.x, c.pos.y - m.pos.y);
  },

  // Compute orbital elements about the DOMINANT body (Earth, or the Moon inside its SOI).
  // apo/peri are ALTITUDES above that body's surface (m). Also returns the body's name,
  // its center in Earth-centered coords, and its radius so render can draw the ellipse there.
  computeOrbit(sim) {
    if (!sim || !sim.craft) return null;
    const dom = dominantBody(sim.craft.pos, sim.time || 0);
    const body = dom.body;
    const mu = body.mu;
    // Position & velocity RELATIVE to the dominant body (the Moon is moving).
    const m = moonStateAt(sim.time || 0);
    const center = body.name === "Moon" ? { x: m.pos.x, y: m.pos.y } : { x: 0, y: 0 };
    const bodyVel = body.name === "Moon" ? m.vel : { x: 0, y: 0 };
    const pos = { x: sim.craft.pos.x - center.x, y: sim.craft.pos.y - center.y };
    const vel = { x: sim.craft.vel.x - bodyVel.x, y: sim.craft.vel.y - bodyVel.y };

    const r = mag(pos);
    const v = mag(vel);
    if (!(r > 0) || !isFinite(r) || !isFinite(v)) return null;

    // specific orbital energy: eps = v^2/2 - mu/r
    const eps = (v * v) / 2 - mu / r;

    // specific angular momentum (z-component in 2D): h = x*vy - y*vx
    const hz = pos.x * vel.y - pos.y * vel.x;
    const h2 = hz * hz;

    // semi-major axis from energy: a = -mu / (2*eps)
    // eccentricity: e = sqrt(1 + 2*eps*h^2/mu^2)
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
        // bound (elliptical) orbit
        periRadius = semiMajor * (1 - eccentricity);
        apoRadius = semiMajor * (1 + eccentricity);
      } else {
        // hyperbolic / escape: semiMajor negative
        periRadius = semiMajor * (1 - eccentricity); // still valid (a<0, e>1)
        apoRadius = Infinity;
      }
    }

    // Eccentricity vector (points from focus toward periapsis) — gives the ellipse's true
    // orientation so render can draw it (and the Ap/Pe markers) in the right place.
    // e_vec = ((v^2 - mu/r) * r_vec - (r_vec . v_vec) * v_vec) / mu
    const rv = pos.x * vel.x + pos.y * vel.y;
    const exv = ((v * v - mu / r) * pos.x - rv * vel.x) / mu;
    const eyv = ((v * v - mu / r) * pos.y - rv * vel.y) / mu;
    const periAngle = Math.atan2(eyv, exv); // world-frame angle of periapsis direction

    const atmoTop = body.atmosphere ? body.atmosphere.height : 0;
    const apoapsis = (apoRadius === Infinity) ? Infinity : apoRadius - body.radius;
    const periapsis = periRadius - body.radius;

    // For the Moon, a REAL captured orbit must fit inside its sphere of influence — otherwise
    // it's just a flyby that Earth will reclaim. (Earth has no such bound here.)
    let fitsSOI = true;
    if (body.soiRadius) fitsSOI = isFinite(apoRadius) && apoRadius < body.soiRadius;

    // Stable orbit = periapsis clears the atmosphere top (or the surface, for the airless Moon)
    // and (for the Moon) the whole ellipse stays within the SOI.
    const isOrbit = isFinite(periapsis) && periapsis > atmoTop && eps < 0 && fitsSOI;

    return {
      apoapsis, periapsis, eccentricity, semiMajor, isOrbit, periAngle,
      bodyName: body.name, bodyRadius: body.radius, center, // for render: where to draw the ellipse
    };
  },

  // --- Moon transfer window (the "when do I burn?" question, answered) ---
  // From a (near-)circular Earth orbit, the cheapest way out to the Moon is a Hohmann-style
  // half-ellipse: burn prograde once, coast up, arrive at the Moon's distance half an orbit
  // later. Transfer time = half the ellipse's period: t = PI * sqrt(aT^3 / mu), with
  // aT = (r_now + r_moon)/2. While you coast, the Moon sweeps omega*t of arc — so you must
  // fire when the Moon LEADS you by (PI - omega*t) radians, measured in the direction of
  // motion. Then ship and Moon reach the same spot at the same time. This is literally the
  // arithmetic behind Apollo's translunar injection timing.
  //
  // Pure function (node-testable, no Three.js). Returns null whenever the guidance doesn't
  // apply: not in a stable Earth orbit, apoapsis already reaching high, retrograde orbit
  // (opposite the Moon's CCW motion — a transfer would need a plane-reversal we don't
  // coach), or an orbit so high it circles slower than the Moon. Otherwise:
  //   {
  //     open,            // true when the burn moment is NOW (within ~15 deg of the point)
  //     degToGo,         // degrees of YOUR orbit left to travel before the burn point (0..360)
  //     timeToWindow_s,  // seconds until the burn point (near-circular approximation)
  //     transferTime_s,  // coast time from burn to Moon distance
  //     leadAngle_deg,   // how far the Moon must lead the ship at the burn (the Apollo number)
  //     burnPos: {x,y},  // world position ON the current orbit where the burn starts
  //   }
  transferWindow(sim) {
    if (!sim || !sim.craft) return null;
    const orbit = this.computeOrbit(sim);
    if (!orbit || orbit.bodyName !== "Earth" || !orbit.isOrbit) return null;
    if (!isFinite(orbit.apoapsis) || !isFinite(orbit.semiMajor) || orbit.semiMajor <= 0) return null;

    const earth = BODIES.earth;
    const moon = BODIES.moon;
    const pos = sim.craft.pos, vel = sim.craft.vel;

    // Only guide while apoapsis is still WELL below the Moon — once the burn stretches the
    // orbit out, the job is "keep burning prograde", not "wait for a window".
    const apoRadius = earth.radius + orbit.apoapsis;
    if (apoRadius >= 0.6 * moon.orbitRadius) return null;

    // Direction of travel from angular momentum: hz > 0 = CCW, same way the Moon goes.
    // A retrograde (CW) orbit can't do this transfer — no guidance rather than bad guidance.
    const hz = pos.x * vel.y - pos.y * vel.x;
    if (hz <= 0) return null;

    // Hohmann half-ellipse from the CURRENT radius out to the Moon's orbit radius.
    const r = Math.hypot(pos.x, pos.y);
    if (!(r > 0)) return null;
    const aT = (r + moon.orbitRadius) / 2;
    const tTransfer = Math.PI * Math.sqrt((aT * aT * aT) / earth.mu);

    // Required lead: Moon ahead of the ship by (PI - omega*t) at the moment of the burn.
    const lead = Math.PI - moon.omega * tTransfer;

    // Current phase: how far the Moon leads the ship right now (CCW, 0..2PI).
    const thetaShip = Math.atan2(pos.y, pos.x);
    const thetaMoon = moonStateAt(sim.time || 0).angle;
    const phase = wrap2pi(thetaMoon - thetaShip);

    // The ship circles faster than the Moon (it's far lower), so the phase angle SHRINKS
    // toward the lead value at rate (n_ship - omega_moon). degToGo is the arc the ship
    // still has to gain before the geometry is right.
    const n = Math.sqrt(earth.mu / (orbit.semiMajor ** 3)); // mean motion of the ship
    const closing = n - moon.omega;
    if (closing <= 0) return null; // orbiting slower than the Moon: phasing never closes

    const toGo = wrap2pi(phase - lead);       // radians of phase still to close
    const degToGo = (toGo * 180) / Math.PI;
    const timeToWindow = toGo / closing;

    // Where on the CURRENT orbit will the ship be when the window opens? Advance the ship's
    // world angle by n * timeToWindow (near-circular approximation — guidance, not gospel),
    // then read the radius off the true conic r(θ) = p / (1 + e cos(θ - periAngle)).
    const thetaBurn = thetaShip + n * timeToWindow;
    const ecc = orbit.eccentricity || 0;
    const p = orbit.semiMajor * (1 - ecc * ecc);
    const denom = 1 + ecc * Math.cos(thetaBurn - (orbit.periAngle || 0));
    const rBurn = denom > 1e-6 ? p / denom : r;
    const burnPos = { x: rBurn * Math.cos(thetaBurn), y: rBurn * Math.sin(thetaBurn) };

    // "Open" = within ~15 deg either side of the point: close enough that pointing at the
    // gold arrow (now riding prograde) and burning gets you to the Moon.
    const open = degToGo <= 15 || degToGo >= 345;

    return {
      open,
      degToGo,
      timeToWindow_s: timeToWindow,
      transferTime_s: tTransfer,
      leadAngle_deg: (lead * 180) / Math.PI,
      burnPos,
    };
  },

  // Staging: drop the spent lowest stage's parts, recompute thrust/fuel/mass for the
  // new current stage, and advance sim.craft.currentStage.
  //
  // Phase 1 craft is a vertical stack; PartInstance.stage marks which stage a part belongs
  // to (lower number = fires/jettisons first). We treat sim.craft.currentStage as the stage
  // we are LEAVING. After this call, currentStage++ and the live thrust/exhaustVelocity/
  // mass/fuel reflect the new active stage.
  //
  // `craft` is the full Craft document ({ name, parts:[PartInstance] }). We need a part
  // catalog to read masses/thrust; we accept it via craft._catalog if present, else fall
  // back to sim.craft live numbers (no-op recompute). The integration layer (main.js) is
  // expected to pass craft with access to the catalog, or override after calling.
  applyStage(sim, craft) {
    if (!sim || !sim.craft) return sim;
    const live = sim.craft;
    const leaving = live.currentStage || 0;

    // If we don't have a parts list / catalog, just advance the stage counter and let the
    // integrator recompute. This keeps applyStage safe to call in any context.
    const catalog = (craft && craft._catalog) || null;
    if (!craft || !Array.isArray(craft.parts) || !catalog) {
      live.currentStage = leaving + 1;
      return sim;
    }

    const findDef = (id) => catalog.find((p) => p.id === id);

    // Parts in the stage we're dropping are removed. Remaining parts define the new craft.
    const dropped = [];
    const remaining = [];
    for (const inst of craft.parts) {
      if ((inst.stage || 0) === leaving) dropped.push(inst);
      else remaining.push(inst);
    }

    // Recompute mass / fuel / thrust / exhaustVelocity for the remaining stack.
    let dryMass = 0, fuelMass = 0, thrust = 0, veSum = 0, engineCount = 0;
    // The "active" stage now is the lowest remaining stage number.
    let newStage = Infinity;
    for (const inst of remaining) newStage = Math.min(newStage, inst.stage || 0);
    if (!isFinite(newStage)) newStage = leaving + 1;

    for (const inst of remaining) {
      const def = findDef(inst.partId);
      if (!def) continue;
      dryMass += def.dryMass || 0;
      fuelMass += def.fuelMass || 0;
      // Only engines in the now-active stage contribute thrust.
      if (def.type === "engine" && (inst.stage || 0) === newStage) {
        thrust += def.thrust || 0;
        veSum += def.exhaustVelocity || 0;
        engineCount++;
      }
    }

    const ve = engineCount ? veSum / engineCount : 0;

    // mutate craft document (drop spent parts) and live sim state
    craft.parts = remaining;
    live.mass = dryMass + fuelMass;
    live.fuelRemaining = fuelMass;
    live.thrust = thrust;             // kN
    live.exhaustVelocity = ve;        // m/s
    live.currentStage = newStage;

    return sim;
  },

  // Deterministic sanity check: a craft placed in a known CIRCULAR orbit with throttle 0
  // should stay at ~constant altitude, with eccentricity ~0 and isOrbit true.
  _selfTest() {
    const body = BODIES.earth;
    const mu = body.mu;
    const alt = body.atmosphere.height + 100000; // comfortably above the atmosphere
    const r = body.radius + alt;
    const vCirc = Math.sqrt(mu / r); // circular orbital speed

    // place at +X axis, velocity perpendicular (+Y) => CCW circular orbit
    const sim = {
      body,
      craft: {
        pos: { x: r, y: 0 },
        vel: { x: 0, y: vCirc },
        angle: 0, throttle: 0, fuelRemaining: 0, mass: 5, currentStage: 0,
      },
      altitude: alt, speed: vCirc, time: 0, status: "orbit", orbit: null,
    };

    const alt0 = mag(sim.craft.pos) - body.radius;

    // step forward for a chunk of the orbit
    const period = 2 * Math.PI * Math.sqrt((r * r * r) / mu);
    const dt = 0.05;
    const total = period; // one full revolution
    let minAlt = Infinity, maxAlt = -Infinity;
    const n = Math.round(total / dt);
    for (let i = 0; i < n; i++) {
      Physics.step(sim, dt);
      const a = mag(sim.craft.pos) - body.radius;
      if (a < minAlt) minAlt = a;
      if (a > maxAlt) maxAlt = a;
    }

    const orbit = Physics.computeOrbit(sim);
    const altDriftPct = (Math.abs(maxAlt - minAlt) / alt0) * 100;
    const altFinal = mag(sim.craft.pos) - body.radius;

    const eccOk = orbit && orbit.eccentricity < 0.02;
    const orbitOk = orbit && orbit.isOrbit === true;
    const driftOk = altDriftPct < 1.0; // altitude stays within 1% over a full revolution
    const pass = eccOk && orbitOk && driftOk;

    const fmt = (x) => (typeof x === "number" ? x.toFixed(3) : String(x));
    console.log(
      `[physics self-test] ${pass ? "PASS" : "FAIL"}\n` +
      `  body: r=${fmt(body.radius)} m, mu=${body.mu.toExponential(3)}, atmoTop=${fmt(body.atmosphere.height)} m\n` +
      `  start alt=${fmt(alt0)} m, vCirc=${fmt(vCirc)} m/s, period=${fmt(period)} s, steps=${n}\n` +
      `  alt min/max over 1 rev: ${fmt(minAlt)} / ${fmt(maxAlt)} m (drift ${fmt(altDriftPct)}%)\n` +
      `  alt final: ${fmt(altFinal)} m\n` +
      `  orbit: ecc=${fmt(orbit && orbit.eccentricity)}, ` +
      `peri=${fmt(orbit && orbit.periapsis)} m, apo=${fmt(orbit && orbit.apoapsis)} m, ` +
      `isOrbit=${orbit && orbit.isOrbit}\n` +
      `  checks: ecc<0.02=${eccOk}, isOrbit=${orbitOk}, drift<1%=${driftOk}`
    );
    return pass;
  },
};

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function wrap2pi(a) { const t = a % (2 * Math.PI); return t < 0 ? t + 2 * Math.PI : t; }
