// The club's on-screen motion (src/game/swingMotion.js): visual only. The spring smooths touch
// sampling without overshoot, gets the club to the ball by the crossing, the settle stays
// tiny, the hit-stop holds the club 50 to 70 ms (none with reduced motion), and the finish
// decelerates. The swing result never passes through this module.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { springStep, createSwingSmoother, followThrough, easeDown, easeOut, trailTint, SWING_MOTION, TRAIL_FADE_SEC } from '../src/game/swingMotion.js';

describe('swing motion', () => {
  it('the spring is critically damped: it converges without overshoot for any frame time', () => {
    for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.1]) {
      let s = { x: 0, v: 0 };
      let maxX = 0;
      for (let t = 0; t < 1; t += dt) { s = springStep(s.x, s.v, 1, SWING_MOTION.omega, dt); maxX = Math.max(maxX, s.x); }
      expect(maxX).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(s.x - 1)).toBeLessThan(1e-3);
    }
  });
  it('smooths a wobbly drag: the drawn depth wobbles far less than the raw samples', () => {
    const sm = createSwingSmoother();
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const raw = [], drawn = [];
    for (let i = 1; i <= 60; i++) {
      const r = Math.min(1, i / 54) + (rnd() - 0.5) * 0.03; // a finger with a pixel or two of wobble
      raw.push(r); drawn.push(sm.step({ phase: 'back', depth: r, top: r }, 1 / 60).depth);
    }
    // Wobble: the summed size of the second differences after the first few frames.
    const wob = (a) => a.slice(8, 52).reduce((t, x, i, b) => (i < 2 ? t : t + Math.abs(x - 2 * b[i - 1] + b[i - 2])), 0);
    expect(wob(drawn)).toBeLessThan(wob(raw) * 0.4);
  });
  it('reaches the ball by the crossing: in the last 10 percent the lag is at most half the remaining depth', () => {
    const sm = createSwingSmoother();
    for (let i = 0; i < 40; i++) sm.step({ phase: 'back', depth: Math.min(1, i / 30), top: Math.min(1, i / 30) }, 1 / 60);
    // A fast downswing: from the top to the line in 12 frames (200 ms).
    let out;
    for (let i = 1; i <= 12; i++) {
      const raw = Math.max(1 - i / 12, 0.001);
      out = sm.step({ phase: 'down', depth: raw, top: 1 }, 1 / 60);
      if (raw < SWING_MOTION.stiffFrom) expect(out.depth).toBeLessThanOrEqual(raw * (1 + SWING_MOTION.maxLagShare) + 1e-6);
    }
    expect(out.depth).toBeLessThan(0.002);
  });
  it('the settle at the top is small, happens once per rest, and fades', () => {
    const sm = createSwingSmoother();
    let peak = 0;
    for (let i = 0; i < 30; i++) sm.step({ phase: 'back', depth: Math.min(1, i / 25), top: Math.min(1, i / 25) }, 1 / 60);
    for (let i = 0; i < 40; i++) { const o = sm.step({ phase: 'back', depth: 1, top: 1 }, 1 / 60); peak = Math.max(peak, Math.abs(o.settle)); }
    expect(peak).toBeGreaterThan(0.002);
    expect(peak).toBeLessThanOrEqual(SWING_MOTION.settle + 1e-9);
    let last;
    for (let i = 0; i < 60; i++) last = sm.step({ phase: 'back', depth: 1, top: 1 }, 1 / 60);
    expect(Math.abs(last.settle)).toBeLessThan(0.001); // a still hold while the finger rests
  });
  it('hit-stop 50 to 70 ms on the club, none with reduced motion; the finish decelerates and fades', () => {
    expect(SWING_MOTION.hitStopMs).toBeGreaterThanOrEqual(50); expect(SWING_MOTION.hitStopMs).toBeLessThanOrEqual(70);
    expect(followThrough(0.05).p).toBe(1);
    expect(followThrough(0.05, { reduced: true }).p).toBeGreaterThan(1);
    const a = followThrough(0.1).p - followThrough(0.08).p, b = followThrough(0.5).p - followThrough(0.48).p;
    expect(a).toBeGreaterThan(b); // decelerates
    expect(followThrough(2).fade).toBe(1);
    expect(followThrough(0.3).fade).toBe(0);
  });
  it('the eases are monotonic and end where they start and stop', () => {
    expect(easeDown(0)).toBe(0); expect(easeDown(1)).toBeCloseTo(1, 12); expect(easeOut(1)).toBe(1);
    let prev = -1;
    for (let u = 0; u <= 1.0001; u += 0.01) { const e = easeDown(u); expect(e).toBeGreaterThanOrEqual(prev); prev = e; }
    expect(easeDown(0.3)).toBeLessThan(0.3); // starts gently and accelerates
  });
  it('trail tints by strike, and the trail is one mesh over a fixed ring buffer', () => {
    expect(trailTint('pured')).toEqual([1, 1, 1]);
    expect(trailTint('good')[2]).toBeLessThan(0.5);
    expect(trailTint('shank')[1]).toBeLessThan(0.5);
    expect(TRAIL_FADE_SEC).toBeCloseTo(0.3, 6);
    const src = readFileSync('src/render/clubView.js', 'utf8');
    expect(src).toMatch(/const ring = \{ x: new Float32Array\(TRAIL\)/);
    expect(src).not.toMatch(/hist\.unshift|\.push\(\{ x: pose/);
  });
  it('is visual only: the gesture and launch code do not import it', () => {
    for (const f of ['src/game/swingGesture.js', 'src/physics/shot.js', 'src/game/controller.js', 'src/game/strike.js']) expect(readFileSync(f, 'utf8')).not.toMatch(/swingMotion/);
  });
});
