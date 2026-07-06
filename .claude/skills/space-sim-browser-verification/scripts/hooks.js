
// ==== SPACE-SIM TEST HOOKS ============================================================
// Appended by setup-scratch.sh to the SCRATCH COPY's js/main.js ONLY. Never commit this
// to the real repo (frozen project rule: no debug hooks in real source).
// Because this block lives at the end of main.js's module scope, it can see the module's
// private state (sim, craft) and private functions (launch, teleport, updateStationsSim,
// loadStage) that window-level scripts cannot.
// The page is loaded with window.__TEST_DRIVE=true, which stops the requestAnimationFrame
// game loop from starting — rAF cadence is untrustworthy under automation, so tests own
// time explicitly through __advance(dt, steps).

window.__sim = () => sim;          // sim is REASSIGNED by launch()/teleport(): always call this fresh
window.__craft = () => craft;
window.__Physics = Physics;
window.__Render = Render;
window.__BODIES = BODIES;
window.__launch = () => launch();
window.__teleport = (key) => teleport(key);
window.__setThrottle = (v) => { sim.craft.throttle = v; };
window.__setAngle = (a) => { sim.craft.angle = a; };
window.__setView = (v) => Render.setFlightView(v); // "follow" | "map"

// Replace the shared craft's part list. parts: [[partId, stage], ...] in BOTTOM->TOP
// order (array order == physical stacking order; lowest part is stage 0 — builder.js).
window.__loadRocket = (parts) => {
  craft.parts.length = 0;
  let n = 0;
  for (const [partId, stage] of parts) {
    craft.parts.push({ instanceId: "hook" + (++n), partId, stage: stage || 0 });
  }
  Render.buildCraftMesh(craft);
  return craft.parts.length;
};

// Deterministic time: run the flight-relevant part of frame() ourselves.
// dt is SIM seconds per step (multiplied by sim.timeWarp, like the real loop);
// Physics.step substeps adaptively inside, so dt up to a few seconds is safe.
window.__advance = (dt, steps = 1) => {
  for (let i = 0; i < steps; i++) {
    if (sim.mode === "flight" && sim.status !== "crashed") {
      Physics.step(sim, dt * sim.timeWarp);
      sim.transfer = Physics.transferWindow(sim);
    }
    updateStationsSim(); // stations must be propagated to the same instant as the craft
  }
  UI.renderStats(null, sim);
  Render.update(sim);
  return window.__snap();
};

// Numbers-first snapshot for assertions. sim.soi is the dominant body's display NAME
// ("Moon", not "moon"); apoapsis/periapsis are ALTITUDES above the surface, in meters.
window.__snap = () => ({
  mode: sim.mode, status: sim.status, time: sim.time,
  altitude: sim.altitude, speed: sim.speed, soi: sim.soi,
  fuel: sim.craft.fuelRemaining, throttle: sim.craft.throttle, thrust: sim.craft.thrust,
  cantLiftOff: !!sim.cantLiftOff,
  orbit: sim.orbit ? { isOrbit: !!sim.orbit.isOrbit, apoapsis: sim.orbit.apoapsis,
                       periapsis: sim.orbit.periapsis, ecc: sim.orbit.eccentricity } : null,
});

// Is the WebGL canvas actually drawing? Renders, then reads pixels back IN THE SAME
// TASK (the drawing buffer survives until the next composite; a later read would be blank
// because preserveDrawingBuffer defaults to false).
window.__renderAndSample = () => {
  Render.update(sim);
  const src = document.getElementById("scene");
  const c = document.createElement("canvas"); c.width = 160; c.height = 120;
  const ctx = c.getContext("2d");
  ctx.drawImage(src, 0, 0, 160, 120);
  const d = ctx.getImageData(0, 0, 160, 120).data;
  let lit = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] + d[i + 1] + d[i + 2];
    sum += v;
    if (v > 36) lit++; // "lit" = visibly brighter than deep-space black
  }
  return { litFraction: lit / (160 * 120), meanBrightness: sum / (160 * 120 * 3 * 255) };
};

window.__hooksReady = true;
// ==== END TEST HOOKS ==================================================================
