import { describe, it, expect } from 'vitest';
import { createWind, heightFactor, windRelative, rollWind } from '../src/physics/wind.js';
import { createRng } from '../src/core/rng.js';
import { MPH } from '../src/core/math.js';

describe('wind', () => {
  it('calm wind is exactly zero', () => {
    const w = createWind({ speedMph: 0 });
    const o = w.sample(3, 20, {});
    expect(o.x).toBeCloseTo(0, 10);
    expect(o.z).toBeCloseTo(0, 10);
  });
  it('direction follows the heading convention', () => {
    const w = createWind({ speedMph: 10, dir: Math.PI / 2, gustiness: 0 });
    const o = w.sample(0, 10, {});
    expect(o.x).toBeCloseTo(10 * MPH, 5);
    expect(o.z).toBeCloseTo(0, 5);
    const n = createWind({ speedMph: 10, dir: 0, gustiness: 0 }).sample(0, 10, {});
    expect(n.z).toBeCloseTo(-10 * MPH, 5);
  });
  it('gusts stay within 45 percent of base at full gustiness and vary over time', () => {
    const w = createWind({ speedMph: 12, dir: 0, gustiness: 1, seed: 5 });
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 600; t += 0.5) {
      const s = w.speedAt(t);
      lo = Math.min(lo, s); hi = Math.max(hi, s);
      expect(s).toBeGreaterThanOrEqual(w.base * 0.55 - 1e-9);
      expect(s).toBeLessThanOrEqual(w.base * 1.45 + 1e-9);
    }
    expect(hi - lo).toBeGreaterThan(w.base * 0.4);
  });
  it('zero gustiness is perfectly steady', () => {
    const w = createWind({ speedMph: 9, dir: 1, gustiness: 0 });
    expect(w.speedAt(0)).toBe(w.speedAt(123.4));
    expect(w.dirAt(0)).toBe(w.dirAt(55));
  });
  it('is deterministic per seed and differs across seeds', () => {
    const a = createWind({ speedMph: 10, gustiness: 1, seed: 3 });
    const b = createWind({ speedMph: 10, gustiness: 1, seed: 3 });
    const c = createWind({ speedMph: 10, gustiness: 1, seed: 4 });
    expect(a.speedAt(17)).toBe(b.speedAt(17));
    expect(a.speedAt(17)).not.toBe(c.speedAt(17));
  });
  it('wind grows with height and is 1 at the 10 m reference', () => {
    expect(heightFactor(10)).toBeCloseTo(1, 6);
    expect(heightFactor(1)).toBeLessThan(heightFactor(10));
    expect(heightFactor(30)).toBeGreaterThan(1.1);
    expect(heightFactor(-5)).toBeGreaterThan(0.3);
    expect(heightFactor(1e6)).toBeLessThanOrEqual(1.45);
  });
  it('windRelative splits into tail and cross components', () => {
    const w = createWind({ speedMph: 10, dir: 0, gustiness: 0 });
    const tail = windRelative(w, 0);
    expect(tail.along).toBeCloseTo(10 * MPH, 5);
    expect(tail.cross).toBeCloseTo(0, 5);
    const head = windRelative(w, Math.PI);
    expect(head.along).toBeCloseTo(-10 * MPH, 5);
    const cross = windRelative(createWind({ speedMph: 10, dir: Math.PI / 2, gustiness: 0 }), 0);
    expect(cross.cross).toBeCloseTo(10 * MPH, 5);
  });
  it('rollWind respects the course profile', () => {
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      const w = rollWind(rng, { min: 6, max: 22, prevailing: 1, spread: 0.6, gustiness: 0.5 });
      expect(w.speedMph).toBeGreaterThanOrEqual(6);
      expect(w.speedMph).toBeLessThanOrEqual(22);
      expect(Math.abs(w.dir - 1)).toBeLessThanOrEqual(0.3 + 1e-9);
    }
  });
  it('never returns non-finite values', () => {
    const w = createWind({ speedMph: 30, dir: 2, gustiness: 1, seed: 8 });
    for (const t of [0, 1e3, 1e6, -5]) for (const h of [-10, 0, 5, 500]) {
      const o = w.sample(t, h, {});
      expect(Number.isFinite(o.x) && Number.isFinite(o.z)).toBe(true);
    }
  });
});
