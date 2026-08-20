// shadow-bump-check.mjs — numeric verification of sun shadows + bump relief.
//   usage: node shadow-bump-check.mjs WORKDIR [PORT]   (after setup-scratch.sh)
//
// Method: A/B pixel diff. The scratch copy (never the real source) gets two
// TEST-ONLY toggles appended — __setShadowsOn(on) / __setBumpOn(on) — plus a
// __pixelGrid() readback (160x120 per-pixel brightness, same-task readback like
// __renderAndSample). For each feature we measure the NOISE FLOOR (diff between
// two consecutive renders with nothing toggled), then flip the feature and
// require the diff to beat noise*5+20 pixels. Shadows must overwhelmingly
// DARKEN pixels, never brighten them (a brightening "shadow" would be a bug).
//
// Checks:
//   1. build-mode studio: rocket + space-center buildings shadow the ground disc
//   2. flight mode on the Earth pad: same, through the real flight path
//   3. Moon from 60.8 km orbit: bump relief visibly shades the painted face
//   4. gas giant regression: Jupiter has NO bump map (clouds stay smooth)
//   5. zero page errors throughout
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORK = process.argv[2];
const PORT = process.argv[3] || "8022";
if (!WORK) { console.error("usage: node shadow-bump-check.mjs WORKDIR [PORT]"); process.exit(2); }

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

// ---- Inject the copy-only hooks (idempotent) ---------------------------------------
const MARK = "// __SHADOW_BUMP_CHECK_HOOKS__";
const renderJs = path.join(WORK, "game", "js", "render.js");
if (!fs.readFileSync(renderJs, "utf8").includes(MARK)) {
  fs.appendFileSync(renderJs, `
${MARK} — TEST-ONLY toggles for the scratch copy; module scope reaches the private lets.
window.__setShadowsOn = (on) => { if (sunLight) sunLight.castShadow = !!on; };
window.__setBumpOn = (on) => {
  const flip = (o) => {
    if (o.isMesh && o.material && o.material.bumpMap) {
      if (o.userData.__bs0 === undefined) o.userData.__bs0 = o.material.bumpScale;
      o.material.bumpScale = on ? o.userData.__bs0 : 0;
    }
  };
  for (const k of Object.keys(bodyGroups)) bodyGroups[k].traverse(flip);
  if (groundPatch) flip(groundPatch);
};
window.__hasBumpMap = (key) => {
  let found = false;
  if (bodyGroups[key]) bodyGroups[key].traverse((o) => {
    if (o.isMesh && o.material && o.material.bumpMap) found = true;
  });
  return found;
};
`);
}
const mainJs = path.join(WORK, "game", "js", "main.js");
if (!fs.readFileSync(mainJs, "utf8").includes(MARK)) {
  fs.appendFileSync(mainJs, `
${MARK} — TEST-ONLY downsampled per-pixel brightness for A/B diff assertions.
window.__pixelGrid = () => {
  Render.update(sim);
  const src = document.getElementById("scene");
  const c = document.createElement("canvas"); c.width = 160; c.height = 120;
  const x = c.getContext("2d");
  x.drawImage(src, 0, 0, 160, 120);
  const d = x.getImageData(0, 0, 160, 120).data;
  const out = new Array(160 * 120);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = (d[i] + d[i + 1] + d[i + 2]) / 765;
  return out;
};
`);
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

  // Front-door overlays cover DOM screenshots; JS-dispatched clicks (cylan-check pattern).
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
  const grid = () => page.evaluate("window.__pixelGrid()");
  const diff = (a, b, tol = 0.02) => {
    let darker = 0, brighter = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] - b[i] > tol) darker++;        // pixel darker in b than a
      else if (b[i] - a[i] > tol) brighter++; // pixel brighter in b than a
    }
    return { darker, brighter, changed: darker + brighter };
  };

  // ---- 1. Build-mode studio: shadows on the ground disc ----------------------------
  await page.evaluate(`window.__loadRocket([
    ["engine_sparrow", 0], ["tank_small", 0], ["command_pod", 0], ["parachute", 0]])`);
  let g1 = await grid(), g2 = await grid();
  const noiseB = diff(g1, g2).changed; // animation/AA jitter between identical renders
  await page.evaluate("window.__setShadowsOn(false)");
  const offB = await grid();
  await page.evaluate("window.__setShadowsOn(true)");
  const onB = await grid();
  const dB = diff(offB, onB);
  check("build studio: shadows darken the pad scene (beats noise x5+20)",
    dB.darker > noiseB * 5 + 20,
    `darkened=${dB.darker}px noise=${noiseB}px (of 19200)`);
  check("build studio: shadows only darken (brightened stays at noise level)",
    dB.brighter <= noiseB + Math.ceil(dB.darker * 0.1),
    `brightened=${dB.brighter}px darkened=${dB.darker}px`);
  await shot("shadow-build-pad.png");

  // ---- 2. Flight mode, hovering low over Earth in oblique sun ----------------------
  // The real pad launch happens at dawn (sun near the horizon — an honest but faint
  // shadow), and the burning plume flickers ~44px of noise. So measure the flight-mode
  // shadow deterministically instead: hang the craft 5 m up, 40° off the subsolar
  // point (atmo-check's placement trick), throttle 0. Oblique sun throws the shadow
  // BESIDE the rocket where the overhead follow camera can see it.
  await page.evaluate("window.__launch()");
  const s0 = await page.evaluate("window.__snap()");
  check("launch: in flight mode", s0.mode === "flight", `status=${s0.status}`);
  await page.evaluate(`
    window.__placeLow = async (key, alt, phase) => {
      const S = await import("./js/state.js");
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
      return window.__advance(0.02, 1);
    };
  `);
  await page.evaluate("window.__placeLow('earth', 5, 0.7)");
  g1 = await grid(); g2 = await grid();
  const noiseF = diff(g1, g2).changed;
  await page.evaluate("window.__setShadowsOn(false)");
  const offF = await grid();
  await page.evaluate("window.__setShadowsOn(true)");
  const onF = await grid();
  const dF = diff(offF, onF);
  check("flight low over Earth: rocket shadows the ground patch (beats noise x5+20)",
    dF.darker > noiseF * 5 + 20,
    `darkened=${dF.darker}px noise=${noiseF}px`);
  check("flight low over Earth: shadows only darken",
    dF.brighter <= noiseF + Math.ceil(dF.darker * 0.1),
    `brightened=${dF.brighter}px darkened=${dF.darker}px`);
  await shot("shadow-flight-ground.png");

  // ---- 3. Moon from parking orbit: bump relief shades the face ---------------------
  await page.evaluate(`window.__teleport("moon")`);
  const sm = await page.evaluate("window.__advance(0.05, 1)"); // one step refreshes soi
  check("teleport: around the Moon", sm.soi === "Moon", `soi=${sm.soi}`);
  const hasMoonBump = await page.evaluate(`window.__hasBumpMap("moon")`);
  check("moon carries a bump map", hasMoonBump === true, `hasBumpMap=${hasMoonBump}`);
  g1 = await grid(); g2 = await grid();
  const noiseM = diff(g1, g2).changed;
  await page.evaluate("window.__setBumpOn(false)");
  const offM = await grid();
  await page.evaluate("window.__setBumpOn(true)");
  const onM = await grid();
  const dM = diff(offM, onM);
  check("moon orbit: bump relief changes the lit face (beats noise x5+20)",
    dM.changed > noiseM * 5 + 20,
    `changed=${dM.changed}px noise=${noiseM}px`);
  await shot("bump-moon-orbit.png");

  // ---- 4. Gas giants stay smooth (no mountains on Jupiter) -------------------------
  const jupBump = await page.evaluate(`window.__hasBumpMap("jupiter")`);
  check("jupiter has NO bump map (cloud tops stay smooth)", jupBump === false,
    `hasBumpMap=${jupBump}`);

  // ---- 5. Clean run ----------------------------------------------------------------
  check("zero page errors during the whole run", pageErrors.length === 0,
    pageErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(failures === 0 ? "SHADOW/BUMP CHECK: ALL GREEN" : `SHADOW/BUMP CHECK: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
