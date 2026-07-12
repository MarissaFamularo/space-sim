# Space Sim — Phase 1 Architecture & Contracts

Phase 1 goal: build a rocket in a constrained 3D builder, launch it, and reach a stable
orbit around Earth, with live readouts and a (stubbed) AI copilot. Browser only, vanilla
JS ES modules + Three.js. See `space-game-design.md` for the full vision.

**This file is the contract. Every module builds against the shapes and APIs below.
Do not change a shared shape without updating this file.**

## Coordinate & units conventions (Phase 4: heliocentric)
- Physics is **planar 2D**: positions/velocities are `{x, y}` in the orbital plane, meters & m/s.
- The world origin is the **center of the SUN**. Every body rides a fixed circular CCW orbit
  around its parent (`state.js bodyStateAt(key, t)`); Earth moves, the pad moves with it.
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

## CONTRACT REVISION 2026-07-12c — Crew picks (the 🐍 Astronaut Complex)
<!-- Amended the same day, same session: single-pick grew into multi-seat LINEUPS +
     science-milestone RECRUITS before any of it shipped to main. This section is the
     final shape; the interim single-pick API (getPick/setPick) no longer exists. -->

Who flies is now the player's choice, crews can be up to 3 (his ask: the Trio Pod), and
science milestones grow the roster. Every previously-frozen surface is unchanged except
the recorded extensions below.

### Connie shape extended (connies.js — still his kid-editable data file)
```js
{ name, hero,                       // as before (name pun + true fact)
  role: "Pilot"|"Scientist"|"Engineer"|"Navigator",  // OPTIONAL — the real hero's real job
  skill: "one kid-readable line" }  // OPTIONAL — what they're best at
```
Both new fields are optional: a Connie without a valid `role` (e.g. one HE adds) flies
as a **Rookie** (`crew.js roleOf()`). `pickConnie()` is unchanged. connies.js also
exports **`RECRUITS`**: same shape plus `joinsAt` (a science total) — recruits graduate
into the roster when `spacesim.science.v1` reaches their milestone (that's what science
is FOR).

### PartDef extended (parts.js / mods.js)
- Command parts may carry `seats` (default 1). Stock: Acorn + Swift Cockpit `seats: 1`,
  new **`command_trio` Trio Command Pod `seats: 3`** (the Apollo lesson). mods.js
  validates an optional `seats` as a whole-ish number 1..8 ("Apollo held 3, the Space
  Shuttle 8").

### New module: js/crew.js (owns crew choice + flight log; node-safe, node-tested)
```js
Crew.lineup()                     // ordered picked names; [0] is commander; [] = Surprise-me
Crew.togglePick(name)             // tap in/out; caps at MAX_LINEUP (3); newest replaces last
Crew.clearPicks()                 // back to Surprise-me
Crew.chooseCrewForLaunch(seats)   // lineup (skipping deleted names) truncated to seats,
                                  //   then random distinct fill — a launch never breaks
Crew.chooseForLaunch()            // single-seat convenience = chooseCrewForLaunch(1)[0]
Crew.recordMission(name) / Crew.missions(name) / Crew.roster() // flight log (+locked recruits)
Crew.newGraduates(prevSci, nowSci) // recruits whose milestone this award crossed
Crew.nextRecruitInfo()             // {at, have} | null — the next science goal
Crew.showRoster({getCurrentCrewNames, onPick, onClose}) / Crew.hideRoster() / Crew.isOpen()
ROLE_INFO / roleOf(connie) / MAX_LINEUP / normalizeCrewData(raw) // PURE sanitizer
```
Storage: localStorage `"spacesim.crew.v1"` = `{ picks: [name,...], log: { [name]: count } }`
(new versioned key; the interim in-branch `pick: name` shape is migrated by
`normalizeCrewData`; mangled data degrades to defaults; stale names are skipped).

### Recorded API extensions
- `Menu.init({...})` gains `onAstronauts` (the new Space Center building's door).
- `UI.init({...})` gains `onCrewPick`; new `UI.syncCrewButton(lineup)` mirrors the lineup
  on the 🐍 Crew button (build-mode only — it picks the NEXT launch).
- SimState: `crew` is the COMMANDER (full Connie; null for probes — unchanged contract),
  new **`crewList`** = everyone aboard, commander first (`[]` when uncrewed). Seats are
  summed over crewed command parts by main.js `assignCrew()`.
- Copilot snapshot: `flight.crew` gains `role` + `missions`; `flight.crewAll`
  (name+role each) when more than one is aboard; top-level `nextAstronautAt` while a
  recruit is still locked. All try/catch-wrapped.
- main.js `awardScience()`: +5 bonus Science per Scientist aboard (game economy, not
  physics — why real crews fly mission specialists), and crossing a recruit's `joinsAt`
  fires the 🎓 graduation callout via `Crew.newGraduates`.
