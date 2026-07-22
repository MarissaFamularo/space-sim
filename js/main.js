// main.js — PM-owned glue. Boots modules, runs the game loop, switches build<->flight,
// drives flight controls (steer / throttle / stage / time-warp / target), detects goals,
// and wires the copilot. Integrates physics.js + render.js + builder.js per the contract.

import { PARTS } from "./mods.js";
import { BODIES, SYSTEM, STATIONS, WORMHOLES, isSol, setSystem, returnToSol, newCraft, newSimState, computeStats, findPart, makeInstance, bodyStateAt, dominantBody } from "./state.js";
import { generateSystem, galaxyPos, interstellarVector, GAME_LY } from "./stargen.js";
import { FAMOUS_LIST } from "./famous.js";
import { Physics } from "./physics.js";
import { Render } from "./render.js";
import { Builder } from "./builder.js";
import { UI } from "./ui.js";
import { Copilot } from "./copilot.js";
import { pickCrew, loadCrewPicks } from "./connies.js";
import { Menu } from "./menu.js";
import { Tracking } from "./tracking.js";
import { School } from "./school.js";

const canvas = document.getElementById("scene");
let craft = newCraft();
craft._catalog = PARTS; // lets Physics.applyStage read part data if ever needed
let sim = newSimState(BODIES.earth);
let mapView = false; // declared early: enterBuild() touches it during boot

// Time-warp tiers: , and . step through. Interplanetary cruises need the top ones —
// a Mars transfer is ~82 (scaled) days of coasting. The two INTERSTELLAR tiers only
// unlock on an interstellar course (Phase B): between the stars there is nothing to
// hit and nothing nearby, so the integrator honestly keeps up.
const WARPS = [1, 5, 25, 100, 1000, 10000, 100000, 500000, 2000000, 20000000, 200000000];
const MAX_SYSTEM_WARP = 2000000; // tiers above this need sim.interstellar

// One-shot copilot callouts per flight. soi/landed are per-BODY maps.
function freshAnnounced() {
  return { orbit: false, crashed: false, reentry: false, transferBurn: false,
           escapedEarth: false, soi: {}, landed: {} };
}
let announced = freshAnnounced();

// A true fact per world — the Navigator's arrival lines. Real numbers, real missions.
const WORLD_FACTS = {
  Moon: "Apollo astronauts did this for real in 1969 — you braked with the engine, just like them.",
  Mercury: "Mercury is the closest planet to the Sun — its daytime is hot enough to melt lead, but its shadowed craters hold ICE.",
  Venus: "Venus is the hottest planet of all — about 460°C day and night, hotter than Mercury, because its thick air traps the heat.",
  Mars: "Mars is the only planet we've sent rovers to. Its air is so thin that real landers use a parachute AND rockets — the sky crane!",
  Phobos: "Phobos zips around Mars in under 8 hours — faster than Mars spins, so from the ground it rises in the WEST. It's slowly spiraling inward; one far-off day it'll break into a ring.",
  Deimos: "Deimos is so small its own gravity can't squeeze it into a ball. Jump hard there and you'd fly right off into space!",
  Jupiter: "Jupiter is so big that 1,300 Earths would fit inside it. NASA's Galileo probe dove into its clouds in 2003 and melted on the way down.",
  Saturn: "Saturn's rings are made of billions of chunks of ice, some as small as snowflakes, some as big as houses.",
  Io: "Io is the most volcanic world in the solar system — hundreds of active volcanoes, because Jupiter's gravity kneads it like dough.",
  Europa: "Under Europa's cracked ice shell hides a salty OCEAN with more water than all of Earth's seas — a top place to look for life.",
  Ganymede: "Ganymede is the biggest moon in the solar system — bigger than the planet Mercury!",
  Callisto: "Callisto has the most craters of any world — its surface is 4 billion years of bullseyes.",
  Titan: "Titan's air is thicker than Earth's, with rain and lakes — but of liquid methane. The Huygens probe landed here by parachute in 2005.",
  Uranus: "Uranus rolls around the Sun on its side — its seasons last 21 Earth-years each.",
  Neptune: "Neptune has the fastest winds in the solar system — over 2,000 km/h. Only Voyager 2 has ever visited it.",
  Pluto: "Pluto is a dwarf planet with a giant heart-shaped nitrogen glacier. New Horizons flew past in 2015 after a 9-year trip. (Its REAL orbit is stretched and tilted — it even dips inside Neptune's!)",
  Sun: "The Sun holds 99.8% of all the mass in the solar system.",
  Earth: "The only world where your parachute, your lungs, and your snack supply all work.",
  "Alpha Centauri B": "Alpha Centauri B is real — an orange star a bit smaller than our Sun. It and A swing around each other about every 80 years. (B's REAL path is a stretched ellipse, 11 to 35 AU from A — we drew the average.)",
  "Proxima Centauri": "Proxima Centauri is the true nearest star to our Sun — 4.24 light-years away. It's a tiny red dwarf with a real planet, Proxima b, discovered in 2016!",
  "Luhman 16 A": "A brown dwarf is the in-between thing: heavier than ~13 Jupiters it briefly burns deuterium, but only past ~80 does the real hydrogen fire light. This one never made it — it glows with leftover birth-heat, like a coal from the campfire.",
  "Luhman 16 B": "Astronomers made the FIRST weather map of any world outside our solar system right here (2014): patchy clouds of hot sand — and rain made of molten IRON.",
  Twilight: "Twilight is imagined (no planets found at Luhman 16 for real — yet!), but its physics is honest: a warm world by a dim brown dwarf must huddle SO close that its whole year lasts about half a day.",
  Firefly: "Even a failed star can hold planets and moons just fine — gravity doesn't care whether the fusion fire ever lit.",
  Owius: "A pulsar is a spinning neutron star: a supernova squeezed a star's whole core into a ball the size of a CITY that still outweighs our Sun. A teaspoon of it would outweigh a mountain — and its sweeping lighthouse beams are how astronomers found the first one in 1967.",
  Donk: "All of Donk's water hides in one lake at the bottom of one great crack — down deep, the air piles up thicker and the sky can't steal it. Water is the treasure of any solar system.",
  Monk: "Monk was alive once. The supernova that made Owius wiped it clean long, long ago — and the bones weathering out of its dry seabeds still tell the story. Reading old bones is real science: paleontology is time travel.",
  Sera: "Sera was born from the supernova itself — built out of the blast's leftover rubble, still resting where it formed. That's real: the first planets ever discovered (1992!) orbit a pulsar and formed exactly this way.",
  Splinter: "A captured shard of supernova debris. Little moons like this are the blast's loose change, still being counted.",
  Menia: "Menia is all air and no ground — dive in and you sink until the pressure wins. Its deep blue is honest: that's what mini-Neptunes look like.",
  Ka: "Ka keeps watch at the cold edge. Around a pulsar there's no warm zone at all — every world out here freezes under a star that gives light but almost no heat.",
  // The Youngcow System (HIS design) — every fact ties to real astronomy.
  Sia: "Sia is tidally locked: one face always toward the star (molten), one always dark (frozen). Our Moon is locked to Earth the exact same way — that's why we only ever see one side.",
  Hundun: "Hundun's ring still sheds stones — watch the sky! Counting fresh craters is genuinely how scientists age a planet's surface. And keep an eye out for the locals: big, armored, and strictly vegetarian.",
  Ember: "Ember rides a STRETCHED (elliptical) orbit — watch the map: it sprints through the close pass and crawls at the far end. That's Kepler's second law, discovered in 1609, happening live.",
  Pebble: "Pebble is still gathering itself out of Hundun's ring — too small and lumpy for its own gravity to squeeze it round. Real small worlds like Arrokoth are potatoes for the same reason.",
  "Comet Konnie": "Comets are named after their discoverers — Halley, Hale-Bopp… and Konnie. Its tail always points AWAY from the star (starlight pushes it), and escape speed here is about bicycle speed. Jump gently!",
  Centdra: "Centdra is a planet still BEING BORN, wrapped in its own disc of infalling rock. Astronomers really photographed a disc like this around the young planet PDS 70c in 2021.",
};

// Any star in the active system: the sun role, plus star-styled companions
// (Pandora's Alpha Centauri B and Proxima). Stars melt ships; gas giants swallow them.
const isStarKey = (k) => k === "sun" || !!(BODIES[k] && BODIES[k].style && BODIES[k].style.star);

// ---- propulsion for a given stage (integration owns this; physics reads the live fields) ----
function activeStage(craft, stageNum) {
  let thrust = 0, veSum = 0, engines = 0, stageFuel = 0, remainingMass = 0, chutes = 0, docks = 0;
  let legs = 0, solar = 0, rovers = 0, wings = 0, stationParts = 0, centrifuges = 0, shields = 0;
  for (const inst of craft.parts) {
    const def = findPart(PARTS, inst.partId);
    if (!def) continue;
    if (inst.stage >= stageNum) {
      remainingMass += (def.dryMass || 0) + (def.fuelMass || 0);
      if (def.type === "chute") chutes++;
      if (def.type === "dock") docks++;
      if (def.type === "legs") legs++;
      if (def.type === "solar") solar++;
      if (def.type === "rover") rovers++;
      if (def.type === "wing") wings++;
      if (def.type === "station") stationParts++;
      if (def.type === "centrifuge") centrifuges++;
      if (def.type === "shield") shields++;
    }
    if (inst.stage === stageNum) {
      if (def.type === "engine") { thrust += def.thrust || 0; veSum += def.exhaustVelocity || 0; engines++; }
      stageFuel += def.fuelMass || 0;
    }
  }
  return { thrust, exhaustVelocity: engines ? veSum / engines : 0, stageFuel, remainingMass,
           chutes, legs, solar, rovers, docks, wings, stationParts, centrifuges, shields };
}
function maxStage(craft) {
  return craft.parts.reduce((m, i) => Math.max(m, i.stage || 0), 0);
}
function loadStage(stageNum) {
  const s = activeStage(craft, stageNum);
  sim.craft.currentStage = stageNum;
  sim.craft.mass = s.remainingMass;
  sim.craft.fuelRemaining = s.stageFuel;
  sim.craft.stageFuelMax = s.stageFuel;
  sim.craft.thrust = s.thrust;
  sim.craft.exhaustVelocity = s.exhaustVelocity;
  sim.craft.chuteCount = s.chutes;
  sim.craft.dockCount = s.docks;    // stations only mate with a real docking port
  sim.craft.legCount = s.legs;      // physics: legs raise the safe touchdown speed
  sim.craft.solarCount = s.solar;
  sim.craft.roverCount = s.rovers;
  sim.craft.wingCount = s.wings;    // physics: wings make LIFT in atmosphere
  sim.craft.stationCount = s.stationParts;   // a Station Hub aboard = deployable station
  sim.craft.centrifugeCount = s.centrifuges; // spin gravity for the deployed station
  sim.craft.shieldCount = s.shields; // physics: a heat shield soaks ~70% of reentry heating
  sim.stageWeightKN = s.remainingMass * BODIES.earth.g0;
  sim.cantLiftOff = s.thrust <= sim.stageWeightKN;
}

// Crew policy: a Connie flies only when a CREWED pod is aboard. A probe-core-only rocket
// is an uncrewed robot mission (sim.crew = null) — crashes cost hardware, never a Connie.
// Seats are real (Acorn Pod 3, Swift Cockpit 2): the 🧑‍🚀 Astronaut Complex picks who
// flies (pick order = seating order, first pick commands); no picks → one random
// unlocked Connie, exactly the old behavior.
function assignCrew() {
  let seats = 0;
  for (const i of craft.parts) {
    const d = findPart(PARTS, i.partId);
    if (d && d.type === "command" && !d.uncrewed) seats += d.seats || 1;
  }
  const roster = pickCrew(loadCrewPicks(), SCIENCE, seats);
  sim.crew = roster[0] || null;              // the commander — every existing callout keys off this
  sim.crewList = roster;                     // everyone aboard (snapshot + callouts)
  return sim.crew;
}

// Deploy the parachute (P key, or auto low over any world with air). Teaches: chutes need AIR.
function deployChute(auto) {
  if (sim.mode !== "flight" || sim.craft.chuteDeployed) return;
  if ((sim.craft.chuteCount || 0) === 0) {
    if (!auto) copilotSay("No parachute on this rocket! Add one on top of the command pod next time — it makes coming home easy.");
    return;
  }
  sim.craft.chuteDeployed = true;
  const here = BODIES[sim.soi ? sim.soi.toLowerCase() : "earth"];
  if (here && !here.atmosphere)
    copilotSay("☂ Parachute deployed… but nothing happens. " + sim.soi + " has <b>no air</b> — a parachute needs air to push against! Here you land the Apollo way: brake with your engine.");
  else if (here && here.key === "mars")
    copilotSay("☂ Parachute out! Mars's air is super thin — the chute helps, but it can't slow you enough by itself. Real Mars landers fire rockets for the last bit (the <b>sky crane</b>). Keep your engine ready!");
  else if (sim.speed >= 250)
    copilotSay("☂ Parachute armed! You're going too fast for it to open (over 250 m/s the cloth would just shred) — it'll blossom automatically once the air slows you below that.");
  else
    copilotSay("☂ <b>Parachute out!</b> Feel the air grab it — you'll drift down at about 4–5 m/s, slow enough to land softly. Real capsules from Mercury to SpaceX splash down exactly this way.");
}

// ---- mode transitions ----
function refreshStats() {
  const stats = computeStats(craft, PARTS, BODIES.earth);
  UI.renderStats(sim.mode === "build" ? stats : null, sim);
  return stats;
}
function onCraftChange() {
  Render.buildCraftMesh(craft);
  if (sim.mode === "build") Render.setMode("build");
  refreshStats();
}
function enterBuild() {
  sim.mode = "build"; sim.status = "prelaunch";
  mapView = false;
  UI.syncMapButton(false);
  Render.setFlightView("follow");
  Render.buildCraftMesh(craft);
  Render.setMode("build");
  Builder.show();
  UI.setMode("build");
  refreshStats();
}
function launch() {
  if (craft.parts.length === 0) { copilotSay("Build a rocket first — add a pod, a fuel tank, and an engine, then launch."); return; }
  const keepTarget = sim.target || "moon";
  sim = newSimState(BODIES.earth);
  sim.target = keepTarget;
  sim.mode = "flight"; sim.status = "flying"; sim.craft.throttle = 1; sim.timeWarp = 1;
  assignCrew();
  mapView = false;
  announced = freshAnnounced();
  announced.soi[BODIES.earth.name] = true; // you start there; no callout for home
  loadStage(0);
  if (sim.crew) {
    const mates = (sim.crewList || []).slice(1).map((c) => c.name);
    copilotSay(mates.length
      ? "🐍 Commander <b>" + sim.crew.name + "</b> aboard with <b>" + mates.join("</b> and <b>") + "</b> — " +
        (mates.length + 1) + " helmets sealed, coils braced. Liftoff!"
      : "🐍 Commander <b>" + sim.crew.name + "</b> is aboard — helmet sealed, coils braced. Liftoff!");
  }
  else copilotSay("🛰️ <b>Uncrewed launch</b> — no Connie aboard, the probe core is doing the flying. Real space programs send robots first, so nobody's ever in danger. Liftoff!");
  if (sim.craft.thrust <= 0) copilotSay("This rocket has no working engine on its first stage — it won't lift off. Add an engine at the bottom.");
  else if (sim.cantLiftOff) copilotSay("Hmm — your engines push with " + Math.round(sim.craft.thrust) +
    " kN but the rocket weighs " + Math.round(sim.stageWeightKN) + " kN. Push must beat weight (thrust-to-weight over 1.0) or gravity wins. Drop a tank or add an engine.");
  Builder.hide();
  Render.buildCraftMesh(craft);
  Render.setMode("flight");
  UI.setMode("flight");
}
function reset() {
  craft.parts.length = 0;
  craft.name = "My Rocket";
  craft._catalog = PARTS;
  Builder.init({ craft, partsCatalog: PARTS, onChange: onCraftChange });
  enterBuild();
}

// ---- Satellites: jettisoned probe-core stages left in stable orbits, persisted locally ----
const LS_SATS = "spacesim_sats_v1";
function loadSats() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_SATS) || "[]");
    return Array.isArray(a) ? a.filter((s) => s && BODIES[s.bodyKey] && isFinite(s.a)) : [];
  } catch { return []; }
}
function saveSats() { try { localStorage.setItem(LS_SATS, JSON.stringify(SATELLITES)); } catch {} }
const SATELLITES = loadSats();

function deploySatellite(hasPower) {
  const rec = Physics.makeSatellite(sim);
  if (!rec) return false;
  rec.name = "Sat " + (SATELLITES.length + 1);
  rec.hasPower = !!hasPower;
  SATELLITES.push(rec);
  if (SATELLITES.length > 24) SATELLITES.splice(0, SATELLITES.length - 24); // keep the sky tidy
  saveSats();
  const b = BODIES[rec.bodyKey];
  copilotSay("🛰️ <b>Satellite deployed around " + (b ? b.name : "?") + "!</b> It'll keep circling all on its own — orbits are free, forever. Check the map to see it. " +
    (hasPower
      ? "Its solar panels keep it awake for years — just like the real satellites doing GPS, weather, and phone calls over Earth right now."
      : "Heads up: it has no solar panels, so its battery will run down — real satellites always carry power. Next one, tuck Solar Panels into the same stage!"));
  return true;
}

// ---- 🛰 PLAYER STATIONS: build one in the Hangar (a Station Hub makes it count),
// get it to a stable orbit (fly or ✨ Teleport), hit Deploy — and it's up there for
// good: dockable, boardable, tracked, persisted. A Centrifuge Ring aboard gives the
// deployed station GRAVITY inside (the spin trick — his ask).
const LS_PSTATIONS = "spacesim.playerStations.v1";
function loadPlayerStations() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_PSTATIONS) || "[]");
    return Array.isArray(a) ? a.filter((s) => s && s.id && s.body && isFinite(s.altR)) : [];
  } catch { return []; }
}
function savePlayerStations() { try { localStorage.setItem(LS_PSTATIONS, JSON.stringify(PLAYER_STATIONS)); } catch {} }
const PLAYER_STATIONS = loadPlayerStations();
function systemKeyNow() { return isSol() ? "sol" : String(SYSTEM.seed || SYSTEM.key || "").toLowerCase(); }
// Fold this system's player stations into the live STATIONS list (docking, targets,
// tracking, and render all read STATIONS — one list, everything works).
function injectPlayerStations() {
  for (const ps of PLAYER_STATIONS) {
    if (ps.system !== systemKeyNow() || !BODIES[ps.body]) continue;
    if (!STATIONS.some((s) => s.id === ps.id)) {
      STATIONS.push({ id: ps.id, name: ps.name, body: ps.body, altR: ps.altR,
                      phase0: ps.phase0, yours: true, centrifuge: !!ps.centrifuge });
    }
  }
}
injectPlayerStations(); // Sol at boot; arriveInSystem() re-injects after Starmap jumps

function deployStation() {
  if (!(sim.mode === "flight" && sim.orbit && sim.orbit.isOrbit && (sim.craft.stationCount || 0) > 0)) return;
  const t = sim.time || 0;
  const dom = dominantBody(sim.craft.pos, t);
  if (!dom.body || dom.body.key === "sun") {
    copilotSay("Stations like to orbit a planet or a moon — get captured around one first, then deploy.");
    return;
  }
  const b = dom.body;
  const r = Math.hypot(dom.rel.x, dom.rel.y);
  if (r < b.radius * 1.05) return;
  const n = Math.sqrt(b.mu / (r * r * r));
  const th = Math.atan2(dom.rel.y, dom.rel.x);
  const hasSpin = (sim.craft.centrifugeCount || 0) > 0;
  const rec = {
    id: "yours_" + (PLAYER_STATIONS.length + 1) + "_" + systemKeyNow(),
    name: craft.name && craft.name !== "My Rocket" ? craft.name : "Konnie Station " + (PLAYER_STATIONS.length + 1),
    body: b.key, altR: r / b.radius, phase0: th - n * t,
    centrifuge: hasSpin, system: systemKeyNow(),
  };
  PLAYER_STATIONS.push(rec);
  if (PLAYER_STATIONS.length > 16) PLAYER_STATIONS.splice(0, PLAYER_STATIONS.length - 16);
  savePlayerStations();
  STATIONS.push({ id: rec.id, name: rec.name, body: rec.body, altR: rec.altR,
                  phase0: rec.phase0, yours: true, centrifuge: rec.centrifuge });
  UI.rebuildTargets();
  copilotSay("🛰🎉 <b>" + rec.name + " is DEPLOYED, orbiting " + b.name + " — permanently!</b> " +
    "Orbits are free forever, so it'll still be circling next time you play. The real ISS was " +
    "assembled in orbit piece by piece over more than 10 years. " +
    (hasSpin
      ? "Your <b>Centrifuge Ring</b> is spinning — the floor of the ring pushes on your feet as it turns, and that push feels exactly like gravity. Fly out with a Docking Port, dock, and press <b>E</b> to WALK around inside!"
      : "It's zero-g inside — add a <b>Centrifuge Ring</b> to your next station and the spin makes gravity you can walk on. Fly out with a Docking Port, dock, and press <b>E</b> to float aboard.") +
    " Find it anytime in the 📡 Tracking Center or the 🎯 picker.");
  enterBuild(); // the ship IS the station now; the blueprint stays for the next one
}

// A rover set free while landed: it drives off and leaves tracks (render draws it).
function deployRover() {
  if (!sim.landed) return false;
  sim.rover = { body: sim.landed.body, t0: sim.time || 0,
                offset: { x: sim.landed.offset.x, y: sim.landed.offset.y } };
  const b = BODIES[sim.landed.body];
  copilotSay("🚗 <b>Rover deployed on " + (b ? b.name : "the surface") + "!</b> Off it goes, leaving tracks — real rovers like Curiosity drive about as fast as a garden snail and stop for every interesting rock. Watch it explore!");
  return true;
}

function doStage() {
  if (sim.mode !== "flight") return;
  // Landed with a Rover aboard: Space sets it free — no decoupler needed, the rover has
  // its own latches (like the real ones rolling off their landers).
  if (sim.status === "landed" && (sim.craft.roverCount || 0) > 0 && !sim.rover) {
    const idx = craft.parts.findIndex((i) => {
      const d = findPart(PARTS, i.partId);
      return d && d.type === "rover" && (i.stage || 0) >= (sim.craft.currentStage || 0);
    });
    if (idx !== -1) {
      craft.parts.splice(idx, 1);
      deployRover();
      loadStage(sim.craft.currentStage || 0); // recompute mass without the rover
      Render.buildCraftMesh({ name: craft.name,
        parts: craft.parts.filter((i) => (i.stage || 0) >= (sim.craft.currentStage || 0)) });
      return;
    }
  }
  const next = (sim.craft.currentStage || 0) + 1;
  if (next > maxStage(craft)) { copilotSay("No more stages to drop — you're flying the last one."); return; }
  // What's in the stage being jettisoned? A probe core let go in a stable orbit stays
  // up there as a SATELLITE.
  const droppedDefs = craft.parts
    .filter((i) => (i.stage || 0) === next - 1) // ONLY the stage being let go right now
    .map((i) => findPart(PARTS, i.partId)).filter(Boolean);
  const dropsProbe = droppedDefs.some((d) => d.type === "command" && d.uncrewed);
  const dropsSolar = droppedDefs.some((d) => d.type === "solar");
  if (dropsProbe && sim.orbit && sim.orbit.isOrbit && sim.status !== "landed") deploySatellite(dropsSolar);
  loadStage(next);
  const remaining = { name: craft.name, parts: craft.parts.filter((i) => (i.stage || 0) >= next) };
  Render.buildCraftMesh(remaining);
}

function setTarget(key) {
  if (key && key.startsWith("station:")) {
    // A station target: guidance aims at its parent body; the HUD's station row and
    // ✨ Teleport handle the last mile.
    const st = STATIONS.find((x) => "station:" + x.id === key);
    if (st && BODIES[st.body]) {
      sim.target = st.body;
      copilotSay("🛰 Target: <b>" + st.name + "</b>, orbiting " + BODIES[st.body].name +
        ". Rendezvous the real way (reach its orbit, close in slowly) — or use ✨ Teleport " +
        "to jump straight to the final 250 meters and practice the docking.");
    }
    return;
  }
  if (key && key.startsWith("wormhole:")) {
    // A wormhole target: guidance aims at its parent planet; the map dot and
    // ✨ Teleport handle the last mile. Flying IN is the whole trip.
    const wh = WORMHOLES.find((x) => "wormhole:" + x.id === key);
    if (wh && BODIES[wh.body]) {
      sim.target = wh.body;
      const destName = wh.dest.seed === "@sol" ? "the Solar System" : "the " + wh.dest.seed + " system";
      copilotSay("🌀 Target: <b>" + wh.name + "</b>, orbiting " + BODIES[wh.body].name +
        " — a wormhole mouth that leads to <b>" + destName + "</b>. Fly to " +
        BODIES[wh.body].name + ", find the glowing swirl on the map, and fly straight " +
        "into it — or use ✨ Teleport to arrive right beside it.");
    }
    return;
  }
  if (!BODIES[key]) return;
  sim.target = key;
  announced.transferBurn = false; // a new destination gets its own TLI call
  announced.courseCheck = false;
  announced.onTarget = false;
  const b = BODIES[key];
  const fact = WORLD_FACTS[b.name] ? " " + WORLD_FACTS[b.name] : "";
  copilotSay("🎯 Target set: <b>" + b.name + "</b>." + fact +
    (key === "moon" ? "" : " To get there: reach " + BODIES.earth.name + " orbit, burn prograde until you ESCAPE " +
      BODIES.earth.name + " into a " + BODIES.sun.name + " orbit, then wait for the gold Burn marker on the map."));
}

// ✨ Teleport: magic-jump straight into a low circular orbit around any world he picks.
// A practice shortcut, not physics — so the Navigator prices out the trip he skipped,
// and everything AFTER the jump (landing, flying home) is the real game again.
function tripDaysFromEarth(key) {
  // Hohmann coast time from Earth('s orbit) to the target's orbit — the honest price.
  const b = BODIES[key];
  let central, r1, r2;
  if (b.parent === "earth") {
    central = BODIES.earth; r1 = BODIES.earth.radius * 1.35; r2 = b.orbitRadius;
  } else {
    central = BODIES.sun;
    // Home's distance from the STAR — if home is itself a moon of a gas giant
    // (Pandora!), that's its parent planet's orbit, not its own little circle.
    const home = BODIES.earth;
    r1 = home.parent === "sun" ? home.orbitRadius : BODIES[home.parent].orbitRadius;
    r2 = (b.parent === "sun" ? b : BODIES[b.parent]).orbitRadius; // moons: reach their planet
  }
  const a = (r1 + r2) / 2;
  return (Math.PI * Math.sqrt((a * a * a) / central.mu)) / 86400;
}
function fmtRealTrip(gameDays) {
  const real = gameDays * Math.sqrt(10); // the scaled system runs ~3.2x fast; undo it
  if (real > 700) return (real / 365).toFixed(1) + " years";
  if (real > 75) return Math.round(real / 30.4) + " months";
  return Math.round(real) + " days";
}
function teleport(key) {
  const station = key && key.startsWith("station:")
    ? STATIONS.find((x) => "station:" + x.id === key) : null;
  const wormhole = key && key.startsWith("wormhole:")
    ? WORMHOLES.find((x) => "wormhole:" + x.id === key) : null;
  const b = station ? BODIES[station.body] : wormhole ? BODIES[wormhole.body] : BODIES[key];
  if (!b || (!station && !wormhole && !b.parent)) return; // no teleporting into the Sun
  if (craft.parts.length === 0) {
    copilotSay("Even a teleporter needs a ship! Build a rocket first — pod, tank, engine.");
    return;
  }
  if (sim.mode !== "flight" || sim.status === "crashed") {
    // Fresh flight, same setup as a launch — just skipping the ride up.
    sim = newSimState(BODIES.earth);
    sim.mode = "flight";
    assignCrew();
    announced = freshAnnounced();
    announced.soi[BODIES.earth.name] = true;
    loadStage(0);
    Builder.hide();
    Render.buildCraftMesh(craft);
    Render.setMode("flight");
    UI.setMode("flight");
  }
  if (station) {
    // Arrive RIGHT AT the port, speeds matched (his play-test: "250 m away" from a
    // 6 m station just looked like empty space). At 35 m the station fills the view
    // and the docking latch engages on the next frame — teleport in, already docked.
    const ss = stationStateAt(station, sim.time || 0);
    if (!ss) return;
    sim.craft.pos = { x: ss.pos.x + 35, y: ss.pos.y };
    sim.craft.vel = { x: ss.vel.x, y: ss.vel.y };
    sim.craft.angle = Math.PI / 2; // craft sits +X of the station; nose points -X, at it
    sim.craft.throttle = 0;
    sim.craft.chuteDeployed = false;
    sim.chuteOpen = false;
    if ((sim.craft.dockCount || 0) === 0) {
      copilotSay("✨🛰 <b>Right alongside " + station.name + "!</b> Look at it out the " +
        "window… but you have <b>no Docking Port</b> aboard, so the rings can't latch. " +
        "Add one to your rocket and teleport back to hook on.");
    }
    // (With a port aboard, the dock latches on the next frame and announces itself.)
    return;
  }
  if (wormhole) {
    // Arrive a safe stand-off away, co-moving, nose at the swirl — OUTSIDE the
    // capture radius so falling in stays HIS choice, not the teleporter's. Pull the
    // follow camera back so the mouth is IN FRAME on arrival (at rocket zoom the
    // overhead camera would show only stars — the swirl sat 900 m off-screen).
    const ws = stationStateAt(wormhole, sim.time || 0);
    if (!ws) return;
    sim.craft.pos = { x: ws.pos.x + 900, y: ws.pos.y };
    sim.craft.vel = { x: ws.vel.x, y: ws.vel.y };
    sim.craft.angle = Math.PI / 2; // craft sits +X of the mouth; nose points -X, at it
    sim.craft.throttle = 0;
    sim.craft.chuteDeployed = false;
    sim.chuteOpen = false;
    sim.timeWarp = 1;
    sim.status = "flying";
    sim.landed = null;
    sim.teleported = wormhole.name;
    mapView = false;
    Render.setFlightView("follow");
    Render.zoomMap(40); // ~2 km back: ship AND swirl share the frame, disc face-on
    const destName = wormhole.dest.seed === "@sol" ? "the Solar System" : "the " + wormhole.dest.seed + " system";
    copilotSay("✨🌀 <b>Holding about 1 km from " + wormhole.name + "!</b> That glowing " +
      "swirl is a wormhole mouth, and it leads to <b>" + destName + "</b>. Ease forward " +
      "and fly into the middle when you're ready — the gate does the rest. (Not ready? " +
      "Just steer around it — it only takes ships that fly IN.)");
    return;
  }
  const park = Physics.parkingOrbit(key, sim.time || 0);
  sim.craft.pos = park.pos;
  sim.craft.vel = park.vel;
  sim.craft.angle = park.angle;
  sim.craft.throttle = 0;
  sim.craft.chuteDeployed = false; // repacked by the same magic
  sim.chuteOpen = false;
  sim.heat = 0;
  sim.timeWarp = 1;
  sim.status = "flying"; // physics promotes to "orbit" on the next step
  sim.landed = null;
  sim.target = key;
  sim.teleported = b.name; // the Navigator sees he took the shortcut
  if (mapView) { mapView = false; Render.setFlightView("follow"); } // see the world, not a dot
  announced.soi[b.name] = true;        // skip the "burn retrograde to capture" coaching
  // Tiny moons: you arrive parked in a MARS orbit alongside (their gravity can't hold an
  // orbit), so suppress the parent's SOI-entry coaching too.
  if (b.tinyMoon && BODIES[b.parent]) announced.soi[BODIES[b.parent].name] = true;
  announced.soi[BODIES.sun.name] = false; // re-coach the escape when he leaves for home
  announced.escapedEarth = false;
  announced.transferBurn = false;
  announced.courseCheck = false;
  announced.onTarget = false;
  delete announced["orbit_" + b.name]; // let the arrival callout celebrate this orbit
  if (key === "earth") announced.orbit = false;
  const crew = sim.crew ? sim.crew.name : "The probe";
  if (park.coOrbit) {
    const fact0 = WORLD_FACTS[b.name] ? " " + WORLD_FACTS[b.name] : "";
    copilotSay("✨ <b>WHOOSH — you're flying formation with " + b.name + "!</b>" + fact0 +
      " Here's the wild part: " + b.name + " is too small to ORBIT — its gravity is weaker than Mars's pull at this distance, so real probes do exactly what you're doing: match its orbit around Mars and fly alongside. Nudge over with tiny puffs of throttle and touch down super gently.");
  } else if (key === "earth") {
    // "earth" is a ROLE key — out there the home world has its own name (Twilight,
    // Kerbin, Hundun…); saying "Earth orbit" teaches the wrong name.
    copilotSay("✨ <b>WHOOSH — teleported straight into " +
      (b.gen ? b.name : "Earth") + " orbit!</b> " + crew +
      (sim.crew ? "'s coils are still tingling." : " rebooted twice on the way.") + " You skipped the whole climb to orbit — great for practicing reentries and Moon shots. When you want to earn it, that ride up is one good gravity turn away.");
  } else {
    const days = tripDaysFromEarth(key);
    const fact = WORLD_FACTS[b.name] ? " " + WORLD_FACTS[b.name] : "";
    const sayName = key === "moon" && !b.gen ? "the Moon" : b.name; // role key ≠ our Moon out there
    copilotSay("✨ <b>WHOOSH — you're in orbit around " + sayName + "!</b>" + fact +
      " The honest-rocket trip is about <b>" + Math.round(days) + " days</b> of coasting here (a real probe: ~" +
      fmtRealTrip(days) + ") — worth knowing when you fly it for real. From here on it's all real physics: land it, explore, or fly home!");
  }
}

// ---- copilot helper ----
function copilotSay(txt) {
  const log = document.getElementById("copilot-log");
  if (!log) return;
  const d = document.createElement("div"); d.className = "ai";
  d.innerHTML = "<b>Navigator:</b> " + txt;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}

// ---- 🌌 Starmap travel: swap the active system, rebuild the world, back to the pad ----
// The name IS the system (seeded generation) — see stargen.js. Sol is always home.
const VISITED_KEY = "spacesim.visitedSystems.v1";
function loadVisited() {
  try { return JSON.parse(localStorage.getItem(VISITED_KEY)) || []; } catch { return []; }
}
function rememberVisit(sys) {
  const list = loadVisited().filter((v) => v.seed.toLowerCase() !== sys.seed.toLowerCase());
  list.unshift({ seed: sys.seed, star: sys.starLabel, planets: sys.planetCount });
  try { localStorage.setItem(VISITED_KEY, JSON.stringify(list.slice(0, 12))); } catch {}
}

// The galaxy neighborhood for the zoomed-out map: Sol + every system he's visited,
// positioned deterministically (galaxyPos), relative to wherever he is NOW. Clicking
// a star on the map travels there — the map IS a starmap once you zoom out enough.
function buildGalaxyList() {
  const entries = [{ seed: "@sol", name: "The Solar System", color: 0xffd75e,
                     blackHole: false, pos: { x: 0, y: 0 } }];
  for (const v of loadVisited()) {
    const sys = generateSystem(v.seed);
    entries.push({ seed: v.seed, name: sys.name, blackHole: sys.blackHole,
                   color: sys.bodies.sun.style.color, pos: galaxyPos(v.seed) });
  }
  // The universe comes PRE-POPULATED with the famous systems (his ask) — they shine
  // on the galaxy map even before the first visit. Dedup vs visited by seed.
  for (const f of FAMOUS_LIST) {
    if (!entries.some((e) => e.seed.toLowerCase() === f.seed.toLowerCase())) {
      entries.push({ seed: f.seed, name: f.name, blackHole: false,
                     color: f.color, pos: galaxyPos(f.seed) });
    }
  }
  const activePos = isSol() ? { x: 0, y: 0 } : galaxyPos(SYSTEM.seed);
  const activeSeed = isSol() ? "@sol" : SYSTEM.seed.toLowerCase();
  return entries
    .filter((e) => (e.seed === "@sol" ? "@sol" : e.seed.toLowerCase()) !== activeSeed)
    .map((e) => ({ ...e, pos: { x: e.pos.x - activePos.x, y: e.pos.y - activePos.y } }));
}
function refreshGalaxy() {
  Render.setGalaxy(buildGalaxyList(),
    (seed) => (seed === "@sol" ? travelHome() : travelToSystem(seed)));
}

function travelToSystem(seed) {
  const sys = generateSystem(seed);
  setSystem(sys.bodies, sys.planetKeys,
    { key: sys.key, name: sys.name, seed: sys.seed, stations: sys.stations, wormholes: sys.wormholes });
  rememberVisit(sys);
  arriveInSystem();
  const home = BODIES.earth;
  if (sys.famous && sys.blurb) {
    copilotSay(sys.blurb + " (Gravity here: " + home.g0.toFixed(1) + " vs Earth's 9.8. Tell a friend the name <b>" +
      sys.seed + "</b> and they'll land in this exact system.)");
  } else if (sys.blackHole) {
    copilotSay("🌌⚫ <b>Whoa — the " + sys.name + " system has no star. It's a BLACK HOLE.</b> " +
      "Your ship is on the pad of <b>" + sys.homeName + "</b> (gravity " + home.g0.toFixed(1) +
      " vs Earth's 9.8), one of <b>" + sys.planetCount + " planets</b> orbiting the hole — " +
      "which is completely safe, by the way: outside the event horizon a black hole pulls " +
      "exactly like a star of the same mass. The glow you see is the <b>accretion disk</b> — " +
      "the hole itself makes no light at all. Just never fly INTO it: past the horizon, " +
      "not even light comes back. Your moon here is <b>" + sys.moonName +
      "</b>. Tell a friend the name <b>" + sys.seed + "</b> and they'll find this exact black hole!");
  } else {
    copilotSay("🌌 <b>Welcome to the " + sys.name + " system!</b> Your ship is on the pad of <b>" +
      sys.homeName + "</b> (gravity " + home.g0.toFixed(1) + " vs Earth's 9.8), under a " +
      sys.starLabel + " with <b>" + sys.planetCount + " planets</b>. Your moon here is <b>" +
      sys.moonName + "</b> — same trip as ever: orbit, burn prograde, time the arrival. " +
      "Worlds close to the star are rock and lava; past the frost line it's gas and ice — " +
      "that's real astronomy, and it's why this system looks the way it does. " +
      "Tell a friend the name <b>" + sys.seed + "</b> and they'll find the exact same system!");
  }
}

function travelHome() {
  if (isSol()) { copilotSay("You're already home — this IS the Solar System. 🌍"); return; }
  returnToSol();
  arriveInSystem();
  copilotSay("🏠 <b>Home again — the real Solar System.</b> Same Sun, same Earth, same Moon waiting.");
}

// Common arrival: fresh sim on the (new) homeworld's pad; the rocket comes with you.
function arriveInSystem() {
  Render.rebuildWorld();
  refreshGalaxy();
  injectPlayerStations(); // your deployed stations live in their home system
  UI.rebuildTargets();
  sim = newSimState(BODIES.earth);
  sim.target = "moon";
  mapView = false;
  Render.setFlightView("follow");
  enterBuild();
}

// Debug handle for automated tests (agents drive the game headless with this).
if (typeof window !== "undefined") window.__simRef = () => sim;

// ---- boot ----
Render.init(canvas);
Builder.init({ craft, partsCatalog: PARTS, onChange: onCraftChange });
UI.init({
  onLaunch: launch, onReset: reset,
  onModeChange: (m) => m === "build" && enterBuild(),
  onToggleMap: () => { mapView = !mapView; Render.setFlightView(mapView ? "map" : "follow"); return mapView; },
  onToggleArrow: (which, on) => Render.setArrow(which, on),
  onTargetChange: (key) => setTarget(key),
  onTeleport: (key) => teleport(key),
  onStarmapTravel: (seed) => travelToSystem(seed),
  onStarmapHome: () => travelHome(),
  getVisitedSystems: () => loadVisited(),
  onSpaceCenter: () => Menu.showCenter(),
});
wireCopilot();
Copilot.initSettings();
refreshGalaxy();
enterBuild();

// ---- Konnie Space Program front door: title → space center → a building ----
Tracking.init({
  getSim: () => sim,
  getSatellites: () => SATELLITES,
  onExit: () => Menu.showCenter(),
});
Menu.init({
  onVAB: () => {
    Builder.setFacility("vab");
    enterBuild();
    copilotSay("🏗 <b>Welcome to the VAB!</b> Stack a pod, a tank, and an engine, watch your TWR and Δv, then hit Launch.");
  },
  onHangar: () => {
    Builder.setFacility("hangar");
    enterBuild();
    copilotSay("✈ <b>Welcome to the Space Plane Hangar!</b> This is where planes, probes, and space stations get built — wings glide in air, a Centrifuge Ring spins for gravity, and a Station Hub makes your build deployable as a real station. Build it, then ✨ Teleport it to orbit!");
  },
  onTracking: () => Tracking.show(),
  onSchool: () => School.show(),
  onSettingsChange: (s) => Render.setQuality(s.graphics),
  getScience: () => SCIENCE, // the 🧑‍🚀 Astronaut Complex shows the balance + unlocks live
});

// 🎒 Space School (the little-sibling classroom): school.js owns the lesson overlays
// and speaks out loud; main hands it the same levers the keyboard has. The school
// rocket is stock parts on the ordinary launch path — no special physics anywhere.
School.init({
  // Put the school rocket on the pad, palette hidden (she never sees the builder).
  // Stage rule mirrors builder.js reflowStages: parts above a decoupler are the
  // next stage; the decoupler falls with the booster.
  prepRocket(stack) {
    craft.parts.length = 0; // in place — everyone holds the reference
    craft.name = "School Rocket";
    let stage = 0;
    for (const id of stack) {
      const def = findPart(PARTS, id);
      craft.parts.push(makeInstance(id, stage));
      if (def && def.type === "decoupler") stage += 1;
    }
    enterBuild();
    Builder.hide();
  },
  launchRocket: () => launch(),
  stageRocket: () => doStage(),
  setThrottle: (v) => { sim.craft.throttle = v; },
  setWarp: (v) => { sim.timeWarp = v; }, // the teacher fast-forwards the boring coasts
  setAngle: (a) => { sim.craft.angle = a; }, // Lesson 4: the teacher holds the wheel (said out loud)
  deployChute: () => deployChute(false),
  resetGame: () => reset(),
  toCenter: () => Menu.showCenter(),
});
Render.setQuality(Menu.getSettings().graphics);
Menu.showTitle();
copilotSay("Hi! I'm your navigator, welcome to <b>Konnie Space Program</b>. Pick a building at the Space Center — build in the VAB or the Hangar, or check on your whole fleet in the Tracking Center. Ask me anything!");

// ---- copilot input ----
function wireCopilot() {
  const input = document.getElementById("copilot-input");
  const send = document.getElementById("copilot-send");
  const log = document.getElementById("copilot-log");
  const addYou = (txt) => { const d = document.createElement("div"); d.className = "you";
    d.innerHTML = "<b>You:</b> " + txt; log.appendChild(d); log.scrollTop = log.scrollHeight; };
  async function go() {
    const q = input.value.trim(); if (!q) return; input.value = "";
    input.blur(); // hand keyboard focus back to the game so flight keys work
    addYou(q);
    const stats = computeStats(craft, PARTS, BODIES.earth);
    copilotSay(await Copilot.ask(q, sim, stats));
  }
  send.onclick = go;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

// ---- keyboard flight controls ----
const keys = {};
window.addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") return;
  if (Menu.isOpen() || Tracking.isOpen() || School.isOpen()) return; // menus own the keys while open
  // School FLIGHTS deliberately leave the keyboard LIVE (Mom's call): the flight keys
  // are the on-ramp to the real game — discovering that Space fires the decoupler is
  // a feature, not an accident. The school's nets (assist-stage, auto-chute, friendly
  // crash + retry) already make every outcome safe.
  if (Render.isInside()) return; // the station interior owns the keys while aboard
  keys[e.key] = true;
  if (e.repeat) return;
  if (e.key === "e" || e.key === "E") {
    // E, in priority order: board a docked station; otherwise EVA — your Connie goes
    // OUTSIDE, floating in space or standing on the ground (his ask). E again returns.
    if (sim.stationNear && sim.stationNear.docked) boardStation();
    else startEva();
  }
  if (e.key === " ") { e.preventDefault(); doStage(); }
  if (e.key === "b" || e.key === "B") boardBase();
  // Any flight input takes the ship back from the 🤖 autopilot (real-autopilot rule).
  if ("zZxX.,".includes(e.key) && sim.interstellar && sim.interstellar.auto) autopilotOff();
  if (e.key === "z" || e.key === "Z") sim.craft.throttle = 1;
  if (e.key === "x" || e.key === "X") sim.craft.throttle = 0;
  if (e.key === ".") stepWarp(+1);
  if (e.key === ",") stepWarp(-1);
  if (e.key === "m" || e.key === "M") { mapView = !mapView; Render.setFlightView(mapView ? "map" : "follow"); UI.syncMapButton(mapView); }
  if (e.key === "p" || e.key === "P") deployChute(false);
});
window.addEventListener("keyup", (e) => { keys[e.key] = false; });
function stepWarp(dir) {
  // Interstellar tiers only exist between the stars (Phase B) — inside a system the
  // ladder tops out where it always did.
  const top = sim.interstellar ? WARPS.length - 1 : WARPS.indexOf(MAX_SYSTEM_WARP);
  const i = WARPS.findIndex((w) => w >= sim.timeWarp);
  const at = i === -1 ? top : i;
  const next = Math.max(0, Math.min(top, at + dir));
  sim.timeWarp = WARPS[next];
}

function applyControls(dt) {
  if (sim.mode !== "flight" || sim.status === "crashed") return;
  const STEER = 0.7, THR = 0.8; // rad/s, fraction/s
  if (sim.interstellar && sim.interstellar.auto &&
      (keys["ArrowLeft"] || keys["ArrowRight"] || keys["ArrowUp"] || keys["ArrowDown"] || keys["a"] || keys["d"])) {
    autopilotOff(); // steering or throttling = you have the ship
  }
  let steering = false;
  if (keys["ArrowLeft"] || keys["a"]) { sim.craft.angle += STEER * dt; steering = true; }
  if (keys["ArrowRight"] || keys["d"]) { sim.craft.angle -= STEER * dt; steering = true; }
  if (keys["ArrowUp"]) { sim.craft.throttle = Math.min(1, sim.craft.throttle + THR * dt); }
  if (keys["ArrowDown"]) { sim.craft.throttle = Math.max(0, sim.craft.throttle - THR * dt); }
  // Zoom works in BOTH flight views now (Render routes it): the follow camera pulls back
  // to see the planet, the map frame widens to see the system.
  if (keys["="] || keys["+"]) Render.zoomMap(Math.exp(-2.2 * dt)); // zoom in
  if (keys["-"] || keys["_"]) Render.zoomMap(Math.exp(2.2 * dt));  // zoom out
  // Steering snaps back to real time (you can't aim at 500,000x). BURNS may run under
  // warp now (his ask): physics integrates them honestly — cruise engines fly a real
  // near-straight brachistochrone when thrust beats gravity — and sim.warpLimited
  // caps the effective rate whenever the substeps can't keep up.
  if (steering) sim.timeWarp = 1;
}

// ---- crash / landing banner ----
const banner = document.createElement("div");
banner.style.cssText = "position:absolute;top:120px;left:50%;transform:translateX(-50%);z-index:8;" +
  "font:700 30px system-ui,sans-serif;padding:14px 28px;border-radius:12px;display:none;" +
  "text-align:center;pointer-events:none;box-shadow:0 6px 30px rgba(0,0,0,.5);";
document.body.appendChild(banner);

// ---- 🛰 Deploy button: shows in a stable orbit with a Station Hub aboard ----
const deployBtn = document.createElement("button");
deployBtn.style.cssText = "position:absolute;bottom:64px;left:50%;transform:translateX(-50%);z-index:8;" +
  "font:700 15px system-ui,sans-serif;padding:10px 20px;border-radius:10px;display:none;" +
  "background:linear-gradient(180deg,#2f6fdc,#1d47a0);color:#fff;border:1px solid #5b8dee;" +
  "cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.45);";
deployBtn.textContent = "🛰 Deploy as Space Station";
deployBtn.onclick = deployStation;
document.body.appendChild(deployBtn);
function updateDeployBtn() {
  deployBtn.style.display =
    sim.mode === "flight" && sim.status === "orbit" && sim.orbit && sim.orbit.isOrbit &&
    (sim.craft.stationCount || 0) > 0 ? "block" : "none";
}

const mapHint = document.createElement("div");
mapHint.style.cssText = "position:absolute;bottom:14px;left:50%;transform:translateX(-50%);z-index:8;" +
  "font:600 13px system-ui,sans-serif;color:#cfe0ff;background:rgba(10,16,30,0.72);" +
  "padding:7px 14px;border-radius:9px;display:none;pointer-events:none;white-space:nowrap;";
mapHint.innerHTML = "🗺️ Map view — scroll or press <b>−</b> to zoom out and find the planets · <b>+</b> to zoom in";
document.body.appendChild(mapHint);
function updateMapHint() {
  mapHint.style.display = (sim.mode === "flight" && mapView) ? "block" : "none";
}

// ---- Descent readout: "how close am I, and am I coming in soft enough?" ----
// Shows below ~2.5 km over any solid world while descending: radar height + fall speed,
// green when survivable, amber when close, red when you'd crater. Legs raise the bar.
const descentHud = document.createElement("div");
descentHud.style.cssText = "position:absolute;top:64px;left:50%;transform:translateX(-50%);z-index:8;" +
  "font:700 22px system-ui,sans-serif;padding:9px 20px;border-radius:10px;display:none;" +
  "text-align:center;pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,.45);";
document.body.appendChild(descentHud);
function updateDescentHud() {
  let show = false;
  if (sim.mode === "flight" && (sim.status === "flying" || sim.status === "orbit") && !mapView) {
    const here = BODIES[sim.soi ? sim.soi.toLowerCase() : ""];
    if (here && here.solid && sim.altitude < 2500 && sim.altitude > 0) {
      const bs = bodyStateAt(here.key, sim.time || 0);
      const rx = sim.craft.pos.x - bs.pos.x, ry = sim.craft.pos.y - bs.pos.y;
      const rm = Math.hypot(rx, ry) || 1;
      const vr = ((sim.craft.vel.x - bs.vel.x) * rx + (sim.craft.vel.y - bs.vel.y) * ry) / rm;
      if (vr < -0.3 || sim.altitude < 300) {
        show = true;
        const down = Math.max(0, -vr);
        const legs = (sim.craft.legCount || 0) > 0;
        const safe = legs ? 12 : 5;
        const ok = down <= safe, close = down <= safe * 1.8;
        descentHud.style.background = ok ? "rgba(22,96,44,0.85)" : close ? "rgba(150,105,20,0.9)" : "rgba(140,24,24,0.9)";
        descentHud.style.color = ok ? "#d6ffe0" : close ? "#ffedc4" : "#ffd6d6";
        descentHud.innerHTML = "⬇ " + Math.round(sim.altitude) + " m · falling " + down.toFixed(1) + " m/s" +
          "<br><span style='font-size:13px;font-weight:600'>" +
          (ok ? "✅ soft enough — hold it steady" :
            "slow to under " + safe + " m/s" + (legs ? " (your legs soak up 12)" : " — Landing Legs would allow 12")) +
          "</span>";
      }
    }
  }
  descentHud.style.display = show ? "block" : "none";
}

const LANDED_LINES = {
  earth: "🛬 LANDED",
  moon: "🌙 ON THE MOON",
  mercury: "🪨 ON MERCURY",
  venus: "🌋 ON VENUS",
  mars: "🔴 ON MARS",
  phobos: "🥔 ON PHOBOS",
  deimos: "🥔 ON DEIMOS",
  io: "🌋 ON IO",
  europa: "🧊 ON EUROPA",
  ganymede: "🪐 ON GANYMEDE",
  callisto: "🎯 ON CALLISTO",
  titan: "🟠 ON TITAN",
  pluto: "🤍 ON PLUTO",
};

function updateBanner() {
  const crew = sim.crew ? sim.crew.name : "Your Connie";
  const crashSub = sim.crew
    ? crew + " boinged away safely in the escape bubble — Connies always do. Press Reset to try again"
    : "Nobody was aboard — that's exactly why we send robot probes first! Press Reset to try again";
  if (sim.mode === "flight" && sim.status === "crashed") {
    banner.style.display = "block";
    banner.style.background = "rgba(140,24,24,0.9)"; banner.style.color = "#ffd6d6";
    let where;
    if (sim.sankIntoClouds) {
      const g = BODIES[sim.crashedInto];
      where = "🌀 SANK INTO " + (g ? g.name.toUpperCase() : "THE") + "'S CLOUDS — GAS GIANTS HAVE NO GROUND";
    } else if (sim.burnedUp && isStarKey(sim.crashedInto)) {
      const st = BODIES[sim.crashedInto];
      where = (sim.crashedInto === "sun" && BODIES.sun.blackHole) ? "⚫ CROSSED THE EVENT HORIZON"
        : "☀️ MELTED BY " + (st && st.name !== "Sun" ? st.name.toUpperCase() : "THE SUN");
    } else if (sim.burnedUp) {
      where = "🔥 BURNED UP ON REENTRY";
    } else if (sim.crashedInto && sim.crashedInto !== "earth") {
      const b = BODIES[sim.crashedInto];
      where = "CRASHED INTO " + (b ? b.name.toUpperCase() : "THE GROUND");
    } else {
      where = "CRASHED";
    }
    banner.innerHTML = "💥 " + where + "<br><span style='font-size:14px;font-weight:400'>" + crashSub + "</span>";
  } else if (sim.mode === "flight" && sim.status === "flying" && sim.cantLiftOff && sim.altitude < 5 && sim.speed < 2) {
    banner.style.display = "block";
    banner.style.background = "rgba(150,105,20,0.92)"; banner.style.color = "#ffedc4";
    banner.innerHTML = (sim.craft.thrust <= 0 ? "🚫 NO ENGINE ON STAGE 1" : "🪨 TOO HEAVY TO LIFT OFF") +
      "<br><span style='font-size:14px;font-weight:400'>Push: " + Math.round(sim.craft.thrust) +
      " kN &nbsp;vs&nbsp; weight: " + Math.round(sim.stageWeightKN || 0) + " kN — push must win!" +
      " Hit <b>Build</b> and drop a tank or add an engine.</span>";
  } else if (sim.mode === "flight" && sim.status === "landed") {
    banner.style.display = "block";
    banner.style.background = "rgba(22,96,44,0.9)"; banner.style.color = "#d6ffe0";
    const bodyKey = sim.landed ? sim.landed.body : "earth";
    const head = LANDED_LINES[bodyKey] || ("🏁 LANDED ON " + (BODIES[bodyKey] ? BODIES[bodyKey].name.toUpperCase() : "?"));
    const sub = !sim.crew
      ? (bodyKey === "earth" ? "The probe is home in one piece — mission complete!"
                             : "Probe down safely — instruments on, science starting. Throttle up to fly it home.")
      : bodyKey === "earth"
      ? "Gentle touchdown! " + crew + " slithers out, happy."
      : crew + " is out on the surface — a snake on another world! Throttle up to fly home.";
    banner.innerHTML = head + "<br><span style='font-size:14px;font-weight:400'>" + sub + "</span>";
  } else {
    banner.style.display = "none";
  }
}

// ---- one-shot flight callouts (SOI entries, orbit goals, arrivals) ----
let prevSoi = "Earth"; // whose gravity owned us last frame — names the world we escaped
function flightCallouts() {
  // Stable orbit around Earth: the Phase-1 goal.
  if (sim.status === "orbit" && sim.orbit && sim.orbit.bodyName === "Earth" && !announced.orbit) {
    announced.orbit = true;
    copilotSay("🎉 You're in a stable orbit! You just fell <i>around</i> the planet instead of back into it — that's exactly how real spacecraft stay up. Apoapsis " +
      (sim.orbit.apoapsis / 1000).toFixed(0) + " km, periapsis " + (sim.orbit.periapsis / 1000).toFixed(0) +
      " km. From here you can go ANYWHERE — the Moon, Mars, all of it. Pick a target and follow the gold Burn marker on the map.");
  }
  // Entering any new sphere of influence.
  if (sim.soi && !announced.soi[sim.soi]) {
    announced.soi[sim.soi] = true;
    if (sim.soi === "Moon") {
      copilotSay("🌙 You've entered the Moon's <b>sphere of influence</b> — from here the Moon's gravity is in charge, not Earth's. Your orbit readout now measures from the Moon. To get captured, burn <i>retrograde</i> (opposite the green arrow) near your closest approach.");
    } else if (sim.soi === "Sun") {
      if (!announced.escapedEarth) {
        announced.escapedEarth = true;
        copilotSay("☀️ <b>You've escaped " + prevSoi + " — cut your engine (X) now!</b> You're not falling around " + prevSoi + " anymore — you're a tiny planet, orbiting the SUN. Don't keep burning or you'll fly past everything: coast, zoom the map way out, and wait for the gold <b>Burn</b> marker. When it comes around, THAT's your moment to head for " + (BODIES[sim.target] ? BODIES[sim.target].name : "your target") + ". (Time-warp with <b>.</b> — space trips take patience!)");
      }
    } else {
      const fact = WORLD_FACTS[sim.soi] ? " " + WORLD_FACTS[sim.soi] : "";
      copilotSay("🪐 You've entered <b>" + sim.soi + "'s</b> sphere of influence — its gravity runs the show now, and your orbit readout measures from it. Burn retrograde near closest approach to get captured." + fact);
    }
  }
  // The transfer-window moment (Moon TLI or interplanetary injection).
  if (sim.transfer && sim.transfer.open && !announced.transferBurn) {
    announced.transferBurn = true;
    const tName = BODIES[sim.transfer.targetKey] ? BODIES[sim.transfer.targetKey].name : "the target";
    if (sim.transfer.centralKey === "earth") {
      copilotSay("🌙 <b>Transfer window open — burn NOW!</b> The Moon is leading you by just the right angle (" +
        Math.round(sim.transfer.leadAngle_deg) + "°). Burn <i>prograde</i> — the gold arrow is riding your green arrow — until your apoapsis stretches to the Moon's distance, then cut the engine and coast. Apollo timed this exact moment and called it <b>translunar injection</b>.");
    } else {
      copilotSay("🚀 <b>" + tName + " window open — burn now!</b> " + tName + " is leading you by " +
        Math.round(sim.transfer.leadAngle_deg) + "° — burn along the gold arrow until your orbit's " +
        (sim.transfer.dir === "prograde" ? "apoapsis stretches out to" : "periapsis drops down to") + " " + tName +
        "'s orbit, then cut and coast for " + Math.round(sim.transfer.transferTime_s / 86400) +
        " days (use time-warp!). Real mission planners wait months for exactly this alignment.");
    }
  }
  // Captured around a new world.
  if (sim.orbit && sim.orbit.isOrbit && sim.orbit.bodyName !== "Earth" && !announced["orbit_" + sim.orbit.bodyName]) {
    announced["orbit_" + sim.orbit.bodyName] = true;
    const b = sim.orbit.bodyName;
    // Look up by key AND by display name: in famous/generated systems the key ("acb")
    // rarely matches the name ("Alpha Centauri B"), and a star or gas giant must
    // never get landing advice.
    const ob = BODIES[b.toLowerCase()] || Object.values(BODIES).find((x) => x.name === b);
    copilotSay("🛰️ You're in orbit around <b>" + (b === "Moon" ? "the Moon" : b) + "</b>! Periapsis " + (sim.orbit.periapsis / 1000).toFixed(0) +
      " km, apoapsis " + (sim.orbit.apoapsis / 1000).toFixed(0) + " km. " +
      (ob && !ob.solid
        ? "Careful — there's nothing to land ON down there. Enjoy the view from up here!"
        : "To land: lower your periapsis, then brake with the engine on the way down."));
  }
  // Mid-course correction coaching (the Apollo 13 move).
  if (sim.course && !sim.course.onTarget && sim.course.burnVec && !announced.courseCheck) {
    const tb = BODIES[sim.course.targetKey];
    const soi = tb ? tb.soiRadius : 0;
    if (sim.course.miss > 3 * soi) {
      announced.courseCheck = true;
      copilotSay("🧭 <b>Course check:</b> right now you'd miss " + (tb ? tb.name : "the target") + " by about " +
        Math.round(sim.course.miss / 1e6).toLocaleString() + " thousand km. No problem — do what Apollo 13 did: a <b>mid-course correction</b>. " +
        "Point your nose at the gold arrow, give a SHORT gentle burn, watch the 'Closest pass' number shrink, and stop when it says on target. Tiny burns — a little goes a long way out here.");
    }
  }
  if (sim.course && sim.course.onTarget && !announced.onTarget) {
    announced.onTarget = true;
    const tb = BODIES[sim.course.targetKey];
    copilotSay("🎯 <b>On target!</b> Your path now passes inside " + (tb ? tb.name : "the target") +
      "'s sphere of influence — coast with time-warp and get ready to burn retrograde at closest approach to capture. Flight dynamics would be proud.");
  }

  // Reentry plasma — first time the hull glows.
  if ((sim.heat || 0) > 0.25 && !announced.reentry) {
    announced.reentry = true;
    copilotSay("🔥 <b>Reentry!</b> You're hitting the air so fast it's turning to glowing plasma around the ship — that orange fire is real physics (speed + air = heat). Come in at a shallow angle so the air slows you gently. " +
      ((sim.craft.shieldCount || 0) > 0
        ? "Your <b>Heat Shield</b> is taking the fire for you — it chars away slowly instead of letting the ship cook, exactly like Apollo's. Keep the angle shallow and it'll hold."
        : "⚠️ You have <b>no Heat Shield</b> aboard — the bare hull is soaking all of this heat. If it reaches 100% you burn up. Next build, put a Heat Shield under the pod — it's how every real capsule comes home."));
  }
  // Touchdowns.
  if (sim.status === "landed" && sim.landed && !announced.landed[sim.landed.body]) {
    announced.landed[sim.landed.body] = true;
    const crew = sim.crew ? sim.crew.name : null;
    const key = sim.landed.body;
    if (key === "earth") {
      copilotSay(crew
        ? "🛬 Gentle touchdown back on Earth — nicely flown. " + crew + " is out beside the ship, taking a bow."
        : "🛬 Gentle touchdown back on Earth — the probe made it home in one piece. Real sample-return missions end exactly like this!");
    } else {
      const name = BODIES[key] ? BODIES[key].name : key;
      const fact = WORLD_FACTS[name] ? " " + WORLD_FACTS[name] : "";
      copilotSay("🏁 <b>You landed on " + (key === "moon" ? "the Moon" : name) + "!</b> " +
        (crew ? crew + " is out of the capsule, standing on another world — look beside your ship!"
              : "Uncrewed and perfect — the probe's instruments are already sniffing the ground, like a real robot lander.") + fact +
        ((sim.craft.roverCount || 0) > 0 ? " You've got a <b>Rover</b> aboard — press Space to set it loose!" : "") +
        " If you've still got fuel, throttle up (Z, then ↑) to lift off again.");
    }
  }
  // Crashes.
  if (sim.status === "crashed" && !announced.crashed) {
    announced.crashed = true;
    const crew = sim.crew ? sim.crew.name : null;
    const bail = crew
      ? crew + "'s escape bubble popped out in time, as always."
      : "Nobody aboard — probes take the risks so Connies don't have to.";
    if (sim.sankIntoClouds) {
      const g = BODIES[sim.crashedInto];
      copilotSay("🌀 The ship sank into <b>" + (g ? g.name : "the planet") + "'s</b> clouds and was crushed — gas giants have no surface at all, just air that gets thicker and thicker forever. " + bail + " Orbit them, admire them… just don't try to park on them!");
    } else if (sim.burnedUp && isStarKey(sim.crashedInto) && sim.crashedInto !== "sun") {
      const st = BODIES[sim.crashedInto];
      copilotSay("☀️💥 You flew into <b>" + (st ? st.name : "a star") + "</b> — it's a STAR. Even the coolest stars are over 2,000°C at the surface — nothing survives that. " + bail + " Fun fact: it takes MORE fuel to fall into a star than to escape its system!");
    } else if (sim.burnedUp && sim.crashedInto === "sun") {
      if (BODIES.sun.blackHole) {
        copilotSay("⚫ You crossed the <b>event horizon</b> — the line where not even light is fast enough to climb back out. Nothing that crosses it ever returns; that's what makes it a black hole and not just a very heavy star. " + bail + " Everything OUTSIDE the horizon is just ordinary gravity though — you can orbit a black hole all day, exactly like a star. Next time, stay in orbit and admire the glowing disk!");
      } else {
        copilotSay("☀️💥 You flew into the SUN. It's 5,500°C at the surface — nothing survives that. " + bail + " Fun fact: it actually takes MORE fuel to fall into the Sun than to escape the solar system!");
      }
    } else if (sim.burnedUp) {
      copilotSay("🔥💥 The ship <b>burned up on reentry</b> — too fast and too steep, and the air-friction heat won. " + bail +
        ((sim.craft.shieldCount || 0) > 0
          ? " Even your Heat Shield couldn't take that — it buys you a safe CORRIDOR, not immunity. Come in shallower: skim the top of the air and let it slow you a little at a time, like Apollo threading its reentry corridor."
          : " Two fixes, use both: add a <b>Heat Shield</b> under the pod (it soaks most of the fire — every real capsule has one), and come in shallower so the air slows you a little at a time."));
    } else if (sim.crashedInto && sim.crashedInto !== "earth") {
      const b = BODIES[sim.crashedInto];
      copilotSay("💥 We hit " + (b ? b.name : "the surface") + " too hard. " + (b && !b.atmosphere ? "No air here to slow you — you have to burn the engine to brake all the way down. " : "") +
        ((sim.craft.legCount || 0) > 0 ? "" : "Landing Legs would forgive a bumpier touchdown (12 m/s instead of 5). ") + "Hit Reset and try a slower descent.");
    } else {
      copilotSay("💥 We hit the ground. Hit Reset, then try a gentler tilt — go straight up first, then lean over slowly once you're high up.");
    }
  }
  if (sim.soi) prevSoi = sim.soi;
}

// ---- game loop ----
let last = 0;
let courseTimer = 0;
// ---- 🔬 Science: earned inside stations, kept forever ----
const SCIENCE_KEY = "spacesim.science.v1";
let SCIENCE = 0;
try { SCIENCE = parseInt(localStorage.getItem(SCIENCE_KEY)) || 0; } catch {}
const SCIENCE_FACTS = {
  bio: ["🌱 Plant lab checked! In zero-g, roots grow every which way — plants use LIGHT to find 'up' instead of gravity. Astronauts on the ISS have eaten space-grown lettuce.",
        "🧫 Bio experiment logged! Your bones get lazy in zero-g — real astronauts exercise 2 hours a day just so their skeletons don't quit."],
  materials: ["🔥 Materials lab done! A candle flame in zero-g is a little blue BALL — no gravity means no 'up' for hot air to rise, so fire burns in a sphere.",
        "🫧 Fluids experiment! Spilled water in zero-g wads into a wobbly ball — real crews chase escaped water blobs with towels."],
  astro: ["🔭 Telescope time! Up here there's no air to blur the stars — that's exactly why we put Hubble and JWST in space instead of on mountains.",
        "🌍 Earth-watching logged! Astronauts call it the Overview Effect — seeing your whole world in one window changes how you think about it."],
  salvage: ["📼 You recovered the station's old log! Final entry: 'Meteor strike. Power failing. We got everyone to the escape craft — leave the lights off on your way out.' Space junk is why real stations fly dodge maneuvers every year.",],
  vault: ["🏛✨ <b>THE FOUNDERS' VAULT OPENS!</b> You knew your own system — that's the whole key. And the ORDER of worlds isn't random anywhere: close to a star it's too hot for ice, so rock and lava worlds bake in tight; past the frost line, ices survive and worlds grow big and cold. Sia, then Hundun, then the comet's path, then Centdra in the disc — sorted by the star's heat. Every solar system tells this same story, including ours.",],
  basewreck: ["📼 The base log, final entry: 'They came at night — a whole herd of the big armored ones, straight through the walls. Turns out we built our greenhouse on their favorite feeding ground. Nobody was hurt; we grabbed the seed vault and moved to the new base. New rule: check where the LOCALS eat before you build.' Wild animals aren't villains — they were here first, and they only wanted the plants.",],
  alien: ["👽🎵 The resident hums at you — in PRIME NUMBERS. 2, 3, 5, 7, 11… Math is the one language every scientist expects the universe to share. It taps its console and gifts you its notes: ALIEN SCIENCE!",
        "👽📐 It draws you a right triangle and hums three notes: 3, 4, 5. Pythagoras works in every star system — that's WHY scientists think math is how we'd talk to aliens first."],
  monument: ["🗼📖 The story screen wakes for you. In pictures: a golden star… the star swelling, angry… a thousand ships rising together, all lights on… and one tower left glowing behind, pointed at the sky. They SAW their supernova coming and sailed away in time — and here's the real science hiding in it: stars announce a supernova ages ahead (astronomers watch Betelgeuse for exactly this), and the blast leaves a spinning lighthouse behind. Their beacon still shines. So does the star's.",],
};
const SCIENCE_VALUE = { bio: 10, materials: 10, astro: 10, salvage: 15, basewreck: 15, alien: 25, vault: 50, monument: 25 };
let factRotor = 0;
function awardScience(kind) {
  const pts = SCIENCE_VALUE[kind] || 10;
  SCIENCE += pts;
  try { localStorage.setItem(SCIENCE_KEY, String(SCIENCE)); } catch {}
  const facts = SCIENCE_FACTS[kind] || [];
  const fact = facts.length ? facts[(factRotor++) % facts.length] : "";
  copilotSay(fact + " <b>+" + pts + " Science</b> (total " + SCIENCE + ").");
}

// ---- EVA anywhere (his ask): E in space or on the ground sends the Connie OUT ----
function startEva() {
  if (Render.isInside()) return;
  if (sim.mode !== "flight" || sim.status === "crashed") return;
  if (!sim.crew) {
    copilotSay("🛰 Nobody's aboard to go outside — this is a robot probe! Fly a crewed pod and a Connie can EVA.");
    return;
  }
  const landed = sim.status === "landed";
  if (!landed) {
    // Mid-air in an atmosphere is not a spacewalk, it's skydiving — hold on tight.
    const here = BODIES[sim.soi ? sim.soi.toLowerCase() : ""];
    if (here && here.atmosphere && sim.altitude < here.atmosphere.height) {
      copilotSay("🌬️ Too much wind out there — you're still inside " + here.name +
        "'s air! Get above the atmosphere (or land first), then press E to go outside.");
      return;
    }
  }
  const crew = sim.crew.name;
  Render.enterEva(sim, {
    onExit: () => copilotSay(landed
      ? "🚀 " + crew + " climbs back into the capsule. Boots dusted, memories made."
      : "🚀 " + crew + " pulls back along the tether and is safely inside. Real spacewalks end the same way — slow and careful, hand over hand."),
  });
  copilotSay(landed
    ? "🐍👢 <b>" + crew + " is out on the surface!</b> Walk with ← →, hop with ↑ — feel how " +
      (sim.landed && BODIES[sim.landed.body] ? "gravity of " + (BODIES[sim.landed.body].g0).toFixed(1) + " m/s²" : "the local gravity") +
      " changes your jumps. Press <b>E</b> to climb back in."
    : "🐍🌌 <b>" + crew + " is on a SPACEWALK!</b> Nudge with the arrow keys — one push and you coast forever, that's zero-g. Drift too far and the safety tether tugs you home (real astronauts are ALWAYS clipped on — except Bruce McCandless in 1984, who flew a jetpack 100 meters out, the scariest free-flight ever). Press <b>E</b> to come back inside.");
}

// Boarding: docked + press E -> the Connie floats around INSIDE (render owns the room).
function boardStation() {
  if (Render.isInside() || !sim.stationNear || !sim.stationNear.docked) return;
  const st = STATIONS.find((x) => x.id === dockedAtId);
  if (!st) return;
  // Some far-system stations have a RESIDENT — deterministic per system+station,
  // never in Sol (aliens live out among his named stars), never on a wreck.
  const seedKey = SYSTEM.key + "/" + st.id;
  const alienRoll = ((h) => { // tiny inline hash->0..1
    let x = 2166136261;
    for (let i = 0; i < h.length; i++) { x ^= h.charCodeAt(i); x = Math.imul(x, 16777619); }
    return ((x >>> 0) % 1000) / 1000;
  })(seedKey + ":resident");
  const hasAlien = !isSol() && !st.abandoned && !st.yours && alienRoll < 0.45;
  Render.enterStation(
    { name: st.name, abandoned: !!st.abandoned, alien: hasAlien, seedKey,
      spin: !!st.centrifuge }, // your centrifuge station: gravity inside!
    { onScience: awardScience,
      onPuzzle: (ev) => { // 🏛 the Vault coaches like the Navigator: hint first
        if (ev.kind === "wrong") {
          copilotSay(vaultHints[(vaultHintRotor++) % vaultHints.length]);
        } else if (ev.kind === "progress" && ev.step < ev.of) {
          copilotSay("🏛 <b>" + ev.name + "</b> lights up gold — " + ev.step + " of " + ev.of + ". Keep going, outward from the star!");
        }
      },
      onExit: () => copilotSay("🚀 Back aboard your ship — still docked, tanks " +
        (st.abandoned ? "empty as ever (this old wreck has nothing left)." : "topped off. Undock with a gentle throttle when you're ready.")) });
  copilotSay(st.abandoned
    ? "🚪🔦 <b>You float into " + st.name + ".</b> It's dark. One red light still blinks. Junk drifts everywhere — nobody's been here for years. Find the old log screen… and be gentle with this place."
    : st.centrifuge
      ? "🚪🌀 <b>Welcome aboard " + st.name + " — and you can STAND UP!</b> The centrifuge ring is spinning, and the floor pushing on your boots as it turns feels exactly like gravity. That's real physics (it's why every serious station design has a spinning ring). Walk with ← →, jump with ↑ — and notice science screens still glow the same."
      : hasAlien
      ? "🚪👽 <b>You float into " + st.name + "… and someone is HOME.</b> Big eyes, gentle hum, very friendly. Drift over and see what it's studying!"
      : "🚪 <b>Welcome aboard " + st.name + "!</b> Float with the arrow keys — in zero-g you push once and coast. Glowing screens are experiments waiting for a scientist. That's you.");
}

// ---- 🌌 INTERSTELLAR FLIGHT (Phase B — his ask: really FLY to another star) ----
// Escape your star for real, set a course, burn, and the clock pays the true
// (scaled) light-years. No fold, no fudge: distances come from the galaxy map's own
// geometry calibrated to Pandora's REAL 4.37 ly; the trip is decades of sim time
// (the Connies hibernate); braking is your problem — flip halfway, like every
// honest torch-ship story ever written.
const ARRIVE_R = 4e12;        // "system edge" — about a Pluto orbit; arrival trigger
let interPanel = null, interBody = null;
function ensureInterPanel() {
  if (interPanel) return;
  interPanel = document.createElement("div");
  interPanel.style.cssText = "position:absolute;top:118px;left:50%;transform:translateX(-50%);z-index:8;" +
    "background:rgba(10,14,30,0.92);border:1px solid #3a3f6d;border-radius:10px;color:#cfe0ff;" +
    "padding:10px 16px;font:600 13px system-ui,sans-serif;display:none;text-align:center;" +
    "box-shadow:0 4px 22px rgba(0,0,0,.5);max-width:460px;";
  interBody = document.createElement("div");
  interPanel.appendChild(interBody);
  document.body.appendChild(interPanel);
}
// Truly leaving the star: the star owns you AND you're above escape speed for your r.
function escapedStar() {
  if (sim.mode !== "flight" || (sim.status !== "flying" && sim.status !== "orbit")) return false;
  if (sim.soi !== BODIES.sun.name) return false;
  const r = Math.hypot(sim.craft.pos.x, sim.craft.pos.y);
  const v2 = sim.craft.vel.x ** 2 + sim.craft.vel.y ** 2;
  return r > 0 && v2 >= (2 * BODIES.sun.mu) / r;
}
function interstellarDestinations() {
  // Same neighborhood the galaxy map shows: famous + visited (+ home), minus here.
  return buildGalaxyList().map((e) => ({ seed: e.seed, name: e.name }));
}
function setInterstellarCourse(seed) {
  const from = isSol() ? null : SYSTEM.seed;
  const vec = interstellarVector(from, seed === "@sol" ? null : seed);
  if (!vec) return;
  const name = seed === "@sol" ? "The Solar System" : generateSystem(seed).name;
  sim.interstellar = {
    seed, name, ly: vec.ly, dir: vec.dir,
    dest: { x: vec.dir.x * vec.meters, y: vec.dir.y * vec.meters }, // from this star
    startTime: sim.time || 0,
  };
  copilotSay("🌌🧭 <b>Course locked: " + name + " — " + vec.ly.toFixed(1) +
    " light-years.</b> This is the REAL trip (our practice universe is 10x small, " +
    "as always — the real gap is 10x wider). Aim the nose, burn hard, and warp: new " +
    "warp tiers just unlocked, because out there is nothing but distance. The one " +
    "rule of torch-ship flying: <b>flip and brake halfway</b> — I'll tell you when. " +
    "Decades will pass; the Connies curl up and hibernate. 🐍💤");
}
function cancelInterstellar() {
  if (!sim.interstellar) return;
  sim.interstellar = null;
  sim.timeWarp = Math.min(sim.timeWarp, MAX_SYSTEM_WARP);
  copilotSay("🧭 Course cleared — coasting free between the stars. Set a new one anytime.");
}
// 🤖 Autopilot (his ask: "point at a place and it takes you there"): the Navigator
// flies the SAME levers the kid has — attitude, throttle, warp — nothing else. Real
// fuel, real decades; the policy itself is pure (Physics.autopilotStep, half-tank
// rule). Any flight key hands the ship straight back, like a real autopilot.
function autopilotOn() {
  if (!sim.interstellar || sim.interstellar.auto) return;
  sim.interstellar.auto = { fuel: sim.craft.fuelRemaining || 0, phase: null };
}
function autopilotOff() {
  const it = sim.interstellar;
  if (!it || !it.auto) return;
  it.auto = null;
  sim.craft.throttle = 0;
  copilotSay("🤖→🐍 <b>You have the ship, Commander.</b> Course is still locked on " +
    it.name + " — the panel keeps calling the flip point, and 🤖 is one tap away.");
}
// Aim helper: attitude control, not cheating — rotation was never simulated, and
// burning is still all his. Cruise aim steers the VELOCITY onto the target (thrust
// along wanted-minus-actual — the real navigation rule; pointing the nose straight
// at a star while you still carry sideways orbital speed misses by trillions of
// meters). Brake aim is pure retrograde, which kills the sideways drift too.
function aimAtCourse(sign) {
  if (!sim.interstellar) return;
  const c = sim.craft;
  const dx = sim.interstellar.dest.x - c.pos.x, dy = sim.interstellar.dest.y - c.pos.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  let tx, ty;
  const vm = Math.hypot(c.vel.x, c.vel.y);
  if (sign < 0 && vm > 1) {
    tx = -c.vel.x / vm; ty = -c.vel.y / vm;
  } else {
    // Forward thrust ALWAYS, blended with enough sideways lean to kill the drift:
    // aim = along-the-line + drift-kill, weighted so a clean track burns straight
    // at the star and a drifting one leans against the slide (smooth — no
    // special-case flip that could leave the nose parked sideways).
    const vTo2 = c.vel.x * ux + c.vel.y * uy;
    const vLx = c.vel.x - vTo2 * ux, vLy = c.vel.y - vTo2 * uy;
    const vL = Math.hypot(vLx, vLy);
    const along = Math.max(3 * vL, vm * 0.2, 1);
    const bx = ux * along - vLx, by = uy * along - vLy;
    const bm = Math.hypot(bx, by) || 1;
    tx = bx / bm; ty = by / bm;
  }
  c.angle = Math.atan2(-tx, ty); // heading vector is (−sin a, cos a)
}
function arriveFromInterstellar() {
  const it = sim.interstellar;
  const years = ((sim.time || 0) - it.startTime) / (365.25 * 86400);
  const vx = sim.craft.vel.x, vy = sim.craft.vel.y;
  const speed = Math.hypot(vx, vy);
  const inX = it.dir.x, inY = it.dir.y; // inbound direction of travel
  // Swap the universe under the ship — flight-preserving (unlike the Starmap fold).
  if (it.seed === "@sol") returnToSol();
  else {
    const sys = generateSystem(it.seed);
    setSystem(sys.bodies, sys.planetKeys,
      { key: sys.key, name: sys.name, seed: sys.seed, stations: sys.stations, wormholes: sys.wormholes });
    rememberVisit(sys);
  }
  Render.rebuildWorld();
  refreshGalaxy();
  injectPlayerStations();
  UI.rebuildTargets();
  sim.interstellar = null;
  sim.timeWarp = 1;
  sim.body = BODIES.earth;
  sim.target = "earth";
  announced = freshAnnounced();
  // Park the arrival at the new system's REAL edge — just outside its outermost
  // planet — still moving inbound at whatever speed he really arrived with.
  // Braking (or screaming through) is real physics. NOT the arrival bubble:
  // ARRIVE_R is sized for catching a warp frame, and parking half a bubble out
  // put the whole system ~20x farther away than its outermost world — black sky,
  // unlabeled specks on the map, "I flew all this way and it's just not there."
  let edge = 0;
  for (const k of Object.keys(BODIES)) {
    if (BODIES[k].parent === "sun") edge = Math.max(edge, BODIES[k].orbitRadius);
  }
  edge = edge > 0 ? edge * 1.25 : ARRIVE_R * 0.5;
  sim.craft.pos = { x: -inX * edge, y: -inY * edge };
  sim.craft.vel = { x: inX * speed, y: inY * speed };
  sim.landed = null;
  sim.status = "flying";
  const kms = speed / 1000;
  copilotSay("🌌🎉 <b>ARRIVAL: " + BODIES.sun.name + "'s system — you FLEW here.</b> " +
    it.ly.toFixed(1) + " light-years in " + years.toFixed(1) + " game-years (real " +
    "universe: 10x farther, 10x longer — that's why nobody's done this yet). The " +
    "Connies are waking up and stretching " + (speed > 1e5
      ? "— and you're still doing " + Math.round(kms) + " km/s, far too fast to stop here. Flip and BURN or you'll fly straight through!"
      : "— arrival speed " + Math.round(kms) + " km/s. Beautiful braking. Now fly in and explore: it's all ordinary spaceflight from here.") +
    " 🎯 is set to " + BODIES.earth.name + ".");
}
function updateInterstellar() {
  ensureInterPanel();
  if (sim.mode !== "flight" || sim.status === "crashed") { interPanel.style.display = "none"; return; }
  const it = sim.interstellar;
  if (!it) {
    if (!escapedStar()) { interPanel.style.display = "none"; return; }
    // Escaped the star, no course: offer the neighborhood.
    interPanel.style.display = "block";
    if (interBody.dataset.mode !== "pick") {
      interBody.dataset.mode = "pick";
      interBody.innerHTML = "<div style='margin-bottom:6px'>🌌 <b>You've escaped " +
        BODIES.sun.name + "!</b> Interstellar space. Set a course:</div>";
      for (const d of interstellarDestinations()) {
        const b = document.createElement("button");
        b.textContent = "→ " + d.name;
        b.style.cssText = "margin:2px 4px;padding:4px 10px;border-radius:8px;border:1px solid #4a5f9d;" +
          "background:#1d2a52;color:#cfe0ff;cursor:pointer;font:600 12px system-ui;";
        b.onclick = () => { interBody.dataset.mode = ""; setInterstellarCourse(d.seed); };
        interBody.appendChild(b);
      }
    }
    return;
  }
  // Course active: live nav board.
  const dx = it.dest.x - sim.craft.pos.x, dy = it.dest.y - sim.craft.pos.y;
  const rem = Math.hypot(dx, dy);
  // ARRIVAL — checked against the whole path flown since last frame, not just the
  // endpoint: at interstellar warp a single frame can leap far past the arrival
  // bubble, and "we skipped over the star between frames" is not an honest miss.
  let crossed = rem < ARRIVE_R;
  if (!crossed && it.prev) {
    const sx = sim.craft.pos.x - it.prev.x, sy = sim.craft.pos.y - it.prev.y;
    const l2 = sx * sx + sy * sy;
    if (l2 > 0) {
      let f = ((it.dest.x - it.prev.x) * sx + (it.dest.y - it.prev.y) * sy) / l2;
      f = Math.max(0, Math.min(1, f));
      crossed = Math.hypot(it.dest.x - (it.prev.x + sx * f), it.dest.y - (it.prev.y + sy * f)) < ARRIVE_R;
    }
  }
  if (crossed) { interPanel.style.display = "none"; arriveFromInterstellar(); return; }
  it.prev = { x: sim.craft.pos.x, y: sim.craft.pos.y };
  const ux = dx / rem, uy = dy / rem;
  const vTo = sim.craft.vel.x * ux + sim.craft.vel.y * uy; // closing speed
  const a = (sim.craft.thrust || 0) > 0 && (sim.craft.mass || 0) > 0
    ? (sim.craft.thrust * 1000) / (sim.craft.mass * 1000) : 0;
  const brakeDist = a > 0 && vTo > 0 ? (vTo * vTo) / (2 * a) : 0;
  // Brake against the system EDGE (the arrival bubble), not the star itself: flip
  // so the speed dies just as you slide into the new system, ready to explore.
  const remEdge = Math.max(0, rem - ARRIVE_R);
  // Brake zone: when the stop-distance says so, and ALWAYS for the last 15% of the
  // approach — a slow, well-braked cruise still deserves more than one frame of
  // "flip now!" before the system's edge arrives.
  const braking = brakeDist > 0 && remEdge < Math.max(brakeDist * 1.15, rem * 0.15);
  // 🤖 Autopilot flies first (so the autopace below sees the throttle it just set).
  if (it.auto) {
    const vLatA = Math.hypot(sim.craft.vel.x - vTo * ux, sim.craft.vel.y - vTo * uy);
    const plan = Physics.autopilotStep({
      rem, remEdge, arriveR: ARRIVE_R, vTo, vLat: vLatA,
      fuel: sim.craft.fuelRemaining || 0, engageFuel: it.auto.fuel, braking,
    });
    aimAtCourse(plan.aim);
    sim.craft.throttle = plan.throttle;
    if (plan.phase !== it.auto.phase) {
      it.auto.phase = plan.phase;
      const kms = Math.round(vTo / 1000);
      const lines = {
        burn: "🤖🔥 <b>Autopilot has the ship.</b> Burning hard for " + it.name + " — I'll spend HALF the tank speeding up and save half for stopping. That's always enough: a lighter ship gets more push from the same fuel. Warp's mine too — touch any control to take her back.",
        coast: "🤖 Engine off at " + kms + " km/s — half the tank banked for braking. Coasting; the Connies curl up. I'll call the flip.",
        trim: "🤖 Tiny trim burn — nudging us back onto the line.",
        brake: "🤖🔄 <b>FLIP!</b> Nose around, burning backwards — killing " + kms + " km/s so we arrive slow enough to STAY.",
        glide: "🤖✨ Braked to " + kms + " km/s and gliding in. She's yours the moment we cross the edge, Commander.",
        dry: "🤖⛽ <b>The tank ran dry — I can't slow us down.</b> We'll fly through the new system fast; flip and use whatever you've got, or enjoy the view. Next trip: bigger tanks, or a gentler cruise.",
      };
      if (lines[plan.phase]) copilotSay(lines[plan.phase]);
    }
  }
  // HONEST AUTOPACE (same spirit as sim.warpLimited): warp steps DOWN — never up.
  // Coasting: no frame covers more than 20% of what's left (you cannot blink past
  // the star). Burning: no frame adds more than ~5% of your speed (at 200,000,000x
  // an open throttle would otherwise drain the whole tank inside one frame — the
  // kid never has to out-reflex the clock).
  const vNow = Math.hypot(sim.craft.vel.x, sim.craft.vel.y);
  if (vNow > 1) {
    // Pace against the system's EDGE (not the star): the last stretch before the
    // bubble gets many frames, not one leap over it.
    let cap = Math.max(1, (0.2 * Math.max(remEdge, ARRIVE_R * 0.05)) / (vNow * 0.017));
    if (a > 0 && (sim.craft.throttle || 0) > 0) {
      // Gear the burn by BOTH of its consequences per frame, measured against the
      // course line: the along-line push may add ≤5% of your speed, and the
      // cross-line push may add ≤60% of the remaining drift — so trims converge
      // instead of oscillating, and an open throttle can't inhale the tank.
      const hx = -Math.sin(sim.craft.angle), hy = Math.cos(sim.craft.angle);
      const hAlong = Math.abs(hx * ux + hy * uy);
      const hCross = Math.abs(hx * uy - hy * ux);
      const vL = Math.hypot(sim.craft.vel.x - vTo * ux, sim.craft.vel.y - vTo * uy);
      const dvAlong = Math.max(5000, 0.05 * Math.max(vTo, vNow * 0.1));
      const dvCross = Math.max(20, 0.6 * vL);
      // A gear only engages when its component is real: a near-pure prograde burn
      // must not be strangled by the cross gear (and vice versa).
      const capAlong = hAlong > 0.02 ? dvAlong / (a * 0.017 * hAlong) : Infinity;
      const capCross = hCross > 0.02 ? dvCross / (a * 0.017 * hCross) : Infinity;
      cap = Math.min(cap, Math.max(1, Math.min(capAlong, capCross)));
    }
    // Round to 2 significant digits — the HUD shows this number to a kid.
    if (sim.timeWarp > cap) sim.timeWarp = Math.max(1, Number(cap.toPrecision(2)));
    // 🤖 Cruise control: the autopilot may also step warp UP (the one thing the
    // manual autopace never does) — biggest tier comfortably under the honest cap.
    // Decades melt, the streaks stream, and any keypress hands the ship back.
    if (it.auto) {
      let want = sim.timeWarp;
      for (const w of WARPS) if (w <= cap * 0.7 && w > want) want = w;
      if (want > sim.timeWarp) sim.timeWarp = want;
    }
  }
  const eta = vTo > 1 ? (rem / vTo) / (365.25 * 86400) : null;
  interPanel.style.display = "block";
  if (interBody.dataset.mode !== "nav") {
    interBody.dataset.mode = "nav";
    interBody.innerHTML =
      "<div data-i='txt' style='margin-bottom:6px'></div>" +
      "<button data-i='auto' style='margin:2px 4px;padding:4px 10px;border-radius:8px;border:1px solid #4a9d6d;background:#143a26;color:#c6ffd9;cursor:pointer;font:700 12px system-ui;'></button>" +
      "<button data-i='aim' style='margin:2px 4px;padding:4px 10px;border-radius:8px;border:1px solid #4a5f9d;background:#1d2a52;color:#cfe0ff;cursor:pointer;font:600 12px system-ui;'></button>" +
      "<button data-i='off' style='margin:2px 4px;padding:4px 10px;border-radius:8px;border:1px solid #6d4a4a;background:#3a1d1d;color:#ffd0d0;cursor:pointer;font:600 12px system-ui;'>✖ clear course</button>";
    interBody.querySelector("[data-i=off]").onclick = cancelInterstellar;
  }
  const autoBtn = interBody.querySelector("[data-i=auto]");
  autoBtn.textContent = it.auto ? "✋ You have the ship" : "🤖 Autopilot — take us there";
  autoBtn.onclick = () => (it.auto ? autopilotOff() : autopilotOn());
  const aimBtn = interBody.querySelector("[data-i=aim]");
  aimBtn.style.display = it.auto ? "none" : ""; // the autopilot IS the aim, and then some
  aimBtn.textContent = braking ? "🔄 Aim RETROGRADE (brake!)" : "🎯 Aim at " + it.name;
  aimBtn.onclick = () => aimAtCourse(braking ? -1 : 1);
  // Off-line drift: how far the current track misses the star, projected ahead.
  const vLx = sim.craft.vel.x - vTo * ux, vLy = sim.craft.vel.y - vTo * uy;
  const missProj = vTo > 1 ? (Math.hypot(vLx, vLy) / vTo) * rem : 0;
  const drifting = !braking && missProj > ARRIVE_R * 0.5;
  interBody.querySelector("[data-i=txt]").innerHTML =
    "🌌 <b>" + it.name + "</b> · " + (rem / GAME_LY).toFixed(2) + " ly to go · closing " +
    Math.round(vTo / 1000) + " km/s" + (eta ? " · ~" + eta.toFixed(1) + " yr at this speed" : "") +
    "<br>" + (braking
      ? "🔥 <b>BRAKE ZONE — flip and burn</b> (stop-distance ≥ what's left to the system's edge)"
      : drifting
        ? "⚠️ <b>drifting off the line</b> — 🎯 Aim & a short burn brings the track back"
        : brakeDist > 0
          ? "on line — flip-and-brake point in " +
            ((remEdge - Math.max(brakeDist * 1.15, rem * 0.15)) / GAME_LY).toFixed(2) + " ly"
          : "cruise — 🎯 Aim at the star and burn");
}

// ---- 🏠 Ground bases (Hundun): land near one, press B, go inside ----
// Bases live on the HOME body's style (famous.js); they sit at fixed surface
// angles, so distance is just arc length. Range is generous — it's for a kid.
const BASE_RANGE_M = 2500;
let baseHintShownFor = null; // one nudge per landing, not a nag
function nearestBase() {
  if (sim.status !== "landed" || !sim.landed) return null;
  const b = BODIES[sim.landed.body];
  if (!b || !b.style || !Array.isArray(b.style.bases)) return null;
  const phiCraft = Math.atan2(sim.landed.offset.y, sim.landed.offset.x);
  let best = null;
  for (const base of b.style.bases) {
    let dPhi = Math.abs(phiCraft - base.phi) % (Math.PI * 2);
    if (dPhi > Math.PI) dPhi = Math.PI * 2 - dPhi;
    const dist = dPhi * b.radius;
    if (dist < BASE_RANGE_M && (!best || dist < best.dist)) best = { base, dist };
  }
  return best;
}
function updateBasesSim() {
  const nb = nearestBase();
  sim.baseNear = nb ? { name: nb.base.name, dist: nb.dist, wrecked: !!nb.base.wrecked } : null;
  if (nb && baseHintShownFor !== nb.base.id) {
    baseHintShownFor = nb.base.id;
    copilotSay("🏠 <b>" + nb.base.name + "</b> is only " + Math.round(nb.dist) +
      " m away" + (nb.base.wrecked ? " — or what's left of it." : ".") +
      " Press <b>B</b> to go inside!");
  }
  if (!nb && sim.status !== "landed") baseHintShownFor = null; // re-arm after liftoff
}
function boardBase() {
  if (Render.isInside()) return;
  const nb = nearestBase();
  if (!nb) return;
  const base = nb.base;
  Render.enterStation(
    { name: base.name, abandoned: !!base.wrecked, alien: false, ground: true,
      monument: !!base.alien, seedKey: SYSTEM.key + "/" + base.id },
    { onScience: awardScience,
      onExit: () => copilotSay("🚀 Back out on the surface, ship waiting where you parked it.") });
  copilotSay(base.alien
    ? "🚪🗼 <b>You step inside " + base.name + ".</b> It's vast, and quiet, and CLEAN — whoever built this swept the floor before they left. Glyphs glow on the walls, and the beacon core still hums after all this time. Walk to the glowing screens: one still remembers their story."
    : base.wrecked
    ? "🚪🔦 <b>You step into " + base.name + ".</b> Real gravity — nothing floats here, and everything that fell is still where it landed. Look at those long scrapes down the walls… something big shouldered through. Find the log screen and learn what happened."
    : "🚪🏠 <b>Welcome to " + base.name + "!</b> Real planet gravity underfoot — walk with ← →, jump with ↑. The greenhouse is thriving and the science screens are glowing. This is what a working off-world outpost looks like.");
}

// ---- ☄️ Ring-rock rain (Hundun, style.meteorRain): the young ring still sheds ----
// Flight-only damage: a hit decrements a per-stage part COUNT on sim.craft (the same
// fields staging already changes) — the kid's saved rocket design is NEVER touched.
let meteorLessonSaid = false;
function updateMeteorRain() {
  if (sim.mode !== "flight" || sim.status === "crashed" || Render.isInside()) return;
  const key = sim.landed ? sim.landed.body : (sim.orbit && sim.orbit.bodyKey);
  const b = key && BODIES[key];
  const exposed = b && b.style && b.style.meteorRain &&
    (sim.status === "landed" || (sim.altitude || 0) < 30000);
  if (!exposed) { sim._meteorNext = 0; return; }
  const t = sim.time || 0;
  if (!sim._meteorNext) { sim._meteorNext = t + 25 + Math.random() * 60; return; }
  if (t < sim._meteorNext) return;
  if (sim.timeWarp > 100) { sim._meteorNext = t + 60; return; } // strikes land in (near) real time
  sim._meteorNext = t + 90 + Math.random() * 300;
  // Most rocks miss. A hit breaks one exposed, non-essential part — for THIS flight.
  const breakables = [
    ["chuteCount", "Parachute"], ["legCount", "Landing Legs"], ["solarCount", "Solar Panels"],
    ["wingCount", "Delta Wings"], ["dockCount", "Docking Port"],
  ].filter(([f]) => (sim.craft[f] || 0) > 0);
  const hit = Math.random() < 0.33;
  Render.spawnMeteor(sim, hit && breakables.length > 0);
  if (hit && breakables.length) {
    const [field, label] = breakables[Math.floor(Math.random() * breakables.length)];
    sim.craft[field] = Math.max(0, (sim.craft[field] || 0) - 1);
    copilotSay("☄️💥 <b>A ring rock clipped the ship — the " + label + " is smashed!</b> " +
      (meteorLessonSaid ? "" :
        "Hundun sits under a young, messy ring, and young rings shed stones (early Earth " +
        "was pummeled the same way — look at the Moon's craters). Check your ship before " +
        "you fly home — and maybe park farther from the ring's shadow next time."));
    meteorLessonSaid = true;
  } else if (hit) {
    copilotSay("☄️ <b>WHUMP.</b> A ring rock slammed down and the whole hull rang — but " +
      "nothing broke this time. The bare rocket body is tough; it's the delicate bits " +
      "(chutes, panels, legs) that meteors love to smash.");
  } else {
    copilotSay("☄️ A streak of light — a ring rock just hit the plain nearby! Hundun's " +
      "young ring rains stones like this all the time. Real planetary scientists count " +
      "fresh craters exactly this way to age a surface.");
  }
}

// 🏛 Vault hints, in the Navigator's hint-first teaching voice (never the answer).
let vaultHintRotor = 0;
const vaultHints = [
  "🏛 The pedestals go dark and reset — no harm done! Think about YOUR system: which world hugs Youngcow tightest? The hottest one starts the sequence.",
  "🏛 Reset — try again! The sign says <b>from the star</b>: closest first, farthest last. Where does the lava world live, and where do things stay icy?",
  "🏛 Almost! Picture the map of your system, sunward out. (Real astronomy hint: heat sorts worlds — rock bakes close in, ice survives far out.)",
];

// ---- 🛰 Space stations: propagate their circular orbits, offer docking ----
// Dock = drift within 150 m at under 10 m/s relative. Working stations refuel the
// current stage (a gas station in orbit — that's why real programs want depots!).
// The abandoned one just... doesn't answer. The Navigator tells you why.
let dockedAtId = null;
function stationStateAt(st, t) {
  const b = BODIES[st.body];
  if (!b) return null;
  const bs = bodyStateAt(st.body, t);
  const r = b.radius * st.altR;
  const n = Math.sqrt(b.mu / (r * r * r));
  const th = st.phase0 + n * t;
  return {
    pos: { x: bs.pos.x + r * Math.cos(th), y: bs.pos.y + r * Math.sin(th) },
    vel: { x: bs.vel.x - r * n * Math.sin(th), y: bs.vel.y + r * n * Math.cos(th) },
  };
}
function updateStationsSim() {
  const t = sim.time || 0;
  const view = [];
  let nearest = null;
  for (const st of STATIONS) {
    const ss = stationStateAt(st, t);
    if (!ss) continue;
    view.push({ id: st.id, name: st.name, body: st.body, abandoned: !!st.abandoned,
                yours: !!st.yours, pos: ss.pos });
    const inSpace = sim.mode === "flight" && (sim.status === "flying" || sim.status === "orbit");
    if (inSpace) {
      const dist = Math.hypot(sim.craft.pos.x - ss.pos.x, sim.craft.pos.y - ss.pos.y);
      const rel = Math.hypot(sim.craft.vel.x - ss.vel.x, sim.craft.vel.y - ss.vel.y);
      if (!nearest || dist < nearest.dist) nearest = { st, dist, rel };
    }
  }
  sim.stationsView = view;
  sim.stationNear = nearest && nearest.dist < 5e6
    ? { name: nearest.st.name, dist: nearest.dist, rel: nearest.rel,
        abandoned: !!nearest.st.abandoned, docked: dockedAtId === nearest.st.id }
    : null;

  if (!nearest) return;
  const { st, dist, rel } = nearest;
  if (dist < 150 && rel < 10 && (sim.status === "flying" || sim.status === "orbit")) {
    if ((sim.craft.dockCount || 0) === 0) {
      // Perfect rendezvous, nothing to grab with — the honest lesson, once per approach.
      if (dockedAtId !== "noport:" + st.id) {
        dockedAtId = "noport:" + st.id;
        copilotSay("🛰🤏 Beautiful rendezvous with <b>" + st.name + "</b> — you're holding " +
          "position meters away! But there's nothing to grab with: docking needs a " +
          "<b>Docking Port</b> (matching rings that latch — like Apollo's probe and " +
          "drogue). Add one to your rocket next launch and the station can pull you in.");
      }
      return;
    }
    if (dockedAtId !== st.id) {
      dockedAtId = st.id;
      if (st.abandoned) {
        copilotSay("🛰⚠️ <b>Docked with " + st.name + "</b>… and nobody answers. A meteor " +
          "punched through the ring years ago — you can see the bite it took, the dead " +
          "solar wings, and all the junk still tumbling around that nobody ever cleaned " +
          "up. The tech shut down with the power, so there's <b>no fuel here</b>. Space " +
          "junk is a REAL problem — we track over 30,000 pieces around the real Earth. " +
          "Press <b>E</b> to float inside… if you're brave.");
      } else {
        const before = sim.craft.fuelRemaining || 0;
        sim.craft.fuelRemaining = Math.max(before, sim.craft.stageFuelMax || before);
        copilotSay("🛰✅ <b>Docked with " + st.name + "!</b> Matching orbits within a few " +
          "meters at walking speed is the hardest flying there is — Gemini crews spent " +
          "whole missions practicing exactly this. Press <b>E</b> to go aboard! The crew topped off your tanks " +
          (sim.craft.fuelRemaining > before + 0.01 ? "(<b>fuel refilled!</b>)" : "(they were already full)") +
          " — orbital gas stations are why real agencies dream of depots. Undock by " +
          "easing the throttle.");
      }
    }
  } else if (dockedAtId && dist > 600) {
    dockedAtId = null; // drifted away: next visit greets (and refuels) again
  }

  // HIS FIX ("you dock far away from them"): once latched, the station PULLS YOU IN —
  // real docking is a soft capture followed by retraction that seats the ship flush.
  // While berthed the ship rides the station's orbit, nose at the port. Easing the
  // throttle pushes off (the latch re-arms once you've drifted past 600 m).
  if (dockedAtId === st.id && (sim.status === "flying" || sim.status === "orbit") &&
      (sim.craft.throttle || 0) === 0) {
    const ss = stationStateAt(st, t);
    if (ss) {
      const bx = ss.pos.x + 12, by = ss.pos.y; // berth: just off the +X docking port
      sim.craft.pos.x += (bx - sim.craft.pos.x) * 0.06; // the retraction winch
      sim.craft.pos.y += (by - sim.craft.pos.y) * 0.06;
      sim.craft.vel.x = ss.vel.x;
      sim.craft.vel.y = ss.vel.y;
      sim.craft.angle = Math.PI / 2; // nose -X: pointed at the port that holds you
    }
  }
}

// ---- 🌀 WORMHOLES: orbiting gates between named systems (his ask, 2026-07-22) ----
// Propagated exactly like stations (body + altR + phase0 → stationStateAt). Fly
// INSIDE WH_CAPTURE of a mouth and the throat takes the ship: a ~6 s wall-clock
// cinematic (controls locked, sim time held — same rule as being aboard a station)
// while the universe is swapped underneath (the interstellar-arrival machinery),
// then you're spat out of the TWIN mouth moving radially outward at the speed you
// carried in. Two-way by construction: every mouth's dest names its twin.
// Honestly-labeled magic — the Navigator teaches the real wormhole science.
const WH_CAPTURE = 320;    // m — fly this close to the swirl and you're going in
const WH_REARM = 2500;     // m — the exit mouth won't re-grab you until you've cleared this
let whRide = null;         // { wh, start, swapped, relSpeed, cv, streaks } during the cinematic
let whArmed = null;        // mouth id you must drift clear of before gates re-arm

function wormholeDestName(wh) {
  return wh.dest.seed === "@sol" ? "the Solar System" : "the " + wh.dest.seed + " system";
}

function updateWormholesSim() {
  const t = sim.time || 0;
  const view = [];
  let nearest = null;
  for (const wh of WORMHOLES) {
    const ws = stationStateAt(wh, t);
    if (!ws) continue;
    view.push({ id: wh.id, name: wh.name, body: wh.body, color: wh.color, pos: ws.pos });
    if (sim.mode === "flight" && (sim.status === "flying" || sim.status === "orbit") &&
        !sim.interstellar && !whRide) {
      const dist = Math.hypot(sim.craft.pos.x - ws.pos.x, sim.craft.pos.y - ws.pos.y);
      if (!nearest || dist < nearest.dist) nearest = { wh, ws, dist };
    }
  }
  sim.wormholesView = view;
  sim.wormholeNear = nearest && nearest.dist < 5e6
    ? { name: nearest.wh.name, dist: nearest.dist, leadsTo: wormholeDestName(nearest.wh) }
    : null;
  // Re-arm: after an exit you appear 700 m from the twin — no instant bounce-back.
  if (whArmed && (!nearest || nearest.wh.id !== whArmed || nearest.dist > WH_REARM)) whArmed = null;
  if (nearest && nearest.dist < WH_CAPTURE && !whArmed) startWormholeRide(nearest.wh, nearest.ws);
}

function startWormholeRide(wh, ws) {
  if (whRide) return;
  const rel = Math.hypot(sim.craft.vel.x - ws.vel.x, sim.craft.vel.y - ws.vel.y);
  whRide = { wh, start: performance.now(), swapped: false,
             relSpeed: Math.min(Math.max(rel, 40), 2500) };
  sim.timeWarp = 1;
  sim.craft.throttle = 0;
  if (mapView) { mapView = false; Render.setFlightView("follow"); }
  copilotSay("🌀 <b>" + wh.name + " has you!</b> Hold on — riding the throat to <b>" +
    wormholeDestName(wh) + "</b>…");
  buildWormholeOverlay();
  requestAnimationFrame(tickWormholeRide);
}

function buildWormholeOverlay() {
  const cv = document.createElement("canvas");
  cv.id = "wormhole-ride";
  cv.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:200;";
  document.body.appendChild(cv);
  // The throat's star-streaks: fixed random seeds, animated by wall-clock time.
  const streaks = [];
  for (let i = 0; i < 260; i++) {
    streaks.push({ a: Math.random() * Math.PI * 2, r: Math.random(),
                   w: 0.6 + Math.random() * 1.8 });
  }
  whRide.cv = cv;
  whRide.streaks = streaks;
}

// Cinematic timeline (seconds, wall clock): the gate grabs you and the screen irises
// dark → the throat (streak tunnel, accelerating, gate-colored bending to white) →
// white flash (the universe is swapped just before it) → reveal the new sky.
const WH_T_GRAB = 0.9, WH_T_SWAP = 3.1, WH_T_FLASH = 3.5, WH_T_END = 5.6;
function tickWormholeRide() {
  if (!whRide) return;
  const s = (performance.now() - whRide.start) / 1000;
  drawWormholeThroat(s);
  if (s >= WH_T_SWAP && !whRide.swapped) doWormholeSwap();
  if (s >= WH_T_END) endWormholeRide();
  else requestAnimationFrame(tickWormholeRide);
}

function drawWormholeThroat(s) {
  const cv = whRide.cv;
  if (!cv) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth * dpr, H = cv.clientHeight * dpr;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  const col = new (function () { // gate color as r,g,b 0..255
    const c = whRide.wh.color;
    this.r = (c >> 16) & 255; this.g = (c >> 8) & 255; this.b = c & 255;
  })();
  // Background: fades IN over the grab, holds, fades OUT over the reveal.
  const bgA = s < WH_T_GRAB ? s / WH_T_GRAB
            : s < WH_T_FLASH ? 1
            : Math.max(0, 1 - (s - WH_T_FLASH) / (WH_T_END - WH_T_FLASH));
  ctx.fillStyle = "rgba(2,3,10," + bgA.toFixed(3) + ")";
  ctx.fillRect(0, 0, W, H);
  // The throat runs from mid-grab to the flash.
  const p = Math.min(Math.max((s - WH_T_GRAB * 0.5) / (WH_T_FLASH - WH_T_GRAB * 0.5), 0), 1);
  if (p > 0 && bgA > 0.05) {
    const cx = W / 2 + Math.sin(s * 2.1) * W * 0.008; // slight drift — you're IN it
    const cy = H / 2 + Math.cos(s * 1.7) * H * 0.008;
    const maxR = Math.hypot(W, H) * 0.55;
    const speed = 0.15 + 2.6 * p * p; // the ride accelerates
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = bgA;
    for (const st of whRide.streaks) {
      const r = (st.r + s * speed * 0.22) % 1;
      const px = Math.pow(r, 1.55) * maxR;
      const len = (14 + 220 * r * speed) * (0.35 + p) * dpr * 0.5;
      const wMix = Math.min(1, r * 0.85 + p * 0.35); // gate color → white outward
      const cr = Math.round(col.r + (255 - col.r) * wMix);
      const cg = Math.round(col.g + (255 - col.g) * wMix);
      const cb = Math.round(col.b + (255 - col.b) * wMix);
      ctx.strokeStyle = "rgba(" + cr + "," + cg + "," + cb + "," + (0.12 + 0.75 * r).toFixed(3) + ")";
      ctx.lineWidth = st.w * dpr * (0.5 + r);
      const ca = Math.cos(st.a), sa = Math.sin(st.a);
      ctx.beginPath();
      ctx.moveTo(cx + ca * px, cy + sa * px);
      ctx.lineTo(cx + ca * (px + len), cy + sa * (px + len));
      ctx.stroke();
    }
    // Rushing rings of the throat wall.
    for (let i = 0; i < 5; i++) {
      const rr = ((s * speed * 0.28 + i / 5) % 1);
      const rp = Math.pow(rr, 1.55) * maxR;
      ctx.strokeStyle = "rgba(" + col.r + "," + col.g + "," + col.b + "," + (0.22 * (1 - rr)).toFixed(3) + ")";
      ctx.lineWidth = 2.5 * dpr * (0.4 + rr * 2);
      ctx.beginPath(); ctx.arc(cx, cy, rp, 0, Math.PI * 2); ctx.stroke();
    }
    // The far end: a white star growing as you close in.
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30 * dpr + p * p * 160 * dpr);
    core.addColorStop(0, "rgba(255,255,255," + (0.5 + 0.5 * p) + ")");
    core.addColorStop(0.4, "rgba(" + col.r + "," + col.g + "," + col.b + ",0.5)");
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // Caption — kid-readable, names the trip.
    ctx.font = "700 " + Math.round(17 * dpr) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(232,238,252," + (0.85 * bgA).toFixed(3) + ")";
    ctx.fillText("🌀 " + whRide.wh.name.toUpperCase() + "  →  " + wormholeDestName(whRide.wh),
      W / 2, H - 46 * dpr);
  }
  // The flash: a clean white sheet around the swap moment.
  const f = 1 - Math.min(Math.abs(s - WH_T_FLASH) / 0.45, 1);
  if (f > 0) {
    ctx.fillStyle = "rgba(255,255,255," + (f * f).toFixed(3) + ")";
    ctx.fillRect(0, 0, W, H);
  }
}

function doWormholeSwap() {
  const wh = whRide.wh;
  whRide.swapped = true;
  // Same flight-preserving universe swap the interstellar autopilot lands with.
  if (wh.dest.seed === "@sol") returnToSol();
  else {
    const sys = generateSystem(wh.dest.seed);
    setSystem(sys.bodies, sys.planetKeys,
      { key: sys.key, name: sys.name, seed: sys.seed, stations: sys.stations, wormholes: sys.wormholes });
    rememberVisit(sys);
  }
  Render.rebuildWorld();
  refreshGalaxy();
  injectPlayerStations();
  UI.rebuildTargets();
  sim.timeWarp = 1;
  announced = freshAnnounced();
  const t = sim.time || 0;
  const twin = WORMHOLES.find((w) => w.id === wh.dest.twin);
  const ts = twin ? stationStateAt(twin, t) : null;
  if (ts) {
    // Exit the twin mouth radially OUTWARD from its parent, at the speed you flew in
    // with — 700 m clear of the swirl (outside WH_CAPTURE; whArmed guards the rest).
    const bs = bodyStateAt(twin.body, t);
    let ux = ts.pos.x - bs.pos.x, uy = ts.pos.y - bs.pos.y;
    const um = Math.hypot(ux, uy) || 1; ux /= um; uy /= um;
    sim.craft.pos = { x: ts.pos.x + ux * 700, y: ts.pos.y + uy * 700 };
    sim.craft.vel = { x: ts.vel.x + ux * whRide.relSpeed, y: ts.vel.y + uy * whRide.relSpeed };
    sim.craft.angle = Math.atan2(-ux, uy); // nose along the exit direction
    sim.body = BODIES[twin.body] || BODIES.earth;
    sim.target = twin.body;
    announced.soi[sim.body.name] = true; // you arrive mid-SOI; skip the capture coaching
    whArmed = twin.id;
  } else {
    // No twin (should be impossible — node-tested): arrive in home orbit instead.
    const park = Physics.parkingOrbit("earth", t);
    sim.craft.pos = park.pos; sim.craft.vel = park.vel; sim.craft.angle = park.angle;
    sim.body = BODIES.earth; sim.target = "earth";
  }
  sim.landed = null;
  sim.status = "flying";
  sim.heat = 0;
}

function endWormholeRide() {
  if (whRide && whRide.cv) whRide.cv.remove();
  whRide = null;
  copilotSay("🌀✅ <b>Welcome to " + SYSTEM.name + "!</b> You just rode a wormhole — a " +
    "tunnel connecting two far-apart places in space. The real science: Einstein and " +
    "Rosen's math found these 'bridges' in 1935, and the math really allows them — but " +
    "nobody has ever seen one, and holding one open would take <b>exotic matter</b> " +
    "(negative energy!) that no one has ever found. So the gates are this game's gift — " +
    "like ✨ Teleport, an honest shortcut, not physics. The mouth behind you leads back " +
    "the way you came. Everything else here is real flying.");
}

function frame(t) {
  const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
  last = t;
  sim.satellites = SATELLITES; // render + Navigator read them off the sim
  sim.science = SCIENCE;       // the 🔬 ledger, shown in the HUD
  if (Render.isInside()) {     // aboard a station: time holds its breath
    Render.update(sim);
    requestAnimationFrame(frame);
    return;
  }

  // During a wormhole ride the cinematic owns the screen and sim time holds its
  // breath (same rule as being aboard a station) — no controls, no physics.
  if (sim.mode === "flight" && sim.status !== "crashed" && !whRide) {
    applyControls(dt);
    if (dt > 0) Physics.step(sim, dt * sim.timeWarp); // physics sub-steps adaptively

    // Transfer phasing toward the current target (Moon from Earth orbit, planets from
    // Sun orbit). null = no guidance applies right now.
    sim.transfer = Physics.transferWindow(sim);

    // Mid-course correction: once the window guidance goes quiet (transfer underway),
    // predict the closest pass to the target and which tiny burn shrinks the miss.
    // Recomputed a couple of times a second — it's a 240-sample Kepler scan, not free.
    courseTimer -= dt;
    if (!sim.transfer && sim.status !== "landed") {
      if (courseTimer <= 0) {
        sim.course = Physics.courseCorrection(sim);
        courseTimer = 0.5;
      }
    } else {
      sim.course = null;
    }

    flightCallouts();

    // Auto-deploy the chute low over any world WITH AIR on the way down — the kid
    // shouldn't need to know the P key for his first successful landing.
    if (!sim.craft.chuteDeployed && (sim.craft.chuteCount || 0) > 0 &&
        sim.status === "flying" && sim.altitude < 2500 && sim.speed < 240) {
      const here = BODIES[sim.soi ? sim.soi.toLowerCase() : ""];
      if (here && here.atmosphere) {
        // Descending? Radial velocity vs the local body (its own motion subtracted).
        const bs = bodyStateAt(here.key, sim.time || 0);
        const rx = sim.craft.pos.x - bs.pos.x, ry = sim.craft.pos.y - bs.pos.y;
        const vr = (sim.craft.vel.x - bs.vel.x) * rx + (sim.craft.vel.y - bs.vel.y) * ry;
        if (vr < 0) deployChute(true);
      }
    }
    UI.renderStats(null, sim);
  }

  // Stations AFTER the physics step: their drawn position must match the same
  // instant as the craft's, or at time-warp the station visibly lags kilometers
  // behind its true spot (his play-test report: "teleports you very far away").
  updateStationsSim();
  updateWormholesSim();
  updateBasesSim();
  updateMeteorRain();
  updateInterstellar();
  School.onTick(sim); // 🎒 flight coaching (no-op unless a school flight is up)

  Render.update(sim);
  updateBanner();
  updateMapHint();
  updateDescentHud();
  updateDeployBtn();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
