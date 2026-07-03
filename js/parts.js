// parts.js — the stock part catalog. Plain data (PartDef shape, see ARCHITECTURE.md).
// These are also the worked examples the copilot teaches modding from later. Keep readable.

export const PARTS = [
  {
    id: "command_pod",
    type: "command",
    name: "Acorn Command Pod",
    dryMass: 0.8,
    height: 1.2, radius: 0.7, shape: "cone",
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
    id: "decoupler",
    type: "decoupler",
    name: "Stage Decoupler",
    dryMass: 0.05,
    height: 0.3, radius: 0.6, shape: "cylinder",
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
];
