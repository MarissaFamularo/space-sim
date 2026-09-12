import { LAB_G, EARTHS_PER_SUN, KM_S_PER_AU_YR, LAB_SAVE_KEY, clone, preset, newLab, advanceLab, accelerations, moonOrbit, parseLabSave } from "./planetlab-physics.js";

const EXPERIMENTS = {
  moon: { title: "Keep your moon", tag: "01 / THE MOON CHALLENGE", question: "Can you keep Pip for ten years?",
    hint: "Try changing Pip’s starting speed. How slow is too slow? How fast is too fast?", follow: "planet", span: .12, selected: "moon" },
  binary: { title: "Two suns", tag: "02 / THE BINARY EXPERIMENT", question: "One world. Two moving suns.",
    hint: "Move Wanderer closer to the pair. Where does its orbit stop behaving?", follow: "system", span: 4.5, selected: "planet" },
  comet: { title: "Comet slingshot", tag: "03 / THE CLOSE ENCOUNTER", question: "Can Atlas bend Spark’s path?",
    hint: "Change Spark’s direction by a few degrees. Compare its speed before and after the flyby, far from Atlas.", follow: "system", span: 3.8, selected: "comet" },
};
let root = null, raf = 0, handlers = {}, experiment = "moon", initial, state, selected, follow, span;
let running = false, last = 0, histories = [], trails = {}, sample = 0, baseMass = {}, baseSpeed = {}, badge;
let canvas, ctx, ui = {}, drag = null, nextId = 1, elapsed = 0, suppressed = [];
const $ = s => root.querySelector(s);
const fmt = (v, n = 2) => Number(v).toLocaleString(undefined, { maximumFractionDigits: n });
function selectedBody(list = state.bodies) { return list.find(b => b.id === selected) || list[0]; }
function refBody(b, list = state.bodies) { return list.find(p => p.id === b.parent); }
function relative(b, list = state.bodies) {
  const p = refBody(b, list);
  return { vx: b.vx - (p?.vx || 0), vy: b.vy - (p?.vy || 0), name: p?.name || "lab frame" };
}
function rememberBadge() {
  badge.moonKeeper = true;
  try { localStorage.setItem(LAB_SAVE_KEY, JSON.stringify(badge)); } catch {}
}
function pause() { running = false; ui.play.textContent = "▶ Run experiment"; }
function reset() {
  pause(); state = newLab(initial, experiment); histories = []; trails = {}; sample = 0;
  ui.timeline.value = 0; ui.timeline.max = 0; ui.timeline.disabled = true;
  ui.editNote.textContent = "Changes start a fresh run. Drag a world to change its starting position.";
  record(); updateControls(); updateReadouts();
}
function loadExperiment(kind) {
  experiment = kind; const info = EXPERIMENTS[kind];
  initial = preset(kind); baseMass = Object.fromEntries(initial.map(b => [b.id, b.mass]));
  baseSpeed = Object.fromEntries(initial.map(b => { const r = relative(b, initial); return [b.id, Math.hypot(r.vx, r.vy)]; }));
  selected = info.selected; follow = info.follow; span = info.span;
  ui.tag.textContent = info.tag; ui.question.textContent = info.question; ui.hint.textContent = info.hint;
  ui.tabs.forEach(b => { b.classList.toggle("active", b.dataset.experiment === kind); b.setAttribute("aria-pressed", b.dataset.experiment === kind); });
  ui.follow.value = follow; ui.add.disabled = kind === "moon";
  ui.add.title = kind === "moon" ? "Try adding worlds in Two suns or Comet slingshot." : "Place a new world in the experiment";
  reset();
}
function edit(fn) {
  // Editing always changes the launch setup. Rewind is explicit in the control copy.
  pause(); fn(initial); reset();
}
function updateControls() {
  ui.bodies.replaceChildren();
  state.bodies.forEach(b => {
    const option = document.createElement("option"); option.value = b.id; option.textContent = b.name;
    ui.bodies.appendChild(option);
  });
  ui.bodies.value = selected;
  const b = selectedBody(initial), rel = relative(b, initial);
  ui.mass.value = b.mass / baseMass[b.id];
  const earthMasses = b.mass * EARTHS_PER_SUN;
  ui.massValue.textContent = `${fmt(earthMasses, earthMasses < .01 ? 10 : 2)} Earth masses`;
  const speed = Math.hypot(rel.vx, rel.vy);
  ui.speed.max = Math.max(1, baseSpeed[b.id] * 2.2); ui.speed.step = .001; ui.speed.value = speed;
  ui.speedValue.textContent = `${fmt(speed * KM_S_PER_AU_YR)} km/s`;
  ui.angle.value = ((Math.atan2(rel.vy, rel.vx) * 180 / Math.PI + 360) % 360).toFixed(1);
  ui.angleValue.textContent = `${ui.angle.value}°`;
  ui.relative.textContent = `Starting motion relative to ${rel.name}. 0° → right; 90° ↑ up.`;
  ui.remove.disabled = experiment === "moon" || state.bodies.length <= 2 || ["sun", "twin"].includes(selected);
  ui.add.disabled = experiment === "moon" || state.bodies.length >= 8;
}
function record() {
  // Sample in simulated time, so fast-forward cannot turn circles into star polygons.
  histories.push(clone(state)); if (histories.length > 4000) histories.shift();
  const center = cameraCenter();
  state.bodies.forEach(b => {
    (trails[b.id] ||= []).push({ x: b.x - center.x, y: b.y - center.y });
    if (trails[b.id].length > 700) trails[b.id].shift();
  });
  ui.timeline.max = histories.length - 1; ui.timeline.value = histories.length - 1;
  ui.timeline.disabled = histories.length < 2;
}
function cameraCenter() {
  if (follow !== "system") {
    const b = state.bodies.find(b => b.id === follow) || selectedBody();
    return { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
  }
  const mass = state.bodies.reduce((s, b) => s + b.mass, 0);
  const avg = k => state.bodies.reduce((s, b) => s + b.mass * b[k], 0) / mass;
  return { x: avg("x"), y: avg("y"), vx: avg("vx"), vy: avg("vy") };
}
function updateReadouts() {
  ui.clock.textContent = `${state.time.toFixed(2)} years`;
  const b = selectedBody(), r = relative(b);
  ui.liveName.textContent = b.name;
  ui.liveSpeed.textContent = `${fmt(Math.hypot(r.vx, r.vy) * KM_S_PER_AU_YR)} km/s`;
  ui.liveRef.textContent = `relative to ${r.name}`;
  const orbit = moonOrbit(state.bodies);
  ui.progress.hidden = experiment !== "moon";
  ui.progress.value = Math.min(state.time, 10);
  ui.badge.textContent = badge.moonKeeper ? "✦ Moon Keeper earned" : "✧ Moon Keeper badge";
  ui.result.className = "pl-result";
  if (state.collision) {
    ui.result.textContent = `${state.collision.a} met ${state.collision.b}! Rewind and try a different path.`;
    ui.result.classList.add("warm");
  } else if (state.outcome === "kept") {
    ui.result.textContent = "✦ MOON KEEPER! Pip stayed bound for ten years. Can you do it with a different orbit?";
    ui.result.classList.add("success");
  } else if (state.outcome === "lost") {
    ui.result.textContent = "Pip’s orbit failed the keeper check. Try less speed or a closer starting position.";
    ui.result.classList.add("warm");
  } else if (experiment === "moon") {
    ui.result.textContent = `${running ? "Watching Pip…" : "Ready to test a theory?"} ${Math.min(state.time, 10).toFixed(1)} / 10 years. ${orbit?.bound ? "Pip is gravitationally bound to Atlas." : "Pip’s starting speed is above escape speed."}`;
  } else {
    ui.result.textContent = running ? "Every world is pulling on every other world. Watch the trails." : "Make a prediction. Run it. Rewind. Change one thing.";
  }
  ui.question.textContent = state.outcome === "kept" ? "✦ You kept Pip for ten years!" : state.collision ? "A collision! What would you change?" : state.outcome === "lost" ? "Pip needs a different orbit." : EXPERIMENTS[experiment].question;
  ui.editNote.textContent = state.time > 0 ? "Changing a control or dragging a world rewinds to the start. The timeline replays this run." : "Changes start a fresh run. Drag a world to change its starting position.";
}
function resize() {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function geometry() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  return { w, h, scale: Math.min(w, h) / span, center: cameraCenter() };
}
function screenPoint(b, g) { return { x: g.w / 2 + (b.x - g.center.x) * g.scale, y: g.h / 2 - (b.y - g.center.y) * g.scale }; }
function arrow(x, y, dx, dy, color) {
  const l = Math.hypot(dx, dy); if (l < 3) return;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
  const a = Math.atan2(dy, dx); ctx.beginPath(); ctx.moveTo(x + dx, y + dy);
  ctx.lineTo(x + dx - 8 * Math.cos(a - .45), y + dy - 8 * Math.sin(a - .45));
  ctx.lineTo(x + dx - 8 * Math.cos(a + .45), y + dy - 8 * Math.sin(a + .45)); ctx.fill();
}
function draw() {
  const g = geometry(), { w, h, scale, center } = g;
  if (!w || !h) return;
  ctx.fillStyle = "#060c18"; ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * .5, h * .5, 0, w * .5, h * .5, w * .7);
  glow.addColorStop(0, "#11223c"); glow.addColorStop(1, "#060b16"); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 125; i++) {
    ctx.fillStyle = `rgba(186,211,255,${.15 + (i % 5) * .1})`;
    ctx.fillRect(((i * 347 + 79) % 997) / 997 * w, ((i * 157 + 19) % 613) / 613 * h, i % 7 === 0 ? 2 : 1, 1);
  }
  const grid = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const gap = grid * scale;
  ctx.strokeStyle = "#29425d44"; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = w / 2 % gap; x < w; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = h / 2 % gap; y < h; y += gap) { ctx.moveTo(0, y); ctx.lineTo(w, y); } ctx.stroke();
  if (ui.trails.checked) for (const b of state.bodies) {
    const points = trails[b.id] || []; ctx.strokeStyle = b.color + "95"; ctx.lineWidth = 1.6; ctx.beginPath();
    points.forEach((p, i) => { const x = w / 2 + p.x * scale, y = h / 2 - p.y * scale; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  }
  if (experiment === "moon" && follow === "planet") {
    const orbit = moonOrbit(state.bodies);
    ctx.setLineDash([4, 7]); ctx.strokeStyle = "#7990c255"; ctx.beginPath(); ctx.arc(w / 2, h / 2, orbit.hill * scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  const accelerationsNow = ui.vectors.checked ? accelerations(state.bodies) : [];
  state.bodies.forEach((b, i) => {
    const p = screenPoint(b, g), star = b.id === "sun" || b.id === "twin";
    const radius = star ? experiment === "binary" ? 11 : 21 : b.id === "comet" ? 5 : b.id === "moon" ? 9 : 16;
    if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) {
      const dx = p.x - w / 2, dy = p.y - h / 2, f = Math.min((w / 2 - 55) / Math.max(Math.abs(dx), 1), (h / 2 - 50) / Math.max(Math.abs(dy), 1));
      const x = w / 2 + dx * f, y = h / 2 + dy * f;
      const direction = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? "←" : "→" : dy < 0 ? "↑" : "↓";
      ctx.fillStyle = b.color; ctx.font = "12px system-ui"; ctx.textAlign = "center"; ctx.fillText(`${b.name} ${direction}`, x, y);
      return;
    }
    const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 3);
    halo.addColorStop(0, b.color + "60"); halo.addColorStop(1, b.color + "00"); ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(p.x, p.y, radius * 3, 0, Math.PI * 2); ctx.fill();
    const sphere = ctx.createRadialGradient(p.x - radius * .4, p.y - radius * .4, 1, p.x, p.y, radius);
    sphere.addColorStop(0, star ? "#fff7db" : "#e1f5ff"); sphere.addColorStop(.3, b.color); sphere.addColorStop(1, star ? b.color : "#173347");
    ctx.fillStyle = sphere; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
    if (b.id === selected) {
      ctx.strokeStyle = "#e9f5ff"; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(p.x, p.y, radius + 7, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    }
    const labelY = experiment === "binary" && b.id === "sun" ? p.y - radius - 12 : p.y + radius + 24;
    ctx.textAlign = "center"; ctx.font = "600 12px system-ui"; ctx.fillStyle = "#e6f0ff"; ctx.fillText(b.name, p.x, labelY);
    if (ui.vectors.checked && b.id === selected) {
      const rel = relative(b), a = accelerationsNow[i];
      const velocityLength = Math.min(110, Math.hypot(rel.vx, rel.vy) * 18);
      const va = Math.atan2(rel.vy, rel.vx);
      arrow(p.x, p.y, Math.cos(va) * velocityLength, -Math.sin(va) * velocityLength, "#66e5ce");
      const al = Math.min(90, Math.log1p(Math.hypot(a.x, a.y)) * 15), aa = Math.atan2(a.y, a.x);
      arrow(p.x, p.y, Math.cos(aa) * al, -Math.sin(aa) * al, "#ffc677");
    }
  });
  ctx.textAlign = "left"; ctx.fillStyle = "#9db2cd"; ctx.font = "11px system-ui";
  ctx.fillText(`${fmt(grid, 4)} AU per grid square · worlds enlarged for visibility`, 18, h - 20);
}
function tick(now) {
  if (!root) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(canvas.clientWidth * dpr) || canvas.height !== Math.round(canvas.clientHeight * dpr)) resize();
  const dt = last ? Math.min((now - last) / 1000, .05) : 0; last = now;
  if (running) {
    let remaining = dt * Number(ui.rate.value);
    while (remaining > 1e-10 && !state.collision && !state.outcome) {
      const step = Math.min(remaining, .005), before = state.time;
      advanceLab(state, step); remaining -= step; sample += state.time - before;
      if (sample >= .0045 || state.collision || state.outcome) { record(); sample = 0; }
    }
    if (state.collision || state.outcome) {
      pause(); if (state.outcome === "kept") rememberBadge();
    }
  }
  elapsed += dt;
  if (elapsed > .1) { updateReadouts(); elapsed = 0; }
  draw(); raf = requestAnimationFrame(tick);
}
function blockGameKeys(event) {
  event.stopPropagation();
  if (event.type === "keydown" && event.key === "Escape") { event.preventDefault(); close(); return; }
  if (event.type === "keydown" && event.code === "Space" && !["INPUT", "SELECT", "BUTTON", "TEXTAREA"].includes(event.target.tagName)) {
    event.preventDefault(); if (!event.repeat) ui.play.click();
  }
}
function close() {
  hide(); if (handlers.onExit) handlers.onExit();
}
function hide() {
  cancelAnimationFrame(raf);
  window.removeEventListener("keydown", blockGameKeys, true); window.removeEventListener("keyup", blockGameKeys, true);
  root?.remove(); root = null; running = false; drag = null;
  suppressed.forEach(([element, wasInert]) => { element.inert = wasInert; }); suppressed = [];
}
function show() {
  hide();
  try { badge = parseLabSave(localStorage.getItem(LAB_SAVE_KEY)); } catch { badge = parseLabSave(null); }
  if (!document.getElementById("planetlab-style")) {
    const link = document.createElement("link"); link.id = "planetlab-style"; link.rel = "stylesheet";
    link.href = new URL("../planetlab.css", import.meta.url).href; document.head.appendChild(link);
  }
  root = document.createElement("section"); root.id = "planet-lab"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Planet Lab");
  root.innerHTML = `
    <header class="pl-header"><div><span class="pl-eyebrow">KONNIE SPACE PROGRAM / EXPERIMENTAL DIVISION</span><h1>Planet <em>Lab.</em></h1></div><button id="pl-exit">← Space Center</button></header>
    <nav class="pl-tabs" aria-label="Experiments">${Object.entries(EXPERIMENTS).map(([id, e], i) => `<button data-experiment="${id}"><span>0${i + 1}</span> ${e.title}</button>`).join("")}</nav>
    <div class="pl-layout"><div class="pl-workspace">
      <div class="pl-mission"><span id="pl-tag" class="pl-eyebrow"></span><h2 id="pl-question"></h2><p id="pl-hint"></p></div>
      <div class="pl-viewport"><canvas id="pl-canvas" aria-label="Interactive gravity experiment. Select worlds using the World menu; starting positions can also be adjusted with the position buttons." tabindex="0"></canvas>
        <div class="pl-viewbar"><label>View <select id="pl-follow"><option value="system">Whole system</option><option value="planet">Follow planet</option><option value="selected">Follow selected</option></select></label><button id="pl-out" aria-label="Zoom out">−</button><button id="pl-in" aria-label="Zoom in">+</button></div>
        <div class="pl-clock"><span id="pl-clock">0.00 years</span><small>SIMULATED TIME</small></div>
        <div class="pl-legend"><span>↗ velocity</span><span>↗ gravity</span><small>Directions shown; arrow lengths scaled separately.</small></div>
      </div>
      <div class="pl-transport"><button id="pl-play" class="pl-primary">▶ Run experiment</button><button id="pl-reset">↶ Back to start</button><label>Time <select id="pl-rate"><option value=".02">Slow</option><option value=".1" selected>Normal</option><option value="1">Fast</option></select></label></div>
      <label class="pl-timeline">REWIND THIS RUN <input id="pl-timeline" type="range" min="0" max="0" value="0" aria-label="Rewind this run" disabled></label>
      <div id="pl-result" class="pl-result" role="status"></div><progress id="pl-progress" max="10" value="0" aria-label="Years keeping the moon"></progress>
    </div><aside class="pl-panel">
      <span class="pl-eyebrow">CHANGE ONE THING. SEE WHAT HAPPENS.</span><h2>Your experiment</h2>
      <label class="pl-field">World <select id="pl-bodies"></select></label>
      <label class="pl-field" for="pl-mass">Mass <output id="pl-mass-value"></output><input id="pl-mass" type="range" min=".1" max="4" step=".05" value="1" aria-label="Mass"></label>
      <label class="pl-field" for="pl-speed">Starting speed <output id="pl-speed-value"></output><input id="pl-speed" type="range" min="0" max="25" step=".01" aria-label="Starting speed"></label>
      <label class="pl-field" for="pl-angle">Direction <output id="pl-angle-value"></output><input id="pl-angle" type="range" min="0" max="359.9" step=".1" aria-label="Direction"></label>
      <p id="pl-relative" class="pl-small"></p>
      <div class="pl-position"><span>Starting position</span><div><button data-move="left" aria-label="Move world left">←</button><button data-move="up" aria-label="Move world up">↑</button><button data-move="down" aria-label="Move world down">↓</button><button data-move="right" aria-label="Move world right">→</button></div></div>
      <p id="pl-edit-note" class="pl-small"></p>
      <div class="pl-add"><button id="pl-add">＋ Add a world</button><button id="pl-remove">Remove</button></div>
      <div class="pl-toggles"><label><input id="pl-trails" type="checkbox" checked> Orbit trails</label><label><input id="pl-vectors" type="checkbox" checked> Physics arrows</label></div>
      <div class="pl-reading"><span id="pl-live-name"></span><strong id="pl-live-speed"></strong><small id="pl-live-ref"></small></div>
      <div id="pl-badge" class="pl-badge"></div>
      <details><summary>The physics inside</summary><p>Every body pulls on every other body. Twice the attracting mass means twice the pull; twice the distance means one quarter of the pull.</p><p>F = G × m₁ × m₂ / r²<br>Acceleration = F / mass</p><p>This is a flat Newtonian experiment: no air, tides or relativity. AU is the Earth–Sun distance. Mass changes keep each body’s collision radius fixed. The icons are enlarged; contact uses the smaller modeled radii.</p><p>The moon badge checks that Pip stays bound to Atlas and inside its approximate Hill sphere for ten years. It is a finite experiment, not a promise of stability forever.</p><a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/weight-gravitational-force/" target="_blank" rel="noopener noreferrer">Newton’s gravity · NASA ↗</a></details>
    </aside></div>`;
  const app = document.getElementById("app");
  suppressed = [...app.children, ...[...document.body.children].filter(el => el !== app)].map(el => [el, el.inert]);
  suppressed.forEach(([el]) => { el.inert = true; });
  app.appendChild(root);
  const ids = { play:"play", timeline:"timeline", tag:"tag", question:"question", hint:"hint", follow:"follow", add:"add", remove:"remove", bodies:"bodies", mass:"mass", massValue:"mass-value", speed:"speed", speedValue:"speed-value", angle:"angle", angleValue:"angle-value", relative:"relative", editNote:"edit-note", clock:"clock", liveName:"live-name", liveSpeed:"live-speed", liveRef:"live-ref", progress:"progress", badge:"badge", result:"result", trails:"trails", vectors:"vectors", rate:"rate" };
  ui = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, $("#pl-" + id)]));
  ui.tabs = [...root.querySelectorAll("[data-experiment]")];
  canvas = $("#pl-canvas"); ctx = canvas.getContext("2d");
  $("#pl-exit").onclick = close; $("#pl-reset").onclick = reset;
  ui.tabs.forEach(b => b.onclick = () => loadExperiment(b.dataset.experiment));
  ui.play.onclick = () => {
    if (running) { pause(); return; }
    if (state.collision || state.outcome) reset();
    const index = Number(ui.timeline.value); histories = histories.slice(0, index + 1);
    ui.timeline.max = index; running = true; ui.play.textContent = "Ⅱ Pause";
  };
  ui.timeline.oninput = () => {
    pause(); state = clone(histories[Number(ui.timeline.value)]); trails = {};
    // Reconstruct trails in the current reference frame, without drawing the future.
    for (const s of histories.slice(0, Number(ui.timeline.value) + 1).slice(-700)) {
      const old = state; state = s; const c = cameraCenter(); state = old;
      s.bodies.forEach(b => (trails[b.id] ||= []).push({ x: b.x - c.x, y: b.y - c.y }));
    }
    updateReadouts();
  };
  ui.bodies.onchange = () => { selected = ui.bodies.value; updateControls(); if (follow === "selected") trails = {}; updateReadouts(); };
  ui.mass.oninput = () => { const value = +ui.mass.value; edit(bs => selectedBody(bs).mass = baseMass[selected] * value); };
  function changeMotion(event) {
    const rel = relative(selectedBody(initial), initial);
    const speed = event.target === ui.speed ? +ui.speed.value : Math.hypot(rel.vx, rel.vy);
    const angle = event.target === ui.angle ? +ui.angle.value * Math.PI / 180 : Math.atan2(rel.vy, rel.vx);
    edit(bs => { const b = selectedBody(bs), p = refBody(b, bs); b.vx = (p?.vx || 0) + speed * Math.cos(angle); b.vy = (p?.vy || 0) + speed * Math.sin(angle); });
  }
  ui.speed.oninput = changeMotion; ui.angle.oninput = changeMotion;
  root.querySelectorAll("[data-move]").forEach(button => button.onclick = () => edit(bs => {
    const b = selectedBody(bs), step = span / 40, dir = button.dataset.move;
    b.x += dir === "left" ? -step : dir === "right" ? step : 0;
    b.y += dir === "up" ? step : dir === "down" ? -step : 0;
  }));
  ui.follow.onchange = () => { follow = ui.follow.value; trails = {}; span = follow === "system" ? EXPERIMENTS[experiment].span === .12 ? 3 : EXPERIMENTS[experiment].span : experiment === "moon" ? .12 : 1.5; };
  $("#pl-in").onclick = () => span = Math.max(.008, span / 1.5);
  $("#pl-out").onclick = () => span = Math.min(100, span * 1.5);
  ui.add.onclick = () => {
    if (initial.length >= 8 || experiment === "moon") return;
    edit(bs => {
      const id = `extra${nextId++}`, star = bs.find(b => b.id === "sun"), r = 1.8 + .35 * (bs.length - 3);
      const b = { id, name: `World ${nextId - 1}`, mass: 3e-6, radius: .000043, x: star.x, y: star.y + r,
        vx: star.vx - Math.sqrt(LAB_G * star.mass / r), vy: star.vy, parent: "sun", color: "#e6a9ff" };
      bs.push(b); baseMass[id] = b.mass; baseSpeed[id] = Math.sqrt(LAB_G * star.mass / r); selected = id;
    });
  };
  ui.remove.onclick = () => edit(bs => { if (bs.length > 2 && !["sun", "twin"].includes(selected) && experiment !== "moon") { bs.splice(bs.findIndex(b => b.id === selected), 1); selected = bs[0].id; } });
  canvas.onpointerdown = e => {
    const rect = canvas.getBoundingClientRect(), g = geometry(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    const b = [...state.bodies].reverse().find(b => { const p = screenPoint(b, g); return Math.hypot(p.x - x, p.y - y) < 28; });
    if (!b) return;
    pause(); selected = b.id; updateControls();
    const start = selectedBody(initial);
    drag = { id: b.id, x: e.clientX, y: e.clientY, bx: start.x, by: start.y, scale: g.scale, moved: false };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = e => {
    if (!drag || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4 && !drag.moved) return;
    if (!drag.moved) { reset(); drag.moved = true; }
    const b = selectedBody(initial);
    b.x = drag.bx + (e.clientX - drag.x) / drag.scale;
    b.y = drag.by - (e.clientY - drag.y) / drag.scale;
    state = newLab(initial, experiment); histories = []; trails = {}; record(); updateReadouts();
  };
  canvas.onpointerup = canvas.onpointercancel = () => { drag = null; };
  canvas.onwheel = e => { e.preventDefault(); span = Math.max(.008, Math.min(100, span * Math.exp(e.deltaY * .001))); };
  window.addEventListener("keydown", blockGameKeys, true); window.addEventListener("keyup", blockGameKeys, true);
  loadExperiment("moon"); resize(); last = 0; elapsed = 0;
  raf = requestAnimationFrame(tick); $("#pl-exit").focus();
}
export const PlanetLab = Object.freeze({ init(h) { handlers = h || {}; }, show, hide, isOpen: () => !!root });
