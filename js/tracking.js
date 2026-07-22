// tracking.js — the 📡 TRACKING CENTER inside the Konnie Space Center (his ask): one big
// live map that knows where EVERYTHING he ever sent up is, right now — the active ship,
// every satellite, every station — with zoom, pan, click-to-track, and a time
// fast-forward so he can WATCH the orbits go around.
//
// It's a plain 2D canvas (not Three.js): positions come straight from the same pure math
// the game flies with — bodyStateAt for worlds, Physics.satellitePos for satellites, and
// the stations' circular elements — so the map is exactly as honest as the sim.
//
// API: Tracking.init({ getSim, getSatellites, onExit }) ; Tracking.show()

import { BODIES, PLANET_KEYS, STATIONS, WORMHOLES, SYSTEM, bodyStateAt } from "./state.js";
import { Physics } from "./physics.js";

let H = {};                 // handlers from init
let el = null, canvas = null, ctx = null, listEl = null, infoEl = null, timeEl = null;
let raf = 0;
let scale = 0;              // px per meter (0 = auto-fit on open)
let center = { x: 0, y: 0 }; // world meters at canvas center
let follow = null;          // { kind: "body"|"sat"|"station"|"craft", id } — camera glued to it
let drag = null;
let warp = 0;               // 0 = live "now"; otherwise preview seconds-per-second
let previewT = 0;           // preview clock (starts at sim time when warp engaged)

const WARP_TIERS = [0, 60, 600, 6000, 60000];
const WARP_LABEL = ["⏸ now", "▶ 1 min/s", "▶▶ 10 min/s", "⏩ ~1.7 hr/s", "⏩⏩ ~17 hr/s"];

// Map colors per role-key (generated systems reuse them by role); fallback by kind.
const DOT = {
  sun: "#ffd75e", mercury: "#b8a793", venus: "#e8c98a", earth: "#5b9bd5", moon: "#c9ccd4",
  mars: "#e07b53", phobos: "#9b8878", deimos: "#9b8878", jupiter: "#d9a76a", io: "#e8d060",
  europa: "#d8cdb8", ganymede: "#a99f92", callisto: "#8a8378", saturn: "#e6cf9a",
  titan: "#e0a83f", uranus: "#9bd4d9", neptune: "#5f83e0", pluto: "#d6c7b8",
};

function fmtKm(m) {
  const km = m / 1000;
  if (km < 10000) return km.toFixed(0) + " km";
  if (km < 1e7) return (km / 1e6).toFixed(2) + " M km";
  return (km / 1e6).toFixed(0) + " M km";
}
function fmtPeriod(s) {
  if (s < 7200) return (s / 60).toFixed(0) + " min";
  if (s < 172800) return (s / 3600).toFixed(1) + " hr";
  return (s / 86400).toFixed(1) + " days";
}

function stationState(st, t) {
  const b = BODIES[st.body];
  if (!b) return null;
  const bs = bodyStateAt(st.body, t);
  const r = b.radius * st.altR;
  const n = Math.sqrt(b.mu / (r * r * r));
  const th = st.phase0 + n * t;
  return { pos: { x: bs.pos.x + r * Math.cos(th), y: bs.pos.y + r * Math.sin(th) },
           r, period: 2 * Math.PI / n };
}

function simTime() { const s = H.getSim && H.getSim(); return (s && s.time) || 0; }
function displayTime() { return warp > 0 ? previewT : simTime(); }

// Everything trackable right now, as a flat list the side panel + picker share.
function roster() {
  const t = displayTime();
  const out = [];
  const sim = H.getSim && H.getSim();
  if (sim && sim.mode === "flight" && sim.status !== "crashed") {
    out.push({ kind: "craft", id: "craft", icon: "🚀", name: (sim.craftName || "Your ship"),
               pos: { ...sim.craft.pos }, sub: sim.status });
  }
  const sats = (H.getSatellites && H.getSatellites()) || [];
  sats.forEach((s, i) => {
    if (!BODIES[s.bodyKey]) return;
    const p = Physics.satellitePos(s, t);
    if (p) out.push({ kind: "sat", id: "sat" + i, icon: "🛰", name: s.name || "Sat " + (i + 1),
                      pos: p, sub: "orbiting " + BODIES[s.bodyKey].name + (s.hasPower ? " · ☀ powered" : " · 🔋 no power"),
                      sat: s });
  });
  for (const st of STATIONS) {
    const ss = stationState(st, t);
    if (ss) out.push({ kind: "station", id: st.id, icon: st.abandoned ? "⚠" : st.yours ? "⭐" : "🛰", name: st.name,
                       pos: ss.pos, sub: (st.abandoned ? "derelict · " : "") + "orbiting " + BODIES[st.body].name +
                       " · lap " + fmtPeriod(ss.period), station: st });
  }
  for (const wh of WORMHOLES) { // 🌀 gates ride the same circular elements as stations
    const ws = stationState(wh, t);
    if (ws) out.push({ kind: "wormhole", id: wh.id, icon: "🌀", name: wh.name,
                       pos: ws.pos, sub: "orbiting " + BODIES[wh.body].name + " · leads to " +
                       (wh.dest.seed === "@sol" ? "the Solar System" : "the " + wh.dest.seed + " system"),
                       wormhole: wh });
  }
  return out;
}

function show() {
  if (el) return;
  el = document.createElement("div");
  el.style.cssText = "position:absolute;inset:0;z-index:30;background:#04070f;display:flex;" +
    "font-family:system-ui,-apple-system,sans-serif;color:#e8eefc;";
  el.innerHTML = `
    <div id="trk-side" style="width:262px;min-width:262px;border-right:1px solid #24304d;
        display:flex;flex-direction:column;background:rgba(12,18,34,.92);">
      <div style="padding:14px 14px 8px;">
        <div style="font-size:17px;font-weight:900;letter-spacing:.04em;">📡 TRACKING CENTER</div>
        <div id="trk-sys" style="font-size:11px;color:#9fb3da;margin-top:3px;"></div>
      </div>
      <div id="trk-list" style="flex:1;overflow-y:auto;padding:4px 8px;"></div>
      <div id="trk-info" style="border-top:1px solid #24304d;padding:10px 14px;font-size:12px;
          line-height:1.6;min-height:70px;color:#cfe0ff;"></div>
      <button id="trk-exit" style="margin:10px;padding:11px;font-size:15px;font-weight:700;
          background:#1b2a4a;color:#e8eefc;border:1px solid #2f4470;border-radius:9px;cursor:pointer;">
        ⬅ Back to the Space Center</button>
    </div>
    <div style="flex:1;position:relative;">
      <canvas id="trk-canvas" style="position:absolute;inset:0;width:100%;height:100%;cursor:grab;"></canvas>
      <div style="position:absolute;top:12px;left:50%;transform:translateX(-50%);display:flex;gap:6px;
          background:rgba(12,18,34,.88);border:1px solid #24304d;border-radius:9px;padding:6px 8px;align-items:center;">
        <span style="font-size:12px;color:#9fb3da;">Sky clock:</span>
        <button id="trk-warp" style="padding:5px 12px;font-size:13px;background:#1b2a4a;color:#e8eefc;
            border:1px solid #2f4470;border-radius:7px;cursor:pointer;min-width:110px;"></button>
        <span id="trk-time" style="font-size:12px;color:#9fb3da;min-width:110px;"></span>
      </div>
      <div style="position:absolute;bottom:12px;left:50%;transform:translateX(-50%);font-size:12px;
          color:#9fb3da;background:rgba(12,18,34,.8);padding:5px 12px;border-radius:8px;">
        scroll to zoom · drag to pan · click anything to track it</div>
      <div style="position:absolute;right:12px;top:12px;display:flex;flex-direction:column;gap:6px;">
        <button id="trk-zin" style="width:38px;height:38px;font-size:19px;background:#1b2a4a;color:#e8eefc;border:1px solid #2f4470;border-radius:8px;cursor:pointer;">＋</button>
        <button id="trk-zout" style="width:38px;height:38px;font-size:19px;background:#1b2a4a;color:#e8eefc;border:1px solid #2f4470;border-radius:8px;cursor:pointer;">－</button>
        <button id="trk-fit" title="See the whole system" style="width:38px;height:38px;font-size:16px;background:#1b2a4a;color:#e8eefc;border:1px solid #2f4470;border-radius:8px;cursor:pointer;">⤢</button>
      </div>
    </div>`;
  document.getElementById("app").appendChild(el);

  canvas = el.querySelector("#trk-canvas");
  ctx = canvas.getContext("2d");
  listEl = el.querySelector("#trk-list");
  infoEl = el.querySelector("#trk-info");
  timeEl = el.querySelector("#trk-time");
  el.querySelector("#trk-sys").textContent = "🌌 " + SYSTEM.name;
  el.querySelector("#trk-exit").onclick = () => { hide(); if (H.onExit) H.onExit(); };
  el.querySelector("#trk-zin").onclick = () => { scale *= 1.6; };
  el.querySelector("#trk-zout").onclick = () => { scale /= 1.6; };
  el.querySelector("#trk-fit").onclick = () => { follow = null; fitAll(); };
  const warpBtn = el.querySelector("#trk-warp");
  const syncWarp = () => { warpBtn.textContent = WARP_LABEL[WARP_TIERS.indexOf(warp)] || "⏸ now"; };
  warpBtn.onclick = () => {
    const i = (WARP_TIERS.indexOf(warp) + 1) % WARP_TIERS.length;
    if (WARP_TIERS[i] > 0 && warp === 0) previewT = simTime();
    warp = WARP_TIERS[i];
    syncWarp();
  };
  syncWarp();

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    scale *= Math.exp(-e.deltaY * 0.0016);
  }, { passive: false });
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      follow = null; // panning un-glues the camera
      center.x -= dx / scale;
      center.y += dy / scale; // canvas y is down; world y is up
      drag.x = e.clientX; drag.y = e.clientY;
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    const wasClick = drag && !drag.moved;
    drag = null;
    if (wasClick) pickAt(e);
  });

  follow = null;
  warp = 0;
  fitAll();
  loop();
}

function hide() {
  if (!el) return;
  cancelAnimationFrame(raf);
  el.remove();
  el = null; canvas = null; ctx = null;
}
function isOpen() { return !!el; }

function fitAll() {
  // Frame the whole active system: the farthest planet's orbit with margin.
  let rMax = 0;
  for (const k of PLANET_KEYS) {
    const b = BODIES[k];
    if (b.parent === "sun") rMax = Math.max(rMax, b.orbitRadius);
  }
  const w = canvas ? canvas.clientWidth : 900;
  scale = (w * 0.44) / Math.max(1, rMax);
  center = { x: 0, y: 0 };
}

function toPx(p) {
  const w = canvas.width / (window.devicePixelRatio || 1), h = canvas.height / (window.devicePixelRatio || 1);
  return { x: w / 2 + (p.x - center.x) * scale, y: h / 2 - (p.y - center.y) * scale };
}

function pickAt(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const t = displayTime();
  let best = null, bestD = 18; // px hit radius
  for (const item of roster()) {
    const q = toPx(item.pos);
    const d = Math.hypot(q.x - mx, q.y - my);
    if (d < bestD) { bestD = d; best = { kind: item.kind, id: item.id }; }
  }
  for (const k of ["sun", ...PLANET_KEYS]) {
    const q = toPx(bodyStateAt(k, t).pos);
    const d = Math.hypot(q.x - mx, q.y - my);
    if (d < bestD) { bestD = d; best = { kind: "body", id: k }; }
  }
  if (best) follow = best;
}

function followPos(t) {
  if (!follow) return null;
  if (follow.kind === "body") return bodyStateAt(follow.id, t).pos;
  for (const item of roster()) if (item.kind === follow.kind && item.id === follow.id) return item.pos;
  return null;
}

function loop() {
  if (!el) return;
  raf = requestAnimationFrame(loop);
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr; canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (warp > 0) previewT += warp / 60; // ~per-frame at 60fps; a preview clock, not the sim
  const t = displayTime();
  const fp = followPos(t);
  if (fp) center = { x: fp.x, y: fp.y };
  timeEl.textContent = warp > 0
    ? "preview +" + fmtPeriod(Math.max(1, previewT - simTime())) + " ahead"
    : "showing: right now";

  // sky
  ctx.fillStyle = "#04070f";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  let sx = 987654321; // deterministic star sprinkle
  const rnd = () => { sx ^= sx << 13; sx ^= sx >>> 17; sx ^= sx << 5; return ((sx >>> 0) % 1000) / 1000; };
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 110; i++) ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  ctx.restore();

  // orbit rings (each body around its parent's CURRENT position)
  ctx.lineWidth = 1;
  for (const k of PLANET_KEYS) {
    const b = BODIES[k];
    if (!b.parent) continue;
    const pp = toPx(bodyStateAt(b.parent, t).pos);
    const r = b.orbitRadius * scale;
    if (r < 4 || r > 30000) continue;
    ctx.strokeStyle = "rgba(120,150,210,0.22)";
    ctx.beginPath();
    if (b.ecc) {
      // true ellipse, parent at the focus (same math as the 3D orbit ring);
      // built in WORLD coords then projected, since toPx flips y
      const pw = bodyStateAt(b.parent, t).pos;
      const e = b.ecc, w = b.periAngle || 0, s = Math.sqrt(1 - e * e);
      const cw = Math.cos(w), sw = Math.sin(w), a = b.orbitRadius;
      for (let i = 0; i <= 96; i++) {
        const E = (i / 96) * Math.PI * 2;
        const px = a * (Math.cos(E) - e), py = a * s * Math.sin(E);
        const q = toPx({ x: pw.x + px * cw - py * sw, y: pw.y + px * sw + py * cw });
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      }
      ctx.closePath();
    } else {
      ctx.arc(pp.x, pp.y, r, 0, Math.PI * 2);
    }
    ctx.stroke();
  }

  // bodies
  for (const k of ["sun", ...PLANET_KEYS]) {
    const b = BODIES[k];
    const q = toPx(bodyStateAt(k, t).pos);
    if (q.x < -60 || q.y < -60 || q.x > w + 60 || q.y > h + 60) continue;
    const rTrue = b.radius * scale;
    const rDot = Math.max(k === "sun" ? 7 : 3.5, rTrue);
    const color = b.style && typeof b.style.color === "number"
      ? "#" + b.style.color.toString(16).padStart(6, "0")
      : DOT[k] || "#9fb3da";
    ctx.fillStyle = b.blackHole ? "#1a0a22" : color;
    ctx.beginPath();
    ctx.arc(q.x, q.y, rDot, 0, Math.PI * 2);
    ctx.fill();
    if (b.blackHole) { ctx.strokeStyle = "#b06de0"; ctx.lineWidth = 2; ctx.stroke(); }
    if (rDot > 2.5 || b.parent === "sun" || !b.parent) {
      ctx.fillStyle = "rgba(207,224,255,0.85)";
      ctx.font = "600 11px system-ui";
      ctx.fillText(b.name, q.x + rDot + 4, q.y + 4);
    }
    // atmosphere hint up close
    if (b.atmosphere && rTrue > 20) {
      ctx.strokeStyle = "rgba(110,180,255,0.25)";
      ctx.lineWidth = Math.max(1, b.atmosphere.height * scale);
      ctx.beginPath();
      ctx.arc(q.x, q.y, rTrue + (b.atmosphere.height * scale) / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  // satellite trails (their real frozen ellipses, sampled over one lap)
  const sats = (H.getSatellites && H.getSatellites()) || [];
  sats.forEach((s) => {
    if (!BODIES[s.bodyKey] || !isFinite(s.n) || s.n <= 0) return;
    const period = (2 * Math.PI) / s.n;
    ctx.strokeStyle = "rgba(110,255,160,0.3)";
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const p = Physics.satellitePos(s, t + (i / 64) * period);
      if (!p) { ctx.stroke(); return; }
      const q = toPx(p);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  });

  // wormhole-gate orbits — dashed rings in each gate's own color
  for (const wh of WORMHOLES) {
    const b = BODIES[wh.body];
    if (!b) continue;
    const pp = toPx(bodyStateAt(wh.body, t).pos);
    const r = b.radius * wh.altR * scale;
    if (r > 5 && r < 30000) {
      const c = wh.color;
      ctx.strokeStyle = "rgba(" + ((c >> 16) & 255) + "," + ((c >> 8) & 255) + "," + (c & 255) + ",0.4)";
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // station orbits
  for (const st of STATIONS) {
    const b = BODIES[st.body];
    if (!b) continue;
    const pp = toPx(bodyStateAt(st.body, t).pos);
    const r = b.radius * st.altR * scale;
    if (r > 5 && r < 30000) {
      ctx.strokeStyle = st.abandoned ? "rgba(255,150,90,0.3)" : "rgba(140,190,255,0.3)";
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // the fleet
  const items = roster();
  ctx.font = "600 11px system-ui";
  for (const item of items) {
    const q = toPx(item.pos);
    if (q.x < -40 || q.y < -40 || q.x > w + 40 || q.y > h + 40) continue;
    const sel = follow && follow.kind === item.kind && follow.id === item.id;
    if (item.kind === "craft") {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - 7); ctx.lineTo(q.x + 5, q.y + 5); ctx.lineTo(q.x - 5, q.y + 5);
      ctx.closePath(); ctx.fill();
    } else if (item.kind === "sat") {
      ctx.fillStyle = item.sat && item.sat.hasPower ? "#6effa0" : "#c9ccd4";
      ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
    } else if (item.kind === "wormhole") {
      const c = item.wormhole.color;
      ctx.strokeStyle = "rgb(" + ((c >> 16) & 255) + "," + ((c >> 8) & 255) + "," + (c & 255) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(q.x, q.y, 2, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    } else {
      ctx.fillStyle = item.station && item.station.abandoned ? "#ff9a5e" : "#8cbfff";
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - 5); ctx.lineTo(q.x + 5, q.y); ctx.lineTo(q.x, q.y + 5); ctx.lineTo(q.x - 5, q.y);
      ctx.closePath(); ctx.fill();
    }
    if (sel) {
      ctx.strokeStyle = "#ffd24a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.fillStyle = "rgba(207,224,255,0.9)";
    ctx.fillText(item.icon + " " + item.name, q.x + 9, q.y - 7);
  }

  // body follow ring
  if (follow && follow.kind === "body") {
    const q = toPx(bodyStateAt(follow.id, t).pos);
    ctx.strokeStyle = "#ffd24a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(12, BODIES[follow.id].radius * scale + 6), 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
  }

  renderList(items, t);
}

let lastListKey = "";
function renderList(items, t) {
  // Side list: worlds first (collapsed to the interesting ones), then the fleet.
  const key = items.map((i) => i.kind + i.id).join(",") + "|" + (follow ? follow.kind + follow.id : "");
  if (key !== lastListKey) {
    lastListKey = key;
    listEl.innerHTML = "";
    const addRow = (icon, name, sub, sel, onclick) => {
      const d = document.createElement("div");
      d.style.cssText = "padding:7px 8px;border-radius:8px;cursor:pointer;font-size:13px;" +
        (sel ? "background:#2c4478;border:1px solid #5b8dee;" : "border:1px solid transparent;");
      d.innerHTML = "<b>" + icon + " " + name + "</b>" +
        (sub ? "<div style='font-size:11px;color:#9fb3da;margin-top:1px;'>" + sub + "</div>" : "");
      d.onclick = onclick;
      d.onmouseenter = () => { if (!sel) d.style.background = "rgba(44,68,120,.5)"; };
      d.onmouseleave = () => { if (!sel) d.style.background = ""; };
      listEl.appendChild(d);
    };
    const head = (txt) => {
      const d = document.createElement("div");
      d.style.cssText = "font-size:10px;letter-spacing:.1em;color:#7f8bb0;margin:10px 6px 3px;text-transform:uppercase;";
      d.textContent = txt;
      listEl.appendChild(d);
    };
    head("Your fleet");
    if (!items.length) {
      const d = document.createElement("div");
      d.style.cssText = "font-size:12px;color:#7f8bb0;padding:6px 8px;line-height:1.5;";
      d.textContent = "Nothing flying yet! Launch a rocket, leave a probe core in orbit as a satellite, or deploy a station — everything you send up shows here forever.";
      listEl.appendChild(d);
    }
    for (const item of items) {
      addRow(item.icon, item.name, item.sub,
        follow && follow.kind === item.kind && follow.id === item.id,
        () => { follow = { kind: item.kind, id: item.id }; lastListKey = ""; });
    }
    head("Worlds");
    for (const k of ["sun", ...PLANET_KEYS]) {
      const b = BODIES[k];
      addRow(b.blackHole ? "⚫" : k === "sun" ? "☀" : "🪐", b.name,
        b.parent ? "orbits " + BODIES[b.parent].name : null,
        follow && follow.kind === "body" && follow.id === k,
        () => { follow = { kind: "body", id: k }; lastListKey = ""; });
    }
  }
  // Info card for the tracked thing (cheap, every frame).
  if (!follow) { infoEl.innerHTML = "<span style='color:#7f8bb0'>Click anything on the map or the list to track it.</span>"; return; }
  if (follow.kind === "body") {
    const b = BODIES[follow.id];
    infoEl.innerHTML = "<b>" + b.name + "</b><br>" +
      (b.parent ? "Orbits " + BODIES[b.parent].name + " at " + fmtKm(b.orbitRadius) : "The center of the system") +
      "<br>Radius " + fmtKm(b.radius) + (b.atmosphere ? " · has air" : " · no air");
    return;
  }
  const item = items.find((i) => i.kind === follow.kind && i.id === follow.id);
  if (!item) { infoEl.innerHTML = "<span style='color:#7f8bb0'>…it's gone. (Crashed, landed, or deorbited.)</span>"; return; }
  let extra = "";
  const domKey = nearestBodyKey(item.pos, t);
  if (domKey) {
    const b = BODIES[domKey];
    const alt = Math.hypot(item.pos.x - bodyStateAt(domKey, t).pos.x, item.pos.y - bodyStateAt(domKey, t).pos.y) - b.radius;
    extra = "<br>Height over " + b.name + ": <b>" + fmtKm(Math.max(0, alt)) + "</b>";
  }
  if (item.sat && isFinite(item.sat.n) && item.sat.n > 0) extra += "<br>One lap: <b>" + fmtPeriod((2 * Math.PI) / item.sat.n) + "</b>";
  infoEl.innerHTML = "<b>" + item.icon + " " + item.name + "</b><br>" + item.sub + extra;
}

// Nearest body whose SOI contains the point (display logic only — same idea as dominantBody).
function nearestBodyKey(pos, t) {
  let best = "sun", bestSoi = Infinity;
  for (const k of PLANET_KEYS) {
    const b = BODIES[k];
    const st = bodyStateAt(k, t);
    const d = Math.hypot(pos.x - st.pos.x, pos.y - st.pos.y);
    if (d < b.soiRadius && b.soiRadius < bestSoi) { best = k; bestSoi = b.soiRadius; }
  }
  return best;
}

export const Tracking = {
  init(h) { H = h || {}; },
  show,
  hide,
  isOpen,
};
