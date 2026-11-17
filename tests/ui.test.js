import { describe, it, expect } from 'vitest';
import { fmtDist, fmtShort, fmtElev, fmtBreak, fmtToPar, ordinal, fmtMph, distValue } from '../src/ui/format.js';
import { makeFrame } from '../src/ui/map.js';
import { YARD } from '../src/core/math.js';

describe('display formatting', () => {
  it('formats long distances in yards or meters', () => {
    expect(fmtDist(150 * YARD)).toBe('150 yd');
    expect(fmtDist(150, 'meters')).toBe('150 m');
    expect(fmtDist(NaN)).toBe('--');
    expect(distValue(91.44)).toBe(100);
  });
  it('formats short distances in feet with a decimal under 10 ft', () => {
    expect(fmtShort(0.3048 * 6.4)).toBe('6.4 ft');
    expect(fmtShort(0.3048 * 24)).toBe('24 ft');
    expect(fmtShort(2.25, 'meters')).toBe('2.3 m');
    expect(fmtShort(Infinity)).toBe('--');
  });
  it('formats elevation, break, score, and wind', () => {
    expect(fmtElev(0.1)).toBe('level');
    expect(fmtElev(3.05)).toBe('up 10 ft');
    expect(fmtElev(-2, 'meters')).toBe('down 2.0 m');
    expect(fmtBreak(0.0762)).toBe('3 in right');
    expect(fmtBreak(-0.01)).toBe('straight');
    expect(fmtBreak(-0.9)).toBe('3.0 ft left');
    expect(fmtBreak(0.25, 'meters')).toBe('25 cm right');
    expect(fmtToPar(0)).toBe('E');
    expect(fmtToPar(3)).toBe('+3');
    expect(fmtToPar(-2)).toBe('-2');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
    expect(fmtMph(10)).toBe('10 mph');
    expect(fmtMph(10, 'meters')).toBe('4 m/s');
  });
});

describe('hole map transform', () => {
  it('puts the heading straight up and round-trips points', () => {
    for (const heading of [0, 0.7, -2.1, Math.PI]) {
      const f = makeFrame(100, -50, heading, 2, 400, 800);
      // A point 30 m along the heading from the center is straight above the center.
      const p = f.toMap(100 + Math.sin(heading) * 30, -50 - Math.cos(heading) * 30);
      expect(p.u).toBeCloseTo(200, 6);
      expect(p.v).toBeCloseTo(400 - 60, 6);
      // A point to the right of the heading is to the right on the map.
      const r = f.toMap(100 + Math.cos(heading) * 10, -50 + Math.sin(heading) * 10);
      expect(r.u).toBeCloseTo(220, 6);
      const w = f.toWorld(123, 456);
      const back = f.toMap(w.x, w.z);
      expect(back.u).toBeCloseTo(123, 6);
      expect(back.v).toBeCloseTo(456, 6);
    }
  });
});
