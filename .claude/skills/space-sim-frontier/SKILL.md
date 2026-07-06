---
name: space-sim-frontier
description: >
  The open problems worth advancing in the space-sim repo (/home/user/space-sim), ranked,
  each with why it's hard, this project's specific asset, the first three concrete steps IN
  THIS REPO, and a falsifiable "you have a result when…" milestone. Load this skill when you
  are asked "what should I work on next", "what's the roadmap", "how would we build the
  scripting/modding thing", "the interstellar travel mechanic", "the real-scale mode", or
  when you have spare capacity and want the highest-leverage next move. The flagship item is
  MODDING LADDER RUNG 3 — safe one-line kid scripts (if (fuel < 10) stage()) with NO eval —
  because the owner's stated frontier is the play→code on-ramp, judged by kid-observable
  outcomes, NOT chasing "state of the art". Everything here is labeled open/candidate;
  nothing is oversold. Keywords: roadmap, next steps, open problems, modding ladder, rung 3,
  scripting, safe interpreter, no eval, interstellar Phase B, Phase C, real-scale toggle,
  free-return, spaceplanes, what's novel, frontier.
---

# Space Sim — Research Frontier

Where this project could go next, in priority order. The owner's framing (interview
2026-07-06): **"state of the art" talk is a distraction — the frontier that matters is the
modding ladder (the play→code on-ramp), and milestones must be KID-OBSERVABLE outcomes.**
So the bar for every item below is not novelty for its own sake; it is *does a real 8-year-old
do something he couldn't before, and does he learn something real doing it?*

Everything here is **open/candidate**. Do not present any of it as built or promised. Before
starting one, load `space-sim-change-control` (this is all gated work) and
`space-sim-analysis-toolkit` (predict before you build).

**When NOT to use this skill:**

| You actually need | Go to sibling skill |
|---|---|
| The Δv/fuel-balance campaign specifically | `space-sim-delta-v-campaign` |
| What was already tried and settled (don't re-fight) | `space-sim-failure-archaeology` |
| The invariants a new feature must not break | `space-sim-architecture-contract` |
| The product doctrine a new feature must satisfy | `space-sim-pedagogy-and-content` |
| How changes get gated and recorded | `space-sim-change-control` |

This skill owns: the ranked open-problem list and the first steps + milestone for each.

---

## 1. Modding Rung 3 — safe one-line scripts *(the flagship)*

The design doc's ladder: rung 1 = change a number, rung 2 = copy-a-part, **rung 3 = add
behavior with a tiny script** (`if (fuel < 10) { stage(); }`), rung 4 = real little
programs. Rungs 1–2 ship; rung 3 is HANDOFF next-step #3: *"one-line scripts, safe
interpreter, NO eval."*

**Why it's hard:** you must execute code a child typed, safely, in a page that holds an
Anthropic API key — with `eval` and the `Function` constructor both off the table (they're
the same hazard). And a broken script must be a *lesson*, never a crash (frozen pedagogy:
failing safely). As of 2026-07-06 the codebase contains **zero** `eval`/`Function` calls
(verified by grep) — do not be the change that introduces one.

**This project's specific asset:** `mods.js` already has the whole safe-input pipeline —
`parsePartJSON` / `validatePartDef` / `explainJsonError` — that **rejects with a friendly,
line-pointing message and NEVER throws or silently clamps** (mods.js:47, :95, :115). Rung 3
is that same "parse → validate → friendly error" discipline applied to a tiny scripting
grammar instead of JSON. And the Navigator already sees his edits (`modsSummary`), so it can
mentor a broken script the way it mentors a broken part.

**First three steps in this repo:**
1. **Spec the grammar and the facade.** Decide the smallest useful language: `if
   (<field> <cmp> <number>) <verb>()`. Define a FROZEN read-only facade of sim fields the
   script may read (fuel, altitude, speed, stage — a whitelist) and a tiny verb set it may
   call (`stage()`, `setThrottle(x)` — a whitelist). Nothing outside the facade is reachable.
2. **Write a pure interpreter module + node property tests.** A hand-written tokenizer +
   whitelisted-AST evaluator (NOT eval/Function). Node-test it like stargen: fuzz it with
   garbage/malicious input across many seeds and assert it can NEVER throw uncaught, never
   touch anything outside the facade, never loop forever (step budget). This is pure and
   node-testable — it belongs in `tests/` (see `space-sim-testing-and-qa`).
3. **Wire ONE hook behind the existing mods UI:** run the validated script once per physics
   tick (or per stage event), surfacing errors through the same friendly-message path as a
   bad part edit. One entry point, reversible.

**You have a result when:** the kid types the auto-stage line himself, it fires in a real
flight and drops the stage, AND a deliberately broken script (missing paren, unknown field)
produces a friendly Navigator-mentored pointer instead of any crash — all covered by a
node fuzz suite that proves the interpreter is unbreakable. (Kid-observable + safe.)

**What NOT to attempt:** rung 3 via `eval`, `new Function`, `with`, or any string→code
primitive. If you catch yourself reaching for one, stop — the whole point is that it's an
interpreter you control.

## 2. Modding Rung 4 — mission scripts / autopilot

The natural sequel: multi-line scripts, variables, an altitude-hold or gravity-turn
autopilot — "real little programs" (design doc rung 4). **Asset:** the rung-3 interpreter,
extended. **First steps:** add assignment + a bounded loop to the grammar (still no eval,
still step-budgeted), keep the same facade, add examples the kid can crack open. **Result
when:** he writes a working altitude-hold flight computer and watches it fly the ascent.
Do NOT start this before rung 3 is solid and fuzz-proven.

## 3. Real-scale toggle (SCALE = 1.0)

HANDOFF next-step #5: real-scale is disabled pending a part-tuning pass (~9,400 m/s to LEO).
**Blocked on `space-sim-delta-v-campaign`** — real scale has no Δv headroom to spare, so the
scaled-universe balance must clear its bar comfortably first. **Asset:** everything is
already parameterized on `SCALE` (state.js:13) and `mu = g0·R²`, so bodies rescale
correctly; only the part catalog needs the headroom. **First steps:** (a) finish the Δv
campaign at SCALE=0.1; (b) run a fresh `dv_audit.mjs` baseline at SCALE=1.0 to size the gap;
(c) tune/add parts against that. **Result when:** a stock+tuned build reaches real-scale LEO
in-game with positive margin, all suites green, and the kid can flip the toggle and feel the
brutal real numbers (with the Navigator teaching both). **Do NOT** reach real scale by
weakening physics — that's a fenced path in the campaign skill.

## 4. Interstellar Phase B — the honest travel mechanic

HANDOFF: *"Phase B (not built): the honest travel mechanic — real solar escape, point at a
star, the clock pays the real decades."* The Starmap (Phase A) already generates infinite
seeded systems; today you reach them by a "magic fold" (labeled magic, honestly). **Asset:**
`stargen.js` + the seeded-name-is-the-share-code trick + the Navigator's honest interstellar
math (torch → nearest star ≈ 10,000 yr). **First steps:** (a) define solar-escape detection
(dominant body → none / true hyperbolic Sun orbit); (b) a "point at a star, engine burns,
the clock pays real decades" mode with time-warp; (c) arrival = `arriveInSystem` into the
seeded system. **Result when:** he burns to solar escape, aims at a named star, watches the
honest clock run, and arrives — with the Navigator having taught why the fold was magic and
this isn't. **Phase C** (hand him the generator's dials as a modding rung) rides on rungs
3–4. Both were sketched with the owner on 2026-07-05, unbuilt.

## 5. Free-return trajectory guidance

HANDOFF next-step #6 (carried over): coach the Apollo-8 free-return (a trajectory that loops
the Moon and comes home with no capture burn). **Asset:** the existing `courseCorrection`
Kepler propagation. **First steps:** predict the return leg of a lunar flyby, surface a
"free-return" HUD indicator, Navigator coaching. **Result when:** the kid flies around the
Moon and back to an Earth reentry without a capture burn, guided.

## 6. Phase 5 — spaceplanes & aerodynamics (the remaining big lift)

The design doc's Phase 5: a real aero layer (lift, wings, runway takeoffs, atmospheric
flight). The hardest physics, deliberately last. **Asset:** the atmosphere/drag model and
fins already exist; craft sharing shines here. **First steps:** a lift model for wings, a
runway, an angle-of-attack readout. **Result when:** he builds a winged craft and flies it
in atmosphere. Large scope — likely its own multi-session campaign; scope it with the owner
before starting.

---

## How to pick

- **Highest leverage on the owner's stated frontier:** #1 (rung 3). It's the on-ramp's
  missing rung and everything above #2 depends on the interpreter.
- **Unblocks a shipped-but-disabled feature:** #3 (real scale), after the Δv campaign.
- **Biggest "wow" for the kid:** #4 (honest interstellar) — but only once the fundamentals
  are steady.

For any of them: predict the outcome numerically first (`space-sim-analysis-toolkit`), build
behind one reversible entry point, land it with its test, verify at the right rung of the
evidence ladder, and record it in HANDOFF — the acceptance test is always the kid.

---

## Provenance and maintenance

Roadmap facts verified against the repo on **2026-07-06**. Re-verify:

```bash
# The roadmap items themselves (rung 3, Phase B/C, real-scale, free-return):
grep -n "Modding rung 3\|Phase B\|Phase C\|Real-scale\|Free-return" HANDOFF.md
sed -n '184,201p' HANDOFF.md   # the interstellar Phase B/C sketch

# The NO-EVAL invariant rung 3 must preserve (should print NONE):
grep -rn "eval(\|new Function\|Function(" js/ || echo "clean: no eval/Function"

# The safe-input pipeline rung 3 reuses:
grep -n "validatePartDef\|explainJsonError\|parsePartJSON\|NEVER throws\|never silently clamp" js/mods.js

# SCALE (real-scale target = 1.0, currently 0.1):
grep -n "SCALE =" js/state.js
```

If any roadmap item here has since been BUILT, move it out of this frontier list and into
the shipped record (HANDOFF) — this skill must only ever list what is still open, or it will
mislead the next agent into re-building something done.
