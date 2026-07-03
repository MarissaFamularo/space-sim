# Space Game — Design Doc

*A KSP-inspired space sandbox + coding on-ramp, built for a young kid who's an advanced reader, great with computers, ready to learn to code, obsessed with space/physics/aerodynamics, and (importantly) a graphics snob.*

Status: **Phase 1 playable; Phase 2 (the Moon) built & node-verified (2026-07-01) in `space-sim/`.**
Phase 1 verified in-browser end to end — built a multi-stage rocket and flew it to a stable orbit,
with the Navigator coaching the gravity turn live. Phase 2 adds a real-to-scale Moon (60 Earth-radii
out), transfer, SOI capture, powered landing, liftoff home, and **reentry heating** (plasma glow +
burn-up on too-steep entries; 8/8 automated tests) — Phase 2 is code-complete; browser play-test of
the full Moon round-trip still pending. Map view now shows **Ap/Pe markers** on the orbit.
**Parachutes** (his request, 2026-07-01): a Parachute part rides atop the pod, auto-deploys low over
Earth, floats down at ~4.5 m/s — and does nothing on the airless Moon, which is the lesson.
Working: constrained 3D builder (reorder, engine clusters), flight + staging, follow & **map** views
(map zooms out to the whole Earth–Moon system), forgiving-Earth physics that also teaches the real
numbers, live Claude-API Navigator, and **Connie crew** (see The Connies below). Phases 3–5 ahead.
**Phase 3 MVP started (2026-07-01): part editing is live** — every part opens as JSON via a { }
button (rungs 1–2 of the ladder: change a number / copy-as-mine, friendly failures, Navigator as
coding mentor) — plus a map-view **"Burn" marker + timed gold arrow** for the Moon transfer window
(Apollo-style TLI phasing, node-tested into the Moon's SOI).

Run it: `cd space-sim && python3 -m http.server 8000`, then open http://localhost:8000

---

## The core bet

Don't try to out-KSP KSP. A full clone took a studio years. What we build instead delivers the three things he actually wants — **build freely, real-universe physics, and an AI Navigator** — by simulating deeply where it teaches and approximating where it doesn't.

The unique, buildable, valuable piece is the **AI Navigator**: KSP players go to wikis and YouTube; he gets a Navigator inside the cockpit that can see his ship and his code. That's the thing that doesn't exist anywhere else, and it's the thing we're uniquely good at building.

Second bet, just as important: **the fiction is the wrapper, the facts are the payload.** Kerbal taught him a made-up solar system because the made-up system *was* the content. We invert that — the gameplay is the hook; real astronomy, physics, and JavaScript are what he walks away with.

---

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Platform** | Web browser | No install, reachable anywhere, sharing = sharing text, easiest to build/iterate, and the browser *is* a coding playground. |
| **Physics core (first)** | Orbital mechanics | It's the spine — the "you fall *around* a planet" aha. Everything else bolts on top; it can't be added later. |
| **Physics method** | Superposed gravity (restricted 3-body), planar | *Updated in Phase 2 (was patched conics).* Earth AND Moon both pull the craft every step — more real, and no risky reference-frame switch. Patched conics survive as a **display** concept: an SOI boundary decides which body the orbit readout and map ellipse are drawn around. Orbits live in a plane, so the math stays effectively 2D. |
| **Rendering** | Full 3D (Three.js) | He's a graphics snob coming from 3D KSP; flat 2D would read as a baby game and he'd bounce. 3D *look*, planar physics underneath. |
| **Build screen** | Constrained 3D builder | Full 3D look, but parts snap to a clear vertical axis so he never fights the camera. (Free 3D builder = later, if he wants it.) |
| **Solar system** | Real bodies, real data | Real sizes/gravity/atmospheres/ordering. He learns by bumping into real constraints, not reading trivia. |
| **Language** | JavaScript | Browser-native (zero setup), real and professionally useful, and JSON parts = JS data, so game + mods share one mental model. |
| **Navigator** | Claude API | Sends Claude a structured game-state snapshot + his question; Claude answers about *his* ship. |

**Design value to hold across everything:** *easier but not much easier.* Remove busywork (snapping, readouts, typo-finding); preserve the puzzle (why the rocket won't fly, where the center of mass goes, what to stage). The complexity is the fun. A Navigator/UI that solves everything steals the best part.

---

## The AI Navigator — the piece that's uniquely ours

**It can see the game state — that's the whole trick.** The game continuously hands the Navigator a structured snapshot: the craft (parts, mass, fuel, thrust), the situation (orbit, altitude, velocity), and the goal. So "why won't this reach orbit?" gets answered about *his* rocket ("plenty of fuel, not enough thrust to fight gravity at liftoff — add a booster or drop weight"), not a wiki paragraph.

**Four jobs, one personality:**
- **Tutor** — explains concepts at an 8-year-old-genius level, using *his* orbit as the drawn example. Never condescending.
- **Troubleshooter** — "my ship spins out" → diagnoses (off-center engine, no reaction wheel) and suggests the fix.
- **Mission helper** — "I want to land on the Moon" → breaks the dream into doable steps without doing it *for* him.
- **Coding mentor** — the big one (see below).

**The help dial — protect the struggle.** A setting he/parent can set:
- *Hint* — asks a guiding question back ("what happens to your speed at the top of the orbit?")
- *Guide* — explains the principle, lets him apply it
- *Show me* — walks the exact steps

Default **Hint**. The Navigator is biased toward making him think.

**Safety (he's 8, this is an LLM):** stays on-topic (space, physics, building, code), patient and encouraging by design, never sends him to external web links. Self-contained world. Needs a small bit of plumbing to keep the API key safe — flagged, not a blocker.

---

## Modding as his first real coding — the ladder

A part, a spaceplane, and a mod are all **text he can open and change**, with the Navigator teaching each piece. No wall between playing and looking under the hood — one continuous slope, no "now you must learn to program" cliff.

1. **Change a number.** Open an engine: `{ "name": "Sparrow Engine", "thrust": 200, "fuelBurn": 12, "mass": 1.5 }`. Bump `thrust` to 400 → the rocket leaps. *That's the moment.* Code = dials reality reads.
2. **Make a new part by copying.** Copy the engine, rename, crank numbers → it appears in his bin. He's authored content; learns structure and that a missing comma has consequences (Navigator points to the exact typo, gently).
3. **Add behavior with a tiny script.** `if (fuel < 10) { stage(); }` — the leap from *describing* to *instructing*. `if`, comparison, function call: the foundations, learned because he wanted auto-staging.
4. **Real little programs.** A custom autopilot, an altitude-hold flight computer, a mission script. Functions, variables, loops — without noticing he "learned to code."

**How the Navigator teaches at every rung:** it can see his code *and* his ship ("your `if` never triggers — `fuel` is already 0 by then; move it earlier"); it explains then makes him do (writes one example line, asks him to write the next); errors are lessons, not failures.

**Failing safely is the entire pedagogy.** A broken mod never crashes the game — it pops a friendly "line 3 expected a number" and the Navigator turns it into a five-second lesson. He must be free to break things constantly without fear, or he won't experiment — and experimentation is where the learning lives.

**The mod system and the game are the same system.** Stock parts/rockets are written in the exact format he edits — so the whole game is his worked example. Crack open any stock rocket and it's a tutorial.

---

## The Connies — the crew (his design)

His ask, straight from the designer himself: the game's creatures are **Connies — snakes in
astronaut helmets.** Where Kerbal has Kerbals, we have brave little serpents with bubble helmets.

- **Look:** a coiled green snake, head raised, inside a clear astronaut bubble helmet with a white
  collar ring. Built in 3D like everything else — no flat sprites (graphics-snob bar applies to
  crew too).
- **Named for real astronauts** — the fiction-wrapper/facts-payload rule extends to the crew.
  Buzz Coildrin, Sneil Armstrong, Sally Slide, Yuri Gliderin… every Connie name is a pun on a real
  astronaut, and the Navigator can tell you who the real one was and what they did. He giggles at
  the pun, walks away knowing Apollo 11's crew.
- **Where you see them:** a Connie waits beside the pad while you build; at launch the Navigator
  announces who's aboard; when you land — especially on another world — your Connie comes out of
  the capsule and stands beside the ship. The Moon-landing EVA moment is the reward.
- **Connies never get hurt.** A crash pops the Connie out safely in her escape bubble, always.
  Failure stays funny and consequence-free for the crew — the rocket is the thing at stake, which
  keeps him fearless about experimenting (same principle as mods that fail safely).
- **Later:** Connie portraits in the cockpit HUD, picking your crew by name, custom Connies as his
  first "character mod" (a Connie is data, like a part).

---

## The build system — his "creative mode"

Drag-snap parts in a constrained 3D builder. Parts bin on the side, build area in the middle, parts snap to a clear vertical axis with a satisfying click. Every part is one of those JSON objects — the thing he *builds* and the thing he *mods* are the same thing, two views.

**Easier than KSP (remove busywork):**
- Snapping that just works — clean snaps, auto-mirror (wing on the left → offers the right), no nonsense clipping, no camera-fighting.
- Live readouts as he builds — mass, thrust, **thrust-to-weight ratio**, **delta-v**. Adding a part that makes the rocket too heavy is *visible instantly* — a physics lesson delivered by the UI.
- Navigator pre-flight review — "TWR is 0.8, under 1.0 it can't lift off — drop a tank or add an engine."

**Kept hard (preserve the fun):**
- He still has to understand *why*, not just click "make it work."
- Center of mass vs. center of lift still matters — the game *shows* both markers but doesn't fix them. Off-center engine → it tumbles, and figuring out why is the puzzle.
- Staging stays his call.

**Two modes, one toggle:**
- **Sandbox** — everything unlocked, infinite fuel optional, no consequences. Minecraft-creative. Default playground.
- **Career/mission** — optional goals that gate parts behind small achievements, for when he wants stakes.

---

## Spaceplane sharing — the feature he asked for

A craft is just text (JSON), so sharing it is sharing text.
- **Export** → "Share this ship" copies a code/link. Send to a friend, or save it.
- **Import** → paste the code, the whole craft materializes in his build area to fly or take apart.
- **Learning by disassembly** — load someone's clever spaceplane, open it up to study the wings. The Navigator can walk him through it ("these canards up front make it turn faster").
- **Starter hangar** — ship a few pre-built craft (basic rocket, first spaceplane, Moon lander) so day one has working examples to fly *and* dissect.
- **Later (not v1):** a shared public gallery (needs moderation/hosting). The export/import *mechanism* works from the start with zero infrastructure — friend-to-friend code sharing is immediate.

---

## Real solar system — accurate where it teaches, scaled where it must

**Bodies and data are real.** Sun, eight planets, major moons — correct relative sizes, masses, gravity, day lengths, distance-ordering. Land on Mars → gravity really is ~38% of Earth's, so he jumps higher and *feels* a fact. The Moon has no atmosphere (no parachutes); Titan has a thick one. **Constraints he bumps into, not trivia he reads** — that's how facts stick.

**What he absorbs without being taught:** why the outer planets are brutally far (orders of magnitude, not "a bit further"); why the Moon needs no heat shield but Earth reentry does; why Venus is a nightmare and Mars the realistic target; real moons as real destinations (Europa's ice, Titan's haze, Io's volcanoes).

**The one honest compromise — distance scaling.** True-scale transfers are hours of waiting and invisible dots (KSP shrank everything ~10x for this). Keep sizes/gravity/atmospheres real (where the learning is); offer **time-warp + an optional distance scale** so a Mars trip is an afternoon. The Navigator says the real number out loud ("really this takes 7 months; we'll speed up time"). He gets the truth *and* the fun, and knows which is which. Same training-wheels philosophy as a forgiving orbital-mechanics mode vs. real-scale challenge mode.

**Missions — a tour that retraces real spaceflight history (optional, skippable):**
1. Reach Earth orbit (Gagarin/Mercury).
2. Orbit and land on the Moon, come home (Apollo — the heat-shield reentry lesson).
3. Reach another planet — Mars/Venus flyby, then orbit.
4. Land a rover, visit the moons — the open-ended endgame.

The Navigator frames each with a real hook ("this is basically Apollo 11 in 1969 — want to know how they solved the same problem?"). Difficulty order ≈ historical order, happily.

**"Did you know this is real?" thread.** On arrival, the Navigator surfaces a genuine fact tied to what he's doing now — on Olympus Mons: "tallest volcano in the solar system, three times higher than Everest." A reward for getting there, not a popup quiz.

---

## Tech stack

- **Plain web app** — HTML/CSS/JavaScript. No install; JS is also the language he'll learn.
- **Rendering** — Three.js for 3D. Planar physics under a 3D skin.
- **Physics** — we write it ourselves. Patched-conic orbital mechanics is a few hundred lines of well-understood math; writing it ourselves makes it tunable (training-wheels modes) and transparent (Navigator can explain what we control). Off-the-shelf game physics is *wrong* for orbits.
- **Navigator** — Claude API. Game-state snapshot + question → answer. Small ongoing API cost; needs key-safety plumbing.
- **Saving** — browser localStorage to start. Sharing = copy-a-code. No server, no accounts, no hosting bill. A real backend (gallery, cloud saves) is a deliberate later.

Nothing here needs a server farm or a studio. It's a website with good physics and a smart Navigator.

---

## Roadmap — honest phases

Each phase is a complete, playable thing, not a half-built tease.

**Phase 1 — "It flies."** 3D world, one planet (Earth), constrained-3D drag-snap building with a few parts, launch, orbital-mechanics core. Goal: get a rocket into orbit. Basic Navigator that sees the ship and answers questions. *A real game on its own.*

**Phase 2 — "The Moon."** Patched conics to a second body; Moon with real gravity/no atmosphere; landing; reentry heating coming home. Navigator gains the Hint/Guide/Show-me dial and mission scaffolding. The Apollo arc becomes playable.

**Phase 3 — "Modding / his first code."** Open parts as editable JSON, then one-line scripts. Navigator becomes coding mentor. Mostly *exposing* systems we already built — this is the phase that turns the game into a coding education.

**Phase 4 — "The solar system."** Real planets + major moons with accurate data, time-warp, the mission ladder outward, the real-astronomy facts thread. Mostly data/content on Phase 2's engine.
*(DELIVERED EARLY, 2026-07-03 — pulled ahead of the rest of Phase 3 because the customer kept asking for planets. Shipped: heliocentric world, Sun + all 8 planets on real scaled orbits, 🎯 target picker, 500,000× time-warp, transfer windows to any world, mid-course correction guidance, per-world landings/lessons, planet facts thread. Major moons beyond ours still to come.)*

**Phase 5 — "Spaceplanes & aero."** Aerodynamics layer: lift, drag, wings, runway takeoffs, atmospheric flight, reentry. Hardest physics, saved for last on a solid foundation. Craft sharing shines here.

Phases 1–2 are the big lift (they prove the core). 3–5 increasingly "add to a working machine." Stop after any phase and have a genuinely good thing.

---

## Open flags / decisions for later

- **API key safety** — the Navigator needs a small server shim or proxy so his browser never holds a raw key. Easy, but real.
- **Ongoing API cost** — the Navigator costs a little per use. Trivial at one-kid scale; worth noting.
- **Free 3D builder** — deferred. Revisit if the constrained builder starts to limit him.
- **Public craft gallery** — deferred (moderation + hosting). Friend-to-friend code sharing works from day one regardless.
- **Distance scale default** — decide the v1 default (forgiving) and how prominently to surface the real numbers.
