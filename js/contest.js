// contest.js — 🔨 THE ROCKET FORGE DUELS (his spec: the Halo Ring's tunnels hold
// "mini battles… a rocket building contest. best score wins").
//
// The duel is the rocket equation wearing a game face: pick up to 6 parts, and your
// score IS your rocket's Δv — the real Tsiolkovsky number, same math the flight sim
// runs. The catch is the forge's fairness rule: the rocket must be able to LIFT OFF
// from Pandora below (thrust must beat weight at 7.85 m/s²), so "all fuel, tiny
// engine" honestly never leaves the pad. Beat every forge bot and the builders hand
// over their PELICAN — the vehicle-carrier craft file.
//
// DESIGN RULES (same as mods.js): everything kid-facing returns { ok, error } with a
// friendly message, never throws; scoring is PURE (node-testable, no DOM); storage is
// guarded try/catch. The Pelican unlock lives in its OWN new key (frozen Rule 2 —
// his five old keys are untouched).

const LS_PELICAN = "spacesim.pelican.v1";

// The duel is chemistry-class fair: everyone forges with the same chemical parts.
// (Ion drives and torches would win on exhaust velocity alone — the forge bots call
// that cheating, and they're right: it'd steal the tradeoff the duel teaches.)
export const CONTEST_IDS = [
  "command_pod", "probe_core",
  "tank_small", "tank_large", "tank_mega",
  "engine_sparrow", "engine_hawk", "engine_osprey", "engine_crane",
  "parachute", "landing_legs", "fin",
];
export const MAX_PARTS = 6;

// Pandora's surface gravity — the liftoff bar the forge judges against. famous.js
// defines Pandora with this exact g0; contest_test asserts they never drift apart.
export const PANDORA_G0 = 7.85;

// The forge bots. Fixed scores (a duel needs a target you can SEE), climbing to the
// champion. Beat ALL of them — ties lose, "best score wins" means best.
export const RIVALS = [
  { name: "Rustbolt", emoji: "🤖", score: 4800,
    taunt: "One engine, two tanks, no imagination." },
  { name: "Gearspark", emoji: "⚙️", score: 6200,
    taunt: "More fuel makes more speed… mostly." },
  { name: "Vex, Forge Champion", emoji: "🏆", score: 7000,
    taunt: "A thousand years undefeated. Bring real rocket science." },
];
export const CHAMPION_SCORE = RIVALS[RIVALS.length - 1].score;

// =====================================================================
// PURE: score a stack of part ids exactly the way the flight sim will fly it
// (main.js loadStage): thrust sums, exhaust velocity averages across engines,
// every part's fuelMass feeds the same shared tank. Δv = ve · ln(m0/m1).
// =====================================================================
export function scoreStack(stack, catalog) {
  if (!Array.isArray(stack) || stack.length === 0)
    return { ok: false, error: "Pick some parts first — a rocket made of nothing scores nothing!" };
  if (stack.length > MAX_PARTS)
    return { ok: false, error: "Forge rule: " + MAX_PARTS + " parts, no more. A duel is won with choices, not piles." };
  let m0 = 0, fuel = 0, thrust = 0, veSum = 0, engines = 0, hasCommand = false;
  for (const id of stack) {
    if (!CONTEST_IDS.includes(id))
      return { ok: false, error: "The forge rules say chemical parts only — " + JSON.stringify(id) + " isn't on the duel shelf." };
    const def = (catalog || []).find((p) => p.id === id);
    if (!def) return { ok: false, error: "I can't find the part " + JSON.stringify(id) + " in the catalog." };
    m0 += (def.dryMass || 0) + (def.fuelMass || 0);
    fuel += def.fuelMass || 0;
    if (def.type === "engine") { thrust += def.thrust || 0; veSum += def.exhaustVelocity || 0; engines++; }
    if (def.type === "command") hasCommand = true;
  }
  if (engines === 0)
    return { ok: false, error: "No engine! Even the mightiest fuel tank just sits there looking heavy." };
  if (!hasCommand)
    return { ok: false, error: "Every forge rocket needs a brain — add a Command Pod or a Probe Core." };
  const ve = veSum / engines;
  const m1 = m0 - fuel;                    // dry mass at burnout — always > 0 (parts weigh something)
  const dv = fuel > 0 ? ve * Math.log(m0 / m1) : 0;
  const twr = thrust / (m0 * PANDORA_G0);  // kN over (t · m/s²) — same units as sim.stageWeightKN
  return {
    ok: true, m0, m1, fuel, thrust, ve, engines,
    twr, liftsOff: twr >= 1.0,
    dv: Math.round(dv),
    // The SCORE only counts if the rocket honestly flies: TWR ≥ 1 at Pandora.
    score: twr >= 1.0 ? Math.round(dv) : 0,
  };
}

export function beatsChampion(score) { return score > CHAMPION_SCORE; }

// =====================================================================
// 🚚 THE PELICAN — the prize craft file. A vehicle carrier: belly boosters on the
// bottom for takeoff and landing, a cruise drive for going places, a Rover in the
// bay, legs to stand on. Its two engines carry engineMode tags — main.js lets
// SHIFT switch which group burns (real ships do exactly this: lift engines and
// cruise engines are different machines).
// The craft ships as a standard share-code (v:1) so it rides the proven
// importCraft path; its two special engines travel in myParts.
// =====================================================================
export const PELICAN_PARTS = [
  {
    id: "pelican_lift", type: "engine", name: "Pelican Belly Boosters",
    dryMass: 1.0, thrust: 800, exhaustVelocity: 2600, engineMode: "lift",
    height: 0.9, radius: 0.9, shape: "crane",
    attachTop: true, attachBottom: false,
  },
  {
    id: "pelican_main", type: "engine", name: "Pelican Cruise Drive",
    dryMass: 1.0, thrust: 260, exhaustVelocity: 4800, engineMode: "cruise",
    height: 1.2, radius: 0.8, shape: "nozzle",
    attachTop: true, attachBottom: true,
  },
];

export const PELICAN_CODE = JSON.stringify({
  v: 1,
  name: "Pelican",
  stack: ["pelican_lift", "landing_legs", "tank_mega", "pelican_main",
          "rover", "cockpit_swift", "parachute"],
  myParts: PELICAN_PARTS,
});

// =====================================================================
// Persistence — spacesim.pelican.v1, a NEW key (frozen Rule 2). Garbage-tolerant:
// a mangled save degrades to "not unlocked yet", never a crash.
// =====================================================================
export function parsePelicanSave(raw) {
  if (!raw) return { v: 1, unlocked: false, best: 0 };
  let d;
  try { d = JSON.parse(raw); } catch { return { v: 1, unlocked: false, best: 0 }; }
  if (!d || typeof d !== "object") return { v: 1, unlocked: false, best: 0 };
  return {
    v: 1,
    unlocked: d.unlocked === true,
    best: (typeof d.best === "number" && isFinite(d.best) && d.best > 0) ? Math.round(d.best) : 0,
  };
}

export function loadPelican() {
  let raw = null;
  try { raw = (typeof localStorage !== "undefined") ? localStorage.getItem(LS_PELICAN) : null; }
  catch { /* storage blocked: play on without the save */ }
  return parsePelicanSave(raw);
}

export function savePelican(state) {
  const clean = { v: 1, unlocked: state.unlocked === true, best: Math.round(state.best || 0) };
  try { if (typeof localStorage !== "undefined") localStorage.setItem(LS_PELICAN, JSON.stringify(clean)); }
  catch { /* storage full/blocked: the win still counts this session */ }
  return clean;
}

// =====================================================================
// The forge panel (DOM — browser only; node tests never call down here).
// A big friendly overlay: pick parts on the left, watch the stack and the LIVE
// score on the right, then JUDGE. Retry lives inside the panel, so losing costs
// one click, never a walk back to the anvil.
// =====================================================================
let _el = null, _shelfEl = null, _stackEl = null, _readoutEl = null, _rivalsEl = null,
    _msgEl = null, _judgeBtn = null;
let _stack = [], _catalog = null, _cbs = null;

// While the forge is open, the station interior's keys sleep (capture-phase wall —
// otherwise arrow taps walk the Connie and E would exit the station under the panel).
function blockKeys(e) { e.stopPropagation(); }

const TYPE_EMOJI = { engine: "🔥", tank: "⛽", command: "🧠", chute: "☂", legs: "🦵", fin: "🪽" };
function partLine(def) {
  if (def.type === "engine")
    return (def.fuelMass ? "⛽" + def.fuelMass + " t · " : "") + "⬆ " + def.thrust + " kN · 💨 " + def.exhaustVelocity + " m/s";
  if (def.type === "tank") return "⛽ " + def.fuelMass + " t of fuel";
  if (def.type === "command") return (def.uncrewed ? "🤖 robot brain" : "🐍 crew brain") + " · " + def.dryMass + " t";
  return def.dryMass + " t";
}

function ensurePanel() {
  if (_el) return;
  _el = document.createElement("div");
  _el.style.cssText = "position:fixed;inset:0;display:none;z-index:40;background:rgba(4,8,18,0.72);" +
    "font:14px system-ui,sans-serif;color:#cfe0ff;";
  const card = document.createElement("div");
  card.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
    "width:min(720px,94vw);max-height:92vh;overflow:auto;background:rgba(12,18,34,0.97);" +
    "border:1px solid #c8a84a;border-radius:12px;padding:16px 18px;";
  card.innerHTML = "<div style='font:800 20px system-ui;color:#ffd870;margin-bottom:2px'>🔨 THE ROCKET FORGE — BUILD-OFF</div>" +
    "<div style='color:#9fb3da;margin-bottom:10px'>Up to <b>6 parts</b>. Your score is your rocket's real " +
    "<b>Δv</b> — exhaust speed × ln(full ÷ empty), the rocket equation — and it must be able to " +
    "<b>lift off from Pandora</b> below (thrust beats weight). Best score wins.</div>";
  _rivalsEl = document.createElement("div");
  _rivalsEl.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;";
  card.appendChild(_rivalsEl);
  const cols = document.createElement("div");
  cols.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:12px;";
  const left = document.createElement("div");
  left.innerHTML = "<div style='font-weight:700;color:#ffd870;margin-bottom:4px'>THE DUEL SHELF</div>";
  _shelfEl = document.createElement("div");
  left.appendChild(_shelfEl);
  const right = document.createElement("div");
  right.innerHTML = "<div style='font-weight:700;color:#ffd870;margin-bottom:4px'>YOUR ROCKET <span style='color:#9fb3da;font-weight:400'>(top part sits highest)</span></div>";
  _stackEl = document.createElement("div");
  _stackEl.style.cssText = "min-height:120px;display:flex;flex-direction:column-reverse;gap:4px;margin-bottom:8px;";
  right.appendChild(_stackEl);
  _readoutEl = document.createElement("div");
  _readoutEl.style.cssText = "border:1px solid #24304d;border-radius:8px;padding:8px 10px;background:rgba(8,12,24,0.8);";
  right.appendChild(_readoutEl);
  cols.appendChild(left); cols.appendChild(right);
  card.appendChild(cols);
  _msgEl = document.createElement("div");
  _msgEl.style.cssText = "margin-top:10px;min-height:20px;color:#9fb3da;";
  card.appendChild(_msgEl);
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:10px;margin-top:8px;";
  _judgeBtn = document.createElement("button");
  _judgeBtn.textContent = "🏁 JUDGE MY ROCKET";
  _judgeBtn.style.cssText = "flex:1;padding:10px;font:800 16px system-ui;background:#c8a84a;color:#1a1408;" +
    "border:none;border-radius:8px;cursor:pointer;";
  _judgeBtn.addEventListener("click", judge);
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "🧹 Clear";
  clearBtn.style.cssText = "padding:10px 14px;background:#24304d;color:#cfe0ff;border:none;border-radius:8px;cursor:pointer;";
  clearBtn.addEventListener("click", () => { _stack = []; refresh(); });
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Leave the forge";
  closeBtn.style.cssText = "padding:10px 14px;background:#24304d;color:#cfe0ff;border:none;border-radius:8px;cursor:pointer;";
  closeBtn.addEventListener("click", closeForgePanel);
  btnRow.appendChild(_judgeBtn); btnRow.appendChild(clearBtn); btnRow.appendChild(closeBtn);
  card.appendChild(btnRow);
  _el.appendChild(card);
  document.body.appendChild(_el);
}

function refresh() {
  // Shelf: one button per allowed part.
  _shelfEl.innerHTML = "";
  for (const id of CONTEST_IDS) {
    const def = _catalog.find((p) => p.id === id);
    if (!def) continue;
    const b = document.createElement("button");
    b.style.cssText = "display:block;width:100%;text-align:left;margin:3px 0;padding:6px 8px;" +
      "background:rgba(20,28,50,0.9);border:1px solid #24304d;border-radius:6px;color:#cfe0ff;cursor:pointer;";
    b.innerHTML = "<b>" + (TYPE_EMOJI[def.type] || "🔩") + " " + def.name + "</b>" +
      "<span style='float:right;color:#9fb3da'>" + partLine(def) + "</span>";
    b.addEventListener("click", () => {
      if (_stack.length >= MAX_PARTS) { _msgEl.textContent = "Six parts is the forge limit — take one off to add another."; return; }
      _stack.push(id); refresh();
    });
    _shelfEl.appendChild(b);
  }
  // Stack: click a part to take it back off.
  _stackEl.innerHTML = "";
  if (_stack.length === 0) {
    _stackEl.innerHTML = "<div style='color:#5a6a8a;padding:8px'>— empty pad — pick parts from the shelf —</div>";
  }
  _stack.forEach((id, i) => {
    const def = _catalog.find((p) => p.id === id);
    const b = document.createElement("button");
    b.style.cssText = "display:block;width:100%;text-align:left;padding:5px 8px;background:rgba(30,38,64,0.9);" +
      "border:1px solid #35446a;border-radius:6px;color:#cfe0ff;cursor:pointer;";
    b.innerHTML = (TYPE_EMOJI[def.type] || "🔩") + " " + def.name + " <span style='float:right;color:#5a6a8a'>✕</span>";
    b.title = "Take it back off";
    b.addEventListener("click", () => { _stack.splice(i, 1); refresh(); });
    _stackEl.appendChild(b);
  });
  // Live readout — the score updates as he builds; tinkering IS the duel.
  const s = scoreStack(_stack, _catalog);
  if (!s.ok) {
    _readoutEl.innerHTML = "<div style='color:#9fb3da'>" + (_stack.length ? s.error : "Score appears here as you build.") + "</div>";
  } else {
    _readoutEl.innerHTML =
      "<div>⚖️ Mass <b>" + s.m0.toFixed(1) + " t</b> · 🔥 Thrust <b>" + s.thrust + " kN</b></div>" +
      "<div>🪂 Pandora liftoff: " + (s.liftsOff
        ? "<b style='color:#8affa8'>YES</b> (thrust beats weight ×" + s.twr.toFixed(2) + ")"
        : "<b style='color:#ff9a8a'>NO — it never leaves the pad!</b> (thrust is only ×" + s.twr.toFixed(2) + " of its weight)") + "</div>" +
      "<div style='font:800 24px system-ui;color:" + (s.liftsOff ? "#ffd870" : "#5a6a8a") + ";margin-top:4px'>SCORE " +
      s.score.toLocaleString() + " <span style='font:600 13px system-ui'>m/s of Δv</span></div>";
  }
  // Rival chips: struck through once the CURRENT build beats them.
  _rivalsEl.innerHTML = "";
  for (const r of RIVALS) {
    const beat = s.ok && s.score > r.score;
    const chip = document.createElement("div");
    chip.style.cssText = "padding:4px 10px;border-radius:14px;border:1px solid " +
      (beat ? "#3adb6a" : "#24304d") + ";color:" + (beat ? "#8affa8" : "#cfe0ff") + ";";
    chip.innerHTML = r.emoji + " " + r.name + " — <b>" + r.score.toLocaleString() + "</b>" + (beat ? " ✅" : "");
    _rivalsEl.appendChild(chip);
  }
}

function judge() {
  const s = scoreStack(_stack, _catalog);
  if (!s.ok) { _msgEl.innerHTML = "<span style='color:#ff9a8a'>" + s.error + "</span>"; return; }
  if (!s.liftsOff) {
    _msgEl.innerHTML = "<span style='color:#ff9a8a'>The judges shake their heads: " + s.dv.toLocaleString() +
      " m/s of Δv on paper, but it can't lift its own weight off Pandora. More thrust, or less mass!</span>";
    return;
  }
  const beaten = RIVALS.filter((r) => s.score > r.score);
  if (beaten.length === RIVALS.length) {
    _msgEl.innerHTML = "<span style='color:#8affa8;font-weight:800'>🏆 " + s.score.toLocaleString() +
      " — VEX IS BEATEN! The forge falls silent… then every bot starts hammering applause. " +
      "The builders' prize is yours: the 📁 PELICAN is waiting in the VAB!</span>";
    if (_cbs && _cbs.onWin) _cbs.onWin(s.score);
  } else {
    const next = RIVALS.find((r) => s.score <= r.score);
    _msgEl.innerHTML = "<span style='color:#ffd870'>" + s.score.toLocaleString() + " m/s — " +
      (beaten.length ? beaten[beaten.length - 1].name + " is beaten, but " : "") +
      next.name + " (" + next.score.toLocaleString() + ") still leads. <i>“" + next.taunt + "”</i> " +
      "Tinker and judge again — more fuel helps until the tanks outweigh the push.</span>";
    if (_cbs && _cbs.onScore) _cbs.onScore(s.score);
  }
}

export function openForgePanel(opts) {
  _catalog = opts.catalog;
  _cbs = opts;
  _stack = [];
  ensurePanel();
  _msgEl.innerHTML = (opts.best ? "Your best so far: <b>" + opts.best.toLocaleString() + "</b>. " : "") +
    "Beat every bot on the board — <b>" + RIVALS[RIVALS.length - 1].name + "</b> holds the record.";
  refresh();
  _el.style.display = "";
  window.addEventListener("keydown", blockKeys, true);
  window.addEventListener("keyup", blockKeys, true);
}

export function closeForgePanel() {
  if (!_el || _el.style.display === "none") return;
  _el.style.display = "none";
  window.removeEventListener("keydown", blockKeys, true);
  window.removeEventListener("keyup", blockKeys, true);
  if (_cbs && _cbs.onClose) _cbs.onClose();
}
