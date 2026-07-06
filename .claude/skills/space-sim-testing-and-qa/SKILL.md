---
name: space-sim-testing-and-qa
description: >
  Run, read, and extend the Space Sim node test suites (tests/*.mjs). Load this skill when you
  need to: verify the repo is green before/after a change; understand what chute, mods, phase5,
  planets, reentry, stargen, teleport, or transfer prove; add a test for a new physics/state/mods/
  stargen feature; decide whether something is node-testable at all; write a property test for a
  seeded/procedural feature; interpret a FAIL line or a drift/tolerance number; or answer "what
  counts as evidence that this works?". Keywords: node tests, test suite, PASS/FAIL, regression,
  property test, seeds, tolerance, drift, mission test, evidence ladder, QA.
---

# Space Sim: Testing and QA

The test system is 8 plain-node scripts in `tests/`. No framework, no package.json, no runner
config — each file is a `.mjs` script that imports game modules from `../js/`, prints one
`PASS`/`FAIL` line per check, prints a final count, and exits nonzero on any failure. That's the
whole system. This skill is the home for: what each suite proves, how to run and extend them,
the house test style, and what counts as evidence.

**When NOT to use this skill:**

| You actually need | Go to sibling skill |
|---|---|
| Testing render/UI/game-loop behavior (anything DOM/Three.js) | `space-sim-browser-verification` |
| The rules for what changes are allowed and how they're gated/recorded | `space-sim-change-control` |
| Why an invariant exists / what breaks if violated | `space-sim-architecture-contract` |
| A failure is happening and you're triaging it | `space-sim-debugging-playbook` |
| The orbital-mechanics math behind a test's expected numbers | `orbital-mechanics-reference` |
| Predicting a number from first principles before running | `space-sim-analysis-toolkit` |
| Serving the game / dev environment setup | `space-sim-dev-loop` |

## Run the tests

From the repo root (`/home/user/space-sim` in agent sessions — adjust to wherever the repo is):

```bash
# Run everything, stop at first failing suite (each suite exits 1 on any FAIL):
for t in tests/*.mjs; do node "$t" || break; done

# Run one suite:
node tests/transfer_test.mjs
```

- Tests use **relative import specifiers** (`../js/physics.js`), resolved relative to the test
  file — so `node /abs/path/tests/chute_test.mjs` works from **any** working directory. Verified.
- No server needed. No browser needed. No install step — there is nothing to install.
- All 8 suites green as of 2026-07-06 on node v22: **171 checks, 0 failures, ~7.5 s total.**
  (HANDOFF.md quotes older totals of 141 and 162 in places — known doc drift; trust the run.)

## The 8 suites

Check counts and runtimes measured 2026-07-06 (node v22.22.2; runtimes are rough, single run):

| Suite | Checks | Time | What it PROVES |
|---|---|---|---|
| `chute_test.mjs` | 5 | ~0.5 s | Parachute physics: 3 km drop lands softly with a chute, crashes without; chute never opens in vacuum; stays shut above 250 m/s and opens once drag slows you; is useless on the airless Moon (crashes, never opens). |
| `mods_test.mjs` | 37 | ~0.1 s | The whole mod-editor logic layer, pure: `mergeCatalog` (overrides flag `modified`, customs append, stock never mutated on disk shape, an override can't hijack another id), `validatePartDef` (rejects with friendly field-naming errors, **never clamps**), `parsePartJSON` (line-pointing friendly JSON errors), copy-as-mine unique ids, live PARTS roundtrip incl. `resetMods`, and **craft share codes**: export embeds custom parts; import on a modless "friend's game" reconstructs the stack + missing parts; garbage/unknown-id/empty codes rejected. |
| `phase5_test.mjs` | 22 | ~0.1 s | Landing legs raise survivable touchdown speed (4 m/s bare lands, 9 crashes bare but lands with legs, 16 crashes regardless); satellites (`makeSatellite`/`satellitePos`) freeze a conic and return to their start point after one period within 1%; escape trajectories can't become satellites; Phobos/Deimos `tinyMoon` clamp + "Phobos escape speed ≈ bike speed"; the 5 Phase-5 stock parts exist and validate; the sky crane packs enough Δv (rocket equation, >1400 m/s) to land itself + rover + probe on Mars. |
| `planets_test.mjs` | 31 | ~3.2 s | The Phase-4 solar system, as **mission stories**: body hierarchy + SOI dominance; the launchpad co-moves with an Earth that orbits the Sun; a **full solar orbit under 8000-s warp steps stays circular (<2% drift)**; absurd warp gets clamped + flagged, not silently wrong; the Mars transfer window and THE full mission (coast to window → prograde burn to Mars-distance apoapsis → arrive in Mars's SOI); the **Apollo-13-style rescue**: a deliberately 8°-early, overshooting burn is recovered by following `courseCorrection`'s gold arrow to on-target and still arrives; Mars sky-crane lesson (chute alone crashes in thin air, chute + engine lands); **Titan Huygens lesson** (chute alone lands softly); Jupiter dive never "lands" — you burn or sink (Galileo probe). |
| `reentry_test.mjs` | 8 | ~2.4 s | Heating + orbit orientation: LEO stays circular with zero heat in vacuum; periapsis direction is fixed in space; a shallow kid-plausible deorbit glows (heat > 0.15) but survives; a steep lunar-return-speed dive **burns up**; a launch ascent stays cool. |
| `stargen_test.mjs` | 28 | ~0.15 s | The star-system generator: determinism ("the name IS the code", case/space-insensitive); contract shape (role keys `sun`/`earth`/`moon`, required fields); **property tests over 250 seeds** (see below); black-hole systems incl. surprise rate over 400 seeds; galaxy positions; and the live-swap machinery: `setSystem` replaces BODIES in place, bumps `SYSTEM.rev`, `returnToSol()` restores Sol **exactly**. |
| `teleport_test.mjs` | 26 | ~0.5 s | `Physics.parkingOrbit` hands back a stable orbit around **every** pickable world at a non-epoch time (t=5000 "catches anything that assumed epoch positions"): placement above ground and atmosphere, circular speed, sunlit side, prograde nose, null for the Sun and unknown keys; then flies **one full integrated lap around each world**; tinyMoons (Phobos/Deimos) instead get formation flying that holds ~20 min without crashing. |
| `transfer_test.mjs` | 14 | ~0.5 s | `Physics.transferWindow` for the Moon: null on the pad / in retrograde orbit / once apoapsis is already high; sane fields from LEO (lead angle in the Apollo ~120° ballpark); window recurs once per synodic period; and THE mission proof: coast to the window, burn prograde at the indicated moment, cut at Moon-distance apoapsis, **actually enter the Moon's SOI**. |

Two habits visible in that table, both deliberate house culture:

1. **Mission tests over unit tests.** The strongest checks are end-to-end flown missions using
   only the public `Physics.step`/`transferWindow`/`courseCorrection` API — the same calls the
   game makes. A suite that flies to the Moon proves the window math, the integrator, SOI
   handoff, and the burn model all at once, in the exact composition the kid experiences.
2. **Tests encode the curriculum.** Titan-chute, Mars-sky-crane, Jupiter-no-surface,
   Phobos-bike-speed are the real-world lessons the game teaches (see
   `space-sim-pedagogy-and-content`). If a physics change breaks a lesson, a test fails —
   that is the point.

## House test style (read one file before writing one)

Every suite follows the same skeleton. Copy it; don't invent a new shape:

```js
// One-line purpose comment. Run: node tests/<name>_test.mjs
import { Physics } from "../js/physics.js";
import { BODIES, newSimState, bodyStateAt } from "../js/state.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
};

// ... checks, grouped under // --- numbered section comments ---

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

Rules (all verifiable in the existing files):

- **Plain `.mjs`, no framework, no assertion library.** `check(name, boolean, detail)` is the
  entire API. The `detail` string carries the measured numbers so a failure is diagnosable from
  the log alone (`drift=1.0% ecc=0.000 period=77 min`).
- **Relative imports only** (`../js/...`). An absolute Mac path was once hardcoded in
  `reentry_test.mjs` and broke the suite on every other machine; the fix is memorialized in that
  file's header comment and in HANDOFF.md ("reentry_test.mjs now uses relative imports instead
  of a hardcoded Mac path, so it runs anywhere"). Never regress this.
- **Deterministic.** No `Math.random()` without a seed, no wall-clock, no network. The stargen
  suite's "random" seeds are fixed strings (`"prop-seed-" + i`).
- **Every loop has a step guard** (`steps < 400000`-style) so a physics regression hangs the
  suite for seconds, not forever.
- **Exit code is the contract:** `process.exit(fail ? 1 : 0)` — this is what makes the
  `|| break` one-liner and any future automation work.
- **World coordinates are heliocentric.** Tests that set up Earth-local scenarios offset by
  `bodyStateAt("earth", t)` (the `EW(t)` helper in chute/reentry/transfer). Forgetting this
  offset is the #1 way a new test fails mysteriously — you placed the craft 150 Gm from Earth.
- **Node-import safety:** `mods.js` guards every `localStorage` touch with
  `typeof localStorage !== "undefined"` + try/catch precisely so tests can import it. If your
  new feature code breaks node import of a tested module, that's a bug in the feature.

## Property testing: the house specialty for anything seeded

`stargen_test.mjs` is the pattern. Instead of checking one example system, it generates **250
seeded systems** and asserts invariants on every one (plus 400 more seeds for the black-hole
surprise rate — 25/400 roll one per HANDOFF; observed within the asserted 8–56 band):

- every home is launchable (solid, 7 ≤ g0 ≤ 11, chuteable air) — 250/250
- every tutorial moon sits well inside home's SOI — 250/250
- no adjacent planet SOIs overlap (patched conics stay sane) — 250/250
- every omega finite/positive; every moon between 2 radii and 0.6 SOI of its parent — 250/250

This pattern caught a real bug: the generator placed the home moon at a fixed "60 radii like
ours", which escaped a red dwarf's small SOI — an unflyable tutorial. (Documented in HANDOFF.md,
Starmap entry.) A single-example test would never have hit it.

**Reach for property tests whenever output space is bigger than you can eyeball:** any
procedural/seeded feature (star systems, procedural textures' data inputs, generated names),
any function whose domain is "every body in the catalog" (teleport does exactly this via
`PLANET_KEYS`), any parser fed arbitrary kid input (mods import). Recipe: loop seeds/keys,
assert the invariant on each, count successes, and `check` that count equals the total —
reporting `homesOk + "/" + total` so a failure tells you the hit rate immediately.

## Tolerance culture: thresholds encode truth, not convenience

Numbers asserted in the suites are physical claims. Before loosening one, understand what it
states; before tightening one, understand what real effect it must admit:

| Assertion | Threshold | Why that number |
|---|---|---|
| Full solar orbit at 8000-s warp steps (planets #4) | radius drift < 2% | Adaptive integrator quality bar at max meaningful step. |
| Satellite returns after one period (phase5 #2) | drift < 1% of r | Frozen Kepler conics are analytic — they should be nearly exact. |
| LEO circular orbit over one period (reentry #1) | alt drift < 1% | Integrator regression tripwire at 0.05-s steps. |
| Teleport full-lap altitude drift (teleport #2) | drift < 35% + still elliptical + still in-SOI | Loose **by design**: Io really drifts ~9.8% per lap (observed 2026-07-06) because Jupiter's tide is real physics in the n-body integrator — the test ACCEPTS it. Most worlds show ~1%. Tightening this to "a few %" would fail on truth. |
| Mars transfer time ≈ scaled Hohmann (planets #5) | within 2% of 7.07e6 s (~82 scaled days) | Analytic Hohmann prediction; see `orbital-mechanics-reference` for the scaled math. |
| Black-hole surprise rate (stargen) | 8–56 of 400 seeds | "a surprise, not a plague": bounds a probability, not a constant. |

The owner's frozen rule "physics stays REAL" (see `space-sim-change-control`) applies to tests
too: never widen a tolerance to make a physics change pass. If a threshold blocks you, either
the change is wrong or the threshold encodes an assumption that itself needs a reasoned,
recorded change.

## What is node-testable vs not

| Module | Node-testable? | Notes |
|---|---|---|
| `js/physics.js` | YES — pure | Integrator, `computeOrbit`, `transferWindow`, `courseCorrection`, `parkingOrbit`, satellites. ARCHITECTURE.md marks these "Pure, node-testable". |
| `js/state.js` | YES — pure | BODIES, `bodyStateAt`, `dominantBody`, `setSystem`/`returnToSol`, `computeStats`. |
| `js/stargen.js` | YES — pure | Seeded generator, `galaxyPos`. |
| `js/parts.js` | YES — pure data | Stock catalog (the kid's worked example — pristine, read-only). |
| `js/mods.js` | YES — guarded | Pure merge/validate/parse; localStorage wrapped in try/catch + `typeof` checks. |
| `js/render.js` | NO | All Three.js. → `space-sim-browser-verification`. |
| `js/ui.js`, `js/builder.js`, `js/main.js` | NO | DOM/game loop. → `space-sim-browser-verification`. |
| `js/copilot.js` | NO (and see safety rules) | Browser + Claude API. → `space-sim-navigator-and-safety`. |

If you're adding logic to a browser-only module, first ask whether the *logic* can live in a
pure module instead — that is why `mods.js` exists separately from the mod-editor UI, and it's
why 171 checks can run in 7 seconds with no browser.

## Adding a new suite (or extending one)

**The rule (house law, visible throughout HANDOFF.md's feature entries): new behavior lands WITH
its test.** Feature entries in HANDOFF cite their tests ("node-tested", "property-TESTED across
250 seeds", "found by test"); a feature without a cited test is not done.

Checklist:

1. **Extend before you create.** New parachute edge case → `chute_test.mjs`. New suite only for
   a genuinely new subsystem (that's why phase5/stargen/teleport exist as files).
2. **Name:** `tests/<subsystem>_test.mjs`. Location: `tests/`, **never** the scratchpad —
   HANDOFF is explicit: "put new tests in `tests/`, not scratchpad."
3. **Use the skeleton above** — header comment with run command, `check` helper, numbered
   section comments, final count, `process.exit(fail ? 1 : 0)`.
4. **Set up scenarios in heliocentric world coordinates** via `bodyStateAt(key, t)` offsets;
   prefer a non-zero start time somewhere to catch epoch-position assumptions (teleport's
   `t0 = 5000` trick).
5. **Predict the expected number before running** (Hohmann time, circular speed, rocket-equation
   Δv — the suites do this in comments; `space-sim-analysis-toolkit` is the method). A test whose
   expected value was copied from the sim's own output proves nothing.
6. **Choose tolerances that encode truth** (section above), and write the measured value into
   the `detail` string.
7. **Run the whole battery**, not just your suite: `for t in tests/*.mjs; do node "$t" || break; done`.
8. **Record it:** update HANDOFF.md's test tally and cite the test from the feature entry, per
   `space-sim-change-control` (that skill owns the recording rules; don't improvise).

## The evidence ladder

What "verified" means here, weakest to strongest — claim only the rung you actually stood on:

1. **Syntax:** `cp js/foo.js /tmp/foo.mjs && node --check /tmp/foo.mjs` (HANDOFF's recipe; the
   copy is needed because `--check` won't treat a bare `.js` as a module).
2. **Node suites green** — proves physics/state/mods/stargen logic. This skill's territory.
3. **Browser verification** — boot without console errors, scripted flight, screenshots. Proves
   render/UI integration. → `space-sim-browser-verification`.
4. **Owner play-test in a real browser** — proves it works on the actual machine/config.
5. **The kid** — the final gate. HANDOFF, verbatim: "the kid's reaction to Saturn is the real
   acceptance test." Agent-verified is explicitly labeled as the *lower* rung in HANDOFF's own
   status lines ("User browser play-test still pending — everything below is agent-verified").

Rungs 1–3 are yours to climb every time. Never report rung-2 evidence as if it covered rung 3
(the suites prove zero pixels), and never mark a feature "done" past rung 3 — the gates above it
belong to the owner. `space-sim-change-control` is the authority on what each change class
requires.

## Provenance and maintenance

Facts above verified directly against the repo on 2026-07-06 (node v22.22.2): all 8 suites read
in full, all executed green, one-liner and any-cwd execution tested. Check counts/runtimes are
from that run. The "fixed hardcoded Mac path" history is cited from reentry_test.mjs's header
comment and HANDOFF.md (the specific commit hash is not restated here — git was out of scope
for this verification).

Re-verify before trusting, one line each:

```bash
ls tests/                                                  # still exactly 8 *_test.mjs suites?
for t in tests/*.mjs; do node "$t" || break; done          # all green? final counts per suite
node tests/teleport_test.mjs | grep -i "io"                # Io tidal drift still ~10% and accepted?
grep -in "relative imports" tests/reentry_test.mjs         # portability fix still memorialized
grep -rn "localStorage" js/physics.js js/state.js js/stargen.js js/parts.js   # expect: no hits (still pure)
grep -n "tests/" HANDOFF.md | head                         # HANDOFF test tally (known to lag; trust the run)
```

If a suite count or threshold in this file disagrees with a fresh run, the run wins — update
this skill, and check whether HANDOFF.md needs the same correction (per `space-sim-change-control`).
