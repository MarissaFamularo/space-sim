# KONNIE SPACE PROGRAM (formerly Space Sim) — Handoff for the next agent
<!-- Rewritten 2026-07-03 after the overnight Phase-4 build (solar system pulled forward).
     Phase-5 batch added 2026-07-04 (his wish list: landings, looks, probes, Mars moons).
     2026-07-12: renamed KONNIE SPACE PROGRAM; front-door + facilities + EVA batch below. -->

A KSP-inspired browser space game + coding on-ramp, built for a young kid
(advanced reader, ready to learn to code, space/physics/aerodynamics obsessed, graphics snob).
This file is the single source an agent needs to pick up the work. Read it first.

---

## Status (2026-07-16 later): 🌌 INTERSTELLAR PHASE B — HE CAN FLY TO ANOTHER STAR FOR REAL

Mom confirmed the point of the antimatter drive was flying there — so the roadmap's
Phase B ("the honest travel mechanic") is BUILT. Escape your star for real → a course
panel offers the galaxy neighborhood → burn, warp (two new interstellar-only tiers),
flip and brake → arrive IN FLIGHT at the new system's edge, decades older, fuel as it
really is. The Starmap fold remains as the labeled-magic shortcut.

**Flagged / worth knowing:**
- **Kid play-test needed most here** (rung 4): the full trip is browser-verified
  scripted (below), but the FEEL — panel wording, autopace pacing, the flip moment —
  is exactly what only he can judge. Suggested first trip: build big (6 Mega tanks +
  Annihilation Beam Drive + pod ≈ 4.8e6 m/s of Δv), teleport to orbit, burn to solar
  escape, follow the panel. Sol → Youngcow is 2.77 ly ≈ ~55 game-years flown well.
- Arriving HOT is allowed and honest (the arrival message says flip and burn) — he
  can overshoot the new system and burn back; nothing crashes.
- Stars don't move relative to each other, and relativity isn't simulated (~1% of c);
  the Navigator confesses both if asked.
- The interstellar autopace (warp auto-steps DOWN during burns and near arrival) took
  several scripted-flight iterations to get honest — the failure archaeology is worth
  keeping: naive versions let one warped frame drain the whole tank, skip the arrival
  bubble entirely, or strangle prograde burns via the trim gear. All three are now
  impossible by construction (two-axis Δv gearing + segment-crossing arrival test).

**Shipped (all rung 3 — scripted end-to-end voyage, ALL GREEN, zero console errors):**
- **Real star distances** from the galaxy map's own geometry, calibrated to Pandora =
  Alpha Centauri's true 4.37 ly (stargen `interstellarVector`, node-tested — 15 checks,
  incl. flip-and-brake dynamics: the panel's stop-distance is honestly conservative).
- **Course panel** (main-owned, appears on true solar escape): destinations = famous +
  visited systems (+ home); live board: ly to go, closing km/s, ETA, cruise/drift/BRAKE
  advisories; 🎯 Aim (velocity-steering attitude help — burning stays his) and ✖ clear.
- **Arrival preserves the flight** (`arriveFromInterstellar`): system swaps under the
  ship, craft placed at the new edge with its true inbound velocity + fuel; 🎯 set to
  the new home; arrival brief celebrates the real voyage and the game-vs-real 10x.
- **Verified numbers** (scripted voyage): accel 1,529 km/s on the beam drive, flip on
  the panel's cue, brake to 26 km/s, arrive Youngcow at the edge with 16 t fuel after
  54.6 game-years; all 13 node suites green (323 checks); navigator_check 18/18; boot
  smoke green. Saves untouched (no schema changes).

## Status (2026-07-16): 🐄✨ THE YOUNGCOW SYSTEM — his full spec (via Mom), plus warp burns + antimatter

His design, built end-to-end: a BABY solar system ("Youngcow", famous.js — aliases
youngcow/hundun/sia/centdra/ember land on it, in FAMOUS_LIST + galaxy map).

**Flagged / NOT verified at rung 4 — worth a play-test with him (exact steps below):**
- Dino-birds + plant tufts, ground-base structures/interiors, and ring-rock strikes are
  **code-verified only** — no scripted landing was flown. Play-test: Starmap → Youngcow →
  Launch from Hundun's pad → land near the pad (bases are ~3 km off, glowing greenhouse +
  gold beacon) → the Navigator nudges "press B" → walk both interiors (science base:
  gravity, greenhouse, consoles; Old Nest: wreck, claw scrapes, log console = the herd
  story). While landed, wait ~1–7 min at warp ≤100: ring rocks streak down; ~1/3 hit and
  break a chute/legs/solar/wing/dock FOR THAT FLIGHT (never his saved design — Rule 2).
- Inside Comet Konnie's coma the sky washes olive-tan (you ARE inside a comet's haze —
  arguably honest, but it's a taste call; the tail/coma live in one block in
  makeBodyGroup if it needs dialing down).
- Ember's stretched orbit ring: drawn correct (code + shared-math with node-tested
  bodyStateAt) but only glimpsed in map screenshots — check the ellipse LOOKS obvious.
- Stations feel samey inside + docking parks far out — HIS NEXT ASK, deliberately not
  started ("do everything with the new system first and then we can talk about stations").

**Shipped, browser-verified (headless: boot-smoke, flight-check regression, plus a
scripted Youngcow tour + warp-burn/antimatter flight — all green, zero console errors):**
1. **ELLIPTICAL RAILS** (gated contract change, ARCHITECTURE.md updated): body defs may
   carry `ecc`/`periAngle`; `bodyStateAt` Kepler-solves (new `solveKepler`), orbit rings
   + Tracking Center draw true ellipses. Node-tested (tests/ellipse_test.mjs, 15 checks:
   vis-viva, second law, closure, e=0 identity). First users: Ember (e=0.45), Comet
   Konnie (e=0.6).
2. **THE YOUNGCOW SYSTEM**: young yellow dwarf + protoplanetary dust disc (ALMA-style
   gap lanes); tidally-locked lava **Sia** (molten hemisphere aimed at the star per
   frame — browser-verified on the limb); home **Hundun** (green, ringed, launchable,
   g0 8.6) with elliptical lava moon **Ember**, lumpy accreting tinyMoon **Pebble**
   INSIDE the ring (displaced watertight sphere), grazing armored **dino-birds** +
   plants, **two ground bases** (B to enter; real-gravity interiors — nothing floats,
   his rule; wrecked one tells a kid-safe herd-stampede story, new science kind
   `basewreck` +15), and **ring-rock strikes** (`Render.spawnMeteor` + main
   updateMeteorRain); **Comet Konnie** (comets named for discoverers!) — low-but-nonzero
   gravity, ORBITABLE (browser-verified: stable 1 km orbit at 3 m/s), coma + tail that
   points away from the star and grows sunward; **Centdra** still forming in the disc
   with a fast circumplanetary disc; leftover-asteroid swarm (young flag). famous_test
   grew to 83 checks.
3. **ANNIHILATION BEAM DRIVE** (parts.js, gated; ids stable): antimatter engine, ve
   2,000 km/s, violet LASER-LANCE plume tier (ve ≥ 1e6), bespoke "beam" part mesh.
   Honest teaching: CERN/PET real, nanogram supply, ~600 yr to the nearest star.
4. **BURN WHILE TIME-WARPING** (gated Rule-3 change, ARCHITECTURE.md updated): thrust
   no longer pins substeps to 0.1 s — accuracy caps (≤2% mass, ≤80 m/s per substep) +
   fuel/mass now drain PER SUBSTEP (the old per-call bookkeeping was 8% off across a
   warped frame — found by predict-first testing, tests/warpburn_test.mjs, 10 checks:
   Δv exact to Tsiolkovsky, near-straight brachistochrone < 0.5% deviation, warpLimited
   honest, pad burns still fine). main.js no longer zeroes warp on throttle (steering
   still snaps to real time). Browser-verified: 1,327 km/s gained under 1000x warp,
   fuel drained, no crash.
5. **Navigator taught everything** (safety block untouched — navigator_check 18/18):
   Youngcow paragraph (his design, say so proudly; every fact tied to real astronomy —
   HL Tauri, Kepler's 2nd law, Arrokoth, comet naming, PDS 70c), antimatter + warp-burn
   lines, snapshot gains `flight.nearBase`. WORLD_FACTS for all six new worlds.

**Verified**: all 12 node suites green (293 checks, +2 new suites); navigator_check
18/18; headless browser: boot smoke ALL GREEN, Moon-lap flight regression ALL GREEN,
Youngcow scripted tour ALL GREEN (screenshots in the session scratchpad). Kid's saves
untouched: no localStorage schema changed; parts.js only APPENDED a new id.

## Status (2026-07-12 later still): 📖 THE WISH BOOK (Mom's ask: "keep a list of his ideas")

He tells the Navigator ideas in real time; Mom wants to ask for them later. Shipped, all
in js/copilot.js (safety block untouched — navigator_check grew to 18 checks, green):
- **Capture, online**: new WISH BOOK paragraph in the SYSTEM prompt — when the kid shares
  a game-improvement idea, the model replies warmly and appends `[[WISH: short phrase]]`;
  `ask()` harvests the marker (new pure `harvestWishes()`, exported + node-tested), strips
  it from the display AND history, saves via `saveWish()`, and appends a deterministic
  "📖✨ (Wrote it in the Wish Book…)" confirmation ONLY when something was actually
  written — game-level truth, not a model promise.
- **Capture, offline**: no key needed — the stub catches "idea: …", "I wish…", "you
  should add…", "it would be cool if…", "can you add…" and writes the message directly.
- **Storage**: `spacesim.wishlist.v1` — `[{when: "YYYY-MM-DD", idea}]`, 160-char ideas,
  case-insensitive dedupe, capped 40 (new versioned key; Rule 2 clean). Catalogued in the
  constants-and-storage skill; snapshot schema row added to the navigator skill.
- **Read-back**: snapshot gains `wishlist` (last 15) so the online Navigator can answer
  "what's in the wish book?" / "what does he want built?"; the offline stub answers the
  same question keylessly with the numbered, dated list.
**Verified**: navigator_check 18/18 (safety phrases + ordering intact, marker parse
round-trip); all 10 node suites still green; browser-verified offline path end-to-end
(fresh copy, cleared key: "idea: lasers that mine asteroids" and "I wish the game had a
space elevator" both captured to localStorage, "what's in the wish book?" read both back
numbered with dates; zero console errors). **Flagged**: the ONLINE marker path is
node-tested but not flown against the live API (no key in the test browser) — first real
session with his key is the honest test; if the model over- or under-captures, tune the
WISH BOOK paragraph's trigger examples, not the parser. Mom: ask the Navigator "what's in
the wish book?" anytime — works even with no API key.

## Status (2026-07-12 later): 🌟 PANDORA IS A TRIPLE STAR (his ask: "Pandora should be a binary")

He's right, and the real thing is even better — Alpha Centauri is a TRIPLE. Shipped:
- **Alpha Centauri B + Proxima Centauri added to the Pandora system** (famous.js): B is an
  orange K-star at the TRUE 23.5 AU average A–B separation (real orbit is a stretched
  80-year ellipse, 11–35 AU — rails are circles, so we draw the average and the arrival
  fact teaches the ellipse). Proxima is a real-sized red dwarf (0.122 M☉, g0 1410 — real!)
  drawn at 70 AU, ~200x closer than its true ~13,000 AU; the compression is CONFESSED in
  the blurb, same honesty deal as the galaxy map. Both are in the 🎯 picker (teleport to a
  star orbit works). Node-tested: famous_test grew to 55 checks.
- **Companion-star SOI fix** (famous.js post-build): buildCatalog's Laplace SOI assumes a
  tiny mass ratio; B at 0.82x A would get a 21.7 AU sphere swallowing half the map and
  flipping readouts to B across the outer system. Companions use the gravity-balance point
  instead (r = a·√q/(1+√q), ~11.2 AU for B). Property-tested: pull from B equals pull from
  A at the SOI edge; no planet's orbit ever enters a companion's SOI.
- **Stars melt, gas giants swallow** (physics.js one-liner, gated Rule 3 — messaging
  classification only, no trajectory change): a star-styled non-solid body sets burnedUp,
  not sankIntoClouds — so flying into B never prints "gas giants have no ground" about a
  star. main.js banner + Navigator crash lines generalized ("☀️ MELTED BY ALPHA CENTAURI B";
  coolest stars are still over 2,000°C — verified real).
- **Latent orbit-advice bug fixed** (main.js): the "captured around a new world" callout
  looked up BODIES[name.toLowerCase()], which misses famous/generated keys ("acb" ≠
  "alpha centauri b") and would coach "To land: lower your periapsis" while orbiting a STAR
  (or a generated gas giant, pre-existing). Now falls back to lookup by display name.
- **WORLD_FACTS** for both stars (80-year ellipse fact; Proxima 4.24 ly + Proxima b, 2016);
  Navigator FAMOUS SYSTEMS line updated ("we show one" → all three, compression confessed);
  starLabel now "triple star (Alpha Centauri A + B + Proxima)"; new aliases (proxima,
  alphacentaurib, centauri…) land on Pandora.

**Verified**: all 10 node suites green; navigator_check passes (safety block untouched —
only the FAMOUS SYSTEMS knowledge line changed). Browser-verified from a scratchpad copy:
boot clean (zero console errors), Starmap hint shows "under three real suns", travel to
Pandora prints the new blurb, 🎯 picker lists both stars, map view zoomed out shows A + B's
23.5 AU ring + Proxima's 70 AU ring. **Flagged / not done**: the star-melt crash path is
code-verified only (nobody flew into B — a fun play-test: ✨ Teleport to Alpha Centauri B,
lower periapsis to 0); companion stars don't ILLUMINATE other worlds (only the sun is a
light source — at 23.5 AU B's light really is ~1/2000 of A's at Pandora, so the dim render
is accidentally honest; noted, not built). Worth one human play-test: Starmap → Pandora →
map view, zoom out, count the suns with him.

## Status (2026-07-12): KONNIE SPACE PROGRAM — his six-item wish list, all browser-verified

His ask (via Mom), all shipped this session:
1. **Formal name: KONNIE SPACE PROGRAM** — title tag, README, Navigator prompt + greeting.
2. **Title screen** on open (menu.js): starfield, big gradient title, ▶ START / ⚙ Settings.
   Settings = graphics Fancy/Fast (new `Render.setQuality`; "fast" skips bloom for school
   laptops, persisted `spacesim.settings.v1`) + Navigator key (same LS slot as the 🔑 button).
3. **KONNIE SPACE CENTER** screen (menu.js): SVG campus at dusk — 📡 Tracking Center,
   🏗 VAB, ✈ Space Plane Hangar, each clickable; launchpad/flag/water-tower dressing.
   In-game "🏢 Space Center" button (MODE panel) returns there; menus swallow flight keys.
4. **📡 TRACKING CENTER** (tracking.js, 2D canvas — NOT three.js): live map of the whole
   active system with every world, satellite, station, and the flying ship. Zoom (wheel/
   buttons/⤢ fit), drag pan, click-to-track (gold ring + info card: height over body, lap
   time, power), fleet + worlds side list, and a "sky clock" fast-forward (preview-only
   clock, up to ~17 hr/s) so he can WATCH orbits go around. Positions come from the same
   pure math the sim flies (bodyStateAt / satellitePos / station elements) — the map can't lie.
5. **✈ SPACE PLANE HANGAR + parts**: `Builder.setFacility` filters the palette by the new
   `PartDef.facility` tag. New hangar parts: Swift Plane Cockpit, **Delta Wings** (REAL
   lift-lite in physics.js: perpendicular to airflow, ∝ dynamic pressure × sin(AoA), stalls
   past CL 1.3, nothing without air — node-tested: glides hold altitude, zero effect on the
   Moon, stall capped), Station Hub, Habitat Module, **Centrifuge Ring**. New craft counts
   wingCount/stationCount/centrifugeCount; HUD rows; mods TYPES gained wing/station/centrifuge.
6. **🛰 BUILD-YOUR-OWN SPACE STATIONS**: a Station Hub makes a build deployable — reach a
   stable orbit (fly or ✨ Teleport) and a "🛰 Deploy as Space Station" button appears;
   deploy freezes it on a circular orbit at the current radius, PERMANENTLY
   (`spacesim.playerStations.v1`, folded into STATIONS per system: dockable, boardable,
   in the 🎯 picker "(yours!)", gold in map + Tracking Center). **Centrifuge Ring aboard ⇒
   the interior has GRAVITY**: enterStation spin mode — the Connie walks/jumps on the floor
   instead of floating (browser-verified: built hub+habitat+ring+solar+dock, teleported,
   deployed "Rocket One", flew a crewed dock ship out, docked, boarded, stood up).
7. **EVA ANYWHERE (E)** — his favorite: E undocked in space = SPACEWALK (arrow-key nudges,
   zero-g coasting, visible tether that tugs back past ~42 m, McCandless lesson); E landed =
   boots on the ground (walk/hop at the world's REAL g0). Physics/time freeze (same rule as
   interiors, `Render.isInside()` covers both). Guards: no EVA from probes (nobody aboard),
   none inside an atmosphere mid-flight (Navigator explains). E returns to the ship.

**New 2026-07-12 later — 🛡 HEAT SHIELD part (his ask: "he'll keep burning up").**
`heat_shield` (`type:"shield"`, 0.3 t, blunt copper dish w/ charred face, rides under the
pod). Physics: `SHIELD_HEAT_FACTOR = 0.25` multiplies the heating equilibrium when
`craft.shieldCount > 0` — a shield makes normal reentries survivable but is a CORRIDOR,
NOT IMMUNITY: a straight-down lunar-return dive still burns even shielded (tested — the
real Apollo-corridor lesson). Reentry + burn-up Navigator callouts now coach shield vs
angle depending on `shieldCount`; snapshot gains `flight.hasHeatShield`; HUD row; mods
TYPES gained "shield". reentry_test.mjs grew to 12 checks (bare burns / shielded survives
at 0.77 heat / shielded suicide dive still burns). Corridor tuning note: at lunar-return
speed the survivable band is genuinely narrow (real!) — if the kid finds it TOO narrow,
soften SHIELD_HEAT_FACTOR (0.25 → 0.2) rather than touching HEAT_EQ_K.

**Verified**: all 9 node suites green (181 checks, incl. new tests/hangar_test.mjs);
browser end-to-end with screenshots (title → center → tracking zoom/track → hangar build →
teleport → deploy → dock → centrifuge walk → spacewalk w/ tether → sunlit Moon ground EVA →
space-plane build with wings). Zero console errors. Contract changes recorded in
ARCHITECTURE.md "CONTRACT REVISION 2026-07-12".

**Also 2026-07-12 (his ask): 🌟 FAMOUS SYSTEMS.** The universe is pre-populated with
hand-built legends (js/famous.js, resolved before the seeded generator; aliases like
"kerbin"/"KSP"/"avatar" all land on the canonical name): **The Kerbol System** — all of
KSP at TRUE canon scale (defs are canon ×10, so SCALE=0.1 lands exactly: Kerbin 600 km,
canon mu/SOI/year, Jool's five moons, Eve's brutal thick air) — and **The Pandora
System** (Avatar): home is a MOON of gas giant Polyphemus around Alpha Centauri A, with
Hell's Gate Station overhead. First system where "earth" doesn't orbit the star —
buildTargets and tripDaysFromEarth were generalized for it. Famous systems appear in
the Starmap panel and pre-lit on the galaxy map; custom arrival briefs; Navigator
taught the homages + real-vs-fiction lines. tests/famous_test.mjs (41 checks; 222 total
across 10 suites). Browser-verified end-to-end.

**Flags for the next session**:
- The Tracking Center "YOUR FLEET" header also lists the built-in Sol stations (Harbor/
  Selene/Kestrel) — arguably fine (it's "everything up there"), rename to "IN ORBIT" if he minds.
- Settings "Fast" mode is code-verified only (composer skip) — worth one glance on the school laptop.
- Wings give lift but there's no runway/horizontal-takeoff mode — planes still launch
  vertically or teleport; a real runway takeoff is a natural next ask.
- Deployed stations all reuse the generic station mesh (ring included) — rendering the
  actual built stack as the station mesh would be a lovely follow-up.
- ✨ Teleport to a world always parks at the same spot for a given time — deploy two
  stations around one world back-to-back and they start nearly co-located (they drift
  apart only if radii differ). Cosmetic, not a bug.

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

**New 2026-07-05 latest+3 — DOCKING PORTS, STATION TELEPORTS, AND: GOING INSIDE. 👽**
- **Docking Port part** (`type:"dock"`, nose-mounts on the pod like Apollo's probe —
  builder Rule 1 got a "nose gear" exception for chute+dock stacking; "dock" added to
  mods TYPES so he can mod ports too). **Docking now REQUIRES one aboard** — a perfect
  rendezvous without it holds position and teaches why. HUD shows "Docking port ready".
- **Teleport to stations:** 🛰 entries in the target picker; ✨ Teleport parks you 250 m
  off the port, speeds matched, nose aimed — the final approach is his to fly. BUGFIX
  found by test: docking/station proximity only engaged when status was "flying" —
  stable "orbit" (where stations LIVE) was excluded. Now flying|orbit.
- **STATION INTERIORS** (render.js `enterStation`/`updateInterior`; borrow the composer
  via `_renderPass` scene swap so bloom works inside): dock, press **E**, and the
  Connie floats INSIDE. Zero-g drift on arrow keys (nudge + coast + soft wall bounce),
  seeded per system+station so no two match (module size, wall tint, windows with
  baked starfields, ring frames, cargo, plant rack). Physics/time FREEZE while aboard
  (main frame() early-out). E exits, back to the docked ship.
- **🔬 SCIENCE:** glowing consoles (bio/materials/astro) fire on proximity — each pays
  Science points (persisted, `spacesim.science.v1`, HUD row) + a REAL zero-g fact
  (spherical flames, light-seeking roots, why telescopes live in space). The derelict
  interior is dark with one flickering red light, drifting junk, and a salvage log
  (its final entry tells the meteor story).
- **👽 ALIENS: some stations in GENERATED systems have a friendly resident** (~45%
  deterministic per system+station; never in Sol — the real system stays honest, and
  the Navigator says "no alien life found YET, and looking is real science"). Big
  Connie-style eyes, seeded skin color, gentle bob, its own magenta glyph console
  worth double ("alien science"); it hums in primes — the Navigator teaches why math
  is humanity's expected first-contact language. VERIFIED: greeting + interior variety
  + console science browser-tested end-to-end (Sol Harbor Station: dock→board→science
  →exit all green); the alien's own console fires the same proximity path but wasn't
  reached by the scripted drift — worth one human play-test (seed "Neon", home
  station, drift right and slightly down).

**New 2026-07-05 latest+2 — HIS MORNING WISH LIST (all four, browser-verified):**
- **Galaxy on the map:** zoom the map past the last planet and every system he's visited
  (plus Sol) appears as a colored ⭐/⚫ with its name — deterministic positions
  (`stargen.galaxyPos`, game-compressed band just past Pluto), CLICK ONE TO TRAVEL.
  Real bug fixed en route: with a 5e12 far plane, visible dots project to NDC z =
  1 + 1e-13, so a strict `z > 1` behind-camera test rejected every star — guard now
  tolerant (`window.__galaxyDebug` hook left in for automated tests).
- **Future engines:** ION DRIVE (real: 6 kN / ve 30 km/s, can't lift off — true of real
  ion tech) and STARFIRE TORCH (far-future fusion: 900 kN / ve 120 km/s, magnetic-coil
  nozzle mesh). Engines with ve ≥ 20 km/s burn BLUE (plume, sparks, glow, light).
  Navigator teaches the honest interstellar math (torch → nearest star ≈ 10,000 yr;
  Andromeda = 2.5M ly; the Starmap fold skips what physics won't allow).
- **Map view from the pad** (he asked; the M key already toggled state but render's
  build path ignored it): map now works in build mode — bodies shown, "you are here"
  marker on the pad, transfer windows checkable BEFORE building. Map button moved out
  of the flight-only panel; entering build resets to pad view.
- **EQUATORIAL PAD + SPACE CENTER:** he noticed the pad sat on the texture's north-pole
  ice cap. Every planet mesh (and Earth's cloud shell) now rotates z=π/2 so texture
  poles lie along ±X — the pad (world +Y) sits on the EQUATOR, equators face the
  orbital plane like reality. The pad got a space center: VAB (blue stripe + door),
  crawler-way, mission-control bunker + dish, water tower, propellant farm, flag —
  all in the launchpad group, build-mode only, zero flight cost.
- **🛰 SPACE STATIONS + DOCKING:** `state.STATIONS` (swapped per system like BODIES;
  stargen scatters 1–2 per generated system, ~35% chance the far one is abandoned).
  Sol has Harbor Station (Earth 2.3R), Selene Depot (Moon), and **Old Kestrel Station
  (Earth 3.8R) — the meteor-struck derelict: ring torn to a Π·1.3 arc, snapped dead
  panels, impact scar, 90-point junk cloud + tumbling debris chunks, dead tumble, no
  blink light.** Docking = drift within 150 m under 10 m/s relative (main.js
  `updateStationsSim`): working stations REFUEL the current stage (uses new
  `sim.craft.stageFuelMax`) + Gemini rendezvous coaching; the derelict answers with the
  space-junk lesson and no fuel. HUD "nearest station" row inside 5,000 km; stations
  draw in follow view (<80 km) and as decluttered map dots; Navigator game-state gets
  `flight.nearStation`. NOTE: docking mechanics are code-verified + map/HUD
  browser-verified, but a full scripted rendezvous wasn't flown — worth a real
  play-test pass.

**New 2026-07-05 latest+1 — ⚫ SURPRISE BLACK HOLES (his ask, via Mom).**
- ~7% of Starmap names (deterministic roll in stargen) get a BLACK HOLE instead of a
  star; any name containing "blackhole" summons one on purpose (undocumented in-game —
  let him discover it, or let the Navigator hint). `sys.blackHole` / `BODIES.sun.blackHole`.
- Real where it counts: sized by the actual Schwarzschild radius (~3 km per solar mass,
  6–30 solar masses), planets orbit it like any star (gravity only cares about mass —
  that's the lesson), habitable zone pinned near 1 AU (lit by the DISK, not the hole —
  black holes emit nothing). Home is still guaranteed launchable; all flyability
  property tests cover BH systems too (25/400 random seeds roll one).
- Render (`addBlackHoleDressing`): truly-black sphere, big painted accretion disk
  (additive, HDR so it blooms, spiral lanes carved out, spun by game time in
  updateFlight), photon ring for close approaches, violet map-dot accent; BH systems
  get a dimmer colder key light ("lit by the disk"). NOTE: agent-verified error-free +
  all mechanics browser-tested, but a proper beauty shot of the disk at the right map
  zoom wasn't captured — check it looks right in real play; disk look lives in one
  function if it needs taste adjustments.
- Flying in = "⚫ CROSSED THE EVENT HORIZON" (not "melted"), with the Navigator teaching
  one-way-ness + that orbiting is perfectly safe; arrival brief rewritten for BH systems;
  Navigator game-state knows (incl. "time dilation is real, we don't simulate it (yet)").

**New 2026-07-05 latest — 🌌 THE STARMAP: infinite seeded star systems (Phase A of the
interstellar plan; Mom's ask: "a code so that no matter where he goes, a new system
appears"). This is the project's FIRST revision to the frozen contract — see the new
"active system" section in ARCHITECTURE.md before touching anything.**
- **`js/stargen.js`** — pure seeded generator: any typed name → a deterministic star
  system (star class M/K/G/F, planets on Titius–Bode-ish spacing, frost-line rules:
  lava/desert/rock inside, gas/ice giants with moons + occasional rings outside).
  **The name IS the share code** — same name, same system, on any computer, forever
  (same trick as rocket share codes; tell a friend "Snakestar" and they fly YOUR system).
- **Role keys, not names:** every system keys its star `"sun"`, its guaranteed-launchable
  homeworld `"earth"` (solid, g0 7–11, chuteable air — property-TESTED across 250 seeds
  in `tests/stargen_test.mjs`), and the homeworld's moon `"moon"` (placed at 35–55% of
  the home's actual SOI — a red-dwarf home's SOI is small, fixed "60 radii like ours"
  escaped it; that was a real generator bug the tests caught). So launches, TWR, transfer
  windows, landings, teleports, satellites, and "fly home" all work UNCHANGED out there.
- **Swap machinery:** `state.setSystem()` swaps BODIES/PLANET_KEYS in place (same object
  identity), `SYSTEM.rev` invalidates caches (physics' body list), `returnToSol()`
  restores a pristine snapshot exactly. `Render.rebuildWorld()` (new API) rebuilds all
  body meshes/rings/dots; generated worlds get procedural faces from their stargen
  `face` descriptor (seeded per system+body), stars tint their own glow by class.
  NASA's Earth textures only load for the REAL Earth (`!b.gen`).
- **UI:** 🌌 Starmap button (MODE panel) → name input + visited-systems list
  (localStorage) + "Return to the Solar System". Target picker rebuilds per system
  (home's moon first, planets outward, moons indented, home last). Planets use the real
  exoplanet convention: "Snakestar b, c, d…" — the star itself is "a", teach him that!
- **Navigator knows where it is:** game-state now carries `system` (generated flag, real
  names, and a note telling it to teach generator astronomy — frost line, year lengths —
  instead of claiming Apollo landed there). Arrival brief teaches the same + the share trick.
- **Verified:** 162 node checks green (8 suites); browser end-to-end: Sol → "Snakestar"
  → build + launch from "Hyven" (orange dwarf, 6 planets) → map view → teleport to
  "Snakestar c" → Return to Sol, no console errors.
- **Phase B (not built):** the honest travel mechanic — real solar escape, point at a
  star, the clock pays the real decades. **Phase C:** hand him the generator's dials as
  a modding rung. Both sketched in the 2026-07-05 planning chat with Mom.

**New 2026-07-05 later — FANCIER ROCKET PARTS (Mom picked it from the tier list).
All in render.js `makePartObject` + a `partMat` painted-texture block above it; parts.js
data, physics, stacking, and the frozen APIs untouched. Every part still fits exactly
inside its def's height × radius box, so the kid's modded parts and share codes render
fine (modded cylinders get the riveted tank skin; unknown shapes keep the old plain look).**
- Painted-canvas details, all procedural + cached: riveted panel skin (tanks), orange
  capsule livery with heat-shield band (pod), yellow/black hazard stripes (decoupler —
  yellow/black = "this separates", kept OFF everything that doesn't), crinkled gold MLI
  foil (probe, sky-crane frame), solar cell grid, red/white parachute gores, dark
  ribbed engine-bell gradient.
- Geometry: tanks are lathes with domed shoulders + seam rings + a side fuel line;
  engines have a real curved bell, powerhead, gimbal ring, and turbopump pipes — and
  **vacuum engines (ve ≥ 4000) automatically get the long skinny-throat bell** (the
  shape IS the spec — tell him why); pod is a lathed acorn with portholes and a docking
  ring; fins are swept beveled deltas; legs got shock-absorber sleeves; probe got a
  paraboloid dish + whip antenna + corner RCS; sky-crane shows its spherical fuel tanks.
- GOTCHA learned: metalness ≳ 0.7 under the 2.0 sun makes specular glints cross the
  bloom threshold — the gold probe burned like a lamp until foil dropped to 0.45.
- Verified in-browser: kitchen-sink stack close-ups, launch, and staging (plume attaches
  to the new bell of whichever stage is live).

**New 2026-07-05 (his ask, via Mom: "make the graphics better") — THE GRAPHICS PASS.
All render.js + vendored assets; frozen Render API untouched; physics untouched; all 7
test suites green (and reentry_test.mjs now uses relative imports instead of a hardcoded
Mac path, so it runs anywhere).**
- **HDR + bloom pipeline:** EffectComposer → RenderPass → UnrealBloomPass → OutputPass,
  vendored from three r160's examples into `vendor/postprocessing/` + `vendor/shaders/`
  (same no-internet rule as three itself; pulled from the npm tarball). ACES filmic tone
  mapping, exposure 1.05. **Bloom threshold sits at exactly 1.0**: only colors pushed past
  white glow — the Sun (color ×2.5), engine plume cones, hot reentry plasma, Earth's city
  lights. Normal surfaces can never bloom. Tune in the `BLOOM` const at the top.
- **Engine exhaust plume** (`makeExhaustPlume`/`updatePlume`): white-hot core cone in an
  orange sheath (additive, HDR), nozzle glow sprite, a flickering PointLight that paints
  the rocket, and a 150-point spark trail that cools white→ember through vertex color.
  Throttle drives length; **vacuum fattens the sheath ×1.8** (no air squeezing the
  exhaust — tell him why). Rebuilt with the craft mesh, so staging keeps it on the live
  stage's engines; only shows when throttle+thrust+fuel are all truly on.
- **Real Earth:** NASA Blue Marble day map, Earth-at-Night as the emissive map (cities
  actually glow at night and catch a little bloom), and a drifting cloud shell
  (alpha-mapped, rotates with game time so time-warp spins the weather). Files in
  `vendor/textures/` (~750 KB total, provenance in its README: three-globe/MIT, imagery
  NASA public domain), downsized to 2048×1024 for school laptops. Async-loaded; missing
  files fall back to the painted canvas face.
- **Milky Way skysphere:** real night-sky panorama as `scene.background` (equirect,
  intensity 0.35) behind the existing crisp point starfield.
- **Procedural faces upgraded:** every painted planet now runs through
  `refinePlanetCanvas` — upscaled to 1024×512 and shaded with two octaves of seam-free
  value noise (rocky worlds ±16%, gas/cloud worlds ±7%) so nothing is flat poster color.
  Moon maria/craters got more contrast (they were invisible under the grazing light).
  Saturn's rings are now a banded canvas strip **with the Cassini Division** (ring UVs
  rewritten to radial) instead of a flat translucent disc.
- **LOGARITHMIC DEPTH BUFFER — the big correctness fix.** near=1/far=5e12 in one camera
  left the linear depth buffer with ~500 km buckets at map range; Earth's atmosphere halo
  z-fought the limb in ugly blocks the moment the planet got a real face. GOTCHA for
  future work: any custom ShaderMaterial must include three's logdepth shader chunks or
  its depth won't match the rest of the scene.
- **Lighting rebalanced for ACES** (sun 2.0 / ambient 0.5 / hemi 0.45, part emissive
  floor 0.35→0.22, textured-planet emissive 0.16→0.10). First pass overexposed the Moon
  to a featureless ball — if a body ever looks washed out, suspect these numbers, not the
  textures.
- **Verified by driving the real game** (Playwright + bundled Chromium, screenshots):
  build mode, liftoff plume, ascent sparks, Earth disc from map view (clouds + cities +
  clean limb), Moon disc (maria + craters), Saturn map view (rings + gap), Jupiter,
  teleports, staging. Stars still visible through atmosphere halos from inside — that's
  pre-existing additive-halo behavior, not a regression.
- **Still open (the tiers we discussed with Mom):** fresnel atmosphere rim shader (flagged
  as a good learn-to-code project WITH him — mind the logdepth gotcha above), real maps
  for Mars/Jupiter/etc. if bigger assets are ever OK, terrain relief when landed, GLTF
  rocket parts, a graphics-quality toggle if a school laptop ever chugs (bloom + log
  depth are the two costs; both are single-line disables in `init`).

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

**New 2026-07-04 later (Phase 5 — his wish list, all browser-verified):**
- **Landing visibility:** descent HUD below ~2.5 km over solid ground (radar height + fall
  speed, green/amber/red vs the survivable speed); a landing reticle ring on the ground
  under the ship, same color logic; a two-tier instanced ROCK field (dense strip along the
  ground track + sparse far boulders, deterministic per ground slot) so the surface
  visibly rushes up. All render.js `updateSurfaceExtras` + main.js `updateDescentHud`.
- **Landing Legs part** (`type:"legs"`): survivable touchdown 5→12 m/s descent, 12→18
  total (physics.js LAND_* / LEGS_* constants read `craft.legCount`, set by loadStage).
- **INTEGRATOR BUG FIX found by the legs test:** the collision sweep compared the craft's
  post-substep position against START-of-substep body positions — touchdown triggered up
  to ~|v_body|·h ≈ 500 m early/late depending on landing-site geometry (a radial-aligned
  site could make a soft touchdown read as "still flying" half a km underground). Body
  states now refresh post-integration before the sweep. All prior suites still green.
- **Procedural planet faces** (render.js `makePlanetCanvas`, seeded per body, 512x256
  equirect canvas): Earth continents/deserts/ice/clouds, Mars maria+caps, cratered
  Moon/Mercury/Callisto, Io volcanoes, Europa cracks, banded Jupiter with the Great Red
  Spot, Saturn, Neptune's dark spot, Titan haze, Pluto's HEART, Phobos with Stickney.
  Emissive = same texture (night sides show detail dimly). MAP-VIEW GOTCHA fixed: the
  flat map "dot" used to be drawn AT body scale when zoomed close and z-fought the
  textured sphere as shattered glass — dots now hide once the true sphere is that big.
- **Sky-Crane Thrusters** (engine that allows cargo BELOW it) + **Rover** part: land
  wheels-first MSL-style; while LANDED with a rover aboard, Space releases it (no
  decoupler needed) — it drives off at 0.35 m/s leaving wheel-track lines, parks at 900 m.
- **Probe Core (uncrewed) + Solar Panels + SATELLITES:** no Connie aboard probe-only
  rockets (all crash/landed messaging adapts); staging a probe-core stage off in a STABLE
  orbit deploys a persistent satellite (Kepler elements frozen at release —
  `Physics.makeSatellite`/`satellitePos`, pure; stored in localStorage `spacesim_sats_v1`,
  cap 24). Rendered as a real tiny spacecraft up close, dot+label in map view near its
  world. hasPower (panels in the dropped stage) drives the Navigator's power lesson.
- **Phobos & Deimos** with real data. Their TRUE SOI < their own radius (you cannot orbit
  them — real!), so buildBodies clamps display-SOI to 2x radius (`tinyMoon: true`) purely
  so surface readouts measure from them. `parkingOrbit` gives a FORMATION with the moon
  (matching Mars orbit, 5 radii off, like real Phobos missions) instead of an impossible
  orbit; the Navigator teaches why. Phobos escape speed ≈ 3.6 m/s — bike speed.

**Tests (`tests/`, all green, 141 total: +phase5 20, teleport now 26):** chute 5, mods 37, planets 31, reentry 8,
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

- **Sky crane "had no engine and no rope" (his bug report).** The natural kid build is
  rover / DECOUPLER / crane / tank / pod — and the old staging rule made the bottom rover
  its own engineless, fuel-less stage 0, so launch died with NO ENGINE. Rule now
  (builder.js reflowStages): rover(s) at the very bottom are CARGO and a decoupler right
  above them is the release latch, NOT a stage split. And the rover now visibly HANGS on
  three bridle ropes below the crane (render.js gapBefore/ROPE_GAP in buildCraftMesh),
  with or without the latch decoupler — like the real MSL landing.
- **Landed things "floated" above the ground (his Ganymede bug report).** Two stacked
  causes: (1) body spheres are 48x32-segment — the drawn surface sags up to ~R/470 below
  the true radius between vertices (~560 m on Ganymede) while physics/rocks/Connie sit AT
  the true radius; (2) the craft mesh was rendered CENTERED on the physics point, which
  is really the craft's base. Fix: a finely-tessellated ground-patch cap (render.js
  `ensureGroundPatch`, shown < 25 km over solid ground, own dusty local texture) + the
  craft mesh now renders base-at-point. Don't "fix" this by cranking sphere segments —
  1000+ segments per body is what it would take.
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
