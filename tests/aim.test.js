import { describe, it, expect } from 'vitest';
import { aimAtTarget, aimPoint, dragToAimDelta, nudgeAim, clampAim, distanceBetween, missFromLine, playsLike } from '../src/physics/aim.js';
import { DEG, headingVec, headingTo, wrapAngle } from '../src/core/math.js';

describe('aim math', () => {
  it('heading 0 points down -Z and positive turns toward +X', () => {
    expect(headingVec(0)).toEqual({ x: 0, z: -1 });
    expect(headingVec(Math.PI / 2).x).toBeCloseTo(1, 10);
    expect(aimAtTarget({ x: 0, z: 0 }, { x: 0, z: -100 })).toBeCloseTo(0, 10);
    expect(aimAtTarget({ x: 0, z: 0 }, { x: 100, z: 0 })).toBeCloseTo(Math.PI / 2, 10);
    expect(aimAtTarget({ x: 0, z: 0 }, { x: -100, z: 0 })).toBeCloseTo(-Math.PI / 2, 10);
  });
  it('aimPoint and aimAtTarget are inverses', () => {
    for (const h of [-3, -1.2, 0, 0.4, 2.9]) {
      const p = aimPoint({ x: 5, z: -7 }, h, 150);
      expect(wrapAngle(aimAtTarget({ x: 5, z: -7 }, p) - h)).toBeCloseTo(0, 9);
      expect(distanceBetween({ x: 5, z: -7 }, p)).toBeCloseTo(150, 9);
    }
    expect(headingTo(0, 0, 0, -1)).toBeCloseTo(0, 10);
  });
  it('drag maps to heading with sensitivity and fine mode', () => {
    const full = dragToAimDelta(400, 400);
    expect(full).toBeCloseTo(70 * DEG, 10);
    expect(dragToAimDelta(400, 400, { sensitivity: 2 })).toBeCloseTo(full * 2, 10);
    expect(dragToAimDelta(400, 400, { fine: true })).toBeCloseTo(full / 5, 10);
    expect(dragToAimDelta(-200, 400)).toBeCloseTo(-full / 2, 10);
  });
  it('drag guards against bad viewport values', () => {
    expect(dragToAimDelta(NaN, 400)).toBe(0);
    expect(dragToAimDelta(10, 0)).toBe(0);
    expect(dragToAimDelta(10, NaN)).toBe(0);
    expect(dragToAimDelta(Infinity, 400)).toBe(0);
  });
  it('nudge steps by half a degree and wraps', () => {
    expect(nudgeAim(0, 1)).toBeCloseTo(0.5 * DEG, 10);
    expect(nudgeAim(0, -4)).toBeCloseTo(-2 * DEG, 10);
    expect(Math.abs(nudgeAim(Math.PI - 0.001, 5))).toBeLessThanOrEqual(Math.PI);
  });
  it('clampAim keeps the aim within a cone of the reference', () => {
    expect(clampAim(0.2, 0, 100)).toBeCloseTo(0.2, 10);
    expect(clampAim(3, 0, 100)).toBeCloseTo(100 * DEG, 10);
    expect(clampAim(-3, 0, 100)).toBeCloseTo(-100 * DEG, 10);
    expect(wrapAngle(clampAim(-3.0, 3.0, 30) - 3.0)).toBeCloseTo(-3.0 - 3.0 + 2 * Math.PI, 6);
  });
  it('missFromLine reports right and long as positive', () => {
    const m = missFromLine({ x: 0, z: 0 }, 0, { x: 0, z: -100 }, { x: 4, z: -110 });
    expect(m.lateral).toBeCloseTo(4, 10);
    expect(m.long).toBeCloseTo(10, 10);
    const n = missFromLine({ x: 0, z: 0 }, Math.PI / 2, { x: 100, z: 0 }, { x: 95, z: 3 });
    expect(n.long).toBeCloseTo(-5, 10);
    expect(n.lateral).toBeCloseTo(3, 10);
  });
  it('playsLike adds uphill and headwind, never negative', () => {
    expect(playsLike(150, 10)).toBeGreaterThan(150);
    expect(playsLike(150, -10)).toBeLessThan(150);
    expect(playsLike(150, 0, -5)).toBeGreaterThan(150);
    expect(playsLike(150, 0, 5)).toBeLessThan(150);
    expect(playsLike(1, -50)).toBe(0);
  });
});
