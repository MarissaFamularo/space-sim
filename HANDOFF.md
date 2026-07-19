# KONNIE SPACE PROGRAM (formerly Space Sim) — Handoff for the next agent
<!-- Rewritten 2026-07-03 after the overnight Phase-4 build (solar system pulled forward).
     Phase-5 batch added 2026-07-04 (his wish list: landings, looks, probes, Mars moons).
     2026-07-12: renamed KONNIE SPACE PROGRAM; front-door + facilities + EVA batch below. -->

A KSP-inspired browser space game + coding on-ramp, built for a young kid
(advanced reader, ready to learn to code, space/physics/aerodynamics obsessed, graphics snob).
This file is the single source an agent needs to pick up the work. Read it first.

---

## Status (2026-07-19): 🌗🔥 LUHMAN 16 — real brown dwarfs (his ask: "hybrid planet-stars")

His ask via Mom: something too big to be a planet but not hot enough to be a star.
Built the real thing: **The Luhman 16 System** — the actual closest brown dwarf pair
(6.5 ly, third-closest system of any kind, found 2013 by Kevin Luhman — named for the
discoverer, like Comet Konnie). New famous system in famous.js; aliases luhman /
luhman 16 / brown dwarf(s) / twilight / firefly all land on it.

**Flagged / rung 4 (play-test with him):**
- **The ember LOOK is his acceptance test**: teleport to Luhman 16 B — the sky fills
  with a dull rose coal you can look straight at (browser-shot luhman-ember-orbit.png).
  If he wants it redder/darker, the knobs are the two `style.ember` branches in
  render.js makeBodyGroup (color ×1.25; glow stop 0.55) and the star colors in
  famous.js.
- **Twilight's pad is genuinely dusky** (the ember primary lights the system at
  intensity 1.3, sunset-colored, and the pad sits near the terminator) — thematically
  perfect, but if it reads too DARK on his screen, the one knob is the ember branch of
  the sunLight block in render.js buildWorldObjects (1.3 → ~1.6).
- **Kerbin/Pandora/Hundun change faces** (see fix below — they now wear their OWN
  painted descriptors instead of Sol Earth's blue marble; Kerbin's is near-identical
  by design of its def). Worth one Starmap glance with him that nothing looks worse.
- Firefly's teleport callout says "about 0 days of coasting" (it's genuinely that
  close) — honest but clunky; a "hours" formatter in fmtRealTrip would polish it.

**Shipped (rung 3 — luhman-check scripted run 17/17 green, boot smoke + flight check
ALL GREEN, zero console errors; famous_test grew to 107; navigator_check green):**
1. **famous.js `luhmanSystem()`**: A + B at real masses (35.4 / 29.4 M♃, 1 R♃ →
   g0 915/760 = G·M/R², node-checked against the formula), true ~3.5 AU mean
   separation (real orbit ~27 yr, taught in the blurb), companion SOI at the
   gravity-balance point (Alpha Cen B pattern). Home **Twilight** + moonlet
   **Firefly** are IMAGINED AND CONFESSED in blurb + facts + Navigator (no planets
   found at Luhman 16 yet — "looking is real science"); their physics is honest: at
   0.008 AU (a brown dwarf's real warm zone) Twilight's year is 38,851 s ≈ 10.8 h —
   predicted first, node-tested, and browser-measured at 0.00% error. Lantern
   Station overhead. Game map draws it 4.8 ly (deterministic galaxy geometry);
   blurb + Navigator teach the real 6.5.
2. **`style.ember` render support** (ARCHITECTURE "CONTRACT REVISION 2026-07-19"):
   coal-glow star material, tinted tight corona, dusk sunlight when the primary is
   an ember. Sol/black-hole lighting untouched (boot smoke + flight check green).
3. **Navigator taught brown dwarfs** (safety block untouched, navigator_check ALL
   GREEN): the 13/80 Jupiter-mass ladder, deuterium, the all-Jupiter-sized quirk,
   B's 2014 weather map + molten-iron rain, WISE 0855 at −20°C, the imagined-worlds
   confession, tidal-lock coaching. WORLD_FACTS for all four bodies.
4. **Latent bug fixed — generated home worlds wore Sol Earth's face**: render.js
   makePlanetCanvas matched painters by ROLE key, so "earth" everywhere got the blue
   marble (hidden since 2026-07-12 by Kerbin's similar palette; Pandora/Hundun were
   affected too). Generated bodies with a `face` descriptor now route to the
   descriptor painter; browser-verified (Twilight renders its dusky purple/ember
   face; Sol boot + Moon flight regression green).
5. **Teleport callouts use real names in generated systems** (main.js): "into
   Twilight orbit!", "around Firefly!" — no more "Earth orbit" off-Sol (same
   role-key bug class as the 2026-07-12 orbit-advice fix; browser-asserted).

No storage changes; parts.js untouched; physics untouched (ember worlds reuse the
star-impact melt path — honest at 1,300°C).

## Status (2026-07-18 latest): 🤖⚡ INTERSTELLAR AUTOPILOT + WARP STREAKS (his ask)

His ask via Mom: "point at a place, do interstellar autopilot, it takes you there —
and you see the stars moving fast past you like Star Trek warp speed." Built both,
honest by construction: the autopilot flies the SAME controls he has (real fuel, real
decades — Rule 3 clean, same doctrine as the school teacher's assists), and the
streaks are speed lines tied to his true velocity × warp.

**Flagged / rung 4 (play-test now):**
- Streak DENSITY/length/flow are taste calls tuned headlessly (constants at the top of
  the warp-streak block in render.js: STREAK_N 220, len/flow formulas). If Paddy wants
  more Star Trek, crank STREAK_N and the `len` clamp.
- The autopilot's callout pacing (burn→coast→flip lines) reads well in text; hearing
  it at real cadence during a 61-year cruise is the play-test.
- Manual-override via ARROW keys is code-verified only (it rides applyControls, which
  the headless harness doesn't run); Z/X/,/. override IS browser-verified. One human
  arrow-tap mid-autopilot confirms the last path.

**Shipped (rung 3 — scripted hands-off voyage ALL GREEN 10/10, zero console errors;
shot warp-streaks.png):**
1. **`Physics.autopilotStep` — the pure policy** (gated, ARCHITECTURE "2026-07-18c"):
   the kid-teachable half-tank rule — spend at most half the tank speeding up; the
   saved half is ALWAYS enough to stop because a lighter ship gets more Δv from the
   same fuel (the rocket equation working for you) — coast, trim only if the track
   would miss the arrival bubble, flip at the panel's honest stop-distance, cut at
   ≤30 km/s. tests/autopilot_test.mjs (11 checks) integrates the whole Sol→Youngcow
   trip: arrives in 67.9 game-years at 13.6 km/s, spends exactly 54 of 108 t
   accelerating, 24.3 t still aboard after braking. The fuel-starved case is honestly
   bad: engaged at 2,500 km/s with 2 t, it reports "dry" and screams through at
   2,485 km/s — no magic braking.
2. **🤖 button on the course panel** (main.js): engages `sim.interstellar.auto`; the
   autopilot steers via the existing aimAtCourse, sets throttle from the policy, and
   is the ONE thing allowed to step warp UP (cruise control, still under the honest
   autopace cap — browser run hit 200,000,000x by itself). Phase-transition callouts
   teach the plan out loud (burn/coast/FLIP/glide/dry). ANY flight key hands the ship
   back ("You have the ship, Commander" — course stays locked, 🤖 one tap away).
3. **⚡ Warp streaks** (render.js, cosmetic): 220 additive speed lines in a tube
   around the ship, streaming opposite the velocity; fade in past ~3c effective
   (speed × warp), length and flow scale with effective speed; follow view only,
   interstellar only, hidden in build mode. CONFESSED in the Navigator prompt: real
   interstellar space would look almost still — the lines exist so velocity × warp is
   something you can feel.
4. **Navigator taught** (safety block untouched, navigator_check ALL GREEN): snapshot
   `flight.interstellar.autopilot` phase; INTERSTELLAR bullet teaches the half-tank
   rule, the honest "dry" failure, hand-back-on-touch, and the speed-line confession —
   plus "encourage flying the flip himself once he's seen the autopilot do it."

Verified: 16 node suites green; browser voyage end-to-end (escape → panel → pick
Youngcow → one 🤖 tap → burn/coast/brake/glide hands-off → ARRIVED at Youngcow at
26 km/s with 22.9 t, warp self-managed, streak screenshot mid-cruise, Z-key hand-back);
boot smoke ALL GREEN. No storage changes; parts.js untouched.

## Status (2026-07-18 later): 🧑‍🚀 THE ASTRONAUT COMPLEX — pick your crew, science recruits more

Mom remembered a crew-chooser that turned out to be design-doc-only
(space-game-design.md "Later: picking your crew by name") — so it got built for real,
same live session. A fifth Space Center building where the player picks WHO flies.

**Flagged / rung 4 (play-test now):**
- The unlock ladder is tuned blind: 3 Connies free, then Yuri 25 / Mae 60 / Chris 110 /
  Katherine 180 / Boa 260 lifetime science. HIS actual science balance decides how this
  lands — if everything's already unlocked (or the top feels impossible), the numbers
  are one column in connies.js CONNIES. Science is a threshold, never spent.
- Multi-crew is mostly voice: commander + crewmates in the launch callout, the whole
  crew in the Navigator snapshot. Only the commander EVAs / appears beside a landed
  ship (the Connie mesh is singular) — if he asks "where's Sally?", that's the honest
  answer and a natural next rung (crew portraits in the HUD is the design-doc idea).
- School mode regression is node-green (school suite passes; school flights ride the
  same launch path, so her flight now flies his picked commander silently — the school
  overlays hide the callout, no visible change). Worth one school run-through to be sure.

**Shipped (rung 3 — scripted browser run 11/11 green, zero console errors; screenshots
campus-complex.png / complex-picked.png):**
1. **connies.js grows the roster contract** (gated, ARCHITECTURE "CONTRACT REVISION
   2026-07-18b"): per-Connie `unlock` thresholds + pure helpers (`pickCrew`,
   `parseCrewSave`, …). A Connie without `unlock` counts as 0 — his kid-added customs
   always fly. New save key **`spacesim.crew.v1`** `{v:1, picked:[names]}`, pick order
   = seating order, garbage-tolerant, catalogued in the constants skill.
2. **Pods have real seats** (parts.js, ids untouched): Acorn Pod 3 — the Apollo number
   — Swift Cockpit 2, probes 0. `computeStats` gains `seatCount`; builder HUD shows
   "Seats 🐍".
3. **🧑‍🚀 ASTRONAUT COMPLEX** (menu.js): fifth campus building (glass star-dome, lit
   windows, a Connie out front); inside, 8 portrait cards (seeded snake colors, bubble
   helmets) — tap to crew up, first pick wears ⭐ COMMANDER, locked cards go grayscale
   with "🔒 joins at N 🔬" and the remaining count. Science balance shown live
   (Menu.init gains `getScience`).
4. **assignCrew flies the picked crew** (main.js): seats from the craft's crewed pods,
   `sim.crew` stays the commander (zero ripple to existing callouts), new
   `sim.crewList`; launch callout greets the whole crew by name. No picks → one random
   unlocked Connie (exactly the old behavior); locked picks quietly stay home.
5. **Navigator taught** (safety block untouched — navigator_check ALL GREEN): snapshot
   gains `flight.crewMates`; THE CREW bullet now covers the Complex, real seat counts,
   commander/crewmate roles, and coaching toward science when he wants a locked Connie.

Verified: 15 node suites green (new tests/crew_test.mjs, 22 checks: ladder, garbage
saves, pick order/locks/seat caps/fallback, seat counting); browser end-to-end (120
seeded science → 6 unlocked/2 locked, picks persist, 3-seat launch flies
Mae/Sally/Chris in order, callout names all three, probe flies empty); boot smoke ALL
GREEN. His five old keys untouched; parts.js ids stable.

## Status (2026-07-18): 🪨 RING FIXES — teleport flicker, asteroid rings (his ask), map pan

Live session with Mom + Patrick at the desk. Three gripes, three fixes, each
browser-verified same-day (scratch harness now runs on the Mac via system Chrome —
both skill scripts gained a `channel: "chrome"` fallback, noted in the skill).

**Flagged / rung 4 (play-test now, they're right here):**
- Hard-reload first (Cmd-Shift-R) — Chrome will serve stale modules otherwise.
- Ring look is HIS acceptance test: teleport to Hundun (parks clear of the ring now,
  855 km up), drag the camera down, warp ~100x and watch the inner rock shell lap the
  outer — that differential spin IS Kepler's third law; if he asks, the Navigator's
  existing Saturn lines ("snowflakes to houses") already tell the truth about sizes.
  Rock size/count knobs live in the `style.rings` block of render.js makeBodyGroup
  (900 trials/shell, size `b.radius * (0.006 + s*0.004)`).
- Map pan clamps nothing: pan far enough and everything is off-screen — M twice
  re-centers (deliberate; zoom-out also recovers). If the kids get lost anyway, a
  "re-center" button would live next to the Map view button.
- Saturn's map-view ring is a touch dimmer than before (band sheet opacity 0.5 under
  the rocks) — if it reads washed out on the school laptop, the opacity is in the
  same render.js block.

**Shipped (all rung 3 — scripted browser runs, zero console errors):**
1. **✨ Teleport parks CLEAR of rings/discs** (physics.js parkingOrbit, gated Rule 3 —
   ARCHITECTURE "CONTRACT REVISION 2026-07-18"): parked arrivals sat at 1.35 R, dead
   inside Hundun's ring band (1.25–2.3 R) — the ring plane filled the sky and
   shimmered (Mom's report, reproduced headlessly). Ringed worlds (`style.rings` +
   Saturn) now park at ring-outer × 1.15 = 2.645 R; forming-disc worlds (Centdra) at
   disc-outer × 1.15 = 4.14 R. Numbers predicted then measured: Hundun 855.4 km /
   1300 m/s exactly. New shared constants `RING_BAND` / `FORMING_DISC_BAND` in
   state.js — render draws with them, physics parks around them (catalogued in the
   constants skill). teleport_test.mjs grew to 30 checks (Saturn, Hundun, Centdra
   clearance + circular speed).
2. **🪨 RINGS ARE ROCKS** (render.js, cosmetic; his ask "filled with asteroid"): every
   ringed world gets three seeded rock shells (Points, lumpy-sprite chunks, ~450
   rocks/shell) whose radial density follows the painted band's alpha — the Cassini
   Division stays a genuine gap in the rocks. Each shell turns at ITS radius's true
   Kepler rate (ω = √(μ/r³), from the body's real mu) — inner laps outer under warp.
   The old banded sheet stays underneath at opacity 0.5 for the map-zoom read.
   Browser-verified: Saturn map view (band + gap + grain), Hundun close-up (chunks
   resolve), rocks move across 20 min of sim time, zero errors.
3. **🗺 MAP VIEW DRAG-TO-PAN** (render.js): the "can zoom but not look around" gripe —
   follow-view drag-look always existed; the MAP had no pan. Drag now slides the map
   with the cursor (world-per-pixel from mapFrame; works from the pad-side map too —
   ordering fixed so the hidden build camera doesn't steal the drag). Re-entering map
   view re-centers. Follow-view drag-look regression-checked green. Hint text updated
   ("drag — look around your ship, or pan the map").

Verified: all 14 node suites green; boot smoke ALL GREEN (9), flight check ALL GREEN
(14), plus the two new scripted runs (map-pan 4/4, rings 4/4). No localStorage or
parts.js changes — saves untouched. NOT committed/pushed yet (working tree also holds
prior uncommitted work; Mom decides when to deploy).

## Status (2026-07-16 latest+3): 🎒 SPACE SCHOOL — his little sister can play now (Mom's ask)

Mom's ask: the 5-year-old sister (great at typing, can't read yet) wants to play.
Built: a fourth Space Center building, **🎒 SPACE SCHOOL** — a talking classroom
(browser speechSynthesis, offline, zero assets; falls back to silent text) where every
instruction is SPOKEN, buttons are huge, and words are one-per-button. She types her
name once for her astronaut badge (the typing she's proud of), then three lessons:

1. **🧩 BUILD IT** — five blinking slots filled bottom-up like a tower (🔥 engine →
   ⛽ tank → ✂ decoupler → 🐍 pod → ☂ parachute — real capsule anatomy). Wrong tap =
   friendly wobble + spoken pointing hint, never a scold, never auto-fixed.
2. **🚀 FLY IT** — her rocket on the real pad, SHE taps the 5-4-3-2-1 countdown and the
   big red button: REAL physics, straight up. Crossing the top of the air = confetti,
   "you are in SPACE!", teacher cuts the engine out loud ("now we FLOAT" — freefall is
   the lesson) and gently time-warps the coast (5x; taps always happen at 1x).
3. **☂ COME HOME** — falling, she taps ✂ (booster falls away — staging is LOAD-BEARING,
   see below) then ☂; touchdown at the chute's ~3.5 m/s. Stickers + certificate.

**The physics found the design (predict-then-check, tests/school_test.mjs, 43 checks):**
the booster comes home with ~2.3 t of unburned fuel — ballistic coefficient so high the
stack NEVER slows below the chute's 250 m/s opening limit and hits the ground at
~500 m/s (node-proven negative test). Dropping the empty bottom is what saves the
flight, exactly like real rockets. So the ✂ tap is the mission-critical lesson, with
two honest safety nets: the teacher stages FOR her below 3 km ("I helped —") and the
existing auto-chute below 2.5 km. Her first flight is un-loseable by physics, not fudge.

**Isolation (Rule 2):** her whole save is ONE new key `spacesim.school.v1` (name +
3 stickers, garbage-tolerant load, node-tested; catalogued in constants-and-storage
skill + ARCHITECTURE "CONTRACT REVISION 2026-07-16d"). School writes NO other key, and
the school stack (no probe core / hub) cannot deploy satellites or stations — his
persisted world is untouchable from school mode. His five keys verified untouched in
the browser run. Physics/parts.js/Navigator safety block untouched; Navigator taught
one Space School knowledge paragraph (navigator_check ALL GREEN).

**Verified:** all 14 node suites green (school suite: build-order, sticker-book
validator, phase machine, and the full mission flown twice with real Physics — taps
and no-taps paths both land soft; apogee 33 km, heat 0.10 max, touchdown 3.5 m/s).
Browser-verified end-to-end on the hook-injected scratch copy (Browser pane, zero
console errors the whole session): boot → center shows the schoolhouse → name typed →
FLY IT locked until built → build with a wrong-tap hint → countdown → real launch →
space celebrate + engine cut + warp 5 + sticker → falling at 21.5 km → ✂ tap staged
(mass 5.75→0.9 t) → ☂ tap ("Parachute out!", and the no-tap run says "I helped") →
landed → certificate "ASTRONAUT ELLIE" with 3 stickers → exit → VAB palette intact →
Moon-teleport regression 0.0007% error. Canvas verified lit via litFraction 0.9999
(WebGL screenshots don't composite between harness tool calls — DOM shots captured).

**Lesson 4 shipped same day (Mom's yes): 🌍 GO AROUND THE WORLD.** Unlocks after the
CAME HOME sticker (falling back is what makes "you must go SIDEWAYS" land). New build:
six slots — the BIG tank ("around the world takes LOTS of rocket food") and a HEAT
SHIELD ("coming home from orbit is fast and HOT"). The flight is the REAL two-burn
ascent profile: her ➡ LEAN tap starts the teacher's gravity turn (setAngle — the
teacher "holds the steering wheel", announced; steering is the one control a 5-year-old
can't work), engine cuts itself when the apoapsis is set ("we threw the ball high
enough"), coast up the hill, then HER 🔥 PUSH-sideways tap at the top catches the
orbit — the single most important idea in spaceflight, in her hands. Then: a full lap
at warp 100 (half-lap callout "you're over the OTHER SIDE of the world"), 🏠 COME HOME
→ tail-first 🔥 deorbit push (teacher cuts it when the periapsis dips into the air),
✂ booster off, glowing shielded reentry with the Apollo line, ☂, touchdown, 4th
sticker. **A one-continuous-burn ascent was tried and REJECTED by the node test: this
stack carries more than escape Δv and flew straight past orbit onto an escape path —
the two-burn profile isn't pedagogy garnish, it's what makes the mission fly.**
Nets: teacher lean-assist at 12 km, push-assist if the top passes untapped, fuel-out
falls back into the Lesson-3 nets (stage + chute), assist-stage + auto-chute on the
way home. Verified: school suite grew to 66 checks incl. the full orbit mission with
real physics (insertion margin 1.15 t, lap holds above 15 km, reentry peaks 2,544 m/s
at heat 0.11 behind the shield, touchdown 4.0 m/s exactly as predicted); browser run
end-to-end (build w/ wrong-tap → countdown → lean → coast → push → 22×81 km orbit →
lap → deorbit → stage → glow line → chute → landed → 4-sticker certificate), zero
console errors. Push-assist and fuel-out paths are machine-tested (node), not flown
in the browser — they're nets, not the happy path.

**Rung-4 feedback already in (Mom flew it, same day):**
- "After the space cheer it just goes on and on — it doesn't say what to do." TRUE:
  the coast over the top was a silent ~25 s. Fixed: ~5 s after the celebration the
  teacher now says "Nothing to press yet — we're floating up and over the top! Watch
  the little rocket on the ladder. When we start falling, I'll call you!" (school.js
  onTick, coastTicks). Code-verified + all suites green; the say() path it rides was
  browser-verified above — worth an ear on her next flight.
- Keyboard stays LIVE during school flights — Mom's explicit call. A keys-blocked
  guard was written and REVERTED: she isn't key-mashing, and discovering that Space
  fires the decoupler is the on-ramp to the real game. The nets (assist-stage,
  auto-chute, consequence-free crash) already make every outcome safe. Comment at
  the main.js keydown guard records the decision — don't re-add the lockout.

**Flagged / rung 4 (play-test with HER):**
- **Speech is the whole UX and headless can't hear it** — first real run: is the voice
  clear, loud enough, pacing right? speak() uses the default en-US voice, rate 0.95.
  If it's robotic or skips, the one knob is `speak()` in school.js.
- The 3D view behind the flight overlay is verified rendering but not eyeballed —
  glance that the rocket/plume look right behind her big buttons.
- Grown-up panels HIDE during school flights (a click-shield also blocks stray taps);
  verified restored after. If her brother's pad had an UNSAVED build, entering a school
  flight clears it (same as Reset) — craft was never persisted; accepted trade.
- Cards match by emoji + spoken word; if she struggles, real SVG part silhouettes in
  the slots (shape-matching) is the natural next rung.
- Crash path (friendly "Connies always are" + TRY AGAIN) is code+phase-machine tested
  only — hard to reach honestly with the nets in place. Fine.

## Status (2026-07-16 latest+2): 🏛 THE FOUNDERS' VAULT — a real puzzle (Mom's idea)

Cradle Station (over Hundun) now ends in a 4th room: THE FOUNDERS' VAULT. Four
pedestals show HIS worlds scrambled (painted icons: half-molten Sia, ringed Hundun,
Comet Konnie, disc-wrapped Centdra); touch them IN ORDER FROM THE STAR and the
golden door opens on a slowly-turning science crystal — +50 science, once per
boarding. Wrong touch = gentle red flash, 1.4 s lockout, and a rotating Navigator
hint (hint-first voice, never the answer); the online Navigator is taught to coach
the same way and only reveal Sia→Hundun→Konnie→Centdra if he's stuck and asks.
The teaching payload is real: heat sorts solar systems (rock bakes close, ice
survives past the frost line) — his system obeys the same law ours does.
Browser-verified end-to-end: plan = garden→depot→hub→vault, wrong-touch resets,
correct order opens, science awarded exactly once, solved state survives re-entry,
zero console errors. All 13 suites + navigator 18/18 + boot smoke green.
**Flag:** rung 4 is the whole point here — watch him solve it; if it's too easy,
harder puzzle ideas (Kepler timing locks, prime sequences with the alien) would
slot into the same panels-plus-door machinery.

## Status (2026-07-16 latest+1): 🚪 MULTI-ROOM STATIONS — stuff to EXPLORE (his ask)

Every station is now a seeded CHAIN of 2–3 connected modules; adjacent rooms are
always different kinds. The openable hatch wears a GREEN GLOWING RIM and a sign
("→ 🌿 GREENHOUSE"); drift into it and the Connie carries her momentum through into
the next room. Science is per room per boarding (hopping back can't re-farm a spent
screen); the alien resident lives in ONE seeded room; the derelict's salvage log now
waits in its DEEPEST room (venture in for the story); ground bases gained a back
room (live base: the greenhouse). Hint bar shows "room 1/3". Navigator taught (ISS =
~16 modules bolted together — real!). Browser-verified: boarded Harbor, drifted the
hatch, arrived room 2/2 with momentum, stayed (no ping-pong), zero console errors;
all 13 suites + boot smoke green. **Flag:** hatch traversal in a GRAVITY room (walk
into the end wall) is code-verified only — worth one walk-through with him; and the
transition rebuild is instant (no door animation) — if it feels abrupt, a fade would
live in interiorGoRoom.

## Status (2026-07-16 latest): 🛰 STATION FIXES — his two gripes, both addressed

His ask (deferred until after Youngcow + interstellar): "the stations are all the
same in the inside and you dock far away from them."

**Flagged / worth a play-test:** the archetype rooms are browser-verified (screenshots:
harbor=crates+Earth windows, selene=amber tanks+pipes, Cradle=green vines+grow-lights)
but only he can say if they FEEL different enough — if not, each archetype's furniture
lives in one labeled block in enterStation, easy to fatten. The observatory and a
seeded lab weren't screenshotted (random seeds) — worth one boarding tour with him.
Deployed player stations keep the generic EXTERIOR mesh (older flag, still open).

**Shipped (rung 3 — scripted dock+board tour ALL GREEN, zero console errors):**
1. **The station PULLS YOU IN** (main.js): on latch, a retraction winch seats the
   ship flush at the port (12 m — verified; was anywhere inside 150 m), riding the
   station's orbit, nose at the port. Ease the throttle to push off (unchanged rule).
   Real docking works exactly this way (soft capture → retraction) — Navigator says so.
2. **INTERIOR ARCHETYPES** (render.js enterStation): every station is now a KIND of
   place — 📦 cargo hub (crates, straps, loading arm, planet in the windows), ⛽ fuel
   depot (spherical tanks, pipe run, amber light), 🌿 greenhouse (plant beds both
   walls, vines, blooming grow-lights, green light), 🔭 observatory (one giant cupola
   with nebula + ringed world, telescope, dim RED light — real night-vision practice),
   🔬 lab (the classic room). Hand-pinned: Harbor=hub, Selene=depot, Gene's=hub, Jool
   outpost=lab, Hell's Gate & Cradle=garden; seeded everywhere else (same station =
   same place forever). Console kinds follow the archetype (gardens run bio, etc.);
   hint bar names the kind. Derelict + alien + ground bases unchanged.
3. Navigator taught berthing + station kinds (safety untouched, 18/18); all 13 node
   suites green; boot smoke green.
4. **INTERIOR GRAPHICS PASS** (follow-up, his note: "only different in color, no
   details"): the indoor version of the graphics pass — procedural painted-canvas
   textures, zero assets. Every module now has a riveted panel-quilt wall (seams,
   rivets, vents, placards, the archetype's accent stripe — hazard chevrons on
   depots), HATCHES with crank wheels on both end caps, ISS-blue HANDRAILS (real
   station fact), a clamped ceiling conduit run, visible light-fixture housings, and
   diamond-plate DECK GRATING in gravity rooms. Archetype furniture got denser:
   stenciled "CARGO" crates, tank crank-valves, leafy bushes + misting pipe,
   star-chart posters, a whiteboard mid-orbit-derivation, glowing sample vials + a
   microscope; the derelict hangs a torn panel with drooping cables. Browser-verified:
   all 7 interior variants boarded (hub/depot/garden/observatory/lab/spin/derelict),
   zero console errors, screenshots captured.
5. **Spin gravity grounds the room too** (follow-up, Mom's check): in a CENTRIFUGE
   station interior the clutter now sits on the floor and consoles/plant shelves
   stand at floor height, same as ground bases — his rule ("gravity means nothing
   floats") applies to spin gravity, which is the whole lesson of the ring.
   Browser-verified: spin interior opens with everything grounded, zero errors.

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
