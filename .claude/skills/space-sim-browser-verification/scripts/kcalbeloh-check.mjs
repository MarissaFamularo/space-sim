// kcalbeloh-check.mjs — browser verification for THE KCALBELOH SYSTEM (Patrick's
// 2026-08-29 spec: a black hole with a family of orbiting stars, no home planet).
//   usage: node kcalbeloh-check.mjs WORKDIR [PORT]
// Verifies through the REAL machinery: Starmap arrival at Base Camp Cera, the black
// hole + accretion disk drawing in map view, formation teleport at unorbitable Kang
// (uranium face + locked lava shell on screen), a predicted-then-measured parking
// orbit at ocean-world Kishi and at twin giant Dizi (plus a sibling-tide hold), ring
// clearance at Anetta, the 🎯 picker carrying the Sol Gate, and the violet Kcalbeloh
// Gate parked at Pluto back home. Numbers come from the live __BODIES, never hardcoded.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORK = process.argv[2];
const PORT = process.argv[3] || "8022";
if (!WORK) { console.error("usage: node kcalbeloh-check.mjs WORKDIR [PORT]"); process.exit(2); }

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
  // real source — same pattern as ring-forge-check.mjs).
  const mainJs = path.join(WORK, "game", "js", "main.js");
  if (!fs.readFileSync(mainJs, "utf8").includes("__kcalHooks")) {
    fs.appendFileSync(mainJs, `
// kcalbeloh-check extra hooks (scratch copy only)
window.__kcalHooks = true;
window.__goSystem = (seed) => travelToSystem(seed);
window.__gates = () => WORMHOLES.map((w) => w.id);
window.__systemName = () => SYSTEM.name;
window.__bodyState = (k) => bodyStateAt(k, sim.time || 0);
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

  // ---- 1. Sol side first: the violet Kcalbeloh Gate hangs at Pluto ------------------
  {
    const gates = await page.evaluate("window.__gates()");
    check("Sol carries 5 gates incl. wh_kcalbeloh", gates.length === 5 && gates.includes("wh_kcalbeloh"),
      `gates=${gates.join(",")}`);
    await page.evaluate(`window.__loadRocket([["engine_sparrow",0],["tank_small",0],["command_pod",0]])`);
    await page.evaluate(`window.__launch()`);
    await page.evaluate(`window.__advance(1, 5)`);
    await page.evaluate(`window.__teleport("wormhole:wh_kcalbeloh")`);
    const near = await page.evaluate(`(() => {
      const s = window.__sim();
      const pl = window.__bodyState("pluto");
      return { dPluto: Math.hypot(s.craft.pos.x - pl.pos.x, s.craft.pos.y - pl.pos.y),
               R: window.__BODIES.pluto.radius };
    })()`);
    check("teleport parks beside the Pluto gate (within its 5.0R orbit +2km)",
      Math.abs(near.dPluto - near.R * 5.0) < 2000 + near.R * 0.05,
      `d=${(near.dPluto / 1000).toFixed(0)} km vs gate orbit ${(near.R * 5 / 1000).toFixed(0)} km`);
    await shot("kcal-gate-at-pluto.png");
  }

  // ---- 2. Starmap travel: arrival at Base Camp Cera, black hole live ----------------
  {
    await page.evaluate(`window.__goSystem("Kcalbeloh")`);
    const arr = await page.evaluate(`(() => ({
      name: window.__systemName(),
      bh: !!window.__BODIES.sun.blackHole,
      mode: window.__sim().mode,
      home: window.__BODIES.earth.name,
      moon: window.__BODIES.moon.name,
      gates: window.__gates(),
      noBary: !document.body.textContent.includes("Waltz Point"),
    }))()`);
    check("arrived: The Kcalbeloh System, black hole star", arr.name === "The Kcalbeloh System" && arr.bh, "");
    check("build mode on the pad of Cera (earth role) with moon Yang",
      arr.mode === "build" && arr.home === "Cera" && arr.moon === "Yang", `home=${arr.home}`);
    check("the Sol Gate rides here (wh_sol_kcalbeloh)", arr.gates.includes("wh_sol_kcalbeloh"), "");
    check("the invisible waltz point leaks into NO visible text", arr.noBary, "");
    const picker = await page.evaluate(
      `Array.from(document.querySelectorAll("#target-select option, select option")).map(o => o.textContent)`);
    const wants = ["Kang", "Kishi", "Dizi", "Zidi", "Ethyl", "Anetta"];
    check("🎯 picker lists the family (Kang, Kishi, Dizi, Zidi, Anetta, Ethyl)",
      wants.every((w) => picker.some((p) => p.includes(w))), `got ${picker.length} options`);
    check("🎯 picker does NOT list the waltz point", !picker.some((p) => p.includes("Waltz")), "");
    await page.evaluate(`window.__setView("map")`);
    const lit = await page.evaluate("window.__renderAndSample()");
    check("map view draws (accretion disk + rings + labels)", lit.litFraction > 0.005,
      `litFraction=${lit.litFraction.toFixed(3)}`);
    await shot("kcal-system-map.png");
    await page.evaluate(`window.__setView("follow")`);
  }

  // ---- 3. Kang: formation only (the hole steals orbits), faces on screen ------------
  {
    await page.evaluate(`window.__launch()`);
    await page.evaluate(`window.__advance(1, 5)`);
    await page.evaluate(`window.__teleport("kang")`);
    await page.evaluate("window.__advance(1, 2)"); // let dominantBody refresh the HUD soi label
    const k = await page.evaluate(`(() => {
      const s = window.__sim();
      const ks = window.__bodyState("kang");
      return { d: Math.hypot(s.craft.pos.x - ks.pos.x, s.craft.pos.y - ks.pos.y),
               R: window.__BODIES.kang.radius, tiny: !!window.__BODIES.kang.tinyMoon,
               soi: window.__snap().soi };
    })()`);
    check("Kang is honestly unorbitable (tinyMoon: the hole's pull wins)", k.tiny, "");
    check("teleport flies formation at 5R alongside Kang",
      Math.abs(k.d - k.R * 5) < k.R * 0.1, `d=${(k.d / 1000).toFixed(0)} km = ${(k.d / k.R).toFixed(2)} R`);
    check("readouts measure from the hole out here (SOI display truth)",
      k.soi === "Kcalbeloh", `soi=${k.soi}`);
    const lit = await page.evaluate("window.__renderAndSample()");
    check("Kang draws at formation distance", lit.litFraction > 0.002, `lit=${lit.litFraction.toFixed(4)}`);
    await shot("kcal-kang-formation.png");
  }

  // ---- 4. Kishi: predicted parking orbit at the ocean world -------------------------
  {
    await page.evaluate(`window.__teleport("kishi")`);
    await page.evaluate("window.__advance(1, 2)"); // let dominantBody refresh the HUD soi label
    const m = await page.evaluate(`(() => {
      const s = window.__snap();
      const B = window.__BODIES.kishi;
      const st = window.__bodyState("kishi");
      const sim = window.__sim();
      const r = Math.hypot(sim.craft.pos.x - st.pos.x, sim.craft.pos.y - st.pos.y);
      const vrel = Math.hypot(sim.craft.vel.x - st.vel.x, sim.craft.vel.y - st.vel.y);
      return { soi: s.soi, r, vrel, R: B.radius, mu: B.mu };
    })()`);
    const vPred = Math.sqrt(m.mu / m.r);
    check("parked around Kishi", m.soi === "Kishi", `soi=${m.soi}`);
    check("parking altitude in the no-atmo-drag band (1.3R–1.5R)",
      m.r > m.R * 1.3 && m.r < m.R * 1.5, `r=${(m.r / m.R).toFixed(2)} R`);
    check("circular speed matches √(mu/r) within 2%",
      Math.abs(m.vrel - vPred) / vPred < 0.02, `v=${m.vrel.toFixed(0)} vs ${vPred.toFixed(0)} m/s`);
    await shot("kcal-kishi-orbit.png");
  }

  // ---- 5. Dizi: clean entry orbit, then a sibling-tide hold (the honest wobble) -----
  {
    await page.evaluate(`window.__teleport("dizi")`);
    await page.evaluate("window.__advance(1, 2)"); // let dominantBody refresh the HUD soi label
    const d0 = await page.evaluate(`(() => {
      const s = window.__snap();
      const st = window.__bodyState("dizi");
      const sim = window.__sim();
      return { soi: s.soi, alt: s.altitude,
               r: Math.hypot(sim.craft.pos.x - st.pos.x, sim.craft.pos.y - st.pos.y) };
    })()`);
    check("parked around twin giant Dizi", d0.soi === "Dizi", `soi=${d0.soi}`);
    // Hold half a local lap under the sibling's tide: still bound, still around Dizi.
    await page.evaluate("window.__advance(5, 540)"); // 2,700 s ≈ half the 90-min lap
    const d1 = await page.evaluate(`(() => {
      const s = window.__snap();
      const st = window.__bodyState("dizi");
      const sim = window.__sim();
      return { soi: s.soi, status: s.status,
               r: Math.hypot(sim.craft.pos.x - st.pos.x, sim.craft.pos.y - st.pos.y) };
    })()`);
    check("half a lap later: still bound to Dizi under Zidi's tide (drift < 35%)",
      d1.soi === "Dizi" && d1.status !== "crashed" && Math.abs(d1.r - d0.r) / d0.r < 0.35,
      `r ${(d0.r / 1000).toFixed(0)} → ${(d1.r / 1000).toFixed(0)} km`);
    await page.evaluate(`window.__setView("map")`);
    await shot("kcal-twins-map.png"); // two rings around an empty point
    await page.evaluate(`window.__setView("follow")`);
  }

  // ---- 6. Anetta: ring-clear parking; Ethyl in the picker already checked -----------
  {
    await page.evaluate(`window.__teleport("anetta")`);
    await page.evaluate("window.__advance(1, 2)"); // let dominantBody refresh the HUD soi label
    const a = await page.evaluate(`(() => {
      const s = window.__snap();
      const st = window.__bodyState("anetta");
      const sim = window.__sim();
      return { soi: s.soi, R: window.__BODIES.anetta.radius,
               r: Math.hypot(sim.craft.pos.x - st.pos.x, sim.craft.pos.y - st.pos.y) };
    })()`);
    check("parked around ringed Anetta, CLEAR of the ring band (r > 2.3R)",
      a.soi === "Anetta" && a.r > a.R * 2.3, `r=${(a.r / a.R).toFixed(2)} R`);
    await shot("kcal-anetta-ring.png");
  }

  // ---- 7. Whole run: zero page errors ------------------------------------------------
  check("zero page errors across the whole visit", pageErrors.length === 0,
    pageErrors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(failures ? `\nKCALBELOH CHECK: ${failures} FAILURE(S)` : "\nKCALBELOH CHECK: ALL GREEN");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
