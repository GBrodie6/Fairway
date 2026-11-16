// The one-gesture swing stick, as pure logic with no DOM. Feed it pointer samples
// (x, y in pixels with y growing downward, t in milliseconds) and it reports the swing.
//
//   drag down          backswing. Depth sets power.
//   reverse, drag up   downswing. Crossing the start line is impact.
//   tempo              backswing time : downswing time, graded against 3 : 1.
//   horizontal drift   offset at impact sets the face, the direction of the downswing sets the path.
//
// Screen right is "open/right" for a right-hander. For a left-hander the caller passes
// handedness: 'left' and face and path are mirrored so the feel is identical.
import { clamp } from '../core/math.js';

export const SWING_DEFAULTS = Object.freeze({
  travel: 170, // pixels of drag for 100 percent power
  deadzone: 7, // pixels of movement before the backswing starts
  reverse: 9, // pixels of upward travel from the top that commits the downswing
  minDepth: 0.06, // a backswing shallower than this is ignored
  idealTempo: 3,
  perfectBand: 0.14, // |ln(ratio / ideal)| below this is Perfect
  goodBand: 0.36,
  faceDeadzone: 0.025, // fraction of travel forgiven at impact
  faceGain: 22, // degrees of face per unit of travel offset
  maxFace: 8,
  pathGain: 0.4, // degrees of path per degree of downswing line
  maxPath: 7,
  minBackMs: 120, // faster than this is a flick, not a swing
  maxSwingMs: 6000,
  handedness: 'right',
});

export const PHASE = Object.freeze({
  IDLE: 'idle',
  READY: 'ready',
  BACK: 'backswing',
  DOWN: 'downswing',
  DONE: 'done',
  CANCELLED: 'cancelled',
});

export function gradeTempo(ratio, cfg = SWING_DEFAULTS) {
  if (!Number.isFinite(ratio) || ratio <= 0) return { grade: 'miss', quality: 0, error: Infinity, label: 'Mistimed' };
  const err = Math.log(ratio / cfg.idealTempo);
  const a = Math.abs(err);
  // Quality falls linearly to zero when the tempo is off by a factor of two.
  const quality = clamp(1 - Math.max(0, a - cfg.perfectBand * 0.5) / (Math.LN2 - cfg.perfectBand * 0.5), 0, 1);
  let grade, label;
  if (a <= cfg.perfectBand) { grade = 'perfect'; label = 'Perfect'; }
  else if (a <= cfg.goodBand) { grade = 'good'; label = err > 0 ? 'Good, a little quick' : 'Good, a little slow'; }
  else if (err > 0) { grade = 'rushed'; label = 'Rushed'; }
  else { grade = 'slow'; label = 'Decelerated'; }
  return { grade, quality, error: err, label };
}

export function createSwingGesture(config = {}) {
  const cfg = { ...SWING_DEFAULTS, ...config };
  const mirror = cfg.handedness === 'left' ? -1 : 1;
  const st = {
    phase: PHASE.IDLE,
    startX: 0, startY: 0, startT: 0,
    backStartT: 0,
    topX: 0, topY: 0, topT: 0,
    lastX: 0, lastY: 0, lastT: 0,
    depth: 0, // current fraction of travel below the start line
    maxDepth: 0,
    drift: 0, // current horizontal offset as a fraction of travel
    result: null,
  };

  function reset() {
    st.phase = PHASE.IDLE;
    st.depth = 0; st.maxDepth = 0; st.drift = 0; st.result = null;
  }

  function down(x, y, t) {
    if (![x, y, t].every(Number.isFinite)) return st;
    reset();
    st.phase = PHASE.READY;
    st.startX = x; st.startY = y; st.startT = t;
    st.topX = x; st.topY = y; st.topT = t;
    st.lastX = x; st.lastY = y; st.lastT = t;
    st.backStartT = t;
    return st;
  }

  function finish(xImpact, tImpact, auto) {
    const depthPx = st.topY - st.startY;
    const power = clamp(depthPx / cfg.travel, 0, 1);
    const backMs = st.topT - st.backStartT;
    const downMs = Math.max(1, tImpact - st.topT);
    const ratio = backMs / downMs;
    const tempo = backMs < cfg.minBackMs
      ? { grade: 'rushed', quality: 0.2, error: Math.LN2, label: 'Rushed' }
      : gradeTempo(ratio, cfg);
    let off = (xImpact - st.startX) / cfg.travel;
    const dz = cfg.faceDeadzone;
    off = Math.abs(off) <= dz ? 0 : off - Math.sign(off) * dz;
    const face = clamp(off * cfg.faceGain, -cfg.maxFace, cfg.maxFace) * mirror;
    // Angle of the downswing line from vertical. Up and to the right is in-to-out (positive).
    const lineDeg = (Math.atan2(xImpact - st.topX, Math.max(1, depthPx)) * 180) / Math.PI;
    const path = clamp(lineDeg * cfg.pathGain, -cfg.maxPath, cfg.maxPath) * mirror;
    st.phase = PHASE.DONE;
    st.depth = 0;
    st.result = {
      power,
      face,
      path,
      tempoRatio: ratio,
      tempoGrade: tempo.grade,
      tempoLabel: tempo.label,
      tempoQuality: tempo.quality,
      backMs,
      downMs,
      auto: !!auto,
    };
    return st;
  }

  function move(x, y, t) {
    if (![x, y, t].every(Number.isFinite)) return st;
    if (st.phase === PHASE.IDLE || st.phase === PHASE.DONE || st.phase === PHASE.CANCELLED) return st;
    if (t - st.startT > cfg.maxSwingMs) {
      st.phase = PHASE.CANCELLED;
      return st;
    }
    const dy = y - st.startY;
    const prevX = st.lastX, prevY = st.lastY, prevT = st.lastT;
    st.lastX = x; st.lastY = y; st.lastT = t;
    st.depth = clamp(dy / cfg.travel, -0.2, 1.2);
    st.drift = (x - st.startX) / cfg.travel;
    if (st.phase === PHASE.READY) {
      if (dy > cfg.deadzone) {
        st.phase = PHASE.BACK;
        st.backStartT = prevT; // the swing began at the last sample before the deadzone was left
        st.topX = x; st.topY = y; st.topT = t;
        st.maxDepth = clamp(dy / cfg.travel, 0, 1);
      }
      return st;
    }
    if (st.phase === PHASE.BACK) {
      if (y >= st.topY) {
        st.topX = x; st.topY = y; st.topT = t;
        st.maxDepth = clamp(dy / cfg.travel, 0, 1);
      } else if (st.topY - y > cfg.reverse) {
        if (st.maxDepth < cfg.minDepth) {
          st.phase = PHASE.CANCELLED;
          return st;
        }
        st.phase = PHASE.DOWN;
      }
    }
    if (st.phase === PHASE.DOWN) {
      if (y <= st.startY) {
        // Interpolate the exact crossing of the start line between the last two samples.
        const span = prevY - y;
        const f = span > 1e-6 ? clamp((prevY - st.startY) / span, 0, 1) : 1;
        const xi = prevX + (x - prevX) * f;
        const ti = prevT + (t - prevT) * f;
        return finish(xi, ti, false);
      }
    }
    return st;
  }

  function up(x, y, t) {
    if (st.phase === PHASE.DOWN && [x, y, t].every(Number.isFinite)) {
      // Thumb lifted early in the downswing: complete the swing at the current pace.
      const travelled = st.topY - y;
      const remaining = y - st.startY;
      const elapsed = Math.max(1, t - st.topT);
      const v = travelled / elapsed; // px per ms
      if (v > 0.05 && travelled > 0) {
        const vx = (x - st.topX) / elapsed;
        const dt = remaining / v;
        return finish(x + vx * dt, t + dt, true);
      }
    }
    if (st.phase !== PHASE.DONE) st.phase = PHASE.CANCELLED;
    return st;
  }

  function cancel() {
    if (st.phase !== PHASE.DONE) st.phase = PHASE.CANCELLED;
    return st;
  }

  return { state: st, config: cfg, down, move, up, cancel, reset };
}

// Three-press meter used by keyboard and gamepad buttons, mapped into the same result shape
// as the gesture. Press 1 starts the meter, press 2 sets power, press 3 sets the strike.
export function createMeterSwing({ riseMs = 1100, fallMs = 370 } = {}) {
  const st = { phase: PHASE.IDLE, t0: 0, tTop: 0, power: 0, result: null };
  return {
    state: st,
    press(t) {
      if (!Number.isFinite(t)) return st;
      if (st.phase === PHASE.IDLE || st.phase === PHASE.DONE || st.phase === PHASE.CANCELLED) {
        st.phase = PHASE.BACK; st.t0 = t; st.result = null; st.power = 0;
      } else if (st.phase === PHASE.BACK) {
        st.power = clamp((t - st.t0) / riseMs, 0, 1);
        if (st.power < 0.04) { st.phase = PHASE.CANCELLED; return st; }
        st.phase = PHASE.DOWN; st.tTop = t;
      } else if (st.phase === PHASE.DOWN) {
        // The marker falls back to the strike line in power * fallMs. Early or late sets the face.
        const ideal = st.power * fallMs;
        const err = (t - st.tTop - ideal) / Math.max(60, ideal); // -1 early .. +1 late
        const e = clamp(err, -1, 1);
        const quality = clamp(1 - Math.abs(e) * 1.6, 0, 1);
        st.phase = PHASE.DONE;
        st.result = {
          power: st.power,
          face: clamp(e * 9, -8, 8),
          path: 0,
          tempoRatio: 3,
          tempoGrade: Math.abs(e) < 0.08 ? 'perfect' : Math.abs(e) < 0.25 ? 'good' : e > 0 ? 'slow' : 'rushed',
          tempoLabel: Math.abs(e) < 0.08 ? 'Perfect' : Math.abs(e) < 0.25 ? 'Good' : e > 0 ? 'Late' : 'Early',
          tempoQuality: quality,
          backMs: st.tTop - st.t0,
          downMs: t - st.tTop,
          auto: false,
        };
      }
      return st;
    },
    // 0..1 progress for drawing: rising during the backswing, falling during the downswing.
    meter(t) {
      if (st.phase === PHASE.BACK) return clamp((t - st.t0) / riseMs, 0, 1);
      if (st.phase === PHASE.DOWN) return clamp(st.power - (t - st.tTop) / fallMs, -0.25, 1);
      return 0;
    },
    expire(t) {
      if (st.phase === PHASE.BACK && t - st.t0 > riseMs * 1.6) st.phase = PHASE.CANCELLED;
      if (st.phase === PHASE.DOWN && t - st.tTop > st.power * fallMs + 420) {
        // Missed the strike entirely: a heavy late hit.
        this.press(st.tTop + st.power * fallMs + 400);
      }
      return st;
    },
    cancel() { st.phase = PHASE.CANCELLED; return st; },
  };
}
