// ui.js — PM-owned. Live readouts + mode/flight controls. Reads SimState + Stats.

import { BODIES } from "./state.js";

// Destinations for the target picker, in trip-difficulty order. Moons of other planets
// show indented under their planet (capture at the planet first, then hop to the moon).
const TARGETS = ["moon", "mercury", "venus", "mars",
  "jupiter", "io", "europa", "ganymede", "callisto",
  "saturn", "titan", "uranus", "neptune", "pluto", "earth"];
const MOON_OF = { io: "jupiter", europa: "jupiter", ganymede: "jupiter", callisto: "jupiter", titan: "saturn" };

// Distances read better in the right unit: km up close, million-km across the system.
function fmtDist(m) {
  const km = m / 1000;
  if (km < 100000) return km.toFixed(0) + " km";
  if (km < 10e6) return (km / 1e6).toFixed(2) + " M km";
  return (km / 1e6).toFixed(0) + " M km";
}
function fmtWarp(w) {
  return w >= 1000 ? (w / 1000) + "k×" : w + "×";
}

export const UI = {
  els: {},
  init({ onLaunch, onReset, onModeChange, onToggleMap, onToggleArrow, onTargetChange }) {
    this.els.readouts = document.getElementById("readout-list");
    this.els.controls = document.getElementById("control-list");
    this.handlers = { onLaunch, onReset, onModeChange, onToggleMap, onToggleArrow, onTargetChange };
    this._renderControls();
  },
  // Show flight-only controls in flight, hide them in build (keeps the MODE box short).
  setMode(mode) {
    if (this.els.flightControls) this.els.flightControls.style.display = mode === "flight" ? "" : "none";
  },
  _renderControls() {
    const c = this.els.controls;
    c.innerHTML = "";
    const mk = (label, fn) => { const b = document.createElement("button");
      b.textContent = label; b.style.marginRight = "6px"; b.onclick = fn; c.appendChild(b); };
    mk("Build", () => this.handlers.onModeChange && this.handlers.onModeChange("build"));
    mk("🚀 Launch", () => this.handlers.onLaunch && this.handlers.onLaunch());
    mk("Reset", () => this.handlers.onReset && this.handlers.onReset());

    // Flight-only controls — hidden in build mode.
    const fc = document.createElement("div");
    this.els.flightControls = fc;
    fc.style.display = "none";
    c.appendChild(fc);

    const mapBtn = document.createElement("button");
    mapBtn.textContent = "🗺 Map view";
    mapBtn.style.cssText = "margin-top:8px;";
    mapBtn.onclick = () => {
      const on = this.handlers.onToggleMap && this.handlers.onToggleMap();
      mapBtn.textContent = on ? "🚀 Flight view" : "🗺 Map view";
    };
    fc.appendChild(mapBtn);

    // 🎯 Target picker: where are we going today?
    const targetRow = document.createElement("div");
    targetRow.style.cssText = "margin-top:8px;display:flex;align-items:center;gap:6px;font-size:12px;color:#9fb3da;";
    targetRow.appendChild(document.createTextNode("🎯"));
    const sel = document.createElement("select");
    sel.style.cssText = "flex:1;background:#0a1020;color:#e8eefc;border:1px solid #24304d;" +
      "border-radius:5px;padding:3px 4px;font-size:12px;";
    for (const key of TARGETS) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = (MOON_OF[key] ? "  · " : "") + BODIES[key].name + (key === "earth" ? " (home)" : "");
      sel.appendChild(opt);
    }
    sel.value = "moon";
    sel.onchange = () => this.handlers.onTargetChange && this.handlers.onTargetChange(sel.value);
    targetRow.appendChild(sel);
    fc.appendChild(targetRow);

    const help = document.createElement("div");
    help.style.cssText = "font-size:11px;color:#9fb3da;margin-top:8px;line-height:1.5;";
    help.innerHTML = "<b>Flight keys</b><br>← → tilt rocket<br>↑ ↓ throttle &nbsp;·&nbsp; Z full / X cut<br>Space stage &nbsp;·&nbsp; , . time-warp<br><b>M</b> map view &nbsp;·&nbsp; <b>P</b> parachute<br>scroll or <b>+ −</b> zoom (both views)";
    fc.appendChild(help);

    // Guide-arrow toggles.
    const guides = document.createElement("div");
    guides.style.cssText = "margin-top:8px;font-size:11px;color:#9fb3da;";
    guides.appendChild(document.createTextNode("Guides:"));
    guides.appendChild(document.createElement("br"));
    const mkChk = (label, which, color) => {
      const wrap = document.createElement("label");
      wrap.style.cssText = "display:inline-flex;align-items:center;gap:3px;margin-right:8px;cursor:pointer;color:" + color + ";";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true;
      cb.onchange = () => this.handlers.onToggleArrow && this.handlers.onToggleArrow(which, cb.checked);
      wrap.appendChild(cb); wrap.appendChild(document.createTextNode(label));
      return wrap;
    };
    guides.appendChild(mkChk("Aim", "target", "#ffd24a"));
    guides.appendChild(mkChk("Nose", "heading", "#6fd0ff"));
    guides.appendChild(mkChk("Going", "prograde", "#6effa0"));
    fc.appendChild(guides);

    // World toggle — not wired yet (true-scale universe is a future challenge mode).
    const earthToggle = document.createElement("button");
    earthToggle.textContent = "🌍 Training scale";
    earthToggle.title = "Real scale — coming soon!";
    earthToggle.disabled = true;
    earthToggle.style.cssText = "margin-top:10px;opacity:0.6;cursor:not-allowed;font-size:12px;";
    c.appendChild(earthToggle);
    const soon = document.createElement("div");
    soon.textContent = "Real scale — coming soon";
    soon.style.cssText = "font-size:10px;color:#7f8bb0;margin-top:3px;";
    c.appendChild(soon);
  },
  // stats: from computeStats (build mode). sim: SimState (flight mode).
  renderStats(stats, sim) {
    const row = (k, v) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`;
    let html = "";
    if (stats) {
      html += row("Total mass", stats.totalMass.toFixed(2) + " t");
      html += row("Thrust", stats.thrust.toFixed(0) + " kN");
      html += row("TWR", stats.twr.toFixed(2) + (stats.twr < 1 ? " ⚠️" : ""));
      html += row("Δv", stats.deltaV.toFixed(0) + " m/s");
      html += row("Stages", stats.stageCount);
    }
    if (sim && sim.mode === "flight") {
      html += `<hr style="border-color:#24304d">`;
      html += row("Status", sim.status);
      html += row("Around", sim.soi || "—");
      html += row("Altitude", fmtDist(Math.max(0, sim.altitude)));
      html += row("Speed", sim.speed.toFixed(0) + " m/s");
      html += row("Throttle", Math.round((sim.craft.throttle || 0) * 100) + "%");
      html += row("Fuel", (sim.craft.fuelRemaining || 0).toFixed(2) + " t");
      if (sim.target && BODIES[sim.target] && sim.distTarget != null) {
        html += row("→ " + BODIES[sim.target].name, fmtDist(sim.distTarget));
      }
      if (sim.timeWarp > 1) html += row("Time warp", fmtWarp(sim.timeWarp) + (sim.warpLimited ? " ⏳" : ""));
      if ((sim.heat || 0) > 0.02) {
        const pct = Math.round(sim.heat * 100);
        html += row("Hull heat", pct + "%" + (sim.heat > 0.7 ? " 🔥⚠️" : sim.heat > 0.3 ? " 🔥" : ""));
      }
      if ((sim.craft.chuteCount || 0) > 0) {
        html += row("Parachute", sim.chuteOpen ? "☂ open" : (sim.craft.chuteDeployed ? "armed…" : "packed (P)"));
      }
      if (sim.orbit) {
        html += row("Apoapsis", isFinite(sim.orbit.apoapsis) ? fmtDist(sim.orbit.apoapsis) : "∞ (escaping)");
        html += row("Periapsis", fmtDist(sim.orbit.periapsis));
        html += row("Orbit?", sim.orbit.isOrbit ? "✅ stable" : "no");
      }
      if (sim.transfer && !sim.transfer.open) {
        html += row("Burn window", Math.round(sim.transfer.degToGo) + "° to go");
      } else if (sim.transfer && sim.transfer.open) {
        html += row("Burn window", "🔥 NOW — follow gold");
      }
      if (sim.course) {
        html += row("Closest pass", sim.course.onTarget
          ? "🎯 on target!"
          : fmtDist(sim.course.miss) + (sim.course.burnVec ? " → burn at gold" : ""));
      }
      html += `<div style="margin-top:6px;font-size:11px;line-height:1.5">` +
        `<span style="color:#ffd24a">▲ aim here</span><br>` +
        `<span style="color:#6fd0ff">▲ pointing (your nose)</span><br>` +
        `<span style="color:#6effa0">▲ going (prograde)</span><br>` +
        `<span style="color:#9fb3da">point your nose (cyan) at the gold arrow</span></div>`;
    }
    this.els.readouts.innerHTML = html || "<i>Build a rocket →</i>";
  },
};
