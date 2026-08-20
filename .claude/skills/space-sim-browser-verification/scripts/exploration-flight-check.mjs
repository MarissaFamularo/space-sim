// exploration-flight-check.mjs — the 🔭 board must never eat an active flight.
//   usage: node exploration-flight-check.mjs WORKDIR [PORT]   (after setup-scratch.sh)
//
// His report (2026-08-20, via Mom): doing the new science quests made his ship
// disappear. Mechanism: opening 🔭 Exploration Mode MID-FLIGHT and pressing the
// back button routed to the Space Center overlay, stranding the still-running
// flight behind it — every door there calls enterBuild() and wipes it. The fix
// makes the board's exit context-aware: mid-flight it returns to the ship (and
// the button says so); from the ground it still goes to the Space Center.
//
// Checks (real UI path — the Mode panel button, JS-dispatched clicks):
//   1. mid-flight: board opens, exit button reads "Back to your ship"
//   2. pressing it returns to the LIVE flight: same status, no center overlay,
//      craft still drawing (litFraction), sim numbers continuous
//   3. build mode: exit button reads "Space Center" and still goes there
//   4. zero page errors
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORK = process.argv[2];
const PORT = process.argv[3] || "8022";
if (!WORK) { console.error("usage: node exploration-flight-check.mjs WORKDIR [PORT]"); process.exit(2); }

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

  const boot = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction("window.__hooksReady === true", null, { timeout: 20000 });
    await page.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent.includes("START"));
      if (b) b.click();
      const vab = document.querySelector('.ksp-bld[data-go="vab"]');
      if (vab) vab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    })()`);
  };
  const clickButton = (needle) => page.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent.includes(${JSON.stringify(needle)}));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const boardOpen = () => page.evaluate(
    `!!Array.from(document.querySelectorAll("div")).find(d => d.textContent.includes("SURVEY BOARD"))`);
  const backLabel = () => page.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent.includes("⬅"));
    return b ? b.textContent : null;
  })()`);
  const centerUp = () => page.evaluate(`document.body.textContent.includes("KONNIE SPACE CENTER")`);

  // ---- 1. Mid-flight: open the board through the real Mode-panel button ------------
  await boot();
  await page.evaluate(`window.__loadRocket([
    ["engine_sparrow", 0], ["tank_small", 0], ["command_pod", 0], ["parachute", 0]])`);
  await page.evaluate("window.__launch()");
  const before = await page.evaluate("window.__advance(0.25, 40)");
  check("in flight before the board", before.status === "flying",
    `status=${before.status} alt=${before.altitude.toFixed(0)}m`);
  await clickButton("Exploration Mode");
  check("board opens mid-flight", await boardOpen());
  const label = await backLabel();
  check('mid-flight exit button says "Back to your ship"',
    !!label && label.includes("Back to your ship"), `label="${label}"`);

  // ---- 2. Exit returns to the LIVE flight ------------------------------------------
  await clickButton("Back to your ship");
  check("board closed", !(await boardOpen()));
  check("NOT routed to the Space Center", !(await centerUp()));
  const after = await page.evaluate("window.__snap()");
  check("flight still alive (same mode/status)",
    after.mode === "flight" && after.status === before.status,
    `mode=${after.mode} status=${after.status}`);
  check("flight state continuous (altitude & fuel kept)",
    Math.abs(after.altitude - before.altitude) < 5000 && after.fuel <= before.fuel,
    `alt ${before.altitude.toFixed(0)} -> ${after.altitude.toFixed(0)}m fuel ${before.fuel.toFixed(2)} -> ${after.fuel.toFixed(2)}t`);
  const px = await page.evaluate("window.__renderAndSample()");
  check("ship scene still draws", px.litFraction > 0.02, `litFraction=${px.litFraction.toFixed(3)}`);
  await page.evaluate("window.__renderAndSample()");
  await page.screenshot({ path: path.join(shots, "exploration-back-to-flight.png") });
  console.log("shot: " + path.join(shots, "exploration-back-to-flight.png"));

  // ---- 3. Build mode keeps the old door --------------------------------------------
  await boot(); // fresh page: build mode at the VAB
  await clickButton("Exploration Mode");
  check("board opens in build mode", await boardOpen());
  const label2 = await backLabel();
  check('build-mode exit button says "Space Center"',
    !!label2 && label2.includes("Space Center"), `label="${label2}"`);
  await clickButton("Space Center");
  check("build-mode exit still goes to the Space Center", await centerUp());

  // ---- 4. Clean run ----------------------------------------------------------------
  check("zero page errors during the whole run", pageErrors.length === 0,
    pageErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(failures === 0 ? "EXPLORATION FLIGHT CHECK: ALL GREEN" : `EXPLORATION FLIGHT CHECK: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
