// famous.js — FAMOUS STAR SYSTEMS (his ask): the universe comes pre-populated with a
// few hand-built legendary systems. Type their name in the Starmap (any spelling that
// makes sense), or find them already shining on the galaxy map. Same rules as every
// system: the name is the share code, the star is keyed "sun", home is "earth", its
// moon is "moon" — so every mechanic works unchanged.
//
// Pure data + buildCatalog, no THREE, no DOM — node-testable (tests/famous_test.mjs).
//
// THE SCALE TRICK (Kerbol): the whole game multiplies radii/distances by SCALE=0.1.
// KSP's canon worlds are ALREADY tiny (Kerbin: 600 km), so we enter canon values ×10
// and after scaling the Kerbol system lands at EXACTLY its true in-game size — real
// KSP orbits, real KSP gravity, real KSP years. The homage is physically exact.

import { buildCatalog } from "./state.js";

const K = 10;        // KSP canon meters ×10 (see scale trick above)
const AU = 1.496e11; // Avatar system uses real astronomy scale, like Sol

// ---------- THE KERBOL SYSTEM (Kerbal Space Program — the game that inspired this one) ----------
function kerbolSystem() {
  const defs = {
    sun: { name: "Kerbol", radius: 2.616e8 * K, g0: 17.1, parent: null, a: 0, solid: false,
           atmo: null, phase0: 0, gen: true, style: { color: 0xffd75e, star: true, glow: "255,215,94" } },
    moho: { name: "Moho", radius: 2.5e5 * K, g0: 2.70, parent: "sun", a: 5.2631e9 * K,
            solid: true, atmo: null, phase0: 0.9, gen: true,
            style: { color: 0x8a5c3a }, face: { kind: "lava", base: "#5a3a26", accent: "#8a5c3a", accent2: "#c08a58" } },
    eve: { name: "Eve", radius: 7.0e5 * K, g0: 16.7, parent: "sun", a: 9.8327e9 * K,
           solid: true, atmo: { height: 9.0e4 * K, seaLevelDensity: 6.2 }, phase0: 2.2, gen: true,
           style: { color: 0x7a4a9e, halo: 0x9a6ac0 }, face: { kind: "gasish", base: "#7a4a9e", accent: "#5e3480", accent2: "#9a6ac0" } },
    gilly: { name: "Gilly", radius: 1.3e4 * K, g0: 0.049, parent: "eve", a: 3.15e7 * K,
             solid: true, atmo: null, phase0: 4.1, gen: true,
             style: { color: 0xbfae9a }, face: { kind: "rocky", base: "#bfae9a", accent: "#8a7a62", accent2: "#e0d4c0" } },
    earth: { name: "Kerbin", radius: 6.0e5 * K, g0: 9.81, parent: "sun", a: 1.35998e10 * K,
             solid: true, atmo: { height: 7.0e4 * K, seaLevelDensity: 1.225 }, phase0: 0, gen: true, home: true,
             style: { color: 0x2f8fc0, halo: 0x6fb4ff }, face: { kind: "terra", base: "#1c6cb8", accent: "#3e8a3a", accent2: "#e8e8e8" } },
    moon: { name: "the Mun", radius: 2.0e5 * K, g0: 1.63, parent: "earth", a: 1.2e7 * K,
            solid: true, atmo: null, phase0: 1.7, gen: true,
            style: { color: 0x8d8d92 }, face: { kind: "rocky", base: "#8d8d92", accent: "#65656a", accent2: "#c0c0c8" } },
    minmus: { name: "Minmus", radius: 6.0e4 * K, g0: 0.491, parent: "earth", a: 4.7e7 * K,
              solid: true, atmo: null, phase0: 3.9, gen: true,
              style: { color: 0xbfe8d8 }, face: { kind: "ice", base: "#bfe8d8", accent: "#8ac8b0", accent2: "#e8fff4" } },
    duna: { name: "Duna", radius: 3.2e5 * K, g0: 2.94, parent: "sun", a: 2.07262e10 * K,
            solid: true, atmo: { height: 5.0e4 * K, seaLevelDensity: 0.05 }, phase0: 4.8, gen: true,
            style: { color: 0xc05a38 }, face: { kind: "desert", base: "#c05a38", accent: "#8a3e26", accent2: "#e8e8e8" } },
    ike: { name: "Ike", radius: 1.3e5 * K, g0: 1.10, parent: "duna", a: 3.2e6 * K,
           solid: true, atmo: null, phase0: 2.6, gen: true,
           style: { color: 0x9a9aa2 }, face: { kind: "rocky", base: "#9a9aa2", accent: "#6a6a72", accent2: "#c8c8d0" } },
    dres: { name: "Dres", radius: 1.38e5 * K, g0: 1.13, parent: "sun", a: 4.08393e10 * K,
            solid: true, atmo: null, phase0: 1.1, gen: true,
            style: { color: 0xa8a090 }, face: { kind: "rocky", base: "#a8a090", accent: "#787060", accent2: "#d0c8b8" } },
    jool: { name: "Jool", radius: 6.0e6 * K, g0: 7.85, parent: "sun", a: 6.87736e10 * K,
            solid: false, atmo: { height: 2.0e5 * K, seaLevelDensity: 0.3 }, phase0: 5.5, gen: true, gas: true,
            style: { color: 0x5a9a3a, halo: 0x7ab85a },
            face: { kind: "gas", bands: ["#5a9a3a", "#3f7a28", "#7ab85a", "#2f6a1e"], spot: true } },
    laythe: { name: "Laythe", radius: 5.0e5 * K, g0: 7.85, parent: "jool", a: 2.7184e7 * K,
              solid: true, atmo: { height: 5.0e4 * K, seaLevelDensity: 0.6 }, phase0: 0.6, gen: true,
              style: { color: 0x2a5c9e, halo: 0x5a8cc8 }, face: { kind: "terra", base: "#2a5c9e", accent: "#4a6a3a", accent2: "#d8e8f0" } },
    vall: { name: "Vall", radius: 3.0e5 * K, g0: 2.31, parent: "jool", a: 4.3152e7 * K,
            solid: true, atmo: null, phase0: 2.9, gen: true,
            style: { color: 0xcfe0ea }, face: { kind: "ice", base: "#d5e4ec", accent: "#9ab8c8", accent2: "#ffffff" } },
    tylo: { name: "Tylo", radius: 6.0e5 * K, g0: 7.85, parent: "jool", a: 6.85e7 * K,
            solid: true, atmo: null, phase0: 4.4, gen: true,
            style: { color: 0xcac0b0 }, face: { kind: "rocky", base: "#cac0b0", accent: "#968c7a", accent2: "#eee6d8" } },
    bop: { name: "Bop", radius: 6.5e4 * K, g0: 0.589, parent: "jool", a: 1.285e8 * K,
           solid: true, atmo: null, phase0: 1.4, gen: true,
           style: { color: 0x8a7a62 }, face: { kind: "rocky", base: "#8a7a62", accent: "#5e523f", accent2: "#b8a888" } },
    pol: { name: "Pol", radius: 4.4e4 * K, g0: 0.373, parent: "jool", a: 1.7989e8 * K,
           solid: true, atmo: null, phase0: 5.9, gen: true,
           style: { color: 0xd8c878 }, face: { kind: "desert", base: "#d8c878", accent: "#a89448", accent2: "#f0e8b0" } },
    eeloo: { name: "Eeloo", radius: 2.1e5 * K, g0: 1.69, parent: "sun", a: 9.0118e10 * K,
             solid: true, atmo: null, phase0: 3.3, gen: true,
             style: { color: 0xd8dce0 }, face: { kind: "ice", base: "#d8dce0", accent: "#a8b0b8", accent2: "#8a6a4a" } },
  };
  const order = ["sun", "moho", "eve", "gilly", "earth", "moon", "minmus", "duna", "ike",
                 "dres", "jool", "laythe", "vall", "tylo", "bop", "pol", "eeloo"];
  return {
    key: "gen:kerbol",
    name: "The Kerbol System",
    seed: "Kerbol",
    blackHole: false,
    starClass: "G",
    starLabel: "yellow star",
    homeName: "Kerbin",
    moonName: "the Mun",
    planetCount: 7,
    frostAU: 0.35, // Kerbol's little system is compact; flavor only
    bodies: buildCatalog(defs, order),
    planetKeys: order.slice(1),
    stations: [
      { id: "st_home", name: "Gene's Station", body: "earth", altR: 2.4, phase0: 0.8 },
      { id: "st_far", name: "Jool Research Outpost", body: "jool", altR: 3.4, phase0: 2.2 },
    ],
    famous: "kerbol",
    blurb: "🟢 <b>Welcome to the KERBOL SYSTEM — the worlds of Kerbal Space Program, the " +
      "game that inspired THIS one!</b> And it's the real deal: Kerbin is truly 600 km " +
      "around with Earth's gravity, the Mun and minty Minmus are waiting, and every orbit " +
      "runs on the honest KSP numbers. The classic missions all work: land on the Mun, " +
      "parachute into Eve's thick purple air (getting OFF Eve is the hardest thing in the " +
      "system — real KSP players fear it), sky-crane onto red Duna, and visit giant green " +
      "Jool with its five moons — Laythe even has oceans and air. Fly safe, Kerbonaut! 🚀",
  };
}

// ---------- THE PANDORA SYSTEM (Avatar) — a home that is a MOON of a gas giant ----------
function pandoraSystem() {
  const defs = {
    sun: { name: "Alpha Centauri A", radius: 8.512e8, g0: 201.4, parent: null, a: 0,
           solid: false, atmo: null, phase0: 0, gen: true,
           style: { color: 0xffe89a, star: true, glow: "255,232,154" } },
    prometheus: { name: "Prometheus", radius: 4.8e6, g0: 6.5, parent: "sun", a: 0.42 * AU,
                  solid: true, atmo: null, phase0: 2.8, gen: true,
                  style: { color: 0x8a2f1c, halo: 0xff7a3a }, face: { kind: "lava", base: "#3a1410", accent: "#ff6a2a", accent2: "#ffc24a" } },
    polyphemus: { name: "Polyphemus", radius: 6.5e7, g0: 14.0, parent: "sun", a: 1.22 * AU,
                  solid: false, atmo: { height: 1.0e6, seaLevelDensity: 0.25 }, phase0: 0.4, gen: true, gas: true,
                  style: { color: 0x4a7ac8, halo: 0x6a94d8 },
                  face: { kind: "gas", bands: ["#4a7ac8", "#3a62a8", "#6a94d8", "#2a4a88"], spot: true } },
    polyi: { name: "Polyphemus I", radius: 1.9e6, g0: 1.4, parent: "polyphemus", a: 3.2e8,
             solid: true, atmo: null, phase0: 1.9, gen: true,
             style: { color: 0x9a9088 }, face: { kind: "rocky", base: "#9a9088", accent: "#6a625a", accent2: "#c8beb2" } },
    // PANDORA — the homeworld, and it's a MOON. Look up from the pad: Polyphemus
    // fills the sky. Air thicker than Earth's (great for parachutes) but poisonous —
    // Connies keep their bubble helmets ON here (the Navigator teaches why).
    earth: { name: "Pandora", radius: 5.75e6, g0: 7.85, parent: "polyphemus", a: 6.4e8,
             solid: true, atmo: { height: 8.0e4, seaLevelDensity: 1.55 }, phase0: 0, gen: true, home: true,
             style: { color: 0x2f9e6a, halo: 0x6fd0a8 }, face: { kind: "terra", base: "#1c7a52", accent: "#2f9e6a", accent2: "#6ac8f0" } },
    moon: { name: "Little Sister", radius: 1.5e6, g0: 1.7, parent: "earth", a: 3.3e7,
            solid: true, atmo: null, phase0: 2.4, gen: true,
            style: { color: 0xb0a8c0 }, face: { kind: "rocky", base: "#b0a8c0", accent: "#7e7690", accent2: "#d8d0e8" } },
    polyii: { name: "Polyphemus II", radius: 2.4e6, g0: 1.8, parent: "polyphemus", a: 1.35e9,
              solid: true, atmo: null, phase0: 4.6, gen: true,
              style: { color: 0xcfe0ea }, face: { kind: "ice", base: "#d5e4ec", accent: "#9ab8c8", accent2: "#b06a4a" } },
    boreas: { name: "Boreas", radius: 2.5e7, g0: 10.0, parent: "sun", a: 4.1 * AU,
              solid: false, atmo: { height: 9.0e5, seaLevelDensity: 0.4 }, phase0: 3.6, gen: true, gas: true,
              style: { color: 0x7fa8c8, halo: 0xa8c8e0 },
              face: { kind: "gas", bands: ["#7fa8c8", "#5d86a8", "#a8c8e0"], spot: false } },
    // ---- THE OTHER TWO SUNS (his ask — and real!): Alpha Centauri is a TRIPLE system ----
    // B: a slightly smaller orange star, at the TRUE A–B average separation of 23.5 AU.
    // Real numbers: 0.907 solar masses, 0.865 solar radii → g0 = 274·m/r² ≈ 332.
    // (The real orbit is a stretched 80-year ellipse, 11–35 AU; our rails are circles,
    // so we draw the average — the arrival fact teaches the ellipse.)
    acb: { name: "Alpha Centauri B", radius: 6.02e8, g0: 332, parent: "sun", a: 23.5 * AU,
           solid: false, atmo: null, phase0: 1.1, gen: true,
           style: { color: 0xffc07a, star: true, glow: "255,192,122" } },
    // Proxima: the real nearest star to our Sun — a tiny red dwarf (0.122 solar masses,
    // 0.154 solar radii). Its true orbit is ~13,000 AU out; drawn ~200x closer so the
    // map isn't all empty black. The blurb confesses the compression (same honesty
    // deal as the galaxy map's squeezed star positions).
    proxima: { name: "Proxima Centauri", radius: 1.07e8, g0: 1410, parent: "sun", a: 70 * AU,
               solid: false, atmo: null, phase0: 5.2, gen: true,
               style: { color: 0xff6a4a, star: true, glow: "255,106,74" } },
  };
  const order = ["sun", "prometheus", "polyphemus", "polyi", "earth", "moon", "polyii", "boreas",
                 "acb", "proxima"];
  const bodies = buildCatalog(defs, order);
  // Companion-star SOI: buildCatalog's Laplace formula a·(mu/muA)^0.4 assumes the child
  // is TINY next to its parent. B is 0.82x A — the formula would hand it a 21.7 AU
  // sphere swallowing half the map, flipping readouts to B across the outer system.
  // Use the gravity-balance point instead (where the companion's pull equals A's along
  // the line between them): r = a·√q/(1+√q), q = mu/muA. Honest readouts, and no
  // planet's orbit ever falls inside a companion's SOI (famous_test proves it).
  for (const k of ["acb", "proxima"]) {
    const q = Math.sqrt(bodies[k].mu / bodies.sun.mu);
    bodies[k].soiRadius = bodies[k].orbitRadius * (q / (1 + q));
  }
  return {
    key: "gen:pandora",
    name: "The Pandora System",
    seed: "Pandora",
    blackHole: false,
    starClass: "G",
    starLabel: "triple star (Alpha Centauri A + B + Proxima)",
    homeName: "Pandora",
    moonName: "Little Sister",
    planetCount: 3,
    frostAU: 3.3,
    bodies,
    planetKeys: order.slice(1),
    stations: [
      { id: "st_home", name: "Hell's Gate Station", body: "earth", altR: 2.3, phase0: 1.2 },
    ],
    famous: "pandora",
    blurb: "🌿 <b>Welcome to the PANDORA system — from the movie Avatar!</b> Here's the " +
      "wild part: your homeworld is a <b>MOON</b>. Zoom the map out and you'll see Pandora " +
      "circling the blue gas giant <b>Polyphemus</b>, which circles Alpha Centauri A — " +
      "and keep zooming: <b>THREE stars</b>, and that part is real! Alpha Centauri is the " +
      "true nearest star system to ours (4.37 light-years): A and its orange twin <b>B</b> " +
      "swing around each other about every 80 years, and the little red dwarf <b>Proxima</b> " +
      "circles far outside — really ~13,000 AU out; we drew it ~200x closer so your map " +
      "isn't all empty black. Pandora's air is thicker than Earth's — lovely for parachutes, " +
      "poisonous to breathe, so the Connies keep their bubble helmets sealed. Hell's Gate " +
      "Station is overhead. 🌌",
  };
}

// ---------- THE YOUNGCOW SYSTEM (his own design, 2026-07-16) — a BABY solar system ----------
// A young yellow dwarf still wearing its protoplanetary disc. Four worlds, all small and
// young: tidally-locked lava Sia; ringed home Hundun with its armored dino-birds, two
// ground bases, a lava moon on a genuinely ELLIPTICAL rail (first body to use `ecc`),
// and a lumpy still-accreting moonlet; a real comet (named Konnie — comets are named
// after their discoverers!); and Centdra, a planet still FORMING out in the disc.
function youngcowSystem() {
  const defs = {
    sun: { name: "Youngcow", radius: 6.3e8, g0: 250, parent: null, a: 0,
           solid: false, atmo: null, phase0: 0, gen: true,
           style: { color: 0xffdf6e, star: true, glow: "255,223,110", young: true } },
    // SIA — the lava world, tidally LOCKED: the same face always points at the star
    // (like our Moon at Earth), so one side is molten ocean and the other frozen rock.
    sia: { name: "Sia", radius: 2.8e6, g0: 4.5, parent: "sun", a: 0.25 * AU,
           solid: true, atmo: null, phase0: 1.3, gen: true,
           style: { color: 0xb0502a, lockedLava: true },
           face: { kind: "lavaLocked", base: "#2a1410", accent: "#ff5a1a", accent2: "#ffc24a" } },
    // HUNDUN — the main world and home. Ringed (young systems are messy), alive
    // (armored plant-eating dino-birds), and hosting two ground bases: one working
    // science base, one wreck. Asteroids from the ring still hit the ground here.
    earth: { name: "Hundun", radius: 5.2e6, g0: 8.6, parent: "sun", a: 0.8 * AU,
             solid: true, atmo: { height: 7.5e4, seaLevelDensity: 1.15 }, phase0: 0, gen: true, home: true,
             style: { color: 0x4a9a5a, halo: 0x7ac88a, rings: true, life: "dinobird", meteorRain: true,
                      // Ground bases: phi is the fixed surface angle (the launchpad sits
                      // at +Y = PI/2, so both are a ~3 km hop from the pad — findable).
                      bases: [
                        { id: "base_sci", name: "Hundun Science Base", wrecked: false, phi: Math.PI / 2 - 0.006 },
                        { id: "base_old", name: "Old Nest Base", wrecked: true, phi: Math.PI / 2 + 0.006 },
                      ] },
             face: { kind: "terra", base: "#2a6a3e", accent: "#4a9a5a", accent2: "#c8b06a" } },
    // EMBER — the lava moon on a STRETCHED orbit (e = 0.45): watch it sprint through
    // its close pass and crawl at the far end — Kepler's second law, live in the sky.
    moon: { name: "Ember", radius: 9.0e5, g0: 1.3, parent: "earth", a: 4.5e7,
            solid: true, atmo: null, phase0: 0.7, gen: true, ecc: 0.45, periAngle: 0.8,
            style: { color: 0xd06a3a },
            face: { kind: "lava", base: "#3a1a10", accent: "#ff6a2a", accent2: "#ffc24a" } },
    // PEBBLE — a moonlet INSIDE Hundun's ring, still collecting material. So small and
    // lumpy you can't orbit it (tinyMoon — fly formation like a real 67P mission).
    pebble: { name: "Pebble", radius: 6.0e4, g0: 0.02, parent: "earth", a: 2.2e7,
              solid: true, atmo: null, phase0: 3.2, gen: true,
              style: { color: 0x9a8a76, lumpy: true },
              face: { kind: "rocky", base: "#9a8a76", accent: "#6a5e4e", accent2: "#c8bca8" } },
    // COMET KONNIE — the third object isn't a planet at all. A dirty snowball on an
    // eccentric rail that dives inside Hundun's orbit and swings back out to the disc.
    // Gravity is very low but NOT zero: escape speed ≈ bike speed.
    comet: { name: "Comet Konnie", radius: 3.0e4, g0: 0.004, parent: "sun", a: 1.5 * AU,
             solid: true, atmo: null, phase0: 4.5, gen: true, ecc: 0.6, periAngle: 2.4,
             style: { color: 0xbfe8f2, comet: true },
             face: { kind: "ice", base: "#cfe4ea", accent: "#9ab4c0", accent2: "#f0fbff" } },
    // CENTDRA — still FORMING, far out inside the protoplanetary disc, wrapped in its
    // own fast-spinning disc of infalling material (a real circumplanetary disk!).
    centdra: { name: "Centdra", radius: 4.0e6, g0: 6.0, parent: "sun", a: 3.5 * AU,
               solid: true, atmo: { height: 5.0e4, seaLevelDensity: 0.08 }, phase0: 2.0, gen: true,
               style: { color: 0xc09a5a, formingDisc: true },
               face: { kind: "lava", base: "#4a2e18", accent: "#e08a3a", accent2: "#8a5e36" } },
  };
  const order = ["sun", "sia", "earth", "moon", "pebble", "comet", "centdra"];
  const bodies = buildCatalog(defs, order);
  // The system-wide protoplanetary disc, sized off Centdra's (already-scaled) orbit:
  // inner edge ~2.2 AU, outer ~5.5 AU. Render reads this off the star's style.
  bodies.sun.style.protoDisc = {
    inner: bodies.centdra.orbitRadius * (2.2 / 3.5),
    outer: bodies.centdra.orbitRadius * (5.5 / 3.5),
  };
  return {
    key: "gen:youngcow",
    name: "The Youngcow System",
    seed: "Youngcow",
    blackHole: false,
    starClass: "G",
    starLabel: "young yellow dwarf with a protoplanetary disc",
    homeName: "Hundun",
    moonName: "Ember",
    planetCount: 4,
    frostAU: 2.0,
    young: true, // young system: extra asteroids + comets in the render dressing
    bodies,
    planetKeys: order.slice(1),
    stations: [
      { id: "st_home", name: "Cradle Station", body: "earth", altR: 2.5, phase0: 1.0 },
    ],
    famous: "youngcow",
    blurb: "🐄✨ <b>Welcome to the YOUNGCOW SYSTEM — a BABY solar system, designed by " +
      "you-know-who!</b> This yellow dwarf is like our Sun as a toddler, still wearing its " +
      "<b>protoplanetary disc</b> — real telescopes (ALMA) photograph discs exactly like " +
      "this around young stars. <b>Sia</b> is tidally locked: one face always toward the " +
      "star, molten; the other, frozen dark. Home is <b>Hundun</b> — ringed, green, and " +
      "ALIVE: armored dino-birds graze the plains (they only eat plants). Two bases wait on " +
      "the surface, and watch the sky — ring rocks still fall here. Its moon <b>Ember</b> " +
      "rides a genuinely STRETCHED orbit: watch the map — it sprints through the close pass " +
      "and crawls at the far end, exactly Kepler's second law. Little <b>Pebble</b> is still " +
      "gathering itself inside the ring — too lumpy and light to orbit, so fly formation. " +
      "The third \"planet\" is no planet: <b>Comet Konnie</b> (comets are named for their " +
      "discoverers!) dives sunward and swings back out — you can LAND on it; escape speed " +
      "is bicycle speed. And far out in the disc, <b>Centdra</b> is still being born, " +
      "wrapped in its own spinning disc of infalling rock. 🚀",
  };
}

// ---------- THE LUHMAN 16 SYSTEM (his ask: "hybrid planet-stars") — two real BROWN DWARFS ----------
// Brown dwarfs are the in-between things: heavier than ~13 Jupiters (they briefly burn
// deuterium), lighter than ~80 (ordinary hydrogen fusion never lights). Luhman 16 is
// the real closest pair — 6.5 light-years, the THIRD-closest system to Sol, found in
// 2013 by Kevin Luhman (named for its discoverer, like Comet Konnie). Real masses and
// Jupiter-ish radii → the huge surface gravities below are honest: g0 = 274·(M/M☉)/(R/R☉)²
// worked in Jupiter units, G·M/R². Both drawn as EMBERS (style.ember): dull coal-glow,
// not fusion glare — you can look right at one. Twilight + Firefly are IMAGINED and the
// blurb confesses it (no planets found there for real YET — looking is real science);
// their physics is honest: a warm world by a dim brown dwarf huddles SO close its year
// lasts about half a day (T_eq ≈ 1500K·√(R★/2a) ≈ −17°C at 0.008 AU; period ≈ 11 h).
function luhmanSystem() {
  const defs = {
    // A: L7.5 dwarf, 35.4 Jupiter masses, ~1 Jupiter radius (7.0e7 m) → g0 = GM/R² ≈ 915.
    sun: { name: "Luhman 16 A", radius: 7.0e7, g0: 915, parent: null, a: 0,
           solid: false, atmo: null, phase0: 0, gen: true,
           style: { color: 0xd85a3a, star: true, ember: true, glow: "255,110,60" } },
    // TWILIGHT — the imagined home: forever-sunset skies under a coal-red not-quite-star.
    // 0.008 AU out (11 star-radii!) because a brown dwarf's warm zone really is that
    // close — its whole year lasts ~11 hours. Real worlds this close get tidally locked.
    earth: { name: "Twilight", radius: 3.4e6, g0: 8.2, parent: "sun", a: 0.008 * AU,
             solid: true, atmo: { height: 6.0e4, seaLevelDensity: 1.0 }, phase0: 0, gen: true, home: true,
             style: { color: 0x8a5a72, halo: 0xd87a5a },
             face: { kind: "terra", base: "#3a2e44", accent: "#7a4a56", accent2: "#d87a4a" } },
    moon: { name: "Firefly", radius: 4.5e5, g0: 0.55, parent: "earth", a: 1.5e7,
            solid: true, atmo: null, phase0: 2.1, gen: true,
            style: { color: 0x6a6272 }, face: { kind: "rocky", base: "#6a6272", accent: "#464050", accent2: "#948ca4" } },
    // B: T0.5 dwarf, 29.4 Jupiter masses → g0 ≈ 760. Drawn at the true ~3.5 AU average
    // separation (the real orbit is an ellipse, ~27 years around each other — rails are
    // circles, so we draw the average; the blurb teaches the real number).
    luhb: { name: "Luhman 16 B", radius: 7.0e7, g0: 760, parent: "sun", a: 3.5 * AU,
            solid: false, atmo: null, phase0: 3.9, gen: true,
            style: { color: 0xb84a66, star: true, ember: true, glow: "220,90,110" } },
  };
  const order = ["sun", "earth", "moon", "luhb"];
  const bodies = buildCatalog(defs, order);
  // Companion SOI at the gravity-balance point, same fix as Alpha Centauri B (Laplace
  // assumes a tiny mass ratio; B is 0.83x A and would swallow half the map).
  {
    const q = Math.sqrt(bodies.luhb.mu / bodies.sun.mu);
    bodies.luhb.soiRadius = bodies.luhb.orbitRadius * (q / (1 + q));
  }
  return {
    key: "gen:luhman",
    name: "The Luhman 16 System",
    seed: "Luhman 16",
    blackHole: false,
    starClass: "L",
    starLabel: "brown dwarf pair (Luhman 16 A + B)",
    homeName: "Twilight",
    moonName: "Firefly",
    planetCount: 1,
    frostAU: 0.02, // a brown dwarf's warmth barely reaches past its own doorstep
    bodies,
    planetKeys: order.slice(1),
    stations: [
      { id: "st_home", name: "Lantern Station", body: "earth", altR: 2.4, phase0: 0.6 },
    ],
    famous: "luhman",
    blurb: "🌗🔥 <b>Welcome to LUHMAN 16 — a pair of BROWN DWARFS!</b> The in-between " +
      "things: too heavy to be planets, never heavy enough to light the fusion fire that " +
      "makes a real star. Both are about the size of JUPITER but ~30x its mass, glowing " +
      "dull red from leftover birth-heat — coals from a campfire that never caught. And " +
      "they're REAL: the closest brown dwarfs to Earth (6.5 light-years — the third-closest " +
      "system of any kind; your map draws it a little nearer), found in 2013 by Kevin " +
      "Luhman — named for the discoverer, just like Comet Konnie! <b>A</b> and <b>B</b> " +
      "circle each other about every 27 years. B has real WEATHER: in 2014 astronomers made " +
      "the first weather map of any world beyond our solar system here — patchy clouds of " +
      "hot sand, with rain of molten IRON. No planets have been found here for real YET " +
      "(looking is real science!), so we imagined <b>Twilight</b> for you: a world huddled " +
      "so close to its dim coal-sun that its whole YEAR lasts about half a day, under a sky " +
      "of forever-sunset. Little <b>Firefly</b> keeps it company, and Lantern Station glows " +
      "overhead. 🏮",
  };
}

// ---------- Registry ----------
// Aliases are normalized (lowercase, letters+digits only) so "The Kerbal System",
// "kerbin", "KSP", "avatar", "Alpha Centauri"… all land on the same canonical system.
const BUILDERS = { kerbol: kerbolSystem, pandora: pandoraSystem, youngcow: youngcowSystem, luhman: luhmanSystem };
const ALIASES = {
  kerbol: "kerbol", kerbin: "kerbol", kerbal: "kerbol", ksp: "kerbol",
  kerbalsystem: "kerbol", kerbolsystem: "kerbol", thekerbolsystem: "kerbol",
  thekerbalsystem: "kerbol", kerbalspaceprogram: "kerbol",
  pandora: "pandora", avatar: "pandora", polyphemus: "pandora",
  alphacentauri: "pandora", alphacentauria: "pandora", alphacentaurib: "pandora",
  proxima: "pandora", proximacentauri: "pandora", centauri: "pandora",
  pandorasystem: "pandora", avatarsystem: "pandora", thepandorasystem: "pandora",
  youngcow: "youngcow", youngcowsystem: "youngcow", theyoungcowsystem: "youngcow",
  hundun: "youngcow", hundunsystem: "youngcow", sia: "youngcow",
  centdra: "youngcow", cometkonnie: "youngcow", ember: "youngcow",
  luhman: "luhman", luhman16: "luhman", luhmansystem: "luhman",
  luhman16system: "luhman", theluhmansystem: "luhman", theluhman16system: "luhman",
  browndwarf: "luhman", browndwarfs: "luhman", thebrowndwarfs: "luhman",
  twilight: "luhman", firefly: "luhman",
};

// Shown in the Starmap panel and pre-lit on the galaxy map.
export const FAMOUS_LIST = [
  { seed: "Kerbol", name: "The Kerbol System", hint: "the Kerbal Space Program worlds — Kerbin, the Mun, Jool…", color: 0xffd75e },
  { seed: "Pandora", name: "The Pandora System", hint: "from Avatar — your home is a moon of a gas giant, under three real suns", color: 0x4a7ac8 },
  { seed: "Youngcow", name: "The Youngcow System", hint: "HIS design — a baby solar system: protoplanetary disc, ringed Hundun, dino-birds, a comet you can land on", color: 0xffdf6e },
  { seed: "Luhman 16", name: "The Luhman 16 System", hint: "the real closest BROWN DWARFS — two failed stars the size of Jupiter, glowing like coals", color: 0xd85a3a },
];

// null if the name isn't famous — the seeded generator takes over as usual.
// Rebuilt fresh on every call (never cached): setSystem shares body objects by
// reference, and Sol deep-copies its snapshot for exactly this reason.
export function famousSystem(seedName) {
  const norm = String(seedName).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = ALIASES[norm];
  return key ? BUILDERS[key]() : null;
}
