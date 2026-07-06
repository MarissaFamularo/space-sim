---
name: space-sim-failure-archaeology
description: >
  The chronicle of every settled battle in the space-sim repo: symptom, root cause,
  evidence (commit + HANDOFF.md section), status. Load this BEFORE debugging anything that
  smells familiar — landings triggering early/late or underground, things floating above
  the surface, planets rendering black, washed-out/overexposed bodies, parts glowing like
  lamps, z-fighting halos or shattered-glass map dots, the follow-cam losing the rocket,
  docking that won't engage, stations drifting or teleports arriving far away, galaxy-map
  stars not appearing, generated-system moons escaping, sky-crane staging failures, tests
  that only run on one machine, or doc/code number mismatches. Also load it before
  RE-LITIGATING a design decision (patched conics, Triton, Phobos orbits, real-scale
  toggle) — most were settled deliberately. Keywords: bug history, regression, already
  fixed, gotcha, post-mortem, why is it like this, known issue, doc drift.
---

# Space Sim Failure Archaeology

This is the project's war record: every settled battle, one entry each, in the format
**SYMPTOM → ROOT CAUSE → EVIDENCE → STATUS**. Its purpose is negative knowledge — before
you "fix" something or "improve" a weird-looking decision, check whether that ground was
already fought over. Several fixes below look like bugs at first glance (SOI clamps,
tilt caps, tolerance guards); undoing them re-opens a battle.

All facts verified against the repo on **2026-07-06**. All 8 test suites green on that
date (171 checks: chute 5, mods 37, phase5 22, planets 31, reentry 8, stargen 28,
teleport 26, transfer 14 — run `node tests/<name>_test.mjs` from repo root).

## When NOT to use this skill

| You want | Use instead |
|---|---|
| Live triage of a NEW symptom (decision tree, not history) | `space-sim-debugging-playbook` |
| The invariants/contracts these battles produced, stated as rules | `space-sim-architecture-contract` |
| The change-gating rules and the owner's three frozen rules in full | `space-sim-change-control` |
| Current constant values and localStorage schemas | `space-sim-constants-and-storage` |
| How to run/extend the test suites that caught several of these | `space-sim-testing-and-qa` |
| Serving the game / dev environment setup | `space-sim-dev-loop` |
| The Δv/fuel balance problem (live, NOT settled — deliberately absent below) | `space-sim-delta-v-campaign` |

## How to read the evidence

- **History is linear: 20 commits on `main`, no branches, no reverts.** Every failure was
  fixed FORWARD. Evidence is commit *messages* (unusually detailed — they narrate root
  causes) plus HANDOFF.md prose, never revert commits. `git log --stat` is your friend.
- **The first commit (`028e0ed`, 2026-07-03) contains ALL of Phases 1–4.** Battles fought
  before 2026-07-03 have no individual commit; their only evidence is HANDOFF.md (its
  "Gotchas already fixed" section) and this file. Don't conclude "no commit = didn't
  happen."
- HANDOFF.md has few markdown headings; "HANDOFF: '<phrase>'" below means grep for that
  phrase: `grep -n "<phrase>" HANDOFF.md`.
- Statuses: **FIXED** (done, may regress silently), **GUARDED** (a test or structural
  change makes regression loud), **OPEN** (documented, deliberately not fixed yet).

---

## Physics and simulation battles

### 1. Integrator collision sweep used stale body positions
- **SYMPTOM:** Touchdown detected up to ~500 m early or late; a soft landing could read
  as "still flying" half a kilometer underground, depending on landing-site geometry
  (worst when the site is radially aligned with the body's motion). Surfaced by the
  landing-legs test, not by play.
- **ROOT CAUSE:** The adaptive integrator's collision sweep compared the craft's
  POST-substep position against START-of-substep body positions. Bodies move (Earth does
  ~21 km/s around the Sun), so the error is ~|v_body|·h per substep.
- **FIX:** Body states refresh post-integration, before the sweep (physics.js).
- **EVIDENCE:** commit `0ae8933` (message: "Integrator fix the legs test exposed");
  HANDOFF: "INTEGRATOR BUG FIX found by the legs test".
- **STATUS:** GUARDED — `tests/phase5_test.mjs` landing checks plus all prior suites.
- **LESSON:** In a moving-bodies world, any comparison between craft state and body state
  must pin BOTH to the same instant. (Battle #8 below is the render-side twin of this.)

### 2. Generated-system moons placed outside their home's SOI
- **SYMPTOM:** In seeded star systems (stargen.js), the homeworld's moon could escape —
  not actually bound to its planet.
- **ROOT CAUSE:** Moon distance was hardcoded "60 radii, like ours." A red-dwarf home's
  SOI (SOI = sphere of influence, the region where the planet's gravity dominates the
  star's) is much smaller than Earth's; 60 radii landed outside it.
- **FIX:** Moon placed at 35–55% of the home's ACTUAL computed SOI.
- **EVIDENCE:** commit `1f3fea9` (message names the bug); HANDOFF: "a red-dwarf home's
  SOI is small".
- **STATUS:** GUARDED — `tests/stargen_test.mjs` runs flyability property tests across
  250 seeds; this bug was caught by those tests before shipping.
- **LESSON:** For generated content, property tests over many seeds catch what any single
  hand-checked example misses. Never hardcode Sol-derived ratios into the generator.

### 3. Sky crane "had no engine and no rope" (the kid's exact bug report)
- **SYMPTOM:** The natural kid build for a Mars sky-crane — rover / decoupler / crane /
  tank / pod — failed at launch with NO ENGINE. Also no visible connection between crane
  and rover.
- **ROOT CAUSE:** The staging rule made the bottom rover its own engineless, fuel-less
  stage 0.
- **FIX:** `builder.js` `reflowStages`: rover(s) at the very bottom are CARGO, and a
  decoupler directly above them is the release latch, NOT a stage split. Render: the
  rover visibly hangs on a three-rope bridle below the crane (render.js
  gapBefore/ROPE_GAP in buildCraftMesh), like the real MSL landing. Follow-up: sky-crane
  thrusters carry their own fuel (`f65eedf` — the real one did too).
- **EVIDENCE:** commit `e2e626d` (quotes the kid's report verbatim); HANDOFF: "Sky crane
  \"had no engine and no rope\"".
- **STATUS:** FIXED. Touching `reflowStages` risks re-breaking the kid's most natural
  build order — retest the rover/decoupler/crane/tank/pod stack specifically.

### 4. Docking never engaged from a stable orbit
- **SYMPTOM:** A perfect rendezvous with a station did nothing — no docking, no message.
- **ROOT CAUSE:** Docking/station proximity logic only ran when `sim.status === "flying"`.
  Physics promotes a stable trajectory to `status === "orbit"` — which is exactly where
  stations live — so the common case was excluded.
- **FIX:** Guard is now `flying || orbit` (main.js:882 as of 2026-07-06).
- **EVIDENCE:** commit `f61057d` ("Bugfix: docking only engaged in status 'flying'");
  HANDOFF: "BUGFIX found by test: docking/station proximity".
- **STATUS:** FIXED. Any NEW proximity feature must copy the two-status guard; grep
  main.js for `sim.status === "flying"` alone before shipping one.

### 5. Station teleport arrived "very far away"; stations drifted at time-warp
- **SYMPTOM:** Kid's play-test report: teleport to a station "teleports you very far away
  from it." Separately, at high time-warp the drawn station lagged the craft by hundreds
  of meters to kilometers.
- **ROOT CAUSE (two, both real):** (a) Frame-order skew: station positions were computed
  BEFORE the physics step each frame, so the drawn station lagged the craft by one step —
  magnified enormously by warp. (b) Teleport dropped you 250 m off the port of a small
  station, which visually read as empty space.
- **FIX:** Stations update AFTER physics, pinned to the same instant; teleport arrives
  35 m off the port and the latch engages next frame (arrive already DOCKED, refueled);
  stations scaled 3.5× so they read as structures.
- **EVIDENCE:** commit `bfe363b` (quotes the report); HANDOFF: "Frame-order skew".
- **STATUS:** FIXED. Same lesson as battle #1, render-side: everything drawn in one frame
  must be sampled at one sim instant.

## Rendering and graphics battles

### 6. Landed craft "floated" above the ground (his Ganymede report)
- **SYMPTOM:** Kid reported the ship hovering above Ganymede's surface after landing.
- **ROOT CAUSE (two, stacked):** (a) Body spheres are 48×32-segment meshes — the drawn
  surface sags up to ~R/470 below the true radius between vertices (~560 m on Ganymede),
  while physics, rocks, and the Connie sit AT the true radius. (b) The craft mesh was
  rendered CENTERED on the physics point, which is really the craft's BASE.
- **FIX:** A finely-tessellated ground-patch cap under the craft (render.js
  `ensureGroundPatch`, shown < 25 km over solid ground, own dusty texture; ~1–3 m
  accuracy) + craft mesh renders base-at-point.
- **EVIDENCE:** commit `0d9e748`; HANDOFF: "Landed things \"floated\"".
- **STATUS:** FIXED. **Do NOT "re-fix" this by cranking sphere segments** — it would take
  1000+ segments per body. The ground patch IS the fix.

### 7. Follow-cam lost the rocket right after launch
- **SYMPTOM:** First public play-test bug: seconds after liftoff the rocket slid off the
  top of the frame, with no way to zoom.
- **ROOT CAUSE:** The camera's deliberate tilt-toward-the-planet (itself a fix — an
  untilted camera shows only stars from a few planet-radii up) was uncapped and pushed
  the craft out of frame.
- **FIX:** Tilt capped at 0.4× camera distance (rocket stays within ~18° of the view
  axis); scroll//+/− zoom added to follow view (0.4×–50,000×); every launch resets to
  rocket-framed.
- **EVIDENCE:** commit `fa48cbf`; HANDOFF gotcha: "Follow-cam must tip toward the local
  world".
- **STATUS:** FIXED. The tilt and the cap are BOTH load-bearing; removing either
  re-opens one of two battles.

### 8. Galaxy-map stars invisible/unclickable: strict z>1 rejected every dot
- **SYMPTOM:** Visited-system stars on the zoomed-out map: none appeared / none passed
  the behind-camera test, despite being in front of the camera.
- **ROOT CAUSE:** With a 5e12 far plane, visible dots project to NDC z = 1 + 1e-13 (float
  noise), so a strict `z > 1` "behind camera" guard rejected every star.
- **FIX:** Tolerant guard. Debug hook `window.__galaxyDebug` deliberately left in for
  automated tests.
- **EVIDENCE:** commit `3e7265e` ("Fixed a real picking bug").
- **STATUS:** FIXED. Any new projection-based culling in this scene must tolerate
  z ≈ 1 + epsilon; the camera range makes exact comparisons meaningless.

### 9. ACES pass overexposed the Moon into a featureless white ball
- **SYMPTOM:** After the HDR/bloom graphics pass, the Moon (and other bodies) washed out
  — maria and craters invisible.
- **ROOT CAUSE:** Lighting tuned for the old pipeline was too hot under ACES filmic tone
  mapping.
- **FIX:** Rebalanced: sun 2.0 / ambient 0.5 / hemi 0.45; part emissive floor 0.35→0.22;
  textured-planet emissive 0.16→0.10. Moon maria/crater contrast raised separately.
- **EVIDENCE:** `50dd072` era; HANDOFF: "Lighting rebalanced for ACES" — which states the
  standing rule: **if a body ever looks washed out, suspect these numbers, not the
  textures.**
- **STATUS:** FIXED (numbers are taste-fragile; there is no automated guard — verify with
  screenshots, see `space-sim-browser-verification`).

### 10. The gold probe "burned like a lamp"
- **SYMPTOM:** The probe core's gold MLI foil glowed with bloom as if it were a light
  source.
- **ROOT CAUSE:** Bloom threshold sits at exactly 1.0 (only super-white blooms — that's
  the design). Metalness ≳ 0.7 under the 2.0-intensity sun produces specular glints that
  cross that threshold.
- **FIX:** Foil metalness dropped to 0.45.
- **EVIDENCE:** `0295956` era; HANDOFF: "GOTCHA learned: metalness".
- **STATUS:** FIXED. Standing rule for ANY new shiny material: keep metalness < ~0.7 or
  expect it to bloom.

### 11. Earth's atmosphere halo z-fought the limb in ugly blocks
- **SYMPTOM:** At map zoom, Earth's additive atmosphere halo flickered/z-fought against
  the planet limb in coarse blocks the moment Earth got a real texture.
- **ROOT CAUSE:** One camera spanning near=1 to far=5e12 left the LINEAR depth buffer
  with ~500 km depth buckets at map range.
- **FIX:** Logarithmic depth buffer.
- **EVIDENCE:** commit `50dd072` ("Logarithmic depth buffer: kills the atmosphere-halo
  z-fighting"); HANDOFF: "LOGARITHMIC DEPTH BUFFER".
- **STATUS:** FIXED, with a live trap: **any custom ShaderMaterial must include three's
  logdepth shader chunks** or its depth won't match the scene. (This is why the planned
  fresnel atmosphere shader is flagged as tricky in HANDOFF.)

### 12. Planets rendered black-on-black
- **SYMPTOM:** A body renders pure black even though its material/texture is fine.
- **ROOT CAUSE:** A PointLight at astronomical distance gives ~zero illumination under
  three r160's physical falloff.
- **FIX:** Sunlight is a DirectionalLight re-AIMED from the Sun's scene position every
  frame, not a PointLight.
- **EVIDENCE:** Phase 1–4 era (inside `028e0ed`, no individual commit); HANDOFF gotcha:
  "PointLight at astronomical distance".
- **STATUS:** FIXED. If a body ever renders black, **check the light, not the mesh.**

### 13. Map dots z-fought textured spheres as "shattered glass"
- **SYMPTOM:** Zooming the map close to a planet showed a shattered-glass flicker.
- **ROOT CAUSE:** The flat map "dot" was drawn AT body scale when zoomed close, coplanar
  with the textured sphere.
- **FIX:** Dots hide once the true sphere is that big on screen.
- **EVIDENCE:** commit `0ae8933`; HANDOFF: "MAP-VIEW GOTCHA".
- **STATUS:** FIXED.

## Tooling and test-infrastructure battles

### 14. reentry_test.mjs only ran on the owner's Mac
- **SYMPTOM:** `node tests/reentry_test.mjs` failed anywhere but the owner's machine.
- **ROOT CAUSE:** The test hardcoded an absolute `/Users/marissafamularo/...` import path.
- **FIX:** Relative imports. Fixed in commit `50dd072` ("reentry_test.mjs: relative
  imports instead of a hardcoded Mac path").
- **STATUS:** FIXED. Standing rule: tests import via relative paths, always. Verified
  2026-07-06: all 8 suites run green from a clean Linux checkout.

### 15. server.py hardcodes the owner's Mac path — STILL OPEN
- **SYMPTOM:** README.md line 10 says `python3 server.py`; on any machine but the
  owner's Mac it dies immediately.
- **ROOT CAUSE:** `server.py:8` hardcodes
  `ROOT = "/Users/marissafamularo/Desktop/CoworkProjects/Kids Games/space-sim"` and
  `os.chdir(ROOT)`. This is deliberate FOR HER (it dodges a sandbox-cwd issue and binds
  0.0.0.0 so the kid's devices on the same Wi-Fi can reach it) — it was never meant to be
  portable.
- **WORKAROUND (the real instruction):** `python3 -m http.server 8000` from repo root.
- **EVIDENCE:** server.py:8 and README.md:10, both verified 2026-07-06.
- **STATUS:** OPEN (documented trap, as of 2026-07-06). Do not "fix" server.py without
  the owner — it is HER launcher, tuned to her machine. See `space-sim-dev-loop`.

### 16. Doc drift: warp tiers and test counts
- **SYMPTOM:** Docs disagree with code on the top time-warp tier and the test count.
- **FACTS (verified 2026-07-06):** `main.js:23` —
  `const WARPS = [1, 5, 25, 100, 1000, 10000, 100000, 500000, 2000000]` (top tier
  2,000,000×, added for Pluto runs). But HANDOFF.md:38, ARCHITECTURE.md:90, and
  space-game-design.md:187 all still say **500,000×**. HANDOFF's test-count line
  ("all green, 141 total") also lags: actual is 171 checks across 8 suites.
- **ROOT CAUSE:** Fast-moving sessions updated code without a doc sweep.
- **STATUS:** OPEN as of 2026-07-06. Rule of thumb this drift teaches: **for any number,
  code wins; docs are testimony.** Doc-maintenance procedure belongs to
  `space-sim-pedagogy-and-content`; drift-check commands for constants belong to
  `space-sim-constants-and-storage`.

## Settled DESIGN battles (decisions, not bugs — don't re-litigate casually)

| Decision | What was rejected / avoided | Why | Evidence |
|---|---|---|---|
| **Superposed gravity, every body every step** | Patched conics as the physics model (it was the original Phase-1 plan) | More real; no risky reference-frame switch. Patched-conic SOI survives as a DISPLAY concept only (`dominantBody` picks what readouts/map ellipses are drawn around). | space-game-design.md:41 ("Updated in Phase 2 (was patched conics)") |
| **Phobos/Deimos display-SOI clamped to 2× radius** (`tinyMoon: true`, state.js) | Honest SOI readouts for them | Their TRUE SOI is smaller than their own radius — you physically cannot orbit them (real!). The clamp exists purely so surface readouts measure from them; `parkingOrbit` gives a FORMATION 5 radii off in matching Mars orbit, like real Phobos missions. | commit `0ae8933`; HANDOFF: "Phobos & Deimos"; state.js `tinyMoon` |
| **Triton skipped entirely** | Adding Neptune's big moon | Triton orbits retrograde; this engine's orbits are CCW-only. Shipping it would require either a lying orbit or engine surgery. | state.js:36 comment; HANDOFF: "Triton skipped" |
| **Real-scale toggle disabled** | Flipping `SCALE` to 1.0 (state.js:13, `SCALE = 0.1`) | Real scale needs ~9,400 m/s to LEO; stock parts aren't tuned for it — flipping now makes the game unwinnable. The 0.1 scale is the owner's ONE permitted physics lie (frozen rule 3: teach both numbers). | HANDOFF "Not done yet" item 5; state.js comment "Flip SCALE to 1 ... later" |
| **Window for departure, correction for arrival** | Making transfer windows exact enough to skip mid-course corrections | Corrections ARE the lesson (the Apollo 13 move). | HANDOFF "Key decisions" |
| **Aliens never in Sol** | Sprinkling aliens everywhere | The real solar system stays honest; the Navigator teaches "no alien life found YET, and looking is real science." | commit `f61057d`; HANDOFF: "never in Sol" |

Design rationale in depth and the invariants these imply: `space-sim-architecture-contract`.
The owner's frozen rules and change gating: `space-sim-change-control`.

## Meta-lessons the record teaches

1. **The kid is the best test harness.** Battles #3, #5, #6, #7 were all found by his
   play-test reports, and his reports are precise ("no engine and no rope", "teleports
   you very far away"). Take them literally; they usually name the root cause.
2. **Two of the nastiest bugs were time-skew twins** (#1 physics-side, #5 render-side):
   comparing state sampled at different instants in a world where everything moves.
   Any new proximity/collision/drawing code: pin all inputs to one sim instant.
3. **Property tests over seeds beat examples** (#2): 250 random seeds caught what a
   demo-seed check never would. Extend `tests/stargen_test.mjs`, don't bypass it.
4. **Astronomical camera ranges break naive float comparisons** (#8, #11): with far
   planes at 5e12, both depth buffers and NDC tests need log-depth / epsilon tolerance.
5. **No reverts, ever, in 20 commits:** the culture is fix-forward with a narrating
   commit message. When you fix a battle, write the commit message so it can be a future
   entry here (symptom, cause, fix — `bfe363b` and `e2e626d` are the models).

## Provenance and maintenance

Everything above was verified 2026-07-06 against the working tree and `git log`. This
skill owns the HISTORY; siblings own the living rules. Re-verify before trusting:

```bash
cd /home/user/space-sim
git log --oneline                       # still linear, still 20+ commits, no reverts?
git log --format='%B' -1 0ae8933        # battle #1 evidence (and same pattern for any hash above)
for t in chute mods phase5 planets reentry stargen teleport transfer; do node tests/${t}_test.mjs | tail -1; done   # all "0 failed"?
sed -n '23p' js/main.js                 # WARPS top tier (drift entry #16)
grep -n '500,000' HANDOFF.md ARCHITECTURE.md space-game-design.md   # doc drift still open?
sed -n '8p' server.py                   # Mac ROOT still hardcoded? (open trap #15)
sed -n '13p' js/state.js                # SCALE still 0.1?
grep -n 'sim.status === "flying" || sim.status === "orbit"' js/main.js  # docking guard intact (battle #4)
grep -n 'tinyMoon' js/state.js          # Phobos/Deimos clamp intact
grep -n 'Triton' js/state.js HANDOFF.md # Triton still deliberately skipped
```

If a new battle gets fought and settled after 2026-07-06, ADD an entry here in the same
SYMPTOM → ROOT CAUSE → EVIDENCE → STATUS format, citing the commit hash and the HANDOFF
phrase. If an OPEN item above gets closed (server.py, doc drift), flip its status and
date-stamp the change.
