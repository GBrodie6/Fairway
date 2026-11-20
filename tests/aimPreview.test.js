// The aim preview (the landing marker, the aim fan's landing, the hole map's line) and the power
// guide fly in still air: in wind the player judges the difference. The shot itself still flies
// in the real wind.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COURSES } from '../src/course/courses.js';
import { getHole } from '../src/course/layout.js';
import { buildTerrain } from '../src/course/terrain.js';
import { predictShot } from '../src/game/planner.js';
import { CLUB_BY_ID } from '../src/physics/clubs.js';
import { SURFACES } from '../src/physics/surfaces.js';

describe('aim preview without wind', () => {
  const src = readFileSync(new URL('../src/game/controller.js', import.meta.url), 'utf8');
  it('the preview and the power guide are solved with no wind, and the shot with the real wind', () => {
    expect(src).toMatch(/const r = predictShot\(t, \{[^}]*\}, null, state\.clock\);/);
    expect(src).toMatch(/state\.idealPower = solvePower\(W\(\)\.terrain, \{[^}]*\}, null, state\.clock, state\.target, 'end'\);/);
    expect(src).not.toMatch(/guideWind/);
    expect(src).toMatch(/result = simulateShot\(launch, t\.env\(\{ windAt: tierWind\(windAt,/);
  });

  it('no wind means still air: the same landing as a calm day, not the windy one', () => {
    const course = COURSES[0], t = buildTerrain(course, getHole(course, 0));
    const aim = Math.atan2(t.hole.green.x - t.tee.x, -(t.hole.green.z - t.tee.z));
    const shot = { x: t.tee.x, z: t.tee.z, lie: SURFACES.TEE, club: CLUB_BY_ID.DR, aim, power: 1 };
    const calm = predictShot(t, shot, (tt, h, out) => { out.x = 0; out.y = 0; out.z = 0; return out; }, 0);
    const none = predictShot(t, shot, null, 0);
    const windy = predictShot(t, shot, (tt, h, out) => { out.x = 9; out.y = 0; out.z = 0; return out; }, 0);
    const land = (r) => r.carryPoint || r.end;
    expect(Math.hypot(land(none).x - land(calm).x, land(none).z - land(calm).z)).toBeLessThan(0.01);
    expect(Math.hypot(land(windy).x - land(none).x, land(windy).z - land(none).z)).toBeGreaterThan(5);
  });
});
