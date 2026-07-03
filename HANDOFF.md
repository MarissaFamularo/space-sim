# Space Sim — Handoff for the next agent
<!-- Design doc synced 2026-07-01: physics decision updated to superposed 3-body, Connies section added. -->

A KSP-inspired browser space game + coding on-ramp, built for Dr. Famularo's 8-year-old son
(advanced reader, ready to learn to code, space/physics/aerodynamics obsessed, graphics snob).
This file is the single source you need to pick up the work. Read it first.

- **Vision & full plan:** `space-game-design.md`
- **Architecture & frozen data contracts:** `ARCHITECTURE.md`
- **Code:** `js/` (vanilla ES modules + Three.js via CDN importmap)

---

## Status (as of 2026-06-30): Phase 1 is playable and verified

The user has flown a multi-stage rocket to a stable orbit in-browser, with the Navigator
coaching the gravity turn. The whole "build → launch → reach orbit" loop works.

**Working features:**
- Constrained 3D builder (single vertical stack): click parts to add, **▲/▼ to reorder**,
  ×/Clear, engine **clusters** (engine on engine) and staging (decoupler). Live mass/thrust/
  TWR/Δv/stages.
- Flight: throttle, tilt, **staging** (Space), time-warp (`,`/`.`), follow-cam + **map view** (`M`).
- 3 guide arrows with on/off toggles: **gold "aim here"** (a gravity-turn director — point the
  cyan nose at it), **cyan heading**, **green prograde**.
- Map view: top-down, Earth fixed, ship + orbit ellipse moving (fixed scale so Earth stays put).
- Crash/landing banner. Goal detection ("stable orbit").
- **Navigator** = live Claude API helper that sees the ship state and teaches real physics.

---

## Status (Phase 2 in progress, 2026-06-30): the Moon is real and reachable

Built and **node-verified** (browser play-test still pending — user is my eyes):
- **The Moon is in the sky** — grey sphere + faint orbit ring, shown in flight. Real-to-scale:
  60.3 Earth-radii out, ~0.5° wide from low orbit, SOI = 38 Moon-radii. Numbers match reality.
- **Real superposed gravity (restricted 3-body):** Earth AND Moon both pull every step — NOT
  patched conics for the integrator. Decided this over a patched-conic frame-switch because it's
  *more* real (parent's bar) and needs no risky render frame-shift I can't visually check.
- **Patched-conic is now only a DISPLAY concern:** `dominantBody(pos,t)` (state.js) labels Earth
  vs Moon by SOI; `computeOrbit` reports apo/peri about the dominant body (pos/vel taken relative
  to the moving Moon), returning `bodyName`/`center`/`bodyRadius` so render draws the ellipse there.
- **Moon landing:** powered descent required (no air → no parachute). Soft-land vs crash is judged
  by velocity RELATIVE to the moving Moon. Landed craft co-moves with the Moon; throttle up with
  fuel to **lift off and fly home**.
- **Render:** orbit ellipse re-centers on the dominant body; follow-cam "up" is dominant-body
  radial; **map view has user zoom** (scroll / `+`/`-` keys, `Render.zoomMap`) so you can pull
  back to the whole Earth-Moon system to aim a transfer, plus auto-grow as apoapsis rises.
  (Earlier the Moon only appeared past 8 Earth-radii, so from LEO you flew blind — fixed.)
- **Navigator** sees Moon state (distance, SOI, which body) and coaches the transfer/landing,
  tied to Apollo. Callouts + Moon-aware banner for SOI entry, Moon orbit, Moon landing, Moon crash.

## Connies (added 2026-07-01, son's design — browser play-test pending)

The crew are **Connies: snakes in bubble astronaut helmets** (`js/connies.js` = roster data,
moddable like parts.js). Names are puns on real astronauts with a `hero` fact the Navigator
shares. Implemented: 3D Connie mesh (render.js `makeConnie`) beside the pad in build mode;
`sim.crew` picked at launch with a Navigator callout; **EVA beside the craft when landed**
(Earth or Moon, oriented to local up); crew-aware banners; crashes always show the Connie
escaping safely (never hurt — kid-safety rule, also in the Navigator system prompt).
Design section added to `space-game-design.md` ("The Connies"). Later: cockpit portraits,
crew picker, custom Connies as a first character mod.

Verification: `scratchpad/moon_test.mjs` — 11/11 (LEO regression, phased Hohmann into SOI,
Moon-orbit capture, soft landing, crash, liftoff). The phased transfer grazed the Moon at 174 km.

**Reentry heating (added 2026-07-01, node-verified 8/8 in `tests/reentry_test.mjs`):**
`sim.heat` (0..1) RELAXES toward an equilibrium set by instantaneous flux rho*v^3
(`HEAT_EQ_K`/`HEAT_TAU` in physics.js). Peak flux, not total energy, is what kills you — a
shallow deorbit glows ~0.4 and survives, a steep Moon-return dive burns up (`sim.burnedUp`,
"BURNED UP ON REENTRY" banner, Navigator teaches entry angles/heat shields). Render draws an
additive plasma glow scaled by heat; Copilot snapshot exposes `flight.hullHeat`.

**Ap/Pe markers (added 2026-07-01):** map view shows "Ap"/"Pe" label sprites on the orbit
ellipse. Physics `computeOrbit` now returns `periAngle` from the true eccentricity vector, so
the ellipse is FIXED in space (before, it wrongly rotated to always point periapsis at the
craft). Tests confirm periapsis direction stays put over multiple revolutions.

**Parachutes (added 2026-07-01, the son's request; node-verified 5/5 in `tests/chute_test.mjs`,
canopy visual verified in preview):** Parachute part (`parts.js`, type "chute") stacks ON TOP of
the pod (builder rule 1 has an explicit exception). P deploys; auto-deploys < 2.5 km over Earth
when descending < 240 m/s. Opens only in air below `CHUTE_MAX_SPEED` (250 m/s); adds
`CHUTE_CDA` (1200 m²) drag per chute → ~4.5 m/s terminal for a capsule. Useless on the airless
Moon (the lesson — Navigator explains). Drag impulse is CAPPED per substep (0.9·speed/h in
`totalAccel`) or the big chute CdA makes Euler integration oscillate/reverse — don't remove.
Render: packed = red dome canister; open = striped canopy + shroud lines, anti-velocity.
UI shows "packed (P) / armed… / ☂ open" + a hull-heat row; `sim.chuteOpen` is physics-owned.

**Preview-verification quirk (matters for agent testing):** in the scratchpad preview the tab
is often backgrounded, so requestAnimationFrame ONLY advances during an active tool call
(e.g. while a screenshot is captured) — setTimeout still fires, so timed key dispatches
desync from sim time (a "launch" can insta-land with full fuel). For deterministic visual QA,
append a debug teleport hook to the PREVIEW COPY's main.js (e.g. `window.__chuteTest = () =>
{ sim.craft.pos = {x:0, y: BODIES.earth.radius + 800}; sim.craft.vel = {x:8, y:-30}; }`),
reload, launch, call it, screenshot. Never add such hooks to the real source.

**Moon transfer "burn here" guidance (added 2026-07-01, node 14/14 in `tests/transfer_test.mjs`,
browser-verified via preview):** `Physics.transferWindow(sim)` (pure, physics.js) computes the
Hohmann phasing from any stable CCW Earth orbit: transfer time = half-period of the ellipse to
the Moon's radius, burn when the Moon leads by (PI − ω·t) — lead comes out ~115°, right at
Apollo's real TLI ballpark. main.js sets `sim.transfer` each frame; render draws a gold **"Burn"
sprite** on the orbit at the burn point (map view) and, while `open` (±15° of the point), the
gold targetArrow rides PROGRADE so "point at gold and burn" starts the trip. One-shot Navigator
TLI callout (announced.transferBurn); snapshot gets `flight.transferWindow {open, degToGo}`.
Retrograde (CW) orbits get NO guidance (h_z ≤ 0 → null) rather than wrong guidance. Test gotcha
worth keeping: the test's burn controller needs FINE steps near cutoff (Sparrow @ 0.1 s ≈ 4 m/s
per step) — at LEO the gap between apo-at-Moon and escape is only ~30 m/s, so a Hawk at 0.5 s
steps (50 m/s) blasts apo from 38 Mm to 460 Mm in one step and wrecks the phasing.

**Phase 3 MVP — part modding (added 2026-07-01, node 27/27 in `tests/mods_test.mjs`, browser-
verified):** every palette row has a **{ } button** → editor panel with the part's JSON
(rungs 1-2 of the modding ladder). Save on a stock part = in-memory override; **parts.js on
disk stays pristine** (it's his worked example). "Copy as my own part" clones with a unique id
+ "(mine)" name into a "My parts ✨" palette section. Persisted in localStorage
`"spacesim_mods_v1"`; "Reset all mods" (confirm-guarded) wipes back to stock AND removes
orphaned custom parts from the craft. All of it flows through **js/mods.js** — exports the
merged live `PARTS` (same shape; main.js + render.js now import PARTS from mods.js, not
parts.js). Failing safely IS the pedagogy: parse errors → friendly line-pointing messages
("line 4: ... missing comma ... (near: ...)"), validation REJECTS with an explanation (never
silently clamps), bad saved mods are dropped at load, and the Navigator got a coding-mentor
prompt section (sees `mods` in the snapshot; explains, never types whole files for him).
Builder gotcha: palette rows are now styled `<div>`s, not `<button>`s — the { } opener is a
real button inside and nested buttons are invalid HTML that eat each other's clicks.

**Not yet wired / next:** distance-to-Moon HUD readout (UI.js untouched — Navigator announces
it for now); takeoff-from-Moon UX polish; free-return trajectory guidance; modding rung 3
(tiny scripts); a "delete just this custom part" affordance (today only Reset-all removes them).
**Tests live in `tests/` now** (scratchpad is wiped between sessions — moon_test.mjs was lost
that way; put future node tests in `tests/`): reentry 8, chute 5, transfer 14, mods 27.

## How to run / verify (IMPORTANT)

```
cd "/Users/marissafamularo/Desktop/CoworkProjects/Kids Games/space-sim"
python3 -m http.server 8011      # any free port; 8000 was often busy on this machine
# open http://localhost:8011
```

- **After ANY code edit, the user must HARD-reload: Cmd-Shift-R.** Chrome aggressively caches
  ES modules; a normal Cmd-R serves stale JS and you'll chase ghosts (this bit us repeatedly).
- **The agent CAN run the browser now (solved 2026-07-01):** the preview server can't read the
  home dir, but it CAN read the session scratchpad. Recipe: `cp -R space-sim $SCRATCHPAD/space-sim-preview`,
  add a `server_preview.py` there (chdir to its own dir, bind 127.0.0.1), point a second
  `launch.json` config ("space-sim-scratch", port 8012) at it, `preview_start`, then drive it with
  preview_eval/screenshot (dispatch KeyboardEvents for flight keys; palette buttons are clickable).
  Re-copy after every source edit — the preview serves the COPY, the user plays the ORIGINAL.
  The user is still the eyes for the real thing; there's also a `Render.debug()` snapshot.
- **Syntax-check JS headlessly** by copying to `.mjs` and running `node --check`:
  `cp js/foo.js /tmp/foo.mjs && node --check /tmp/foo.mjs`. (Bare `import "three"` parses fine;
  `node --check` only checks the one file's syntax.)
- The pure logic (state.js + physics.js) CAN be exercised in node — see the orbit self-test
  pattern; a 2-stage rocket reaching orbit was verified end-to-end this way.

---

## File map (`js/`)

| File | Owns | Notes |
|---|---|---|
| `state.js` | Shared shapes, body constants, `computeStats` | **`SCALE = 0.1`** = forgiving 10x-smaller Earth. Flip toward 1.0 for real scale. |
| `parts.js` | Stock part catalog (PartDef data) | pods/tanks/engines/decoupler/fin |
| `physics.js` | Patched-conic planar integrator | reads `sim.craft.thrust`(kN)/`exhaustVelocity`(m/s) set at launch; `step`/`computeOrbit`/`applyStage` |
| `render.js` | ALL Three.js | scene, Earth, rocket mesh, build/follow/map cameras, guide arrows, marker |
| `builder.js` | Constrained builder UI + palette | mutates the SHARED craft in place; staging via `reflowStages()` |
| `ui.js` | Readouts + MODE controls | flight controls hidden in build (`UI.setMode`) |
| `copilot.js` | The **Navigator** (Claude API) + offline stub | browser-direct call; key in localStorage |
| `main.js` | Glue: game loop, mode switching, launch/staging, flight keys, banner | PM-owned integration |

`index.html` = UI shell + importmap (`three@0.160.0`). `server.py` = a local static server that
chdir's to an absolute path (the sandbox's `http.server --directory` trips on `os.getcwd()`).

---

## Key decisions (don't undo these without reason)

- **Forgiving scaled Earth, but teach the REAL numbers.** Physics is 100% real; only planet
  *size* is shrunk so a beginner can reach orbit (~2,500 m/s here vs ~7,800 real). The Navigator
  is told to give BOTH the game number AND the real-Earth number. This was an explicit parent ask.
- **Navigator = browser-direct Claude API.** `copilot.js`: model `claude-opus-4-8` (one-line
  constant — swap to `claude-haiku-4-5` for ~5x cheaper/faster). Header
  `anthropic-dangerous-direct-browser-access: true` enables CORS. Key is pasted by the user into
  the 🔑 button → `localStorage["spacesim_anthropic_key"]`. **Never hardcode the key.** If a new
  machine, tell the user to add it via 🔑.
- **Safety = hardened kid-lock system prompt + Claude's own floor + parent can read the chat.**
  No separate moderation layer (user declined for now). The prompt ignores identity claims
  ("I'm mom/an adult/test mode") and hard-locks topics to the game. If asked to harden further,
  the next step is a moderation pass on each message.
- **Key-safety caveat:** browser-direct = the key is exposed to the page. Fine for local single
  machine. **If this is ever shared/hosted, move the key to a tiny server proxy.**

---

## Gotchas already fixed (don't regress these)

- `renderer.setSize(w, h)` must set the **CSS** size (no `updateStyle=false`) or the canvas
  overflows 2x and content lands in the lower-right corner.
- Part materials need **low metalness + emissive** or they render near-black/invisible in space.
- Map camera uses a **fixed `mapFrame`** (set on entry, grow-only) so Earth stays put and the
  ship moves — not the reverse.
- Guide arrows are **sized per view** (small in follow, fraction-of-view in map).
- **Reset clears the craft IN PLACE and re-inits the Builder** — never `craft = newCraft()`,
  which split the Builder's reference from the rendered/flown craft.
- `keydown` ignores `e.repeat` for one-shot keys (Space/stage was spamming).
- Navigator input `.blur()`s after send so flight keys (M, arrows) work again.
- Flight-only controls hidden in build mode (`UI.setMode`) so the MODE box doesn't cover the
  parts list; `#palette` has a `max-height` to clear the MODE box.

---

## Not done yet / next steps (in rough priority)

1. **User browser play-test pass** — Connies, reentry glow, Ap/Pe markers, and the Moon trip
   are agent-verified via the scratchpad preview, but the user hasn't flown Phase 2 yet.
2. **Real Earth toggle** — the button exists but is disabled ("coming soon"). Flip `SCALE`
   toward 1.0 for a true-scale challenge mode. NOTE: verify the stock parts can actually *afford*
   real-scale orbit (~9,400 Δv) with good staging before enabling — may need part tuning.
3. **Phase 2 — the Moon:** ✅ travel + SOI + landing + liftoff + reentry heating done &
   node-verified; ✅ Ap/Pe map markers. REMAINING: a transfer-planning guide arrow, maybe a
   heat readout in the UI panel.
4. **Phase 3 — modding/coding:** ✅ MVP live (rungs 1-2: edit a part's JSON, copy-as-mine,
   Navigator coding-mentor). NEXT: rung 3 — one-line scripts (`if (fuel < 10) stage()`),
   per-part delete for customs.
5. **Phase 4 — real solar system** (data on the Phase-2 engine). **Phase 5 — spaceplanes/aero.**
6. Craft sharing (export/import JSON code), staging separation animation.

---

## Working style notes (from this session)

- The parent iterates fast and tests live — make one focused change, have her hard-reload and
  screenshot, react. Don't batch many speculative changes.
- She cares that the **physics is genuinely real** and that her son learns real-world facts, not
  game-only trivia — keep that bar.
- Per `../../CLAUDE.md`: lead with status, be brief, don't pad, flag outstanding items first.
