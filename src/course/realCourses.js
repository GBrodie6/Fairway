// Two real courses, built as procedural approximations in the same hole format as the
// invented ones. The real names live only in REAL_COURSE_NAMES, so they are easy to rename.
// Pars and yardages are the most recent official championship cards (sources in ASSETS.md):
// Augusta National at the 2026 Masters, and the Old Course at St Andrews at the 150th Open
// (2022). Hole layouts are approximations of each hole's shape and best-known features, not
// surveys: no maps, photos or text were copied. Traditional hole names are left out (two of
// the Old Course's honor real golfers, and none are needed in play).
//
// Hole specs (all optional, read by course/layout.js generateHole):
//   bend        dogleg in degrees, + right (a par 5 takes [first, second])
//   water       'front' (a pond just short of the green), 'greenside', 'along' (beside the line
//               from tee to green), or 'none'; waterSide -1 left, +1 right
//   stream      a burn or creek across the hole: 'front' (just short of the green) or meters
//               from the tee
//   sea         +1 or -1: the shore on that side; 0 for none
//   double      a double green: half as large again, longer across the line
//   bunkers     { green, fairway } counts; bigBunker { at (share of the hole), side, r }
export const REAL_COURSE_NAMES = Object.freeze({
  augusta: 'Augusta National',
  standrews: 'St Andrews (Old Course)',
});

export const AUGUSTA = {
  id: 'augusta', name: REAL_COURSE_NAMES.augusta, real: true, flagship: false, seed: 0x4a77,
  blurb: 'Rolling parkland among tall pines and azaleas, water through the middle of the back nine, and very fast, steep greens.',
  pars: [4, 5, 4, 3, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 5, 3, 4, 4],
  yards: [445, 585, 350, 240, 495, 180, 450, 570, 460, 495, 520, 155, 545, 440, 550, 170, 450, 465],
  holes: [
    { bend: 8 }, { bend: [-14, -6] }, { bend: -5 }, {}, { bend: -12 }, {}, { bend: 0 }, { bend: [-8, 4] }, { bend: -14 },
    { bend: -18 }, { bend: -6, water: 'greenside', waterSide: -1 }, { stream: 'front' }, { bend: [-22, -10], stream: 'front' },
    { bend: -6, bunkers: { green: 0, fairway: 0 } }, { bend: [0, 4], water: 'front' }, { water: 'along', waterSide: -1 }, { bend: 0 }, { bend: 10 },
  ],
  theme: {
    base: 'rough', seaLevel: null, baseElevation: 45,
    macroAmp: 9, macroWave: 280, undulation: 0.6, undulationWave: 40, dunes: 0, mesa: 0, slopeAlong: 10,
    roughBand: [6, 9], deepBand: 8, fairwayHalf: [18, 24], greenRadius: [12, 15.5],
    bunkers: { green: [1, 3], fairway: [0, 2], pot: false, depth: [0.95, 1.4], radius: [3.4, 5.4] },
    water: { pond: 0, frontPond: 0, stream: 0, sea: 0 },
    trees: { density: 1.2, margin: 11, forest: 1.25 }, corridorFlat: 0.8, stimp: 13,
    greenTilt: [0.016, 0.03], tierChance: 0.5,
  },
  // Very fast greens, a little firm (course/conditions.js has the bounds).
  conditions: { greenSpeed: 1.28, firmness: 1.08 },
  backdrop: { amp: 90, wave: 720, ridged: false, power: 1.5, canopy: [0.02, 0.06, 0.02] },
  wind: { min: 1, max: 9, gustiness: 0.3 },
};

const D = { double: true };
export const ST_ANDREWS = {
  id: 'standrews', name: REAL_COURSE_NAMES.standrews, real: true, flagship: false, seed: 0x5a1d,
  blurb: 'Treeless links by the sea: firm fescue, gorse, pot bunkers, burns and huge double greens, in a strong wind.',
  pars: [4, 4, 4, 4, 5, 4, 4, 3, 4, 4, 3, 4, 4, 5, 4, 4, 4, 4],
  yards: [375, 452, 398, 480, 570, 414, 371, 187, 352, 386, 174, 351, 465, 614, 455, 418, 495, 356],
  holes: [
    { bend: 0, stream: 'front', sea: 1 }, { bend: 4, ...D }, { bend: -4, ...D }, { bend: 3, ...D }, { bend: [-3, 3], ...D }, { bend: 2, ...D }, { bend: 10, ...D }, { ...D }, { bend: 0, sea: -1 },
    { bend: 0, sea: -1, ...D }, { sea: -1, ...D, bigBunker: { at: 0.86, side: 0.4, r: 3.4 } }, { bend: 0, ...D }, { bend: -4, ...D }, { bend: [-6, 4], ...D, bigBunker: { at: 0.7, side: 0, r: 7.5 } }, { bend: -2, ...D }, { bend: 4, ...D },
    { bend: 14, bigBunker: { at: 0.985, side: -1, r: 3.2 } }, { bend: 0, stream: 70, sea: 1 },
  ],
  theme: {
    base: 'rough', seaLevel: 0, baseElevation: 6,
    macroAmp: 2.2, macroWave: 200, undulation: 1.25, undulationWave: 26, dunes: 2.5, mesa: 0, slopeAlong: 2,
    roughBand: [8, 12], deepBand: 10, fairwayHalf: [22, 30], greenRadius: [12.5, 16],
    bunkers: { green: [2, 4], fairway: [2, 4], pot: true, depth: [1.5, 2.2], radius: [2.0, 3.0] },
    water: { pond: 0, frontPond: 0, stream: 0, sea: 0 },
    trees: { density: 0.35, margin: 10, forest: 0 }, corridorFlat: 0.55, stimp: 10.5,
    greenTilt: [0.008, 0.02], tierChance: 0.3,
  },
  // Firm and fast: the ball runs out a long way.
  conditions: { greenSpeed: 1.05, firmness: 1.35 },
  backdrop: { amp: 40, wave: 600, ridged: false, power: 1.7, canopy: [0.07, 0.08, 0.035] },
  wind: { min: 10, max: 26, gustiness: 0.6 },
};
