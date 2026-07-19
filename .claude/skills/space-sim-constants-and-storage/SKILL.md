---
name: space-sim-constants-and-storage
description: >
  Catalog of every tunable constant and localStorage schema in the space-sim repo,
  with exact file:line locations, current values (as of 2026-07-06), guard rails, and
  drift-check commands. Load this when you need to: find or change a game constant
  (SCALE, WARPS, BLOOM, landing speeds, heat tuning, chute drag, docking thresholds,
  Navigator MODEL/MAX_TOKENS, lighting); look up a stock part's numbers; read or
  modify anything persisted in localStorage (spacesim_mods_v1, spacesim_sats_v1,
  spacesim.science.v1, spacesim.visitedSystems.v1, spacesim_anthropic_key) or the
  rocket share-code format; add a NEW tunable or storage key; or verify a doc's
  quoted value against the code (e.g. the known 500,000x vs 2,000,000x warp drift).
  Keywords: constant, tunable, magic number, localStorage, save data, schema,
  migration, persistence, share code, part catalog, validation bounds.
---

# Space Sim: Constants and Storage Catalog

This skill is the ONE home for two facts-of-record: (A) every tunable constant —
where it lives, what it means, what bounds it — and (B) every persistent storage
schema — its exact shape, who reads/writes it, and the compatibility law that
protects it. All values below were read directly from the code **as of 2026-07-06**.
Before relying on any single value, run the matching drift-check command in the
Provenance section (or `scripts/check-drift.sh` for all of them at once).

**When NOT to use this skill:**

| Your task | Use instead |
|---|---|
| Deciding whether you're ALLOWED to change a value, and how to record it | `space-sim-change-control` |
| Why an invariant exists / what breaks if violated (floating origin, substep cap, contract shapes) | `space-sim-architecture-contract` |
| The game misbehaves and you're hunting the cause | `space-sim-debugging-playbook` |
| Orbital-mechanics math behind the numbers (why SCALE=0.1 → ~3.2x faster, Δv formulas) | `orbital-mechanics-reference` |
| Retuning fuel/thrust for the Mars round trip | `space-sim-delta-v-campaign` |
| The Navigator prompt, snapshot schema, kid-safety rules | `space-sim-navigator-and-safety` |
| Running/extending the node test suites | `space-sim-testing-and-qa` |

**Two owner-frozen rules govern this catalog** (from the 2026-07-06 handoff
interview; non-negotiable — see `space-sim-change-control` for the full set):

- **Rule #2 — never break his saves.** localStorage schemas and rocket share-codes
  must stay compatible. Migrate `v1 → v2` if the shape must change; never silently
  reinterpret existing data. Invalid entries must fail SAFE at load.
- **Rule #3 — physics stays real.** The only permitted lie *in the simulation* is the
  documented `SCALE = 0.1`. Tuning a physics constant into fantasy territory violates this
  rule. (Honestly-labeled ✨ magic shortcuts — teleport, Starmap fold — are a separate
  permitted category; see `space-sim-change-control` Rule 3 / `space-sim-pedagogy-and-content`.)

---

## Part A — Tunables catalog

Definitions: a **tunable** is a named top-level constant that changes game behavior
when edited. "Prod" = live gameplay value; "Exp" = documented alternative that is
not currently active. Units follow the physics contract: mass in tonnes (t), thrust
in kN, exhaust velocity in m/s, distance in m, time in s.

### A.1 World scale — `js/state.js`

| Constant | Location | Value | Meaning / guard rails |
|---|---|---|---|
| `SCALE` | state.js:13 | `0.1` | THE master training wheel: all body radii and orbit distances x0.1, surface gravity kept real (`mu = g0*r^2`). Side effect: system runs ~sqrt(10) ≈ 3.2x faster. `1.0` = real-scale mode — **disabled**, awaiting a part-tuning pass (~9,400 m/s to LEO; HANDOFF.md:428). Changing SCALE mid-save doesn't corrupt storage (sat orbits are in absolute meters and would become wrong-sized, but load still succeeds). This is the ONLY sanctioned physics lie (frozen rule #3). |
| `G` | state.js:15 | `6.674e-11` | Real gravitational constant, SI. Not a tunable in practice — never touch. |
| `RING_BAND` | state.js (near CONFIG) | `{inner: 1.25, outer: 2.3}` | Ring span in body radii, shared by render.js (band sheet + rock shells) and physics.js `parkingOrbit` (✨ Teleport parks at outer×1.15 so arrivals never sit inside ring material — the 2026-07-18 flicker fix). Change here changes BOTH the look and the parking radius; teleport_test.mjs section 3 pins the relationship. |
| `FORMING_DISC_BAND` | state.js (near CONFIG) | `{inner: 1.4, outer: 3.6}` | Same deal for still-forming worlds' circumplanetary discs (Centdra). |

Body data (radius, g0, orbit a, atmosphere height/density per world) lives ONLY in
the `REAL` table at state.js:21-51. HANDOFF's module table says it outright: "All
body data lives here — never hardcode elsewhere" (HANDOFF.md:360).

### A.2 Time warp — `js/main.js`

| Constant | Location | Value | Meaning / guard rails |
|---|---|---|---|
| `WARPS` | main.js:23 | `[1, 5, 25, 100, 1000, 10000, 100000, 500000, 2000000]` | Time-warp tiers stepped by `,` / `.`. Top tier 2,000,000x added for Pluto runs. High warp is safe because the integrator caps substeps per frame and sets `sim.warpLimited` when the cap bites (physics.js:183-192) — raising the top tier makes warp *display* bigger, not physics less accurate. |

**KNOWN DOC DRIFT (open as of 2026-07-06):** HANDOFF.md:38, ARCHITECTURE.md:90,
space-game-design.md:187, and the Navigator system prompt (copilot.js:37, "up to
500,000x") all still say **500,000x**. The code is right; trust main.js:23.
`space-sim-failure-archaeology` chronicles this drift.

### A.3 Landing, reentry, chute — `js/physics.js`

| Constant | Location | Value | Meaning / guard rails |
|---|---|---|---|
| `LAND_SPEED` | physics.js:25 | `5` | m/s max descent rate (vs the surface) for a soft landing. |
| `LAND_TOTAL` | physics.js:26 | `12` | m/s max TOTAL surface-relative speed (sideways skids count as crashes). |
| `LEGS_LAND_SPEED` | physics.js:27 | `12` | Descent-rate bound WITH landing legs aboard. The Navigator prompt teaches "5, or 12 with legs" (copilot.js:39) — change these and the prompt lies. |
| `LEGS_LAND_TOTAL` | physics.js:28 | `18` | Total-speed bound with legs. |
| `HEAT_EQ_K` | physics.js:34 | `3.8e-9` | Hull-heat equilibrium per unit of heat flux `rho*v^3`. Peak flux, not total energy, melts ships — tuning rationale in HANDOFF. |
| `HEAT_TAU` | physics.js:35 | `4` | Seconds for hull heat to relax toward equilibrium (both up and down). |
| `CHUTE_CDA` | physics.js:40 | `1200` | m^2 effective drag area per parachute. Sized so an open chute sinks at ~4-5 m/s on Earth (copilot.js:45 teaches this number). |
| `CHUTE_MAX_SPEED` | physics.js:41 | `250` | m/s (air-relative) above which a chute won't open. Also taught verbatim by the Navigator (copilot.js:45, "~250 m/s"). |

Guard rail for the whole group: `tests/chute_test.mjs` and `tests/reentry_test.mjs`
pin this behavior — run them after any change (`node tests/chute_test.mjs`).

### A.4 Integrator guards — `js/physics.js` (reference only)

`h = 0.003 / om` (~2000 substeps per local orbit, physics.js:116) and
`MAX_SUBSTEPS = 5000` per frame (physics.js:185, a function-local const) are
listed here for findability, but they are LOAD-BEARING architecture, not gameplay
dials — `space-sim-architecture-contract` owns the rationale. Do not tune them to
"make warp faster".

### A.5 Gameplay literals — `js/main.js` (inline, no named constant)

| Value | Location | Meaning |
|---|---|---|
| `dist < 150 && rel < 10` | main.js:882 | Docking succeeds within 150 m at under 10 m/s relative (comment at main.js:843). Taught verbatim in the Navigator prompt (copilot.js:41). |
| Satellite cap `24` | main.js:195 | Oldest satellites are spliced off beyond 24 ("keep the sky tidy"). |
| Visited-systems cap `12` | main.js:398 | `spacesim.visitedSystems.v1` list is sliced to 12 entries. |
| `SCIENCE_VALUE` | main.js:805 | `{ bio: 10, materials: 10, astro: 10, salvage: 15, alien: 25 }` — points per experiment kind. |

### A.6 Rendering — `js/render.js`

| Constant | Location | Value | Meaning / guard rails |
|---|---|---|---|
| `BLOOM` | render.js:31 | `{ strength: 0.55, radius: 0.4, threshold: 1.0 }` | UnrealBloomPass settings. **`threshold: 1.0` is a design invariant**: only things pushed PAST white bloom — Sun, engine plumes, reentry plasma, city lights. Normal surfaces must never bloom (comment at render.js:29-30). Tune strength/radius if you must; do not lower threshold. |
| Sun light | render.js:567 | `DirectionalLight(0xffffff, 2.0)` | Sunlight, re-aimed every frame from the Sun's scene position toward the craft. Dims to `1.15` with color `0xd8e2ff` in black-hole systems (render.js:711-712). |
| Ambient | render.js:571 | `AmbientLight(0x404a66, 0.5)` | Base fill so night sides aren't pure black. |
| Hemisphere | render.js:572 | `HemisphereLight(0xbcd4ff, 0x202830, 0.45)` | Sky/ground tint. (HANDOFF quotes this lighting trio as sun 2.0 / ambient 0.5 / hemi 0.45 — matches code.) |
| `GALAXY_ZOOM` | render.js:64 | `4.5e11` | Map frame beyond which visited star systems fade in (just past Pluto's scaled orbit). |
| `ROCK_COUNT` / `ROCK_ARC` | render.js:137-138 | `240` / `130` | Surface rocks that fade in near the ground (landing depth cue). |
| `PLUME_PARTICLES` | render.js:1150 | `150` | Engine exhaust particle count. |

### A.7 Navigator (copilot) — `js/copilot.js`

| Constant | Location | Value | Meaning / guard rails |
|---|---|---|---|
| `API_URL` | copilot.js:14 | `https://api.anthropic.com/v1/messages` | Browser-direct Anthropic Messages API. |
| `MODEL` | copilot.js:15 | `"claude-opus-4-8"` | Prod model. The documented cost swap (inline comment, same line): `"claude-haiku-4-5"` for ~5x cheaper, faster replies — Exp, sanctioned, but not active. |
| `MAX_TOKENS` | copilot.js:17 | `500` | Reply cap — keeps answers kid-short. |
| `LS_KEY` | copilot.js:16 | `"spacesim_anthropic_key"` | See Part B. |
| `SYSTEM` | copilot.js:19-50 | (prompt text) | **NOT a tunable.** The safety block is owner-frozen rule #1 — never weaken or bypass. `space-sim-navigator-and-safety` owns it. |

### A.8 Stock part catalog — `js/parts.js` (18 parts)

`parts.js` is the kid's worked example — it stays PRISTINE on disk; live edits are
localStorage overrides via mods.js (see B.1). The merged live catalog is
`PARTS` exported from **mods.js**, not parts.js — main/render/builder import from
mods.js. Masses in t, thrust in kN, exhaustVelocity (ve) in m/s.

| id | type | dryMass | key numbers |
|---|---|---|---|
| `command_pod` | command | 0.8 | crewed brain (a Connie flies) |
| `parachute` | chute | 0.1 | rides on top of the pod |
| `tank_small` | tank | 0.3 | fuelMass 4.0 |
| `tank_large` | tank | 0.6 | fuelMass 9.0 |
| `tank_mega` | tank | 1.1 | fuelMass 18.0 |
| `engine_sparrow` | engine | 0.5 | thrust 215, ve 2800 (~Isp 285 s) |
| `engine_hawk` | engine | 1.2 | thrust 600, ve 3000 (~Isp 306 s) |
| `engine_osprey` | engine | 0.9 | thrust 90, ve 4400 (~Isp 449 s, vacuum specialist) |
| `engine_crane` | engine | 0.35 | thrust 45, ve 2600, fuelMass 1.5 (self-fueled; cargo may hang below) |
| `engine_ion` | engine | 0.4 | thrust 6, ve 30000 (cannot lift off — real) |
| `engine_torch` | engine | 2.5 | thrust 900, ve 120000 (labeled far-future fusion) |
| `docking_port` | dock | 0.1 | required to dock |
| `decoupler` | decoupler | 0.05 | stage split |
| `landing_legs` | legs | 0.15 | raises survivable touchdown 5→12 m/s |
| `probe_core` | command | 0.3 | `uncrewed: true`; enables satellites/probes |
| `solar_panel` | solar | 0.08 | keeps a satellite powered |
| `rover` | rover | 0.5 | deployable cargo |
| `fin` | fin | 0.05 | stabilizer |

These numbers are the raw material of the Δv/fuel balance pass — if you're here to
RETUNE them, load `space-sim-delta-v-campaign` instead; this table just records
current values.

### A.9 Mod validation bounds — `js/mods.js` (`validatePartDef`, mods.js:47-88)

Any part the kid edits or imports must pass these, or it's rejected with a friendly
explanation (never clamped, never thrown):

| Field | Bounds | Where |
|---|---|---|
| `dryMass` | 0.001 – 500 t | mods.js:58 |
| `height` | 0.1 – 60 m | mods.js:59 |
| `radius` | 0.05 – 30 m | mods.js:60 |
| `thrust` (engines) | 0 – 100000 kN | mods.js:65 |
| `exhaustVelocity` (engines) | 100 – 20000 m/s | mods.js:66 |
| `fuelMass` (tanks) | 0.01 – 5000 t | mods.js:70 |
| `type` | one of `command, tank, engine, decoupler, fin, chute, legs, solar, rover, dock` | mods.js:28, 54 |

Note the deliberate quirk: stock `engine_torch` has ve 120000 — ABOVE the mod bound
of 20000. Stock parts don't pass through validation; only edits do. An edit to the
torch that keeps ve 120000 will be rejected. Pinned by `tests/mods_test.mjs`.

---

## Part B — Storage schemas

All persistent state lives in browser localStorage under 5 keys, plus one
copy-pasteable share-code format. Every reader is wrapped in try/catch and degrades
to a sane default — a mangled localStorage must never kill the boot.

| Key | Shape (summary) | Written by | Read by | Fail-safe at load |
|---|---|---|---|---|
| `spacesim_mods_v1` | `{ overrides: {stockId: PartDef}, customs: [PartDef] }` | mods.js `persist()` (mods.js:184-187) | mods.js `loadMods()` (mods.js:156-182) at import time | Each entry re-validated; invalid entries silently dropped; unknown stock ids skipped; garbage → stock catalog |
| `spacesim_sats_v1` | `[{ bodyKey, epoch, a, e, periAngle, M0, n, name, hasPower }]`, max 24 | main.js `saveSats()` (main.js:186) | main.js `loadSats()` (main.js:180-185); positions computed by `Physics.satellitePos` (physics.js:719); drawn by render | Filtered: entry dropped unless `BODIES[s.bodyKey]` exists and `isFinite(s.a)`; garbage → `[]` |
| `spacesim.science.v1` | integer as a string, e.g. `"85"` | main.js `awardScience()` (main.js:810) | main.js boot (main.js:791-793) | `parseInt(...) \|\| 0` |
| `spacesim.visitedSystems.v1` | `[{ seed, star, planets }]`, max 12, most-recent first | main.js `rememberVisit()` (main.js:395-399) | main.js `loadVisited()` (main.js:392-394), feeds the galaxy map | `JSON.parse \|\| []` in try/catch |
| `spacesim_anthropic_key` | raw API key string (no JSON) | copilot.js `setKey()` (copilot.js:55) via the in-app 🔑 button | copilot.js `getKey()` (copilot.js:54); `hasKey()` = length > 10 | try/catch → `""` (Navigator falls back to offline stub). NEVER log, echo, or commit this value. |
| `spacesim.wishlist.v1` | `[{ when: "YYYY-MM-DD", idea }]`, max 40, ideas capped 160 chars, case-insensitive deduped (2026-07-12) | copilot.js `saveWish()` — from `[[WISH: …]]` markers the model appends (online) or idea-shaped messages in the offline stub | copilot.js `loadWishes()`: the snapshot's `wishlist` field (last 15) + the offline "what's in the wish book?" reply | `JSON.parse \|\| []` in try/catch; his IDEAS — treat like saves (Rule 2) |
| `spacesim.school.v1` | `{ v: 1, name (≤12 chars), stickers: {build, space, land} }` (2026-07-16) | school.js `saveSchool()` | school.js `loadSchool()` via pure `SchoolCore.validateSaved` (node-tested) | Any junk → a fresh empty sticker book. HIS LITTLE SISTER'S save — Rule 2 applies to her too. School mode writes no other key. |
| `spacesim.crew.v1` | `{ v: 1, picked: [Connie names…] }` in pick order, first = commander (2026-07-18) | menu.js Complex screen via connies.js `saveCrewPicks()` | main.js `assignCrew()` via `loadCrewPicks()`; parsed by pure `parseCrewSave` (node-tested, tests/crew_test.mjs) | Junk/unknown names/dupes dropped → empty picks (a random unlocked Connie then flies, the pre-Complex behavior). Unlocks derive from `spacesim.science.v1` — never stored, can't go stale. |

Schema details worth knowing before you touch anything:

- **`spacesim_mods_v1`**: `overrides` is keyed by STOCK part id; on merge the id is
  pinned back to the stock id so an override can't hijack a different part
  (mods.js:127-136). `customs` append after stock; custom ids get `_mine` /
  `_mine2`... suffixes (mods.js:139-149). Field-by-field: a PartDef here is exactly
  the parts.js shape (A.8) and must pass the A.9 bounds.
- **`spacesim_sats_v1`**: orbital elements are ABSOLUTE (a in meters, angles in
  radians, `n` = mean motion rad/s, `epoch` = sim seconds) around `bodyKey`.
  `name` ("Sat N") and `hasPower` are added by main.js on deploy (main.js:189-196).
  Elements come from `Physics.makeSatellite` (physics.js:706-718), which returns
  `null` for hyperbolic/retrograde orbits — no bad records are ever written.
- **Share-codes** (not localStorage, but covered by the same compatibility law):
  `exportCraft` (mods.js:250-265) emits `{ v: 1, name, stack: [partId...],
  myParts: [PartDef...] }` — `myParts` carries full defs of any custom parts so a
  friend's game rebuilds the rocket without his mods. `importCraft` (mods.js:268-292)
  validates every custom part and every stack id, returning `{ ok:false, error }`
  with a kid-friendly message on any problem. Note the explicit `v: 1` field: the
  version bump slot already exists — use it.

### The compatibility law (owner-frozen rule #2)

1. **Never change the meaning of an existing field in place.** If `a` is meters
   today, it is meters forever under that key/version.
2. **If the shape must change, version-bump the key** (`spacesim_mods_v1` →
   `spacesim_mods_v2`) or the embedded version field (share-code `v: 1` → `v: 2`),
   and write a migration that reads the old format and converts. Leave the old key
   in place until migration is confirmed (a failed migration must not destroy the
   only copy).
3. **Invalid or old-format entries must fail SAFE at load** — drop the entry,
   never crash, never half-apply. `mods.js loadMods()` (mods.js:156-182) is the
   house model: parse in try/catch, re-validate every entry, silently degrade to
   stock. Its own comment says why: "a hand-mangled localStorage or an old format
   silently degrades to stock, never a crashed boot."
4. **Never delete a key you didn't migrate.** `resetMods()` (mods.js:238-242) is
   the only sanctioned wipe, and the caller confirms with the user first.

These are the kid's saves — mods he wrote, satellites he launched, science he
earned. Breaking them is the project's definition of catastrophe.

---

## Checklists

### Adding a new tunable

1. Put it as a named `const` at the TOP of the module that owns the behavior, with
   a comment stating units and why the value is what it is (house style — see every
   entry in physics.js:25-41).
2. Body/world data goes in state.js's `REAL` table, never hardcoded elsewhere.
3. Check the Navigator prompt (copilot.js SYSTEM) and HANDOFF.md: if either teaches
   the old number, your change just made the docs lie — update them in the same
   change (per `space-sim-change-control`), or don't change the number.
4. If a node test pins the behavior (chute, reentry, landing), run it:
   `for t in tests/*_test.mjs; do node "$t"; done`
5. Add the new constant to THIS skill's catalog and to `scripts/check-drift.sh`.

### Adding a new storage key

1. Name it `spacesim.<thing>.v1` (dot style, the newer convention) — include `v1`
   from day one.
2. Guard the read: try/catch + validate every entry + default value. Copy the
   `loadMods()` pattern (mods.js:156-182) or `loadSats()` (main.js:180-185).
3. Guard the write: try/catch, empty catch (storage full/blocked must not break
   the session — see mods.js:184-187).
4. Cap unbounded lists (sats cap 24, visited cap 12 — localStorage is finite).
5. Never store secrets beyond the one existing key; never log key contents.
6. Add the key to THIS skill's table and to `scripts/check-drift.sh`, and record
   the addition per `space-sim-change-control`.

---

## Provenance and maintenance

Every value above was read from the working tree on **2026-07-06** (all 8 node test
suites green the same day). One-liners to catch drift — or run them all at once:

```bash
bash .claude/skills/space-sim-constants-and-storage/scripts/check-drift.sh
```

| Fact | Re-verify with |
|---|---|
| SCALE = 0.1 | `grep -n 'const SCALE' js/state.js` |
| WARPS tiers / top 2,000,000 | `grep -n 'const WARPS' js/main.js` |
| Warp doc drift still open | `grep -n '500,000' HANDOFF.md ARCHITECTURE.md space-game-design.md js/copilot.js` |
| Landing constants 5/12/12/18 | `sed -n '25,28p' js/physics.js` |
| Heat/chute constants | `sed -n '34,41p' js/physics.js` |
| BLOOM threshold 1.0 | `grep -n 'const BLOOM' js/render.js` |
| Lighting 2.0/0.5/0.45 | `grep -n 'DirectionalLight\|AmbientLight(0x404a66\|HemisphereLight' js/render.js` |
| MODEL / MAX_TOKENS | `sed -n '14,17p' js/copilot.js` |
| Stock catalog still 18 parts | `grep -c 'id:' js/parts.js` |
| Mod validation bounds | `sed -n '47,88p' js/mods.js` |
| Docking 150 m / 10 m/s | `grep -n 'dist < 150' js/main.js` |
| Sat cap 24 / visited cap 12 | `grep -n 'length > 24\|slice(0, 12)' js/main.js` |
| All 5 storage keys unchanged | `grep -rn 'spacesim_mods_v1\|spacesim_sats_v1\|spacesim.science.v1\|spacesim.visitedSystems.v1\|spacesim_anthropic_key' js/` |
| Share-code still v:1 | `grep -n 'v: 1' js/mods.js` |
| Storage fail-safes still pass | `node tests/mods_test.mjs` |

If a check fails, the CODE is ground truth: update this file's value and date-stamp,
and check whether HANDOFF.md needs the same fix (per `space-sim-pedagogy-and-content`,
which owns docs-of-record maintenance).
