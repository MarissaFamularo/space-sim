---
name: space-sim-analysis-toolkit
description: >
  First-principles analysis recipes for the space-sim repo (/home/user/space-sim) — the
  "prove it, don't just eyeball it" toolkit. Load this skill when you need the reproducible
  PREDICT-THEN-CHECK procedure and scripts: state a number before you run, then confirm it
  against the sim within a tolerance. Use it to audit integrator energy drift, derive a
  landing survivability envelope, justify a new part's numbers with the rocket equation, or
  apply the house "hypothesis predicts numbers BEFORE running" discipline. (For what a
  number SHOULD be and which formula the code runs — the derivations themselves — load
  `orbital-mechanics-reference` instead; this skill is the workflow, that one is the theory.)
  Each recipe is formula → worked example with REAL numbers from this repo → the sim check
  that should agree → tolerance. It ships scripts/drift_audit.mjs. Load it before proposing a
  balance change, before trusting a surprising readout, or when a reviewer asks "how do you KNOW?".
  Keywords: predict before run, hypothesis, sanity check, rocket equation, energy drift,
  integrator audit, survivability envelope, first principles, prove it, worked example,
  tolerance, back-of-envelope, TWR floor, terminal velocity.
---

# Space Sim — Analysis Toolkit

The house method: **write the number down before you run.** A hypothesis that predicts a
figure and is then confirmed by the sim is evidence; a flight that "looked right" is not.
This skill is the PRACTICE (recipes you execute); `orbital-mechanics-reference` is the
THEORY (derivations). Each recipe gives you a formula, a worked example computed from THIS
repo's `BODIES` (with the exact command so you can reproduce it), the sim output that should
agree, and a tolerance.

**When NOT to use this skill:**

| You actually need | Go to sibling skill |
|---|---|
| The derivation of a formula (vis-viva, Hohmann, rocket eq.) | `orbital-mechanics-reference` |
| The full Δv campaign / margin ledger | `space-sim-delta-v-campaign` |
| To drive the real browser game and screenshot it | `space-sim-browser-verification` |
| To run/extend the node test suites | `space-sim-testing-and-qa` |
| A symptom → cause table for an active bug | `space-sim-debugging-playbook` |
| Constant values / where they live | `space-sim-constants-and-storage` |

This skill owns: predict-before-run discipline and the reusable analysis recipes.

---

## The discipline (do this every time)

1. **State the hypothesis as a number, before running.** Not "it should reach orbit" —
   "circular speed at 1.35 R is 2152 m/s, so a stage with ≥ ~2300 m/s Δv above that
   altitude circularizes." HANDOFF precedent: an 8°-late Mars burn was predicted to
   "miss Mars by ~1,000,000 km" — the test then confirmed ~940 Mm. The prediction came
   first.
2. **One mechanism must explain ALL observations, including the negatives.** If your
   explanation accounts for the failure but not why the *neighbouring* case works, it's
   incomplete. (Example: the stargen moon bug — "60 radii like ours" explained the red
   dwarf failure only once you also explained why Sol-like homes were fine: their SOI is
   big enough that 60 radii still fits.)
3. **Compute from `BODIES`, never hardcode.** Every worked number below comes from
   `state.js` at runtime. If you paste a constant, it will drift.
4. **Then run the sim and compare against tolerance.** Agreement within tolerance =
   confirmed. Disagreement = either your math or the code is wrong; find out which before
   moving on.

Quick reference (scaled universe, `SCALE=0.1`, computed 2026-07-06 — re-run the one-liner in
Provenance to refresh). The **canonical, maintained worked-numbers table lives in
`orbital-mechanics-reference` §7** (backed by its `worked_numbers.mjs`); this compact copy is
here only so the recipes below are self-contained. **`v_circ` here is at a flat 1.35 R** — for
a thick-atmosphere body the *actual* parking orbit sits higher (see Recipe 1), so Titan's real
low-orbit speed is 453 m/s, not the 508 shown; `orbital-mechanics` §7 lists it at the parking
radius. When the two tables seem to disagree, that radius basis is why.

| Body | R (km) | g0 (m/s²) | mu (m³/s²) | v_circ @flat 1.35R | v_esc @surface |
|---|---|---|---|---|---|
| Earth | 637.1 | 9.81 | 3.98e12 | 2152 m/s | 3536 m/s |
| Moon | 173.7 | 1.62 | 4.89e10 | 457 m/s | 750 m/s |
| Mars | 338.9 | 3.71 | 4.26e11 | 965 m/s | 1586 m/s |
| Titan | 257.5 | 1.35 | 8.96e10 | 508 m/s (453 at parking radius) | 834 m/s |

---

## Recipe 1 — Circular orbit speed & period for any body

**Formula:** `v = √(mu/r)`, `T = 2π√(r³/mu)`, with `mu = g0·R²` (state.js:62).
**Worked example (Mars low orbit, r = 1.35 R):**
```bash
node -e 'import("./js/state.js").then(({BODIES:B})=>{const b=B.mars,r=b.radius*1.35;
console.log("v_circ",Math.sqrt(b.mu/r).toFixed(0),"m/s  T",(2*Math.PI*Math.sqrt(r**3/b.mu)/60).toFixed(0),"min")})'
# -> v_circ 965 m/s  T ~50 min
```
**Sim check:** `Physics.parkingOrbit("mars", 0)` returns `.speed`; a `teleport_test.mjs`
lap prints the achieved orbit. **Tolerance:** < 2% (teleport laps assert ~1%). **Two
expected exceptions:** Io drifts ~10% (Jupiter's tide, real, accepted by the test), and any
**thick-atmosphere body** (Titan) parks HIGHER than 1.35 R — `parkingOrbit` uses
`max(1.35 R, R + 3·atmo height)`, so its real low-orbit speed is *lower* than the flat-1.35 R
number (Titan: 453 m/s at the parking radius, not 508 m/s). Sanity-check atmospheric bodies
against the parking radius, not 1.35 R.

## Recipe 2 — Δv-to-orbit estimate (with loss reasoning)

**Formula:** ideal = `v_circ` at target altitude; real = ideal + gravity/drag/steering
losses. On scaled Earth, `dv_audit.mjs` MEASURED losses ≈ 1068 m/s on a real ascent
(3463 spent vs 2395 ideal at that altitude). Use ~1.0–1.1 km/s as the scaled-Earth loss
budget until you measure otherwise.
**Sim check:** run the flown-ascent section of `space-sim-delta-v-campaign/scripts/dv_audit.mjs`.
**Tolerance:** losses are trajectory-dependent; predict a band (±20%), not a point.

## Recipe 3 — Hohmann transfer time & phasing lead angle

**Formula:** `a_T = (r1+r2)/2`, `t = π√(a_T³/mu_sun)`, lead angle
`= π − ω_target·t` (matches `Physics.transferWindow`'s `leadAngle_deg`).
**Worked example (Earth→Mars):** `dv_audit.mjs` prints coast = **81.9 game-days** (real ≈
8.5 months — the √10 scaling, see `orbital-mechanics-reference`).
**Sim check:** `Physics.transferWindow(sim, "mars")` from a Sun orbit → compare
`transferTime_s` and `leadAngle_deg`. **Tolerance:** exact (both are the same closed form);
a mismatch means a code bug.

## Recipe 4 — Integrator energy / drift audit

Ships as a script. It flies a circular orbit for N laps at several warp step sizes and
reports position drift — the honest measure of integrator quality.
```
node .claude/skills/space-sim-analysis-toolkit/scripts/drift_audit.mjs
```
**Interpret:** low warp (small substeps) should hold < ~1%/lap; drift grows with step size
until the adaptive substep cap (`physics.js MAX_SUBSTEPS`, `sim.warpLimited`) bites. If a
SMALL step drifts badly, that's a real integrator regression — not warp. **Tolerance:**
compare against the baseline the script prints; a sudden jump vs a clean checkout is the
signal.

## Recipe 5 — Landing survivability envelope

**Formula:** terminal velocity under chute = balance of drag vs weight in the LOCAL air
(each atmosphere moves with its planet); survivable touchdown is
`LAND_SPEED`/`LAND_TOTAL` (5/12 m/s), or `LEGS_*` (12/18) with legs (physics.js:25–28;
maintained catalog: `space-sim-constants-and-storage` A.3).
**Predict, then reproduce the known results:** Titan's air is thicker than Earth's → a
chute alone lands softly (Huygens); the Moon has no air → a chute does nothing (crashes).
Both are asserted in `chute_test.mjs` / `planets_test.mjs`. Compute the terminal velocity
from the drag model BEFORE running the test and confirm it lands under the threshold.
**Tolerance:** the qualitative result (lands vs crashes) is exact; the terminal-velocity
number depends on the drag model — read it from `physics.js`, don't assume `½ρv²Cd`.

## Recipe 6 — Escape velocity & "cut engine at escape"

**Formula:** `v_esc = √(2·mu/r)`. The taught pattern is "burn prograde until you escape the
planet into a Sun orbit, then CUT ENGINE" (HANDOFF) — because burning past escape drops you
into a target-crossing ellipse where window guidance goes silent by design.
**Sim check:** watch `orbit.aroundBody` flip to "Sun" (dominant body changes). **Tolerance:**
exact at the SOI boundary.

## Recipe 7 — Justifying a new part's numbers (the Mega/Osprey template)

This is the template every `space-sim-delta-v-campaign` Option-B proposal must follow. The
Mega Tank (18 t) and Osprey (90 kN, ve 4400) were added because "without them the stock
catalog barely escapes Earth" (HANDOFF Phase 4). The Osprey teaches the **thrust-vs-ve
trade**: low thrust (can't lift off) but high exhaust velocity (more Δv per ton) — the same
lesson as the real ion drive, one rung less extreme.
**Method:** for a proposed part, compute the stage Δv it enables (`ve·ln(m0/m1)`), add it to
the campaign ledger walk, and show the predicted margin. The number justifies the part; the
part is not chosen and then rationalized.

## Recipe 8 — Hypothesis discipline, worked

Before running, fill this in: *"I predict [quantity] = [number] because [mechanism]. If the
sim shows more than [tolerance] off, then either [my math is wrong here] or [the code does X
instead]."* Only then run. This single habit is what separates a confirmed result from a
coincidence, and it is the evidence bar `space-sim-change-control` requires before an idea
becomes an adopted change.

---

## Provenance and maintenance

Worked numbers verified against the repo on **2026-07-06**. Re-verify:

```bash
# Refresh the reference worked-numbers table (Recipe intro):
node -e 'import("./js/state.js").then(({BODIES:B})=>{for(const k of ["earth","moon","mars","titan"]){const b=B[k];const rL=b.radius*1.35;console.log(k.padEnd(6),"vcirc@1.35R="+Math.sqrt(b.mu/rL).toFixed(0),"vesc@surf="+Math.sqrt(2*b.mu/b.radius).toFixed(0))}})'

# Confirm the landing constants the survivability recipe cites:
grep -n "LAND_SPEED\|LAND_TOTAL\|LEGS_LAND" js/physics.js

# Confirm mu = g0·R² still holds (all recipes depend on it):
grep -n "mu" js/state.js | grep -i "g0\|radius"

# Re-run the shipped drift audit and compare to its printed baseline:
node .claude/skills/space-sim-analysis-toolkit/scripts/drift_audit.mjs
```

The recipes import only pure modules (`state.js`, `physics.js`). If any one-liner throws
`Cannot find package 'three'`, a pure module gained a Three.js dependency — that's a
regression (`space-sim-architecture-contract`: physics/state stay node-pure), report it.
