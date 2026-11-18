// The practice ground: a separate scene, not a hole on a course. A tee line of five hitting
// bays, a wide flat mown field 360 yards long, yardage signs every 25 yards to 300, and five
// target greens with flags at 75, 125, 175, 225, and 275 yards. The layout has the same shape
// as a generated hole (game/layout.js), so the terrain builder, the physics, and the renderer
// all work on it unchanged; range-only parts (targets, bays, signs, clearings) are extra fields.
//
// Hole-local frame: meters, x to the right, play runs toward -Z, bay 3 is at the origin.
import { YARD } from '../core/math.js';

export const RANGE_ID = 'range';
export const RANGE_YARDS = 360;
export const BAY_COUNT = 5;
export const BAY_SPACING = 5.2; // meters between bay centers
export const BAY_X = Array.from({ length: BAY_COUNT }, (_, i) => (i - (BAY_COUNT - 1) / 2) * BAY_SPACING);
export const MAT_Z = 0.6; // the ball on a mat sits a little behind the front of the tee line
export const GRASS_Z = -9.5; // the grass tee strip in front of the bays (fairway turf)
export const SIGN_YARDS = Array.from({ length: 12 }, (_, i) => (i + 1) * 25); // 25 to 300
// Target greens: yards straight down the range, an offset across it (meters, + right),
// the radius, and a flag color (an original set, colorblind-distinguishable by number too).
export const TARGETS = [
  { yards: 75, x: 9, r: 7.5, color: '#e8483a', name: 'Red' },
  { yards: 125, x: -11, r: 9, color: '#f2c230', name: 'Yellow' },
  { yards: 175, x: 7, r: 10.5, color: '#3d8fe0', name: 'Blue' },
  { yards: 225, x: -9, r: 12, color: '#f2f2ee', name: 'White' },
  { yards: 275, x: 4, r: 13.5, color: '#9a5ae0', name: 'Purple' },
];

export const RANGE_COURSE = Object.freeze({
  id: RANGE_ID, name: 'Hollowmere Practice Ground', range: true, seed: 0x6a17,
  blurb: 'Five bays, a flat field, target greens and signs every 25 yards.',
  pars: [4],
  theme: {
    base: 'rough', seaLevel: null, baseElevation: 36,
    macroAmp: 1.2, macroWave: 320, undulation: 0.16, undulationWave: 46, dunes: 0, mesa: 0, slopeAlong: 0,
    roughBand: [10, 10], deepBand: 10, fairwayHalf: [58, 58], greenRadius: [13, 13],
    bunkers: { green: [0, 0], fairway: [0, 0], pot: false, depth: [0.8, 1.0], radius: [3, 4] },
    water: { pond: 0, frontPond: 0, stream: 0, sea: 0 },
    trees: { density: 0.9, margin: 10, forest: 0.8 }, corridorFlat: 0.97, stimp: 10,
  },
  backdrop: { amp: 70, wave: 700, ridged: false, power: 1.5, canopy: [0.028, 0.065, 0.02] },
  wind: { min: 1, max: 8, gustiness: 0.2 },
});

const LINE_STEP = 4;
const targetGreen = (t) => {
  const z = -t.yards * YARD;
  return {
    x: t.x, z, ax: 0, az: -1, ra: t.r * 1.08, rc: t.r / 1.08, rot: 0,
    harmonics: [{ k: 3, a: 0.04, p: t.yards * 0.13 }], radius: t.r, raise: 0.35, tiltDir: 0, tilt: 0.008, tier: null,
    contourSeed: 1000 + t.yards, maxR: t.r * 1.3, yards: t.yards, color: t.color, name: t.name,
  };
};

export function generateRange(course = RANGE_COURSE) {
  const L = RANGE_YARDS * YARD;
  // A straight centerline sampled every LINE_STEP meters (the same form layout.resample gives).
  const line = [];
  for (let s = 0; s < L; s += LINE_STEP) line.push({ x: 0, z: -s, s });
  line.push({ x: 0, z: -L, s: L });
  const total = line[line.length - 1].s;
  const targets = TARGETS.map(targetGreen);
  const green = targets[targets.length - 1];
  const baseHalf = course.theme.fairwayHalf[0];
  const fwStart = 6, fwEnd = total - 6;
  const half = new Float32Array(line.length);
  for (let i = 0; i < line.length; i++) half[i] = line[i].s > fwStart && line[i].s < fwEnd ? baseHalf : 0;
  const roughBand = course.theme.roughBand[0];
  // One wide tee line holds the five bays; the mats sit on it.
  const tees = [{ name: 'bays', s: 0, x: 0, z: 0, w: BAY_COUNT * BAY_SPACING + 4, l: 9, tx: 0, tz: -1 }];
  const bays = BAY_X.map((x, i) => ({ index: i, x, matZ: MAT_Z, grassZ: GRASS_Z }));
  // A service track down the left side for the picker cart.
  const pathPts = [];
  for (let z = 30; z >= -L + 10; z -= 12) pathPts.push({ x: -(baseHalf + roughBand * 0.6), z });
  const path = { pts: pathPts, half: 1.4, side: -1 };
  // Two bunkers dress the far targets.
  const bunkers = [
    { kind: 'green', blobs: [{ x: targets[3].x + targets[3].r + 4.5, z: targets[3].z + 2, r: 3.4 }, { x: targets[3].x + targets[3].r + 6, z: targets[3].z - 2, r: 2.6 }], depth: 0.8, lip: 0.35, faceX: -1, faceZ: 0 },
    { kind: 'green', blobs: [{ x: targets[4].x - targets[4].r - 5, z: targets[4].z + 3, r: 3.8 }], depth: 0.85, lip: 0.35, faceX: 1, faceZ: 0 },
  ];
  const corridorExtra = roughBand + course.theme.deepBand * 0.6 + course.theme.trees.margin;
  const lateral = baseHalf + corridorExtra + 92;
  const bounds = { minX: Math.floor(-lateral), maxX: Math.ceil(lateral), minZ: Math.floor(-total - 150), maxZ: 112 };
  // No trees on the clubhouse lawn behind the bays.
  const clearings = [{ x: 0, z: 34, r: 46 }];
  return {
    courseId: course.id, index: 0, number: 1, par: 4, yards: RANGE_YARDS, length: total, range: true,
    bearing: 210, seed: 0x2f61a7,
    line, lineStep: LINE_STEP, half, baseHalf, roughBand, corridorExtra, fwStart, fwEnd, hasFairway: true,
    green, targets, pins: targets.map((t) => ({ x: t.x, z: t.z })), pinIndex: targets.length - 1,
    tees, teeHeading: 0, bays, signs: SIGN_YARDS.map((y) => ({ yards: y, z: -y * YARD })),
    bunkers, water: [], sea: null, path, markers: [], bounds, bends: [], dogSide: 1, tournament: false, clearings,
    mowing: 'stripes', greenMowing: 'stripes',
  };
}

// Where the ball sits for a bay and a surface ('mat' or 'grass').
export function bayBall(hole, bay = 2, surface = 'mat') {
  const b = hole.bays[Math.max(0, Math.min(hole.bays.length - 1, bay))];
  return { x: b.x, z: surface === 'grass' ? b.grassZ : b.matZ };
}

// The target green nearest a carry distance (meters), for the default aim.
export function targetFor(hole, carryM) {
  let best = hole.targets[0], bd = Infinity;
  for (const t of hole.targets) { const d = Math.abs(-t.z - carryM); if (d < bd) { bd = d; best = t; } }
  return best;
}
