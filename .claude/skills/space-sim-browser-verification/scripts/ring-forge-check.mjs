// ring-forge-check.mjs — browser verification for the Halo Ring tunnels + Rocket
// Forge duel + Pelican prize (Patrick's 2026-08-02 spec).
//   usage: node ring-forge-check.mjs WORKDIR [PORT]
// Verifies end-to-end through the REAL machinery: Pandora arrival, the ring in the
// 🎯 picker, formation teleport, a legs-down ring landing (real collision path),
// B into the tunnels, room chain ringtunnel→ringtunnel→forge, the contest console,
// the forge panel scoring the hand-computed 7,245 winner, the spacesim.pelican.v1
// unlock, the 📁 PELICAN button + craft load after a reload, and the SHIFT
// lift/cruise engine-group toggle in flight.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORK = process.argv[2];
const PORT = process.argv[3] || "8022";
if (!WORK) { console.error("usage: node ring-forge-check.mjs WORKDIR [PORT]"); process.exit(2); }

const require = createRequire(path.join(WORK, "driver", "package.json"));
const { chromium } = require("playwright");

function bundledChrome() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort();
    for (const d of dirs.reverse()) {
      const p = path.join(root, d, "chrome-linux", "chrome");
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return null;
}

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}

async function main() {
  const shots = path.join(WORK, "shots");
  fs.mkdirSync(shots, { recursive: true });

  // Self-contained extra hooks (idempotent appends; scratch copy ONLY, never the
  // real source — same pattern as cylan-check.mjs).
  const mainJs = path.join(WORK, "game", "js", "main.js");
  if (!fs.readFileSync(mainJs, "utf8").includes("__ringLand")) {
    fs.appendFileSync(mainJs, `
// ring-forge-check extra hooks (scratch copy only)
window.__goSystem = (seed) => travelToSystem(seed);
window.__callouts = () => flightCallouts(); // rAF loop is off under test — fire the announcer directly
window.__ringLand = () => {
  // Park the craft ON the ring band, co-moving — the real Physics.step collision
  // then decides landed vs crashed (that's the code path under test).
  const b = BODIES.ringworld;
  const st = bodyStateAt("ringworld", sim.time); // key, not body — BODIES[key] lookup
  const major = b.radius * b.style.ringworld.majorR;
  sim.craft.pos = { x: st.pos.x + major, y: st.pos.y };
  sim.craft.vel = { x: st.vel.x, y: st.vel.y };
  sim.craft.throttle = 0;
};
`);
  }
  const renderJs = path.join(WORK, "game", "js", "render.js");
  if (!fs.readFileSync(renderJs, "utf8").includes("__interiorDebug")) {
    fs.appendFileSync(renderJs, `
// ring-forge-check extra hooks (scratch copy only)
window.__interiorDebug = () => interior ? {
  room: interior.roomIndex, rooms: interior.rooms.slice(),
  x: interior.connie.position.x, y: interior.connie.position.y,
  mx: interior.len / 2 - 0.8,
  consoles: interior.consoles.map((c) => ({ kind: c.kind, x: c.x, y: c.y, done: c.done })),
} : null;
window.__interiorWalk = (x, y) => {
  if (!interior) return;
  interior.connie.position.x = x;
  if (y !== undefined) interior.connie.position.y = y;
  interior.vel.x = 0.7; // moving "inward" so the hatch crossing keeps its direction
};
`);
  }

  let browser;
  try { browser = await chromium.launch(); }
  catch {
    const exe = bundledChrome();
    browser = exe ? await chromium.launch({ executablePath: exe })
                  : await chromium.launch({ channel: "chrome" });
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  const boot = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction("window.__hooksReady === true", null, { timeout: 20000 });
  };
  const dismissMenus = async () => {
    await page.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent.includes("START"));
      if (b) b.click();
      const vab = document.querySelector('.ksp-bld[data-go="vab"]');
      if (vab) vab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    })()`);
  };
  const shot = async (name) => {
    await page.evaluate("window.__renderAndSample()");
    await page.screenshot({ path: path.join(shots, name) });
    console.log("shot: " + path.join(shots, name));
  };
  const key = (k) => page.evaluate(
    `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)} }))`);
  const copilotText = () => page.evaluate(`document.getElementById("copilot").textContent`);

  // ---- 0. Fresh state ---------------------------------------------------------------
  await boot();
  await page.evaluate(`localStorage.removeItem("spacesim.pelican.v1")`);
  await boot();
  await dismissMenus();

  // ---- 1. Pandora: the ring is a first-class 🎯 target ("choose it to orbit") -------
  await page.evaluate(`window.__goSystem("Pandora")`);
  const ring = await page.evaluate(`({
    name: window.__BODIES.ringworld && window.__BODIES.ringworld.name,
    majorR: window.__BODIES.ringworld && window.__BODIES.ringworld.style.ringworld.majorR,
  })`);
  check("Pandora system: Halo Ring in the catalog", ring.name === "Halo Ring", `name=${ring.name}`);
  const opts = await page.evaluate(
    `Array.from(document.querySelectorAll("select option")).map(o => o.textContent)`);
  check("🎯 target picker lists the Halo Ring (orbit target)",
    opts.some((t) => t.includes("Halo Ring")), `options=${opts.length}`);

  // ---- 2. Fly + formation teleport + real ring landing ------------------------------
  await page.evaluate(`window.__loadRocket([["engine_sparrow",0],["tank_small",0],["landing_legs",0],["command_pod",0]])`);
  await page.evaluate(`window.__launch()`);
  await page.evaluate(`window.__advance(1, 5)`);
  await page.evaluate(`window.__teleport("ringworld")`);
  let snap = await page.evaluate(`window.__advance(0.5, 4)`);
  check("teleport flies formation with the ring (no crash)", snap.status !== "crashed", `status=${snap.status}`);
  // House gotcha (HANDOFF/Cylan): a near-black FOLLOW view in deep space can be the
  // honest night sky — assert lit pixels in MAP view, where the ring must draw.
  await page.evaluate(`window.__setView("map")`);
  const lit1 = await page.evaluate(`window.__renderAndSample()`);
  // Map view is honestly mostly black sky; dots + rails + the ring light ~1.5% of
  // pixels (blank canvas reads ~0.000). Eyeballed 2026-08-02: ring on its rail, labeled.
  check("ring draws in map view (flat living band + torus)", lit1.litFraction > 0.005,
    `litFraction=${lit1.litFraction.toFixed(3)}`);
  await shot("ring-map.png");
  await page.evaluate(`window.__setView("follow")`);
  await shot("ring-formation.png");

  await page.evaluate(`window.__ringLand()`);
  snap = await page.evaluate(`window.__advance(0.5, 3)`);
  const landed = await page.evaluate(`window.__sim().landed`);
  check("legs-down touchdown on the ring (real collision path)",
    snap.status === "landed" && landed && landed.ringworld === true,
    `status=${snap.status} ringworld=${landed && landed.ringworld}`);
  await page.evaluate(`window.__callouts()`);
  const landTxt = await copilotText();
  check("landing callout points at the tunnels (Press B)", landTxt.includes("tunnels inside the ring"));
  await shot("ring-landed.png");

  // ---- 3. B → the tunnels: ringtunnel → ringtunnel → forge ---------------------------
  await key("b");
  const inside = await page.evaluate(`window.__Render.isInside()`);
  check("B boards the Halo Ring Tunnels", inside === true);
  let dbg = await page.evaluate(`window.__interiorDebug()`);
  check("room plan is tunnel → tunnel → forge",
    JSON.stringify(dbg.rooms) === JSON.stringify(["ringtunnel", "ringtunnel", "forge"]),
    JSON.stringify(dbg.rooms));
  const hint = await page.evaluate(
    `Array.from(document.querySelectorAll("div")).map(d => d.textContent).find(t => t.includes("room 1/3")) || ""`);
  check("hint bar: spin gravity + room 1/3", hint.includes("SPINNING") && hint.includes("room 1/3"));
  await shot("ring-tunnel.png");

  for (let hop = 0; hop < 2; hop++) {
    await page.evaluate(`window.__interiorWalk(window.__interiorDebug().mx + 0.05)`);
    await page.evaluate(`window.__advance(0, 1)`);
    dbg = await page.evaluate(`window.__interiorDebug()`);
  }
  check("two hatch crossings reach the forge", dbg.room === 2 && dbg.rooms[dbg.room] === "forge",
    `room=${dbg.room}`);
  const contestCon = dbg.consoles.find((c) => c.kind === "contest");
  check("forge holds the contest console (duel anvil)", !!contestCon,
    JSON.stringify(dbg.consoles));
  await shot("ring-forge-room.png");

  // ---- 4. Touch the anvil → forge panel → build the winner → judge ------------------
  await page.evaluate(`window.__interiorWalk(${contestCon.x}, ${contestCon.y})`);
  await page.evaluate(`window.__advance(0, 1)`);
  const panelOpen = await page.evaluate(
    `!!Array.from(document.querySelectorAll("div")).find(d => d.textContent.includes("THE ROCKET FORGE — BUILD-OFF") && d.style.display !== "none")`);
  check("anvil touch opens the forge panel", panelOpen);

  const clickShelf = (label, times = 1) => page.evaluate(`(() => {
    for (let i = 0; i < ${times}; i++) {
      const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent.includes(${JSON.stringify(label)}));
      if (b) b.click();
    }
  })()`);
  await clickShelf("Acorn Command Pod");
  await clickShelf("Hawk Heavy Engine");
  await clickShelf("Mega Fuel Tank", 3);
  const scoreTxt = await page.evaluate(
    `Array.from(document.querySelectorAll("div")).map(d => d.textContent).find(t => t.includes("SCORE")) || ""`);
  check("live readout scores the hand-computed 7,245", /7,?245/.test(scoreTxt),
    scoreTxt.slice(scoreTxt.indexOf("SCORE"), scoreTxt.indexOf("SCORE") + 20));
  await clickShelf("JUDGE MY ROCKET");
  const verdict = await page.evaluate(
    `Array.from(document.querySelectorAll("span")).map(s => s.textContent).find(t => t.includes("VEX IS BEATEN")) || ""`);
  check("judge declares the win over Vex", verdict.includes("VEX IS BEATEN"));
  const saved = await page.evaluate(`JSON.parse(localStorage.getItem("spacesim.pelican.v1") || "null")`);
  check("spacesim.pelican.v1 saved: unlocked, best 7245",
    saved && saved.unlocked === true && saved.best === 7245, JSON.stringify(saved));
  await page.screenshot({ path: path.join(shots, "ring-forge-win.png") });
  console.log("shot: " + path.join(shots, "ring-forge-win.png"));

  await page.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent.includes("Leave the forge"));
    if (b) b.click();
  })()`);
  await key("e");
  const backOut = await page.evaluate(`window.__Render.isInside()`);
  check("E exits the tunnels back to the ship", backOut === false);

  // ---- 5. Reload: the 📁 PELICAN button + craft + SHIFT engine groups ---------------
  await boot(); // unlock persists in localStorage; back in Sol's VAB
  await dismissMenus();
  const pelBtn = await page.evaluate(
    `!!Array.from(document.querySelectorAll("#palette-list button")).find(b => b.textContent.includes("PELICAN"))`);
  check("VAB palette shows the 📁 PELICAN prize button", pelBtn);
  await page.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll("#palette-list button")).find(x => x.textContent.includes("PELICAN"));
    if (b) b.click();
  })()`);
  const craft = await page.evaluate(`({ name: window.__craft().name, parts: window.__craft().parts.map(p => p.partId) })`);
  check("Pelican loads: 7 parts, boosters at the bottom",
    craft.name === "Pelican" && craft.parts.length === 7 && craft.parts[0] === "pelican_lift",
    JSON.stringify(craft.parts));
  await shot("pelican-pad.png");

  await page.evaluate(`window.__launch()`);
  snap = await page.evaluate(`window.__advance(1, 3)`);
  let mode = await page.evaluate(`window.__sim().craft.engineMode`);
  check("launch lights the LIFT group (800 kN belly boosters)",
    snap.thrust === 800 && mode === "lift", `thrust=${snap.thrust} mode=${mode}`);
  await key("Shift");
  mode = await page.evaluate(`({ m: window.__sim().craft.engineMode, t: window.__sim().craft.thrust, ve: window.__sim().craft.exhaustVelocity })`);
  check("SHIFT → CRUISE group (260 kN, 4800 m/s exhaust)",
    mode.m === "cruise" && mode.t === 260 && mode.ve === 4800, JSON.stringify(mode));
  const cruiseTxt = await copilotText();
  check("cruise callout teaches the trade", cruiseTxt.includes("Cruise drive burning"));
  await key("Shift");
  mode = await page.evaluate(`({ m: window.__sim().craft.engineMode, t: window.__sim().craft.thrust })`);
  check("SHIFT again → back to LIFT (landing group)", mode.m === "lift" && mode.t === 800,
    JSON.stringify(mode));
  snap = await page.evaluate(`window.__advance(1, 10)`);
  check("Pelican climbs off the pad on its boosters", snap.status === "flying" && snap.altitude > 50,
    `alt=${Math.round(snap.altitude)}m`);
  await shot("pelican-flight.png");

  // ---- 6. Clean run ------------------------------------------------------------------
  check("zero page errors across the whole check", pageErrors.length === 0,
    pageErrors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(failures === 0 ? "\nRING-FORGE CHECK: ALL GREEN" : `\nRING-FORGE CHECK: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
