# Space Sim — Handoff for the next agent
<!-- Rewritten 2026-07-03 after the overnight Phase-4 build (solar system pulled forward). -->

A KSP-inspired browser space game + coding on-ramp, built for a young kid
(advanced reader, ready to learn to code, space/physics/aerodynamics obsessed, graphics snob).
This file is the single source an agent needs to pick up the work. Read it first.

- **Vision & full plan:** `space-game-design.md`
- **Architecture & data contracts:** `ARCHITECTURE.md` (updated for the heliocentric world)
- **Code:** `js/` (vanilla ES modules + Three.js vendored in `vendor/`)
- **Repo:** https://github.com/MarissaFamularo/space-sim (push to `main`)

---

## Status (as of 2026-07-03, overnight session): THE SOLAR SYSTEM IS FLYABLE

He kept asking for planets, so Phase 4 was pulled ahead of the rest of Phase 3.
**User browser play-test still pending** — everything below is agent-verified
(80 node checks across 5 test suites + preview-browser passes with screenshots).

**What was already true (Phases 1–3 MVP, play-tested earlier):** constrained builder with
staging/clusters, launch → gravity turn → stable orbit, Moon trip (superposed gravity, SOI,
powered landing, liftoff home), reentry heating, parachutes, Ap/Pe/Burn markers, map view
with zoom, the Navigator (browser-direct Claude, hardened kid-safe prompt), Connies (snake
crew, EVA on landing), part modding rungs 1–2 ({ } editor, overrides, copy-as-mine,
friendly errors, localStorage persistence).

**New this session (Phase 4):**
- **Heliocentric world** — Sun at the origin; Earth (and the pad, and you) fly around it.
  All 8 planets + the Moon on real circular orbits, everything scaled by the same rule as
  before: radii and distances ×0.1, surface gravities REAL (`mu = g0·r²`). The system runs
  ~√10 ≈ 3.2× faster as a side effect (a Mars trip ≈ 82 game-days; teach the real 8.5 months too).
- **Gravity superposed from every body, every step.** Patched-conic SOI is display/readout
  only (`dominantBody` = deepest SOI: Moon > Earth > Sun). Drag/chutes/heat push against the
  LOCAL air (each atmosphere moves with its planet).
- **Adaptive integrator** — substeps from 0.02 s (landing burns) to hours (cruise), capped
  per frame with `sim.warpLimited` when the cap bites. Time-warp tiers to **500,000×**
  (`,` / `.`). LEO regression, chute precision, and a full solar orbit at 8000-s steps all pass.
- **🎯 Target picker** (MODE panel): Moon, all 8 planets, Earth-home. Distance readout,
  per-target transfer guidance, per-target Navigator brief with a true fact.
- **Transfer windows generalized** — Moon from Earth orbit (unchanged), planets from a Sun
  orbit, prograde out / retrograde in (Venus, Mercury, home). Gold Burn marker + gold arrow
  as before.
- **Mid-course corrections (the Apollo 13 move — THE reliability feature).** Window timing
  alone is not enough at interplanetary scale: a 2° sloppy burn still arrives, but an 8° one
  misses Mars by ~1,000,000 km. Once the transfer is underway, `Physics.courseCorrection`
  Kepler-propagates the conic, predicts the closest pass ("Closest pass" HUD row), probes 8
  burn directions, and rides the gold arrow along the winner; the Navigator coaches "short
  gentle burn until it says on target." Node-tested: a deliberately-8°-late Mars transfer
  (940 Mm miss) converges to arrival by following the arrow.
- **Per-world landings that each teach something real:** Moon/Mercury powered descent;
  Mars = chute + engines (sky-crane lesson — chute alone crashes, tested); Venus thick air;
  gas giants have NO surface (sink and crush banner; heat can get you first, exactly like
  the Galileo probe — tested); the Sun melts you. Landed craft co-move with their world;
  Connie EVAs beside the ship anywhere solid.
- **Render** — floating origin (craft-centered; float64 subtraction before any THREE call,
  so a 10 m rocket at Neptune is crisp), per-planet looks (band textures on Jupiter/Saturn,
  Saturn rings, Sun glow), orbit rings, map dots + name labels for every world, map centered
  on whoever owns you, sunlight aimed from the Sun each frame, follow-cam tips toward the
  local world (Saturn stays in frame from high orbit).
- **Major moons** (added later the same night): Io, Europa, Ganymede, Callisto at Jupiter,
  Titan at Saturn — real data, target-picker entries (indented under their planet: capture
  at the planet first, then hop), facts, banners. **Titan's air is thicker than Earth's, so
  a parachute alone lands you softly — the Huygens lesson (node-tested).** Skipped:
  Phobos/Deimos (SOI smaller than their radius — readouts would lie) and Triton (retrograde;
  the engine's orbits are CCW-only).
- **New stock parts:** Mega Fuel Tank (18 t) and Osprey Vacuum Engine (90 kN but ve 4400 —
  the real thrust-vs-efficiency trade). Without them the stock catalog barely escapes Earth.
- **Craft sharing:** 📤 gives a copy-pasteable rocket code (embeds any custom parts it
  uses); 📥 loads one — a friend's game rebuilds it, customs join the palette. Validated
  with friendly errors; round-trip browser-tested.
- **Per-part delete (🗑) for his custom parts** (stock still reset-only). QA fix from the
  session: speed/prograde/altitude readouts are now measured vs the dominant body (parked
  on the Moon reads 0 m/s, not the Moon's orbital speed).

**New 2026-07-04 (his ask): ✨ Teleport-to-orbit.** The 🎯 target picker moved OUT of the
flight-only controls (visible in build mode too), with a ✨ Teleport button under it:
magic-jump straight into a low circular orbit around the picked world, from build mode
(fresh flight, full fuel, same setup as launch) or mid-flight (keeps fuel/stage). Backed by
pure `Physics.parkingOrbit(key, t)` — circular CCW at max(1.35 r, r + 3×atmo height),
entered on the SUNLIT side, nose prograde. Teleport sets `sim.teleported` (Navigator sees
`flight.arrivedByTeleport` and prices out the skipped trip — the Navigator message quotes
the Hohmann coast days for the game AND real scale). Escape/arrival callouts re-armed per
teleport so the trip home still coaches; the "You've escaped Earth" callout now names the
world you actually escaped (`prevSoi`) since teleporting made escaping-from-Mars common.

**Tests (`tests/`, all green, 117 total):** chute 5, mods 37, planets 31, reentry 8,
transfer 14, teleport 22. planets_test.mjs is the Phase-4 suite: hierarchy, SOI, moving-pad
launch, warp stability, Mars window + full mission, sloppy-burn + course-correction rescue,
sky-crane, Jupiter dive. teleport_test.mjs flies a full parking-orbit lap around every
pickable world (Io drifts ~10% — Jupiter's tide, real and fine).

---

## How to run / verify (IMPORTANT)

```
cd space-sim
python3 -m http.server 8011      # any free port; 8000 was often busy on this machine
# open http://localhost:8011
```

- **After ANY code edit, the user must HARD-reload: Cmd-Shift-R.** Chrome aggressively
  caches ES modules; a normal Cmd-R serves stale JS and you'll chase ghosts. (Bit the agent
  again this session — a synced file didn't appear until a cache-busted reload.)
- **The agent CAN run the browser:** copy the folder to the session scratchpad, add a
  `server_preview.py` (chdir to its own dir, bind 127.0.0.1:8012), point the launch.json
  config "space-sim-scratch" at it (UPDATE THE SCRATCHPAD PATH — it's per-session),
  `preview_start`, then drive with preview_eval. Append debug hooks to the PREVIEW COPY's
  main.js only (expose sim/Physics/Render + an advance() loop; rAF only runs during tool
  calls, so drive Physics.step directly). Never add hooks to the real source.
- **Node tests:** `node tests/<suite>.mjs` — put new tests in `tests/`, not scratchpad.
- Syntax-check a module headlessly: `cp js/foo.js /tmp/foo.mjs && node --check /tmp/foo.mjs`.

## Suggested play-test flight plan (for the user + kid)

1. Build big (use the new Mega tank / 3 stages; watch Δv), launch, gravity turn to orbit.
2. Map (`M`), zoom way out — the whole solar system is there. 🎯 stays on Moon for trip one.
3. Moon trip as before (Burn marker → prograde → land → EVA → home).
4. Then set 🎯 Mars: orbit → burn prograde until "You've escaped Earth" → **cut engine** →
   warp (`.`) to the gold Burn marker → burn along gold → watch "Closest pass", nudge at the
   gold arrow until "🎯 on target" → warp ~80 days → capture retrograde → chute + engine landing.
5. For giggles: target Jupiter and fly in (banner + Galileo-probe lesson), or graze the Sun.

---

## File map (`js/`)

| File | Owns | Notes |
|---|---|---|
| `state.js` | BODIES (Sun+planets+Moon), `bodyStateAt`, `dominantBody`, `computeStats` | **`SCALE = 0.1`**. All body data lives here — never hardcode elsewhere. |
| `parts.js` | Stock part catalog (pristine — his worked example) | + Mega tank, Osprey vacuum engine |
| `mods.js` | His part edits: overrides + customs, merge/validate, `removeCustom` | exports the live merged `PARTS` |
| `physics.js` | Adaptive n-body integrator, `computeOrbit`, `transferWindow`, `courseCorrection`, `applyStage` | pure, node-testable |
| `render.js` | ALL Three.js: floating origin, planets/rings/labels, cameras, arrows, markers | see "gotchas" below |
| `builder.js` | Constrained builder UI + palette + { } editor + 🗑 | mutates the SHARED craft in place |
| `ui.js` | Readouts (Around/target/warp/closest-pass rows) + MODE controls + 🎯 picker | |
| `copilot.js` | The **Navigator** (Claude API) + offline stub | solar-system + course-correction prompt sections |
| `main.js` | Game loop, warp tiers, targets, banners, callouts (WORLD_FACTS), auto-chute | PM-owned integration |

---

## Key decisions (don't undo these without reason)

- **Forgiving scaled universe, real physics, teach BOTH numbers.** As before, now system-wide.
- **Superposed gravity everywhere; SOI is a display concept.** No frame switches to break.
- **Guidance philosophy: window for the departure, course-correction for the arrival.**
  Don't try to make the window exact enough to skip corrections — corrections ARE the lesson.
- **Navigator = browser-direct Claude API** (`copilot.js`, model constant `claude-opus-4-8`).
  Key via 🔑 button → localStorage. Never hardcode. If ever hosted, add a server proxy.
- **Kid-lock system prompt** hardened; identity claims ignored; topics locked to the game.

## Gotchas already fixed (don't regress these)

All the Phase 1–3 gotchas still apply (renderer.setSize CSS, emissive materials, fixed map
frame, in-place craft reset, e.repeat one-shots, input blur, palette rows are divs). New:

- **PointLight at astronomical distance renders planets BLACK** (three r160 physical
  falloff). Sunlight is a DirectionalLight re-aimed from the Sun's scene position every
  frame. If a body ever renders black-on-black, check the light, not the mesh.
- **Floating origin lives in render.js only.** Physics stays in world (Sun) coords, float64.
  Anything positioned in the scene must subtract `ORIGIN` first (in JS numbers, not Vector3).
- **Follow-cam must tip toward the local world** (`lookAt` biased along −radial); a camera
  aimed straight at the craft shows only stars from a few planet-radii up.
- **Prograde/speed/altitude are dominant-body-relative everywhere.** A raw `craft.vel` is
  dominated by Earth's 21 km/s solar velocity and gives wrong guidance/readouts.
- **Escape coaching matters:** "burn until escape" naturally overshoots into a Mars-crossing
  ellipse where window guidance goes silent (by design). The Navigator now says CUT ENGINE
  at escape; course-correction covers the rest.
- **transferWindow's "already going" guard** measures stretch from the CURRENT radius toward
  the target (an Earth-radius Sun orbit is already 66% of Mars's radius).

---

## Not done yet / next steps (in rough priority)

1. **User + kid browser play-test of the solar system** (flight plan above). Agent-verified
   only; the kid's reaction to Saturn is the real acceptance test.
2. **Δv/fuel tuning pass** — a Mars round trip with stock parts is possible but tight; watch
   his first attempts. The mod editor is the built-in pressure valve ("make a stronger
   engine" is a feature, not a cheat).
3. **Modding rung 3** — one-line scripts (`if (fuel < 10) stage()`), safe interpreter, NO eval.
4. Staging separation animation.
5. **Real-scale toggle** — still disabled; needs a part-tuning pass first (~9,400 m/s to LEO).
6. Free-return trajectory guidance; takeoff-from-Moon UX polish (both carried over).

## Working style notes

- The project owner iterates fast and tests live — one focused change, hard-reload, screenshot.
- The bar: the **physics is genuinely real** and the kid learns real-world facts, not game trivia.
- Status reports lead with what's done AND what's flagged — outstanding items first, no padding.
- Commit + push to GitHub (`main`) at every milestone.
