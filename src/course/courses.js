// Course registry. The first five courses' names are invented for this game; the two real
// courses take their names from course/realCourses.js. Each theme drives the layout generator,
// the terrain shaper, the vegetation mix, the backdrop, and the wind profile.
// par sequences each total 72 over 18 holes.
import { RANGE_COURSE } from './range.js';
import { AUGUSTA, ST_ANDREWS } from './realCourses.js';

export const COURSES = Object.freeze([
  {
    id: 'parkland', name: 'Alderwick Park', flagship: true, seed: 0x51a7,
    blurb: 'Tree-lined fairways, quiet ponds, and big rolling greens.',
    pars: [4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4],
theme: {
      base: 'rough', seaLevel: null, baseElevation: 40,
      macroAmp: 5.5, macroWave: 260, undulation: 0.55, undulationWave: 38, dunes: 0, mesa: 0, slopeAlong: 6,
      roughBand: [11, 17], deepBand: 16, fairwayHalf: [15, 21], greenRadius: [11.5, 15.5],
      bunkers: { green: [1, 3], fairway: [0, 2], pot: false, depth: [0.95, 1.45], radius: [3.4, 5.6] },
      water: { pond: 0.36, frontPond: 0.5, stream: 0.14, sea: 0 },
      trees: { density: 1.0, margin: 6, forest: 1.0 }, corridorFlat: 0.82, stimp: 10.5,
    },
    backdrop: { amp: 85, wave: 700, ridged: false, power: 1.5, canopy: [0.028, 0.065, 0.02] },
    wind: { min: 2, max: 11, gustiness: 0.25 },
  },
  {
    id: 'links', name: 'Saltmarrow Links', flagship: true, seed: 0x7c31,
    blurb: 'Dunes, pot bunkers, firm turf, and the sea wind.',
    pars: [4, 4, 3, 5, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4],
theme: {
      base: 'rough', seaLevel: 0, baseElevation: 7,
      macroAmp: 2.6, macroWave: 210, undulation: 1.15, undulationWave: 30, dunes: 4.2, mesa: 0, slopeAlong: 3,
      roughBand: [7, 11], deepBand: 9, fairwayHalf: [16, 24], greenRadius: [12.5, 17],
      bunkers: { green: [2, 4], fairway: [1, 3], pot: true, depth: [1.35, 2.0], radius: [2.3, 3.4] },
      water: { pond: 0.05, frontPond: 0.1, stream: 0.22, sea: 0.62 },
      trees: { density: 0.04, margin: 14, forest: 0.0 }, corridorFlat: 0.6, stimp: 9.5,
    },
    backdrop: { amp: 50, wave: 620, ridged: false, power: 1.7, canopy: [0.07, 0.085, 0.035] },
    wind: { min: 8, max: 24, gustiness: 0.55 },
  },
  {
    id: 'desert', name: 'Cinder Mesa', flagship: true, seed: 0x2e95,
    blurb: 'Green ribbons through red rock and open desert.',
    pars: [4, 3, 5, 4, 4, 3, 4, 5, 4, 5, 4, 3, 4, 4, 5, 3, 4, 4],
theme: {
      base: 'waste', seaLevel: null, baseElevation: 420,
      macroAmp: 5.0, macroWave: 300, undulation: 0.5, undulationWave: 42, dunes: 0, mesa: 26, slopeAlong: 8,
      roughBand: [5, 8], deepBand: 0, fairwayHalf: [15, 22], greenRadius: [12, 16],
      bunkers: { green: [1, 3], fairway: [0, 2], pot: false, depth: [0.9, 1.4], radius: [3.6, 6.2] },
      water: { pond: 0.2, frontPond: 0.3, stream: 0, sea: 0 },
      trees: { density: 0.16, margin: 4, forest: 0.0 }, corridorFlat: 0.85, stimp: 11,
    },
    backdrop: { amp: 300, wave: 760, ridged: true, power: 2.8, canopy: [0.12, 0.09, 0.05] },
    wind: { min: 3, max: 15, gustiness: 0.35 },
  },
  {
    id: 'alpine', name: 'Larchfall Summit', flagship: false, seed: 0x9b44,
    blurb: 'Big elevation changes among conifers and snow peaks.',
    pars: [4, 4, 5, 3, 4, 3, 5, 4, 4, 4, 5, 3, 4, 4, 3, 5, 4, 4],
theme: {
      base: 'rough', seaLevel: null, baseElevation: 1450,
      macroAmp: 12, macroWave: 320, undulation: 0.7, undulationWave: 40, dunes: 0, mesa: 0, slopeAlong: 22,
      roughBand: [9, 14], deepBand: 12, fairwayHalf: [14, 19], greenRadius: [11, 14.5],
      bunkers: { green: [1, 3], fairway: [0, 2], pot: false, depth: [0.95, 1.4], radius: [3.2, 5.2] },
      water: { pond: 0.28, frontPond: 0.35, stream: 0.2, sea: 0 },
      trees: { density: 1.15, margin: 5, forest: 1.2 }, corridorFlat: 0.78, stimp: 10.5,
    },
    backdrop: { amp: 950, wave: 1150, ridged: true, power: 1.9, snowLine: 330, canopy: [0.02, 0.05, 0.025] },
    wind: { min: 3, max: 16, gustiness: 0.45 },
  },
  {
    id: 'tropical', name: 'Coralline Bay', flagship: false, seed: 0x3d18,
    blurb: 'Palms, white sand, and lagoons beside a warm sea.',
    pars: [5, 4, 3, 4, 4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4],
theme: {
      base: 'rough', seaLevel: 0, baseElevation: 5,
      macroAmp: 2.8, macroWave: 240, undulation: 0.45, undulationWave: 40, dunes: 1.2, mesa: 0, slopeAlong: 3,
      roughBand: [9, 14], deepBand: 12, fairwayHalf: [16, 22], greenRadius: [12, 16],
      bunkers: { green: [2, 4], fairway: [1, 2], pot: false, depth: [0.8, 1.25], radius: [4.2, 7.0] },
      water: { pond: 0.4, frontPond: 0.55, stream: 0.05, sea: 0.5 },
      trees: { density: 0.55, margin: 8, forest: 0.5 }, corridorFlat: 0.85, stimp: 10,
    },
    backdrop: { amp: 340, wave: 800, ridged: true, power: 2.1, canopy: [0.02, 0.08, 0.02] },
    wind: { min: 4, max: 17, gustiness: 0.4 },
  },
  // Two real courses as procedural approximations (course/realCourses.js).
  AUGUSTA,
  ST_ANDREWS,
]);

export const COURSE_IDS = COURSES.map((c) => c.id);
// The practice ground (course/range.js) is found by id but is not one of the playable courses.
export const courseById = (id) => (id === RANGE_COURSE.id ? RANGE_COURSE : COURSES.find((c) => c.id === id) || COURSES[0]);
export const coursePar = (c) => c.pars.reduce((a, b) => a + b, 0);
