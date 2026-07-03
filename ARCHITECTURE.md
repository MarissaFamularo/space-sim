# Space Sim — Phase 1 Architecture & Contracts

Phase 1 goal: build a rocket in a constrained 3D builder, launch it, and reach a stable
orbit around Earth, with live readouts and a (stubbed) AI copilot. Browser only, vanilla
JS ES modules + Three.js. See `space-game-design.md` for the full vision.

**This file is the contract. Every module builds against the shapes and APIs below.
Do not change a shared shape without updating this file.**

## Coordinate & units conventions
- Physics is **planar 2D**: positions/velocities are `{x, y}` in the orbital plane, meters & m/s.
- The world origin is the **center of Earth**. Surface is at radius `body.radius`.
- Render lifts the 2D plane into 3D: physics `(x, y)` → Three.js `(x, y, 0)` (orbit in the XY plane).
- Mass in **tonnes (t)**, thrust in **kN**, exhaust velocity in **m/s**, time in **seconds**.
- Angles in **radians**, 0 = pointing along +Y (the rocket "up" at launch), increasing CCW.

## Forgiving by default (training wheels)
Real-scale Earth makes reaching orbit brutal. Phase 1 ships a **scaled, forgiving Earth** by
default so getting to orbit is fun; a real-scale flag flips it later. Values live in
`state.js` `BODIES.earth` — do not hardcode body constants elsewhere.

---

## Shared data shapes (defined in `state.js`)

### PartDef (catalog entry, from `parts.js`, merged through `mods.js`)
```js
{
  id: "engine_sparrow",          // unique
  type: "command"|"tank"|"engine"|"decoupler"|"fin",
  name: "Sparrow Engine",
  dryMass: 0.5,                  // t
  // type-specific:
  fuelMass: 0,                   // t (tanks only)
  thrust: 215,                   // kN (engines only)
  exhaustVelocity: 2800,         // m/s (engines only; ~Isp*9.81)
  // geometry for render + snap (meters):
  height: 1.8, radius: 0.6,
  shape: "cone"|"cylinder"|"nozzle"|"fin",
  attachTop: true, attachBottom: true,
}
```
Consumers now import `PARTS` from **`js/mods.js`**, not parts.js — same shape (array of
PartDef), but merged with the kid's saved edits (Phase 3 modding). Merged entries may carry
two extra display-only flags: `modified: true` (stock part with an override) and
`custom: true` (a part he made). parts.js on disk stays pristine — it's his worked example.

### PartInstance (one placed part, lives in Craft.parts)
```js
{ instanceId: "p3", partId: "tank_small", stage: 1 }
```
Phase 1 builder is a **single vertical stack**, so order in `parts` array = bottom→top
position; explicit coordinates are not needed in Phase 1 (render derives them by stacking).
`stage` = which stage number this part is jettisoned/activated in (0 fires first).

### Craft (the shared document the builder mutates and flight flies)
```js
{ name: "My Rocket", parts: [PartInstance, ...] }
```

### Stats (computed by `computeStats(craft)` in state.js — UI + copilot read this)
```js
{ totalMass, dryMass, fuelMass, thrust, twr, deltaV, stageCount }
```

### SimState (the live flight state; physics writes, render/ui/copilot read)
```js
{
  mode: "build"|"flight",
  body: BodyDef,                 // dominant body (Phase 1: always earth)
  craft: { pos:{x,y}, vel:{x,y}, angle, throttle /*0..1*/, fuelRemaining /*t*/, mass /*t*/, currentStage },
  orbit: { apoapsis, periapsis, eccentricity, semiMajor, isOrbit, periAngle } | null, // alt above surface, m; periAngle = world angle of periapsis (from ecc vector)
  altitude, speed,               // convenience, above surface / inertial
  heat: 0..1,                    // reentry hull heat; 1 = burned up (sim.burnedUp set)
  time, timeWarp,                // sim seconds, warp multiplier
  status: "prelaunch"|"flying"|"orbit"|"crashed"|"landed",
  crew: { name, hero } | undefined, // the Connie aboard (set by main.js at launch, from connies.js)
  transfer: TransferWindow | null,  // Moon-burn phasing (main.js sets from Physics.transferWindow each frame)
}
```

### TransferWindow (from `Physics.transferWindow(sim)`)
Hohmann-style Moon-transfer phasing, valid only in a stable CCW Earth orbit whose apoapsis
is still well below the Moon (< 0.6 × Moon orbit radius); `null` otherwise (incl. retrograde
orbits — no guidance rather than wrong guidance).
```js
{
  open,            // bool: burn moment is NOW (ship within ~15 deg of the burn point)
  degToGo,         // degrees of the ship's orbit left before the burn point (0..360)
  timeToWindow_s, transferTime_s,
  leadAngle_deg,   // required Moon lead at the burn: PI - omega_moon * t_transfer
  burnPos: {x,y},  // world position ON the current orbit where the burn starts
}
```
Render draws a gold "Burn" label sprite at `burnPos` in map view, and while `open` the gold
targetArrow rides prograde instead of the gravity-turn schedule. The Copilot snapshot exposes
`flight.transferWindow: { open, degToGo }`.

### Connie (crew member, from `connies.js`)
Connies are the game's astronauts: snakes in bubble helmets. `{ name, hero }` — `name` is a
pun on a real astronaut, `hero` the true fact behind it (Navigator shares it). Render owns the
Connie mesh: beside the pad in build mode, EVA beside the craft when `sim.status === "landed"`.

### BodyDef (from BODIES in state.js)
```js
{ name:"Earth", mass, radius, mu /*=G*mass*/, g0 /*surface gravity*/, atmosphere:{ height, seaLevelDensity } | null }
```

---

## Module APIs (frozen — build to these exactly)

### physics.js — `export const Physics`
Pure functions, **no DOM, no Three.js**. Owns orbital integration.
```js
Physics.step(sim, dtSeconds)        // advance sim.craft by dt under gravity + thrust + (optional) drag.
                                    //   applies throttle along sim.craft.angle, burns fuel, updates mass,
                                    //   integrates pos/vel (use semi-implicit Euler or RK4, small dt).
                                    //   handles ground collision (status "crashed"/"landed").
Physics.computeOrbit(sim)           // -> orbit object (apo/peri/ecc/semiMajor/isOrbit) from pos/vel/mu.
                                    //   isOrbit = periapsis > atmosphere top (or surface if no atmo).
Physics.applyStage(sim, craft)      // drop spent stage parts, recompute dry mass/fuel for new stage.
Physics.transferWindow(sim)         // -> TransferWindow | null (see shape above). Pure, node-testable.
```
Provide a tiny self-check at bottom under `if (import.meta.url === ... )`-style guard OR an
exported `Physics._selfTest()` that logs a known circular-orbit check. Keep it deterministic.

### render.js — `export const Render`
Owns ALL Three.js. Builder and main call these; they never touch Three directly.
```js
Render.init(canvasEl)                       // set up scene, camera, lights, starfield, Earth sphere.
Render.buildCraftMesh(craft)                // (re)build the rocket mesh from parts (bottom→top stack).
                                            //   returns nothing; stores internally. Call on any craft change.
Render.setMode("build"|"flight")            // build: orbit-camera around craft on a launchpad.
                                            //   flight: follow-cam tracking craft over Earth.
Render.update(sim)                          // per-frame: place craft at sim.craft.pos/angle (lift 2D->3D),
                                            //   update camera, draw/refresh the predicted orbit ellipse.
Render.highlightSnap(yes, atTopOfStack)     // builder uses while dragging a new part (show ghost/snap point).
Render.screenToBuildIntent(event)           // optional helper for builder hit-testing; may return null.
```

### builder.js — `export const Builder`
Owns the constrained 3D builder UI + the parts palette DOM. Mutates the shared Craft, then
calls `Render.buildCraftMesh(craft)` and `onChange()` so UI stats refresh.
```js
Builder.init({ craft, partsCatalog, onChange })  // render palette, wire drag/click add-to-stack.
Builder.show() / Builder.hide()
// Constrained: parts snap onto the TOP of the vertical stack (and a decoupler defines a stage break).
// Provide: add part, remove top part, set part's stage / insert decoupler, clear, auto-name.
```

### mods.js — Phase 3 part modding (wraps/merges the parts.js catalog)
Owns the kid's part edits: in-memory overrides of stock parts + his custom parts, persisted
in localStorage `"spacesim_mods_v1"` (guarded try/catch, so the module imports cleanly in
node). Merging + validation are PURE and node-tested (`tests/mods_test.mjs`).
```js
export const PARTS                     // THE merged live catalog (stock + mods), same shape as
                                       //   parts.js PARTS. Mutated IN PLACE by applyMods() so
                                       //   main/render/builder references stay live.
mergeCatalog(stock, mods)              // PURE -> new merged array. Override ids are pinned to the
                                       //   stock slot (an override can't hijack another part).
validatePartDef(def)                   // PURE -> {ok:true, def:cleanCopy} | {ok:false, error}.
                                       //   Friendly kid-facing errors; REJECTS, never clamps.
parsePartJSON(text)                    // PURE parse+validate; JSON errors become line-pointing hints.
explainJsonError(text, err)            // PURE friendly SyntaxError message ("line 3: ...").
makeCustomFrom(def, existingIds)       // PURE clone: fresh unique id, name + " (mine)".
setOverride(id, def) / addCustom(def) / updateCustom(id, def) / resetMods()
loadMods() / getMods() / hasMods() / applyMods()
modsSummary()                          // for the Navigator snapshot: [{id, name, kind, key numbers}]
```
Mods shape in storage: `{ overrides: { [stockId]: PartDef }, customs: [PartDef] }`. Invalid
saved entries are dropped at load (failing safely — a mangled store can't break boot).

### ui.js + main.js + copilot.js — owned by PM (integration). Not part of the fan-out.
Copilot snapshot additions (Phase 2/3): `flight.transferWindow: {open, degToGo}` and
`mods` (modsSummary output) so the Navigator can coach the burn timing and mentor his edits.

---

## Integration order
1. PM writes contracts + state.js + parts.js + index.html + stubs.  ← done first
2. Agents build physics.js, render.js, builder.js in parallel to the APIs above.
3. PM writes ui.js (readouts + flight controls), main.js (game loop, mode switch, goal detect),
   copilot.js (snapshot → Claude API w/ local key, graceful stub), then integrates & smoke-tests.

## How to run (for the user)
From `space-sim/`: `python3 -m http.server 8000` then open `http://localhost:8000`.
(ES modules need http://, not file://.)
