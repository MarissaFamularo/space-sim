// main.js — PM-owned glue. Boots modules, runs the game loop, switches build<->flight,
// drives flight controls (steer / throttle / stage / time-warp / target), detects goals,
// and wires the copilot. Integrates physics.js + render.js + builder.js per the contract.

import { PARTS } from "./mods.js";
import { BODIES, newCraft, newSimState, computeStats, findPart, bodyStateAt } from "./state.js";
import { Physics } from "./physics.js";
import { Render } from "./render.js";
import { Builder } from "./builder.js";
import { UI } from "./ui.js";
import { Copilot } from "./copilot.js";
import { pickConnie } from "./connies.js";

const canvas = document.getElementById("scene");
let craft = newCraft();
craft._catalog = PARTS; // lets Physics.applyStage read part data if ever needed
let sim = newSimState(BODIES.earth);

// Time-warp tiers: , and . step through. Interplanetary cruises need the top ones —
// a Mars transfer is ~82 (scaled) days of coasting.
const WARPS = [1, 5, 25, 100, 1000, 10000, 100000, 500000];

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
  Jupiter: "Jupiter is so big that 1,300 Earths would fit inside it. NASA's Galileo probe dove into its clouds in 2003 and melted on the way down.",
  Saturn: "Saturn's rings are made of billions of chunks of ice, some as small as snowflakes, some as big as houses.",
  Io: "Io is the most volcanic world in the solar system — hundreds of active volcanoes, because Jupiter's gravity kneads it like dough.",
  Europa: "Under Europa's cracked ice shell hides a salty OCEAN with more water than all of Earth's seas — a top place to look for life.",
  Ganymede: "Ganymede is the biggest moon in the solar system — bigger than the planet Mercury!",
  Callisto: "Callisto has the most craters of any world — its surface is 4 billion years of bullseyes.",
  Titan: "Titan's air is thicker than Earth's, with rain and lakes — but of liquid methane. The Huygens probe landed here by parachute in 2005.",
  Uranus: "Uranus rolls around the Sun on its side — its seasons last 21 Earth-years each.",
  Neptune: "Neptune has the fastest winds in the solar system — over 2,000 km/h. Only Voyager 2 has ever visited it.",
  Sun: "The Sun holds 99.8% of all the mass in the solar system.",
  Earth: "The only world where your parachute, your lungs, and your snack supply all work.",
};

// ---- propulsion for a given stage (integration owns this; physics reads the live fields) ----
function activeStage(craft, stageNum) {
  let thrust = 0, veSum = 0, engines = 0, stageFuel = 0, remainingMass = 0, chutes = 0;
  for (const inst of craft.parts) {
    const def = findPart(PARTS, inst.partId);
    if (!def) continue;
    if (inst.stage >= stageNum) {
      remainingMass += (def.dryMass || 0) + (def.fuelMass || 0);
      if (def.type === "chute") chutes++;
    }
    if (inst.stage === stageNum) {
      if (def.type === "engine") { thrust += def.thrust || 0; veSum += def.exhaustVelocity || 0; engines++; }
      stageFuel += def.fuelMass || 0;
    }
  }
  return { thrust, exhaustVelocity: engines ? veSum / engines : 0, stageFuel, remainingMass, chutes };
}
function maxStage(craft) {
  return craft.parts.reduce((m, i) => Math.max(m, i.stage || 0), 0);
}
function loadStage(stageNum) {
  const s = activeStage(craft, stageNum);
  sim.craft.currentStage = stageNum;
  sim.craft.mass = s.remainingMass;
  sim.craft.fuelRemaining = s.stageFuel;
  sim.craft.thrust = s.thrust;
  sim.craft.exhaustVelocity = s.exhaustVelocity;
  sim.craft.chuteCount = s.chutes;
  sim.stageWeightKN = s.remainingMass * BODIES.earth.g0;
  sim.cantLiftOff = s.thrust <= sim.stageWeightKN;
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
  sim.crew = pickConnie();
  mapView = false;
  announced = freshAnnounced();
  announced.soi.Earth = true; // you start there; no callout for home
  loadStage(0);
  copilotSay("🐍 Commander <b>" + sim.crew.name + "</b> is aboard — helmet sealed, coils braced. Liftoff!");
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

function doStage() {
  if (sim.mode !== "flight") return;
  const next = (sim.craft.currentStage || 0) + 1;
  if (next > maxStage(craft)) { copilotSay("No more stages to drop — you're flying the last one."); return; }
  loadStage(next);
  const remaining = { name: craft.name, parts: craft.parts.filter((i) => (i.stage || 0) >= next) };
  Render.buildCraftMesh(remaining);
}

function setTarget(key) {
  if (!BODIES[key]) return;
  sim.target = key;
  announced.transferBurn = false; // a new destination gets its own TLI call
  announced.courseCheck = false;
  announced.onTarget = false;
  const b = BODIES[key];
  const fact = WORLD_FACTS[b.name] ? " " + WORLD_FACTS[b.name] : "";
  copilotSay("🎯 Target set: <b>" + b.name + "</b>." + fact +
    (key === "moon" ? "" : " To get there: reach Earth orbit, burn prograde until you ESCAPE Earth into a Sun orbit, then wait for the gold Burn marker on the map."));
}

// ---- copilot helper ----
function copilotSay(txt) {
  const log = document.getElementById("copilot-log");
  if (!log) return;
  const d = document.createElement("div"); d.className = "ai";
  d.innerHTML = "<b>Navigator:</b> " + txt;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}

// ---- boot ----
Render.init(canvas);
Builder.init({ craft, partsCatalog: PARTS, onChange: onCraftChange });
UI.init({
  onLaunch: launch, onReset: reset,
  onModeChange: (m) => m === "build" && enterBuild(),
  onToggleMap: () => { mapView = !mapView; Render.setFlightView(mapView ? "map" : "follow"); return mapView; },
  onToggleArrow: (which, on) => Render.setArrow(which, on),
  onTargetChange: (key) => setTarget(key),
});
wireCopilot();
Copilot.initSettings();
enterBuild();
copilotSay("Hi! I'm your navigator. Build a rocket on the left, hit Launch, then use the arrow keys to steer. The whole solar system is out there — pick a target and go. Ask me anything!");

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
let mapView = false;
window.addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") return;
  keys[e.key] = true;
  if (e.repeat) return;
  if (e.key === " ") { e.preventDefault(); doStage(); }
  if (e.key === "z" || e.key === "Z") sim.craft.throttle = 1;
  if (e.key === "x" || e.key === "X") sim.craft.throttle = 0;
  if (e.key === ".") stepWarp(+1);
  if (e.key === ",") stepWarp(-1);
  if (e.key === "m" || e.key === "M") { mapView = !mapView; Render.setFlightView(mapView ? "map" : "follow"); }
  if (e.key === "p" || e.key === "P") deployChute(false);
});
window.addEventListener("keyup", (e) => { keys[e.key] = false; });
function stepWarp(dir) {
  const i = WARPS.findIndex((w) => w >= sim.timeWarp);
  const at = i === -1 ? WARPS.length - 1 : i;
  const next = Math.max(0, Math.min(WARPS.length - 1, at + dir));
  sim.timeWarp = WARPS[next];
}

function applyControls(dt) {
  if (sim.mode !== "flight" || sim.status === "crashed") return;
  const STEER = 0.7, THR = 0.8; // rad/s, fraction/s
  let steering = false;
  if (keys["ArrowLeft"] || keys["a"]) { sim.craft.angle += STEER * dt; steering = true; }
  if (keys["ArrowRight"] || keys["d"]) { sim.craft.angle -= STEER * dt; steering = true; }
  if (keys["ArrowUp"]) { sim.craft.throttle = Math.min(1, sim.craft.throttle + THR * dt); }
  if (keys["ArrowDown"]) { sim.craft.throttle = Math.max(0, sim.craft.throttle - THR * dt); }
  // Zoom works in BOTH flight views now (Render routes it): the follow camera pulls back
  // to see the planet, the map frame widens to see the system.
  if (keys["="] || keys["+"]) Render.zoomMap(Math.exp(-2.2 * dt)); // zoom in
  if (keys["-"] || keys["_"]) Render.zoomMap(Math.exp(2.2 * dt));  // zoom out
  // Time warp only makes sense while coasting; thrusting or steering snaps back to real time.
  if (sim.craft.throttle > 0 || steering) sim.timeWarp = 1;
}

// ---- crash / landing banner ----
const banner = document.createElement("div");
banner.style.cssText = "position:absolute;top:120px;left:50%;transform:translateX(-50%);z-index:8;" +
  "font:700 30px system-ui,sans-serif;padding:14px 28px;border-radius:12px;display:none;" +
  "text-align:center;pointer-events:none;box-shadow:0 6px 30px rgba(0,0,0,.5);";
document.body.appendChild(banner);

const mapHint = document.createElement("div");
mapHint.style.cssText = "position:absolute;bottom:14px;left:50%;transform:translateX(-50%);z-index:8;" +
  "font:600 13px system-ui,sans-serif;color:#cfe0ff;background:rgba(10,16,30,0.72);" +
  "padding:7px 14px;border-radius:9px;display:none;pointer-events:none;white-space:nowrap;";
mapHint.innerHTML = "🗺️ Map view — scroll or press <b>−</b> to zoom out and find the planets · <b>+</b> to zoom in";
document.body.appendChild(mapHint);
function updateMapHint() {
  mapHint.style.display = (sim.mode === "flight" && mapView) ? "block" : "none";
}

const LANDED_LINES = {
  earth: "🛬 LANDED",
  moon: "🌙 ON THE MOON",
  mercury: "🪨 ON MERCURY",
  venus: "🌋 ON VENUS",
  mars: "🔴 ON MARS",
  io: "🌋 ON IO",
  europa: "🧊 ON EUROPA",
  ganymede: "🪐 ON GANYMEDE",
  callisto: "🎯 ON CALLISTO",
  titan: "🟠 ON TITAN",
};

function updateBanner() {
  const crew = sim.crew ? sim.crew.name : "Your Connie";
  if (sim.mode === "flight" && sim.status === "crashed") {
    banner.style.display = "block";
    banner.style.background = "rgba(140,24,24,0.9)"; banner.style.color = "#ffd6d6";
    let where;
    if (sim.sankIntoClouds) {
      const g = BODIES[sim.crashedInto];
      where = "🌀 SANK INTO " + (g ? g.name.toUpperCase() : "THE") + "'S CLOUDS — GAS GIANTS HAVE NO GROUND";
    } else if (sim.burnedUp && sim.crashedInto === "sun") {
      where = "☀️ MELTED BY THE SUN";
    } else if (sim.burnedUp) {
      where = "🔥 BURNED UP ON REENTRY";
    } else if (sim.crashedInto && sim.crashedInto !== "earth") {
      const b = BODIES[sim.crashedInto];
      where = "CRASHED INTO " + (b ? b.name.toUpperCase() : "THE GROUND");
    } else {
      where = "CRASHED";
    }
    banner.innerHTML = "💥 " + where + "<br><span style='font-size:14px;font-weight:400'>" +
      crew + " boinged away safely in the escape bubble — Connies always do. Press Reset to try again</span>";
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
    const sub = bodyKey === "earth"
      ? "Gentle touchdown! " + crew + " slithers out, happy."
      : crew + " is out on the surface — a snake on another world! Throttle up to fly home.";
    banner.innerHTML = head + "<br><span style='font-size:14px;font-weight:400'>" + sub + "</span>";
  } else {
    banner.style.display = "none";
  }
}

// ---- one-shot flight callouts (SOI entries, orbit goals, arrivals) ----
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
        copilotSay("☀️ <b>You've escaped Earth — cut your engine (X) now!</b> You're not falling around Earth anymore — you're a tiny planet, orbiting the SUN. Don't keep burning or you'll fly past everything: coast, zoom the map way out, and wait for the gold <b>Burn</b> marker. When it comes around, THAT's your moment to head for " + (BODIES[sim.target] ? BODIES[sim.target].name : "your target") + ". (Time-warp with <b>.</b> — space trips take patience!)");
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
    copilotSay("🛰️ You're in orbit around <b>" + b + "</b>! Periapsis " + (sim.orbit.periapsis / 1000).toFixed(0) +
      " km, apoapsis " + (sim.orbit.apoapsis / 1000).toFixed(0) + " km. " +
      (BODIES[b.toLowerCase()] && !BODIES[b.toLowerCase()].solid
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
    copilotSay("🔥 <b>Reentry!</b> You're hitting the air so fast it's turning to glowing plasma around the ship — that orange fire is real physics (speed + air = heat). Come in at a shallow angle so the air slows you gently. Too steep and too fast… the ship burns up. This is why real capsules have heat shields!");
  }
  // Touchdowns.
  if (sim.status === "landed" && sim.landed && !announced.landed[sim.landed.body]) {
    announced.landed[sim.landed.body] = true;
    const crew = sim.crew ? sim.crew.name : "Your Connie";
    const key = sim.landed.body;
    if (key === "earth") {
      copilotSay("🛬 Gentle touchdown back on Earth — nicely flown. " + crew + " is out beside the ship, taking a bow.");
    } else {
      const name = BODIES[key] ? BODIES[key].name : key;
      const fact = WORLD_FACTS[name] ? " " + WORLD_FACTS[name] : "";
      copilotSay("🏁 <b>You landed on " + name + "!</b> " + crew +
        " is out of the capsule, standing on another world — look beside your ship!" + fact +
        " If you've still got fuel, throttle up (Z, then ↑) to lift off again.");
    }
  }
  // Crashes.
  if (sim.status === "crashed" && !announced.crashed) {
    announced.crashed = true;
    const crew = sim.crew ? sim.crew.name : "Your Connie";
    if (sim.sankIntoClouds) {
      const g = BODIES[sim.crashedInto];
      copilotSay("🌀 The ship sank into <b>" + (g ? g.name : "the planet") + "'s</b> clouds and was crushed — gas giants have no surface at all, just air that gets thicker and thicker forever. " + crew + "'s escape bubble bounced back out, naturally. Orbit them, admire them… just don't try to park on them!");
    } else if (sim.burnedUp && sim.crashedInto === "sun") {
      copilotSay("☀️💥 You flew into the SUN. It's 5,500°C at the surface — nothing survives that. " + crew + " boinged away at the last second, slightly toasted. Fun fact: it actually takes MORE fuel to fall into the Sun than to escape the solar system!");
    } else if (sim.burnedUp) {
      copilotSay("🔥💥 The ship <b>burned up on reentry</b> — too fast and too steep, and the air-friction heat won. " + crew + "'s escape bubble popped out in time, as always. Next time skim the top of the air so it slows you a little at a time — real capsules survive with heat shields and a precise entry angle.");
    } else if (sim.crashedInto && sim.crashedInto !== "earth") {
      const b = BODIES[sim.crashedInto];
      copilotSay("💥 We hit " + (b ? b.name : "the surface") + " too hard. " + (b && !b.atmosphere ? "No air here to slow you — you have to burn the engine to brake all the way down. " : "") + "Hit Reset and try a slower descent.");
    } else {
      copilotSay("💥 We hit the ground. Hit Reset, then try a gentler tilt — go straight up first, then lean over slowly once you're high up.");
    }
  }
}

// ---- game loop ----
let last = 0;
let courseTimer = 0;
function frame(t) {
  const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
  last = t;

  if (sim.mode === "flight" && sim.status !== "crashed") {
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

  Render.update(sim);
  updateBanner();
  updateMapHint();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
