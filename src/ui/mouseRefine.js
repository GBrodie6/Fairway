// Mouse input smoothing for the swing, in front of the swing math (game/swingGesture.js reads
// the result unchanged). The gesture takes two times from whichever sample happens to arrive:
// the start of the backswing (the last sample before the drag leaves the dead zone) and the
// top (the last sample at the deepest point). A mouse polled at 60 Hz puts those up to 17 ms
// from the real moments, which moved the tempo ratio by up to 7 percent against a 1000 Hz
// mouse making the same motion. This adds two interpolated samples so the gesture reads the
// real moments at any polling rate:
//
//   dead zone   when a sample first passes the dead zone, a sample exactly on its edge, at the
//               time the straight line between the two samples crosses it;
//   top         when the drag first comes back up from the deepest point, a sample at the
//               deepest point is added at the time the drag passed half a pixel off it (on the
//               line to the first sample back up), which is when a finely polled mouse would
//               first report it lower.
//
// Positions are never moved, so power (the deepest point) and the start line are exact. Touch
// input does not use this.
import { SWING_DEFAULTS } from '../game/swingGesture.js';

export function createMouseRefiner({ deadzone = SWING_DEFAULTS.deadzone } = {}) {
  let start = null, prev = null, out = false, maxY = -Infinity, top = null, held = [], refined = false;
  const ok = (x, y, t) => Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(t);

  function releaseHeld(withTop) {
    const pts = [];
    if (withTop && top && held.length) {
      // The moment the drag passed half a pixel off the deepest point (when a fine mouse would
      // first report it lower), on the straight line to the first sample back up.
      const b = held[0], drop = maxY - b.y;
      if (drop > 0) {
        const t0 = top.t + (b.t - top.t) * Math.min(1, 0.5 / drop);
        if (t0 > top.t && t0 < b.t) pts.push({ x: top.x, y: maxY, t: t0 });
      }
    }
    pts.push(...held);
    held = [];
    return pts;
  }

  return {
    start(x, y, t) { start = ok(x, y, t) ? { x, y, t } : null; prev = start; out = false; maxY = -Infinity; top = null; held = []; refined = false; },
    // One sample. Returns the samples to feed the gesture now, in order.
    push(x, y, t) {
      if (!start || !ok(x, y, t) || t <= prev.t) return [];
      const p = { x, y, t };
      const pts = [];
      // The dead zone edge.
      if (!out && y - start.y > deadzone) {
        const dp = prev.y - start.y, dc = y - start.y;
        if (dc > dp) {
          const f = (deadzone - dp) / (dc - dp);
          if (f > 0 && f < 1) pts.push({ x: prev.x + (x - prev.x) * f, y: start.y + deadzone, t: prev.t + (t - prev.t) * f });
        }
        out = true;
      }
      prev = p;
      if (!out) { pts.push(p); return pts; }
      // The top: a new deepest point (or level with it) passes straight through and re-arms.
      if (y >= maxY) { pts.push(...releaseHeld(false), p); maxY = y; top = p; refined = false; return pts; }
      // Coming back up from it: add the refined top before this sample. Once refined, samples
      // pass straight through until a new deepest point.
      if (refined) { pts.push(p); return pts; }
      held.push(p);
      pts.push(...releaseHeld(true));
      refined = true;
      return pts;
    },
    // Anything held (on release or cancel).
    flush() { return releaseHeld(true); },
  };
}
