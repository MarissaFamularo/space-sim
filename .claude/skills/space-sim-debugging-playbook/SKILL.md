---
name: space-sim-debugging-playbook
description: >
  Symptom-to-triage playbook for debugging the Space Sim browser game
  (/home/user/space-sim). Load this when something is BROKEN or LOOKS WRONG and
  you need the fastest path to the cause: edits don't show up after saving, a
  planet renders black, z-fighting / shimmering / "shattered glass" artifacts,
  the craft floats above the ground, a rocket part glows like a lamp, a planet
  looks washed out, "NO ENGINE" on a valid-looking stack, speed/prograde/altitude
  readouts look wrong, map dots or galaxy stars are invisible, docking won't
  engage, an orbit drifts at high time-warp, a teleport orbit around Io drifts,
  a blank page on boot, or "Cannot find package 'three'" in node. Also load it
  BEFORE debugging anything here, to run the node-vs-browser triage fork first.
---

# Space Sim Debugging Playbook

Runbook for diagnosing failures in the Space Sim repo at `/home/user/space-sim`
(vanilla JS ES modules + vendored Three.js r160, no build step, no framework).
All file:line references verified 2026-07-06; each has a re-verification command
in "Provenance and maintenance" at the bottom.

**When NOT to use this skill:**

| Your task | Use instead |
|---|---|
| Understanding why the architecture is shaped this way / what invariants exist | `space-sim-architecture-contract` |
| The full history of a bug that was already fought and settled | `space-sim-failure-archaeology` |
| Setting up the dev environment, serving, deploying | `space-sim-dev-loop` |
| Driving the real game headlessly (boot checks, scripted flights, screenshots) | `space-sim-browser-verification` |
| Running/extending the node test suites as evidence | `space-sim-testing-and-qa` |
| Looking up a constant's value or a localStorage schema | `space-sim-constants-and-storage` |
| Orbital-mechanics math (why a transfer window is what it is) | `orbital-mechanics-reference` |
| Deciding whether a "bug fix" is even allowed (frozen rules, save compat) | `space-sim-change-control` |

This skill is for: *something misbehaves right now, find the cause fast.*

---

## Step 0 — The triage fork: can node reproduce it?

The single highest-leverage question. The codebase splits cleanly:

| Layer | Modules (`js/`) | Node-testable? |
|---|---|---|
| Pure simulation | `physics.js`, `state.js`, `mods.js`, `stargen.js`, `parts.js` | **Yes** — import directly, no DOM, no `three` |
| Browser glue | `ui.js`, `builder.js`, `copilot.js`, `connies.js` | Imports OK in node, but they touch the DOM when *called* — limited use |
| Browser-only | `render.js`, `main.js` | **No** — `import ... from "three"` is a bare specifier resolved by the import map in `index.html:37-39`. Plain node import fails with `Cannot find package 'three'`. That error is EXPECTED, not a bug. |

**If the symptom is a number** (orbit, Δv, fuel, transfer window, landing speed,
mod validation, generated system) → write a 10-line node repro before touching
the browser at all:

```bash
SCRATCH=${SCRATCH:-$(mktemp -d)}   # any writable scratch dir — never write repros into the repo
cat > "$SCRATCH/repro.mjs" <<'EOF'
import { Physics } from "/home/user/space-sim/js/physics.js";
import { BODIES, newSimState, bodyStateAt, dominantBody } from "/home/user/space-sim/js/state.js";
const sim = newSimState(BODIES.earth);
// ...set up the exact state that misbehaves, then:
// Physics.step(sim, dt);  console.log(sim.status, sim.altitude, sim.speed);
EOF
node "$SCRATCH/repro.mjs"
```

Use ABSOLUTE import paths as above if the repro lives outside the repo — ESM
relative specifiers resolve against the importing file, not your cwd (verified:
the absolute form runs from any directory). If you're adding a lasting test,
put it in `tests/` with `../js/...` imports like its siblings.
Steal setup code from `tests/*.mjs` — `tests/planets_test.mjs` is the
best template. If node reproduces it, you have a fast loop and a regression
test for free; if node says the physics is right, the bug is in
render/ui/main's *presentation* of it.

**If the symptom is visual or interactive** → it lives in `render.js` (3398
lines, all Three.js), `main.js` (game loop), or `builder.js`/`ui.js`. Use the
table below, and `space-sim-browser-verification` to drive the real game.

**Headless syntax check** for ANY module, including browser-only ones
(verified working — catches parse errors without a browser):

```bash
cp js/render.js "$SCRATCH/check.mjs" && node --check "$SCRATCH/check.mjs" && echo SYNTAX-OK
# the .mjs rename matters: node --check parses .mjs as an ES module
```

**Baseline before debugging anything:** run the suites. All 8 green
(171 checks) as of 2026-07-06:

```bash
cd /home/user/space-sim && for t in tests/*.mjs; do node "$t" | tail -1; done
```

---

## Symptom → cause → fix → verify

Line numbers as of 2026-07-06 (re-grep commands at the bottom).

### 1. Edits don't appear in the browser
- **Cause:** Chrome aggressively caches ES modules. A normal reload (Cmd-R)
  serves stale JS — HANDOFF.md:332 says it plainly: "you'll chase ghosts."
  This has bitten agents repeatedly.
- **Fix:** hard reload — **Cmd-Shift-R** (Mac) / Ctrl-Shift-R. Every time,
  after every edit.
- **Discriminate stale-cache vs real bug:** add a one-line
  `console.log("SENTINEL vN")` at the top of the edited file. If the sentinel
  doesn't print after reload, you're staring at cached code, not your bug.
  Remove the sentinel when done.

### 2. Blank / dead page on boot
- **Cause:** a module crashed before wiring the buttons.
- **Fix path:** `index.html` (~line 40) has a boot-failure reporter that shows
  a big readable error banner instead of a silent dead page. Read the banner
  first, then the browser console. If even the banner is absent, suspect the
  server (wrong root / not running) — see `space-sim-dev-loop`.
- **Trap:** `README.md` says `python3 server.py`, but `server.py:8` hardcodes
  `ROOT = "/Users/marissafamularo/..."` — it only works on the owner's Mac.
  Serve with `python3 -m http.server 8000` from the repo root instead.

### 3. A planet renders black (black-on-black)
- **Cause:** the light, not the mesh. Sunlight is a **DirectionalLight**
  (`render.js:567`, intensity 2.0) re-aimed every frame from the Sun's scene
  position toward the craft. A PointLight at astronomical distance renders
  planets black under three r160's physical falloff — that's the documented
  trap (comment at `render.js:562-566`, HANDOFF.md:402-404).
- **Fix:** check `sunLight` exists, is a DirectionalLight, and is being
  re-aimed in the frame update. Do not replace it with a PointLight.
- **Discriminate:** all bodies black → the light (or the composer chain);
  one body black → that body's material/texture path. Note bodies also carry
  an emissive floor, so *pure* black usually means both light and emissive
  are broken — start at the light.

### 4. Z-fighting / depth shimmer / halo fights the planet limb
- **Cause:** the camera spans near=1 to far=5e12, so the renderer uses a
  **logarithmic depth buffer** (`render.js:548`,
  `logarithmicDepthBuffer: true`). Any custom `ShaderMaterial` that omits
  three's logdepth shader chunks writes depth on a different scale and
  z-fights everything (HANDOFF.md:250-254). As of 2026-07-06 no custom
  ShaderMaterial exists in `render.js` — this bites when you ADD one.
- **Fix:** include `#include <logdepthbuf_pars_vertex>` /
  `<logdepthbuf_vertex>` in the vertex shader and
  `<logdepthbuf_pars_fragment>` / `<logdepthbuf_fragment>` in the fragment
  shader (chunk names verified present in `vendor/three.module.js`).
- **Related settled case:** the flat map "dot" used to z-fight the textured
  sphere as "shattered glass" when zoomed close — dots now hide once the true
  sphere is that big (see `hideMapDots` around `render.js:2152`). Don't
  re-fight it; see `space-sim-failure-archaeology`.

### 5. Landed craft floats above the surface
- **Cause (two, stacked — his Ganymede bug report):** (1) body spheres are
  48×32-segment, so the drawn surface sags up to ~R/470 below the true radius
  between vertices (~560 m on Ganymede) while physics sits AT the true radius;
  (2) the craft mesh used to render centered on the physics point, which is
  really the craft's base.
- **Fix (already in):** finely-tessellated ground-patch cap —
  `ensureGroundPatch` (`render.js:2371`, shown below ~25 km over solid
  ground) — plus base-at-point craft rendering. If floating reappears, check
  the patch is being created/positioned for that body.
- **Do NOT** "fix" by cranking sphere segments — matching physics radius that
  way needs 1000+ segments per body (HANDOFF.md:395-401).
- **Discriminate render vs physics:** node repro — if `sim.altitude` reads 0
  and `sim.status === "landed"` while the browser shows a gap, it's render.

### 6. A rocket part glows like a lamp
- **Cause:** bloom threshold is exactly **1.0** (`render.js:31`,
  `const BLOOM = { strength: 0.55, radius: 0.4, threshold: 1.0 }`). Only
  colors pushed past white bloom — by design that's the Sun, plumes, plasma,
  city lights. But **metalness ≳ 0.7 under the 2.0 sun** pushes specular
  glints over the threshold: the gold probe "burned like a lamp" at
  metalness 0.75 until foil dropped to 0.45 (comment at `render.js:1749-1751`).
- **Fix:** lower the part material's metalness below ~0.7. Do not raise the
  bloom threshold — 1.0 is a design invariant ("normal surfaces can never
  bloom", `render.js:29-30`).
- **Discriminate bloom vs emissive:** temporarily set `BLOOM.strength` to 0.
  Glow gone → specular-over-threshold → lower metalness. Still bright → the
  material's own `emissive`/`emissiveIntensity`.

### 7. A body looks washed out / featureless
- **Cause:** the ACES-tone-mapping lighting constants, not the textures. The
  first ACES pass overexposed the Moon to a featureless ball (HANDOFF.md:255-258).
- **Where:** sun 2.0 (`render.js:567`), ambient 0.5 / hemi 0.45
  (`render.js:571-572`), part emissive floor 0.22 (`render.js:159`),
  textured-planet emissive ~0.10. Suspect these numbers first; full catalog in
  `space-sim-constants-and-storage`.

### 8. "NO ENGINE" on a kid-plausible sky-crane stack
- **Cause:** stack rover / decoupler / crane / tank / pod — the old staging
  rule made the bottom rover its own engineless stage 0. Fixed in
  `builder.js reflowStages` (`builder.js:549-559`): rover(s) at the very
  BOTTOM are cargo, and a decoupler directly above them is the release latch,
  not a stage split.
- **If it recurs:** a new part type at the bottom of a stack probably isn't
  covered by the `bottomCargo` walk in `reflowStages`. Extend the walk; add a
  case to `tests/phase5_test.mjs` (see `space-sim-testing-and-qa`).

### 9. Speed / prograde / altitude readouts look wrong
- **Cause:** everything must be **dominant-body-relative**. Raw `craft.vel`
  is world-frame (Sun coords) and is dominated by Earth's ~21 km/s solar
  motion — parked on the Moon would read the Moon's orbital speed, not 0.
- **Where:** `physics.js:383-386` computes position/velocity relative to
  `dominantBody(...)`; readouts and guidance consume that. Any new readout or
  arrow you add must do the same subtraction (HANDOFF.md:409-410).
- **Verify:** node repro — place a craft landed on the Moon, confirm relative
  speed ~0 while `|craft.vel|` is ~kilometers/second.

### 10. Map dots / galaxy stars invisible
- **Cause:** the behind-camera test. With a 5e12 far plane, VISIBLE dots
  project to NDC z = 1 + 1e-13; a strict `z > 1` rejection culled every star.
  The guard is now tolerant: `if (_v1.z > 1.001) continue;`
  (`render.js:969-971`, comment explains it).
- **Fix:** if projecting anything to screen space yourself, use the same
  tolerance. Test hook: `window.__galaxyDebug()` (`render.js:982`) exists for
  automated checks — use it from `space-sim-browser-verification` flows.

### 11. Docking won't engage despite a perfect rendezvous
Two gates, both at `js/main.js` — check both:
- **Status gate:** proximity/docking requires
  `sim.status === "flying" || sim.status === "orbit"` (`main.js:882`; also
  `main.js:867`). The original bug: stable "orbit" — where stations LIVE —
  was excluded. Any new proximity feature must include both statuses.
- **Hardware gate:** docking REQUIRES a docking port aboard —
  `sim.craft.dockCount` (`main.js:89`, checked at `main.js:329`). A perfect
  rendezvous without one holds position and teaches why. That's a feature,
  not a bug.
- Distance/speed thresholds: within 150 m under 10 m/s relative
  (`main.js:882`).

### 12. Orbit drifts / decays at high time-warp
- **Cause:** the adaptive integrator caps substeps per frame
  (`MAX_SUBSTEPS = 5000`, `physics.js:185`). When the cap bites, it
  integrates less sim-time than requested and sets `sim.warpLimited = true`
  (`physics.js:188-192`) — the UI appends ⏳ to the warp row (`ui.js:255`).
- **Triage:** check `sim.warpLimited` first. Warp tiers live at `main.js:23`
  (`WARPS`, top tier **2,000,000×** — the full array is catalogued in
  `space-sim-constants-and-storage` A.2; note HANDOFF.md:38 still says 500,000,
  a known doc drift — the code is right).
- **Discriminate integrator error vs real physics:** drop warp to 1× and let
  the same arc run. Drift persists at small steps → it's real dynamics (see
  #13). Drift only at high warp with `warpLimited` false → suspect a step-size
  or state-caching bug in `physics.js` — write a node repro (warp stability
  cases exist in `tests/planets_test.mjs`).

### 13. Io teleport orbit drifts ~10%
- **Not a bug.** Jupiter's tidal perturbation on a low Io orbit is real
  physics. `tests/teleport_test.mjs` passes it deliberately:
  "teleport orbit around Io survives a full lap drift=9.8%" with a 35% drift
  tolerance (HANDOFF.md:320: "Io drifts ~10% — Jupiter's tide, real and
  fine"). Compare: Earth/Mars laps drift ~1%. Do not "fix" the integrator to
  make Io perfectly circular — physics stays real (owner's frozen rule; see
  `space-sim-change-control`).

---

## General discriminating experiments (cheap, in order)

1. **Sentinel log** — is the code you're reading the code that's running?
   (Beats ghost-chasing; see symptom #1.)
2. **Node repro** — is the number wrong, or only its presentation? Pure
   modules answer in seconds without a browser.
3. **Warp to 1×** — does the anomaly survive small integration steps? Yes →
   real dynamics; no → step-size/caching.
4. **One body or all bodies?** All → lighting/composer/camera; one → that
   body's material, texture, or catalog entry in `state.js` BODIES.
5. **Toggle one constant** — `BLOOM.strength` 0 (glow triage), light
   intensities (exposure triage). Revert after; permanent tuning goes through
   `space-sim-change-control`.
6. **Run the 8 suites** — a red suite localizes the layer instantly; all
   green + browser broken → the bug is in render/ui/main glue.

## Traps that cost real time (checklist)

- [ ] Hard reload (Cmd-Shift-R) after EVERY edit — no exceptions.
- [ ] `server.py` is Mac-only (hardcoded ROOT); use `python3 -m http.server 8000`.
- [ ] `Cannot find package 'three'` under node is normal for
      `render.js`/`main.js` — import map, not a missing dependency.
- [ ] Floating origin lives in render.js ONLY: anything scene-positioned must
      subtract `ORIGIN` in plain float64 JS numbers first, never in Vector3
      (HANDOFF.md:405-406). Physics stays in world (Sun) coords.
- [ ] Follow-cam must tip toward the local world; aimed straight at the craft
      it shows only stars from a few planet-radii up (HANDOFF.md:407-408).
- [ ] Stars visible through atmosphere halos from inside = pre-existing
      additive-halo behavior, not a regression (HANDOFF.md:262-263).
- [ ] Before "fixing" anything involving the Navigator prompt, localStorage
      schemas, share codes, or physics realism: those are the owner's frozen
      rules — load `space-sim-change-control` first.
- [ ] Debug hooks go in a PREVIEW COPY only, never the real source
      (HANDOFF.md:335-340; details in `space-sim-browser-verification`).

## Provenance and maintenance

All facts verified against the repo on 2026-07-06 (all 8 test suites run
green, 171 checks; node v22.22.2). Line numbers drift — re-verify with:

```bash
cd /home/user/space-sim
grep -n "const BLOOM"  js/render.js        # bloom threshold 1.0
grep -n "const WARPS"  js/main.js          # warp tiers (top 2,000,000)
grep -n "const SCALE"  js/state.js         # SCALE = 0.1
grep -n "DirectionalLight" js/render.js    # sunlight (not PointLight)
grep -n "logarithmicDepthBuffer" js/render.js
grep -n "ensureGroundPatch" js/render.js
grep -n "1e-13" js/render.js               # NDC z tolerance guard
grep -n "__galaxyDebug" js/render.js
grep -n "MAX_SUBSTEPS\|warpLimited" js/physics.js
grep -n "reflowStages" js/builder.js
grep -n 'status === "flying" || sim.status === "orbit"' js/main.js
grep -n "dockCount" js/main.js
grep -n "ROOT" server.py                   # the Mac-path trap
node tests/teleport_test.mjs | grep Io     # Io drift ~10% is expected
for t in tests/*.mjs; do node "$t" | tail -1; done
```

If a grep comes back empty or a line number moved, trust the grep, update
this file, and check HANDOFF.md's gotcha list for what changed.
