// afra-check.mjs — browser verification for THE AFRA SYSTEM (his 2026-09-26 spec: a
// little red dwarf, no home planet, lava-lake Esis, cloud-hidden 3-g Verder, base camp
// Tessia, comets Phobie + Drez, cloud-roofed ringed Magrelle with life underneath and
// moons Glacier / Hoth / Necla, dwarf planet Seretta).
//   usage: node afra-check.mjs WORKDIR [PORT]
// Verifies through the REAL machinery: Starmap arrival at Base Camp Tessia (no
// station), the 🎯 picker, the system map with Phobie's long tail, predicted parking
// orbits at Verder (3 g) and ringed Magrelle, formation at unorbitable Glacier, a
// hover UNDER Magrelle's cloud roof, and the Exploration context carrying Verder's
// ground-only scan flag. Numbers come from the live __BODIES, never hardcoded.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORK = process.argv[2];
const PORT = process.argv[3] || "8022";
if (!WORK) { console.error("usage: node afra-check.mjs WORKDIR [PORT]"); process.exit(2); }

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

  // Extra hooks (idempotent append; scratch copy ONLY, never the real source).
  const mainJs = path.join(WORK, "game", "js", "main.js");
  if (!fs.readFileSync(mainJs, "utf8").includes("__afraHooks")) {
    fs.appendFileSync(mainJs, `
// afra-check extra hooks (scratch copy only)
window.__afraHooks = true;
window.__goSystem = (seed) => travelToSystem(seed);
window.__systemName = () => SYSTEM.name;
window.__stations = () => STATIONS.map((s) => s.id);
window.__bodyState = (k) => bodyStateAt(k, sim.time || 0);
window.__expCtx = () => getExplorationContext();
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

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction("window.__hooksReady === true", null, { timeout: 20000 });
  await page.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent.includes("START"));
    if (b) b.click();
    const vab = document.querySelector('.ksp-bld[data-go="vab"]');
    if (vab) vab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  })()`);
  const shot = async (name) => {
    await page.evaluate("window.__renderAndSample()");
    await page.screenshot({ path: path.join(shots, name) });
    console.log("shot: " + path.join(shots, name));
  };
  // Park helper: teleport, settle, and measure r / v relative to the body.
  const parkAt = async (key) => {
    await page.evaluate(`window.__teleport(${JSON.stringify(key)})`);
    await page.evaluate("window.__advance(1, 2)"); // let dominantBody refresh the HUD soi label
    return page.evaluate(`(() => {
      const s = window.__snap(); const sim = window.__sim();
      const st = window.__bodyState(${JSON.stringify(key)}); const B = window.__BODIES[${JSON.stringify(key)}];
      return { soi: s.soi, R: B.radius, mu: B.mu, atmoH: B.atmosphere ? B.atmosphere.height : 0,
        r: Math.hypot(sim.craft.pos.x - st.pos.x, sim.craft.pos.y - st.pos.y),
        vrel: Math.hypot(sim.craft.vel.x - st.vel.x, sim.craft.vel.y - st.vel.y) };
    })()`);
  };

  // ---- 1. Starmap travel: arrival at Base Camp Tessia --------------------------------
  {
    await page.evaluate(`window.__goSystem("Afra")`);
    const arr = await page.evaluate(`(() => ({
      name: window.__systemName(), mode: window.__sim().mode,
      home: window.__BODIES.earth.name, moon: window.__BODIES.moon.name,
      star: window.__BODIES.sun.name, stations: window.__stations(),
      text: document.body.textContent,
    }))()`);
    check("arrived: The Afra System around red dwarf Afra", arr.name === "The Afra System" && arr.star === "Afra", "");
    check("build mode on the pad of Tessia (earth role) with moon Pip",
      arr.mode === "build" && arr.home === "Tessia" && arr.moon === "Pip", `home=${arr.home}`);
    check("no home planet: no station orbits anything here",
      !arr.stations.some((id) => id === "st_home"), `stations=${arr.stations.join(",")}`);
    check("the arrival blurb says BASE CAMP", /BASE CAMP/.test(arr.text), "");
    const picker = await page.evaluate(
      `Array.from(document.querySelectorAll("#target-select option, select option")).map(o => o.textContent)`);
    const wants = ["Esis", "Verder", "Pip", "Phobie", "Drez", "Magrelle", "Glacier", "Hoth", "Necla", "Seretta"];
    const missing = wants.filter((w) => !picker.some((p) => p.includes(w)));
    check("🎯 picker lists the whole family", missing.length === 0, `missing=${missing.join(",")}`);
    await page.evaluate(`window.__setView("map")`);
    const lit = await page.evaluate("window.__renderAndSample()");
    check("map view draws", lit.litFraction > 0.003, `litFraction=${lit.litFraction.toFixed(4)}`);
    await shot("afra-system-map.png");
    await page.evaluate(`window.__setView("follow")`);
    await shot("afra-tessia-pad.png");
  }

  // ---- 2. Verder: predicted parking orbit at 3 g, ground-only scan flag ---------------
  {
    await page.evaluate(`window.__loadRocket([["engine_sparrow",0],["tank_small",0],["command_pod",0]])`);
    await page.evaluate(`window.__launch()`);
    await page.evaluate(`window.__advance(1, 5)`);
    const m = await parkAt("verder");
    // parkingOrbit = max(1.35R, R + 3·air height) — on big Verder the 1.35R floor wins.
    const rPred = Math.max(1.35 * m.R, m.R + 3 * m.atmoH), vPred = Math.sqrt(m.mu / rPred);
    check("parked around Verder", m.soi === "Verder", `soi=${m.soi}`);
    check("parking radius = max(1.35R, R + 3·air), predicted " + (rPred / 1000).toFixed(0) + " km",
      Math.abs(m.r - rPred) / rPred < 0.01, `r=${(m.r / 1000).toFixed(0)} km`);
    check("circular speed matches √(mu/r) within 2% (3 g world: fast orbit)",
      Math.abs(m.vrel - vPred) / vPred < 0.02, `v=${m.vrel.toFixed(0)} vs ${vPred.toFixed(0)} m/s`);
    const ctx = await page.evaluate("window.__expCtx()");
    const v = ctx.bodies.find((b) => b.key === "verder");
    const t = ctx.bodies.find((b) => b.key === "earth");
    check("Exploration context: Verder is ground-scan-only, Tessia is not",
      v && v.groundScanOnly === true && t && t.groundScanOnly === false, "");
    await shot("afra-verder-orbit.png");
  }

  // ---- 3. Esis: the lava lake from orbit ----------------------------------------------
  {
    const m = await parkAt("esis");
    check("parked around Esis (not stolen by Afra)", m.soi === "Esis", `soi=${m.soi}`);
    await shot("afra-esis-orbit.png");
  }

  // ---- 4. Magrelle: ring-clear parking, then UNDER the cloud roof ----------------------
  {
    const m = await parkAt("magrelle");
    const band = await page.evaluate("window.__BODIES.magrelle.style.ringBand.outer");
    check("parked around Magrelle, CLEAR of its ring band",
      m.soi === "Magrelle" && m.r > m.R * band, `r=${(m.r / m.R).toFixed(2)} R vs band ${band} R`);
    await shot("afra-magrelle-orbit.png");
    // Hover 300 m up on the sunward side, co-moving with the planet: below the deck.
    const below = await page.evaluate(`(() => {
      const sim = window.__sim(); const st = window.__bodyState("magrelle"); const B = window.__BODIES.magrelle;
      const d = Math.hypot(st.pos.x, st.pos.y) || 1;
      const ux = -st.pos.x / d, uy = -st.pos.y / d; // toward Afra
      sim.craft.pos.x = st.pos.x + ux * (B.radius + 300); sim.craft.pos.y = st.pos.y + uy * (B.radius + 300);
      sim.craft.vel.x = st.vel.x; sim.craft.vel.y = st.vel.y;
      sim.craft.angle = Math.atan2(uy, ux) - Math.PI / 2;
      return { deckAlt: B.atmosphere.height * B.style.cloudDeck.alt };
    })()`);
    await page.evaluate("window.__advance(0.05, 2)");
    const s = await page.evaluate("window.__snap()");
    check("hovering below Magrelle's cloud roof (altitude < deck)",
      s.altitude > 0 && s.altitude < below.deckAlt, `alt=${Math.round(s.altitude)} m vs deck ${Math.round(below.deckAlt)} m`);
    await shot("afra-magrelle-under-clouds.png");
  }

  // ---- 5. Glacier: inside the ring, unorbitable → formation ---------------------------
  {
    await page.evaluate(`window.__teleport("glacier")`);
    await page.evaluate("window.__advance(1, 2)");
    const g = await page.evaluate(`(() => {
      const sim = window.__sim(); const st = window.__bodyState("glacier");
      return { d: Math.hypot(sim.craft.pos.x - st.pos.x, sim.craft.pos.y - st.pos.y),
               R: window.__BODIES.glacier.radius, tiny: !!window.__BODIES.glacier.tinyMoon };
    })()`);
    check("Glacier is unorbitable (tinyMoon) and teleport flies formation at 5R",
      g.tiny && Math.abs(g.d - g.R * 5) < g.R * 0.2, `d=${(g.d / g.R).toFixed(2)} R`);
    await shot("afra-glacier-formation.png");
  }

  // ---- 6. Phobie up close: the two tails ------------------------------------------------
  {
    await page.evaluate(`window.__teleport("phobie")`);
    await page.evaluate("window.__advance(1, 2)");
    await page.evaluate(`window.__setView("map")`);
    await shot("afra-phobie-map.png");
    await page.evaluate(`window.__setView("follow")`);
  }

  check("zero page errors across the whole visit", pageErrors.length === 0,
    pageErrors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(failures ? `\nAFRA CHECK: ${failures} FAILURE(S)` : "\nAFRA CHECK: ALL GREEN");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
