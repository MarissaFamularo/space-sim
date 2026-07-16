// school.js — 🎒 SPACE SCHOOL: the little-sibling on-ramp (Mom's ask — for a 5-year-old
// who can't read yet but types like a champ). A fourth building at the Konnie Space
// Center where a brand-new astronaut learns, in three tiny lessons, what every rocket
// is made of and what a real flight feels like: BUILD IT (stack the parts in the real
// order), FLY IT (count down, blast off, cross the top of the air into space), and
// COME HOME (parachute out, float down).
//
// Design rules for a pre-reader:
// - Every instruction is SPOKEN OUT LOUD (browser speechSynthesis — offline, no assets,
//   fails soft to silent text if a browser doesn't have it).
// - Buttons are HUGE pictures with one-word labels; shape-matching does the reading.
// - Nothing she does can hurt her brother's game: Space School keeps its own sticker
//   book in its OWN localStorage key (SCHOOL_KEY below, Rule-2 clean) and the school
//   rocket (pod+tank+engine+chute, one stage) can't deploy satellites or stations.
// - The flight is REAL physics, straight up. The one teacher assist — cutting the
//   engine once she reaches space — is announced out loud ("Engine off!"), never silent.
//
// API (used by main.js):
//   School.init({ prepRocket, launchRocket, setThrottle, deployChute, resetGame,
//                 toCenter, getSim })
//   School.show()          — open the school (welcome or classroom)
//   School.isOpen()        — a full-screen school room is up (main blocks flight keys)
//   School.onTick(sim)     — call every frame; drives the flight coaching
//
// Pure, node-testable core lives in SchoolCore (no DOM): the build-order checker,
// the saved-sticker-book validator, and the flight phase machine.

import { BODIES } from "./state.js";

// ---- the sticker book (HER save — a new versioned key, nobody else's data) ----
const SCHOOL_KEY = "spacesim.school.v1";

// The school rocket, bottom -> top — same order the real builder stacks (craft.parts
// is bottom->top). Every slot teaches the real anatomy: fire at the bottom, fuel in
// the middle, the crew pod on top, the parachute on the very tip (real capsules too).
// The DECOUPLER is load-bearing, not decoration: the booster comes home with ~2 t of
// unburned fuel, so the whole stack falls too fast for the chute ever to open (it
// hits the ground at ~500 m/s — node-proven in tests/school_test.mjs). Dropping the
// empty bottom is what saves the flight, exactly like real rockets — staging IS the
// physics lesson, not a nicety.
const SCHOOL_STACK = ["engine_sparrow", "tank_small", "decoupler", "command_pod", "parachute"];

// Card deck shown to the kid, in a FIXED scrambled order (deterministic on purpose —
// a 5-year-old learns the game faster when the cards don't move between plays).
const CARDS = [
  { partId: "command_pod",   emoji: "🐍", word: "POD" },
  { partId: "engine_sparrow", emoji: "🔥", word: "ENGINE" },
  { partId: "parachute",     emoji: "☂",  word: "PARACHUTE" },
  { partId: "decoupler",     emoji: "✂",  word: "STAGE" },
  { partId: "tank_small",    emoji: "⛽", word: "FUEL" },
];

// What the teacher says as each slot lights up / gets filled. Real facts, tiny words.
const SLOT_LINES = {
  engine_sparrow: {
    ask: "First the ENGINE! Fire comes out the bottom and pushes the rocket UP!",
    hint: "Almost! We need the ENGINE first — find the one with the fire!",
  },
  tank_small: {
    ask: "Now the FUEL TANK! Fuel is the rocket's food — no fuel, no fire!",
    hint: "Almost! Now we need the FUEL TANK — the one with the fuel drop!",
  },
  decoupler: {
    ask: "Now the DECOUPLER! When the fuel is all gone, it lets the empty bottom FALL AWAY — rockets get lighter as they fly!",
    hint: "Almost! Now the DECOUPLER — the stripey ring that lets the bottom drop off!",
  },
  command_pod: {
    ask: "Now the POD! That's where our brave snake sits and steers!",
    hint: "Almost! Now the POD goes on — where the snake sits!",
  },
  parachute: {
    ask: "Last one — the PARACHUTE on the very top, for floating home!",
    hint: "Almost! The PARACHUTE goes on the very top — find the umbrella!",
  },
};

// Space begins where the air ends. Game Earth's air tops out at atmosphere.height
// (7 km at practice scale); real rockets call space the Kármán line, 100 km up.
// The certificate and the teacher both teach BOTH numbers.
function spaceAltitude() {
  const a = BODIES.earth && BODIES.earth.atmosphere;
  return (a ? a.height : 7000) + 100; // a hair past the very top of the air
}

// ---------------------------------------------------------------------------
// SchoolCore — pure logic, node-testable, zero DOM.
// ---------------------------------------------------------------------------
export const SchoolCore = {
  SCHOOL_STACK,
  CARDS,
  spaceAltitude,

  makeBuildState() { return { placed: 0 }; },

  // Tap a card: right card for the blinking slot goes in; wrong card gets a friendly
  // pointing hint (never scolds, never auto-fixes — Rule 4 of the house doctrine).
  tryPlace(state, partId) {
    const want = SCHOOL_STACK[state.placed];
    if (!want) return { ok: false, done: true, say: "The rocket is already built!" };
    if (partId !== want) return { ok: false, done: false, say: SLOT_LINES[want].hint };
    state.placed += 1;
    const done = state.placed >= SCHOOL_STACK.length;
    return {
      ok: true, done,
      say: done ? "You built a REAL rocket! Time to fly it!" : SLOT_LINES[SCHOOL_STACK[state.placed]].ask,
    };
  },

  // Saved sticker book -> always a clean shape (garbage in storage is dropped
  // silently, same rule the mod loader follows — a mangled save can't break boot).
  validateSaved(raw) {
    const clean = { v: 1, name: "", stickers: { build: false, space: false, land: false } };
    if (!raw || typeof raw !== "object") return clean;
    if (typeof raw.name === "string") clean.name = raw.name.slice(0, 12);
    const s = raw.stickers;
    if (s && typeof s === "object") {
      for (const k of ["build", "space", "land"]) clean.stickers[k] = s[k] === true;
    }
    return clean;
  },

  // The flight phase machine. Feed it the previous phase and a tiny snapshot of the
  // sim; it answers which coaching event fires now (or null). Pure so the node suite
  // can fly a whole mission through it.
  //   snapshot: { alt, status, descending, staged, chuteDeployed }
  // Mission order: boost -> space -> falling -> staged (drop the booster) -> chute -> landed.
  flightEvent(phase, snap) {
    if (snap.status === "crashed") return phase === "crashed" ? null : "crashed";
    if (phase === "boost" && snap.alt >= spaceAltitude()) return "space";
    if ((phase === "space" || phase === "boost") && snap.descending) return "falling";
    if (phase === "falling" && snap.staged) return "staged";
    if ((phase === "staged" || phase === "falling") && snap.chuteDeployed) return "chute";
    if ((phase === "chute" || phase === "staged" || phase === "falling") && snap.status === "landed") return "landed";
    return null;
  },

  // Teacher-assist altitudes: if she hasn't tapped by here on the way down, the
  // teacher does it FOR her, out loud (failing safely is the pedagogy — her first
  // flight cannot be lost to a missed tap; main.js's own auto-chute is the second net).
  ASSIST_STAGE_ALT: 3000,
};

function loadSchool() {
  try { return SchoolCore.validateSaved(JSON.parse(localStorage.getItem(SCHOOL_KEY))); }
  catch { return SchoolCore.validateSaved(null); }
}
function saveSchool(d) { try { localStorage.setItem(SCHOOL_KEY, JSON.stringify(d)); } catch {} }

// ---------------------------------------------------------------------------
// Speech — the teacher's voice. Fails soft: no speechSynthesis, no problem,
// the words still appear in the big bubble.
// ---------------------------------------------------------------------------
function speak(text) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[🚀🐍🔥⛽☂🎒⭐🌌🏫🏢🎉]/g, ""));
    u.rate = 0.95; u.pitch = 1.1; u.lang = "en-US";
    window.speechSynthesis.speak(u);
  } catch { /* silent is fine */ }
}

// ---------------------------------------------------------------------------
// DOM — pure overlays on top of the running game, menu.js style. School owns
// no game state; main.js hands it the levers it needs.
// ---------------------------------------------------------------------------
let handlers = {};
let data = null;          // her sticker book (loaded on init)
let roomEl = null;        // the current full-screen room (welcome/classroom/build/cert)
let flightEl = null;      // the thin in-flight overlay
let buildState = null;    // lesson-1 progress
let flight = null;        // { phase, count, lastAlt, descendTimer, assisted }

const CSS = `
  .sch-room { position:absolute; inset:0; z-index:32; display:flex; flex-direction:column;
    align-items:center; justify-content:center; font-family:system-ui,-apple-system,sans-serif;
    color:#2b1d0e; background:linear-gradient(180deg,#ffd98a 0%,#ffc76b 55%,#f5a94f 100%); }
  .sch-title { font-size:clamp(30px,5vw,54px); font-weight:900; color:#7c3f00;
    text-shadow:0 2px 0 #ffe7b0; letter-spacing:.03em; }
  .sch-bubble { min-height:58px; max-width:min(88vw,720px); margin:10px auto 6px; padding:14px 22px;
    background:#fffbe8; border:3px solid #e09b3d; border-radius:22px; font-size:clamp(17px,2.4vw,24px);
    font-weight:700; text-align:center; color:#5a3a10; box-shadow:0 6px 0 rgba(160,90,10,.25); }
  .sch-big { display:inline-flex; flex-direction:column; align-items:center; justify-content:center;
    gap:4px; min-width:150px; min-height:120px; margin:10px; padding:16px 22px; font-size:52px;
    font-weight:900; color:#5a3a10; background:#fffbe8; border:4px solid #e09b3d; border-radius:26px;
    cursor:pointer; box-shadow:0 8px 0 rgba(160,90,10,.35); transition:transform .1s; user-select:none; }
  .sch-big:active { transform:scale(.94); }
  .sch-big small { font-size:19px; letter-spacing:.12em; }
  .sch-big.sch-locked { filter:grayscale(1); opacity:.55; }
  .sch-shake { animation:schShake .4s; }
  @keyframes schShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-12px)} 75%{transform:translateX(12px)} }
  .sch-blink { animation:schBlink 1s infinite; }
  @keyframes schBlink { 0%,100%{box-shadow:0 0 0 4px rgba(255,214,90,.9), 0 8px 0 rgba(160,90,10,.35)} 50%{box-shadow:0 0 0 12px rgba(255,214,90,0), 0 8px 0 rgba(160,90,10,.35)} }
  .sch-pop { animation:schPop .35s; }
  @keyframes schPop { 0%{transform:scale(.3)} 70%{transform:scale(1.15)} 100%{transform:scale(1)} }
  .sch-slot { width:150px; display:flex; align-items:center; justify-content:center;
    background:rgba(255,251,232,.4); border:4px dashed #b97f2e; border-radius:18px;
    font-size:44px; color:#b97f2e; }
  .sch-slot.sch-filled { border-style:solid; background:#fffbe8; }
  .sch-corner { position:absolute; top:14px; left:14px; z-index:36; min-width:0; min-height:0;
    padding:10px 16px; font-size:26px; margin:0; }
  .sch-flight { position:absolute; inset:0; z-index:31; pointer-events:none;
    font-family:system-ui,-apple-system,sans-serif; }
  .sch-flight > * { pointer-events:auto; }
  /* Kid-proofing: a full-screen shield under the school's own buttons swallows taps
     so the grown-up panels (Starmap, Teleport, Navigator…) can't be hit mid-lesson. */
  .sch-shield { position:absolute; inset:0; }
  .sch-meter { position:absolute; right:18px; top:16%; height:56%; width:56px;
    background:linear-gradient(180deg,#0a0e1f 0%,#0a0e1f 28%,#2b4a8f 45%,#8fc3ff 80%,#bfe2ff 100%);
    border:3px solid #fffbe8; border-radius:16px; }
  .sch-meter .sch-line { position:absolute; left:-6px; right:-6px; border-top:3px dashed #ffe27a; }
  .sch-meter .sch-ship { position:absolute; left:50%; transform:translate(-50%,50%); font-size:30px;
    filter:drop-shadow(0 0 6px rgba(255,255,255,.7)); }
  .sch-bottom { position:absolute; left:0; right:0; bottom:16px; display:flex;
    justify-content:center; align-items:center; gap:14px; }
  .sch-confetti { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
  .sch-confetti i { position:absolute; font-size:30px; animation:schFall 2.6s ease-in forwards; }
  @keyframes schFall { 0%{transform:translateY(-8vh) rotate(0)} 100%{transform:translateY(110vh) rotate(720deg); opacity:.2} }
  .sch-input { font-size:38px; font-weight:900; width:min(80vw,420px); padding:12px 18px;
    border:4px solid #e09b3d; border-radius:18px; background:#fffbe8; color:#5a3a10;
    text-align:center; text-transform:uppercase; letter-spacing:.12em; }
`;
let cssInjected = false;
function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);
}

function closeRoom() { if (roomEl) { roomEl.remove(); roomEl = null; } }
function closeFlight() {
  if (flightEl) { flightEl.remove(); flightEl = null; }
  flight = null;
  setGrownupPanels(true);
}

// During a school flight the grown-up panels (Flight Data, Mode, Navigator, palette)
// are hidden — the click-shield already makes them unusable, and a 5-year-old's screen
// should hold exactly five things: sky, rocket, teacher bubble, ladder, one big button.
function setGrownupPanels(show) {
  for (const id of ["palette", "readouts", "controls", "copilot"]) {
    const el = document.getElementById(id);
    if (el) el.style.visibility = show ? "" : "hidden";
  }
}

function room() {
  injectCSS();
  closeRoom();
  roomEl = document.createElement("div");
  roomEl.className = "sch-room";
  document.getElementById("app").appendChild(roomEl);
  return roomEl;
}

function bubble(el, text, alsoSpeak = true) {
  let b = el.querySelector(".sch-bubble");
  if (!b) { b = document.createElement("div"); b.className = "sch-bubble"; el.prepend(b); }
  b.textContent = text;
  if (alsoSpeak) speak(text);
}

function bigButton(label, sub, onTap) {
  const b = document.createElement("button");
  b.className = "sch-big";
  b.innerHTML = label + (sub ? `<small>${sub}</small>` : "");
  b.onclick = onTap;
  return b;
}

// A little emoji confetti burst (deterministic spread — same party every time).
function confetti(el) {
  const wrap = document.createElement("div");
  wrap.className = "sch-confetti";
  const bits = ["⭐", "🎉", "✨", "🚀", "⭐", "✨", "🎈", "⭐", "🎉", "✨", "🌟", "🎈"];
  let x = 987654321;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1000) / 1000; };
  for (let i = 0; i < 26; i++) {
    const s = document.createElement("i");
    s.textContent = bits[i % bits.length];
    s.style.left = (rnd() * 96) + "%";
    s.style.animationDelay = (rnd() * 0.9) + "s";
    wrap.appendChild(s);
  }
  el.appendChild(wrap);
  setTimeout(() => wrap.remove(), 4000);
}

// ---- Welcome: type your name, astronaut (the one thing she's already great at) ----
function showWelcome() {
  closeFlight();
  const el = room();
  const head = document.createElement("div");
  head.className = "sch-title";
  head.textContent = "🎒 SPACE SCHOOL";
  el.appendChild(head);
  bubble(el, "Welcome to Space School! Type your name, astronaut!");
  const input = document.createElement("input");
  input.className = "sch-input";
  input.maxLength = 12;
  input.value = data.name || "";
  input.setAttribute("autocapitalize", "characters");
  el.appendChild(input);
  const ok = bigButton("✔", "READY!", () => {
    data.name = (input.value || "").trim().slice(0, 12).toUpperCase();
    saveSchool(data);
    showClassroom(true);
  });
  el.appendChild(ok);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") ok.click(); e.stopPropagation(); });
  setTimeout(() => input.focus(), 50);
  el.appendChild(cornerExit());
}

// Little top-corner door back to the Space Center — always available, never trapped.
function cornerExit() {
  const b = bigButton("🏢", "", () => { closeRoom(); closeFlight(); handlers.toCenter && handlers.toCenter(); });
  b.className = "sch-big sch-corner";
  return b;
}

// ---- Classroom: pick a lesson ----
function showClassroom(greet) {
  closeFlight();
  const el = room();
  const head = document.createElement("div");
  head.className = "sch-title";
  head.textContent = "🎒 SPACE SCHOOL";
  el.appendChild(head);
  const hello = data.name ? `Hi astronaut ${data.name}! Pick a lesson!` : "Pick a lesson!";
  bubble(el, hello, !!greet);

  const rowEl = document.createElement("div");
  rowEl.style.cssText = "display:flex;flex-wrap:wrap;justify-content:center;";
  const star = (on) => (on ? "⭐" : "▫️");
  const build = bigButton("🧩" + star(data.stickers.build), "BUILD IT", () => showBuild());
  rowEl.appendChild(build);
  const fly = bigButton("🚀" + star(data.stickers.space && data.stickers.land), "FLY IT", () => {
    if (!data.stickers.build && (!buildState || buildState.placed < SCHOOL_STACK.length)) {
      fly.classList.remove("sch-shake"); void fly.offsetWidth; fly.classList.add("sch-shake");
      bubble(el, "Build your rocket first! Tap the puzzle!");
      return;
    }
    startFlight();
  });
  if (!data.stickers.build) fly.classList.add("sch-locked");
  rowEl.appendChild(fly);
  rowEl.appendChild(bigButton("🏆", "MY BADGE", () => showCertificate(false)));
  el.appendChild(rowEl);

  // Tap the little badge to change the name.
  const badge = bigButton("📛", data.name || "NAME", () => showWelcome());
  badge.style.cssText = "min-width:0;min-height:0;font-size:26px;padding:8px 14px;";
  el.appendChild(badge);
  el.appendChild(cornerExit());
}

// ---- Lesson 1: BUILD IT ----
function showBuild() {
  const el = room();
  buildState = SchoolCore.makeBuildState();
  bubble(el, "Let's build a rocket! A rocket is like a tower — we start at the BOTTOM. " + SLOT_LINES[SCHOOL_STACK[0]].ask);

  // The rocket outline: slots stacked top -> bottom on screen (chute on top),
  // filled bottom-up as she gets them right.
  const stack = document.createElement("div");
  stack.style.cssText = "display:flex;flex-direction:column-reverse;gap:8px;margin:8px 0;";
  const slotEls = SCHOOL_STACK.map((pid, i) => {
    const card = CARDS.find((c) => c.partId === pid);
    const s = document.createElement("div");
    s.className = "sch-slot" + (i === 0 ? " sch-blink" : "");
    s.style.height = pid === "tank_small" ? "72px" : pid === "decoupler" ? "38px" : "56px";
    s.textContent = "?";
    s.dataset.want = pid;
    stack.appendChild(s);
    return { el: s, card };
  });
  el.appendChild(stack);

  const deck = document.createElement("div");
  deck.style.cssText = "display:flex;flex-wrap:wrap;justify-content:center;";
  for (const card of CARDS) {
    const b = bigButton(card.emoji, card.word, () => {
      const r = SchoolCore.tryPlace(buildState, card.partId);
      if (!r.ok) {
        b.classList.remove("sch-shake"); void b.offsetWidth; b.classList.add("sch-shake");
        bubble(el, r.say);
        return;
      }
      const slot = slotEls[buildState.placed - 1];
      slot.el.textContent = card.emoji;
      slot.el.classList.add("sch-filled", "sch-pop");
      slotEls.forEach((s) => s.el.classList.remove("sch-blink"));
      b.disabled = true; b.style.opacity = "0.35";
      if (r.done) {
        data.stickers.build = true;
        saveSchool(data);
        confetti(el);
        bubble(el, r.say);
        const go = bigButton("🚀", "TO THE PAD!", () => startFlight());
        go.classList.add("sch-pop");
        deck.replaceChildren(go);
      } else {
        slotEls[buildState.placed].el.classList.add("sch-blink");
        bubble(el, r.say);
      }
    });
    deck.appendChild(b);
  }
  el.appendChild(deck);
  el.appendChild(cornerExit());
}

// ---- Lessons 2+3: FLY IT / COME HOME — the real game, thin big-button overlay ----
function startFlight() {
  closeRoom();
  closeFlight();
  injectCSS();
  handlers.prepRocket && handlers.prepRocket(SCHOOL_STACK);

  flightEl = document.createElement("div");
  flightEl.className = "sch-flight";
  document.getElementById("app").appendChild(flightEl);
  setGrownupPanels(false);

  const shield = document.createElement("div");
  shield.className = "sch-shield";
  flightEl.appendChild(shield);

  const b = document.createElement("div");
  b.className = "sch-bubble";
  b.style.cssText = "position:absolute;top:12px;left:50%;transform:translateX(-50%);";
  flightEl.appendChild(b);

  // Altitude ladder: ground at the bottom, the dashed gold line is the top of the
  // air — cross it and you are IN SPACE (real rockets call that line 100 km up).
  const meter = document.createElement("div");
  meter.className = "sch-meter";
  const line = document.createElement("div");
  line.className = "sch-line";
  line.style.top = "28%";
  meter.appendChild(line);
  const tag = document.createElement("div");
  tag.style.cssText = "position:absolute;top:20%;right:64px;font-size:22px;color:#ffe27a;font-weight:900;text-shadow:0 1px 3px #000;white-space:nowrap;";
  tag.textContent = "🌌 SPACE";
  meter.appendChild(tag);
  const ship = document.createElement("div");
  ship.className = "sch-ship";
  ship.style.bottom = "0%";
  ship.textContent = "🚀";
  meter.appendChild(ship);
  flightEl.appendChild(meter);

  const bottom = document.createElement("div");
  bottom.className = "sch-bottom";
  flightEl.appendChild(bottom);

  const exit = Object.assign(bigButton("🏫", "", () => abortToClassroom()), { className: "sch-big sch-corner" });
  flightEl.appendChild(exit);

  flight = { phase: "countdown", count: 5, lastAlt: 0, descendTimer: 0, assistedStage: false,
             coastTicks: 0, coastSaid: false, ui: { bubble: b, ship, bottom } };
  say("Count down with me! Tap the numbers!");
  showCountButton();
}

function say(text) { if (flight) { flight.ui.bubble.textContent = text; } speak(text); }

function showCountButton() {
  const btn = bigButton(String(flight.count), "", () => {
    speak(String(flight.count));
    flight.count -= 1;
    if (flight.count >= 1) {
      btn.innerHTML = String(flight.count);
      btn.classList.remove("sch-pop"); void btn.offsetWidth; btn.classList.add("sch-pop");
    } else {
      const go = bigButton("🚀", "BLAST OFF!", () => {
        flight.phase = "boost";
        handlers.launchRocket && handlers.launchRocket();
        say("BLAST OFF! Up, up, UP!");
        flight.ui.bottom.replaceChildren();
      });
      go.style.cssText = "background:linear-gradient(180deg,#ff7a59,#d63d2a);border-color:#ffb59f;color:#fff;";
      go.classList.add("sch-blink");
      flight.ui.bottom.replaceChildren(go);
    }
  });
  btn.classList.add("sch-blink");
  flight.ui.bottom.replaceChildren(btn);
}

function abortToClassroom() {
  closeFlight();
  handlers.resetGame && handlers.resetGame();
  showClassroom(false);
}

// Called by main.js every frame. Cheap when school isn't flying.
function onTick(sim) {
  if (!flight || !flightEl) return;

  // Rocket marker on the ladder: the gold line sits at 72% of the bar's height.
  const frac = Math.min(1, (sim.altitude || 0) / spaceAltitude() * 0.72);
  flight.ui.ship.style.bottom = (frac * 100).toFixed(1) + "%";

  // Descent detection (radial-ish: altitude falling for half a second straight).
  const dAlt = (sim.altitude || 0) - flight.lastAlt;
  flight.descendTimer = dAlt < -0.5 ? flight.descendTimer + 1 : 0;
  flight.lastAlt = sim.altitude || 0;

  // Teacher assist: if the booster is still attached this low on the way down, the
  // teacher stages it herself — out loud, never silently (the flight must be
  // un-loseable, but honesty rules: the kid always hears what the teacher did).
  const staged = (sim.craft && sim.craft.currentStage > 0) || false;
  if (flight.phase === "falling" && !staged && (sim.altitude || 0) < SchoolCore.ASSIST_STAGE_ALT) {
    flight.assistedStage = true;
    handlers.stageRocket && handlers.stageRocket();
  }
  // Back to real time just above the ground: the touchdown is hers to watch.
  if (flight.phase === "chute" && (sim.altitude || 0) < 150 && sim.timeWarp > 1) {
    handlers.setWarp && handlers.setWarp(1);
  }

  // The coast over the top is the one stretch with nothing to press — say so
  // (Mom's play-test note: "it just goes on and on… what is she supposed to do?").
  // ~5 s after the space cheer, tell her waiting IS the mission right now.
  if (flight.phase === "space" && !flight.coastSaid && ++flight.coastTicks > 300) {
    flight.coastSaid = true;
    say("Nothing to press yet — we're floating up and over the top! Watch the little rocket on the ladder. When we start falling, I'll call you!");
  }

  const ev = SchoolCore.flightEvent(flight.phase, {
    alt: sim.altitude || 0,
    status: sim.status,
    descending: flight.descendTimer > 20,
    staged: (sim.craft && sim.craft.currentStage > 0) || false,
    chuteDeployed: !!(sim.craft && sim.craft.chuteDeployed),
  });
  if (!ev) return;

  if (ev === "space") {
    flight.phase = "space";
    handlers.setThrottle && handlers.setThrottle(0);
    // Coasting over the top takes a couple of real minutes — gently speed the clock
    // (the game's own time-warp, the same tool her brother flies with) so the fall
    // arrives while a 5-year-old is still watching. Taps always happen at 1x.
    handlers.setWarp && handlers.setWarp(5);
    data.stickers.space = true;
    saveSchool(data);
    confetti(flightEl);
    say("The sky turned black — you are in SPACE! Engine off… now we FLOAT! Astronauts float when the engine stops.");
  } else if (ev === "falling") {
    flight.phase = "falling";
    handlers.setWarp && handlers.setWarp(1); // real time for her tap
    say("We're falling back home! The tank is empty — tap the scissors and let the bottom FALL AWAY!");
    const s = bigButton("✂", "DROP IT!", () => { handlers.stageRocket && handlers.stageRocket(); });
    s.classList.add("sch-blink");
    flight.ui.bottom.replaceChildren(s);
  } else if (ev === "staged") {
    flight.phase = "staged";
    say((flight.assistedStage
      ? "I helped — the empty bottom fell away! "
      : "There it goes! Real rockets drop their empty parts. ") +
      "We're light now — tap the parachute!");
    const p = bigButton("☂", "PARACHUTE!", () => {
      flight.tappedChute = true;
      handlers.deployChute && handlers.deployChute();
      // flightEvent flips to "chute" next tick when the sim confirms it's out.
    });
    p.classList.add("sch-blink");
    flight.ui.bottom.replaceChildren(p);
  } else if (ev === "chute") {
    flight.phase = "chute";
    // If she never tapped ☂, the game's auto-chute opened it for her (the same safety
    // net her brother gets) — the teacher owns up to helping.
    const assisted = !flight.tappedChute;
    flight.ui.bottom.replaceChildren();
    // Floating down for real takes ~10 minutes — spin the clock, then slow back to
    // 1x near the ground so she gets to WATCH the touchdown.
    handlers.setWarp && handlers.setWarp(25);
    say(assisted
      ? "I helped with the parachute that time! The air catches it and we float down, soft and slow. Floating is slow — let's speed up time!"
      : "Parachute out! The air catches it and we float down, soft and slow. Floating is slow — let's speed up time!");
  } else if (ev === "landed") {
    flight.phase = "landed";
    handlers.setWarp && handlers.setWarp(1);
    data.stickers.land = true;
    saveSchool(data);
    confetti(flightEl);
    say((data.name ? "You did it, astronaut " + data.name + "! " : "You did it! ") +
        "You flew to space and came home!");
    const done = bigButton("🎉", "MY BADGE!", () => { closeFlight(); handlers.resetGame && handlers.resetGame(); showCertificate(true); });
    done.classList.add("sch-pop");
    flight.ui.bottom.replaceChildren(done);
  } else if (ev === "crashed") {
    flight.phase = "crashed";
    say("Bump! The rocket bounced — but our snake is safe. Connies always are! Let's try again!");
    const again = bigButton("🔁", "TRY AGAIN", () => abortToClassroom());
    flight.ui.bottom.replaceChildren(again);
  }
}

// ---- The certificate / sticker book ----
function showCertificate(celebrate) {
  const el = room();
  const head = document.createElement("div");
  head.className = "sch-title";
  head.textContent = "🏆 ASTRONAUT " + (data.name || "");
  el.appendChild(head);
  if (celebrate) confetti(el);
  bubble(el,
    celebrate ? "Hooray! Look at your stickers! Real rockets say space starts one hundred kilometers up — and YOU flew there!" :
    "Here are your stickers!", celebrate);

  const rowEl = document.createElement("div");
  rowEl.style.cssText = "display:flex;flex-wrap:wrap;justify-content:center;";
  const stick = (on, emoji, word) => {
    const d = document.createElement("div");
    d.className = "sch-big";
    d.style.cursor = "default";
    d.innerHTML = (on ? emoji : "▫️") + `<small>${word}</small>` + (on ? "<small>⭐</small>" : "<small>&nbsp;</small>");
    rowEl.appendChild(d);
  };
  stick(data.stickers.build, "🧩", "BUILDER");
  stick(data.stickers.space, "🌌", "IN SPACE");
  stick(data.stickers.land, "☂", "CAME HOME");
  el.appendChild(rowEl);

  const btns = document.createElement("div");
  btns.style.cssText = "display:flex;justify-content:center;";
  btns.appendChild(bigButton("🔁", "FLY AGAIN", () => startFlight()));
  btns.appendChild(bigButton("🏫", "SCHOOL", () => showClassroom(false)));
  el.appendChild(btns);
  el.appendChild(cornerExit());
}

export const School = {
  init(h) { handlers = h || {}; data = loadSchool(); },
  show() {
    if (!data) data = loadSchool();
    if (data.name) showClassroom(true);
    else showWelcome();
  },
  isOpen() { return !!roomEl; },
  isFlying() { return !!flight; },
  onTick,
};
