// main.js — PM-owned glue. Boots modules, runs the game loop, switches build<->flight,
// drives flight controls (steer / throttle / stage / time-warp), detects the orbit goal,
// and wires the copilot. Integrates physics.js + render.js + builder.js against the contract.

// PARTS comes from mods.js: the stock catalog (parts.js, pristine on disk) merged with the
// kid's saved overrides + custom parts. Same array shape; edits mutate it in place.
import { PARTS } from "./mods.js";
import { BODIES, newCraft, newSimState, computeStats, findPart } from "./state.js";
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
// one-shot copilot callouts per flight
let announced = { orbit: false, crashed: false, landed: false, moonSoi: false, moonOrbit: false, reentry: false, transferBurn: false };

// ---- propulsion for a given stage (integration owns this; physics reads the live fields) ----
// stageNum active = engines/tanks whose PartInstance.stage === stageNum fire & feed.
// Remaining mass = every part at stage >= stageNum (upper stages still full of fuel).
function activeStage(craft, stageNum) {
  let thrust = 0, veSum = 0, engines = 0, stageFuel = 0, remainingMass = 0, chutes = 0;
  for (const inst of craft.parts) {
    const def = findPart(PARTS, inst.partId);
    if (!def) continue;
    if (inst.stage >= stageNum) {
      remainingMass += (def.dryMass || 0) + (def.fuelMass || 0);
      if (def.type === "chute") chutes++; // chutes still attached (not dropped with a spent stage)
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
  // Can this stage even lift its own weight off the pad? (thrust kN vs weight kN)
  sim.stageWeightKN = s.remainingMass * BODIES.earth.g0;
  sim.cantLiftOff = s.thrust <= sim.stageWeightKN;
}

// Deploy the parachute (P key, or auto low over Earth). Teaches: chutes need AIR.
function deployChute(auto) {
  if (sim.mode !== "flight" || sim.craft.chuteDeployed) return;
  if ((sim.craft.chuteCount || 0) === 0) {
    if (!auto) copilotSay("No parachute on this rocket! Add one on top of the command pod next time — it makes coming home to Earth easy.");
    return;
  }
  sim.craft.chuteDeployed = true;
  if (sim.soi === "Moon")
    copilotSay("☂ Parachute deployed… but nothing happens. The Moon has <b>no air</b> — a parachute needs air to push against! Here you land the Apollo way: brake with your engine.");
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
  sim = newSimState(BODIES.earth);
  sim.mode = "flight"; sim.status = "flying"; sim.craft.throttle = 1; sim.timeWarp = 1;
  sim.crew = pickConnie(); // a Connie climbs aboard for every flight
  mapView = false; // start each flight in follow-cam
  announced = { orbit: false, crashed: false, landed: false, moonSoi: false, moonOrbit: false, reentry: false, transferBurn: false };
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
  // Clear the rocket IN PLACE (don't swap in a new object) so the Builder keeps the same
  // reference, then re-bind the Builder to it. Avoids the split where the list shows the old
  // rocket but a different empty craft gets rendered/flown.
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
  // Visually drop spent parts: rebuild the mesh from the parts still attached.
  const remaining = { name: craft.name, parts: craft.parts.filter((i) => (i.stage || 0) >= next) };
  Render.buildCraftMesh(remaining);
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
});
wireCopilot();
Copilot.initSettings();
enterBuild();
copilotSay("Hi! I'm your navigator. Build a rocket on the left, hit Launch, then use the arrow keys to steer. Ask me anything.");

// ---- copilot input ----
function wireCopilot() {
  const input = document.getElementById("copilot-input");
  const send = document.getElementById("copilot-send");
  const log = document.getElementById("copilot-log");
  const addYou = (txt) => { const d = document.createElement("div"); d.className = "you";
    d.innerHTML = "<b>You:</b> " + txt; log.appendChild(d); log.scrollTop = log.scrollHeight; };
  async function go() {
    const q = input.value.trim(); if (!q) return; input.value = "";
    input.blur(); // hand keyboard focus back to the game so flight keys (M, arrows…) work
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
  if (e.target && e.target.tagName === "INPUT") return; // don't hijack the navigator box
  keys[e.key] = true;
  if (e.repeat) return; // one-shot actions below must not fire on held-key auto-repeat
  if (e.key === " ") { e.preventDefault(); doStage(); }
  if (e.key === "z" || e.key === "Z") sim.craft.throttle = 1;
  if (e.key === "x" || e.key === "X") sim.craft.throttle = 0;
  if (e.key === ".") setWarp(sim.timeWarp * 2);
  if (e.key === ",") setWarp(sim.timeWarp / 2);
  if (e.key === "m" || e.key === "M") { mapView = !mapView; Render.setFlightView(mapView ? "map" : "follow"); }
  if (e.key === "p" || e.key === "P") deployChute(false);
});
window.addEventListener("keyup", (e) => { keys[e.key] = false; });
function setWarp(w) { sim.timeWarp = Math.max(1, Math.min(100, Math.round(w))); }

function applyControls(dt) {
  if (sim.mode !== "flight" || sim.status === "crashed") return;
  const STEER = 0.7, THR = 0.8; // rad/s, fraction/s
  let steering = false;
  if (keys["ArrowLeft"] || keys["a"]) { sim.craft.angle += STEER * dt; steering = true; }
  if (keys["ArrowRight"] || keys["d"]) { sim.craft.angle -= STEER * dt; steering = true; }
  if (keys["ArrowUp"]) { sim.craft.throttle = Math.min(1, sim.craft.throttle + THR * dt); }
  if (keys["ArrowDown"]) { sim.craft.throttle = Math.max(0, sim.craft.throttle - THR * dt); }
  // Map zoom with +/- (smooth while held). Zoom out to pull back to the Earth-Moon system.
  if (mapView) {
    if (keys["="] || keys["+"]) Render.zoomMap(Math.exp(-2.2 * dt)); // zoom in
    if (keys["-"] || keys["_"]) Render.zoomMap(Math.exp(2.2 * dt));  // zoom out (find the Moon)
  }
  // Time warp only makes sense while coasting; thrusting or steering snaps back to real time.
  if (sim.craft.throttle > 0 || steering) sim.timeWarp = 1;
}

// ---- crash / landing banner ----
const banner = document.createElement("div");
banner.style.cssText = "position:absolute;top:120px;left:50%;transform:translateX(-50%);z-index:8;" +
  "font:700 30px system-ui,sans-serif;padding:14px 28px;border-radius:12px;display:none;" +
  "text-align:center;pointer-events:none;box-shadow:0 6px 30px rgba(0,0,0,.5);";
document.body.appendChild(banner);

// Map-view hint so the zoom is discoverable (the tester couldn't find the Moon otherwise).
const mapHint = document.createElement("div");
mapHint.style.cssText = "position:absolute;bottom:14px;left:50%;transform:translateX(-50%);z-index:8;" +
  "font:600 13px system-ui,sans-serif;color:#cfe0ff;background:rgba(10,16,30,0.72);" +
  "padding:7px 14px;border-radius:9px;display:none;pointer-events:none;white-space:nowrap;";
mapHint.innerHTML = "🗺️ Map view — scroll or press <b>−</b> to zoom out and find the Moon · <b>+</b> to zoom in";
document.body.appendChild(mapHint);
function updateMapHint() {
  mapHint.style.display = (sim.mode === "flight" && mapView) ? "block" : "none";
}

function updateBanner() {
  const onMoon = sim.landed && sim.landed.body === "moon";
  const crew = sim.crew ? sim.crew.name : "Your Connie";
  if (sim.mode === "flight" && sim.status === "crashed") {
    banner.style.display = "block";
    banner.style.background = "rgba(140,24,24,0.9)"; banner.style.color = "#ffd6d6";
    const where = sim.burnedUp ? "🔥 BURNED UP ON REENTRY" : (sim.soi === "Moon" ? "CRASHED INTO THE MOON" : "CRASHED");
    banner.innerHTML = "💥 " + where + "<br><span style='font-size:14px;font-weight:400'>" +
      crew + " boinged away safely in the escape bubble — Connies always do. Press Reset to try again</span>";
  } else if (sim.mode === "flight" && sim.status === "flying" && sim.cantLiftOff && sim.altitude < 5 && sim.speed < 2) {
    // Sitting on the pad, engines lit, going nowhere: SAY SO loudly — this looked like
    // "the launch button is broken" to the first playtesters.
    banner.style.display = "block";
    banner.style.background = "rgba(150,105,20,0.92)"; banner.style.color = "#ffedc4";
    banner.innerHTML = (sim.craft.thrust <= 0 ? "🚫 NO ENGINE ON STAGE 1" : "🪨 TOO HEAVY TO LIFT OFF") +
      "<br><span style='font-size:14px;font-weight:400'>Push: " + Math.round(sim.craft.thrust) +
      " kN &nbsp;vs&nbsp; weight: " + Math.round(sim.stageWeightKN || 0) + " kN — push must win!" +
      " Hit <b>Build</b> and drop a tank or add an engine.</span>";
  } else if (sim.mode === "flight" && sim.status === "landed") {
    banner.style.display = "block";
    banner.style.background = "rgba(22,96,44,0.9)"; banner.style.color = "#d6ffe0";
    banner.innerHTML = onMoon
      ? "🌙 ON THE MOON<br><span style='font-size:14px;font-weight:400'>" + crew + " is out on the surface — a snake on another world! Throttle up to fly home.</span>"
      : "🛬 LANDED<br><span style='font-size:14px;font-weight:400'>Gentle touchdown! " + crew + " slithers out, happy.</span>";
  } else {
    banner.style.display = "none";
  }
}

// ---- game loop ----
let last = 0;
function frame(t) {
  const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
  last = t;

  if (sim.mode === "flight" && sim.status !== "crashed") {
    applyControls(dt);
    if (dt > 0) Physics.step(sim, dt * sim.timeWarp); // physics sub-steps internally for warp

    // Moon-transfer phasing: null unless we're in a stable CCW Earth orbit still well below
    // the Moon. render (Burn marker + gold arrow) and the copilot snapshot both read this.
    sim.transfer = Physics.transferWindow(sim);
    // The moment the phasing comes right, say so ONCE — this is Apollo's translunar
    // injection call ("go for TLI"), and the whole trick of getting to the Moon.
    if (sim.transfer && sim.transfer.open && !announced.transferBurn) {
      announced.transferBurn = true;
      copilotSay("🌙 <b>Transfer window open — burn NOW!</b> The Moon is leading you by just the right angle (" +
        Math.round(sim.transfer.leadAngle_deg) + "°), so if you burn <i>prograde</i> — the gold arrow is riding your green arrow now — " +
        "and keep burning until your apoapsis stretches out to the Moon's distance (" + Math.round(BODIES.moon.orbitRadius / 1000) +
        " km), you and the Moon will arrive at the same spot together. Then cut the engine and coast. Apollo timed this exact moment and called it <b>translunar injection</b>.");
    }

    if (sim.status === "orbit" && sim.orbit && sim.orbit.bodyName === "Earth" && !announced.orbit) {
      announced.orbit = true;
      copilotSay("🎉 You're in a stable orbit! You just fell <i>around</i> the planet instead of back into it — that's exactly how real spacecraft stay up. Apoapsis " +
        (sim.orbit.apoapsis / 1000).toFixed(0) + " km, periapsis " + (sim.orbit.periapsis / 1000).toFixed(0) + " km. To go to the Moon, raise your apoapsis (burn prograde — your green arrow) until your orbit stretches out to the Moon.");
    }
    // Crossed into the Moon's sphere of influence — the Moon now runs the show.
    if (sim.soi === "Moon" && !announced.moonSoi) {
      announced.moonSoi = true;
      copilotSay("🌙 You've entered the Moon's <b>sphere of influence</b> — from here the Moon's gravity is in charge, not Earth's. Your orbit readout now measures from the Moon. To get captured into Moon orbit, burn <i>retrograde</i> (opposite the green arrow) near your closest approach.");
    }
    // Captured into a real bound orbit around the Moon.
    if (sim.orbit && sim.orbit.bodyName === "Moon" && sim.orbit.isOrbit && !announced.moonOrbit) {
      announced.moonOrbit = true;
      copilotSay("🛰️ You're in orbit around the <b>Moon</b>! Periapsis " + (sim.orbit.periapsis / 1000).toFixed(0) +
        " km, apoapsis " + (sim.orbit.apoapsis / 1000).toFixed(0) + " km. The Moon has no air, so there's no parachute landing — you brake with the engine. Lower your periapsis, then burn to kill your speed on the way down.");
    }
    // Auto-deploy the chute low over Earth on the way down — the kid shouldn't need to
    // know the P key for his first successful reentry.
    if (!sim.craft.chuteDeployed && (sim.craft.chuteCount || 0) > 0 && sim.soi === "Earth" &&
        sim.status === "flying" && sim.altitude < 2500 && sim.speed < 240) {
      const c = sim.craft;
      const vr = (c.vel.x * c.pos.x + c.vel.y * c.pos.y); // >0 climbing, <0 descending
      if (vr < 0) deployChute(true);
    }
    // Reentry plasma — call it out the first time the hull starts glowing.
    if ((sim.heat || 0) > 0.25 && !announced.reentry) {
      announced.reentry = true;
      copilotSay("🔥 <b>Reentry!</b> You're hitting the air so fast it's turning to glowing plasma around the ship — that orange fire is real physics (speed + air = heat). Come in at a shallow angle so the air slows you gently. Too steep and too fast… the ship burns up. This is why real capsules have heat shields!");
    }
    if (sim.status === "landed" && !announced.landed) {
      announced.landed = true;
      if (sim.landed && sim.landed.body === "moon")
        copilotSay("🌙🏁 <b>You landed on the Moon!</b> " + (sim.crew ? sim.crew.name : "Your Connie") +
          " is out of the capsule, standing on the surface — look beside your ship! You braked with the engine and touched down softly on another world, exactly what Apollo did in 1969. If you've still got fuel, throttle up (Z, then ↑) to lift off and fly home.");
      else
        copilotSay("🛬 Gentle touchdown back on Earth — nicely flown. " + (sim.crew ? sim.crew.name : "Your Connie") + " is out beside the ship, taking a bow.");
    }
    if (sim.status === "crashed" && !announced.crashed) {
      announced.crashed = true;
      if (sim.burnedUp)
        copilotSay("🔥💥 The ship <b>burned up on reentry</b> — you came into the atmosphere too fast and too steep, and the air-friction heat won. " +
          (sim.crew ? sim.crew.name : "Your Connie") + "'s escape bubble popped out in time, as always. Next time try a shallower path: skim the top of the air so it slows you a little at a time. Real capsules survive this with heat shields and careful entry angles — Apollo hit the air at a precise angle for exactly this reason.");
      else if (sim.soi === "Moon")
        copilotSay("💥 We hit the Moon too hard. The Moon has no air to slow you, so you have to burn the engine to brake all the way down. Hit Reset and try a slower descent.");
      else
        copilotSay("💥 We hit the ground. Hit Reset, then try a gentler tilt — go straight up first, then lean over slowly once you're high up.");
    }
    UI.renderStats(null, sim);
  }

  Render.update(sim);
  updateBanner();
  updateMapHint();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
