import { describe, it, expect } from 'vitest';
import { playHoleGolfer } from '../src/game/simGolfer.js';
import { buildTerrain } from '../src/course/terrain.js';
import { getHole } from '../src/course/layout.js';
import { courseById } from '../src/course/courses.js';
import { createRng } from '../src/core/rng.js';
import { BASE_PROFILE } from '../src/physics/shot.js';

describe('the balance runs\' simulated golfer', () => {
  it('finishes holes with sane scores through the real strike and flight path, deterministically', () => {
    const course = courseById('parkland');
    const t = buildTerrain(course, getHole(course, 2));
    const play = (seed, rarity = 'common') => playHoleGolfer(t, { profile: BASE_PROFILE, gearFor: () => ({ rarity }), rng: createRng(seed), strikeRng: createRng(seed + 1) });
    const a = play(5), b = play(5);
    expect(a).toEqual(b);
    const scores = [1, 2, 3, 4, 5, 6].map((s) => play(s));
    for (const r of scores) {
      expect(Number.isFinite(r.strokes)).toBe(true);
      expect(r.strokes).toBeGreaterThanOrEqual(2);
      expect(r.strokes).toBeLessThanOrEqual(course.pars[2] + 5);
      expect(Object.values(r.strikes).reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
    }
    expect(play(9, 'legendary').strikes).toBeTruthy();
  });
});
