// Surface types shared by the course generator, the renderer, and the physics.
// The numeric ids are the canonical encoding everywhere (mask textures, saves, tests).
export const SURFACES = Object.freeze({
  ROUGH: 0,
  DEEP_ROUGH: 1,
  FIRST_CUT: 2,
  FAIRWAY: 3,
  FRINGE: 4,
  GREEN: 5,
  TEE: 6,
  BUNKER: 7,
  DIRT: 8,
  PATH: 9,
  WETLAND: 10,
  WATER: 11,
  WASTE: 12, // desert floor, dunes, forest floor: playable but punishing
  ROCK: 13,
});

export const SURFACE_NAMES = [
  'Rough', 'Deep rough', 'First cut', 'Fairway', 'Fringe', 'Green', 'Tee',
  'Bunker', 'Dirt', 'Cart path', 'Wetland', 'Water', 'Waste area', 'Rock',
];

// Stimp 10 green: a ball released at 1.83 m/s rolls 10 ft, so decel = v^2 / (2 d) = 0.549 m/s^2.
export const STIMP_10_DECEL = (1.83 * 1.83) / (2 * 3.048);

// restitution: normal bounce energy kept. bounceFriction: sliding friction at impact.
// soft: forward speed absorbed by turf deformation on a steep impact.
// grip: how much spin bites (1 on a receptive green). rollDecel: rolling resistance, m/s^2.
// powerLoss/powerVar: fraction of ball speed lost hitting from this lie, and its spread.
// spinKeep: backspin retained from this lie. spread: dispersion multiplier.
const PROPS = [
  /* ROUGH      */ { restitution: 0.28, soft: 0.62, bounceFriction: 0.5, grip: 0.35, rollDecel: 5.0, powerLoss: 0.1, powerVar: 0.05, spinKeep: 0.65, spread: 1.6 },
  /* DEEP_ROUGH */ { restitution: 0.2, soft: 0.75, bounceFriction: 0.65, grip: 0.3, rollDecel: 9.0, powerLoss: 0.28, powerVar: 0.1, spinKeep: 0.45, spread: 2.3 },
  /* FIRST_CUT  */ { restitution: 0.34, soft: 0.52, bounceFriction: 0.42, grip: 0.5, rollDecel: 3.0, powerLoss: 0.04, powerVar: 0.02, spinKeep: 0.85, spread: 1.2 },
  /* FAIRWAY    */ { restitution: 0.4, soft: 0.45, bounceFriction: 0.36, grip: 0.62, rollDecel: 2.0, powerLoss: 0, powerVar: 0, spinKeep: 1, spread: 1 },
  /* FRINGE     */ { restitution: 0.36, soft: 0.5, bounceFriction: 0.38, grip: 0.8, rollDecel: 1.0, powerLoss: 0, powerVar: 0, spinKeep: 1, spread: 1 },
  /* GREEN      */ { restitution: 0.34, soft: 0.55, bounceFriction: 0.4, grip: 1.0, rollDecel: STIMP_10_DECEL, powerLoss: 0, powerVar: 0, spinKeep: 1, spread: 1 },
  /* TEE        */ { restitution: 0.38, soft: 0.45, bounceFriction: 0.36, grip: 0.65, rollDecel: 1.8, powerLoss: 0, powerVar: 0, spinKeep: 1, spread: 0.9 },
  /* BUNKER     */ { restitution: 0.12, soft: 0.9, bounceFriction: 0.8, grip: 0.2, rollDecel: 12.0, powerLoss: 0.2, powerVar: 0.06, spinKeep: 0.6, spread: 1.7, plug: false },
  /* DIRT       */ { restitution: 0.34, soft: 0.4, bounceFriction: 0.45, grip: 0.4, rollDecel: 3.5, powerLoss: 0.06, powerVar: 0.04, spinKeep: 0.7, spread: 1.4 },
  /* PATH       */ { restitution: 0.62, soft: 0.05, bounceFriction: 0.25, grip: 0.3, rollDecel: 0.9, powerLoss: 0.03, powerVar: 0.03, spinKeep: 0.8, spread: 1.5 },
  /* WETLAND    */ { restitution: 0.1, soft: 0.95, bounceFriction: 0.85, grip: 0.2, rollDecel: 14.0, powerLoss: 0.35, powerVar: 0.1, spinKeep: 0.4, spread: 2.4, plug: true },
  /* WATER      */ { restitution: 0, soft: 1, bounceFriction: 1, grip: 0, rollDecel: 50, powerLoss: 1, powerVar: 0, spinKeep: 0, spread: 1 },
  /* WASTE      */ { restitution: 0.3, soft: 0.6, bounceFriction: 0.5, grip: 0.3, rollDecel: 5.5, powerLoss: 0.14, powerVar: 0.06, spinKeep: 0.6, spread: 1.8 },
  /* ROCK       */ { restitution: 0.6, soft: 0.05, bounceFriction: 0.3, grip: 0.2, rollDecel: 2.5, powerLoss: 0.2, powerVar: 0.1, spinKeep: 0.5, spread: 2.5 },
];

export function surfaceProps(id) {
  return PROPS[id] || PROPS[0];
}

export const isPuttable = (id) => id === SURFACES.GREEN;
export const isHazard = (id) => id === SURFACES.WATER;
