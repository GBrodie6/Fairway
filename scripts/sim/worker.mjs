// Balance worker: plays the rounds it is given with the simulated golfer and posts the
// results. Terrain is built once per hole and kept.
import { parentPort, workerData } from 'node:worker_threads';
import { COURSES, courseById } from '../../src/course/courses.js';
import { getHole } from '../../src/course/layout.js';
import { buildTerrain } from '../../src/course/terrain.js';
import { createRng, hashString } from '../../src/core/rng.js';
import { createWind, rollWind } from '../../src/physics/wind.js';
import { playHoleGolfer } from '../../src/game/simGolfer.js';
import { autoBuild, golferProfile, golferStrike, newGolfer } from '../../src/game/campaign.js';

const terrains = new Map();
const terrainFor = (courseId, i) => {
  const k = `${courseId}:${i}`;
  if (!terrains.has(k)) terrains.set(k, buildTerrain(courseById(courseId), getHole(courseById(courseId), i)));
  return terrains.get(k);
};

function golferFor(cell) {
  if (cell.kind === 'arch') {
    const g = autoBuild(cell.archetype, cell.level);
    return { profile: golferProfile(g), perks: (kind) => golferStrike(g, kind), gearFor: () => ({ rarity: 'common' }), setting: 'standard' };
  }
  const g = newGolfer(null, 0);
  return { profile: golferProfile(g), perks: () => ({}), gearFor: () => ({ rarity: cell.tier || 'common' }), setting: cell.setting || 'standard', planBoost: cell.planBoost || 0 };
}

const out = [];
for (const task of workerData.tasks) {
  const cell = workerData.cells[task.cell];
  const golfer = golferFor(cell);
  const i = task.round;
  // The same course, nine, wind and random draws for round i in every cell (paired runs).
  const course = COURSES[i % COURSES.length];
  const nine = Math.floor(i / COURSES.length) % 2;
  const seed = (i * 7919 + 17) >>> 0;
  const rng = createRng(seed), strikeRng = createRng((seed ^ 0x9e3779b9) >>> 0);
  let strokes = 0, par = 0, putts = 0, penalties = 0, picked = 0;
  const strikes = {};
  for (let k = 0; k < 9; k++) {
    const hi = nine * 9 + k;
    const t = terrainFor(course.id, hi);
    const wind = createWind(rollWind(createRng((seed * 31 + hi * 977) >>> 0), course.wind));
    const windAt = (tt, hh, o) => wind.sample(tt, hh, o);
    const r = playHoleGolfer(t, { ...golfer, skill: cell.skill ?? 0.6, rng, strikeRng, windAt });
    strokes += r.strokes; par += course.pars[hi]; putts += r.putts; penalties += r.penalties; if (r.pickedUp) picked++;
    for (const [s, n] of Object.entries(r.strikes)) strikes[s] = (strikes[s] || 0) + n;
  }
  out.push({ cell: task.cell, round: i, course: course.id, strokes, par, toPar: strokes - par, putts, penalties, picked, strikes });
  if (out.length % 10 === 0) parentPort.postMessage({ progress: out.length });
}
parentPort.postMessage({ done: out });
void hashString;
