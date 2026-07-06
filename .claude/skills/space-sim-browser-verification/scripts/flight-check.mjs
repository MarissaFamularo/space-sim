// flight-check.mjs — scripted verification flight with numeric assertions.
//   usage: node flight-check.mjs WORKDIR [PORT]
// Flow: build a minimal rocket via hooks -> launch -> 30 s vertical ascent (assert
// altitude/fuel numbers; screenshot the plume) -> map view screenshot -> teleport to the
// Moon (assert parking-orbit altitude + circular speed vs first principles) -> coast one
// full orbital lap in deterministic steps (assert drift %) -> screenshots.
// Tolerances are stated inline; numbers over eyeballs. Exit 0 only if all green.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORK = process.argv[2];
const PORT = process.argv[3] || "8022";
if (!WORK) { console.error("usage: node flight-check.mjs WORKDIR [PORT]"); process.exit(2); }

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
  let browser;
  try { browser = await chromium.launch(); }
  catch { browser = await chromium.launch({ executablePath: bundledChrome() }); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction("window.__hooksReady === true", null, { timeout: 20000 });
  const shot = async (name) => {
    await page.evaluate("window.__renderAndSample()"); // fresh draw right before capture
    await page.screenshot({ path: path.join(shots, name) });
    console.log("shot: " + path.join(shots, name));
  };

  // ---- 1. Minimal single-stage rocket (bottom->top; all stage 0) --------------------
  // engine_sparrow 215 kN over ~5.7 t: liftoff TWR ~3.8, comfortably flies.
  const n = await page.evaluate(`window.__loadRocket([
    ["engine_sparrow", 0], ["tank_small", 0], ["command_pod", 0], ["parachute", 0]])`);
  check("rocket loaded (4 parts)", n === 4, `parts=${n}`);

  // ---- 2. Launch + vertical ascent ---------------------------------------------------
  await page.evaluate("window.__launch()");
  let s = await page.evaluate("window.__snap()");
  check("launch: flying at full throttle", s.status === "flying" && s.throttle === 1 && !s.cantLiftOff,
    `status=${s.status} throttle=${s.throttle} thrust=${s.thrust}kN cantLiftOff=${s.cantLiftOff}`);
  check("launch: stage 0 stats correct", s.thrust === 215 && pct(s.fuel, 4.0) < 0.01,
    `thrust=${s.thrust} (engine_sparrow=215) fuel=${s.fuel}t (tank_small=4.0)`);

  // 5 sim-seconds up, then the plume screenshot. Plume renders only when
  // throttle > 0 AND thrust > 0 AND fuel > 0 — assert those numerically too.
  s = await page.evaluate("window.__advance(0.25, 20)");
  check("plume preconditions (throttle+thrust+fuel all on)",
    s.throttle > 0 && s.thrust > 0 && s.fuel > 0 && s.status === "flying",
    `t=${s.time.toFixed(1)}s alt=${s.altitude.toFixed(0)}m fuel=${s.fuel.toFixed(2)}t`);
  await shot("ascent-plume.png");

  // 25 more seconds. Sanity band, not exact: net accel starts ~28 m/s^2 and grows as
  // fuel burns, minus drag. 30 s of vertical burn must give 4-40 km and burned fuel.
  const s30 = await page.evaluate("window.__advance(0.25, 100)");
  check("ascent: altitude in 4-40 km band after 30 s",
    s30.altitude > 4000 && s30.altitude < 40000,
    `alt=${(s30.altitude / 1000).toFixed(1)}km speed=${s30.speed.toFixed(0)}m/s`);
  check("ascent: fuel burning", s30.fuel < s.fuel, `fuel ${s.fuel.toFixed(2)} -> ${s30.fuel.toFixed(2)}t`);
  check("ascent: still owned by Earth", s30.soi === "Earth", `soi=${s30.soi}`);

  await page.evaluate(`window.__setView("map")`);
  await shot("ascent-map.png");
  await page.evaluate(`window.__setView("follow")`);

  // ---- 3. Teleport to the Moon: parking orbit vs first principles -------------------
  // Physics.parkingOrbit: r = max(1.35 R, R + 3*atmo height); Moon has no air -> 1.35 R.
  // Expected altitude = 0.35 R; expected speed = sqrt(mu / 1.35 R). Pull R, mu from the
  // live BODIES catalog so the assertion tracks the game's own constants.
  const moon = await page.evaluate(`({ r: __BODIES.moon.radius, mu: __BODIES.moon.mu })`);
  const rPark = 1.35 * moon.r;
  const altExpect = rPark - moon.r;
  const vExpect = Math.sqrt(moon.mu / rPark);
  await page.evaluate(`window.__teleport("moon")`);
  s = await page.evaluate("window.__advance(0.5, 4)"); // settle; physics promotes to "orbit"
  check("teleport: owned by the Moon", s.soi === "Moon", `soi=${s.soi}`);
  check(`teleport altitude ~${(altExpect / 1000).toFixed(1)} km (tol 2%)`,
    pct(s.altitude, altExpect) < 2, `alt=${(s.altitude / 1000).toFixed(2)}km err=${pct(s.altitude, altExpect).toFixed(2)}%`);
  check(`teleport speed ~${vExpect.toFixed(0)} m/s circular (tol 2%)`,
    pct(s.speed, vExpect) < 2, `v=${s.speed.toFixed(1)}m/s err=${pct(s.speed, vExpect).toFixed(2)}%`);
  check("teleport: closed orbit reported", !!(s.orbit && s.orbit.isOrbit),
    s.orbit ? `ap=${(s.orbit.apoapsis / 1000).toFixed(1)}km pe=${(s.orbit.periapsis / 1000).toFixed(1)}km ecc=${s.orbit.ecc.toFixed(4)}` : "orbit=null");
  await shot("moon-orbit.png");

  // ---- 4. One full lap, deterministic 2 s steps -------------------------------------
  // Drift tolerance 10%: Earth's tide perturbs a superposed-gravity Moon orbit (the node
  // suite tests/teleport_test.mjs allows 35% across ALL worlds; Io's Jupiter tide ~10%).
  const period = 2 * Math.PI * Math.sqrt(rPark ** 3 / moon.mu);
  const steps = Math.ceil(period / 2);
  let minAlt = Infinity, maxAlt = 0, crashed = false;
  const CHUNK = 200; // sim-steps per page.evaluate round-trip
  for (let done = 0; done < steps && !crashed; done += CHUNK) {
    const k = Math.min(CHUNK, steps - done);
    const r = await page.evaluate(`window.__advance(2, ${k})`);
    minAlt = Math.min(minAlt, r.altitude); maxAlt = Math.max(maxAlt, r.altitude);
    crashed = r.status === "crashed";
  }
  const drift = (maxAlt - minAlt) / altExpect;
  check(`full Moon lap (~${(period / 60).toFixed(0)} min): never crashed, drift < 10%`,
    !crashed && drift < 0.10, `drift=${(drift * 100).toFixed(2)}% band=[${(minAlt / 1000).toFixed(1)}, ${(maxAlt / 1000).toFixed(1)}]km`);
  s = await page.evaluate("window.__snap()");
  check("after lap: still a closed Moon orbit", s.soi === "Moon" && !!(s.orbit && s.orbit.isOrbit),
    `soi=${s.soi} status=${s.status}`);
  await page.evaluate(`window.__setView("map")`);
  await shot("moon-map.png");

  check("zero page errors during the whole flight", pageErrors.length === 0, pageErrors.join(" | "));
  await browser.close();
  console.log(failures === 0 ? "FLIGHT CHECK: ALL GREEN" : `FLIGHT CHECK: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("FAIL  flight check crashed:", e); process.exit(1); });
