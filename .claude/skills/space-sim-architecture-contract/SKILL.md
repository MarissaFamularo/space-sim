---
name: space-sim-architecture-contract
description: >
  The load-bearing design decisions and invariants of the space-sim repo — WHY the physics
  is superposed n-body with SOI as display-only, why the floating origin lives in render.js
  alone, why body keys are roles not names, how the scaled universe (SCALE=0.1) works, and
  which module API surfaces are frozen. Load this BEFORE changing js/state.js, js/physics.js,
  js/render.js coordinate handling, the BODIES catalog, setSystem/returnToSol, or any shared
  data shape (SimState, PartDef, TransferWindow, CourseCheck). Also load when you see these
  symptoms: rocket mesh jitters/vibrates at large distances, planets render black, readouts
  show huge wrong speeds (~21 km/s while "parked"), a generated system shows "Earth" instead
  of its real name, stale planets after a Starmap jump, orbit readouts jumping between bodies,
  or you are tempted to add reference-frame switching, retrograde/inclined orbits, or to
  hardcode a body constant. Keywords: invariant, contract, ARCHITECTURE.md, coordinate system,
  heliocentric, floating origin, SOI, patched conics, dominantBody, SCALE, role keys, SYSTEM.rev,
  frozen API.
---

# Space Sim — Architecture Contract (the invariants and why they hold)

This skill explains the design decisions that everything else in `/home/user/space-sim`
leans on. `ARCHITECTURE.md` at the repo root is the literal contract ("This file is the
contract. Every module builds against the shapes and APIs below."); this skill is the
*commentary*: what each invariant means, the reasoning or incident behind it, and the exact
symptom you will see if you violate it. All file:line references verified 2026-07-06.

**When NOT to use this skill — go to a sibling instead:**

| You want to... | Use |
|---|---|
| Know whether a change is even allowed, and how to record it | `space-sim-change-control` |
| Diagnose a live bug from a symptom | `space-sim-debugging-playbook` (this skill only covers *invariant-violation* symptoms) |
| Look up a constant's exact value or a localStorage schema | `space-sim-constants-and-storage` |
| Understand the orbital-mechanics math itself | `orbital-mechanics-reference` |
| Run/extend the node test suites | `space-sim-testing-and-qa` |
| Set up the dev server / deploy | `space-sim-dev-loop` |
| Touch the Navigator (in-game Claude) or its safety prompt | `space-sim-navigator-and-safety` |
| Read about past bugs and how they were settled | `space-sim-failure-archaeology` |

**Fast drift check** (greps every invariant below; `--tests` also runs all 8 node suites):

```bash
bash .claude/skills/space-sim-architecture-contract/scripts/check-invariants.sh --tests
```

Verified 2026-07-06: all 17 grep checks OK, all 8 suites green (171 checks total).

---

## The world model in one paragraph

Physics is **planar 2D** in **float64, Sun-centered meters**: every position and velocity is
`{x, y}` with the Sun's center at `(0,0)`. Every body rides a fixed **circular, counter-clockwise
(CCW)** orbit around its parent, computed analytically by `bodyStateAt(key, t)`
(js/state.js:156) — bodies are never integrated, only the craft is. The craft is integrated by
a semi-implicit Euler scheme with adaptive substeps (js/physics.js `Physics.step`) under
gravity **superposed from every body every step**. Units: mass in tonnes, thrust in kN,
exhaust velocity in m/s, time in seconds, angles in radians with 0 = +Y (launch "up"),
increasing CCW. Render lifts physics `(x,y)` to Three.js `(x,y,0)` after subtracting a
floating origin. The whole system ships at `SCALE = 0.1` (js/state.js:13).

---

## The invariants

### I1. Gravity is superposed; SOI is a display concept only

**Rule.** The integrator sums gravity from EVERY body on every substep (js/physics.js:209,
"Gravity from EVERYONE (restricted n-body superposition)"). "Sphere of influence" (SOI —
the patched-conics idea that one body at a time owns you) exists only for *display and
readouts*: `dominantBody(pos, t)` (js/state.js:186) picks the deepest SOI containing the
craft, and that body anchors the orbit ellipse, altitude, speed, and Navigator messaging.

**Why.** Patched conics was the Phase-1 plan and was explicitly rejected in Phase 2 —
`space-game-design.md` line 41 records it: superposed gravity is "more real, and no risky
reference-frame switch." A frame hand-off at an SOI boundary is a classic source of energy
glitches and teleport bugs; this engine simply never changes frames. Physics stays in Sun
coordinates from launch to landing. Bonus realism: lunar/solar tides are free (the teleport
test suite notes Io's orbit drifts ~10% per lap from Jupiter's tide — "real and fine").

**If you violate it.** Adding any frame switch, or making `dominantBody` feed the integrator,
reintroduces the exact bug class the design rejected: discontinuous velocity at SOI crossings,
orbits that pump energy each Moon flyby. Symptom of the *display* side breaking instead:
orbit readout flickers between "Around Earth"/"Around Sun" or altitude jumps by an
Earth-orbit-radius — suspect `dominantBody` or `soiRadius`, not the integrator.

### I2. Floating origin lives in render.js ONLY; physics never sees it

**Rule.** World coordinates reach ~4.5e11 m (Neptune), far past float32 mesh precision.
Render therefore positions everything at `world − ORIGIN`, where `ORIGIN` is the craft's
position in flight. The `ORIGIN` object is js/render.js:83 and the subtraction is done in
plain float64 JS numbers *before* any `THREE.Vector3` is touched (e.g. render.js:2213-2225).
The identifier `ORIGIN` appears in **no other module** — physics, state, and main all work
in raw Sun-centered float64 coordinates.

**Why.** One module, one lie. If the offset ever leaked into physics or state, every
consumer would need to know which frame a number is in, and a single missed subtraction
would silently corrupt trajectories. Keeping it render-side means physics is pure and
node-testable (all 8 test suites run without a DOM precisely because of this).

**If you violate it.** Subtract too late (inside a Vector3) or not at all, and a 10 m rocket
at Neptune distance vibrates/jitters/shatters — float32 has ~30 km granularity at 4.5e11.
Position a new scene object in world coordinates without `- ORIGIN.x` and it renders at a
huge offset or not at all. Rule of thumb: anything you `position.set(...)` in render.js that
represents a world location must subtract ORIGIN first, in JS numbers.

### I3. Role keys are stable; display names are not — never hardcode "Earth"

**Rule.** Since the Starmap (contract revision 2026-07-05, recorded in ARCHITECTURE.md
"The active system"), the game can swap the whole solar system for a seeded generated one.
Across EVERY system: the star is always keyed `"sun"`, the launchable homeworld is always
keyed `"earth"`, its guaranteed moon is always keyed `"moon"`. Display names differ —
`BODIES.earth.name` might be "Hyven". Code keys off roles (`BODIES.earth`, `key === "moon"`);
UI text reads `.name`. state.js:100-105 states it: "keys are stable roles, not names."

**Why.** Every mechanic (pad placement, TWR reference, transfer tutorial, "fly home",
teleports, satellites) was written against Sol before generated systems existed. Stable role
keys let all of it work unchanged in any generated system — that is the entire trick that
made the Starmap a one-evening feature instead of a rewrite.

**If you violate it.** Hardcode the string "Earth" and a kid orbiting "Hyven" sees the wrong
planet named — immediately visible, and it breaks the fiction the pedagogy depends on.
Key logic off a display name and it silently no-ops in generated systems.

### I4. `setSystem` swaps BODIES **in place**; `SYSTEM.rev` invalidates caches

**Rule.** `state.setSystem(catalog, planetKeys, meta)` (js/state.js:134) does NOT reassign
`BODIES`/`PLANET_KEYS`/`STATIONS` — it empties and refills them, preserving object/array
identity so every module's existing `import { BODIES }` binding keeps working. Each swap
bumps `SYSTEM.rev` (state.js:144); anything cached that derives from the catalog must be
keyed on `rev` — physics does exactly this for its hot body-key list
(js/physics.js:48, `if (_allKeysRev !== SYSTEM.rev)`). `returnToSol()` (state.js:147)
restores a pristine deep-copied Sol snapshot (state.js:131) — byte-identical every time,
no accumulation of mutations.

**Why.** ES module bindings are live but references captured into locals are not; in-place
mutation is the only way a swap reaches every consumer without an event system. The `rev`
counter exists because in-place swap makes stale caches *invisible* — same object, new
contents — so caches must opt in to noticing.

**If you violate it.** Reassign instead of mutate → modules holding the old object keep
simulating the old system (planets in two systems at once). Cache off BODIES without keying
on `rev` → after a Starmap jump your feature uses the previous system's bodies; classic
symptom is correct behavior in Sol, garbage after the first jump. Also: a system swap is
only complete after the full dance in `main.js arriveInSystem()` (main.js:458):
`Render.rebuildWorld()` + `UI.rebuildTargets()` + fresh `newSimState(BODIES.earth)`. Call
`setSystem` without that dance and you get stale meshes/targets over new physics.

### I5. The scaled universe: ×0.1 sizes, REAL gravity, teach both numbers

**Rule.** `SCALE = 0.1` (js/state.js:13). Every radius, orbit distance, and atmosphere
height is multiplied by SCALE; every surface gravity `g0` stays REAL; `mu = g0 · r²` is
derived from the scaled radius (buildCatalog, state.js:62). Geometry stays proportionally
faithful (Mars is still 1.52× Earth's solar distance). Side effect: orbital periods scale
by √SCALE, so the system runs ~√10 ≈ 3.2× faster (a Mars trip ≈ 82 game-days vs the real
~8.5 months). This is **owner frozen rule 3**: physics stays real, SCALE=0.1 is the one
documented lie, and the game must always teach the game number AND the real number.

**Why.** Real-scale space is brutal for a first orbit (~9,400 m/s to real LEO); scaling
radii while keeping surface gravity real keeps launches, landings, and TWR intuition honest
while shrinking Δv budgets to kid-achievable. Deriving `mu` from `g0·r²` (rather than
scaling mass) is what makes "standing on the surface feels real" true by construction.

**If you violate it.** Hardcode a real-world constant (a real mu, a real orbital radius)
anywhere outside `state.js` and it will disagree with the scaled world by 10×–1000×
depending on the quantity. `buildCatalog(defs, order, scale?)` is THE one mu/omega/SOI
builder — Sol and stargen both use it; a second implementation is guaranteed drift.
All body data lives in `BODIES`; never hardcode body constants elsewhere (ARCHITECTURE.md
"Values live in state.js BODIES").

### I6. Readouts are dominant-body-relative, everywhere

**Rule.** Altitude, speed, prograde, and the orbit ellipse are measured against the
dominant body, not raw world values. Parked on the Moon must read 0 m/s.

**Why (incident).** Raw `craft.vel` is dominated by the homeworld's ~21 km/s (scaled) solar
orbital velocity; early Phase-4 readouts used raw values and gave wrong guidance — fixed as
a QA item recorded in HANDOFF.md ("speed/prograde/altitude readouts are now measured vs the
dominant body").

**If you violate it.** Any new readout/guidance that uses `sim.craft.vel` directly shows
~21,000 m/s while sitting on the pad. Always subtract the dominant body's state
(`dominantBody(...).vel`) first.

### I7. Frozen module API surfaces

ARCHITECTURE.md marks these "frozen — build to these exactly". Semantics in one line each
(full signatures and shapes in ARCHITECTURE.md — read it, it is short and current):

| Surface | One-line semantics |
|---|---|
| `Physics.step(sim, dt)` | Advance craft under superposed gravity + thrust + local drag; adaptive substeps; sets `sim.warpLimited` when capped; handles all collisions |
| `Physics.maxStableStep(sim)` | The substep bound step() will use (dynamics / anti-tunneling / thrust limits) |
| `Physics.computeOrbit(sim)` | Conic about the DOMINANT body → `SimState.orbit` shape |
| `Physics.applyStage(sim, craft)` | Drop spent stage, recompute mass/fuel for the new stage |
| `Physics.transferWindow(sim, key?)` | Hohmann departure phasing → `TransferWindow` or null |
| `Physics.courseCorrection(sim, key?)` | Kepler-propagated closest-pass prediction + correction burn → `CourseCheck` or null |
| `Physics.parkingOrbit(key, t?)` | Circular CCW orbit just above a body (formation point for tinyMoons); backs ✨ Teleport |
| `Physics.makeSatellite(sim)` / `satellitePos(sat, t)` | Freeze the current conic as a satellite / propagate it for display |
| `Render.init / rebuildWorld / buildCraftMesh / setMode / update / highlightSnap / screenToBuildIntent` | ALL Three.js lives behind these; no other module touches Three |
| `Builder.init({craft, partsCatalog, onChange}) / show / hide` | Constrained vertical-stack builder; mutates the SHARED craft in place |
| mods.js: `PARTS`, `mergeCatalog`, `validatePartDef`, `parsePartJSON`, `setOverride`, `addCustom`, `applyMods`, ... | THE merged live catalog; consumers import `PARTS` from **mods.js**, never parts.js |

Physics is **pure — no DOM, no Three.js** — that purity is what makes it node-testable and
is itself an invariant. `parts.js` on disk stays pristine: it is the kid's worked example
for the modding ladder (mods overlay it; they never edit it).

Changing any of these signatures/shapes requires updating ARCHITECTURE.md in the same
change — see `space-sim-change-control` for the process. Do not treat "frozen" as "never
extend": the Starmap added `Render.rebuildWorld()` *as a recorded contract revision*.

### I8. Shared data shapes live in state.js and are defined in ARCHITECTURE.md

The canonical field-by-field definitions are in ARCHITECTURE.md (do not trust memory —
several shapes gained fields in Phase 4/5). Map of what/where:

| Shape | What it is | Producer → consumers |
|---|---|---|
| `PartDef` | One catalog part (id, type, masses, thrust, ve, geometry) | parts.js + mods → builder, render, computeStats |
| `Craft` | `{ name, parts: [PartInstance] }`, bottom→top stack order | builder mutates → physics/render read |
| `Stats` | `{ totalMass, dryMass, fuelMass, thrust, twr, deltaV, stageCount }` | `computeStats` (state.js:223) → UI, Navigator |
| `SimState` | The live flight state (craft, orbit, soi, target, heat, warp, satellites, ...) | physics writes → render/ui/copilot read |
| `TransferWindow` | Departure-burn phasing (`open, degToGo, burnPos, dir, ...`) | Physics.transferWindow → HUD gold Burn marker, Navigator |
| `CourseCheck` | Mid-course closest-pass + correction (`miss, onTarget, burnVec, ...`) | Physics.courseCorrection → gold arrow, Navigator |
| `BodyDef` | One BODIES entry (`radius, mu, g0, solid, atmosphere, parent, orbitRadius, omega, phase0, soiRadius`) | buildCatalog → everyone |
| `SatRec` | A conic frozen at satellite release | Physics.makeSatellite → main.js (owns array + localStorage) |

Guidance philosophy baked into two of these (HANDOFF.md "Key decisions"): **window for the
departure, course-correction for the arrival** — do not try to make `transferWindow` precise
enough to skip corrections; corrections ARE the lesson.

---

## Known weak points — stated plainly (documented limits, not bugs)

Do not "fix" these casually; each is a deliberate trade with dependencies. Anything here is
an *open/candidate* area — see `space-sim-frontier` before attacking one.

1. **Orbits are circular and CCW-only.** `bodyStateAt` supports nothing else; Triton was
   skipped from the catalog for being retrograde (comment at js/state.js:36), and Pluto's
   real eccentric/inclined orbit is circularized (state.js:47-50 — the Navigator teaches the
   real shape). `transferWindow`/`courseCorrection` also assume CCW travel (physics.js:491).
   Adding eccentric/retrograde body orbits touches state, physics guidance, AND render rings.
2. **Physics is planar — no inclination.** Everything lives in one orbital plane; render
   lifts `(x,y)` to `(x,y,0)`. Plane-change burns, polar orbits, and 3D rendezvous cannot
   be represented without a coordinated contract revision.
3. **The 3.2× time-compression side effect** of SCALE=0.1 (see I5). Not tunable
   independently of SCALE; any "real-scale toggle" needs a part Δv retuning pass first
   (HANDOFF.md next-steps item 5 — still open as of 2026-07-06).
4. **Browser-direct Anthropic API key.** copilot.js calls `api.anthropic.com` straight from
   the browser with a key in localStorage (`spacesim_anthropic_key`, copilot.js:16). Fine
   for one family's own key on their own machines; **a server proxy is required before any
   real hosting** (copilot.js:9 says so; so does HANDOFF.md). Details and the frozen
   kid-safety rules: `space-sim-navigator-and-safety`.
5. **Warp cap vs substep cap.** Warp tiers (main.js:23 `WARPS`) top at **2,000,000×**, but
   `Physics.step` caps substeps at `MAX_SUBSTEPS = 5000` per call (physics.js:185). When
   requested warp × frame-dt needs more substeps than that, physics integrates less sim
   time than asked and sets `sim.warpLimited = true` (physics.js:192); the UI shows the warp
   as physics-limited "instead of lying". So near a planet at high warp, *effective* warp is
   lower than the displayed tier — this is by design, not a bug. NOTE — doc drift, verified
   2026-07-06: ARCHITECTURE.md:90 and parts of HANDOFF.md still say warp "tiers to
   500,000×"; the code's top tier is 2,000,000 (main.js:23). Trust the code; flag the docs.

---

## Checklist before you change anything contract-adjacent

- [ ] Does the change alter a shape or API in ARCHITECTURE.md? Then ARCHITECTURE.md must be
      updated in the same change, and `space-sim-change-control` governs the process.
- [ ] New world-positioned scene object in render.js? Subtracted `ORIGIN` in float64 first? (I2)
- [ ] Any body constant typed as a literal outside state.js? Move it to BODIES / read it. (I5)
- [ ] Any string "Earth"/"Sun"/"Moon" shown to the user? Read `.name` instead. (I3)
- [ ] Any new cache derived from BODIES/PLANET_KEYS? Key it on `SYSTEM.rev`. (I4)
- [ ] Any new speed/altitude/direction readout? Dominant-body-relative. (I6)
- [ ] Physics change? Still pure (no DOM/Three), still passes `node tests/<suite>.mjs` × 8.
- [ ] Touching localStorage shapes or share codes? Owner frozen rule 2 (never break saves) —
      see `space-sim-constants-and-storage` for schemas and migration doctrine.
- [ ] Run the drift check: `bash .claude/skills/space-sim-architecture-contract/scripts/check-invariants.sh --tests`

---

## Provenance and maintenance

All claims verified 2026-07-06 against the working tree (all 8 suites green, 171 checks).
Line numbers WILL drift — the grep is the durable pointer, the line number is a hint.

| Claim | Re-verify with |
|---|---|
| SCALE constant | `grep -n 'const SCALE' js/state.js` (state.js:13) |
| mu = g0·r² rule | `grep -n 'g0 \* radius \* radius' js/state.js` (state.js:62) |
| Superposed gravity, SOI display-only | `grep -n 'SUPERPOSED\|superposition' js/physics.js js/state.js` |
| Patched conics rejected (history) | `grep -n 'reference-frame switch' space-game-design.md` (line 41) |
| ORIGIN only in render.js | `grep -ln ORIGIN js/*.js` → must print only render.js |
| Role-key doctrine | `grep -n 'stable roles, not names' js/state.js` (state.js:105) |
| setSystem in-place + rev | `grep -n 'SYSTEM.rev++' js/state.js` (state.js:144) |
| Physics cache keyed on rev | `grep -n '_allKeysRev' js/physics.js` (physics.js:48) |
| returnToSol pristine snapshot | `grep -n 'SOL_SNAPSHOT' js/state.js` (state.js:131,148) |
| Post-swap dance | `grep -n -A4 'function arriveInSystem' js/main.js` (main.js:458) |
| Warp top tier / doc drift | `grep -n 'WARPS =' js/main.js` (main.js:23) vs `grep -n '500,000' ARCHITECTURE.md` |
| Substep cap + warpLimited | `grep -n 'MAX_SUBSTEPS\|warpLimited' js/physics.js` (physics.js:185-192) |
| Triton/CCW-only limit | `grep -n 'Triton' js/state.js HANDOFF.md` (state.js:36) |
| Navigator model + key storage | `grep -n 'const MODEL\|LS_KEY' js/copilot.js` (copilot.js:15-16) |
| Frozen API surfaces & shapes | Read ARCHITECTURE.md — it is the contract of record; if it and this skill disagree, ARCHITECTURE.md + code win, then fix this skill |
| Everything at once | `bash .claude/skills/space-sim-architecture-contract/scripts/check-invariants.sh --tests` |
