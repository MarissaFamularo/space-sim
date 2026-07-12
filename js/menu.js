// menu.js — Konnie Space Program's front door: the title screen, the settings panel,
// and the KONNIE SPACE CENTER (his ask): a place on Earth with real buildings — the
// Tracking Center, the VAB, and the Space Plane Hangar — each one a door into a game
// mode. Pure DOM/SVG overlays on top of the running 3D scene; owns no game state.
//
// API (used by main.js):
//   Menu.init({ onVAB, onHangar, onTracking, onSettingsChange })
//   Menu.showTitle() / Menu.showCenter() / Menu.hideAll()
//   Menu.getSettings() -> { graphics: "fancy"|"fast" }

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
let titleEl = null, centerEl = null, settingsEl = null;

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
  foot.style.cssText = "position:absolute;bottom:18px;font-size:12px;color:#5f6f97;";
  foot.textContent = "a Konnie & Mom production";
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
  svgWrap.style.cssText = "width:min(96vw,1150px);margin-top:60px;";
  svgWrap.innerHTML = `
  <svg viewBox="0 0 1150 470" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
    <!-- ground -->
    <rect x="0" y="345" width="1150" height="125" fill="#101c14"/>
    <rect x="0" y="345" width="1150" height="5" fill="#1d3322"/>
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

    <!-- launchpad + rocket, flag, water tower (decoration) -->
    <g>
      <rect x="985" y="330" width="120" height="15" fill="#33404f"/>
      <rect x="1000" y="205" width="10" height="125" fill="#5b6a7d"/>
      <line x1="1010" y1="215" x2="1042" y2="230" stroke="#5b6a7d" stroke-width="4"/>
      <rect x="1036" y="230" width="16" height="88" rx="7" fill="#e8eefc"/>
      <path d="M1036 236 L1044 214 L1052 236 Z" fill="#e0443f"/>
      <path d="M1036 318 L1028 334 L1036 330 Z" fill="#c3ccdb"/>
      <path d="M1052 318 L1060 334 L1052 330 Z" fill="#c3ccdb"/>
      <rect x="948" y="252" width="4" height="93" fill="#5b6a7d"/>
      <rect x="952" y="252" width="26" height="16" fill="#e0443f"/>
      <circle cx="965" cy="260" r="5" fill="#fff"/>
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

function hideAll() {
  if (settingsEl) { settingsEl.remove(); settingsEl = null; }
  if (titleEl) { titleEl.remove(); titleEl = null; }
  if (centerEl) { centerEl.remove(); centerEl = null; }
}

export const Menu = {
  init(h) { handlers = h || {}; settings = loadSettings(); },
  showTitle,
  showCenter,
  hideAll,
  isOpen() { return !!(titleEl || centerEl || settingsEl); },
  getSettings() { return { ...settings }; },
};
