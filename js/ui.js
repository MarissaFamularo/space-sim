// ui.js — PM-owned. Live readouts + mode/flight controls. Reads SimState + Stats.

import { BODIES, PLANET_KEYS, STATIONS, SYSTEM } from "./state.js";
import { FAMOUS_LIST } from "./famous.js";

// Destinations for the target picker, derived from the ACTIVE system (the Starmap can
// swap it): home's moon first (the tutorial trip), then the other planets outward with
// their moons indented under them (capture at the planet first, then hop), home last.
function buildTargets() {
  const targets = [], moonOf = {};
  const planets = PLANET_KEYS.filter((k) => BODIES[k].parent === "sun")
    .sort((a, b) => BODIES[a].orbitRadius - BODIES[b].orbitRadius);
  const moonsOf = (p) => PLANET_KEYS.filter((k) => BODIES[k].parent === p)
    .sort((a, b) => BODIES[a].orbitRadius - BODIES[b].orbitRadius);
  for (const m of moonsOf("earth")) targets.push(m);
  for (const p of planets) {
    if (p === "earth") continue;
    targets.push(p);
    // Skip "earth" here: in systems where home is itself a MOON of a gas giant
    // (Pandora!), it would otherwise show up twice — it always goes last, as home.
    for (const m of moonsOf(p)) { if (m === "earth") continue; targets.push(m); moonOf[m] = p; }
  }
  targets.push("earth");
  return { targets, moonOf };
}

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
  // handlers: onLaunch, onReset, onModeChange, onToggleMap, onToggleArrow,
  // onTargetChange, onTeleport, onStarmapTravel, onStarmapHome, getVisitedSystems.
  init(handlers) {
    this.els.readouts = document.getElementById("readout-list");
    this.els.controls = document.getElementById("control-list");
    this.handlers = handlers;
    this._renderControls();
    // Panels fold to just their title bar (his report: they cover things / eat view).
    // Click the header to toggle; the choice is remembered between sessions.
    this._wireCollapse("controls", "spacesim.modeBoxCollapsed", ["control-list"]);
    this._wireCollapse("copilot", "spacesim.navBoxCollapsed", ["copilot-log", "copilot-row"],
      { shrinkWidth: true, notify: "copilot-log" });
  },
  // Generic collapsible panel: panelId's <h3> becomes the toggle; childIds hide when
  // folded. opts.shrinkWidth lets the panel narrow to its title; opts.notify watches
  // that element for new children while folded and shows a gold ● (so a collapsed
  // Navigator can't silently swallow a "you're in orbit!" callout).
  _wireCollapse(panelId, storageKey, childIds, opts = {}) {
    const panel = document.getElementById(panelId);
    const h = panel && panel.querySelector("h3");
    if (!h || h.dataset.collapsible) return;
    h.dataset.collapsible = "1";
    h.style.cssText += "cursor:pointer;user-select:none;";
    const chev = document.createElement("span");
    chev.style.cssText = "float:right;font-size:11px;color:#9fb3da;font-weight:600;" +
      "text-transform:none;letter-spacing:0;margin-left:10px;";
    h.appendChild(chev);
    let collapsed = false, unseen = false;
    const apply = () => {
      for (const id of childIds) {
        const el = document.getElementById(id);
        if (el) el.style.display = collapsed ? "none" : "";
      }
      h.style.marginBottom = collapsed ? "0" : "";
      if (opts.shrinkWidth) panel.style.width = collapsed ? "auto" : "";
      if (!collapsed) unseen = false;
      chev.innerHTML = collapsed
        ? "▸ open" + (unseen ? " <span style='color:#ffd24a'>●</span>" : "")
        : "▾ hide";
      try { localStorage.setItem(storageKey, collapsed ? "1" : ""); } catch {}
    };
    try { collapsed = localStorage.getItem(storageKey) === "1"; } catch {}
    apply();
    h.addEventListener("click", (e) => {
      // Only the header itself (or the chevron) toggles — buttons that live in the
      // header, like the Navigator's 🔑, keep doing their own job.
      if (e.target !== h && e.target !== chev) return;
      collapsed = !collapsed;
      apply();
    });
    if (opts.notify) {
      const watched = document.getElementById(opts.notify);
      if (watched) new MutationObserver(() => {
        if (collapsed && !unseen) { unseen = true; apply(); }
      }).observe(watched, { childList: true });
    }
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
    // Back to the Konnie Space Center (title/menu/tracking live behind this door).
    const kscBtn = document.createElement("button");
    kscBtn.textContent = "🏢 Space Center";
    kscBtn.style.cssText = "width:100%;margin-bottom:6px;";
    kscBtn.onclick = () => this.handlers.onSpaceCenter && this.handlers.onSpaceCenter();
    c.appendChild(kscBtn);
    mk("Build", () => this.handlers.onModeChange && this.handlers.onModeChange("build"));
    mk("🚀 Launch", () => this.handlers.onLaunch && this.handlers.onLaunch());
    mk("Reset", () => this.handlers.onReset && this.handlers.onReset());

    // Which system are we in? (The Starmap changes this.)
    const sysLabel = document.createElement("div");
    this.els.sysLabel = sysLabel;
    sysLabel.style.cssText = "font-size:11px;color:#9fb3da;margin:6px 0 0;";
    sysLabel.textContent = "🌌 " + SYSTEM.name;
    c.appendChild(sysLabel);

    // 🎯 Target picker + ✨ Teleport — visible in BOTH modes: pick a world, fly or jump.
    const targetRow = document.createElement("div");
    targetRow.style.cssText = "margin-top:8px;display:flex;align-items:center;gap:6px;font-size:12px;color:#9fb3da;";
    targetRow.appendChild(document.createTextNode("🎯"));
    const sel = document.createElement("select");
    this.els.targetSel = sel;
    sel.style.cssText = "flex:1;background:#0a1020;color:#e8eefc;border:1px solid #24304d;" +
      "border-radius:5px;padding:3px 4px;font-size:12px;";
    this.rebuildTargets();
    sel.onchange = () => this.handlers.onTargetChange && this.handlers.onTargetChange(sel.value);
    targetRow.appendChild(sel);
    c.appendChild(targetRow);

    const tpBtn = document.createElement("button");
    tpBtn.textContent = "✨ Teleport";
    tpBtn.title = "Magic-jump straight into orbit around the 🎯 world";
    tpBtn.style.cssText = "margin-top:6px;width:100%;";
    tpBtn.onclick = () => this.handlers.onTeleport && this.handlers.onTeleport(sel.value);
    c.appendChild(tpBtn);

    // 🌌 Starmap — type any name, get THAT star system. The name is the share code.
    const smBtn = document.createElement("button");
    smBtn.textContent = "🌌 Starmap";
    smBtn.title = "Travel to another star system — any name you invent is a real system";
    smBtn.style.cssText = "margin-top:6px;width:100%;";
    smBtn.onclick = () => this._toggleStarmap();
    c.appendChild(smBtn);

    // Map view works from the pad too (check transfer windows before you build!).
    const mapBtn = document.createElement("button");
    this.els.mapBtn = mapBtn;
    mapBtn.textContent = "🗺 Map view";
    mapBtn.style.cssText = "margin-top:6px;width:100%;";
    mapBtn.onclick = () => {
      const on = this.handlers.onToggleMap && this.handlers.onToggleMap();
      this.syncMapButton(on);
    };
    c.appendChild(mapBtn);

    // Flight-only controls — hidden in build mode.
    const fc = document.createElement("div");
    this.els.flightControls = fc;
    fc.style.display = "none";
    c.appendChild(fc);

    const help = document.createElement("div");
    help.style.cssText = "font-size:11px;color:#9fb3da;margin-top:8px;line-height:1.5;";
    help.innerHTML = "<b>Flight keys</b><br>← → tilt rocket<br>↑ ↓ throttle &nbsp;·&nbsp; Z full / X cut<br>Space stage &nbsp;·&nbsp; , . time-warp<br><b>M</b> map view &nbsp;·&nbsp; <b>P</b> parachute<br>scroll or <b>+ −</b> zoom (both views)<br><b>drag</b> — look around your ship";
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
  // (Re)fill the target picker from the ACTIVE system — called after Starmap jumps.
  rebuildTargets() {
    const sel = this.els.targetSel;
    if (!sel) return;
    const { targets, moonOf } = buildTargets();
    sel.innerHTML = "";
    for (const key of targets) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = (moonOf[key] ? "  · " : "") + BODIES[key].name + (key === "earth" ? " (home)" : "");
      sel.appendChild(opt);
    }
    for (const st of STATIONS) { // stations: teleport right next to them, then dock
      const opt = document.createElement("option");
      opt.value = "station:" + st.id;
      opt.textContent = (st.abandoned ? "⚠ " : "🛰 ") + st.name + (st.yours ? " (yours!)" : "");
      sel.appendChild(opt);
    }
    sel.value = targets.includes("moon") ? "moon" : targets[0];
    if (this.els.sysLabel) this.els.sysLabel.textContent = "🌌 " + SYSTEM.name;
  },
  currentTarget() { return this.els.targetSel ? this.els.targetSel.value : "moon"; },
  syncMapButton(on) {
    if (this.els.mapBtn) this.els.mapBtn.textContent = on ? "🚀 Ship view" : "🗺 Map view";
  },

  _toggleStarmap() {
    if (this.els.starmap) { this.els.starmap.remove(); this.els.starmap = null; return; }
    const panel = document.createElement("div");
    this.els.starmap = panel;
    panel.className = "panel";
    panel.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "width:320px;z-index:20;";
    const h = document.createElement("h3");
    h.textContent = "🌌 Starmap";
    panel.appendChild(h);
    const blurb = document.createElement("div");
    blurb.style.cssText = "font-size:12px;color:#9fb3da;line-height:1.5;margin-bottom:8px;";
    blurb.innerHTML = "Name a star — <i>any</i> name — and that system exists. The same " +
      "name is always the same system, for everyone: names are share codes.";
    panel.appendChild(blurb);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;";
    const input = document.createElement("input");
    input.placeholder = "Name a star… (e.g. Snakestar)";
    input.style.cssText = "flex:1;background:#0a1020;border:1px solid #24304d;color:#e8eefc;" +
      "border-radius:6px;padding:6px 8px;font-size:13px;";
    const go = document.createElement("button");
    go.textContent = "Fly!";
    const fire = () => {
      const v = input.value.trim();
      if (!v) return;
      this._toggleStarmap();
      this.handlers.onStarmapTravel && this.handlers.onStarmapTravel(v);
    };
    go.onclick = fire;
    input.onkeydown = (e) => { if (e.key === "Enter") fire(); };
    row.appendChild(input); row.appendChild(go);
    panel.appendChild(row);

    // ⭐ Famous systems — the universe comes pre-populated with a few legends.
    const fh = document.createElement("div");
    fh.style.cssText = "font-size:11px;color:#9fb3da;margin:10px 0 4px;";
    fh.textContent = "Famous systems:";
    panel.appendChild(fh);
    for (const f of FAMOUS_LIST) {
      const b = document.createElement("button");
      b.innerHTML = "🌟 <b>" + f.name + "</b><br><span style='font-size:11px;color:#9fb3da'>" + f.hint + "</span>";
      b.style.cssText = "display:block;width:100%;margin-top:4px;text-align:left;font-size:12px;line-height:1.35;";
      b.onclick = () => { this._toggleStarmap(); this.handlers.onStarmapTravel && this.handlers.onStarmapTravel(f.seed); };
      panel.appendChild(b);
    }

    const visited = (this.handlers.getVisitedSystems && this.handlers.getVisitedSystems()) || [];
    if (visited.length) {
      const vh = document.createElement("div");
      vh.style.cssText = "font-size:11px;color:#9fb3da;margin:10px 0 4px;";
      vh.textContent = "Places you've been:";
      panel.appendChild(vh);
      for (const v of visited.slice(0, 8)) {
        const b = document.createElement("button");
        b.textContent = "⭐ " + v.seed;
        b.style.cssText = "display:block;width:100%;margin-top:4px;text-align:left;font-size:12px;";
        b.onclick = () => { this._toggleStarmap(); this.handlers.onStarmapTravel && this.handlers.onStarmapTravel(v.seed); };
        panel.appendChild(b);
      }
    }
    const home = document.createElement("button");
    home.textContent = "🏠 Return to the Solar System";
    home.style.cssText = "margin-top:10px;width:100%;";
    home.onclick = () => { this._toggleStarmap(); this.handlers.onStarmapHome && this.handlers.onStarmapHome(); };
    panel.appendChild(home);
    const close = document.createElement("button");
    close.textContent = "✕ Close";
    close.style.cssText = "margin-top:6px;width:100%;font-size:12px;";
    close.onclick = () => this._toggleStarmap();
    panel.appendChild(close);
    document.getElementById("app").appendChild(panel);
    input.focus();
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
      if ((sim.craft.legCount || 0) > 0) html += row("Landing legs", "🦵 ok under 12 m/s");
      if ((sim.craft.dockCount || 0) > 0) html += row("Docking port", "🛰 ready");
      if ((sim.craft.wingCount || 0) > 0) html += row("Wings", "✈ lift (needs air)");
      if ((sim.craft.shieldCount || 0) > 0) html += row("Heat shield", "🛡 soaking the heat");
      if ((sim.craft.stationCount || 0) > 0) html += row("Station hub", "🛰 deployable in orbit");
      if (sim.satellites && sim.satellites.length) html += row("Satellites", "🛰 " + sim.satellites.length + " in orbit");
      if (sim.stationNear) {
        html += row(sim.stationNear.abandoned ? "⚠ " + sim.stationNear.name : "🛰 " + sim.stationNear.name,
          sim.stationNear.docked ? "DOCKED ✅" : fmtDist(sim.stationNear.dist) +
            (sim.stationNear.dist < 5000 ? " · " + sim.stationNear.rel.toFixed(0) + " m/s rel" : ""));
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
    if (sim && sim.science > 0) html += row("🔬 Science", sim.science);
    this.els.readouts.innerHTML = html || "<i>Build a rocket →</i>";
  },
};
