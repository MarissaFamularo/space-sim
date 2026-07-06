---
name: orbital-mechanics-reference
description: >
  Orbital-mechanics theory pack for the space-sim repo — every formula tied to the code that
  uses it, with game-world numbers. Load this when you need to: predict or sanity-check an
  orbital number (circular speed, period, apoapsis/periapsis, eccentricity, escape velocity,
  Δv, TWR, transfer time, lead/phase angle); understand the SCALE=0.1 scaled universe and why
  the game runs √10≈3.2x faster than reality; interpret Physics.computeOrbit /
  transferWindow / courseCorrection / parkingOrbit / satellitePos output; reason about the
  atmosphere, drag, parachute, reentry-heat, or landing-survivability model; convert between
  game numbers and real numbers; or explain vis-viva, Hohmann transfers, SOI, Kepler
  propagation, or the rocket equation as THIS repo implements them. Keywords: mu, vis-viva,
  Hohmann, phasing, lead angle, SOI, sphere of influence, Tsiolkovsky, delta-v, Isp, exhaust
  velocity, TWR, eccentricity, Kepler, mean motion, synodic, reentry, drag, chute, escape
  velocity, scaled universe, sqrt(10).
---

# Orbital Mechanics Reference (as this repo implements it)

Everything below was verified against the code on **2026-07-06** (all 8 node suites green;
worked numbers computed live from `js/state.js`). Line numbers cited are from that date —
re-verify with the commands in "Provenance and maintenance" before trusting them blindly.

**Use this skill for**: the math and the model — what a number *should* be and which formula
the code runs.
**Do NOT use it for**:

| If you need… | Load instead |
|---|---|
| What the tests prove / how to add one | `space-sim-testing-and-qa` |
| Every tunable constant + localStorage schema catalog | `space-sim-constants-and-storage` |
| Predict-then-verify analysis recipes (workflow, not formulas) | `space-sim-analysis-toolkit` |
| The Δv/fuel balance campaign (Mars round trip tuning) | `space-sim-delta-v-campaign` |
| Debugging a wrong-looking trajectory | `space-sim-debugging-playbook` |
| The frozen invariants and why they exist | `space-sim-architecture-contract`, `space-sim-change-control` |

Owner's frozen rule #3 (non-negotiable): **physics stays REAL**. The only permitted lie is
the documented SCALE=0.1, and the game must always teach both the game number and the real
number. This skill exists so you can compute both.

## 1. Ground rules of this universe

- **2D planar, heliocentric.** World origin = the Sun's center. Positions/velocities in
  meters and m/s; mass in tonnes (t); thrust in kN; angles in radians.
- **Every body rides a fixed circular CCW orbit** around its parent (`state.js
  bodyStateAt`, recursive through the parent chain). Bodies are never perturbed.
- **Gravity on the craft is superposed from every body every substep** (restricted n-body,
  `physics.js step`). There is NO patched-conic handoff in the integrator.
- **SOI is display/guidance only.** "Sphere of influence" (SOI) = the region where a body's
  gravity dominates. Here it decides which body owns your readouts and orbit display
  (`state.js dominantBody`, ~line 186: deepest SOI containing the point — Moon beats Earth
  beats Sun), never the force calculation.
- **Heading convention** (physics.js:10-11): angle 0 points along **+Y**, increasing CCW;
  the thrust/heading unit vector is `(-sin a, cos a)`. To point the nose along a world
  vector `v`: `angle = Math.atan2(-v.x, v.y)`.
- Integrator: semi-implicit (symplectic) Euler with adaptive substeps
  (`Physics.maxStableStep`), ~2000 substeps per local orbit, finer when thrusting, in air,
  or near a surface.

## 2. The scaled universe (SCALE = 0.1) — the one derivation to internalize

`SCALE = 0.1` at **state.js:13**. The rule (state.js buildCatalog, line ~62):

- Every **radius** and every **orbit distance** is the real value **× 0.1**.
- Every **surface gravity g0 stays REAL** (Earth 9.81, Mars 3.71, …).
- Therefore the gravitational parameter is forced: **mu = g0 · r²** → mu scales **× 0.01**.
  (mu, "mu" = GM, m³/s², the only mass-like number orbital math needs.)

Now push that through every formula (let s = 0.1):

| Quantity | Formula | Scaling | Result |
|---|---|---|---|
| Circular orbit speed | v = √(mu/r) | √(s²/s) = √s | **× √0.1 ≈ 0.316** |
| Escape velocity | v = √(2mu/r) | same | × √0.1 |
| Orbital period | T = 2π√(r³/mu) | √(s³/s²) = √s | **× √0.1** |
| Body's orbital rate | ω = √(mu_parent/a³) | √(s²/s³) = 1/√s | × √10 (faster) |
| Transfer time | t = π√(aT³/mu) | √s | × √0.1 |
| Lead/phase angle | π − ω·t | (1/√s)·(√s) = 1 | **unchanged — scale-invariant** |
| Surface gravity, TWR, Δv budgets vs real missions | — | — | g real; speeds & Δv all × √0.1 |

So the whole system runs **√10 ≈ 3.16× faster** than reality, geometry is preserved (the
Moon is still ~60.3 Earth-radii out), all *angles* (transfer lead angles, window geometry)
are identical to the real solar system, and every speed is the real speed × 0.316. To quote
the real number next to a game number: **real = game ÷ √0.1** for speeds and Δv;
**real = game × √10** for times.

Trip-time consequences (computed from BODIES, section 8): Earth year = **115.5 game days**
(= 365.25 × √0.1). Earth→Mars Hohmann cruise = **81.9 game days** vs real ~259 days
(~8.5 months). LEO→Moon = **~38 game hours** vs Apollo's ~3 days. This is why time-warp
tiers (`WARPS`, main.js:23) top out at 2,000,000× — "top tier: Pluto runs".

## 3. Core formulas and where the code runs them

Jargon, defined once: **apoapsis/periapsis** = highest/lowest point of an orbit (this repo
reports them as *altitudes above the surface*, not radii — physics.js computeOrbit, ~line
431); **eccentricity e** = shape (0 circle, <1 ellipse, ≥1 escape); **semi-major axis a** =
half the orbit's long dimension; **prograde/retrograde** = along/against your velocity.

| Concept | Formula | Where in the repo |
|---|---|---|
| Circular orbit speed | v = √(mu/r) | `Physics.parkingOrbit` (physics.js ~694), `_selfTest`, every test's `circularSim` |
| Orbital period | T = 2π√(r³/mu) | `_selfTest` (physics.js ~746); mean motion n = √(mu/a³) in transferWindow ~511 |
| Vis-viva (speed anywhere on a conic) | v² = mu(2/r − 1/a) | tests build ellipses with it (transfer_test.mjs ~68); equivalent energy form below is what ships |
| Specific orbital energy | ε = v²/2 − mu/r; a = −mu/2ε | `computeOrbit` (physics.js ~396-411) |
| Eccentricity from state vectors | e = √(1 + 2εh²/mu²), h = x·vy − y·vx | `computeOrbit` ~398-413; ecc VECTOR (→periapsis direction) ~425-428 |
| Apo/peri | r_apo,peri = a(1±e), minus body radius for altitude | `computeOrbit` ~414-432 |
| Escape velocity | v_esc = √(2mu/r) | phase5_test.mjs ~94 (Phobos escape ≈ bike speed) |
| Rocket equation (Tsiolkovsky) | Δv = ve·ln(m0/m1) | `computeStats` (state.js:244), phase5_test ~114 |
| TWR (thrust-to-weight) | TWR = thrust_N / (m·g0) | `computeStats` (state.js:236) — g0 of the chosen body, default Earth |
| Exhaust velocity vs Isp | ve ≈ Isp × 9.81 | parts.js comments, e.g. Sparrow ve=2800 "~Isp 285s" (2800/9.81≈285) |
| Fuel flow while burning | ṁ = F/ve (kg/s) | `step` (physics.js ~167-177) |
| SOI radius | r_soi = a·(mu/mu_parent)^(2/5) | `buildCatalog` (state.js:82); tiny moons clamped to 2×radius + `tinyMoon` flag (state.js:86-89) |
| Hohmann transfer time | t = π√(aT³/mu), aT = (r_now + r_target)/2 | `transferWindow` (physics.js ~497-498) |
| Phasing lead angle | lead = π − ω_target·t_transfer (wrapped to ±π) | `transferWindow` (physics.js ~501) |
| Kepler propagation of a frozen conic | elements → Kepler's equation (Newton iters) → position | `keplerElements`/`keplerPosAt` (physics.js ~771-805); used by `courseCorrection` and `satellitePos` |

Repo-specific facts about these implementations:

- **`computeOrbit`** works about the **dominant body** with body-relative pos/vel
  (everything moves — never use raw world velocity). `isOrbit` requires: ε<0, periapsis
  above the atmosphere top, AND apoapsis inside the body's SOI (a "captured" orbit the
  parent can't reclaim; the Sun has no SOI bound). Near-parabolic (|ε|<1e-9) is treated as
  escape.
- **`computeStats` Δv is a whole-rocket, single-stage approximation**: total wet / total
  dry mass, ve = plain (unweighted) mean over ALL engines on the craft — despite the
  comment at state.js:237 saying "thrust-weighted", the code at state.js:239-243 averages
  equally. A staged rocket's true Δv is higher; `Physics.applyStage` recomputes
  thrust/ve/fuel per stage at staging time (ve = mean over the *new current stage's*
  engines only).
- **Stock ve range** (parts.js): Sparrow 2800, Hawk 3000, Osprey 4400, Sky-Crane 2600,
  Ion 30000, Starfire Torch 120000 m/s. Remember: game Δv needs are real needs × √0.1, so
  chemical engines with real-world ve are ~3.2× "stronger" here relative to the mission.

## 4. Transfers: window out, correction in

**`Physics.transferWindow(sim, targetKey)`** (physics.js ~463-546) answers "when do I
burn?" for a Hohmann transfer from a near-circular orbit around a central body to a target
circling the SAME central (Moon trip: central=Earth; Mars trip: central=Sun — escape Earth
first). Mechanics:

1. Half-ellipse from your CURRENT radius r to the target's orbit radius:
   aT = (r + r_target)/2, t = π√(aT³/mu_central).
2. Burn when the target leads you by **lead = π − ω_target·t** (radians, wrapped to ±π).
   The phase closes at rate (n_ship − ω_target); `degToGo` is the arc of YOUR orbit left
   to travel; `open` = within 15° of the burn point.
3. `dir`: **"prograde" going outward, "retrograde" coming inward** (e.g. Mars→Earth: you
   burn against your motion to drop your periapsis to Earth's orbit).

Returns **null** (silence, not bad guidance) when: not in a stable orbit, target doesn't
circle your current dominant body, retrograde (CW) orbit, or your apo/peri has already
stretched ≥70% of the way to the target ("keep burning" territory, physics.js ~486-489).

Numbers (scale-invariant, so they match real astronautics): Moon lead angle from the
standard test LEO ≈ **114.6°** (Apollo TLI was ~120°); Mars lead angle from Earth's orbit
≈ **44.3°** (real ~44°). Window recurs once per **synodic period** (time for the phase
angle to lap around): 2π/(n_ship − ω_target) — tested in transfer_test.mjs case 5.

**Guidance philosophy (HANDOFF.md, "window for the departure, course-correction for the
arrival")**: do NOT try to make the window exact enough to skip corrections — corrections
ARE the lesson. The sensitivity is brutal at interplanetary scale: a 2°-sloppy departure
still arrives, but an **8°-late Mars burn misses by ~940,000 km** (~1,000,000 km; ~16 Mars
SOI radii). Node-proof: planets_test.mjs case 5b flies a deliberately 8°-early + overshot
burn, gets `miss=940 Mm dir=retrograde-out`, and converges to `onTarget` by following the
guidance (verified green 2026-07-06).

**`Physics.courseCorrection(sim, targetKey)`** (physics.js ~564-618), the Apollo-13 move:

- Kepler-propagates your **frozen current conic** about the central (pure two-body math via
  `keplerElements`/`keplerPosAt` — no integration, so it's cheap and deterministic) and
  scans ~1.4 transfer-times ahead for closest approach to the moving target
  (`predictClosest`, coarse 240-sample scan + trisection refine).
- Probes 8 compass directions in the velocity frame with a 5 m/s test nudge; returns the
  best as a world-frame unit `burnVec` + human label ("prograde", "radial-in", …) +
  `perDv` (meters of miss removed per m/s burned).
- `onTarget` = predicted miss < target SOI → stop correcting; capture is now possible.
- Returns null when: wrong SOI, retrograde, hyperbolic (ε≥0), e≥0.995, or the conic never
  gets within 0.35× the target's orbit radius (you haven't really left yet).

The frozen-conic trick is also how **satellites** work: `makeSatellite` freezes the orbit
elements {a, e, periAngle, M0, n, epoch} at release; `satellitePos` Kepler-propagates for
display forever after (physics.js ~706-724). Frozen conics ignore third-body drag — that's
accepted: they're display/guidance, the craft itself is always n-body integrated.

## 5. Escape, and the coached pattern

Escape velocity from radius r: **v_esc = √(2mu/r) = √2 × v_circ**. Game Earth surface:
3536 m/s (real 11,186 × √0.1 = 3537 ✓). Phobos: ~5 m/s — bike speed, node-tested.

The coached flight pattern for interplanetary trips is **"burn prograde until you ESCAPE,
then CUT ENGINE"** (main.js ~269 sets it up; main.js:684 fires the moment SOI flips to the
Sun: "You've escaped — cut your engine (X) now!"). Why cutting matters: once ε≥0 relative
to Earth you're on a solar orbit; every extra second of burning raises your solar apoapsis
far past the target and wrecks the phase geometry `transferWindow` will compute next. The
sequence is: escape → coast → wait for the gold Burn marker (the solar-orbit transfer
window) → transfer burn → mid-course corrections → arrive. Don't teach or script
"burn straight at Mars"; the guidance stack assumes the coached sequence.

## 6. Atmosphere, drag, chutes, reentry heat, landing — the model as implemented

All in physics.js. Atmosphere per body = `{height, seaLevelDensity}` (state.js REAL table,
heights scaled ×0.1 like all lengths; densities kept real — Earth 1.225 kg/m³ to 7 km
scaled top, Mars 0.020, Venus 65, Titan 5.3).

| Piece | Implementation | Constants (physics.js lines, as of 2026-07-06) |
|---|---|---|
| Density | Exponential: ρ = ρ0·e^(−alt/H), scale height **H = height/5**, 0 at/above top | `airDensity` ~72-76 |
| Drag | F = ½ρ·v_rel²·CdA, opposing velocity **relative to the local air** (air co-moves with its planet); capped so one substep may slow but never reverse you | hull CdA = **2.0 m²** flat, ~240; cap ~243 |
| Parachute | Adds CHUTE_CDA per chute, but only if ρ > 0.001 kg/m³ AND rel speed < CHUTE_MAX_SPEED (else it streams uselessly) | `CHUTE_CDA = 1200` m², `CHUTE_MAX_SPEED = 250` m/s (lines 40-41) |
| Reentry heat | Hull heat 0..1 **relaxes toward an equilibrium set by instantaneous flux ρ·v_rel³** (peak flux melts ships, not total energy). heat ≥ 1 → burned up. Cools by the same relaxation | `HEAT_EQ_K = 3.8e-9`, `HEAT_TAU = 4` s (lines 34-35) |
| Landing survivability | Touchdown survives if descent rate ≤ LAND_SPEED and total surface-relative speed ≤ LAND_TOTAL; landing legs raise both | `LAND_SPEED=5`, `LAND_TOTAL=12`, `LEGS_LAND_SPEED=12`, `LEGS_LAND_TOTAL=18` m/s (lines 25-28) |
| Non-solid bodies | Sun/gas giants: contact = crash always (`burnedUp` for the Sun, `sankIntoClouds` for giants) | step ~269-274 |

Pedagogical contrasts these constants deliberately produce (all node-tested): chute alone
lands you on Earth; chute never opens in vacuum and is useless on the Moon (chute_test);
Mars's thin air means chute alone is NOT enough — you need engines too, the sky-crane
lesson (planets_test case 6); Titan's air is thicker than Earth's — the one world where a
chute alone is plenty (Huygens 2005; state.js:42-44). Shallow reentry survives (maxHeat
~0.41), steep lunar-return dive burns up (reentry_test).

## 7. Worked numbers (computed from the live catalog, 2026-07-06)

Generated by a script in this skill — run it yourself from the repo root:

```bash
node .claude/skills/orbital-mechanics-reference/scripts/worked_numbers.mjs
```

"Low orbit" below = `Physics.parkingOrbit`'s radius rule: max(1.35×radius, radius + 3×atmo
height) — the teleport parking orbit. Real-equivalent speed = game ÷ √0.1.

| Body | Radius (km) | mu (m³/s²) | Low-orbit r (km) | v_circ (m/s) | Period (min) | v_esc surface (m/s) | g0 |
|---|---|---|---|---|---|---|---|
| Earth | 637.1 | 3.982e12 | 860.1 | **2152** (real-eq 6805) | 41.9 | **3536** (real-eq 11,183) | 9.81 |
| Moon | 173.7 | 4.888e10 | 234.5 | **457** | 53.8 | 750 | 1.62 |
| Mars | 338.9 | 4.262e11 | 457.6 | **965** | 49.6 | 1586 | 3.71 |
| Titan | 257.5 | 8.963e10 | 437.5 | **453** | 101.2 | 834 | 1.352 |

System-level numbers from the same run: Earth year **115.5 game days**; Moon month
**8.69 game days**; Earth→Mars Hohmann **81.9 game days**, lead **44.3°**; LEO→Moon
**37.9 game hours**, lead **114.6°**; Moon SOI **6613 km**, Mars SOI **57,629 km**; Moon
orbit = **60.3** Earth radii (real geometry preserved).

Handy anchors: Mars low-orbit v_circ 965 m/s is exactly the "~965 m/s + margin" the
sky-crane Δv test budgets for a powered Mars landing (phase5_test ~110-115). The standard
test LEO (Earth radius + atmo top + 50 km = 694.1 km radius) circles at 2395 m/s in
30.3 min — the "30-min orbit" transfer_test.mjs's burn-controller comment refers to.

## 8. Traps when computing by hand

1. **Always subtract the dominant body's state.** World velocity is dominated by the
   planet's solar orbit (Earth moves ~9.4 km/s around the Sun in-game). Prograde for an
   Earth burn = prograde *relative to Earth* (transfer_test.mjs ~129-131 shows the idiom).
2. **Apo/peri from the code are altitudes**, textbook formulas give radii. Add/subtract
   `body.radius` when comparing.
3. **Heading angle 0 = +Y, not +X.** Nose along vector v: `atan2(-v.x, v.y)`.
4. **CCW only.** All bodies orbit CCW; retrograde (CW) craft orbits get NO transfer or
   correction guidance by design (null, not wrong answers).
5. **Don't quote real-world Δv tables** (e.g. "LEO needs 9.4 km/s"): divide by √10 first.
   And when writing kid-facing content, frozen rule #3 requires showing BOTH numbers.
6. **mu ≠ scaled real mu.** mu here comes from g0·r² with scaled r — it is 0.01× real, not
   0.1×. Never look up a real GM and multiply by 0.1.
7. **`tinyMoon` bodies (Phobos, Deimos) cannot be orbited** — true SOI < their radius
   (real!). `parkingOrbit` returns a co-moving formation offset instead (physics.js
   ~683-691).

## Provenance and maintenance

Verified 2026-07-06: read physics.js/state.js/parts.js/main.js in full at the cited lines;
ran all 8 test suites green (`for t in chute mods phase5 planets reentry stargen teleport
transfer; do node tests/${t}_test.mjs; done` from repo root); every number in section 7
produced by `scripts/worked_numbers.mjs` on that date. Re-verification one-liners
(repo root):

```bash
# SCALE and the mu rule
grep -n "const SCALE" js/state.js && grep -n "g0 \* radius \* radius" js/state.js
# Landing / heat / chute constants
sed -n '25,41p' js/physics.js
# Lead-angle formula and transfer time
grep -n "Math.PI - target.omega \* tTransfer\|Math.PI \* Math.sqrt((aT" js/physics.js
# Rocket equation + TWR
sed -n '234,245p' js/state.js
# Warp tiers (top tier claim)
grep -n "const WARPS" js/main.js
# The 940 Mm sloppy-burn miss + convergence
node tests/planets_test.mjs | grep -i miss
# Regenerate every number in section 7
node .claude/skills/orbital-mechanics-reference/scripts/worked_numbers.mjs
```

Drift watch: physics.js constants (lines 25-41) and parts.js engine stats are the likely
movers during the Δv/fuel balance pass (`space-sim-delta-v-campaign`) — recheck sections 3,
6, 7 after any balance change. If `SCALE` ever flips to 1.0 (state.js:13 comment says
"later"), section 2's consequences all collapse to ×1 and this skill needs a rewrite.
