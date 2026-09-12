// Planet Lab's isolated Newtonian sandbox. AU, solar masses, Julian years.
// All bodies move and attract each other; no fixed orbital rails or fixed star.
// G = 4π² in these units (the solar-mass/year convention is a close approximation).
// Velocity Verlet + encounter-limited steps. No atmosphere, tides or relativity.
export const LAB_G = 4 * Math.PI ** 2;
export const EARTHS_PER_SUN = 332946;
export const KM_S_PER_AU_YR = 4.74047;
export const LAB_SAVE_KEY = "spacesim.planetlab.v1";
export const clone = (value) => JSON.parse(JSON.stringify(value));

function body(id, name, mass, radius, x, y, vx, vy, color, parent = null) {
  return { id, name, mass, radius, x, y, vx, vy, color, parent };
}
export function balance(bodies) {
  const m = bodies.reduce((s, b) => s + b.mass, 0);
  const mean = (k) => bodies.reduce((s, b) => s + b[k] * b.mass, 0) / m;
  const [x, y, vx, vy] = ["x", "y", "vx", "vy"].map(mean);
  bodies.forEach((b) => { b.x -= x; b.y -= y; b.vx -= vx; b.vy -= vy; });
  return bodies;
}
export function preset(kind = "moon") {
  const star = body("sun", "Sol", 1, .00465, 0, 0, 0, 0, "#ffc76b");
  let bodies;
  if (kind === "binary") {
    const v = Math.sqrt(LAB_G / (.4 * 4));
    bodies = [body("sun", "Amber", .5, .0037, -.2, 0, 0, -v, "#ffb967"),
      body("twin", "Indigo", .5, .0037, .2, 0, 0, v, "#a9bdff"),
      body("planet", "Wanderer", 3e-6, .000043, 1.5, 0, 0, Math.sqrt(LAB_G / 1.5), "#63e2c1")];
  } else if (kind === "comet") {
    bodies = [star, body("planet", "Atlas", .003, .00047, 1, 0, 0, 2 * Math.PI, "#69baff", "sun"),
      body("comet", "Spark", 1e-12, .000003, 1.1, -.6, -1.2, 10.5, "#b6f5f3", "sun")];
  } else {
    bodies = [star, body("planet", "Atlas", .001, .00047, 1, 0, 0, Math.sqrt(LAB_G * 1.001), "#69baff", "sun"),
      body("moon", "Pip", 1e-6, .000012, 1.025, 0, 0,
        Math.sqrt(LAB_G * 1.001) + Math.sqrt(LAB_G * .001001 / .025), "#d9dded", "planet")];
  }
  return balance(bodies);
}
export function newLab(bodies, kind = "moon") {
  return { bodies: clone(bodies), kind, time: 0, collision: null, outcome: null, keeperBroken: false };
}
export function accelerations(bodies) {
  const a = bodies.map(() => ({ x: 0, y: 0 }));
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const p = bodies[i], q = bodies[j], dx = q.x - p.x, dy = q.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 === 0) continue; // overlapping starts are stopped by contact(), never integrated
    const f = LAB_G / (d2 * Math.sqrt(d2));
    a[i].x += f * q.mass * dx; a[i].y += f * q.mass * dy;
    a[j].x -= f * p.mass * dx; a[j].y -= f * p.mass * dy;
  }
  return a;
}
function contact(bodies) {
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    if (Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y) <= bodies[i].radius + bodies[j].radius)
      return { a: bodies[i].name, b: bodies[j].name };
  }
  return null;
}
export function moonOrbit(bodies) {
  const moon = bodies.find(b => b.id === "moon"), planet = bodies.find(b => b.id === "planet"), star = bodies.find(b => b.id === "sun");
  if (!moon || !planet || !star) return null;
  const r = Math.hypot(moon.x - planet.x, moon.y - planet.y);
  const v2 = (moon.vx - planet.vx) ** 2 + (moon.vy - planet.vy) ** 2;
  const hill = Math.hypot(planet.x - star.x, planet.y - star.y) * Math.cbrt(planet.mass / (3 * star.mass));
  return { r, hill, bound: v2 / 2 - LAB_G * (planet.mass + moon.mass) / r < 0 };
}
export function advanceLab(state, duration) {
  let left = Math.max(0, Math.min(duration, 1)), steps = 0;
  if (state.collision || state.outcome) return;
  while (left > 1e-12 && steps++ < 4000) {
    state.collision = contact(state.bodies);
    if (state.collision) return;
    const b = state.bodies;
    let h = Math.min(left, .0005);
    // Resolve close encounters and fast crossing trajectories without skipping time.
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      const d = Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y);
      const v = Math.hypot(b[i].vx - b[j].vx, b[i].vy - b[j].vy);
      h = Math.min(h, .02 * Math.sqrt(d ** 3 / (LAB_G * (b[i].mass + b[j].mass))), .08 * d / Math.max(v, 1e-12));
    }
    const a = accelerations(b);
    b.forEach((p, i) => {
      p.x += p.vx * h + .5 * a[i].x * h * h;
      p.y += p.vy * h + .5 * a[i].y * h * h;
      p.vx += .5 * a[i].x * h; p.vy += .5 * a[i].y * h;
    });
    state.time += h; left -= h;
    state.collision = contact(b);
    if (state.collision) return;
    const next = accelerations(b);
    b.forEach((p, i) => { p.vx += .5 * next[i].x * h; p.vy += .5 * next[i].y * h; });
    if (state.kind === "moon") {
      const orbit = moonOrbit(b);
      if (!orbit || !orbit.bound) state.keeperBroken = true;
      // Let an unbound launch visibly travel outward before ending the challenge.
      if (!orbit || orbit.r > orbit.hill) { state.outcome = "lost"; return; }
      if (state.time >= 10) { state.outcome = state.keeperBroken ? "lost" : "kept"; return; }
    }
  }
}
export function energy(bodies) {
  let e = bodies.reduce((s, b) => s + .5 * b.mass * (b.vx ** 2 + b.vy ** 2), 0);
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++)
    e -= LAB_G * bodies[i].mass * bodies[j].mass / Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y);
  return e;
}
// Only the earned badge persists. Experiments never touch ships, science, or world data.
export function parseLabSave(raw) {
  try {
    const s = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { v: 1, moonKeeper: s?.v === 1 && s.moonKeeper === true };
  } catch { return { v: 1, moonKeeper: false }; }
}
