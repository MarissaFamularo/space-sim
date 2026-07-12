// parts.js — the stock part catalog. Plain data (PartDef shape, see ARCHITECTURE.md).
// These are also the worked examples the copilot teaches modding from later. Keep readable.

export const PARTS = [
  {
    id: "command_pod",
    type: "command",
    name: "Acorn Command Pod",
    dryMass: 0.8,
    seats: 1, // one Connie, Mercury-capsule style
    height: 1.2, radius: 0.7, shape: "cone",
    attachTop: false, attachBottom: true,
  },
  {
    // Three Connies fly together, Apollo-style (the real Apollo pod held exactly 3:
    // two walked on the Moon while one flew the ship — that was Michael Collins).
    id: "command_trio",
    type: "command",
    name: "Trio Command Pod",
    dryMass: 2.4,
    seats: 3,
    height: 1.8, radius: 1.0, shape: "cone",
    attachTop: false, attachBottom: true,
  },
  {
    id: "parachute",
    type: "chute",
    name: "Parachute",
    dryMass: 0.1,
    height: 0.5, radius: 0.45, shape: "chute",
    attachTop: false, attachBottom: true, // rides on top of the pod; nothing above it
  },
  {
    id: "tank_small",
    type: "tank",
    name: "Small Fuel Tank",
    dryMass: 0.3, fuelMass: 4.0,
    height: 1.8, radius: 0.6, shape: "cylinder",
    attachTop: true, attachBottom: true,
  },
  {
    id: "tank_large",
    type: "tank",
    name: "Large Fuel Tank",
    dryMass: 0.6, fuelMass: 9.0,
    height: 3.0, radius: 0.6, shape: "cylinder",
    attachTop: true, attachBottom: true,
  },
  {
    id: "tank_mega",
    type: "tank",
    name: "Mega Fuel Tank",
    dryMass: 1.1, fuelMass: 18.0,
    height: 4.2, radius: 0.8, shape: "cylinder",
    attachTop: true, attachBottom: true,
  },
  {
    id: "engine_sparrow",
    type: "engine",
    name: "Sparrow Engine",
    dryMass: 0.5, thrust: 215, exhaustVelocity: 2800, // ~Isp 285s
    height: 1.0, radius: 0.6, shape: "nozzle",
    attachTop: true, attachBottom: false,
  },
  {
    id: "engine_hawk",
    type: "engine",
    name: "Hawk Heavy Engine",
    dryMass: 1.2, thrust: 600, exhaustVelocity: 3000, // ~Isp 306s
    height: 1.4, radius: 0.8, shape: "nozzle",
    attachTop: true, attachBottom: false,
  },
  {
    // Deep-space specialist: weak push, but squeezes far more speed from every ton of
    // fuel (high exhaust velocity — real vacuum engines make this exact trade).
    id: "engine_osprey",
    type: "engine",
    name: "Osprey Vacuum Engine",
    dryMass: 0.9, thrust: 90, exhaustVelocity: 4400, // ~Isp 449s
    height: 1.2, radius: 0.7, shape: "nozzle",
    attachTop: true, attachBottom: false,
  },
  {
    // Side-mounted thrusters that can fire with cargo hanging BELOW them — the trick
    // NASA used to lower the Curiosity and Perseverance rovers onto Mars on cables.
    // Packs its OWN fuel inside the frame (the real descent stage did too) — no tank
    // needed for a pure sky-crane landing.
    id: "engine_crane",
    type: "engine",
    name: "Sky-Crane Thrusters",
    dryMass: 0.35, fuelMass: 1.5, thrust: 45, exhaustVelocity: 2600,
    height: 0.6, radius: 0.8, shape: "crane",
    attachTop: true, attachBottom: true, // unlike other engines, things CAN hang below
  },
  {
    // REAL future tech, flying today: ion engines (Deep Space 1, Dawn, Psyche) push
    // gently but sip fuel — exhaust 10x faster than chemical. Too weak to lift off
    // (真 real!): launch on chemicals, then cruise the system on ions.
    id: "engine_ion",
    type: "engine",
    name: "Ion Drive",
    dryMass: 0.4, thrust: 6, exhaustVelocity: 30000,
    height: 0.8, radius: 0.55, shape: "nozzle",
    attachTop: true, attachBottom: false,
  },
  {
    // FAR-future fusion torch for the interstellar dreamers. Exhaust at 120 km/s —
    // 40x a chemical rocket — and enough thrust to lift off with it. Even this
    // monster would take ~10,000 years to reach the nearest star; the Starmap's
    // fold is the only way to skip that. (Physics stays honest — ask the Navigator.)
    id: "engine_torch",
    type: "engine",
    name: "Starfire Torch",
    dryMass: 2.5, thrust: 900, exhaustVelocity: 120000,
    height: 1.8, radius: 0.8, shape: "torch",
    attachTop: true, attachBottom: false,
  },
  {
    // You can't just bump into a station and stick — you need the matching ring.
    // Rides on the nose (like Apollo's probe-and-drogue) or inline in the stack.
    id: "docking_port",
    type: "dock",
    name: "Docking Port",
    dryMass: 0.1,
    height: 0.4, radius: 0.5, shape: "dock",
    attachTop: true, attachBottom: true,
  },
  {
    // The part that lets you come HOME. An ablative dish that rides under the capsule
    // and soaks ~70% of reentry heating by slowly charring away — Apollo's did exactly
    // this. Blunt end first! It buys you the reentry corridor, not immunity: a
    // straight-down dive at interplanetary speed is still a fireball.
    id: "heat_shield",
    type: "shield",
    name: "Heat Shield",
    dryMass: 0.3,
    height: 0.35, radius: 0.8, shape: "shield",
    attachTop: true, attachBottom: true,
  },
  {
    id: "decoupler",
    type: "decoupler",
    name: "Stage Decoupler",
    dryMass: 0.05,
    height: 0.3, radius: 0.6, shape: "cylinder",
    attachTop: true, attachBottom: true,
  },
  {
    id: "landing_legs",
    type: "legs",
    name: "Landing Legs",
    dryMass: 0.15,
    height: 0.5, radius: 0.7, shape: "legs",
    attachTop: true, attachBottom: true,
  },
  {
    // Uncrewed brain: a rocket with this (and no crew pod) flies as a PROBE — no Connie
    // aboard. Jettison a stage carrying one while in a stable orbit and it stays up
    // there as a SATELLITE.
    id: "probe_core",
    type: "command",
    name: "Probe Core",
    uncrewed: true,
    dryMass: 0.3,
    height: 0.6, radius: 0.5, shape: "probe",
    attachTop: true, attachBottom: true,
  },
  {
    id: "solar_panel",
    type: "solar",
    name: "Solar Panels",
    dryMass: 0.08,
    height: 0.4, radius: 0.5, shape: "panels",
    attachTop: true, attachBottom: true,
  },
  {
    // Cargo: land it somewhere solid, hit Stage, and it drives off to explore.
    id: "rover",
    type: "rover",
    name: "Rover",
    dryMass: 0.5,
    height: 0.7, radius: 0.6, shape: "rover",
    attachTop: true, attachBottom: true,
  },
  {
    id: "fin",
    type: "fin",
    name: "Stabilizer Fin",
    dryMass: 0.05,
    height: 0.8, radius: 0.5, shape: "fin",
    attachTop: true, attachBottom: true,
  },

  // ---- Space Plane Hangar parts (facility:"hangar" — they live in that building) ----
  {
    // A sleek crewed nose for space planes. Same job as the Acorn, pointier.
    id: "cockpit_swift",
    type: "command",
    name: "Swift Plane Cockpit",
    dryMass: 0.9,
    seats: 1,
    height: 1.3, radius: 0.6, shape: "cone",
    attachTop: false, attachBottom: true,
    facility: "hangar",
  },
  {
    // WINGS make LIFT: tilt the nose a little off your direction of travel inside an
    // atmosphere and the air pushes you sideways — that's the whole trick of flying.
    // (Real lift = air bent downward pushes the wing up. No air, no lift — wings do
    // nothing in space or on the Moon!)
    id: "wing_delta",
    type: "wing",
    name: "Delta Wings",
    dryMass: 0.25,
    height: 0.9, radius: 0.9, shape: "wing",
    attachTop: true, attachBottom: true,
    facility: "hangar",
  },
  {
    // The heart of a space station. A build carrying one can be DEPLOYED as a real,
    // permanent station once it's in a stable orbit — then fly another ship out,
    // dock, and go aboard.
    id: "station_hub",
    type: "station",
    name: "Station Hub",
    dryMass: 1.4,
    height: 1.6, radius: 0.9, shape: "hub",
    attachTop: true, attachBottom: true,
    facility: "hangar",
  },
  {
    // Roomy crew module for stations — more space to float around in.
    id: "habitat_module",
    type: "station",
    name: "Habitat Module",
    dryMass: 1.0,
    height: 2.2, radius: 0.9, shape: "cylinder",
    attachTop: true, attachBottom: true,
    facility: "hangar",
  },
  {
    // Spin a wheel and the floor pushes on your feet — CENTRIFUGE GRAVITY, the only
    // honest way to make gravity in space (2001, and every serious station design).
    // A deployed station with one has gravity inside: your Connie WALKS instead of floats.
    id: "centrifuge_ring",
    type: "centrifuge",
    name: "Centrifuge Ring",
    dryMass: 1.8,
    height: 1.0, radius: 1.7, shape: "ring",
    attachTop: true, attachBottom: true,
    facility: "hangar",
  },
];
