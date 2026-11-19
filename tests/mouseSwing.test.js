// The mouse swing at different polling rates: the gesture (game/swingGesture.js, unchanged) is
// fed every sample the browser coalesces, through the refiner (ui/mouseRefine.js), so a 60,
// 144, 240 or 1000 Hz mouse making the same motion gets the same swing. And the swing track's
// fill uses the exact spring (game/swingMotion.js springStep), which lands in the same place at
// any frame rate.
import { describe, it, expect } from 'vitest';
import { createSwingGesture } from '../src/game/swingGesture.js';
import { springStep } from '../src/game/swingMotion.js';
import { createMouseRefiner } from '../src/ui/mouseRefine.js';

// A continuous mouse swing: 820 ms back (ease in and out) to `depth` px, a 40 ms rest at the top,
// 270 ms down (accelerating) through the start line, drifting 6 px right on the way up.
function pos(t, depth) {
  const BACK = 820, PAUSE = 40, DOWN = 270;
  if (t <= BACK) return { x: 0, y: depth * (0.5 - 0.5 * Math.cos((Math.PI * t) / BACK)) };
  if (t <= BACK + PAUSE) return { x: 0, y: depth };
  const u = Math.min(1.2, (t - BACK - PAUSE) / DOWN);
  return { x: 6 * u * u, y: depth - (depth + 20) * u * u };
}
function swingAt(hz, phase, depth = 150, refine = true) {
  const g = createSwingGesture({ travel: 190 });
  g.down(500, 300, 1000);
  const r = createMouseRefiner();
  r.start(500, 300, 1000);
  const dt = 1000 / hz;
  for (let t = phase * dt; t < 1500; t += dt) {
    const p = pos(t, depth);
    const x = 500 + Math.round(p.x), y = 300 + Math.round(p.y);
    for (const q of refine ? r.push(x, y, 1000 + t) : [{ x, y, t: 1000 + t }]) {
      const s = g.move(q.x, q.y, q.t);
      if (s.phase === 'done') return s.result;
    }
  }
  return null;
}
const worstTempo = (refine) => {
  let worst = 0;
  for (const depth of [80, 150]) { const ref = swingAt(1000, 0, depth, refine); for (let k = 0; k < 10; k++) worst = Math.max(worst, Math.abs(swingAt(60, k / 10, depth, refine).tempoRatio / ref.tempoRatio - 1)); }
  return worst;
};

describe('mouse swing polling rates', () => {
  it('the same motion gives the same swing at 60, 144, 240 and 1000 Hz', () => {
    for (const depth of [80, 150]) {
      const ref = swingAt(1000, 0, depth);
      expect(ref).toBeTruthy();
      for (const hz of [60, 144, 240]) for (let k = 0; k < 10; k++) {
        const r = swingAt(hz, k / 10, depth);
        expect(r).toBeTruthy();
        // Power reads the deepest point: identical.
        expect(r.power).toBeCloseTo(ref.power, 2);
        // Tempo within 5 percent and the same grade; face and path within a fifth of a degree.
        expect(Math.abs(r.tempoRatio / ref.tempoRatio - 1)).toBeLessThan(0.05);
        expect(r.tempoGrade).toBe(ref.tempoGrade);
        expect(Math.abs(r.face - ref.face)).toBeLessThan(0.2);
        expect(Math.abs(r.path - ref.path)).toBeLessThan(0.2);
      }
    }
  });
  it('the refiner takes the 60 Hz tempo error down (raw samples miss the top by up to a polling interval)', () => {
    const raw = worstTempo(false), refined = worstTempo(true);
    expect(refined).toBeLessThan(raw);
    expect(refined).toBeLessThan(0.05);
  });
  it('the refiner never moves a position: power and the start line are exact', () => {
    const r = createMouseRefiner();
    r.start(0, 0, 0);
    const pts = [];
    for (const [y, t] of [[3, 10], [9, 20], [40, 60], [80, 120], [80, 140], [79, 156], [70, 172], [-10, 260]]) pts.push(...r.push(0, y, t));
    // Every original sample comes out, in order; the added ones sit on the dead zone edge and
    // on the deepest point.
    const ys = pts.map((p) => p.y);
    expect(Math.max(...ys)).toBe(80);
    expect(pts.filter((p) => p.y === 7).length).toBe(1);
    for (let i = 1; i < pts.length; i++) expect(pts[i].t).toBeGreaterThan(pts[i - 1].t);
  });
  it('the track fill spring lands in the same place at any frame rate', () => {
    for (const target of [0.3, 0.92]) {
      const at = (fps) => { let x = 0, v = 0; const dt = 1 / fps; for (let t = 0; t < 0.1 - 1e-9; t += dt) { const r = springStep(x, v, target, 40, dt); x = r.x; v = r.v; } return x; };
      const a = at(60), b = at(144), c = at(240);
      // 0.1 s is a whole number of frames only at 60 and 240; at 144 it is within one frame.
      expect(Math.abs(a - c)).toBeLessThan(1e-9);
      expect(Math.abs(a - b)).toBeLessThan(0.03);
      expect(a).toBeLessThanOrEqual(target + 1e-9);
    }
  });
});
