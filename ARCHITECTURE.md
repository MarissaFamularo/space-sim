# Space Sim — Phase 1 Architecture & Contracts

Phase 1 goal: build a rocket in a constrained 3D builder, launch it, and reach a stable
orbit around Earth, with live readouts and a (stubbed) AI copilot. Browser only, vanilla
JS ES modules + Three.js. See `space-game-design.md` for the full vision.

**This file is the contract. Every module builds against the shapes and APIs below.
Do not change a shared shape without updating this file.**

## Coordinate & units conventions (Phase 4: heliocentric)
- Physics is **planar 2D**: positions/velocities are `{x, y}` in the orbital plane, meters & m/s.
- The world origin is the **center of the SUN**. Every body rides a fixed CCW orbit around
  its parent (`state.js bodyStateAt(key, t)`); Earth moves, the pad moves with it. Rails are
  **circular by default**; a body def may carry `ecc` (< 0.9, plus optional `periAngle`) for
  a REAL elliptical rail — `orbitRadius` is then the semi-major axis, `omega` the mean
  motion, and bodyStateAt Kepler-solves (`solveKepler`) the true focus-centered position and
  velocity (CONTRACT REVISION 2026-07-16). Hohmann guidance treats eccentric targets by
  their semi-major axis; course correction (which reads bodyStateAt) covers the arrival.
- Render lifts the 2D plane into 3D: physics `(x, y)` → Three.js `(x, y, 0)` (orbit in the XY plane),
  MINUS a per-frame **floating origin** (the craft in flight) so float32 survives Neptune distances.
  The subtraction happens in float64 inside render.js before any THREE.Vector3 is touched.
- Mass in **tonnes (t)**, thrust in **kN**, exhaust velocity in **m/s**, time in **seconds**.
- Angles in **radians**, 0 = pointing along +Y (the rocket "up" at launch), increasing CCW.
- "Local" quantities (altitude, speed, prograde, orbit elements) are measured against the
  **dominant body** = deepest sphere of influence containing the craft (`dominantBody(pos, t)`):
  Moon beats Earth beats Sun. The integrator itself superposes gravity from ALL bodies.

## Forgiving by default (training wheels)
Real-scale space makes everything brutal. The whole solar system ships **scaled**: every
radius and orbit distance ×`SCALE` (0.1), every surface gravity kept REAL (`mu = g0·r²`).
Geometry stays faithful (Mars is still 1.52× Earth's distance from the Sun); the system runs
~√10 ≈ 3.2× faster as a side effect. Values live in `state.js` `BODIES` — do not hardcode
body constants elsewhere. `BODIES[key]` has: `name, key, radius, mu, g0, mass, solid,
atmosphere|null, parent, orbitRadius, omega, phase0, soiRadius`. Gas giants + the Sun have
`solid: false` — contact means sinking/melting, never landing.

---

## Shared data shapes (defined in `state.js`)

### PartDef (catalog entry, from `parts.js`, merged through `mods.js`)
```js
{
  id: "engine_sparrow",          // unique
  type: "command"|"tank"|"engine"|"decoupler"|"fin"|"chute"|"legs"|"solar"|"rover",
  uncrewed: true,                // command parts only: a probe core (no Connie flies)
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
  body: BodyDef,                 // launch body (Earth)
  craft: { pos:{x,y}, vel:{x,y}, angle, throttle /*0..1*/, fuelRemaining /*t*/, mass /*t*/, currentStage },
  orbit: { apoapsis, periapsis, eccentricity, semiMajor, isOrbit, periAngle,
           bodyName, bodyKey, bodyRadius, center } | null, // about the DOMINANT body; alts above its surface
  altitude, speed,               // vs the dominant body (speed is body-relative: parked on the Moon reads 0)
  soi,                           // dominant body's name ("Earth", "Moon", "Sun", "Mars", ...)
  target: "moon"|planetKey,      // 🎯 destination; guidance + distTarget follow it
  distTarget, distMoon,          // meters to the target's / Moon's center
  heat: 0..1,                    // reentry hull heat; 1 = burned up (sim.burnedUp set)
  time, timeWarp,                // sim seconds, warp multiplier (tiers to 500,000×)
  warpLimited,                   // true when physics capped the requested warp this frame
  status: "prelaunch"|"flying"|"orbit"|"crashed"|"landed",
  landed: { body: key, offset } | null,   // landed craft co-move with their body
  crashedInto: key | undefined,  // what we hit; sankIntoClouds for gas giants, burnedUp for heat/Sun
  crew: { name, hero } | undefined, // the Connie aboard (set by main.js at launch, from connies.js)
  transfer: TransferWindow | null,  // burn-window phasing toward sim.target
  course: CourseCheck | null,       // mid-course closest-pass prediction (when transfer is null)
  teleported: bodyName | undefined, // set when he ✨-teleported here (Navigator sees the shortcut)
  crew: Connie | null,              // null = uncrewed probe mission (no crew pod aboard)
  rover: { body, t0, offset } | undefined, // rover released on a surface (render draws it + tracks)
  satellites: [SatRec, ...],        // deployed satellites (main.js owns the array + localStorage)
}
// SatRec: { name, hasPower, bodyKey, epoch, a, e, periAngle, M0, n } — a conic frozen at
// release (Physics.makeSatellite); Physics.satellitePos propagates it for display.
// craft also carries per-stage part counts set by main.js loadStage: chuteCount, legCount
// (physics: legs raise touchdown limits 5→12 m/s descent, 12→18 total), solarCount, roverCount.
```

### CourseCheck (from `Physics.courseCorrection(sim)` — the Apollo 13 move)
Kepler-propagates the current conic (two-body about the dominant central) and reports the
predicted closest pass to the target, plus which small burn shrinks it. Recomputed ~2×/s by
main.js when no transfer window applies.
```js
{
  miss,                 // predicted closest approach to the target's center (m)
  tClosest_s,           // sim-seconds until that pass
  onTarget,             // miss < target's SOI — stop correcting, prepare to capture
  burnVec: {x,y}|null,  // unit vector: burn THIS way (gold arrow rides it)
  dirLabel,             // "prograde"|"retrograde-out"|... human flavor for the Navigator
  perDv, targetKey,
}
```

### TransferWindow (from `Physics.transferWindow(sim, targetKey?)`)
Hohmann phasing from a stable CCW orbit around a CENTRAL body toward a TARGET circling that
same central: Moon from Earth orbit, any planet (or Earth-home) from a Sun orbit. `null` when
guidance doesn't apply: not in a stable orbit, target doesn't circle your dominant body,
retrograde, or the orbit has already stretched >70% of the way from the current radius to
the target's (once the burn is underway the job is "keep burning", not "wait").
```js
{
  open,            // bool: burn moment is NOW (ship within ~15 deg of the burn point)
  degToGo,         // degrees of the ship's orbit left before the burn point (0..360)
  timeToWindow_s, transferTime_s,
  leadAngle_deg,   // required target lead at the burn: PI - omega_target * t_transfer
  burnPos: {x,y},  // world position ON the current orbit where the burn starts
  dir,             // "prograde" (outward trips) | "retrograde" (inward: Venus, Mercury, home)
  targetKey, centralKey,
}
```
Render draws a gold "Burn" label sprite at `burnPos` in map view, and while `open` the gold
targetArrow rides prograde/retrograde per `dir`. The Copilot snapshot exposes
`flight.transferWindow` and `flight.courseCheck`.

### Connie (crew member, from `connies.js`)
Connies are the game's astronauts: snakes in bubble helmets. `{ name, hero }` — `name` is a
pun on a real astronaut, `hero` the true fact behind it (Navigator shares it). Render owns the
Connie mesh: beside the pad in build mode, EVA beside the craft when `sim.status === "landed"`.

### BodyDef (from BODIES in state.js — Sun + 8 planets + Moon)
```js
{ key:"earth", name:"Earth", mass, radius, mu /*=g0*r^2*/, g0, solid,
  atmosphere:{ height, seaLevelDensity } | null,
  parent:"sun"|"earth"|null, orbitRadius, omega, phase0, soiRadius }
```
World position/velocity of a body at time t: `bodyStateAt(key, t)` (recursive through the
parent chain). `PLANET_KEYS` lists every body except the Sun.

---

## The active system (CONTRACT REVISION 2026-07-05 — the Starmap)

The world is no longer always Sol. `state.js` still exports `BODIES` and `PLANET_KEYS`,
but they describe the ACTIVE system and are swapped **in place** (same object/array
identity — every module's existing import keeps working) by:

```js
setSystem(catalog, planetKeys, meta)  // swap in a generated system (stargen.generateSystem)
returnToSol()                         // restore the pristine Sol snapshot exactly
SYSTEM                                // { key, name, seed, rev } — rev++ on every swap;
                                      //   cache anything derived from BODIES keyed on rev
isSol()                               // is the active system the real one?
buildCatalog(defs, order, scale?)     // the one mu/omega/SOI builder (Sol AND stargen use it)
```

**Role keys are stable across every system:** the star is ALWAYS keyed `"sun"`, the
homeworld (pad, TWR reference, "fly home") is ALWAYS keyed `"earth"`, and the homeworld's
guaranteed moon is ALWAYS keyed `"moon"`. Display names differ (`BODIES.earth.name` might
be "Hyven"); NEVER show a hardcoded "Earth"/"Sun" string — read `.name`. `stargen.js`
guarantees every generated home is launchable (solid, g0 7–11, chute-worthy air) and every
generated system passes the flyability property tests in `tests/stargen_test.mjs`.

After a swap the sim must be rebuilt (`newSimState`), the render world rebuilt
(`Render.rebuildWorld()`), and the target picker refilled (`UI.rebuildTargets()`) —
`main.js arriveInSystem()` is the one place that does this dance.

## Module APIs (frozen — build to these exactly)

### physics.js — `export const Physics`
Pure functions, **no DOM, no Three.js**. Owns orbital integration.
```js
Physics.step(sim, dtSeconds)        // advance sim.craft by dt under SUPERPOSED gravity from every
                                    //   body + thrust + drag vs the LOCAL air (each atmosphere moves
                                    //   with its planet). Semi-implicit Euler with ADAPTIVE substeps
                                    //   (0.02 s landing burns → hour-long interplanetary coasts),
                                    //   capped per call; sets sim.warpLimited when the cap bites.
                                    //   REVISION 2026-07-16 (warp burns): thrusting no longer pins
                                    //   the substep to 0.1 s — accuracy caps (≤2% mass burned and
                                    //   ≤80 m/s gained per substep) let burns run under time warp,
                                    //   and fuel/mass now drain PER SUBSTEP (Tsiolkovsky-honest
                                    //   across hour-long burned frames; tests/warpburn_test.mjs).
                                    //   Collisions vs every body: soft-land/crash on solid worlds,
                                    //   sink/melt on gas giants and the Sun.
Physics.maxStableStep(sim)          // -> the substep bound step() will use (dynamics/tunneling/thrust).
Physics.computeOrbit(sim)           // -> orbit about the DOMINANT body (see SimState.orbit shape).
Physics.applyStage(sim, craft)      // drop spent stage parts, recompute dry mass/fuel for new stage.
Physics.transferWindow(sim, key?)   // -> TransferWindow | null (see shape above). Pure, node-testable.
Physics.courseCorrection(sim, key?) // -> CourseCheck | null (see shape above). Pure, node-testable.
Physics.parkingOrbit(key, t?)       // -> {pos, vel, angle, radius, altitude, speed} | null: a circular
                                    //   CCW orbit just above body `key` at time t, entered on the sunlit
                                    //   side. Backs the ✨ Teleport button; null for the Sun. Pure.
                                    //   tinyMoon bodies (Phobos/Deimos) instead return a FORMATION point
                                    //   (matching parent orbit, 5 radii off, coOrbit:true) — you can't
                                    //   orbit a moon whose true SOI is smaller than its radius.
Physics.makeSatellite(sim)          // -> {bodyKey, epoch, a, e, periAngle, M0, n} | null: freeze the
                                    //   craft's current conic about its dominant body (satellite deploy).
Physics.satellitePos(sat, t)        // -> world {x,y} of that frozen conic at time t. Both pure.
```
Provide a tiny self-check at bottom under `if (import.meta.url === ... )`-style guard OR an
exported `Physics._selfTest()` that logs a known circular-orbit check. Keep it deterministic.

### render.js — `export const Render`
Owns ALL Three.js. Builder and main call these; they never touch Three directly.
```js
Render.init(canvasEl)                       // set up scene, camera, lights, starfield, Earth sphere.
Render.rebuildWorld()                       // CONTRACT REVISION 2026-07-05 (Starmap): dispose + rebuild
                                            //   every body mesh/orbit ring/map dot from the ACTIVE
                                            //   BODIES catalog. Call after state.setSystem()/returnToSol().
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

---

## CONTRACT REVISION 2026-07-12 — Konnie Space Program (front door, facilities, EVA)

The game is formally named **KONNIE SPACE PROGRAM**. Two new PM-owned modules and a few
recorded API extensions; every previously-frozen surface is otherwise unchanged.

### New modules (both DOM-only, own no game state)
- **menu.js** — `Menu.init({onVAB,onHangar,onTracking,onSettingsChange})`, `showTitle()`,
  `showCenter()`, `hideAll()`, `isOpen()`, `getSettings()`. Title screen → Konnie Space
  Center (SVG campus, three buildings). Settings persist in localStorage
  `"spacesim.settings.v1"` (`{graphics:"fancy"|"fast"}`).
- **tracking.js** — `Tracking.init({getSim,getSatellites,onExit})`, `show()`, `hide()`,
  `isOpen()`. The 📡 Tracking Center: 2D-canvas live map of the ACTIVE system (bodies via
  `bodyStateAt`, satellites via `Physics.satellitePos`, stations via their circular
  elements). Zoom/pan/click-to-track + a preview "sky clock". Reads state only.

### Render API extensions (recorded, same spirit as rebuildWorld)
```js
Render.setQuality("fancy"|"fast")   // "fast" skips the composer (no bloom/post) per frame
Render.enterEva(sim, {onExit})      // EVA ANYWHERE: Connie outside — spacewalk w/ tether
                                    //   (space) or walk/hop at the world's real g0 (landed).
Render.exitEva()
Render.isInside()                   // now true for station interiors AND EVA (time freezes)
Render.enterStation(info, cb)       // info gains .spin — centrifuge interior: gravity mode
                                    //   (walk/jump on the floor instead of zero-g drift)
```

### Builder + parts
- `Builder.setFacility("vab"|"hangar")` filters the stock palette by the new optional
  `PartDef.facility` tag (untagged parts + all customs show everywhere).
- New stock parts (facility:"hangar"): Swift Plane Cockpit, **Delta Wings** (`type:"wing"`),
  Station Hub + Habitat Module (`type:"station"`), **Centrifuge Ring** (`type:"centrifuge"`).
  mods.js TYPES accepts the three new types.
- New per-stage craft fields set by main's loadStage: `wingCount`, `stationCount`,
  `centrifugeCount` (same pattern as legCount/dockCount).

### Physics
- **Wing lift** in the drag block of `Physics.step`: perpendicular to the airflow,
  `CL = clamp(2.0·sinAoA, ±1.3)` (stall), area 24 m² per wing part, accel capped 60 m/s²,
  plus a small wing drag term. No air ⇒ no lift. Tested in `tests/hangar_test.mjs`.

### Player stations
- localStorage `"spacesim.playerStations.v1"`: `[{id,name,body,altR,phase0,centrifuge,system}]`
  (cap 16; `system` = "sol" or the lowercased seed). main.js folds the active system's
  entries into the live `STATIONS` array (flag `yours:true`), so docking, targets, teleport,
  render, and tracking all work off the one list. Deploy = "🛰 Deploy as Space Station"
  button (stable orbit + stationCount>0): circular orbit at the current radius/phase.
- STATIONS entries may now carry `yours` and `centrifuge` (render tints yours gold;
  boarding a centrifuge station passes `spin:true` to enterStation).

## CONTRACT REVISION 2026-07-12b — Famous star systems

- **js/famous.js** (pure data + buildCatalog, node-tested): hand-built legendary systems
  the Starmap resolves BEFORE the seeded generator — `famousSystem(seed)` (alias-normalized:
  "kerbin"/"KSP"/"avatar"/"alpha centauri" → canonical) and `FAMOUS_LIST` (Starmap panel +
  pre-lit galaxy-map entries). `generateSystem()` checks it first; ordinary seeds unchanged.
- **The Kerbol System** (KSP homage): canon values entered ×10 so the game's SCALE=0.1
  lands on TRUE KSP numbers (Kerbin 600 km / mu 3.53e12 / SOI ~84,000 km / canon year).
- **The Pandora System** (Avatar homage): the homeworld role "earth" is a MOON of a gas
  giant (parent "polyphemus") — first system to exercise that. Fixes that shipped with it:
  ui.buildTargets skips "earth" when it appears among a planet's moons (it lists last, as
  home); main.tripDaysFromEarth measures home's star distance via its parent planet when
  home doesn't orbit the star directly. Famous systems carry `famous` + `blurb` (custom
  arrival brief in travelToSystem). It's also a TRIPLE STAR (2026-07-12): companion stars
  are ordinary bodies with `parent:"sun"` + `style.star` (Alpha Centauri B at the true
  23.5 AU mean separation; Proxima at 70 AU, ~200x compressed and confessed in the blurb).
  Companion SOIs are overridden post-buildCatalog to the gravity-balance point
  (r = a·√q/(1+√q)) because the Laplace SOI formula assumes a tiny mass ratio; physics.step
  treats any star-styled non-solid body like the sun on impact (burnedUp, not
  sankIntoClouds).

## CONTRACT REVISION 2026-07-16 — The Youngcow build (his spec)

- **Elliptical rails** (`ecc`/`periAngle` on body defs) — see the coordinate conventions
  section above. First users: Ember (Hundun's lava moon, e=0.45) and Comet Konnie (e=0.6).
- **The Youngcow System** (famous.js): young yellow dwarf + protoplanetary disc. New
  body-style flags render.js understands: `protoDisc {inner,outer}` + `young` (star),
  `rings` (existing), `lumpy` (displaced watertight sphere — Pebble), `comet` (coma +
  sun-averted tail, grows near periapsis), `formingDisc` (fast circumplanetary disc —
  Centdra), `lockedLava` + face kind `lavaLocked` (molten hemisphere aimed at the star —
  Sia), `life: "dinobird"` (grazing armored herbivores + plant tufts near the ground),
  `meteorRain` (ring-rock strikes), `bases: [{id,name,wrecked,phi}]` (ground bases at
  fixed surface angles).
- **Ground bases**: main.js `updateBasesSim()`/`boardBase()` — land within 2.5 km,
  press **B**, `Render.enterStation` gains `info.ground` (planet-gravity interior: walk
  mode, nothing floats, floor-height consoles, surface windows; wrecked variant carries
  the herd-stampede story via new science kind `basewreck`). `sim.baseNear` mirrors
  `sim.stationNear` for the Navigator.
- **`Render.spawnMeteor(sim, hitShip)`** (recorded API extension): visual ring-rock
  strike; main.js `updateMeteorRain()` rolls events over `meteorRain` worlds (< 30 km or
  landed, warp ≤ 100) and a hit decrements ONE per-stage part count on sim.craft
  (chute/legs/solar/wings/dock) — flight-only, never the saved craft (Rule 2).
- **New stock part** `engine_antimatter` ("Annihilation Beam Drive", ve 2,000 km/s,
  shape "beam"): plume gains a `beam` tier (violet laser lance) for ve ≥ 1,000 km/s.
- **Warp burns** — see the Physics.step revision note above (per-substep fuel/mass).

## CONTRACT REVISION 2026-07-16b — Interstellar Phase B (really flying there)

- **stargen.js** gains `interstellarVector(fromSeed, toSeed)` + `GAME_LY` (pure,
  node-tested): the compressed galaxy-map positions are treated as the TRUE geometry,
  scaled so Pandora sits at Alpha Centauri's real 4.37 ly; a game light-year is
  ×0.1 like every other distance. tests/interstellar_test.mjs.
- **main.js interstellar state machine** (`sim.interstellar = {seed, name, ly, dir,
  dest, prev, startTime}`): once the craft truly escapes its star (dominant = sun and
  v ≥ v_esc), a main-owned course panel offers the galaxy neighborhood. WARPS gained
  two tiers (2e7, 2e8) that only unlock on a course. `aimAtCourse(sign)` is attitude
  control: cruise aim blends along-line thrust with drift-kill (velocity-steering);
  brake aim is pure retrograde. **Honest autopace** (the warpLimited philosophy): warp
  only steps DOWN — coast frames cover ≤20% of the distance to the system's EDGE,
  burn frames add ≤5% of speed along-line and ≤60% of remaining drift cross-line
  (each gear engages only when its thrust component is real). Arrival = the flown
  segment passes within ARRIVE_R (4e12 m) of the destination (segment test — a warp
  frame may not skip the bubble); `arriveFromInterstellar()` swaps the system IN
  FLIGHT (unlike the Starmap fold's pad reset), placing the craft at the new system's
  edge with its true inbound velocity and fuel. Brake zone = stop-distance rule OR
  the final 15% of the approach.
- **Render**: `interMarker` destination beacon drawn along the true bearing at 2e11 m
  (the real point is ~1000x past the far plane; bearing is what a pilot needs).
- **Navigator**: INTERSTELLAR FLIGHT prompt section; snapshot gains
  `flight.interstellar {destination, lightYearsToGo, closingSpeed_kms, phase}`.
- Relativity is not simulated (~1% c; the Navigator says so if asked). Stars'
  relative motion is ignored (rails don't move between systems).

## CONTRACT REVISION 2026-07-16c — Station berthing + interior archetypes (his fix)

- **Berth pull-in** (main.js updateStationsSim): while docked with throttle 0, the
  craft is winched to a flush berth 12 m off the station's +X port (exponential
  ease, station-orbit velocity, nose at the port). Throttle > 0 releases; the
  existing 600 m hysteresis re-arms the latch. No API change.
- **Interior archetypes** (render.js enterStation, internal): every non-derelict
  space station is a seeded KIND — hub / depot / garden / observatory / lab — with
  its own walls, lighting mood, windows (hubs/gardens see their planet; the
  observatory gets one big cupola + telescope + real red night-lighting), furniture,
  and console kinds. Famous addresses hand-pinned (harbor=hub, selene=depot,
  Pandora & Youngcow homes=garden, Gene's=hub, Jool outpost=lab). Ground bases and
  the derelict keep their existing looks.

## CONTRACT REVISION 2026-07-16d — 🎒 Space School (the little-sibling classroom, Mom's ask)

- **New module school.js** (DOM-only overlays, menu.js-style; owns no game state):
  `School.init({prepRocket, launchRocket, stageRocket, setThrottle, setWarp,
  deployChute, resetGame, toCenter})`, `show()`, `isOpen()` (a full-screen room is up —
  main.js blocks flight keys on it, same guard as Menu/Tracking), `isFlying()`,
  `onTick(sim)` (called once per frame; drives the flight coaching, no-op otherwise).
  Also exports pure `SchoolCore` (build-order checker, sticker-book validator, flight
  phase machine, `spaceAltitude()`) — node-tested in tests/school_test.mjs.
- **Menu.init gains `onSchool`** (fourth campus building). No other Menu change.
- **New storage key `spacesim.school.v1`** — `{v:1, name (≤12 chars), stickers:
  {build, space, land}}`, written only by school.js, validated on load (garbage →
  fresh book). HER save; Rule-2 protected like every other key. School writes NO
  other key — a school flight (pod/tank/decoupler stack) cannot deploy satellites
  or stations, so his persisted world is untouchable from school mode.
- **The school flight uses the ordinary launch path** (main.js launch/doStage/
  deployChute; the craft is stock parts on the shared craft object) — physics
  untouched. The teacher's only powers are the same levers the keyboard has
  (throttle, stage, chute, time-warp, steering), always announced out loud.
- **Lesson 4 (same day): GO AROUND THE WORLD.** `School.init` gains `setAngle`
  (the teacher holds the wheel — said out loud; steering is the one control a
  5-year-old can't work). Second stack `SchoolCore.ORBIT_STACK` (big tank + heat
  shield). The ascent is the real two-burn profile — gravity-turn burn to set the
  apoapsis, engine-off coast, sideways push at the top (`SchoolCore.ascentAngle` /
  `retroAngle` / `radialSpeed`, pure + node-tested); a single continuous burn was
  tried and REJECTED: this stack carries more than escape Δv and flies straight
  past orbit onto an escape path (chronicled in tests/school_test.mjs). Sticker
  book gains `stickers.orbit` (additive; old books load with it false).

## CONTRACT REVISION 2026-07-18c — 🤖 Interstellar autopilot + warp streaks

- **`Physics.autopilotStep(st)` (new pure API)**: the interstellar autopilot POLICY —
  half-tank rule (spend ≤ half the tank accelerating; the reserve always suffices to
  brake because a lighter ship gets more Δv — Tsiolkovsky), coast, trim-if-drifting,
  flip/brake on the course panel's honest brake-zone test, cut at ≤30 km/s. Returns
  `{throttle, aim(+1/-1), phase: burn|coast|trim|brake|glide|dry}`. Node-tested by
  integrating the full Sol→Youngcow trip (tests/autopilot_test.mjs, 11 checks).
- **`sim.interstellar` gains optional `auto`** (`{fuel: t-at-engage, phase}`): set by
  the course panel's 🤖 button; main.js applies the policy each frame through the SAME
  controls the player has (aimAtCourse + throttle) and may step warp UP (cruise
  control, still under the honest autopace cap). ANY flight key (arrows/Z/X/,/.) calls
  `autopilotOff()` — the ship is handed back, course stays locked. Snapshot gains
  `flight.interstellar.autopilot` (the phase).
- **Warp streaks (render.js, cosmetic)**: additive LineSegments "speed lines" around
  the craft, follow view only, gated on `sim.interstellar` + effective speed
  (speed × warp) > 1e9 m/s; length/flow scale with effective speed. Confessed in the
  Navigator prompt as drawn speed lines (real interstellar space would look still).

## CONTRACT REVISION 2026-07-18b — 🧑‍🚀 The Astronaut Complex (pick your crew; science recruits)

- **PartDef gains optional `seats`** (crewed command parts only): Acorn Pod 3 (the real
  Apollo number), Swift Cockpit 2; a crewed command part with no `seats` counts as 1.
  Probe cores stay `uncrewed` and carry nobody. Ids untouched; parts.js stays pristine
  (two data lines + comments).
- **`computeStats` returns `seatCount`** (sum of crewed seats aboard; builder HUD shows
  a "Seats 🐍" row when nonzero).
- **connies.js grows the roster contract**: each Connie may carry `unlock` (lifetime
  science needed to recruit; absent = 0 so kid-added customs always fly). New pure
  helpers `isUnlocked/unlockedConnies/parseCrewSave/loadCrewPicks/saveCrewPicks/
  pickCrew` — node-tested in tests/crew_test.mjs (22 checks). Science is a THRESHOLD,
  never spent.
- **New storage key `spacesim.crew.v1`** — `{v:1, picked:[names…]}` in pick order
  (first = commander). Garbage-tolerant load; unknown names dropped. Written only by
  the Complex screen (menu.js). Rule-2 catalogued in the constants skill.
- **SimState gains `crewList`** (array of Connies aboard; `sim.crew` stays the
  commander object, so every existing callout/snapshot consumer is unchanged).
  Snapshot gains `flight.crewMates` (names, only when >1 aboard).
- **Menu.init gains `getScience`**; the Complex screen is menu-owned (`data-go=
  "complex"` building on the campus, `showComplex()` like Settings). Campus SVG
  viewBox widened 1150→1320.
- **assignCrew** (main.js) now: seats from the craft's crewed command parts →
  `pickCrew(loadCrewPicks(), SCIENCE, seats)`. No picks → one random unlocked Connie
  (old behavior); locked picks quietly stay home.

## CONTRACT REVISION 2026-07-18 — Ring bands are shared constants; Teleport parks clear of them

- **state.js exports `RING_BAND` ({inner: 1.25, outer: 2.3}) and `FORMING_DISC_BAND`
  ({inner: 1.4, outer: 3.6})** — the spans render.js draws rings (`style.rings` worlds
  + Sol's Saturn) and forming discs (`style.formingDisc`, Centdra) at, in units of body
  radius. One home for the numbers: render draws with them, physics parks around them.
- **`Physics.parkingOrbit` parks OUTSIDE the band on ringed/disc-wrapped worlds**
  (band outer × 1.15; same max() rule as the atmosphere clearance — return shape
  unchanged). The old 1.35 r default put the ✨ Teleport arrival INSIDE Hundun's ring
  (and just under Centdra's disc): the ring plane filled the sky and shimmered as the
  orbit crossed it. Real missions park clear of ring material for the same reason.
  Node-tested (teleport_test.mjs section 3; Hundun arrives at 2.65 R, 1300 m/s —
  predicted, then measured).
