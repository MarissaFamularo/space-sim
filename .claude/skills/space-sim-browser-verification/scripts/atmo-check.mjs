// atmo-check.mjs — scripted verification of the atmosphere pass (sky dome + fresnel limb).
//   usage: node atmo-check.mjs WORKDIR [PORT]
// Numbers over eyeballs: the sky's COLOR and BRIGHTNESS are read back from canvas pixels
// at deterministic placements (subsolar / anti-solar, fixed altitudes). Predictions:
//   * Earth, 300 m, subsolar  -> bright sky, BLUE > RED   (air scatters blue most)
//   * Mars,  300 m, subsolar  -> bright-ish sky, RED > BLUE (butterscotch dust)
//   * Earth, 20 km            -> dark: above the (scaled) 7 km atmo top, density = 0
//   * Earth, 300 m, anti-solar-> dark: same air, not lit (night)
//   * Moon,  300 m, subsolar  -> dark: no atmosphere at all
// The Earth-vs-Mars color FLIP is the strongest assertion: no plausible rendering
// accident produces opposite channel dominance on the two worlds.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORK = process.argv[2];
const PORT = process.argv[3] || "8022";
if (!WORK) { console.error("usage: node atmo-check.mjs WORKDIR [PORT]"); process.exit(2); }

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
const f3 = (v) => v.toFixed(3);

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

  // The front-door overlays sit above the canvas; drop them so screenshots show the scene.
  await page.evaluate(`document.querySelectorAll(".ksp-screen").forEach((e) => e.remove())`);

  // In-page helpers. Render + pixel readback MUST share one JS task (no
  // preserveDrawingBuffer), so the sampler draws fresh, then reads, in one call.
  await page.evaluate(`
    // Mean r/g/b of the TOP-LEFT CORNER of the frame. At low altitude the follow
    // camera looks along the ground, so the surface fills most of the frame — the
    // corner is the one region that is reliably SKY (or space) at every placement.
    window.__sampleSky = () => {
      window.__Render.update(window.__sim());
      const src = document.getElementById("scene");
      const c = document.createElement("canvas"); c.width = 160; c.height = 120;
      const ctx = c.getContext("2d");
      ctx.drawImage(src, 0, 0, 160, 120);
      const d = ctx.getImageData(0, 0, 48, 22).data; // top-left corner patch
      let r = 0, g = 0, b = 0;
      const n = 48 * 22;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      r /= n * 255; g /= n * 255; b /= n * 255;
      return { r, g, b, mean: (r + g + b) / 3 };
    };
    // Hang the craft at a chosen altitude over a chosen point of a body's surface:
    // phase 0 = subsolar (noon), pi = anti-solar (midnight). Zero surface-relative
    // velocity; one short __advance step then renders it.
    window.__placeLowOver = async (key, alt, phase) => {
      const S = await import("./js/state.js"); // the game's own module instance
      const sim = window.__sim();
      const t = sim.time || 0;
      const bs = S.bodyStateAt(key, t);
      const sun = S.bodyStateAt("sun", t);
      let ux = sun.pos.x - bs.pos.x, uy = sun.pos.y - bs.pos.y;
      const m = Math.hypot(ux, uy) || 1;
      ux /= m; uy /= m;
      const cs = Math.cos(phase || 0), sn = Math.sin(phase || 0);
      const px = ux * cs - uy * sn, py = ux * sn + uy * cs;
      const R = window.__BODIES[key].radius;
      sim.craft.pos.x = bs.pos.x + px * (R + alt);
      sim.craft.pos.y = bs.pos.y + py * (R + alt);
      sim.craft.vel.x = bs.vel.x; sim.craft.vel.y = bs.vel.y;
      sim.craft.throttle = 0;
      sim.status = "flying";
      return window.__advance(0.05, 1);
    };
  `);

  const shot = async (name) => {
    await page.evaluate("window.__sampleSky()"); // fresh draw right before capture
    await page.screenshot({ path: path.join(shots, name) });
    console.log("shot: " + path.join(shots, name));
  };

  // Minimal rocket + launch puts us in flight mode with the world visible.
  await page.evaluate(`window.__loadRocket([
    ["engine_sparrow", 0], ["tank_small", 0], ["command_pod", 0], ["parachute", 0]])`);
  await page.evaluate("window.__launch()");
  await page.evaluate("window.__advance(0.1, 2)");

  // ---- 1. Earth at noon, 300 m up: a bright BLUE sky --------------------------------
  let s = await page.evaluate('window.__placeLowOver("earth", 300, 0)');
  let c = await page.evaluate("window.__sampleSky()");
  check("earth noon 300m: sky is bright", c.mean > 0.15,
    `mean=${f3(c.mean)} (dark space would be ~0.02)`);
  check("earth noon 300m: BLUE beats RED (scattered daylight)", c.b > c.r * 1.1,
    `r=${f3(c.r)} g=${f3(c.g)} b=${f3(c.b)}`);
  await shot("sky-earth-noon.png");

  // ---- 2. Earth at 20 km: above the scaled 7 km atmo top, the sky is GONE -----------
  s = await page.evaluate('window.__placeLowOver("earth", 20000, 0)');
  c = await page.evaluate("window.__sampleSky()");
  check("earth 20km: sky drained to space-black (density=0 above atmo top)", c.mean < 0.06,
    `mean=${f3(c.mean)} alt=${(s.altitude / 1000).toFixed(1)}km`);
  await shot("sky-earth-drained.png");

  // ---- 3. Earth at midnight, 300 m: same air, not lit -------------------------------
  s = await page.evaluate('window.__placeLowOver("earth", 300, Math.PI)');
  c = await page.evaluate("window.__sampleSky()");
  check("earth midnight 300m: night sky is dark (sun geometry drives it)", c.mean < 0.08,
    `mean=${f3(c.mean)}`);

  // ---- 4. Mars at noon, 300 m: BUTTERSCOTCH — the channel dominance FLIPS -----------
  s = await page.evaluate('window.__placeLowOver("mars", 300, 0)');
  c = await page.evaluate("window.__sampleSky()");
  check("mars noon 300m: sky visible", c.mean > 0.10, `mean=${f3(c.mean)}`);
  check("mars noon 300m: RED beats BLUE (dust, Earth's exact opposite)", c.r > c.b * 1.1,
    `r=${f3(c.r)} g=${f3(c.g)} b=${f3(c.b)}`);
  await shot("sky-mars-noon.png");

  // ---- 5. Moon at noon, 300 m: no air, no sky — stars at midday ---------------------
  s = await page.evaluate('window.__placeLowOver("moon", 300, 0)');
  c = await page.evaluate("window.__sampleSky()");
  check("moon noon 300m: black sky in daylight (no atmosphere)", c.mean < 0.06,
    `mean=${f3(c.mean)}`);
  await shot("sky-moon-noon.png");

  // ---- 6. The limb from orbit (fresnel shell) — screenshots for the human pass ------
  await page.evaluate('window.__teleport("earth")');
  await page.evaluate("window.__advance(1, 5)");
  await shot("limb-earth-orbit.png");
  await page.evaluate('window.__setView("map")');
  await page.evaluate("window.__advance(1, 2)");
  await shot("limb-earth-map.png");

  // ---- 7. Nothing blew up anywhere ---------------------------------------------------
  check("zero page errors during the whole run", pageErrors.length === 0,
    pageErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(failures === 0 ? "ATMO CHECK: ALL GREEN" : `ATMO CHECK: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
