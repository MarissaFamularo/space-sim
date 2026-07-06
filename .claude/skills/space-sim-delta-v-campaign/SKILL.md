---
name: space-sim-delta-v-campaign
description: >
  The executable, decision-gated campaign for the hardest live problem in the space-sim
  repo (/home/user/space-sim): the Δv / fuel-balance pass. The owner named this THE
  problem to solve — a stock-parts Mars round trip is possible but TIGHT, and the disabled
  real-scale mode waits on the same tuning. Load this skill when you are asked to: make the
  stock rocket "reach Mars and come home", tune Δv / fuel / thrust, decide whether to buff a
  part or add a new one, close a fuel-margin gap, or work on the real-scale toggle. It ships
  scripts/dv_audit.mjs (the Phase-0 baseline — run it FIRST), a numbered phase plan with a
  numeric gate at every step ("if you see X instead → branch to Y"), a ranked solution menu
  with the theory obligation for each, fenced-off wrong paths, and a validation-and-promotion
  protocol that routes through change control. Success is a MARGIN NUMBER, never a feeling.
  Keywords: delta-v, Δv, fuel balance, margin, Mars round trip, TWR, part tuning, stock parts,
  real-scale toggle, SCALE=1.0, rocket equation, staging, add a part, dv_audit.
---

# Space Sim — The Δv / Fuel-Balance Campaign

This is a **battle plan**, not a reference. Follow it in order. Every phase has a gate: a
number you must observe before advancing. If the number is different, the gate tells you
which branch to take. **You are done when a measured margin clears the bar — never when a
flight "felt fine."**

The problem, in one sentence (owner interview, 2026-07-06): *a Mars round trip on stock
parts is possible but tight, and item 5 (the real-scale toggle) can't ship until the part
catalog is tuned.* This campaign closes that gap with evidence.

**When NOT to use this skill:**

| You actually need | Go to sibling skill |
|---|---|
| The orbital-mechanics formulas behind the ledger | `orbital-mechanics-reference` |
| First-principles analysis recipes / predict-before-run discipline | `space-sim-analysis-toolkit` |
| Whether a change is allowed + how to record it | `space-sim-change-control` |
| Exact part numbers / where SCALE lives | `space-sim-constants-and-storage` |
| To fly the result in a real browser | `space-sim-browser-verification` |
| Other open problems (modding ladder, interstellar) | `space-sim-frontier` |

This skill owns: the Mars-round-trip requirement ledger, the tuning campaign, and the
promotion protocol for a balance change.

---

## Vocabulary (defined once)

- **Δv (delta-v):** the total velocity change a stage can produce, `ve · ln(m0/m1)`
  (the rocket / Tsiolkovsky equation). `ve` = exhaust velocity (m/s), `m0`/`m1` =
  wet/dry mass. Δv is the currency: every mission leg costs Δv, every stage supplies it.
- **TWR (thrust-to-weight ratio):** `thrust / (mass · g0)`. Below 1.0 on a body, the
  stage cannot lift off it. TWR(E) is against Earth's g0, TWR(M) against Mars's.
- **Staged Δv vs HUD Δv:** the true capability is the SUM of each stage's Δv computed
  separately (`dv_audit.mjs`). `state.js computeStats` (what the kid sees in the HUD) is
  a whole-rocket approximation and reads LOWER — do not tune against the HUD number.
- **Margin:** `(capability − requirement) / requirement`. The campaign's success metric.
- **Taught flow:** the game coaches "burn to escape the planet, CUT ENGINE, then Hohmann
  from the Sun orbit at the window" (HANDOFF key decisions). This forgoes the Oberth
  effect, so it costs more Δv than a direct injection — but it is THE requirement, because
  it is what the kid is taught to fly. Do not tune against the cheaper direct-injection
  number.

---

## Phase 0 — Baseline (run this before touching anything)

```
node .claude/skills/space-sim-delta-v-campaign/scripts/dv_audit.mjs
```

Pure node, no browser, no side effects. It (1) builds three reference stock stacks and
computes the true per-stage Δv/TWR ladder (replicating `builder.js reflowStages` +
`main.js` staging), (2) flies a scripted gravity-turn ascent to LEO and a Mars
surface→orbit ascent with the **real integrator** (so gravity + drag + steering losses
land in the number), and (3) derives the Mars round-trip requirement ledger analytically
from `BODIES` and prints the margin.

**The Phase-0 gate — baseline numbers as of 2026-07-06** (re-run to refresh; they drift if
`parts.js`, `state.js`, or `physics.js` change):

| Reference stack | Staged Δv | Requirement | Margin |
|---|---|---|---|
| Trainer (Moon-class, 2 stages) | 5546 m/s | 9658 m/s | **−42.6%** (Moon ship, not a Mars ship — expected) |
| Kestrel Mars ship (3 stages, Mega/Hawk/Osprey) | 9333 m/s | 9658 m/s | **−3.4%** |
| Heavy Mars variant (clustered booster) | 10182 m/s | 9658 m/s | **+5.4%** |

The requirement ledger totals **9658 m/s** (taught flow). The ledger walk shows exactly
where the Kestrel runs dry:

```
Hohmann return burn (Sun orbit)      SHORT by 174 m/s  <-- CAMPAIGN TARGET
Mid-course corrections, inbound      SHORT by 150 m/s  <-- CAMPAIGN TARGET
```

**Reading the gate:**
- **The finding is narrow and precise.** The stock Kestrel gets a Connie to Mars and onto
  the surface with margin to spare; it runs ~324 m/s short on the **return** legs. The
  Heavy variant (one extra clustered Hawk + tank on stage 0) already clears the whole trip
  at +5.4%. So the problem is not "the parts are too weak" — it is "the obvious 3-stage
  stock build is ~3% short, and the kid has to discover the clustered booster to close it."
- **If your re-run shows a DIFFERENT Kestrel margin than −3.4%** → someone changed
  `parts.js`, the scaled constants, or the integrator since 2026-07-06. Stop. Find the diff
  (`space-sim-failure-archaeology` + `git log -p js/parts.js js/state.js`) before you tune —
  you may be chasing a regression, not the original gap.
- **If the ascent lines report "ASCENT FAILED"** → a stock stack can no longer reach orbit
  at all. That is a bigger regression than a margin gap; treat it as a P0 bug via
  `space-sim-debugging-playbook`, not a tuning task.

Decide the campaign's success bar now, and write it down before you change anything
(hypothesis-before-experiment discipline, `space-sim-analysis-toolkit`):

> **Success bar (proposed):** the kid's *natural* 3-stock-stage Mars ship (Kestrel class,
> no cluster trick required) clears the round-trip ledger with **margin ≥ +10%**, AND
> nothing that currently reaches orbit stops reaching orbit, AND his saved parts/share
> codes still load. Adjust the +10% with the owner if needed — but pick a number first.

---

## Phase 1 — Localize the gap

The ledger walk already localizes it (the return legs). Confirm you understand WHY before
choosing a fix:

1. The taught flow spends Δv twice on "escape then window" (once at Earth, once at Mars)
   instead of one Oberth-efficient injection. The audit prints the comparison
   (`direct TMI 1118 vs taught 1923 m/s`). **This is intentional pedagogy — do not "fix" it
   by re-teaching direct injection.** It is a fixed cost of the requirement.
2. Stage 2 (the Osprey vacuum lander, ve 4400) does almost all the interplanetary work. Its
   `tank_small` (4 t fuel) is the binding constraint on the return.

**Gate:** you should be able to state, in one sentence, which stage runs dry and on which
leg. If you cannot, re-read the ledger walk output. Do not proceed to a fix you can't
localize.

---

## Phase 2 — Solution menu (ranked; each has a theory obligation)

Pick the CHEAPEST option that clears the bar. For each, the "theory obligation" is the
calculation you must do and show BEFORE editing — predict the new margin, then let the
re-run confirm it.

### Option A — Tune existing stock part numbers *(cheapest; try first)*
Bump a stock part's `fuelMass`, `thrust`, or `exhaustVelocity` in `js/parts.js`. The
smallest lever that closes the ~324 m/s return gap is stage-2 fuel: more `tank_small`
fuel, or a slightly higher Osprey `ve`.
- **Theory obligation:** compute the new stage-2 Δv by hand (`ve · ln(m0/m1)` with the new
  mass), add it to the ledger walk, show the predicted margin ≥ bar.
- **Constraints (blocking):**
  - `parts.js` is the kid's **worked example** and is normally pristine — a stock-number
    tune is allowed but is a **gated change** (`space-sim-change-control`): it must be
    justified with numbers and recorded in HANDOFF.
  - His saved overrides pin to stock ids (`mods.js mergeCatalog`). If he has already
    overridden the part you're tuning, HIS number wins in his game — so a stock buff won't
    reach him. Check: does the balance rely on a part kids commonly mod? If so, prefer
    Option B (a NEW part he hasn't overridden).
  - Re-balance the **share-code economy**: a stock buff silently strengthens every shared
    craft that uses the part. Usually fine; note it.

### Option B — Add a new stock part *(strong precedent)*
The Mega Tank and Osprey Vacuum Engine were added for *exactly this reason* — HANDOFF
Phase 4: "Without them the stock catalog barely escapes Earth." A new high-ve upper-stage
tank or a slightly stronger vacuum engine is squarely in precedent.
- **Theory obligation:** the rocket-equation justification for the new part's numbers (see
  `space-sim-analysis-toolkit`, recipe "how Mega+Osprey were justified" — it is the
  template). Show the natural 3-stage build's new margin.
- **Constraints:** a new part needs a new unique `id`, full geometry (so it renders and
  round-trips through share codes), and a pedagogy hook — every part must teach something
  real (`space-sim-pedagogy-and-content`). "A bigger tank" teaches mass ratio; "a better
  vacuum engine" teaches the thrust-vs-ve trade (the Osprey's existing lesson).

### Option C — Reduce Δv WASTE (guidance, not parts)
The ledger includes a 150 m/s outbound + 150 m/s inbound correction allowance and ~1068
m/s of ascent losses. Better window/coaching or cheaper corrections shrink the
*requirement*, not the capability.
- **Theory obligation:** measure the current correction spend (extend `dv_audit.mjs`'s
  flown section, or a browser flight), show the reduced allowance is realistic.
- **Note:** this is the subtlest option and the easiest to get wrong. The guidance
  philosophy is frozen: *window for departure, correction for arrival* — you may make
  corrections CHEAPER, but you may not try to make the window exact enough to skip
  corrections (see fenced paths).

### The built-in pressure valve (mention to the kid, don't rely on)
The mod editor IS the escape hatch: "make a stronger engine" is a **feature, not a cheat**
(HANDOFF item 2). A perfectly acceptable outcome is that the stock Kestrel stays ~3% short
and the kid learns to either fly the clustered Heavy variant OR bump a number himself. If
the owner is happy with that, the campaign's deliverable is *documentation* (a HANDOFF note
+ a Navigator coaching line), not a parts change. Confirm the intent before shipping a buff.

---

## Fenced-off wrong paths (do NOT do these)

| Tempting shortcut | Why it's forbidden |
|---|---|
| Lower `SCALE`, raise a body's `g0`, or soften gravity/drag in physics to make the trip easier | Violates owner frozen rule #3 (physics stays REAL; the only permitted lie is the documented ×0.1 scale). It also breaks every other mission's numbers. |
| Make the transfer window "exact enough to skip mid-course corrections" | Frozen guidance philosophy — **corrections ARE the lesson** (the Apollo-13 move). Removing them removes the teaching. |
| Silently buff a part the kid has already modded | His override wins anyway (won't reach him) AND it mutates his balance without consent — violates frozen rule #2 (don't break his stuff). |
| Nerf anything he already flies to "rebalance" | Same rule. You may add headroom; you may not take away a capability he has. |
| Tune against the HUD `computeStats` Δv | It's a whole-rocket approximation that reads low; you'd over-buff. Tune against the staged ladder from `dv_audit.mjs`. |
| Tune against the cheaper direct-injection number | The taught escape-then-window flow is the requirement. |
| Declare victory from one lucky browser flight | Success is the measured margin across the audit + a regression test, not a single run. |

---

## Phase 3 — Validation & promotion (routes through change control)

A balance change is a **gated change**. To promote it:

1. **Re-run the audit** — capture the new margin table. It must clear the bar you wrote in
   Phase 0.
2. **All 8 node suites green** — `for t in tests/*.mjs; do node "$t"; done` (nothing you
   tuned broke chute/reentry/transfer/etc.). See `space-sim-testing-and-qa`.
3. **Add a margin regression test** — a new `tests/` suite (or an assertion in an existing
   one) that fails if the natural stock Mars ship's margin drops below the bar. New behavior
   lands WITH its test (house rule). Without this, the balance silently rots on the next
   parts edit.
4. **Browser-verify a real flight** — fly (or teleport-and-return) the natural stock build
   through the full round trip and confirm it arrives home with fuel. See
   `space-sim-browser-verification`. Numbers over eyeballs: assert the arrival state, don't
   just watch it.
5. **Record it in HANDOFF.md** — house style (outstanding-first, what/why/verified-how):
   the gap, the fix, the before/after margin, the new test. Update
   `space-sim-constants-and-storage` if you changed a catalogued number, and this skill's
   Phase-0 table if the baseline moved.
6. **The final acceptance test is the kid** — he flies a Mars round trip on stock parts and
   comes home. Agent-verified margin is the gate to LET HIM TRY; his success is the
   acceptance (HANDOFF: "the kid's reaction … is the real acceptance test").

**Unlocking real-scale (SCALE=1.0):** the disabled real-scale toggle (HANDOFF item 5,
~9,400 m/s to LEO) is the same problem at 10× the numbers. Do NOT attempt it until the
scaled-universe balance clears its bar with comfortable headroom — real scale has none to
spare. When you take it on, it gets its OWN campaign run of this same protocol (new Phase-0
baseline at SCALE=1.0). See `space-sim-frontier` for the entry.

---

## Provenance and maintenance

Facts here were verified against the repo on **2026-07-06**. Re-verify before relying:

```bash
# Regenerate the entire Phase-0 gate (margins, ledger, ledger walk):
node .claude/skills/space-sim-delta-v-campaign/scripts/dv_audit.mjs

# Confirm the taught-flow decision the ledger is built on:
grep -n "window for the departure\|course-correction for the arrival" HANDOFF.md

# Confirm parts.js is still the pristine worked example (Option A is a gated change):
grep -n "PRISTINE\|worked example" js/mods.js js/parts.js HANDOFF.md

# Confirm SCALE (real-scale is 1.0, currently 0.1) and that it's still disabled:
grep -n "SCALE" js/state.js ; grep -ni "real-scale\|real scale" HANDOFF.md

# The audit self-checks its own SCALE from BODIES; if the header prints SCALE≠0.10,
# the baseline table above is stale — re-derive it.
```

If `dv_audit.mjs` ever fails to import (`Cannot find package 'three'` or a path error),
it imports pure modules only (`physics.js`, `state.js`, `parts.js`) via paths relative to
the script — a failure means those modules gained a browser/Three.js dependency, which is
itself a regression worth reporting (see `space-sim-architecture-contract`: physics must
stay node-pure).
