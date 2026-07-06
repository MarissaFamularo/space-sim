---
name: space-sim-pedagogy-and-content
description: >
  The product doctrine of the space-sim repo: fiction is the wrapper, facts are the payload.
  Load this skill BEFORE writing ANY kid-facing content (banners, WORLD_FACTS, Navigator
  callouts, part names, station/alien flavor, crash messages), BEFORE designing or reviewing
  a new feature ("what does this teach?", "is this too easy?", "can we fake this?"), and
  BEFORE editing the docs of record (HANDOFF.md entries, ARCHITECTURE.md revisions, README,
  space-game-design.md) or writing a commit message. Also load it when judging whether
  something may be "magic" vs real, whether a mod error message is friendly enough, whether
  a Connie can be hurt (never), or whether a feature steals the puzzle. Keywords: pedagogy,
  content rules, house style, tone, kid-facing text, worked example, honesty ladder, labeled
  magic, easier but not much easier, failing safely, Connies, WORLD_FACTS, docs of record,
  HANDOFF entry, commit voice, doc drift.
---

# Space Sim — Pedagogy & Content Doctrine

This is the WHY behind every feature gate in this repo. The game is built FOR one 8-year-old
(advanced reader, space/physics obsessed, graphics snob); his mom Marissa owns the repo.
Every content decision is judged by one bar (HANDOFF.md "Working style notes"): *"the physics
is genuinely real and the kid learns real-world facts, not game trivia."*

All file/line references verified 2026-07-06. All 8 node suites green on that date
(171 checks: chute 5, mods 37, phase5 22, planets 31, reentry 8, stargen 28, teleport 26,
transfer 14).

## When NOT to use this skill

| You actually need | Use instead |
|---|---|
| Is this change even allowed? classification, gating, evidence ladder | `space-sim-change-control` |
| Editing the Navigator SYSTEM prompt, snapshot schema, safety block | `space-sim-navigator-and-safety` |
| A constant's value/location, localStorage schemas | `space-sim-constants-and-storage` |
| Frozen data shapes, module APIs, coordinate rules | `space-sim-architecture-contract` |
| Orbital math to get a taught number RIGHT | `orbital-mechanics-reference` |
| Serving/deploying, README's run-command trap in practice | `space-sim-dev-loop` |
| History of a settled design fight (Triton, Phobos, patched conics) | `space-sim-failure-archaeology` |

This skill owns: the five doctrine rules, kid-facing text style, the feature→lesson table,
and docs-of-record/commit maintenance. It does NOT authorize changes — change-control gates.

## Glossary (once)

- **The kid / "he"**: the player and audience. Docs and commits refer to him directly.
- **Connie**: the game's astronaut — a snake in a bubble helmet, his design (`js/connies.js`).
- **Navigator**: the in-game Claude tutor (`js/copilot.js`). Its SYSTEM prompt is the largest
  body of kid-facing prose in the repo and the canonical voice sample.
- **Modding ladder**: the play→code on-ramp (space-game-design.md "Modding as his first real
  coding"): rung 1 change a number, rung 2 copy-a-part, rung 3 tiny scripts (not built),
  rung 4 real little programs (not built).
- **WORLD_FACTS**: the per-world true-fact strings at `js/main.js:33` — arrival lines.
- **Docs of record**: HANDOFF.md (project memory), ARCHITECTURE.md (frozen contracts),
  README.md (front door), space-game-design.md (vision).

---

## The five doctrine rules

### Rule 1 — Fiction is the wrapper, facts are the payload

Verbatim from space-game-design.md ("The core bet"): *"the fiction is the wrapper, the facts
are the payload. Kerbal taught him a made-up solar system because the made-up system WAS the
content. We invert that — the gameplay is the hook; real astronomy, physics, and JavaScript
are what he walks away with."*

**Gate for every new feature: name the real thing it teaches.** If you can't fill in the
right-hand column, the feature isn't ready. Verified worked examples already in the game:

| Feature (where) | Real lesson it carries |
|---|---|
| Parachute does nothing on the Moon (design doc; copilot.js:45) | Parachutes need AIR; the Moon has none — powered descent like Apollo |
| Titan chute-only soft landing (WORLD_FACTS Titan; copilot.js:37) | Titan's air is thicker than Earth's — how Huygens landed, 2005 |
| Gas giants have no surface; dive = sink/crush/melt (copilot.js:37; main.js banners) | The real Galileo probe's Jupiter plunge, 2003 |
| Sky-crane: rover HANGS on ropes, crane packs its own fuel (HANDOFF; copilot.js:38) | MSL/Curiosity & Perseverance landings — thin Martian air needs chute AND rockets |
| Ion Drive cannot lift off (copilot.js:40) | True of real ion tech (Deep Space 1, Dawn, Psyche): tiny thrust, ~10x exhaust speed |
| Phobos/Deimos: teleport gives a FORMATION, not an orbit (HANDOFF; copilot.js:38) | Their true SOI < their own radius — you genuinely cannot orbit them |
| Derelict Old Kestrel Station: no fuel, junk cloud, salvage log (HANDOFF; copilot.js:41) | Space junk is real (30,000+ tracked pieces); stations need constant care |
| Alien hums in prime numbers (copilot.js:42) | Math/primes as humanity's expected first-contact language; aliens NEVER in Sol — "no alien life found YET, and looking is real science" |
| Generated planets named "Snakestar b, c, d" (stargen.js:158) | The real exoplanet naming convention — the star itself is "a" |
| Black hole sized by Schwarzschild radius, lit by its disk (HANDOFF; copilot.js:168 region) | Gravity only cares about mass; orbiting a BH is safe; the hole emits nothing |
| Mid-course correction gold arrow (HANDOFF; copilot.js:37) | The Apollo 13 move — window for departure, correction for arrival |
| Vacuum engines auto-get the long skinny bell (HANDOFF 2026-07-05 parts pass) | Nozzle shape IS the spec — vacuum expansion ratio |
| Connie names (connies.js) | Real astronauts — see Rule 5 |

When extending this table: real missions, real dates, real numbers only. Verify the fact
before shipping it — a wrong "true fact" is the worst bug this project can have.

### Rule 2 — Easier but not much easier

Verbatim from space-game-design.md ("Locked decisions" footer): *"easier but not much easier.
Remove busywork (snapping, readouts, typo-finding); preserve the puzzle (why the rocket won't
fly, where the center of mass goes, what to stage). The complexity is the fun. A
Navigator/UI that solves everything steals the best part."*

- Shipped enforcement: the Navigator hints before it answers — copilot.js:30: *"Teach, don't
  just hand over the answer. Lead with a hint or a guiding question... Give the full answer
  when they're stuck or ask directly."* And on code: copilot.js:48 — *"NEVER type out a whole
  part definition for him... The struggle is where the learning lives."*
- The design doc's three-position "help dial" (Hint/Guide/Show me) is DESIGN ONLY — not
  built as a setting as of 2026-07-06. Don't cite it as a shipped feature.
- Guidance philosophy is frozen in HANDOFF "Key decisions": don't make the transfer window
  exact enough to skip corrections — *"corrections ARE the lesson."*
- Review question for any UI/automation idea: does it remove busywork (good: readouts,
  snapping, the descent HUD, friendly typo-pointing) or does it solve the puzzle (bad:
  auto-pilot to orbit, auto-fixed staging, silently corrected mods)?

### Rule 3 — The honesty ladder

Every mechanic sits on exactly one rung, and the game SAYS which:

1. **Real.** Physics, gravity, the rocket equation, staging, drag, heat. Owner frozen rule
   #3: physics stays real. No new "gamey" physics, ever.
2. **Scaled but taught.** The ONE permitted lie: `SCALE = 0.1` (state.js:13) — radii and
   distances ×0.1, surface gravities real, so the system runs ~√10 ≈ 3.2x fast. The rule is
   TEACH BOTH NUMBERS, enforced in the Navigator prompt (copilot.js:34: "So TEACH BOTH
   NUMBERS... explain WHY they differ") and modeled everywhere ("a Mars trip ≈ 82 game-days;
   teach the real 8.5 months too"). Any new taught quantity must state game AND real values.
3. **Labeled magic.** Allowed only when physics forbids the fun, and ALWAYS named as magic
   in-game, marked ✨. Current magic: ✨ Teleport ("a practice shortcut, not physics" —
   copilot.js:44, which then prices out the honest trip's cost) and the Starmap jump
   (copilot.js:40: "a magic fold that skips what physics won't allow, and it's fine to say
   so plainly" — after teaching that even a fusion torch needs ~10,000 years to the nearest
   star). The galaxy map's compressed star positions are also confessed (copilot.js:43:
   real neighbors are ~50,000x farther).

**Unlabeled magic is a doctrine violation.** If a proposed feature needs the game to lie
silently (e.g. "just make the engine stronger near Jupiter so the dive is survivable"),
reject it or move it to rung 3 with an in-game label. Note the house pattern: even magic
teaches — the teleport arrival message quotes the Hohmann coast days it skipped
(main.js "✨ Teleport" block near line 273).

### Rule 4 — Failing safely IS the pedagogy

Verbatim from space-game-design.md: *"Failing safely is the entire pedagogy. A broken mod
never crashes the game... He must be free to break things constantly without fear, or he
won't experiment — and experimentation is where the learning lives."*

Shipped enforcement (mods.js header, lines 9–16 — treat as law for any new kid-input path):
- Everything touching kid input returns `{ ok, error }` with a friendly message; NEVER throws.
- Bad saved mods are silently dropped at load so mangled localStorage can't kill boot.
- **Validation REJECTS with an explanation — it never silently clamps.** "If he types
  thrust: -5 he gets told why that can't be, not a secretly-fixed rocket."
- Error copy style (read `checkNum` at mods.js:39 and `explainJsonError` at mods.js:95):
  point at the exact field/line, finish bounds with a physics fact ("even a Saturn V stage
  weighs less than 500 t empty"), suggest the likely typo ("missing comma at the end of the
  line above"), never scold. Bounds read as facts, not rules.
- Crashes are consequence-free for the crew: main.js:622 — the Connie "boinged away safely
  in the escape bubble — Connies always do." Uncrewed crashes: "probes take the risks so
  Connies don't have to" (main.js:764). The rocket is the only thing at stake.
- Corollary from HANDOFF "Not done yet" #2: the mod editor is the built-in pressure valve
  for difficulty — "'make a stronger engine' is a feature, not a cheat." Don't fix tightness
  by nerfing the challenge before considering that the ladder IS the relief.

### Rule 5 — The Connies

His design, spec in space-game-design.md "The Connies" + `js/connies.js` (20 lines — also
deliberately a file he can edit; adding a Connie is an early mod):
- Snakes in clear bubble helmets, built in 3D (graphics-snob bar applies to crew).
- Every Connie is a PUN ON A REAL ASTRONAUT with a `.hero` true fact the Navigator shares:
  Sneil Armstrong, Buzz Coildrin, Sally Slide, Yuri Gliderin, Mae Slitherson, Chris
  Rattlefield, Katherine Coilson, Boa Lovell. New Connies must follow the pattern — pun name
  plus a verified one-line `.hero` fact ("He giggles at the pun, walks away knowing Apollo
  11's crew").
- **Connies never get hurt.** Non-negotiable. Crash → escape bubble, always. No injury,
  peril framing, or loss states involving crew — keep crashes light and funny.
- Crew policy (main.js:97): a Connie flies only when a crewed pod is aboard; probe-only
  rockets have `sim.crew = null` and all messaging adapts.

---

## Kid-facing text: the house style

Canonical voice samples, in order of authority: the Navigator SYSTEM prompt (copilot.js:19–50),
WORLD_FACTS (main.js:33–52), the crash/landing banner block (main.js:550+), mods.js error
strings, HANDOFF's feature descriptions.

Checklist for any new string the kid will read:
- [ ] **Short.** Navigator answers are 2–4 sentences (copilot.js:28); banners are one head
      line + one sub line; WORLD_FACTS are 1–2 sentences.
- [ ] **A real fact with a real number**, not vibes: "460°C day and night", "over 2,000 km/h",
      "1,300 Earths", "99.8% of all the mass". Verify every number.
- [ ] **Warm, never condescending** (copilot.js:31). Plain words an 8-year-old advanced
      reader knows; wonder over cuteness. CAPS for the one load-bearing word ("its shadowed
      craters hold ICE") is house style; exclamation marks sparingly.
- [ ] Humor lands dry and true: Earth = "The only world where your parachute, your lungs,
      and your snack supply all work."
- [ ] **Both numbers** whenever scale is involved (Rule 3, rung 2).
- [ ] Emoji are UI markers with fixed meanings, not decoration: ✨ magic/his-creations,
      🎯 target, 🛰 station/satellite, 🌌 Starmap, ⭐/⚫ star/black hole, 🔑 API key,
      { } part code, 🗑 delete, 📤/📥 share, 💥 crash, 🔬 science, 👽 alien. Reuse these;
      don't mint near-duplicates.
- [ ] Failure text follows Rule 4: friendly, pointing, physics-flavored, never scolding.
- [ ] No web links in anything the Navigator or game says (copilot.js:33).
- [ ] Fictional content stays honest at the borders: generated systems never claim real
      missions happened there (copilot.js:165–168); aliens never appear in Sol.

Where facts live matters: per-world arrival facts go in WORLD_FACTS keyed by `b.name`;
teaching the Navigator a new mechanic goes through `space-sim-navigator-and-safety` (its
SYSTEM prompt and snapshot are protected surfaces — do not paste new prose in casually).

---

## Docs of record: maintenance rules

### HANDOFF.md — the project memory (single pickup point)
Entry style, from the file's own "Working style notes" and its existing entries:
- New session block goes at the TOP of the status section, headed
  `**New <date> <context> — <VIVID TITLE>.**` — titles credit the source of the ask:
  "(his ask)", "(his ask, via Mom)", "(Mom's ask: '...')", "(his morning wish list)".
- Each bullet: WHAT shipped, WHY (the kid-facing reason), HOW it was verified (node-tested /
  browser-verified / code-verified — the evidence ladder is `space-sim-change-control`'s),
  and WHAT'S FLAGGED. *"Status reports lead with what's done AND what's flagged — outstanding
  items first, no padding."* Real precedent: the alien entry ends with the exact play-test
  still owed ("seed 'Neon', home station, drift right and slightly down").
- Bugs the kid found are credited as his: "(his Ganymede bug report)", "(his bug report)".
- Record GOTCHAs learned inline where they were learned, and keep the "Gotchas already
  fixed" section additive — never delete a fixed-gotcha note.

### ARCHITECTURE.md — the contract
Line 7: *"This file is the contract... Do not change a shared shape without updating this
file."* Protocol: a contract change updates ARCHITECTURE.md IN THE SAME change, as a titled
revision section. Precedent (the project's first revision): line 161, `## The active system
(CONTRACT REVISION 2026-07-05 — the Starmap)`, plus a matching `// CONTRACT REVISION
2026-07-05` note at the affected API (line 221, `Render.rebuildWorld()`). Follow that
pattern: dated, named, explains the new shape and what stays stable. Whether you MAY change
a contract is `space-sim-change-control` / `space-sim-architecture-contract` territory.

### README.md — the 60-second front door
23 lines as of 2026-07-06: play link first, one-paragraph pitch, run command, license,
doc pointers. Keep it that small — details belong in HANDOFF/ARCHITECTURE. Known trap to be
aware of (do NOT propagate it into new docs): README's run command is `python3 server.py`,
but server.py hardcodes the owner's Mac path; the portable command is
`python3 -m http.server 8000` from repo root (HANDOFF agrees). `space-sim-dev-loop` owns
this operationally.

### space-game-design.md — the vision
Records bets, locked decisions, and the modding ladder. Update it only when the VISION
shifts (e.g. its status header was amended as phases landed), not for feature logs — those
go in HANDOFF. The doctrine quotes in this skill live there; if you change the doctrine
itself, that's an owner conversation, not an edit.

### Known doc drift (live example, as of 2026-07-06)
Top warp tier is **2,000,000x** in code (main.js:23, comment "top tier: Pluto runs") but
HANDOFF and the Navigator prompt (copilot.js:37) still say 500,000x. Code is canonical for
values. Fixing the prompt is a protected-surface edit (`space-sim-navigator-and-safety` +
change control); the lesson for THIS skill: when a constant changes, sweep the docs of
record AND the Navigator prompt in the same change so taught numbers stay true.

---

## Commit voice

From git log (read `git log --oneline` yourself for the current voice — no git WRITE
commands are needed for that): short, vivid, present-tense, and honoring where the idea
came from and what the kid will see:

- `✨ Teleport-to-orbit: magic-jump into orbit around any world (his ask)`
- `Sky-crane thrusters pack their own fuel (his ask — the real one did too)`
- `Fix floating-above-the-surface on landings (his Ganymede report)`
- `Surprise black holes: some Starmap names hide one ⚫`
- `Drag to look around your ship in flight view (play-test bug #3)`

Rules: lead with the kid-visible outcome, not the mechanism; credit "(his ask)" / "(Mom's
ask)" / "(his X report)" when true; one topical emoji max, from the fixed set; a real-world
aside in parens when the fact is the point. Push to `main` IS the deploy (no CI) — commit
only at verified milestones, per HANDOFF.

---

## New-feature content review (run this before building)

1. **Payload:** what real fact/skill does it teach? Add the row to Rule 1's table style.
2. **Rung:** real, scaled-but-taught, or labeled magic? If magic — where's the in-game label
   and the honest-cost lesson beside it?
3. **Puzzle check:** busywork removed, or fun stolen? (Rule 2.)
4. **Failure path:** what happens when the kid breaks it? Must be friendly, pointing,
   crash-proof, never clamping. (Rule 4.)
5. **Crew check:** can a Connie be hurt or scared by it? Then no. (Rule 5.)
6. **Voice check:** run every new string through the checklist above.
7. **Records:** HANDOFF entry drafted (outstanding items first); ARCHITECTURE touched iff a
   contract changed; Navigator taught iff the mechanic is kid-visible (via the navigator
   skill); numbers consistent across code/docs/prompt.

---

## Provenance and maintenance

Facts above verified 2026-07-06 against the repo. One-line re-checks for anything that drifts:

```bash
# Doctrine quotes still in the design doc
grep -n "fiction is the wrapper\|easier but not much easier\|Failing safely" /home/user/space-sim/space-game-design.md
# WORLD_FACTS location + content
grep -n "WORLD_FACTS" /home/user/space-sim/js/main.js | head -3
# Reject-never-clamp rule + friendly-error machinery
sed -n '9,16p;39,45p' /home/user/space-sim/js/mods.js
# Connie roster + never-hurt line
cat /home/user/space-sim/js/connies.js; grep -n "boinged away safely" /home/user/space-sim/js/main.js
# Honesty-ladder labels (teleport + starmap fold + both-numbers rule)
grep -n "practice shortcut\|magic fold\|TEACH BOTH NUMBERS" /home/user/space-sim/js/copilot.js
# Warp-tier doc drift (code vs HANDOFF vs prompt)
grep -n "2000000\|2,000,000" /home/user/space-sim/js/main.js; grep -rn "500,000" /home/user/space-sim/HANDOFF.md /home/user/space-sim/js/copilot.js
# ARCHITECTURE revision precedent
grep -n "CONTRACT REVISION" /home/user/space-sim/ARCHITECTURE.md
# Exoplanet naming convention
grep -n "exoplanet convention" /home/user/space-sim/js/stargen.js
# Test suites still green (evidence bar for "all green" claims)
for t in /home/user/space-sim/tests/*.mjs; do node "$t" | tail -1; done
# Commit voice sample
git -C /home/user/space-sim log --oneline | head -15
```

If a quote above no longer greps, the doctrine may have been deliberately revised — check
HANDOFF.md's newest entry and `space-sim-change-control` before assuming a typo.
