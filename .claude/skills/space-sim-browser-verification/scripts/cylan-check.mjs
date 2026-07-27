// cylan-check.mjs — browser verification for the Cylan build (his Planet Nine).
//   usage: node cylan-check.mjs WORKDIR [PORT]
// Verifies: pre-reveal cover names everywhere, teleport parking orbit vs first
// principles (small-ring clearance), the reveal flip (names + localStorage + callout +
// picker), map labels, persistence across a reload, and fresh-state honesty.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORK = process.argv[2];
const PORT = process.argv[3] || "8022";
if (!WORK) { console.error("usage: node cylan-check.mjs WORKDIR [PORT]"); process.exit(2); }

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
const pct = (a, b) => Math.abs(a - b) / Math.abs(b) * 100;

async function main() {
  const shots = path.join(WORK, "shots");
  fs.mkdirSync(shots, { recursive: true });

  // Self-contained extra hook: expose the reveal machinery from the COPY's module scope
  // (idempotent append; scratch copy only — never the real source).
  const mainJs = path.join(WORK, "game", "js", "main.js");
  if (!fs.readFileSync(mainJs, "utf8").includes("__checkReveal")) {
    fs.appendFileSync(mainJs,
      '\n// cylan-check extra hook (scratch copy only)\n' +
      'window.__checkReveal = () => checkMysteryReveal();\n');
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
  // The 2026-07-12 front-door overlays cover the canvas in DOM screenshots:
  // START -> Space Center -> click the VAB building to reach the game proper.
  // JS-dispatched clicks: Playwright's actionability gate times out on these overlay
  // buttons under __TEST_DRIVE (no rAF), even though hit-testing shows them on top.
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
  const pickerTexts = () => page.evaluate(
    `Array.from(document.querySelectorAll("select option")).map(o => o.textContent)`);

  // ---- 0. Pristine state: no discovery recorded ------------------------------------
  await boot();
  await page.evaluate(`localStorage.removeItem("spacesim.discovery.v1")`);
  await boot(); // reload so the cover names are rebuilt from scratch

  // ---- 1. Pre-reveal: cover names everywhere ---------------------------------------
  const pre = await page.evaluate(`({
    name: window.__BODIES.cylan.name, trueName: window.__BODIES.cylan.trueName,
    m1: window.__BODIES.cylan1.name, m5: window.__BODIES.cylan5.name,
    radius: window.__BODIES.cylan.radius, mu: window.__BODIES.cylan.mu,
    ringOuter: window.__BODIES.cylan.style.ringBand.outer,
  })`);
  check("pre-reveal: catalog carries the cover name", pre.name === "Unknown Object" && pre.trueName === "Cylan",
    `name="${pre.name}"`);
  check("pre-reveal: moons wear numbered cover names", pre.m1 === "Unknown Moon I" && pre.m5 === "Unknown Moon V");
  let opts = await pickerTexts();
  check("pre-reveal: target picker says Unknown Object (no spoiler)",
    opts.some((t) => t.includes("Unknown Object")) && opts.some((t) => t.includes("Unknown Moon I")) &&
    !opts.some((t) => t.includes("Cylan")),
    `options=${opts.length}`);

  // ---- 2. Teleport: parking orbit vs first principles (small-ring clearance) -------
  // r = radius * ringBand.outer * 1.15 = 1.955 R  ->  alt = 0.955 R, v = sqrt(mu/r).
  const expR = pre.radius * pre.ringOuter * 1.15;
  const expAlt = expR - pre.radius;
  const expV = Math.sqrt(pre.mu / expR);
  await dismissMenus();
  // Teleport rides an active flight: launch a minimal rocket first (flight-check pattern).
  await page.evaluate(`window.__loadRocket([
    ["engine_sparrow", 0], ["tank_small", 0], ["command_pod", 0], ["parachute", 0]])`);
  await page.evaluate("window.__launch()");
  await page.evaluate("window.__advance(0.25, 20)");
  await page.evaluate(`window.__teleport("cylan")`);
  let s = await page.evaluate("window.__advance(1, 5)");
  check("teleport: owned by the Unknown Object (display name, no spoiler)",
    s.soi === "Unknown Object", `soi=${s.soi}`);
  check(`teleport altitude ~${(expAlt / 1000).toFixed(0)} km — parks clear of the SMALL ring (tol 2%)`,
    pct(s.altitude, expAlt) < 2, `alt=${(s.altitude / 1000).toFixed(1)}km err=${pct(s.altitude, expAlt).toFixed(2)}%`);
  check(`teleport speed ~${expV.toFixed(0)} m/s circular (tol 2%)`,
    pct(s.speed, expV) < 2, `v=${s.speed.toFixed(1)}m/s err=${pct(s.speed, expV).toFixed(2)}%`);
  await shot("cylan-approach.png");
  // Draw assertion in MAP view: orbit rings + dots + labels are deterministic bright
  // pixels; the follow view may honestly face Cylan's night side (dark world, real shadow).
  await page.evaluate(`window.__setView("map")`);
  const px = await page.evaluate("window.__renderAndSample()");
  check("map view draws the system at Cylan (lit pixels)", px.litFraction > 0.01,
    `litFraction=${px.litFraction.toFixed(3)}`);
  await page.evaluate(`window.__setView("follow")`);
  await page.evaluate("window.__advance(1, 2)");

  // ---- 3. The reveal ----------------------------------------------------------------
  await page.evaluate("window.__checkReveal()");
  const post = await page.evaluate(`({
    name: window.__BODIES.cylan.name, m3: window.__BODIES.cylan3.name,
    ls: localStorage.getItem("spacesim.discovery.v1"),
    callout: document.body.innerText.includes("CYLAN"),
  })`);
  check("reveal: planet renamed to Cylan", post.name === "Cylan");
  check("reveal: moons renamed to Cylan I–V", post.m3 === "Cylan III");
  check("reveal: persisted under spacesim.discovery.v1", (() => {
    try { return JSON.parse(post.ls).cylan === true; } catch { return false; }
  })(), `ls=${post.ls}`);
  check("reveal: discovery callout reached the Navigator log", post.callout === true);
  s = await page.evaluate("window.__advance(1, 2)");
  check("reveal: HUD soi now says Cylan", s.soi === "Cylan", `soi=${s.soi}`);
  opts = await pickerTexts();
  check("reveal: target picker rebuilt with true names",
    opts.some((t) => t.includes("Cylan")) && opts.some((t) => t.includes("Cylan I")) &&
    !opts.some((t) => t.includes("Unknown Object")));
  await page.evaluate(`window.__setView("map")`);
  await page.evaluate("window.__advance(1, 2)");
  await shot("cylan-map.png");

  // ---- 4. Persistence: a reload boots straight into the discovered names -----------
  await boot();
  const again = await page.evaluate("window.__BODIES.cylan.name");
  check("persistence: reload boots with the name Cylan", again === "Cylan", `name=${again}`);

  // ---- 5. Fresh-state honesty: clearing the key restores the mystery ----------------
  await page.evaluate(`localStorage.removeItem("spacesim.discovery.v1")`);
  await boot();
  const fresh = await page.evaluate("window.__BODIES.cylan.name");
  check("fresh state: mystery restored for a new discoverer", fresh === "Unknown Object", `name=${fresh}`);

  check("zero page errors during the whole check", pageErrors.length === 0,
    pageErrors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `CYLAN CHECK: ${failures} FAILURE(S)` : "CYLAN CHECK: ALL GREEN");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
