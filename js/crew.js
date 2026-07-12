// crew.js — the 🐍 ASTRONAUT COMPLEX (his ask): pick which Connies fly the next mission,
// and keep each Connie's flight log. Two doors open the same roster: the Astronaut Complex
// building at the Space Center, and the "🐍 Crew" button next to Launch.
//
// Crews are LINEUPS now (his ask: pods that hold three): tap Connies in order — #1 is the
// commander — and at launch the first `seats` of the lineup fly (Acorn pod seats 1, Trio
// Pod seats 3, Apollo-style). Empty seats get filled by Mission Control (random, no repeats).
//
// Science GROWS the program (Mom's ask: "what's the science for?"): recruits in
// connies.js RECRUITS graduate into the roster when his science total passes their
// milestone — locked cards show as 🎓 IN TRAINING with the goal number.
//
// Data lives in localStorage "spacesim.crew.v1":
//   { picks: ["Sally Slide", ...], log: { "Sally Slide": 3 } }
// picks = [] means "Surprise me!" (all seats random — the original behavior, the default).
// (An earlier in-branch shape used pick: "name" — normalize migrates it; it never shipped.)
//
// Same house rules as mods.js: storage is guarded (imports cleanly in node), bad saved data
// silently degrades to defaults, and a pick naming a Connie who no longer exists (he can
// edit connies.js!) is skipped instead of breaking the launch.

import { CONNIES, RECRUITS, pickConnie } from "./connies.js";

const LS_CREW = "spacesim.crew.v1";
const LS_SCIENCE = "spacesim.science.v1"; // read-only here; main.js owns the ledger
export const MAX_LINEUP = 3;              // biggest pod (Trio) seats 3

// What each specialty means — real jobs on real crews (the teaching payload).
// A Connie with no role (a kid-added one) flies as a Rookie.
export const ROLE_INFO = {
  Pilot:     { icon: "🕹", color: "#ffd24a", what: "Flies the ship by hand — launches, landings, dockings." },
  Scientist: { icon: "🔬", color: "#48e08a", what: "Runs the experiments — earns bonus Science at station consoles." },
  Engineer:  { icon: "🔧", color: "#ff9d5c", what: "Keeps the ship working — real crews never fly without a fixer." },
  Navigator: { icon: "🧭", color: "#7fb4ff", what: "Plots the course — the math that gets you there AND home." },
  Rookie:    { icon: "🌱", color: "#c9d6ec", what: "First flights — every astronaut starts somewhere." },
};
export function roleOf(c) {
  return c && c.role && ROLE_INFO[c.role] ? c.role : "Rookie";
}

// ---- storage (guarded; pure normalize is node-tested) ----
export function normalizeCrewData(raw) {
  const out = { picks: [], log: {} };
  if (!raw || typeof raw !== "object") return out;
  const src = Array.isArray(raw.picks) ? raw.picks
    : (typeof raw.pick === "string" ? [raw.pick] : []); // migrate the earlier single-pick shape
  for (const p of src) {
    if (typeof p === "string" && p.length <= 60 && !out.picks.includes(p)) out.picks.push(p);
    if (out.picks.length >= MAX_LINEUP) break;
  }
  if (raw.log && typeof raw.log === "object" && !Array.isArray(raw.log)) {
    for (const k of Object.keys(raw.log).slice(0, 64)) {
      const n = Math.floor(Number(raw.log[k]));
      if (typeof k === "string" && k.length <= 60 && isFinite(n) && n > 0) {
        out.log[k] = Math.min(n, 99999);
      }
    }
  }
  return out;
}
function load() {
  let raw = null;
  try { raw = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(LS_CREW)) : null; }
  catch { raw = null; }
  return normalizeCrewData(raw);
}
function save(data) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(LS_CREW, JSON.stringify(data)); }
  catch {}
}
let _data = load();

function science() {
  try { return (typeof localStorage !== "undefined" && parseInt(localStorage.getItem(LS_SCIENCE))) || 0; }
  catch { return 0; }
}
// Recruits whose milestone the given science total has reached (list is his editable file).
function graduatedRecruits(sci) {
  return RECRUITS.filter((r) => r && r.name && isFinite(r.joinsAt) && sci >= r.joinsAt);
}
function availableConnies() {
  const seen = new Set();
  const pool = [];
  for (const c of [...CONNIES, ...graduatedRecruits(science())]) {
    if (c && c.name && !seen.has(c.name)) { seen.add(c.name); pool.push(c); }
  }
  return pool;
}
function findAvailable(name) {
  return availableConnies().find((c) => c.name === name) || null;
}

// ---- roster overlay (DOM only inside functions — module stays node-importable) ----
let rosterEl = null;

// A little Connie portrait: coiled snake in a bubble helmet, hue seeded by the name.
function portraitSVG(name, silhouette) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = 70 + (h % 90);            // green-to-teal family — Connies are snakes
  const body = silhouette ? "#20304f" : `hsl(${hue},55%,45%)`;
  const belly = silhouette ? "#26385a" : `hsl(${hue},50%,62%)`;
  const face = silhouette ? "" : `
    <circle cx="40.5" cy="32" r="3.4" fill="#fff"/><circle cx="49.5" cy="32" r="3.4" fill="#fff"/>
    <circle cx="41.2" cy="32.7" r="1.7" fill="#0a1020"/><circle cx="50.2" cy="32.7" r="1.7" fill="#0a1020"/>
    <path d="M41 41 Q45 44 49 41" stroke="#0a1020" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M45 46 l0 4 M43 50 l2 0 l2 -1" stroke="#e0443f" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  return `
  <svg viewBox="0 0 90 90" style="width:74px;height:74px;display:block;margin:0 auto;">
    <ellipse cx="45" cy="72" rx="26" ry="10" fill="${body}"/>
    <ellipse cx="45" cy="63" rx="20" ry="8" fill="${belly}"/>
    <rect x="37" y="38" width="16" height="24" rx="8" fill="${body}"/>
    <circle cx="45" cy="34" r="13" fill="${body}"/>
    ${face}
    ${silhouette ? '<text x="45" y="39" text-anchor="middle" font-size="16" fill="#9fb3da">?</text>' : ""}
    <circle cx="45" cy="32" r="19" fill="rgba(160,200,255,0.12)" stroke="#bcd2f5" stroke-width="2"/>
    <path d="M33 24 A15 15 0 0 1 45 15" stroke="rgba(255,255,255,0.65)" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  </svg>`;
}

function card(inner, extraCss) {
  const d = document.createElement("div");
  d.style.cssText = "background:rgba(15,24,46,.94);border:2px solid #2f4470;border-radius:14px;" +
    "padding:12px 12px 10px;width:212px;text-align:center;cursor:pointer;transition:transform .08s,border-color .12s;" +
    (extraCss || "");
  d.innerHTML = inner;
  d.onmouseenter = () => { d.style.transform = "scale(1.03)"; };
  d.onmouseleave = () => { d.style.transform = ""; };
  return d;
}

const SEAT_BADGES = ["① commander", "② aboard next", "③ aboard next"];

function renderRoster(opts) {
  const wrap = rosterEl.querySelector(".crew-cards");
  wrap.innerHTML = "";
  const flying = opts.getCurrentCrewNames ? (opts.getCurrentCrewNames() || []) : [];

  // "Surprise me" — the dice card (empty lineup = every seat random, the classic way).
  const dice = card(`
    <div style="font-size:52px;line-height:74px;height:74px;">🎲</div>
    <div style="font-weight:800;font-size:16px;margin-top:6px;">Surprise me!</div>
    <div style="font-size:12px;color:#9fb3da;margin-top:4px;min-height:30px;">Mission Control fills every seat — any Connie could get the call.</div>`,
    _data.picks.length === 0 ? "border-color:#ffd24a;box-shadow:0 0 18px rgba(255,210,74,.25);" : "");
  if (_data.picks.length === 0) dice.innerHTML += `<div style="font-size:12px;color:#ffd24a;font-weight:700;margin-top:6px;">✔ flying next</div>`;
  dice.onclick = () => { Crew.clearPicks(); renderRoster(opts); if (opts.onPick) opts.onPick(); };
  wrap.appendChild(dice);

  for (const c of Crew.roster()) {
    const role = roleOf(c);
    const ri = ROLE_INFO[role];
    // Still in training: a mystery card with the science goal — that's what science is for!
    if (c.locked) {
      wrap.appendChild(card(`
        ${portraitSVG(c.name, true)}
        <div style="font-weight:800;font-size:16px;margin-top:4px;color:#9fb3da;">? ? ?</div>
        <div style="font-size:12px;font-weight:700;color:#9fb3da;margin-top:3px;">🎓 IN TRAINING</div>
        <div style="font-size:12px;color:#c9d6ec;margin-top:4px;min-height:30px;">A new astronaut joins the program at <b style="color:#48e08a">${c.joinsAt} 🔬 science</b>.</div>
        <div style="font-size:12px;color:#9fb3da;margin-top:5px;">You have: <b style="color:#e8eefc">${science()}</b></div>
        <div style="font-size:11px;color:#7e90b8;font-style:italic;margin-top:6px;min-height:42px;">Run experiments aboard stations — discoveries grow a space program.</div>
        <div style="font-size:12px;color:#5f6f97;margin-top:4px;">keep exploring!</div>`,
        "opacity:0.85;cursor:default;"));
      continue;
    }
    const seat = _data.picks.indexOf(c.name);
    const isFlying = flying.includes(c.name);
    const el = card(`
      ${portraitSVG(c.name)}
      <div style="font-weight:800;font-size:16px;margin-top:4px;">${c.name}</div>
      <div style="font-size:12px;font-weight:700;color:${ri.color};margin-top:3px;">${ri.icon} ${role.toUpperCase()}</div>
      <div style="font-size:12px;color:#c9d6ec;margin-top:4px;min-height:30px;">${c.skill || ri.what}</div>
      <div style="font-size:12px;color:#9fb3da;margin-top:5px;">Missions flown: <b style="color:#e8eefc">${c.missions}</b></div>
      <div style="font-size:11px;color:#7e90b8;font-style:italic;margin-top:6px;min-height:42px;">${c.hero || ""}</div>
      ${isFlying ? `<div style="font-size:12px;color:#48e08a;font-weight:700;margin-top:4px;">🚀 ON A MISSION</div>`
               : seat >= 0 ? `<div style="font-size:12px;color:#ffd24a;font-weight:700;margin-top:4px;">✔ ${SEAT_BADGES[seat]}</div>`
               : `<div style="font-size:12px;color:#5f6f97;margin-top:4px;">tap to add to the crew</div>`}`,
      seat >= 0 ? "border-color:#ffd24a;box-shadow:0 0 18px rgba(255,210,74,.25);" : "");
    el.onclick = () => { Crew.togglePick(c.name); renderRoster(opts); if (opts.onPick) opts.onPick(); };
    wrap.appendChild(el);
  }
}

function showRoster(opts = {}) {
  hideRoster();
  const el = document.createElement("div");
  rosterEl = el;
  el.style.cssText = "position:absolute;inset:0;z-index:34;overflow-y:auto;" +
    "background:radial-gradient(120% 90% at 50% 110%, #14264f 0%, #0a1226 45%, #04060f 100%);" +
    "font-family:system-ui,-apple-system,sans-serif;color:#e8eefc;padding:26px 12px 90px;";
  el.innerHTML = `
    <div style="text-align:center;">
      <div class="ksp-title-word" style="font-size:clamp(24px,3.6vw,40px);font-weight:900;letter-spacing:.06em;">🐍 ASTRONAUT COMPLEX</div>
      <div style="font-size:13px;color:#9fb3da;margin-top:6px;max-width:680px;margin-left:auto;margin-right:auto;">
        Every Connie is named for a REAL astronaut, with that hero's real job.
        Tap up to ${MAX_LINEUP} to build your crew — #1 is the commander. Seats depend on the pod
        (Acorn seats 1, Trio Pod seats 3, like Apollo); Mission Control fills any empty seat.
      </div>
    </div>
    <div class="crew-cards" style="display:flex;flex-wrap:wrap;gap:14px;justify-content:center;max-width:1200px;margin:22px auto 0;"></div>`;
  const back = document.createElement("button");
  back.textContent = "⬅ Back";
  back.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:35;" +
    "width:220px;padding:12px 18px;font-size:16px;font-weight:700;color:#e8eefc;cursor:pointer;" +
    "background:rgba(27,42,74,.95);border:1px solid #3a5590;border-radius:12px;";
  back.onclick = () => { hideRoster(); if (opts.onClose) opts.onClose(); };
  el.appendChild(back);
  document.getElementById("app").appendChild(el);
  renderRoster(opts);
}
function hideRoster() {
  if (rosterEl) { rosterEl.remove(); rosterEl = null; }
}

export const Crew = {
  // ---- the lineup (ordered; [0] is the commander; [] = Surprise-me) ----
  lineup() { return [..._data.picks]; },
  togglePick(name) {
    if (typeof name !== "string" || !findAvailable(name)) return _data.picks;
    const i = _data.picks.indexOf(name);
    if (i >= 0) _data.picks.splice(i, 1);          // tap again = step out of the lineup
    else {
      if (_data.picks.length >= MAX_LINEUP) _data.picks.pop(); // full: newest pick takes the last seat
      _data.picks.push(name);
    }
    save(_data);
    return [..._data.picks];
  },
  clearPicks() { _data.picks = []; save(_data); },
  // The launch call: his lineup (skipping any Connie who no longer exists), truncated to
  // the pod's seats, then Mission Control fills the rest randomly — a launch never breaks.
  chooseCrewForLaunch(seatCount) {
    const seats = Math.max(1, Math.min(Math.floor(seatCount) || 1, 8));
    const crew = [];
    for (const n of _data.picks) {
      const c = findAvailable(n);
      if (c && !crew.includes(c)) crew.push(c);
      if (crew.length >= seats) break;
    }
    const rest = availableConnies().filter((c) => !crew.includes(c));
    while (crew.length < seats && rest.length) {
      crew.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
    }
    return crew.length ? crew : [pickConnie()]; // belt & braces: someone always flies
  },
  chooseForLaunch() { return Crew.chooseCrewForLaunch(1)[0]; }, // single-seat convenience
  recordMission(name) {
    if (typeof name !== "string" || !name) return;
    _data.log[name] = Math.min((_data.log[name] || 0) + 1, 99999);
    save(_data);
  },
  missions(name) { return _data.log[name] || 0; },
  // Everyone, for the roster: available Connies (with counts) + locked recruits in order.
  roster() {
    const out = availableConnies().map((c) => ({ ...c, role: roleOf(c), missions: Crew.missions(c.name) }));
    for (const r of RECRUITS) {
      if (r && r.name && isFinite(r.joinsAt) && science() < r.joinsAt) {
        out.push({ name: r.name, joinsAt: r.joinsAt, locked: true });
      }
    }
    return out;
  },
  // ---- science → new astronauts (what the science is FOR) ----
  // Recruits whose milestone was crossed by this award: prev < joinsAt <= now.
  newGraduates(prevScience, nowScience) {
    return RECRUITS.filter((r) => r && r.name && isFinite(r.joinsAt) &&
      prevScience < r.joinsAt && nowScience >= r.joinsAt);
  },
  nextRecruitInfo() {
    const sci = science();
    const next = RECRUITS.filter((r) => r && isFinite(r.joinsAt) && r.joinsAt > sci)
      .sort((a, b) => a.joinsAt - b.joinsAt)[0];
    return next ? { at: next.joinsAt, have: sci } : null;
  },
  showRoster,
  hideRoster,
  isOpen() { return !!rosterEl; },
  _reload() { _data = load(); }, // tests
};
