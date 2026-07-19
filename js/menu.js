// menu.js — Konnie Space Program's front door: the title screen, the settings panel,
// and the KONNIE SPACE CENTER (his ask): a place on Earth with real buildings — the
// Tracking Center, the VAB, the Space Plane Hangar, Space School, and the 🧑‍🚀
// Astronaut Complex — each one a door into a game mode. Pure DOM/SVG overlays on top
// of the running 3D scene; owns no game state (crew picks live in connies.js's key).
//
// API (used by main.js):
//   Menu.init({ onVAB, onHangar, onTracking, onSchool, onSettingsChange, getScience })
//   Menu.showTitle() / Menu.showCenter() / Menu.hideAll()
//   Menu.getSettings() -> { graphics: "fancy"|"fast" }

import { CONNIES, isUnlocked, loadCrewPicks, saveCrewPicks } from "./connies.js";

const SETTINGS_KEY = "spacesim.settings.v1";
// Same localStorage slot copilot.js uses for the Navigator's Anthropic key.
const NAV_KEY = "spacesim_anthropic_key";

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    return { graphics: s.graphics === "fast" ? "fast" : "fancy" };
  } catch { return { graphics: "fancy" }; }
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }

let settings = loadSettings();
let handlers = {};
let titleEl = null, centerEl = null, settingsEl = null, complexEl = null;

// ---- shared bits ----
const CSS = `
  .ksp-screen { position:absolute; inset:0; z-index:30; display:flex; flex-direction:column;
    align-items:center; justify-content:center; overflow:hidden;
    font-family: system-ui, -apple-system, sans-serif; color:#e8eefc; }
  .ksp-stars { position:absolute; inset:0; pointer-events:none; }
  .ksp-stars i { position:absolute; width:2px; height:2px; border-radius:50%;
    background:#fff; animation: kspTwinkle 3s infinite; }
  @keyframes kspTwinkle { 0%,100% {opacity:.9} 50% {opacity:.25} }
  .ksp-title-word { font-weight:900; letter-spacing:.06em; text-align:center; line-height:1.05;
    background:linear-gradient(180deg,#fff 20%,#8db4ff 60%,#4a72d6 100%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
    text-shadow:0 0 40px rgba(90,140,255,.25); }
  .ksp-btn { display:block; width:280px; margin:7px auto; padding:13px 18px; font-size:17px;
    font-weight:700; color:#e8eefc; background:rgba(27,42,74,.92); border:1px solid #3a5590;
    border-radius:12px; cursor:pointer; transition: transform .08s, background .15s; }
  .ksp-btn:hover { background:#2c4478; transform:scale(1.03); }
  .ksp-btn.ksp-primary { background:linear-gradient(180deg,#2f6fdc,#1d47a0); border-color:#5b8dee;
    font-size:20px; }
  .ksp-btn.ksp-primary:hover { background:linear-gradient(180deg,#3c7ff0,#2555b8); }
  .ksp-bld { cursor:pointer; }
  .ksp-bld:hover .ksp-glow { filter:brightness(1.35) drop-shadow(0 0 14px rgba(140,190,255,.8)); }
  .ksp-bld .ksp-glow { transition: filter .12s; }
  .ksp-bld text { pointer-events:none; }
  .ksp-crew-grid { display:grid; grid-template-columns:repeat(4, minmax(170px, 205px));
    gap:12px; justify-content:center; max-height:56vh; overflow-y:auto; padding:4px; }
  @media (max-width: 900px) { .ksp-crew-grid { grid-template-columns:repeat(2, minmax(170px, 205px)); } }
  .ksp-card { position:relative; background:rgba(27,42,74,.92); border:2px solid #3a5590;
    border-radius:14px; padding:12px 10px 10px; text-align:center; cursor:pointer;
    transition: transform .08s, border-color .15s, background .15s; }
  .ksp-card:hover { transform:scale(1.03); background:#243a68; }
  .ksp-card.ksp-picked { border-color:#ffd24a; background:#2c4478;
    box-shadow:0 0 18px rgba(255,210,74,.25); }
  .ksp-card.ksp-locked { cursor:default; }
  .ksp-card.ksp-locked:hover { transform:none; background:rgba(27,42,74,.92); }
  .ksp-card.ksp-locked .ksp-face { filter:grayscale(1) brightness(.45); }
  .ksp-seat-badge { position:absolute; top:-10px; right:-8px; background:#ffd24a; color:#3a2c00;
    font-size:11px; font-weight:900; border-radius:999px; padding:3px 8px;
    box-shadow:0 2px 8px rgba(0,0,0,.5); }
`;
let cssInjected = false;
function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);
}

// Deterministic star sprinkle (no Math.random — same sky every boot, like the game's rule).
function starfield(n = 90) {
  const wrap = document.createElement("div");
  wrap.className = "ksp-stars";
  let x = 123456789;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1000) / 1000; };
  for (let i = 0; i < n; i++) {
    const s = document.createElement("i");
    s.style.left = (rnd() * 100) + "%";
    s.style.top = (rnd() * 100) + "%";
    s.style.opacity = 0.3 + rnd() * 0.7;
    s.style.animationDelay = (rnd() * 3) + "s";
    const sz = rnd() < 0.15 ? 3 : rnd() < 0.5 ? 2 : 1;
    s.style.width = s.style.height = sz + "px";
    wrap.appendChild(s);
  }
  return wrap;
}

function overlay(bg) {
  injectCSS();
  const el = document.createElement("div");
  el.className = "ksp-screen";
  el.style.background = bg;
  document.getElementById("app").appendChild(el);
  return el;
}

// ---- title screen ----
function showTitle() {
  hideAll();
  titleEl = overlay("radial-gradient(120% 90% at 50% 110%, #14264f 0%, #0a1226 45%, #04060f 100%)");
  titleEl.appendChild(starfield());

  const box = document.createElement("div");
  box.style.cssText = "position:relative;text-align:center;";
  box.innerHTML = `
    <div style="font-size:15px;letter-spacing:.5em;color:#9fb3da;margin-bottom:10px;">PRESENTING</div>
    <div class="ksp-title-word" style="font-size:clamp(40px,7vw,84px);">KONNIE<br>SPACE PROGRAM</div>
    <div style="font-size:15px;color:#9fb3da;margin:14px 0 34px;">
      🐍 Real physics. Real planets. Brave snakes. 🚀
    </div>`;
  const start = document.createElement("button");
  start.className = "ksp-btn ksp-primary";
  start.textContent = "▶  START";
  start.onclick = () => showCenter();
  box.appendChild(start);
  const set = document.createElement("button");
  set.className = "ksp-btn";
  set.textContent = "⚙ Settings";
  set.onclick = () => showSettings(titleEl);
  box.appendChild(set);
  titleEl.appendChild(box);

  const foot = document.createElement("div");
  foot.style.cssText = "position:absolute;bottom:18px;left:0;right:0;text-align:center;" +
    "font-size:12px;color:#5f6f97;line-height:1.7;";
  foot.innerHTML = "a Paddy and Mom production<br>" +
    "<span style='font-size:11px;color:#4d5b80;'>inspired by Kerbal Space Program — " +
    "with thanks to its creators for making us love space 🚀</span>";
  titleEl.appendChild(foot);
}

// ---- settings ----
function showSettings(parentEl) {
  if (settingsEl) { settingsEl.remove(); settingsEl = null; }
  settingsEl = document.createElement("div");
  settingsEl.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
    "z-index:40;width:340px;background:rgba(12,18,34,0.97);border:1px solid #3a5590;" +
    "border-radius:14px;padding:20px 22px;box-shadow:0 12px 60px rgba(0,0,0,.6);";
  const h = document.createElement("div");
  h.style.cssText = "font-size:18px;font-weight:800;margin-bottom:14px;";
  h.textContent = "⚙ Settings";
  settingsEl.appendChild(h);

  // Graphics quality — bloom + post-processing on/off (school-laptop mode).
  const gLabel = document.createElement("div");
  gLabel.style.cssText = "font-size:13px;color:#9fb3da;margin-bottom:6px;";
  gLabel.textContent = "Graphics";
  settingsEl.appendChild(gLabel);
  const gRow = document.createElement("div");
  gRow.style.cssText = "display:flex;gap:8px;margin-bottom:16px;";
  const mkG = (val, label, hint) => {
    const b = document.createElement("button");
    b.style.cssText = "flex:1;padding:10px 6px;border-radius:9px;font-size:13px;font-weight:700;" +
      "border:1px solid " + (settings.graphics === val ? "#5b8dee" : "#2f4470") + ";" +
      "background:" + (settings.graphics === val ? "#2c4478" : "#1b2a4a") + ";color:#e8eefc;cursor:pointer;";
    b.innerHTML = label + "<br><span style='font-weight:400;font-size:11px;color:#9fb3da'>" + hint + "</span>";
    b.onclick = () => {
      settings.graphics = val;
      saveSettings(settings);
      if (handlers.onSettingsChange) handlers.onSettingsChange({ ...settings });
      showSettings(parentEl); // re-render with new highlight
    };
    gRow.appendChild(b);
  };
  mkG("fancy", "✨ Fancy", "glow + full effects");
  mkG("fast", "🏃 Fast", "for slower computers");
  settingsEl.appendChild(gRow);

  // Navigator key — same storage slot the in-game 🔑 button uses.
  const nLabel = document.createElement("div");
  nLabel.style.cssText = "font-size:13px;color:#9fb3da;margin-bottom:6px;";
  nLabel.textContent = "Navigator (AI copilot)";
  settingsEl.appendChild(nLabel);
  const nBtn = document.createElement("button");
  const hasNav = (() => { try { return (localStorage.getItem(NAV_KEY) || "").length > 10; } catch { return false; } })();
  nBtn.className = "ksp-btn";
  nBtn.style.cssText = "width:100%;margin:0 0 16px;font-size:14px;";
  nBtn.textContent = hasNav ? "🔑 Navigator key is set — change it" : "🔑 Add the Navigator's key";
  nBtn.onclick = () => {
    let k = null; // some embedded browsers block prompt() — fail soft
    try { k = window.prompt("Paste the Anthropic API key for the Navigator.\n\nIt's stored only in this browser on this computer.", ""); } catch { return; }
    if (k === null) return;
    const t = k.trim();
    if (t) { try { localStorage.setItem(NAV_KEY, t); } catch {} showSettings(parentEl); }
  };
  settingsEl.appendChild(nBtn);

  const back = document.createElement("button");
  back.className = "ksp-btn";
  back.style.cssText = "width:100%;margin:0;";
  back.textContent = "⬅ Back";
  back.onclick = () => { settingsEl.remove(); settingsEl = null; };
  settingsEl.appendChild(back);
  (parentEl || document.getElementById("app")).appendChild(settingsEl);
}

// ---- the Konnie Space Center ----
// Dusk on the home planet: sky, stars up top, ground strip, and the three buildings.
function showCenter() {
  hideAll();
  centerEl = overlay("linear-gradient(180deg,#04060f 0%,#0a1430 34%,#1b2f63 62%,#2c4a86 74%,#0e1a12 74.2%,#0b140e 100%)");
  const stars = starfield(60);
  stars.style.height = "62%";
  centerEl.appendChild(stars);

  const head = document.createElement("div");
  head.style.cssText = "position:absolute;top:26px;left:0;right:0;text-align:center;";
  head.innerHTML = `<div class="ksp-title-word" style="font-size:clamp(26px,4vw,44px);">KONNIE SPACE CENTER</div>
    <div style="font-size:13px;color:#9fb3da;margin-top:6px;">Pick a building — every door goes somewhere.</div>`;
  centerEl.appendChild(head);

  // The campus, as one big SVG: Tracking Center (dish), VAB (tall), Hangar (curved roof),
  // plus a launchpad with a rocket, the flag, and the water tower for flavor.
  const svgWrap = document.createElement("div");
  svgWrap.style.cssText = "width:min(96vw,1280px);margin-top:60px;";
  svgWrap.innerHTML = `
  <svg viewBox="0 0 1320 470" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
    <!-- ground -->
    <rect x="0" y="345" width="1320" height="125" fill="#101c14"/>
    <rect x="0" y="345" width="1320" height="5" fill="#1d3322"/>
    <!-- crawler-way -->
    <path d="M330 470 L370 345 L410 345 L450 470 Z" fill="#22303f"/>
    <path d="M388 345 L392 345 L400 470 L380 470 Z" fill="#3a4c5e"/>

    <!-- TRACKING CENTER -->
    <g class="ksp-bld" data-go="tracking">
      <g class="ksp-glow">
        <rect x="60" y="255" width="190" height="90" rx="6" fill="#26344e" stroke="#3d5177" stroke-width="2"/>
        <rect x="80" y="278" width="150" height="34" rx="4" fill="#0c1626"/>
        <rect x="88" y="286" width="26" height="18" fill="#48e08a" opacity="0.9"/>
        <rect x="122" y="286" width="26" height="18" fill="#3f9dff" opacity="0.9"/>
        <rect x="156" y="286" width="26" height="18" fill="#ffd24a" opacity="0.9"/>
        <rect x="190" y="286" width="26" height="18" fill="#48e08a" opacity="0.7"/>
        <rect x="138" y="318" width="34" height="27" fill="#101a2c"/>
        <!-- big dish -->
        <rect x="255" y="270" width="12" height="75" fill="#3d5177"/>
        <path d="M261 275 m-52 -14 a52 30 -32 1 1 104 28 z" fill="#c9d6ec" stroke="#8ea4c9" stroke-width="2"/>
        <line x1="261" y1="272" x2="238" y2="228" stroke="#8ea4c9" stroke-width="3"/>
        <circle cx="238" cy="228" r="5" fill="#ffd24a"/>
        <!-- little rotating radar -->
        <rect x="96" y="238" width="6" height="20" fill="#3d5177"/>
        <path d="M99 240 l-20 -8 l40 0 z" fill="#8ea4c9"/>
      </g>
      <text x="155" y="395" text-anchor="middle" font-size="20" font-weight="800" fill="#cfe0ff">📡 TRACKING CENTER</text>
      <text x="155" y="416" text-anchor="middle" font-size="12" fill="#9fb3da">every ship, probe &amp; station — live</text>
    </g>

    <!-- SPACE SCHOOL (the little-sibling classroom — Mom's ask) -->
    <g class="ksp-bld" data-go="school">
      <g class="ksp-glow">
        <rect x="300" y="285" width="90" height="60" rx="4" fill="#e8b64c" stroke="#b3822a" stroke-width="2"/>
        <path d="M295 285 L345 252 L395 285 Z" fill="#c8503c" stroke="#93392b" stroke-width="2"/>
        <!-- bell in the gable -->
        <circle cx="345" cy="272" r="7" fill="#fff3d6" stroke="#93392b" stroke-width="2"/>
        <path d="M342 270 a3.5 3.5 0 0 1 7 0 l1 4 l-9 0 Z" fill="#8a5a12"/>
        <!-- door + windows -->
        <rect x="332" y="318" width="26" height="27" rx="3" fill="#6d4713"/>
        <rect x="308" y="296" width="16" height="14" rx="2" fill="#fff3d6"/>
        <rect x="366" y="296" width="16" height="14" rx="2" fill="#fff3d6"/>
        <!-- kid-drawn rocket chalkboard -->
        <rect x="337" y="294" width="17" height="18" rx="2" fill="#20301f"/>
        <path d="M345 297 l3 6 l-2 0 l0 4 l-2 0 l0 -4 l-2 0 Z" fill="#ffd24a"/>
      </g>
      <text x="337" y="395" text-anchor="middle" font-size="16" font-weight="800" fill="#ffe0a8">🎒 SPACE SCHOOL</text>
      <text x="337" y="416" text-anchor="middle" font-size="12" fill="#d9b989">new astronauts start here</text>
    </g>

    <!-- VAB -->
    <g class="ksp-bld" data-go="vab">
      <g class="ksp-glow">
        <rect x="430" y="120" width="200" height="225" fill="#d7dee9" stroke="#9fb0c9" stroke-width="2"/>
        <rect x="430" y="120" width="200" height="26" fill="#31517f"/>
        <rect x="452" y="160" width="156" height="150" fill="#31517f"/>
        <rect x="500" y="160" width="60" height="150" fill="#25406a"/>
        <!-- flag mural -->
        <rect x="452" y="160" width="40" height="30" fill="#e0443f"/>
        <circle cx="472" cy="175" r="8" fill="#fff"/>
        <rect x="510" y="318" width="40" height="27" fill="#101a2c"/>
        <text x="530" y="142" text-anchor="middle" font-size="17" font-weight="900" fill="#ffffff" letter-spacing="4">V A B</text>
      </g>
      <text x="530" y="395" text-anchor="middle" font-size="20" font-weight="800" fill="#cfe0ff">🏗 VEHICLE ASSEMBLY</text>
      <text x="530" y="416" text-anchor="middle" font-size="12" fill="#9fb3da">build a rocket</text>
    </g>

    <!-- SPACE PLANE HANGAR -->
    <g class="ksp-bld" data-go="hangar">
      <g class="ksp-glow">
        <path d="M700 345 L700 265 Q810 195 920 265 L920 345 Z" fill="#c3ccdb" stroke="#9fb0c9" stroke-width="2"/>
        <path d="M700 268 Q810 200 920 268" fill="none" stroke="#31517f" stroke-width="10"/>
        <rect x="742" y="285" width="136" height="60" fill="#16233c"/>
        <rect x="742" y="285" width="136" height="60" fill="none" stroke="#31517f" stroke-width="3"/>
        <line x1="810" y1="285" x2="810" y2="345" stroke="#31517f" stroke-width="3"/>
        <!-- little space plane peeking out -->
        <path d="M760 332 L830 332 L852 324 L864 330 L852 336 L830 340 L760 340 Z" fill="#e8eefc"/>
        <path d="M796 332 L780 316 L790 316 L806 330 Z" fill="#cfd8e8"/>
        <circle cx="856" cy="330" r="3" fill="#0c1626"/>
      </g>
      <text x="810" y="395" text-anchor="middle" font-size="20" font-weight="800" fill="#cfe0ff">✈ SPACE PLANE HANGAR</text>
      <text x="810" y="416" text-anchor="middle" font-size="12" fill="#9fb3da">planes · probes · space stations</text>
    </g>

    <!-- 🧑‍🚀 ASTRONAUT COMPLEX (pick the crew; science recruits more) -->
    <g class="ksp-bld" data-go="complex">
      <g class="ksp-glow">
        <rect x="960" y="272" width="150" height="73" rx="6" fill="#26344e" stroke="#3d5177" stroke-width="2"/>
        <!-- glass star-view dome on the roof -->
        <path d="M1005 272 a30 26 0 0 1 60 0 Z" fill="#9fd2ff" opacity="0.5" stroke="#8ea4c9" stroke-width="2"/>
        <circle cx="1035" cy="258" r="3" fill="#fff" opacity="0.9"/>
        <!-- door + lit windows (somebody's always home) -->
        <rect x="1021" y="318" width="28" height="27" fill="#101a2c"/>
        <rect x="972" y="290" width="18" height="13" rx="2" fill="#ffd24a" opacity="0.85"/>
        <rect x="996" y="290" width="18" height="13" rx="2" fill="#ffd24a" opacity="0.55"/>
        <rect x="1056" y="290" width="18" height="13" rx="2" fill="#ffd24a" opacity="0.85"/>
        <rect x="1080" y="290" width="18" height="13" rx="2" fill="#48e08a" opacity="0.7"/>
        <!-- a little Connie in a bubble helmet, out front -->
        <circle cx="1090" cy="330" r="8" fill="none" stroke="#c9d6ec" stroke-width="2"/>
        <circle cx="1090" cy="331.5" r="4.6" fill="#48c07a"/>
        <circle cx="1088.4" cy="330.5" r="1.2" fill="#0c1626"/>
        <circle cx="1091.6" cy="330.5" r="1.2" fill="#0c1626"/>
        <rect x="1086" y="338" width="9" height="7" rx="3" fill="#c9d6ec"/>
      </g>
      <text x="1055" y="395" text-anchor="middle" font-size="16" font-weight="800" fill="#cfe0ff">🧑‍🚀 ASTRONAUT COMPLEX</text>
      <text x="1055" y="416" text-anchor="middle" font-size="12" fill="#9fb3da">pick your crew — science recruits more</text>
    </g>

    <!-- launchpad + rocket, flag, water tower (decoration) -->
    <g>
      <rect x="1165" y="330" width="120" height="15" fill="#33404f"/>
      <rect x="1180" y="205" width="10" height="125" fill="#5b6a7d"/>
      <line x1="1190" y1="215" x2="1222" y2="230" stroke="#5b6a7d" stroke-width="4"/>
      <rect x="1216" y="230" width="16" height="88" rx="7" fill="#e8eefc"/>
      <path d="M1216 236 L1224 214 L1232 236 Z" fill="#e0443f"/>
      <path d="M1216 318 L1208 334 L1216 330 Z" fill="#c3ccdb"/>
      <path d="M1232 318 L1240 334 L1232 330 Z" fill="#c3ccdb"/>
      <rect x="1128" y="252" width="4" height="93" fill="#5b6a7d"/>
      <rect x="1132" y="252" width="26" height="16" fill="#e0443f"/>
      <circle cx="1145" cy="260" r="5" fill="#fff"/>
      <ellipse cx="668" cy="255" rx="24" ry="18" fill="#6e7c8f"/>
      <rect x="664" y="270" width="8" height="75" fill="#5b6a7d"/>
    </g>
  </svg>`;
  centerEl.appendChild(svgWrap);

  svgWrap.querySelectorAll(".ksp-bld").forEach((g) => {
    g.addEventListener("click", () => {
      const go = g.getAttribute("data-go");
      hideAll();
      if (go === "vab" && handlers.onVAB) handlers.onVAB();
      if (go === "hangar" && handlers.onHangar) handlers.onHangar();
      if (go === "tracking" && handlers.onTracking) handlers.onTracking();
      if (go === "school" && handlers.onSchool) handlers.onSchool();
      if (go === "complex") showComplex(); // menu-owned screen, like Settings
    });
  });

  const foot = document.createElement("div");
  foot.style.cssText = "position:absolute;bottom:16px;left:0;right:0;display:flex;gap:10px;justify-content:center;";
  const mk = (label, fn) => {
    const b = document.createElement("button");
    b.className = "ksp-btn";
    b.style.cssText = "width:auto;margin:0;padding:9px 16px;font-size:14px;";
    b.textContent = label;
    b.onclick = fn;
    foot.appendChild(b);
  };
  mk("⚙ Settings", () => showSettings(centerEl));
  mk("🌌 Title screen", () => showTitle());
  centerEl.appendChild(foot);
}

// ---- 🧑‍🚀 the Astronaut Complex: pick who flies ----
// Portrait: a Connie in her bubble helmet, one seeded color per roster slot.
const CONNIE_COLORS = ["#48c07a", "#e0a13f", "#4f9fe8", "#c86ad0", "#e8655a", "#4fd0c0", "#a4c04f", "#8f7ae8"];
function conniePortrait(i) {
  // Locked cards go grayscale via CSS (.ksp-locked .ksp-face) — same art, dimmed.
  return `
  <svg class="ksp-face" viewBox="0 0 80 80" style="width:64px;height:64px;display:block;margin:0 auto 6px;">
    <circle cx="40" cy="40" r="26" fill="rgba(160,200,255,.12)" stroke="#c9d6ec" stroke-width="3"/>
    <path d="M28 26 a16 12 0 0 1 24 6" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.5" stroke-linecap="round"/>
    <path d="M26 52 q-8 2 -6 8" fill="none" stroke="${CONNIE_COLORS[i % CONNIE_COLORS.length]}" stroke-width="7" stroke-linecap="round"/>
    <circle cx="40" cy="44" r="13" fill="${CONNIE_COLORS[i % CONNIE_COLORS.length]}"/>
    <circle cx="35.5" cy="41" r="3.1" fill="#0c1626"/>
    <circle cx="44.5" cy="41" r="3.1" fill="#0c1626"/>
    <circle cx="36.6" cy="40" r="1" fill="#fff"/>
    <circle cx="45.6" cy="40" r="1" fill="#fff"/>
    <path d="M35 49 q5 4 10 0" fill="none" stroke="#0c1626" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

function showComplex() {
  hideAll();
  complexEl = overlay("radial-gradient(120% 90% at 50% 110%, #14264f 0%, #0a1226 45%, #04060f 100%)");
  complexEl.appendChild(starfield(50));
  const science = handlers.getScience ? handlers.getScience() : 0;
  const picked = loadCrewPicks();

  const head = document.createElement("div");
  head.style.cssText = "position:relative;text-align:center;margin-bottom:14px;";
  head.innerHTML = `
    <div class="ksp-title-word" style="font-size:clamp(24px,3.6vw,40px);">🧑‍🚀 ASTRONAUT COMPLEX</div>
    <div style="font-size:13px;color:#9fb3da;margin-top:8px;max-width:640px;">
      Tap Connies to pick your crew — <b style="color:#ffd24a">first pick is the COMMANDER</b>.
      The Acorn Pod seats <b>3</b> (same as Apollo!), the Swift Cockpit <b>2</b>, probes fly empty.<br>
      <span style="display:inline-block;margin-top:6px;background:rgba(27,42,74,.92);border:1px solid #3a5590;border-radius:999px;padding:5px 14px;font-size:14px;">
        🔬 <b>${science}</b> science — experiments aboard stations recruit new astronauts
      </span>
    </div>`;
  complexEl.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "ksp-crew-grid";
  CONNIES.forEach((con, i) => {
    const unlocked = isUnlocked(con, science);
    const seat = picked.indexOf(con.name); // -1 = not picked
    const card = document.createElement("div");
    card.className = "ksp-card" + (seat >= 0 ? " ksp-picked" : "") + (unlocked ? "" : " ksp-locked");
    card.innerHTML = conniePortrait(i) +
      `<div style="font-weight:800;font-size:14px;">${con.name}</div>` +
      (unlocked
        ? `<div style="font-size:10.5px;color:#9fb3da;line-height:1.35;margin-top:4px;">${con.hero}</div>` +
          `<div style="font-size:11px;margin-top:6px;color:${seat >= 0 ? "#ffd24a" : "#5f6f97"};font-weight:700;">
             ${seat === 0 ? "⭐ COMMANDER" : seat > 0 ? "seat " + (seat + 1) : "tap to add to crew"}</div>`
        : `<div style="font-size:11px;color:#8ea4c9;margin-top:6px;">🔒 joins at <b>${con.unlock} 🔬</b></div>` +
          `<div style="font-size:10.5px;color:#5f6f97;margin-top:3px;">${con.unlock - science} more science to go</div>`);
    if (seat >= 0) {
      const b = document.createElement("div");
      b.className = "ksp-seat-badge";
      b.textContent = seat === 0 ? "⭐ 1" : String(seat + 1);
      card.appendChild(b);
    }
    if (unlocked) {
      card.onclick = () => {
        const now = loadCrewPicks();
        const at = now.indexOf(con.name);
        if (at >= 0) now.splice(at, 1); else now.push(con.name);
        saveCrewPicks(now);
        showComplex(); // re-render with new picks (same pattern as Settings)
      };
    }
    grid.appendChild(card);
  });
  complexEl.appendChild(grid);

  const foot = document.createElement("div");
  foot.style.cssText = "margin-top:16px;display:flex;gap:10px;";
  const back = document.createElement("button");
  back.className = "ksp-btn";
  back.style.cssText = "width:auto;margin:0;padding:10px 20px;";
  back.textContent = "⬅ Space Center";
  back.onclick = () => showCenter();
  foot.appendChild(back);
  complexEl.appendChild(foot);
}

function hideAll() {
  if (settingsEl) { settingsEl.remove(); settingsEl = null; }
  if (titleEl) { titleEl.remove(); titleEl = null; }
  if (centerEl) { centerEl.remove(); centerEl = null; }
  if (complexEl) { complexEl.remove(); complexEl = null; }
}

export const Menu = {
  init(h) { handlers = h || {}; settings = loadSettings(); },
  showTitle,
  showCenter,
  hideAll,
  isOpen() { return !!(titleEl || centerEl || settingsEl || complexEl); },
  getSettings() { return { ...settings }; },
};
