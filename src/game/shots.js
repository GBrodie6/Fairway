// Shot types the campaign skill trees unlock, beside the physics module's Full, Punch, Flop,
// Chip and Putt (physics/shot.js, unchanged). They are the same kind of object: multipliers on
// ball speed, launch angle and spin, read by computeLaunch before the unchanged simulation.
export const EXTRA_SHOTS = [
  // A high, soft full shot: steeper launch and more spin for a few yards less.
  { id: 'high', name: 'High', speed: 0.97, launch: 1.2, spin: 1.1 },
  // A low chip that runs out like a putt (irons and wedges only).
  { id: 'bump', name: 'Bump and run', speed: 0.46, launch: 0.5, spin: 0.4, noWoods: true },
];
