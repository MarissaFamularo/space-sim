// exploration.js — Patrick's Exploration Mode.
//
// The loop deliberately uses the ships that already exist in the simulation:
//   powered satellite scan -> robot probe landing -> laser sample -> crewed colony.
// Science is a lifetime score, not a currency that gets consumed. Reaching a tech's
// threshold permanently makes its rocket part available in the VAB/Hangar, matching
// the Astronaut Complex's existing "science recruits" rule.

// The pure helpers at the top are node-tested. The DOM controller at the bottom owns
// only this mode's overlay and its own new, garbage-tolerant localStorage record.

export const EXPLORATION_KEY = "spacesim.exploration.v1";

export const EXPLORATION_TECH = Object.freeze([
  { id: "orbital_scanner", name: "Orbital Survey Scanner", icon: "🛰", science: 20,
    job: "Sharper surface scans and a bigger scan reward." },
  { id: "laser_gauntlet", name: "Laser Gauntlet", icon: "⚡", science: 45,
    job: "Fires a small sampling laser at a small world from orbit or the surface." },
  { id: "colony_habitat", name: "Colony Habitat", icon: "🏠", science: 80,
    job: "A pressurized home for the first Connie colonists." },
  { id: "colony_greenhouse", name: "Colony Greenhouse", icon: "🌱", science: 120,
    job: "Closes the food-and-air loop so a colony can be founded." },
]);

export function isTechUnlocked(id, science) {
  const tech = EXPLORATION_TECH.find((t) => t.id === id);
  return !!tech && Math.max(0, Number(science) || 0) >= tech.science;
}

function hashText(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const RESOURCE_NAMES = Object.freeze([
  "water ice", "iron and nickel", "silicates", "carbon compounds",
  "rare crystals", "radioactive minerals", "buried brines", "aluminum ores",
]);
export const QUALITY_NAMES = Object.freeze(["", "SPARSE", "MODEST", "USEFUL", "RICH", "EXTRAORDINARY"]);

// A deterministic game survey, not a claim about real mineral abundance. The same
// system + world always gives the same answer and every result remains bounded 1..5.
export function resourceProfile(systemId, body) {
  if (!body || !body.key || !body.solid) return null;
  const h = hashText(String(systemId || "sol") + ":" + body.key);
  let quality = 1 + (h % 5);
  // Small airless worlds preserve old impact material at the surface, making them
  // slightly better laser/probe targets in this game's exploration fiction.
  if (!body.atmosphere && body.tinyMoon) quality++;
  quality = Math.max(1, Math.min(5, quality));
  const a = RESOURCE_NAMES[(h >>> 3) % RESOURCE_NAMES.length];
  let b = RESOURCE_NAMES[(h >>> 11) % RESOURCE_NAMES.length];
  if (b === a) b = RESOURCE_NAMES[(RESOURCE_NAMES.indexOf(a) + 3) % RESOURCE_NAMES.length];
  return { quality, label: QUALITY_NAMES[quality], resources: [a, b] };
}

export function isSmallWorld(body, homeRadius) {
  if (!body || !body.solid || !Number.isFinite(body.radius)) return false;
  const ref = Number(homeRadius) || body.radius;
  return !!body.tinyMoon || body.radius <= ref * 0.45;
}

export function scienceYield(kind, quality, sharpScan = false) {
  const q = Math.max(1, Math.min(5, Math.round(Number(quality) || 1)));
  if (kind === "scan") return 4 + q + (sharpScan ? 3 : 0);
  if (kind === "probe") return 10 + q * 5;
  if (kind === "laser") return 8 + q * 4;
  if (kind === "colony") return 20 + q * 6;
  return 0;
}

export function emptyExplorationSave() {
  return { v: 1, scans: {}, probes: {}, laserSamples: {}, colonies: {} };
}

export function parseExplorationSave(raw) {
  let data;
  try { data = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { return emptyExplorationSave(); }
  const out = emptyExplorationSave();
  if (!data || data.v !== 1 || typeof data !== "object") return out;
  for (const field of ["scans", "probes", "laserSamples", "colonies"]) {
    const src = data[field];
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    for (const [key, val] of Object.entries(src)) {
      if (/^[a-z0-9_:@.-]{1,100}$/i.test(key) && val === true) out[field][key] = true;
    }
  }
  return out;
}

function loadSave() {
  try { return parseExplorationSave(localStorage.getItem(EXPLORATION_KEY)); }
  catch { return emptyExplorationSave(); }
}
function saveState(state) {
  try { localStorage.setItem(EXPLORATION_KEY, JSON.stringify(state)); } catch {}
}

let handlers = {};
let screen = null;

function worldId(ctx, key) { return String(ctx.systemId || "sol") + ":" + key; }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function button(label, enabled, reason, action, accent = false) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;";
  const b = document.createElement("button");
  b.textContent = label;
  b.disabled = !enabled;
  b.style.cssText = "padding:8px 10px;font-weight:800;border-radius:8px;" +
    (accent ? "background:#5a3ab0;border-color:#9b7cff;" : "") +
    (!enabled ? "opacity:.42;cursor:not-allowed;" : "");
  if (enabled) b.onclick = action;
  wrap.appendChild(b);
  if (!enabled && reason) {
    const why = document.createElement("div");
    why.textContent = reason;
    why.style.cssText = "font-size:10px;color:#7182aa;line-height:1.25;max-width:180px;";
    wrap.appendChild(why);
  }
  return wrap;
}

function award(kind, points, body, quality) {
  if (handlers.awardScience) handlers.awardScience(kind, points, body, quality);
}

function laserFlash(bodyName, done) {
  if (!screen) { done(); return; }
  const flash = document.createElement("div");
  flash.style.cssText = "position:absolute;inset:0;z-index:3;background:rgba(3,5,14,.93);" +
    "display:flex;align-items:center;justify-content:center;overflow:hidden;";
  flash.innerHTML = `<div style="position:relative;width:min(760px,90vw);height:300px;">
    <div style="position:absolute;left:7%;top:118px;font-size:70px;filter:drop-shadow(0 0 18px #9b7cff);">⚡</div>
    <div style="position:absolute;left:18%;right:30%;top:151px;height:6px;background:#e8d8ff;box-shadow:0 0 10px #fff,0 0 28px #9b4dff;transform-origin:left;animation:expBeam .7s ease-out both;"></div>
    <div style="position:absolute;right:7%;top:55px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#9c8d7d,#4b3e39 55%,#16121a);box-shadow:0 0 40px #7046b0;"></div>
    <div style="position:absolute;right:4%;top:245px;width:220px;text-align:center;font-size:18px;font-weight:900;color:#e8d8ff;">SAMPLING ${esc(bodyName).toUpperCase()}</div>
  </div>`;
  screen.appendChild(flash);
  setTimeout(() => { flash.remove(); done(); }, 800);
}

function show() {
  hide();
  const ctx = handlers.getContext ? handlers.getContext() : null;
  if (!ctx) return;
  const state = loadSave();
  screen = document.createElement("div");
  screen.style.cssText = "position:absolute;inset:0;z-index:35;background:radial-gradient(100% 90% at 50% 100%,#14223f 0%,#080d1b 55%,#03050c 100%);" +
    "color:#e8eefc;font-family:system-ui,-apple-system,sans-serif;overflow:auto;padding:28px clamp(16px,4vw,52px);";
  screen.innerHTML = `<style>
    @keyframes expBeam { from { transform:scaleX(0);opacity:0 } 25% {opacity:1} to {transform:scaleX(1);opacity:1} }
    .exp-tech { background:rgba(18,28,51,.9);border:1px solid #2d416b;border-radius:12px;padding:11px;min-height:98px; }
    .exp-world { background:rgba(12,19,37,.9);border:1px solid #263b64;border-radius:14px;padding:14px; }
  </style>`;
  const head = document.createElement("div");
  head.style.cssText = "display:flex;gap:16px;justify-content:space-between;align-items:flex-start;max-width:1220px;margin:0 auto 18px;";
  head.innerHTML = `<div><div style="font-size:clamp(27px,4vw,46px);font-weight:950;letter-spacing:.04em;background:linear-gradient(180deg,#fff,#8ec5ff);background-clip:text;color:transparent;">🔭 EXPLORATION MODE</div>
    <div style="color:#9fb3da;margin-top:5px;">Scan first. Send robots to the best worlds. Then build a colony worth the trip.</div></div>
    <div style="background:#172746;border:1px solid #42669e;border-radius:999px;padding:9px 16px;white-space:nowrap;">🔬 <b>${ctx.science}</b> lifetime science</div>`;
  screen.appendChild(head);

  const techTitle = document.createElement("div");
  techTitle.style.cssText = "max-width:1220px;margin:0 auto 8px;font-size:13px;font-weight:900;letter-spacing:.09em;color:#8fb2df;";
  techTitle.textContent = "SCIENCE PARTS — UNLOCK AUTOMATICALLY, SCIENCE IS NEVER SPENT";
  screen.appendChild(techTitle);
  const techGrid = document.createElement("div");
  techGrid.style.cssText = "max-width:1220px;margin:0 auto 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;";
  for (const tech of EXPLORATION_TECH) {
    const open = isTechUnlocked(tech.id, ctx.science);
    const d = document.createElement("div");
    d.className = "exp-tech";
    d.style.borderColor = open ? "#3f9f77" : "#2d416b";
    d.innerHTML = `<div style="font-size:20px;">${tech.icon} <b>${esc(tech.name)}</b> ${open ? '<span style="color:#5be39c;font-size:12px;">✓ COLLECTED</span>' : ''}</div>
      <div style="font-size:12px;color:#9fb3da;margin:5px 0;">${esc(tech.job)}</div>
      <div style="font-size:11px;color:${open ? "#5be39c" : "#ffd36a"};font-weight:800;">${open ? "Waiting in the parts palette" : `🔒 ${tech.science} science · ${Math.max(0, tech.science - ctx.science)} to go`}</div>`;
    techGrid.appendChild(d);
  }
  screen.appendChild(techGrid);

  const missionTitle = document.createElement("div");
  missionTitle.style.cssText = "max-width:1220px;margin:0 auto 8px;font-size:13px;font-weight:900;letter-spacing:.09em;color:#8fb2df;";
  missionTitle.textContent = "SURVEY BOARD — " + ctx.systemName.toUpperCase();
  screen.appendChild(missionTitle);
  const worlds = document.createElement("div");
  worlds.style.cssText = "max-width:1220px;margin:0 auto 80px;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;";

  for (const body of ctx.bodies.filter((b) => b.solid)) {
    const wid = worldId(ctx, body.key);
    const scanned = !!state.scans[wid];
    const probed = !!state.probes[wid];
    const sampled = !!state.laserSamples[wid];
    const colonized = !!state.colonies[wid];
    const profile = resourceProfile(ctx.systemId, body);
    const sat = ctx.satellites.find((s) => s.bodyKey === body.key && s.hasPower);
    const sharp = !!(sat && sat.hasScanner);
    const here = ctx.currentBodyKey === body.key;
    const small = isSmallWorld(body, ctx.homeRadius);
    const hasLaser = ctx.partIds.includes("laser_gauntlet") && isTechUnlocked("laser_gauntlet", ctx.science);
    const colonyKit = ctx.partIds.includes("colony_habitat") && ctx.partIds.includes("colony_greenhouse");
    const card = document.createElement("div");
    card.className = "exp-world";
    if (here) card.style.borderColor = "#ffd36a";
    const bars = scanned ? "▮".repeat(profile.quality) + "▯".repeat(5 - profile.quality) : "?????";
    card.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:start;">
      <div><div style="font-size:20px;font-weight:900;">${small ? "🪨" : "🪐"} ${esc(body.name)}</div>
      <div style="font-size:11px;color:#7182aa;">${small ? "SMALL-WORLD LASER TARGET" : "SOLID WORLD"}${here ? " · YOUR SHIP IS HERE" : ""}</div></div>
      ${colonized ? '<div style="color:#63e6a5;font-weight:900;">🏕 COLONY</div>' : ''}</div>
      <div style="margin:10px 0;padding:9px;background:#091020;border-radius:9px;">
        <div style="font-size:12px;color:#8ba5cb;">RESOURCE SIGNAL</div>
        <div style="font-size:20px;letter-spacing:.08em;color:${scanned ? "#70d6ff" : "#64708b"};font-weight:900;">${bars}</div>
        <div style="font-size:12px;color:#b7c8e8;min-height:34px;">${scanned ? `<b>${profile.label}</b> · ${esc(profile.resources.join(" + "))}` : "Unknown — put a powered satellite in orbit to look beneath the surface."}</div>
      </div>`;
    const actions = document.createElement("div");
    actions.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-items:start;";
    actions.appendChild(button(scanned ? "✓ Surface scanned" : "🛰 Scan surface", !scanned && !!sat,
      sat ? "Already scanned" : "Needs a powered satellite orbiting this world",
      () => {
        state.scans[wid] = true; saveState(state);
        award("scan", scienceYield("scan", profile.quality, sharp), body, profile.quality); show();
      }));
    actions.appendChild(button(probed ? "✓ Probe report" : "🤖 Log probe landing", scanned && !probed && here && ctx.status === "landed" && ctx.isProbe,
      !scanned ? "Scan it first" : !here || ctx.status !== "landed" ? "Land here with a Probe Core" : !ctx.isProbe ? "This must be an uncrewed robot mission" : "Already logged",
      () => {
        state.probes[wid] = true; saveState(state);
        award("probe", scienceYield("probe", profile.quality), body, profile.quality); show();
      }));
    actions.appendChild(button(sampled ? "✓ Laser sample" : "⚡ Fire laser gauntlet", scanned && !sampled && small && here && hasLaser && (ctx.status === "landed" || ctx.status === "orbit" || ctx.status === "flying"),
      !small ? "The gauntlet is calibrated only for small worlds" : !isTechUnlocked("laser_gauntlet", ctx.science) ? "Unlocks at 45 science" : !hasLaser ? "Bring the Laser Gauntlet part" : !here ? "Fly the gauntlet here first" : !scanned ? "Scan it first" : "Already sampled",
      () => laserFlash(body.name, () => {
        state.laserSamples[wid] = true; saveState(state);
        award("laser", scienceYield("laser", profile.quality), body, profile.quality); show();
      }), true));
    actions.appendChild(button(colonized ? "✓ Colony founded" : "🏕 Found colony", scanned && probed && !colonized && here && ctx.status === "landed" && ctx.hasCrew && colonyKit,
      !probed ? "Scan it and land a probe first" : !here || ctx.status !== "landed" ? "Land a crewed colony ship here" : !ctx.hasCrew ? "A Connie crew must be aboard" : !colonyKit ? "Bring both Colony Habitat + Greenhouse" : "Already founded",
      () => {
        state.colonies[wid] = true; saveState(state);
        award("colony", scienceYield("colony", profile.quality), body, profile.quality); show();
      }));
    card.appendChild(actions);
    worlds.appendChild(card);
  }
  screen.appendChild(worlds);

  const foot = document.createElement("div");
  foot.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2;display:flex;justify-content:center;gap:10px;padding:12px;background:rgba(4,7,15,.94);border-top:1px solid #263b64;";
  const back = document.createElement("button"); back.textContent = "⬅ Space Center"; back.style.padding = "10px 18px";
  back.onclick = () => { hide(); if (handlers.onExit) handlers.onExit(); };
  const build = document.createElement("button"); build.textContent = "🔧 Build an exploration ship"; build.style.cssText = "padding:10px 18px;background:#245d49;border-color:#3f9f77;font-weight:900;";
  build.onclick = () => { hide(); if (handlers.onBuild) handlers.onBuild(); };
  foot.append(back, build); screen.appendChild(foot);
  document.getElementById("app").appendChild(screen);
}

function hide() { if (screen) { screen.remove(); screen = null; } }

export const Exploration = Object.freeze({
  init(h) { handlers = h || {}; },
  show,
  hide,
  isOpen() { return !!screen; },
});
