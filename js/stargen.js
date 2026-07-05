// stargen.js — the star-system generator. Type ANY name into the Starmap and this
// module turns it into a whole solar system: a star, planets, moons, rings — the same
// system every time, for everyone, forever, because everything comes from the seed.
// A system's name IS its share code (exactly like rocket share codes).
//
// Pure math + data, no THREE, no DOM — node-testable like physics.js. It emits the
// SAME body shape state.js builds for Sol (through the same buildCatalog, so mu/omega/
// SOI math has one source of truth). Three keys are ROLES, not names, in every system:
//   "sun"   = the star   (whatever it's called)
//   "earth" = the HOMEWORLD — guaranteed solid, breathable-ish air, launchable gravity
//   "moon"  = the homeworld's moon — so the transfer tutorial works everywhere
//
// The rules are the curriculum (the Navigator teaches them):
//   - Bigger/hotter stars push the frost line out; small red dwarfs pull it in.
//   - Inside the frost line: rocky worlds (lava up close, deserts, the odd thick-air
//     venus). Beyond it: gas giants and ice worlds — ices survive out there.
//   - Distance from the star sets the year length (omega falls out of real gravity).

import { buildCatalog } from "./state.js";

// Same seeded RNG family the planet faces use (render.js) — tiny, deterministic.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const AU = 1.496e11, R_SUN = 6.957e8, R_EARTH = 6.371e6, G_EARTH = 9.81;

// Star classes, cool→hot. mass/radius in solar units; g0 = 274 * m / r^2 keeps the
// star's mu physical, which sets every planet's year through buildCatalog.
const STAR_CLASSES = [
  { cls: "M", label: "red dwarf",     w: 0.34, m: [0.2, 0.5],  r: [0.25, 0.6],  color: 0xff8a5c, glow: "255,138,92" },
  { cls: "K", label: "orange dwarf",  w: 0.28, m: [0.5, 0.8],  r: [0.6, 0.9],   color: 0xffb45e, glow: "255,180,94" },
  { cls: "G", label: "yellow star",   w: 0.26, m: [0.8, 1.2],  r: [0.9, 1.1],   color: 0xffd75e, glow: "255,215,94" },
  { cls: "F", label: "white star",    w: 0.12, m: [1.2, 1.6],  r: [1.1, 1.4],   color: 0xfff0d0, glow: "255,240,208" },
];

const SYL = ["ka", "zeph", "vor", "tha", "lu", "mira", "rho", "syl", "dra", "nea",
             "ola", "xi", "pra", "ven", "tal", "qui", "ara", "iss", "una", "bel",
             "cor", "dun", "eri", "fal", "gos", "hy", "jen", "kel", "mor", "nix"];
function makeName(rng) {
  const n = 2 + (rng() > 0.6 ? 1 : 0);
  let s = "";
  for (let i = 0; i < n; i++) s += SYL[Math.floor(rng() * SYL.length)];
  return s[0].toUpperCase() + s.slice(1);
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const range = (rng, lo, hi) => lo + rng() * (hi - lo);

// Rocky-family looks; gas/ice get band palettes. base/accent are canvas colors for
// the face painter (render.js default branch); color/halo are THREE hex ints.
const LOOKS = {
  lava:   () => ({ color: 0x8a2f1c, halo: 0xff7a3a, face: { kind: "lava",  base: "#3a1410", accent: "#ff6a2a", accent2: "#ffc24a" } }),
  desert: () => ({ color: 0xc89a5e, face: { kind: "desert", base: "#c89a5e", accent: "#8a6438", accent2: "#e8cf9e" } }),
  rocky:  () => ({ color: 0x8d8578, face: { kind: "rocky", base: "#8d8578", accent: "#655e52", accent2: "#c0b8a8" } }),
  venusian: () => ({ color: 0xe0c084, halo: 0xedd6a0, face: { kind: "gasish", base: "#e0c084", accent: "#c8a468", accent2: "#f2e0b0" } }),
  terra:  () => ({ color: 0x2f6fc0, halo: 0x6fb4ff, face: { kind: "terra", base: "#1c5cb8", accent: "#3e8a3a", accent2: "#a8935a" } }),
  ice:    () => ({ color: 0xcfe0ea, face: { kind: "ice", base: "#d5e4ec", accent: "#9ab8c8", accent2: "#b06a4a" } }),
  dwarf:  () => ({ color: 0xbfae9a, face: { kind: "rocky", base: "#bfae9a", accent: "#8a7a62", accent2: "#e0d4c0" } }),
};
const GAS_PALETTES = [
  ["#c9a97a", "#a8875d", "#e0c396", "#b5713f"], // jovian tans
  ["#d9c08a", "#c2a86f", "#e8d5a8"],            // saturnine cream
  ["#b87f9e", "#96607e", "#d8a8c0", "#7c4a66"], // rose giant
  ["#7fa8c8", "#5d86a8", "#a8c8e0", "#4a6a8a"], // steel blue
  ["#a8c87f", "#86a85d", "#c8e0a8"],            // chlorine green
];
const ICE_PALETTES = [
  ["#9ad4d6", "#8ac8cc", "#b0e0e2"],
  ["#3f66d4", "#2f52b8", "#6086e8"],
  ["#7fc8b8", "#5da898", "#a8e0d0"],
];

export function generateSystem(seedName) {
  const seed = String(seedName).trim();
  const norm = seed.toLowerCase();
  const rng = mulberry32(hashStr("system:" + norm));

  // --- The star ---
  let roll = rng(), sc = STAR_CLASSES[0];
  for (const c of STAR_CLASSES) { if (roll < c.w) { sc = c; break; } roll -= c.w; }
  const mass = range(rng, sc.m[0], sc.m[1]);       // solar masses
  const sradius = range(rng, sc.r[0], sc.r[1]);    // solar radii
  const hab = AU * Math.pow(mass, 1.75);           // habitable-zone center (~sqrt(L), L~m^3.5)
  const frost = 2.7 * hab;                         // frost line scales with the star
  const defs = {
    sun: {
      name: seed, radius: sradius * R_SUN, g0: 274 * mass / (sradius * sradius),
      parent: null, a: 0, solid: false, atmo: null, phase0: 0, gen: true,
      style: { color: sc.color, star: true, glow: sc.glow },
      starClass: sc.cls,
    },
  };
  const order = ["sun"];
  const planetKeys = [];

  // --- Planet slots: geometric spacing (Titius–Bode-ish), scaled to the star ---
  const count = 4 + Math.floor(rng() * 6); // 4..9
  let a = hab * range(rng, 0.25, 0.4);
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push(a);
    a *= range(rng, 1.55, 1.95);
  }
  // The slot nearest the habitable zone becomes HOME.
  let homeIdx = 0, bestD = Infinity;
  slots.forEach((s, i) => { const d = Math.abs(Math.log(s / hab)); if (d < bestD) { bestD = d; homeIdx = i; } });

  const letters = "bcdefghijk"; // real exoplanet convention: the star is "a"
  const estSoi = (aP, muP, muS) => aP * Math.pow(muP / muS, 0.4); // scale-free
  const muStar = defs.sun.g0 * defs.sun.radius * defs.sun.radius;

  for (let i = 0; i < count; i++) {
    const aP = slots[i];
    const letter = letters[i];
    const key = i === homeIdx ? "earth" : "p" + letter;
    let d;
    if (i === homeIdx) {
      // The homeworld: guaranteed launchable. Gravity near Earth's (stock rockets
      // must fly), air a parachute works in, ground you can stand on.
      const radius = range(rng, 0.75, 1.15) * R_EARTH;
      d = {
        name: makeName(rng), radius, g0: range(rng, 7.5, 10.5),
        solid: true, atmo: { height: range(rng, 65000, 90000), seaLevelDensity: range(rng, 0.9, 1.4) },
        home: true, ...LOOKS.terra(),
      };
    } else if (aP < frost) {
      const t = aP / hab; // how close to the star, in habitable units
      const kind = t < 0.45 ? (rng() < 0.55 ? "lava" : "rocky")
                 : rng() < 0.2 ? "venusian" : rng() < 0.55 ? "desert" : "rocky";
      const radius = range(rng, 0.3, 1.3) * R_EARTH;
      const dens = range(rng, 0.85, 1.2);
      d = {
        name: seed + " " + letter, radius,
        g0: Math.max(1.2, G_EARTH * (radius / R_EARTH) * dens),
        solid: true,
        atmo: kind === "venusian" ? { height: range(rng, 180000, 250000), seaLevelDensity: range(rng, 20, 80) }
            : kind === "desert" && rng() < 0.5 ? { height: range(rng, 50000, 90000), seaLevelDensity: range(rng, 0.01, 0.06) }
            : null,
        ...LOOKS[kind](),
      };
    } else if (aP < 3.2 * frost && rng() < 0.65) {
      const radius = range(rng, 6, 12) * R_EARTH; // gas giant
      const bands = pick(rng, GAS_PALETTES);
      d = {
        name: seed + " " + letter, radius, g0: range(rng, 15, 27),
        solid: false, atmo: { height: 1000000, seaLevelDensity: range(rng, 0.15, 0.4) },
        color: null,
        style: { color: parseInt(bands[0].slice(1), 16), halo: parseInt(bands[0].slice(1), 16),
                 rings: rng() < 0.35 },
        face: { kind: "gas", bands, spot: rng() < 0.4 },
        gas: true,
      };
    } else if (rng() < 0.55) {
      const radius = range(rng, 3, 4.6) * R_EARTH; // ice giant
      const bands = pick(rng, ICE_PALETTES);
      d = {
        name: seed + " " + letter, radius, g0: range(rng, 8, 13),
        solid: false, atmo: { height: 900000, seaLevelDensity: range(rng, 0.3, 0.5) },
        style: { color: parseInt(bands[0].slice(1), 16), halo: parseInt(bands[0].slice(1), 16),
                 rings: rng() < 0.15 },
        face: { kind: "gas", bands, spot: rng() < 0.3 },
        gas: true,
      };
    } else {
      const radius = range(rng, 0.25, 0.8) * R_EARTH; // icy dwarf / far rocky
      d = {
        name: seed + " " + letter, radius,
        g0: Math.max(0.5, G_EARTH * (radius / R_EARTH) * range(rng, 0.7, 1.0)),
        solid: true, atmo: null,
        ...(rng() < 0.5 ? LOOKS.ice() : LOOKS.dwarf()),
      };
    }
    d.parent = "sun"; d.a = aP; d.phase0 = rng() * Math.PI * 2; d.gen = true;
    if (!d.style) d.style = { color: d.color, ...(d.halo ? { halo: d.halo } : {}) };
    defs[key] = d;
    order.push(key);
    planetKeys.push(key);

    // --- Moons ---
    const muP = d.g0 * d.radius * d.radius;
    const soiP = estSoi(aP, muP, muStar);
    if (i === homeIdx) {
      // The guaranteed moon. Placed as a fraction of the home's ACTUAL sphere of
      // influence, not a fixed radius count: homes hugging a red dwarf have small
      // SOIs, and a moon at "60 radii like ours" would escape into star orbit.
      const mr = range(rng, 0.22, 0.32) * d.radius;
      defs.moon = {
        name: makeName(rng), radius: mr, g0: range(rng, 1.3, 2.2),
        parent: "earth", a: Math.max(3.5 * d.radius, soiP * range(rng, 0.35, 0.55)),
        solid: true, atmo: null, phase0: rng() * Math.PI * 2, gen: true,
        ...LOOKS.rocky(),
      };
      defs.moon.style = { color: defs.moon.color };
      order.push("moon");
      planetKeys.push("moon");
    } else if (d.gas) {
      const nm = Math.floor(rng() * 3.4); // 0..3 moons
      let am = d.radius * range(rng, 4, 6);
      for (let m = 1; m <= nm; m++) {
        if (am > soiP * 0.35) break; // stay well inside the planet's SOI
        const mk = key + "m" + m;
        const look = pick(rng, [LOOKS.ice, LOOKS.rocky, LOOKS.lava, LOOKS.dwarf])();
        const mr = range(rng, 0.15, 0.42) * R_EARTH;
        defs[mk] = {
          name: d.name + " " + ["I", "II", "III"][m - 1], radius: mr,
          g0: Math.max(0.4, G_EARTH * (mr / R_EARTH) * range(rng, 0.8, 1.1)),
          parent: key, a: am, solid: true, atmo: null,
          phase0: rng() * Math.PI * 2, gen: true, ...look,
        };
        defs[mk].style = { color: defs[mk].color };
        order.push(mk);
        planetKeys.push(mk);
        am *= range(rng, 1.8, 2.4);
      }
    }
  }

  const bodies = buildCatalog(defs, order);
  return {
    key: "gen:" + norm,
    name: seed,
    seed,
    starClass: sc.cls,
    starLabel: sc.label,
    homeName: bodies.earth.name,
    moonName: bodies.moon.name,
    planetCount: count,
    frostAU: frost / AU,
    bodies,
    planetKeys,
  };
}
