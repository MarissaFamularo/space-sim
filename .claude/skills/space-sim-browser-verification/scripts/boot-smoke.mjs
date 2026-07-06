// boot-smoke.mjs — does the real game boot clean in a real browser?
//   usage: node boot-smoke.mjs WORKDIR [PORT]
// Checks: page loads; ZERO console errors / page errors / failed requests; the
// index.html boot-failure banner did NOT appear; UI panels populated; the WebGL canvas
// is actually drawing (pixel readback, not eyeball); screenshot of the pad.
// Exit code 0 only if every check passes. Output style matches tests/*.mjs (PASS/FAIL).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORK = process.argv[2];
const PORT = process.argv[3] || "8022";
if (!WORK) { console.error("usage: node boot-smoke.mjs WORKDIR [PORT]"); process.exit(2); }

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
export async function launchBrowser() {
  try { return await chromium.launch(); }
  catch {
    const exe = bundledChrome();
    if (!exe) throw new Error("no chromium found under PLAYWRIGHT_BROWSERS_PATH");
    return await chromium.launch({ executablePath: exe });
  }
}

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}

async function main() {
  const shots = path.join(WORK, "shots");
  fs.mkdirSync(shots, { recursive: true });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const consoleErrors = [], pageErrors = [], failedReqs = [];
  // Known-benign: the repo ships no favicon, so the browser's automatic /favicon.ico
  // request 404s and logs a console error. Everything else fails the run.
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = (m.location() && m.location().url) || "";
    if (url.endsWith("/favicon.ico")) return;
    consoleErrors.push(m.text() + (url ? " @ " + url : ""));
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("requestfailed", (r) => failedReqs.push(r.url() + "  " + (r.failure()?.errorText || "")));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction("window.__hooksReady === true", null, { timeout: 20000 });
  await page.waitForTimeout(1500); // let async texture loads settle / fail loudly

  check("modules booted (test hooks reachable)", await page.evaluate("window.__hooksReady === true"));
  const bannerUp = await page.evaluate(
    `document.body.innerText.includes("The game hit an error")`);
  check("no boot-failure banner (index.html boot reporter)", !bannerUp);
  check("zero page errors", pageErrors.length === 0, pageErrors.join(" | "));
  check("zero console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  check("zero failed requests (missing vendor/texture files)", failedReqs.length === 0, failedReqs.join(" | "));

  // Palette layout (builder.js): #palette-list's FIRST child div is _paletteWrap,
  // one row per merged part (18 stock as of 2026-07-06; more if the kid has mods).
  const ui = await page.evaluate(`({
    palette: (document.querySelector("#palette-list > div") || { children: [] }).children.length,
    controls: document.querySelectorAll("#control-list > *").length,
    navigator: (document.getElementById("copilot-log") || {}).children ? document.getElementById("copilot-log").children.length : 0,
  })`);
  check("parts palette populated", ui.palette >= 18, `rows=${ui.palette} (18 stock parts as of 2026-07-06)`);
  check("mode controls populated", ui.controls >= 1, `nodes=${ui.controls}`);
  check("navigator greeted", ui.navigator >= 1, `messages=${ui.navigator}`);

  const px = await page.evaluate("window.__renderAndSample()");
  check("canvas non-blank (pixel readback)", px.litFraction > 0.02,
    `litFraction=${px.litFraction.toFixed(3)} mean=${px.meanBrightness.toFixed(3)}`);

  await page.evaluate("window.__renderAndSample()"); // fresh draw right before capture
  await page.screenshot({ path: path.join(shots, "boot-pad.png") });
  console.log("shot: " + path.join(shots, "boot-pad.png"));

  await browser.close();
  console.log(failures === 0 ? "BOOT SMOKE: ALL GREEN" : `BOOT SMOKE: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) main().catch((e) => { console.error("FAIL  boot smoke crashed:", e); process.exit(1); });
