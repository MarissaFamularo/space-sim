---
name: space-sim-browser-verification
description: >
  Drive the real Space Sim game headlessly with Playwright instead of eyeballing —
  boot smoke checks, scripted verification flights with numeric assertions, and
  screenshots. Load this skill when you need to: prove a change works in the actual
  browser (not just node tests); check the game boots with zero console errors and a
  non-blank canvas; verify render-layer work (plume, planet faces, map view, bloom,
  HUD) that node tests cannot see; fly a scripted launch/teleport and assert
  altitude/speed/drift numbers; capture screenshots as evidence; or set up the
  copy-repo-and-inject-hooks harness. Symptoms/keywords: "browser-verify", "play-test
  headless", "screenshot the game", "does it still boot", Playwright, Chromium,
  headless, canvas blank, console errors, boot banner, plume, scripted flight,
  window.__sim, __advance, preview copy, injection hooks. NOT for: running node test
  suites (space-sim-testing-and-qa), serving the game for a human (space-sim-dev-loop),
  or diagnosing a failure you already reproduced (space-sim-debugging-playbook).
---

# Space Sim — Browser Verification (drive the real game headlessly)

Node suites (`tests/*.mjs`) prove physics and data. They cannot prove the game *boots*,
*draws*, or *flies* — render.js (3,398 lines of Three.js), ui.js, builder.js, and the
main.js game loop only run in a browser. This skill is the runbook for verifying those
in a real headless Chromium, with **numbers, not eyeballs**.

Everything below was executed end-to-end and green on 2026-07-06.

## When NOT to use this

| You want to… | Use instead |
|---|---|
| Run/extend the pure-node test suites | `space-sim-testing-and-qa` |
| Serve the game for a human, deploy, fix stale-cache "my edit isn't showing" | `space-sim-dev-loop` |
| Triage a symptom to a cause | `space-sim-debugging-playbook`, `space-sim-failure-archaeology` |
| Know whether a change even needs browser evidence | `space-sim-change-control` (evidence ladder) |
| Predict the number you're about to assert | `orbital-mechanics-reference`, `space-sim-analysis-toolkit` |

Browser verification is the third rung of the evidence ladder (code-verified →
node-tested → browser-verified → kid play-test). It never replaces the kid play-test:
"graphics snob approves" cannot be automated.

## The method (project law — from HANDOFF.md "How to run / verify")

1. **NEVER add debug hooks to the real source.** Copy the game to a scratch directory
   and inject hooks into the COPY only. (The real source already ships three read-only
   handles — `window.__simRef` at js/main.js:470, `window.__galaxyDebug` and
   `window.__pickGalaxy` in render.js — but no time control; don't add more.)
2. **Never trust requestAnimationFrame cadence under automation.** The injected harness
   disables the game's rAF loop and exposes `__advance(dt, steps)`, which calls
   `Physics.step` directly. Tests own sim time deterministically.
3. **The repo must never gain `node_modules` or `package.json`.** Playwright is
   npm-installed in the scratch work dir only. There is no build step to break — keep
   it that way.
4. **Numbers over eyeballs.** Assert altitude bands, speed vs first principles, drift
   percentages, error counts. Screenshots are corroborating evidence for a human, never
   the assertion itself.

## Quick start (3 commands)

`SKILL` below = this skill's dir; pick `WORK` inside your session scratchpad.

```bash
SKILL=/home/user/space-sim/.claude/skills/space-sim-browser-verification
WORK=<your-scratchpad>/verify        # any writable dir OUTSIDE the repo

bash "$SKILL/scripts/setup-scratch.sh" /home/user/space-sim "$WORK" 8022
node "$SKILL/scripts/boot-smoke.mjs"   "$WORK" 8022
node "$SKILL/scripts/flight-check.mjs" "$WORK" 8022
```

Teardown when done: `kill $(cat "$WORK/server.pid")`.

Both test scripts print `PASS`/`FAIL` lines in the same style as `tests/*.mjs` and exit
non-zero on any failure. Screenshots land in `$WORK/shots/`.

### What setup-scratch.sh does (so you can adapt it)

1. Copies `index.html`, `js/`, `vendor/` from the repo to `$WORK/game/` (fresh each run).
2. Injects `<script>window.__TEST_DRIVE = true;</script>` before the module script tag
   in the copy's index.html (the flag must exist before modules load).
3. Rewrites the copy's final top-level `requestAnimationFrame(frame);` in js/main.js to
   `if (!window.__TEST_DRIVE) requestAnimationFrame(frame);` — the auto loop never
   starts under test, so no physics runs behind your back.
4. Appends `scripts/hooks.js` to the copy's js/main.js. Appended code shares main.js's
   module scope, so it can reach the private `sim`, `craft`, `launch()`, `teleport()`,
   `updateStationsSim()` that page-level scripts cannot.
5. Syntax-checks the result (`cp main.js main-check.mjs && node --check` — the .mjs
   rename is required because main.js uses `import`).
6. `npm install playwright` into `$WORK/driver/` (skipped if present).
7. Serves `$WORK/game/` with `python3 -m http.server PORT --bind 127.0.0.1` (nohup;
   pid in `$WORK/server.pid`, log in `$WORK/server.log`). Default port 8022 — the
   README's 8000 is often busy, and the repo's `server.py` is a documented trap (it
   hardcodes the owner's Mac path; never use it).

Both injection anchors are asserted: if index.html's module tag or main.js's last-line
loop start ever moves, the script fails loudly instead of producing a half-hooked copy.

## Environment facts (as of 2026-07-06)

- Chromium is **preinstalled** under `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
  (revision dir `chromium-1194`). **Do NOT run `npx playwright install`** — no network
  download is needed or wanted.
- The npm-latest playwright (1.61.1 at verification time) expects a NEWER browser
  revision and fails default launch with "Executable doesn't exist at
  …chromium_headless_shell-1228…". Both test scripts handle this: they try
  `chromium.launch()` and fall back to
  `chromium.launch({ executablePath: "/opt/pw-browsers/chromium-<newest>/chrome-linux/chrome" })`,
  which works fine across this version skew.
- WebGL renders headlessly via SwiftShader — no GPU flags needed.
- **Owner's Mac (2026-07-18):** no `/opt/pw-browsers` and no downloaded Playwright
  browsers — both scripts now fall back to `chromium.launch({ channel: "chrome" })`
  (system Google Chrome). Works headless; nothing to install.

## Hook API (what hooks.js exposes on `window` in the copy)

| Hook | What it does |
|---|---|
| `__sim()` | Current SimState. **Call it fresh every time** — `launch()`/`teleport()` REASSIGN the module's `sim`; a held reference goes stale. |
| `__craft()` | The shared craft object (parts list). |
| `__loadRocket([[partId, stage], …])` | Replace the craft's parts. **Bottom→top order; array order IS stacking order; lowest part is stage 0** (builder.js convention). Part ids are in js/parts.js (`command_pod`, `tank_small`, `engine_sparrow`, …). |
| `__launch()` / `__teleport(key)` | The real main.js flows (crew assignment, callouts, stage loading, parking orbit). |
| `__advance(dt, steps)` | Advance sim time deterministically: per step runs `Physics.step(sim, dt*timeWarp)`, `transferWindow`, `updateStationsSim`, then renders + refreshes the HUD. Returns `__snap()`. dt is sim-seconds; the integrator substeps adaptively, so dt of a few seconds is safe. |
| `__snap()` | `{ mode, status, time, altitude, speed, soi, fuel, throttle, thrust, cantLiftOff, orbit:{isOrbit, apoapsis, periapsis, ecc} }`. `soi` is the display NAME ("Moon", not "moon"); apoapsis/periapsis are ALTITUDES (m above surface). |
| `__setThrottle(v)` / `__setAngle(rad)` | Direct control inputs (keyboard sim not needed). |
| `__setView("follow"\|"map")` | Switch flight camera / map view. |
| `__renderAndSample()` | Renders, then reads canvas pixels back **in the same JS task** (mandatory: `preserveDrawingBuffer` is false, so the WebGL buffer is blank if read in a later task). Returns `{ litFraction, meanBrightness }`. |
| `__Physics`, `__Render`, `__BODIES` | The live modules/catalog — e.g. pull `__BODIES.moon.radius/mu` so assertions track the game's own constants instead of hardcoding. |

Driving pattern from Playwright: `await page.evaluate("window.__advance(2, 200)")` —
chunk many sim-steps per evaluate round-trip (200 works well); one evaluate per step is
painfully slow over a full orbit (~1,600 steps).

## Interpretation guide

### What green looks like (real output, 2026-07-06)

```
BOOT SMOKE: ALL GREEN            # 9 PASS lines, exit 0
FLIGHT CHECK: ALL GREEN          # 14 PASS lines, exit 0; key numbers:
PASS  teleport altitude ~60.8 km (tol 2%)   alt=60.79km err=0.00%
PASS  teleport speed ~457 m/s circular (tol 2%)  v=456.6m/s err=0.00%
PASS  full Moon lap (~54 min): never crashed, drift < 10%  drift=0.87% band=[60.6, 61.1]km
```

The Moon numbers are first-principles: parking orbit r = 1.35·R (no atmosphere),
altitude 0.35·R = 60.795 km, v = √(mu/r) = 456.6 m/s, period ≈ 54 min — computed in the
script from the live `__BODIES.moon`, so they survive catalog changes.

### Console-error policy

index.html carries a boot-failure reporter (plain script, runs before modules): any
window `error` or `unhandledrejection` paints a red banner containing the text
**"The game hit an error"**. The boot smoke checks (a) that banner is absent, (b) zero
`pageerror` events, (c) zero console `error` messages, (d) zero failed network requests.
**The only tolerated console error is the 404 for `/favicon.ico`** (the repo ships no
favicon; the script filters it by URL). Anything else — a missing vendor file, a texture
404, a shader compile error — is a failure. Do not loosen this.

### What screenshots must show

| Shot | Must show | Fail signs |
|---|---|---|
| `boot-pad.png` | Pad scene with space center props, Connie mascot, Parts palette (18 stock rows), Mode + Flight Data + Navigator panels, star field | Empty black canvas, red boot banner, empty palette |
| `ascent-plume.png` | Bright white-hot plume + glow under the rocket, HUD `Status flying`, `Throttle 100%` | No plume while throttle+fuel+thrust all nonzero (the plume renders ONLY when all three are on — assert those numbers alongside the shot) |
| `moon-orbit.png` | Moon limb (grey, cratered) below craft, HUD `Around Moon / Orbit? ✅ stable` | Black-on-black body (see debugging playbook: DirectionalLight, not the mesh), washed-out featureless disc |
| `moon-map.png` / `ascent-map.png` | Textured body disc, cyan orbit ring, Ap/Pe markers, clean planet limb | Z-fighting blocks at the limb, "shattered glass" map dot over the sphere (both are FIXED regressions — see failure archaeology) |

**Known-benign artifact:** stars visible through atmosphere halos from inside — that's
pre-existing additive-halo behavior (HANDOFF.md, graphics pass), NOT a regression. Don't
"fix" it, don't fail a run on it.

### Tolerance culture

Assert numbers with stated tolerances; never "looks right".

| Quantity | Tolerance | Why |
|---|---|---|
| Teleport parking-orbit altitude & speed | 2% | Pure two-body setup; should be near-exact |
| One-lap Moon drift (max−min alt / expected alt) | 10% | Earth's tide is real in superposed gravity (measured 0.87%; Io's Jupiter tide runs ~10%) |
| Node-suite equivalent (`tests/teleport_test.mjs`) | 35% across ALL worlds | Same physics, harsher worlds |
| LEO drift (physics.js self-test) | 1.5% | Near-Keplerian regime |
| Ascent-altitude band after 30 s vertical burn | 4–40 km | Sanity band, not a trajectory model |
| Canvas litFraction (boot, follow view on pad) | > 0.02 | Blank canvas ≈ 0; measured 0.749 |

## Writing a new scripted verification (recipe)

1. Predict the number first (`orbital-mechanics-reference` / `space-sim-analysis-toolkit`).
2. Copy `flight-check.mjs` as a template; keep `check(name, ok, detail)` PASS/FAIL style.
3. Drive via hooks; pull constants from `__BODIES`/`__Physics`, never hardcode.
4. Gotchas that cost time:
   - `sim` is reassigned on launch/teleport — always `page.evaluate("window.__snap()")`,
     never cache a sim reference in-page.
   - Canvas pixel readback must happen in the same task as a render → use
     `__renderAndSample()`, and call it immediately before `page.screenshot()` too
     (with the rAF loop off, nothing else redraws).
   - Parts arrays are bottom→top; a chute above the pod, engine at the bottom.
   - `snap.soi` compares against `"Earth"`/`"Moon"` (display names, capitalized).
   - Time-warp multiplies `__advance`'s dt (`dt * sim.timeWarp`) — leave warp at 1 for
     deterministic step sizes, or set it deliberately and say so.
5. Keep new scripts in your scratchpad unless they're permanently useful; if permanent,
   they belong in THIS skill's `scripts/` dir — never in `tests/` (that's node-only
   territory) and never in the game source.

## What this environment cannot verify (say so, don't fake it)

- **The Navigator's live Claude calls** — needs a real API key in localStorage; the
  scratch copy has none, so the offline stub answers. Never test with the kid's stored
  key. See `space-sim-navigator-and-safety`.
- **Real input feel, audio, perf on the kid's school laptop** — headless SwiftShader
  frame timing proves nothing about real-device frame rate.
- **"Looks awesome"** — the kid is the acceptance test (owner doctrine).

Fallback ladder if the browser harness is unavailable (no Chromium, no npm): run all
8 node suites (`for t in /home/user/space-sim/tests/*.mjs; do node "$t"; done`), syntax-check
each touched module (`cp js/foo.js /tmp/foo.mjs && node --check /tmp/foo.mjs`), and state
explicitly in your report that boot/render is UNVERIFIED.

## Provenance and maintenance

All facts verified 2026-07-06 by running the three scripts end-to-end (all green:
9 + 14 PASS, 0 FAIL; screenshots inspected). Re-verify what may drift:

```bash
# Injection anchors still where setup-scratch.sh expects them:
grep -n 'script type="module" src="./js/main.js"' /home/user/space-sim/index.html
tail -1 /home/user/space-sim/js/main.js          # must be: requestAnimationFrame(frame);
# Hook-visible internals still exist under these names:
grep -n "window.__simRef\|function launch()\|function teleport(\|function updateStationsSim" /home/user/space-sim/js/main.js
# Preinstalled browser revision (update the executablePath note if it changes):
ls /opt/pw-browsers | grep '^chromium-'
# Stock part count for the palette assertion (18 as of 2026-07-06):
grep -c 'id: "' /home/user/space-sim/js/parts.js
# Parking-orbit rule the Moon numbers derive from (1.35 r vs r + 3*atmo):
grep -n "1.35" /home/user/space-sim/js/physics.js
# Boot banner text the smoke test greps for:
grep -n "The game hit an error" /home/user/space-sim/index.html
```

If an anchor moved, fix `scripts/setup-scratch.sh` (it asserts and names the anchor in
its error message). If the palette DOM changes, fix the "first child div of
#palette-list" selector in `scripts/boot-smoke.mjs`.
