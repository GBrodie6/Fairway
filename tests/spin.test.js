// Ball contact control (src/game/spin.js, src/data/spinControl.js): neutral is the baseline,
// the curve follows the dot in direction and size, more backspin flies higher and rolls less,
// the caps hold (no carry beyond neutral, at most about 6 percent less), no NaN, and asking for
// shape raises the mishit chance a little through the strike model.
import { describe, it, expect } from 'vitest';
import { CLUBS } from '../src/physics/clubs.js';
import { computeLaunch, SHOT_TYPES, BASE_PROFILE, nominalCarry } from '../src/physics/shot.js';
import { simulateShot, flatEnv } from '../src/physics/ball.js';
import { SURFACES } from '../src/physics/surfaces.js';
import { applySpin, spinModifiers, clampOffset, carryGuard, SPIN_SIGN, SPIN_FX, padLabels, quickOffset, curveAndRoll, spinRange } from '../src/game/spin.js';
import { TIER_RANGE, BASE_RANGE, MAX_RANGE, PERK_RANGE_CAP, ARCHETYPE_RANGE, controlRange, archetypeRange } from '../src/data/spinControl.js';
import { strikeResult } from '../src/game/strike.js';
import { createRng } from '../src/core/rng.js';

const env = flatEnv();
const FULL = CLUBS.filter((c) => !c.putter);
const launchFor = (club) => computeLaunch({ power: 1, face: 0, path: 0, tempoQuality: 1 }, { club, shotType: SHOT_TYPES.FULL, lie: SURFACES.FAIRWAY, aim: 0, x: 0, z: 0, profile: BASE_PROFILE });
const fly = (club, o) => simulateShot(applySpin(launchFor(club), o, { club }), env);
const right = (r) => r.carryPoint.x; // heading 0 flies toward -z, so +x is the golfer's right

describe('ball contact: neutral and direction', () => {
  it('neutral returns the launch untouched and reproduces the carry ladder exactly', () => {
    for (const club of FULL) {
      const L = launchFor(club);
      expect(applySpin(L, { x: 0, y: 0 }, { club })).toBe(L);
      expect(applySpin(L, null, { club })).toBe(L);
      expect(fly(club, { x: 0, y: 0 }).carry).toBe(nominalCarry(club));
    }
  });
  it('SPIN_SIGN: a positive spin axis tilt curves the ball right in the real simulation', () => {
    expect(SPIN_SIGN).toBe(1);
    const L = launchFor(CLUBS.find((c) => c.id === 'I7'));
    const r = simulateShot({ ...L, axisTilt: 0.2 }, env);
    expect(right(r)).toBeGreaterThan(2);
    expect(spinModifiers({ x: 1, y: 0 }).tilt).toBeGreaterThan(0);
  });
  it('the curve is monotonic in the dot and its sign follows it', () => {
    for (const id of ['DR', 'I5', 'I7', 'PW']) {
      const club = CLUBS.find((c) => c.id === id);
      let prev = -Infinity;
      for (let x = -1; x <= 1.0001; x += 0.25) {
        const c = right(fly(club, { x, y: 0 }));
        expect(c).toBeGreaterThan(prev);
        if (Math.abs(x) > 0.1) expect(Math.sign(c)).toBe(Math.sign(x));
        prev = c;
      }
      // Draws and fades are mirror images.
      expect(right(fly(club, { x: 0.8, y: 0 }))).toBeCloseTo(-right(fly(club, { x: -0.8, y: 0 })), 3);
    }
    // A full draw with the driver bends a useful but bounded amount (meters).
    const dr = Math.abs(curveAndRoll(fly(CLUBS[0], { x: -1, y: 0 }), { x: 0, z: 0 }, 0).curve);
    expect(dr).toBeGreaterThan(8); expect(dr).toBeLessThan(40);
  });
  it('more backspin flies higher and rolls less; less spin flies lower and rolls more', () => {
    for (const id of ['I7', 'PW', 'W3']) {
      const club = CLUBS.find((c) => c.id === id);
      const roll = (y) => { const r = fly(club, { x: 0, y }); return r.total - r.carry; };
      const apex = (y) => fly(club, { x: 0, y }).apex;
      expect(roll(1)).toBeLessThan(roll(0.5)); expect(roll(0.5)).toBeLessThan(roll(0));
      expect(roll(-1)).toBeGreaterThan(roll(0));
      expect(apex(1)).toBeGreaterThan(apex(0)); expect(apex(-1)).toBeLessThan(apex(0));
    }
  });
});

describe('ball contact: caps', () => {
  it('never carries past neutral and costs at most about 6 percent at the edge', () => {
    for (const club of FULL) {
      const n = nominalCarry(club);
      for (let x = -1; x <= 1.0001; x += 0.5) for (let y = -1; y <= 1.0001; y += 0.5) {
        const o = clampOffset({ x, y }, 1);
        const c = fly(club, o).carry;
        expect(c).toBeLessThanOrEqual(n + 1e-6);
        expect(c).toBeGreaterThanOrEqual(n * (1 - SPIN_FX.carryCost) - 1.5);
      }
    }
    expect(carryGuard(CLUBS[0], SHOT_TYPES.FULL, { x: 0, y: 0 })).toBe(1);
  });
  it('the range grows with the tier and perks, inside the documented caps', () => {
    let prev = 0;
    for (const t of ['common', 'uncommon', 'rare', 'epic', 'legendary']) { const r = controlRange(t); expect(r).toBeGreaterThan(prev); expect(r).toBeLessThanOrEqual(MAX_RANGE); prev = r; }
    expect(controlRange('common')).toBe(BASE_RANGE);
    expect(controlRange('legendary', 1)).toBeLessThanOrEqual(MAX_RANGE);
    expect(controlRange('common', 5)).toBeCloseTo(BASE_RANGE * (1 + PERK_RANGE_CAP), 9);
    for (const v of Object.values(ARCHETYPE_RANGE)) expect(v).toBeLessThanOrEqual(PERK_RANGE_CAP);
    expect(archetypeRange('nope')).toBe(0);
    expect(spinRange('rare', 0.1)).toBeCloseTo(BASE_RANGE * TIER_RANGE.rare * 1.1, 9);
    // The dot stays inside the range.
    const c = clampOffset({ x: 1, y: 1 }, 0.5);
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(0.5, 9);
    expect(clampOffset({ x: 0.1, y: -0.2 }, 0.5)).toEqual({ x: 0.1, y: -0.2 });
  });
  it('no NaN from junk, and putts are never shaped', () => {
    const club = CLUBS.find((c) => c.id === 'I7');
    for (const o of [{ x: NaN, y: 1 }, { x: Infinity, y: -Infinity }, { x: 'a', y: null }, {}, { x: 9, y: 9 }]) {
      const L = applySpin(launchFor(club), o, { club });
      for (const k of ['speed', 'vAngle', 'heading', 'spin', 'axisTilt']) expect(Number.isFinite(L[k])).toBe(true);
      const m = spinModifiers(o);
      for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
    }
    const putt = { putt: true, speed: 2, heading: 0, vAngle: 0, spin: 0, axisTilt: 0 };
    expect(applySpin(putt, { x: 1, y: 1 }, {})).toBe(putt);
  });
  it('asking for shape raises the mishit chance a little; neutral changes nothing', () => {
    const swing = { power: 0.9, face: 1.5, path: 1, tempoQuality: 0.8, tempoRatio: 3.3, tempoGrade: 'good', downMs: 250 };
    const rate = (shapeError) => { const rng = createRng(4); let m = 0; for (let i = 0; i < 4000; i++) { const s = strikeResult(swing, { clubId: 'I7', shapeError }, rng); if (s.kind !== 'pured' && s.kind !== 'good') m++; } return m / 4000; };
    const a = rate(0), b = rate(SPIN_FX.mishit);
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeLessThan(0.15);
    const r1 = createRng(9), r2 = createRng(9);
    expect(strikeResult(swing, { clubId: 'I7' }, r1)).toEqual(strikeResult(swing, { clubId: 'I7', shapeError: 0 }, r2));
  });
  it('labels and quick buttons follow the golfer\'s hand', () => {
    expect(padLabels(false)).toEqual({ left: 'Draw', right: 'Fade', up: 'More backspin', down: 'Topspin' });
    expect(padLabels(true).left).toBe('Fade');
    expect(quickOffset('draw', 1, false).x).toBeLessThan(0);
    expect(quickOffset('draw', 1, true).x).toBeGreaterThan(0);
    expect(quickOffset('straight', 1)).toEqual({ x: 0, y: 0 });
  });
});
