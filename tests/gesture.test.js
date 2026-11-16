import { describe, it, expect } from 'vitest';
import { createSwingGesture, createMeterSwing, gradeTempo, PHASE, SWING_DEFAULTS } from '../src/game/swingGesture.js';

// Drive a gesture: straight down to depthPx over backMs, then up through the start over downMs.
function swing(g, { depthPx = 170, backMs = 750, downMs = 250, topDx = 0, impactDx = 0, x0 = 100, y0 = 100, steps = 30, t0 = 1000 } = {}) {
  g.down(x0, y0, t0);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    g.move(x0 + topDx * f, y0 + depthPx * f, t0 + backMs * f);
  }
  const over = 12;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const y = y0 + depthPx - (depthPx + over) * f;
    const x = x0 + topDx + (impactDx - topDx) * ((depthPx + over) * f / depthPx);
    g.move(x, y, t0 + backMs + (downMs * (depthPx + over) / depthPx) * f);
    if (g.state.phase === PHASE.DONE) break;
  }
  return g.state;
}

describe('swing stick gesture', () => {
  it('starts idle, becomes ready on touch, backswing after the deadzone', () => {
    const g = createSwingGesture();
    expect(g.state.phase).toBe(PHASE.IDLE);
    g.down(50, 50, 0);
    expect(g.state.phase).toBe(PHASE.READY);
    g.move(50, 50 + SWING_DEFAULTS.deadzone - 1, 10);
    expect(g.state.phase).toBe(PHASE.READY);
    g.move(50, 50 + SWING_DEFAULTS.deadzone + 5, 20);
    expect(g.state.phase).toBe(PHASE.BACK);
  });
  it('a full straight swing at 3 to 1 is perfect, full power, square', () => {
    const st = swing(createSwingGesture());
    expect(st.phase).toBe(PHASE.DONE);
    expect(st.result.power).toBeCloseTo(1, 2);
    expect(st.result.tempoGrade).toBe('perfect');
    expect(st.result.tempoRatio).toBeGreaterThan(2.7);
    expect(st.result.tempoRatio).toBeLessThan(3.3);
    expect(st.result.face).toBe(0);
    expect(Math.abs(st.result.path)).toBeLessThan(0.01);
    expect(st.result.tempoQuality).toBeCloseTo(1, 5);
  });
  it('power comes from backswing depth', () => {
    for (const frac of [0.25, 0.5, 0.75, 1]) {
      const st = swing(createSwingGesture(), { depthPx: 170 * frac });
      expect(st.result.power).toBeCloseTo(frac, 2);
    }
    expect(swing(createSwingGesture(), { depthPx: 400 }).result.power).toBe(1);
  });
  it('tempo grading: rushed when the downswing is too quick, slow when it drags', () => {
    expect(swing(createSwingGesture(), { backMs: 900, downMs: 120 }).result.tempoGrade).toBe('rushed');
    expect(swing(createSwingGesture(), { backMs: 500, downMs: 500 }).result.tempoGrade).toBe('slow');
    expect(swing(createSwingGesture(), { backMs: 780, downMs: 215 }).result.tempoGrade).toBe('good');
    const q = swing(createSwingGesture(), { backMs: 500, downMs: 500 }).result.tempoQuality;
    expect(q).toBeLessThan(0.3);
  });
  it('gradeTempo is symmetric in log space and bounded', () => {
    expect(gradeTempo(3).quality).toBe(1);
    expect(gradeTempo(6).quality).toBeCloseTo(gradeTempo(1.5).quality, 10);
    expect(gradeTempo(6).quality).toBe(0);
    expect(gradeTempo(NaN).grade).toBe('miss');
    expect(gradeTempo(0).quality).toBe(0);
    for (let r = 0.2; r < 20; r *= 1.1) {
      const g = gradeTempo(r);
      expect(g.quality).toBeGreaterThanOrEqual(0);
      expect(g.quality).toBeLessThanOrEqual(1);
    }
  });
  it('impact right of the start opens the face, left closes it, with a deadzone', () => {
    const open = swing(createSwingGesture(), { impactDx: 30 }).result;
    const closed = swing(createSwingGesture(), { impactDx: -30 }).result;
    expect(open.face).toBeGreaterThan(1);
    expect(closed.face).toBeCloseTo(-open.face, 5);
    expect(swing(createSwingGesture(), { impactDx: 3 }).result.face).toBe(0);
    expect(Math.abs(swing(createSwingGesture(), { impactDx: 900 }).result.face)).toBe(SWING_DEFAULTS.maxFace);
  });
  it('path follows the direction of the downswing line', () => {
    // Back to the right, down through the start point: the thumb travels right to left.
    const outIn = swing(createSwingGesture(), { topDx: 40, impactDx: 0 }).result;
    expect(outIn.path).toBeLessThan(-1);
    expect(outIn.face).toBe(0);
    const inOut = swing(createSwingGesture(), { topDx: -40, impactDx: 0 }).result;
    expect(inOut.path).toBeCloseTo(-outIn.path, 5);
    expect(Math.abs(swing(createSwingGesture(), { topDx: -5000 }).result.path)).toBeLessThanOrEqual(SWING_DEFAULTS.maxPath);
  });
  it('left-handed play mirrors face and path', () => {
    const r = swing(createSwingGesture(), { impactDx: 30, topDx: 10 }).result;
    const l = swing(createSwingGesture({ handedness: 'left' }), { impactDx: 30, topDx: 10 }).result;
    expect(l.face).toBeCloseTo(-r.face, 10);
    expect(l.path).toBeCloseTo(-r.path, 10);
    expect(l.power).toBe(r.power);
  });
  it('the travel setting scales the gesture for thumb reach', () => {
    const st = swing(createSwingGesture({ travel: 100 }), { depthPx: 50 });
    expect(st.result.power).toBeCloseTo(0.5, 2);
  });
  it('releasing during the backswing cancels with no shot', () => {
    const g = createSwingGesture();
    g.down(0, 0, 0); g.move(0, 80, 300);
    g.up(0, 80, 320);
    expect(g.state.phase).toBe(PHASE.CANCELLED);
    expect(g.state.result).toBe(null);
  });
  it('a tiny backswing is ignored', () => {
    const g = createSwingGesture();
    g.down(0, 0, 0); g.move(0, 9, 100); g.move(0, 0, 200); g.move(0, -20, 220);
    expect(g.state.result).toBe(null);
    expect(g.state.phase).toBe(PHASE.CANCELLED);
  });
  it('lifting the thumb mid downswing completes the swing at the same pace', () => {
    const g = createSwingGesture();
    g.down(0, 0, 0);
    for (let i = 1; i <= 20; i++) g.move(0, 170 * i / 20, 750 * i / 20);
    g.move(0, 120, 750 + 74); g.move(0, 60, 750 + 162);
    g.up(0, 60, 750 + 162);
    expect(g.state.phase).toBe(PHASE.DONE);
    expect(g.state.result.auto).toBe(true);
    expect(g.state.result.power).toBeCloseTo(1, 2);
    expect(g.state.result.downMs).toBeGreaterThan(200);
    expect(g.state.result.downMs).toBeLessThan(300);
  });
  it('interpolates the exact crossing time between coarse samples', () => {
    const g = createSwingGesture();
    g.down(0, 0, 0);
    g.move(0, 85, 375); g.move(0, 170, 750);
    g.move(0, 70, 850);
    g.move(0, -130, 1050); // crosses the line 35 percent of the way through this sample
    expect(g.state.phase).toBe(PHASE.DONE);
    expect(g.state.result.downMs).toBeCloseTo(100 + 200 * 0.35, 0);
  });
  it('ignores non-finite samples without changing state', () => {
    const g = createSwingGesture();
    g.down(0, 0, 0); g.move(0, 50, 100);
    const depth = g.state.depth;
    g.move(NaN, 60, 110); g.move(0, Infinity, 120); g.move(0, 60, NaN);
    expect(g.state.depth).toBe(depth);
    expect(g.state.phase).toBe(PHASE.BACK);
    g.down(NaN, 0, 0);
    expect(g.state.phase).toBe(PHASE.BACK);
  });
  it('a swing held too long is cancelled', () => {
    const g = createSwingGesture();
    g.down(0, 0, 0); g.move(0, 100, 500); g.move(0, 101, 500 + SWING_DEFAULTS.maxSwingMs + 1);
    expect(g.state.phase).toBe(PHASE.CANCELLED);
  });
  it('a flick faster than a real backswing is graded rushed', () => {
    const st = swing(createSwingGesture(), { backMs: 60, downMs: 20, steps: 6 });
    expect(st.result.tempoGrade).toBe('rushed');
    expect(st.result.tempoQuality).toBeLessThan(0.5);
  });
  it('results are always finite and in range under random input', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let done = 0;
    for (let k = 0; k < 400; k++) {
      const g = createSwingGesture();
      let t = 0, x = 200, y = 300;
      g.down(x, y, t);
      for (let i = 0; i < 80 && g.state.phase !== PHASE.DONE && g.state.phase !== PHASE.CANCELLED; i++) {
        t += 4 + rnd() * 40; x += (rnd() - 0.5) * 60; y += (rnd() - (i < 30 ? 0.2 : 0.8)) * 50;
        g.move(x, y, t);
      }
      if (g.state.phase !== PHASE.DONE) g.up(x, y, t + 5);
      const r = g.state.result;
      if (r) {
        done++;
        expect(Number.isFinite(r.power + r.face + r.path + r.tempoQuality + r.tempoRatio)).toBe(true);
        expect(r.power).toBeGreaterThanOrEqual(0); expect(r.power).toBeLessThanOrEqual(1);
        expect(Math.abs(r.face)).toBeLessThanOrEqual(SWING_DEFAULTS.maxFace);
        expect(Math.abs(r.path)).toBeLessThanOrEqual(SWING_DEFAULTS.maxPath);
        expect(r.tempoQuality).toBeGreaterThanOrEqual(0); expect(r.tempoQuality).toBeLessThanOrEqual(1);
      }
    }
    expect(done).toBeGreaterThan(50);
  });
  it('reset returns to idle and a new swing works after a completed one', () => {
    const g = createSwingGesture();
    swing(g);
    expect(g.state.phase).toBe(PHASE.DONE);
    g.reset();
    expect(g.state.phase).toBe(PHASE.IDLE);
    expect(swing(g, { depthPx: 85 }).result.power).toBeCloseTo(0.5, 2);
  });
});

describe('three-press meter (keyboard and gamepad)', () => {
  it('produces the same result shape as the gesture', () => {
    const m = createMeterSwing({ riseMs: 1000, fallMs: 400 });
    m.press(0);
    expect(m.meter(500)).toBeCloseTo(0.5, 5);
    m.press(800);
    expect(m.state.power).toBeCloseTo(0.8, 5);
    m.press(800 + 0.8 * 400);
    const r = m.state.result;
    expect(m.state.phase).toBe(PHASE.DONE);
    expect(r.power).toBeCloseTo(0.8, 5);
    expect(r.face).toBeCloseTo(0, 5);
    expect(r.tempoGrade).toBe('perfect');
    expect(r.tempoQuality).toBe(1);
  });
  it('late strike opens the face and early closes it', () => {
    const late = createMeterSwing({ riseMs: 1000, fallMs: 400 });
    late.press(0); late.press(1000); late.press(1000 + 400 + 150);
    expect(late.state.result.face).toBeGreaterThan(1);
    const early = createMeterSwing({ riseMs: 1000, fallMs: 400 });
    early.press(0); early.press(1000); early.press(1000 + 250);
    expect(early.state.result.face).toBeLessThan(-1);
  });
  it('expires an abandoned backswing and auto-completes a missed strike', () => {
    const m = createMeterSwing({ riseMs: 1000, fallMs: 400 });
    m.press(0); m.expire(1700);
    expect(m.state.phase).toBe(PHASE.CANCELLED);
    const n = createMeterSwing({ riseMs: 1000, fallMs: 400 });
    n.press(0); n.press(1000); n.expire(1000 + 400 + 500);
    expect(n.state.phase).toBe(PHASE.DONE);
    expect(n.state.result.tempoQuality).toBeLessThan(0.3);
  });
});
