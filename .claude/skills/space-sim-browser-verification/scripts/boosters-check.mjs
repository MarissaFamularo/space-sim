// boosters-check.mjs — scripted Artemis flight: strap-on pair + parallel staging,
// flown in the real browser build with numeric assertions.
//   usage: node boosters-check.mjs WORKDIR [PORT]
// Predictions (computed BEFORE running, house rule):
//   * Stage 0 thrust = 500 + 500 + 600 = 1600 kN (pair + core: PARALLEL staging)
//   * Stage-0 fuel pool = the pair's 8+8 = 16 t
//   * Burn to dry: ve_avg = (2450+2450+3000)/3 = 2633 m/s -> mdot = 1.6e6/2633
//     = 608 kg/s -> ~26.3 s
//   * After Space: thrust 600 (core alone), fuel 18 t (the mega tank — loadStage
//     loads the CURRENT stage's tanks), TWO debris bodies (the pair splits outward)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORK = process.argv[2];
const PORT = process.argv[3] || "8022";
if (!WORK) { console.error("usage: node boosters-check.mjs WORKDIR [PORT]"); process.exit(2); }

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

  // Close the front door properly (Menu.isOpen() gates the Space key we need later).
  await page.evaluate(`import("./js/menu.js").then((m) => m.Menu.hideAll())`);

  const shot = async (name) => {
    await page.evaluate("window.__renderAndSample()");
    await page.screenshot({ path: path.join(shots, name) });
    console.log("shot: " + path.join(shots, name));
  };

  // ---- 1. The builder knows about side boosters (UI section present) ----------------
  const ui = await page.evaluate(`(() => {
    const host = document.getElementById("palette-list");
    const txt = host ? host.textContent : "";
    const sel = host ? host.querySelector("select") : null;
    const opts = sel ? [...sel.options].map((o) => o.value) : [];
    return { hasSection: txt.includes("Side boosters"), thumperListed: opts.includes("booster_thumper") };
  })()`);
  check("builder shows the ⬅➡ Side boosters section", ui.hasSection);
  check("Thumper is offered as the strap-on choice", ui.thumperListed);

  // ---- 2. Build the Artemis-alike through the hooks ---------------------------------
  const n = await page.evaluate(`window.__loadRocket([
    ["engine_hawk", 1], ["tank_mega", 1],
    ["decoupler", 2], ["engine_osprey", 2], ["tank_large", 2], ["command_pod", 2],
    ["booster_thumper", 0, -1], ["booster_thumper", 0, 1]])`);
  check("Artemis Jr loaded (8 parts: 6 center + strap-on pair)", n === 8, `parts=${n}`);
  await shot("artemis-pad.png");

  // ---- 3. Liftoff: parallel staging numbers -----------------------------------------
  await page.evaluate("window.__launch()");
  let s = await page.evaluate("window.__snap()");
  check("stage 0 thrust = 1600 kN (pair + core lit TOGETHER)", s.thrust === 1600,
    `thrust=${s.thrust}`);
  check("stage-0 fuel pool is the pair's 16 t", Math.abs(s.fuel - 16) < 1e-9,
    `fuel=${s.fuel}`);
  check("it lifts off (TWR ~3.2)", s.status === "flying" && !s.cantLiftOff,
    `status=${s.status} cantLiftOff=${s.cantLiftOff}`);

  s = await page.evaluate("window.__advance(0.25, 12)"); // 3 s up
  check("climbing under the full spread", s.altitude > 20 && s.fuel < 16,
    `alt=${s.altitude.toFixed(0)}m fuel=${s.fuel.toFixed(2)}t`);
  await shot("artemis-liftoff.png");

  // ---- 4. Booster burnout (~26.3 s predicted) ---------------------------------------
  s = await page.evaluate("window.__advance(0.25, 108)"); // to t=30 s
  check("boosters burned dry near the predicted ~26 s", s.fuel === 0,
    `fuel=${s.fuel} t=${s.time.toFixed(1)}s`);

  // ---- 5. Booster separation via the real Space-key path ----------------------------
  await page.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }))`);
  s = await page.evaluate("window.__advance(0.1, 1)");
  const debris = await page.evaluate("window.__Render.debug().stageDebris");
  check("after sep: core burns ALONE at 600 kN", s.thrust === 600, `thrust=${s.thrust}`);
  // The real staging path (main.js loadStage) loads the CURRENT stage's tanks:
  // the mega tank's 18 t, minus the 0.1 s we just burned at 600 kN (~0.02 t).
  check("core stage fuel pool loaded (mega tank's 18 t)", s.fuel > 17.9 && s.fuel <= 18,
    `fuel=${s.fuel}`);
  check("the pair split into TWO falling boosters", debris === 2, `debris=${debris}`);

  s = await page.evaluate("window.__advance(0.25, 12)"); // 3 s on — let them drift clear
  await shot("artemis-separation.png");

  // ---- 6. Clean run -----------------------------------------------------------------
  check("zero page errors during the whole flight", pageErrors.length === 0,
    pageErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(failures === 0 ? "BOOSTERS CHECK: ALL GREEN" : `BOOSTERS CHECK: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
