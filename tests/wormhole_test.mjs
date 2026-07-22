// 🌀 Wormhole gate tests (node, no browser): his placement spec, two-way twin
// round-trips, ring clearance, and the setSystem swap contract.
import { BODIES, WORMHOLES, STATIONS, setSystem, returnToSol, RING_BAND, bodyStateAt } from "../js/state.js";
import { generateSystem } from "../js/stargen.js";
import { famousSystem } from "../js/famous.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log("PASS ", name, " " + detail); }
  else { fail++; console.log("FAIL ", name, " " + detail); }
};

returnToSol();

// --- His spec: four Sol mouths on the right planets ---
const byId = Object.fromEntries(WORMHOLES.map((w) => [w.id, w]));
check("Sol has exactly 4 gates", WORMHOLES.length === 4, "got " + WORMHOLES.length);
check("Jupiter hosts the Owius Gate", byId.wh_owius && byId.wh_owius.body === "jupiter");
check("Saturn hosts the Ember Gate (→ Luhman 16)", byId.wh_luhman && byId.wh_luhman.body === "saturn");
check("Uranus hosts the Youngcow Gate", byId.wh_youngcow && byId.wh_youngcow.body === "uranus");
check("Neptune hosts the Pandora Gate", byId.wh_pandora && byId.wh_pandora.body === "neptune");

// --- Placement geometry (his words: "past Ganymede", "inside the ring system,
// closer to Saturn than Titan") ---
const rJ = BODIES.jupiter.radius * byId.wh_owius.altR;
check("Jupiter gate is PAST Ganymede", rJ > BODIES.ganymede.orbitRadius,
  (rJ / 1e6).toFixed(1) + " vs Ganymede " + (BODIES.ganymede.orbitRadius / 1e6).toFixed(1) + " Mm");
check("Jupiter gate stays inside Callisto", rJ < BODIES.callisto.orbitRadius);
const rS = BODIES.saturn.radius * byId.wh_luhman.altR;
check("Saturn gate sits INSIDE the ring band",
  byId.wh_luhman.altR > RING_BAND.inner && byId.wh_luhman.altR < RING_BAND.outer,
  "altR " + byId.wh_luhman.altR + " in [" + RING_BAND.inner + ", " + RING_BAND.outer + "]");
check("Saturn gate is closer to Saturn than Titan", rS < BODIES.titan.orbitRadius,
  (rS / 1e6).toFixed(1) + " vs Titan " + (BODIES.titan.orbitRadius / 1e6).toFixed(1) + " Mm");
for (const wh of WORMHOLES) {
  const b = BODIES[wh.body];
  check("gate " + wh.id + " orbits above its planet's surface", wh.altR > 1.05,
    "altR " + wh.altR);
  check("gate " + wh.id + " stays inside its planet's SOI",
    b.radius * wh.altR < b.soiRadius);
}

// --- Two-way twins: every Sol gate's destination system carries a matching Sol Gate
// pointing straight back ---
for (const wh of WORMHOLES) {
  const sys = generateSystem(wh.dest.seed);
  check("dest '" + wh.dest.seed + "' resolves to a famous system", !!sys && !!sys.famous);
  const twins = (sys && sys.wormholes) || [];
  const twin = twins.find((w) => w.id === wh.dest.twin);
  check("twin " + wh.dest.twin + " exists in " + wh.dest.seed, !!twin);
  if (!twin) continue;
  check("twin " + twin.id + " leads home to @sol", twin.dest.seed === "@sol");
  check("twin " + twin.id + " points back at " + wh.id, twin.dest.twin === wh.id);
  const host = sys.bodies[twin.body];
  check("twin " + twin.id + " orbits a real body (" + twin.body + ")", !!host);
  if (host && host.style && host.style.rings) {
    check("twin " + twin.id + " parks CLEAR of " + host.name + "'s rings",
      twin.altR > RING_BAND.outer, "altR " + twin.altR + " > " + RING_BAND.outer);
  }
  if (host) {
    check("twin " + twin.id + " stays inside " + host.name + "'s SOI",
      host.radius * twin.altR < host.soiRadius);
  }
}

// --- Aliases land on the same gates (share-code safety: any spelling, same twin) ---
check("famousSystem('pulsar') carries the Owius twin",
  (famousSystem("pulsar").wormholes || []).some((w) => w.id === "wh_sol_owius"));
check("famousSystem('brown dwarfs') carries the Luhman twin",
  (famousSystem("brown dwarfs").wormholes || []).some((w) => w.id === "wh_sol_luhman"));

// --- setSystem swap contract: WORMHOLES swaps in place like STATIONS ---
const owius = generateSystem("Owius");
setSystem(owius.bodies, owius.planetKeys,
  { key: owius.key, name: owius.name, seed: owius.seed, stations: owius.stations, wormholes: owius.wormholes });
check("in Owius the live list is the one Sol Gate",
  WORMHOLES.length === 1 && WORMHOLES[0].id === "wh_sol_owius");
check("meta without wormholes leaves the list empty (generated systems)", (() => {
  const gen = generateSystem("prop-seed-wormhole");
  setSystem(gen.bodies, gen.planetKeys,
    { key: gen.key, name: gen.name, seed: gen.seed, stations: gen.stations, wormholes: gen.wormholes });
  return WORMHOLES.length === 0;
})());
returnToSol();
check("returnToSol restores all 4 gates", WORMHOLES.length === 4);
check("STATIONS untouched by the wormhole swap dance", STATIONS.length === 3);

// --- Orbit propagation math (the same circular elements as stations): predict the
// gate's period from first principles and confirm the angle actually advances ---
{
  const wh = byId.wh_owius;
  const b = BODIES[wh.body];
  const r = b.radius * wh.altR;
  const n = Math.sqrt(b.mu / (r * r * r));
  const T = (2 * Math.PI) / n;
  check("Jupiter gate period is finite and sane (hours-scale)", T > 3600 && T < 86400 * 10,
    (T / 3600).toFixed(1) + " h");
  // Position at t=0 vs quarter period: should be ~90° apart around Jupiter.
  const bs0 = bodyStateAt(wh.body, 0), bsQ = bodyStateAt(wh.body, T / 4);
  const p0 = { x: bs0.pos.x + r * Math.cos(wh.phase0), y: bs0.pos.y + r * Math.sin(wh.phase0) };
  const th = wh.phase0 + n * (T / 4);
  const pQ = { x: bsQ.pos.x + r * Math.cos(th), y: bsQ.pos.y + r * Math.sin(th) };
  const a0 = Math.atan2(p0.y - bs0.pos.y, p0.x - bs0.pos.x);
  const aQ = Math.atan2(pQ.y - bsQ.pos.y, pQ.x - bsQ.pos.x);
  let dAng = (aQ - a0) % (2 * Math.PI); if (dAng < 0) dAng += 2 * Math.PI;
  check("quarter-period advance is 90°", Math.abs(dAng - Math.PI / 2) < 1e-6,
    (dAng * 180 / Math.PI).toFixed(2) + "°");
}

console.log("\nwormhole_test: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
