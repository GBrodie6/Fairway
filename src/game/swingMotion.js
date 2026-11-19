// How the floating club moves on screen: smoothing and easing between the raw drag and the
// pose the club view draws. Visual only: the swing result (power, tempo, face, path) and the
// moment the shot launches come from game/swingGesture.js, untouched by anything here.
//
//   smoothing   the drag depth goes through a critically damped spring, so touch sampling
//               (uneven gaps, a pixel of wobble) never steps or jitters the club. In the last
//               10 percent before impact the spring is much stiffer and its lag is capped at
//               half the remaining distance, so the club reaches the ball exactly as the drag
//               crosses the start line.
//   backswing   unhurried (the spring), with a slight settle when the drag stops at the top
//               (a small underdamped carry and return) and a still hold while the finger rests.
//   downswing   eased in (it accelerates), with the club view's speed-based shaft lag.
//   impact      a short hit-stop on the club only (off with reduced motion).
//   finish      the follow-through decelerates (ease out) and then fades.
import { clamp } from '../core/math.js';

export const SWING_MOTION = Object.freeze({
  omega: 24, // rad/s: about a 40 ms time constant on the drag
  stiffOmega: 90, // rad/s in the last 10 percent before impact
  stiffFrom: 0.1, // the last 10 percent of the downswing (depth below 10 percent of the top)
  maxLagShare: 0.5, // near impact the lag never exceeds half the remaining depth
  settle: 0.014, // the most the club carries past the top when the drag stops (in progress)
  settleOmega: 24, // rad/s of the settle wobble
  settleZeta: 0.45, // damping ratio of the settle (below 1: one soft overshoot)
  stillSpeed: 0.08, // depth per second under which the finger counts as resting
  hitStopMs: 60, // 50 to 70 ms in the brief
  followSec: 0.5, // the follow-through, then the fade
});

/** One exact step of a critically damped spring toward target (stable for any dt). */
export function springStep(x, v, target, omega, dt) {
  const e0 = x - target;
  const k = Math.exp(-omega * dt);
  const c = v + omega * e0;
  return { x: target + (e0 + c * dt) * k, v: (v - omega * c * dt) * k };
}

/** One step of an underdamped spring toward 0 (the settle offset). */
function settleStep(x, v, omega, zeta, dt) {
  // Semi-implicit Euler in small substeps: plenty for an offset of a few hundredths.
  const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
  for (let i = 0; i < n; i++) { v += (-omega * omega * x - 2 * zeta * omega * v) * h; x += v * h; }
  return { x, v };
}

// The downswing ease: starts gently and accelerates into impact (monotonic, 0 to 1): half
// linear, half an ease-in, so the club never hangs at the top.
export const easeDown = (u) => { const t = clamp(u, 0, 1); return 0.5 * t + 0.5 * t * t * (1.6 - 0.6 * t); };
// The follow-through ease: decelerates.
export const easeOut = (u) => { const t = clamp(u, 0, 1); return 1 - (1 - t) ** 3; };

/**
 * The smoother for one swing. step(live, dt) takes the raw live drag ({ phase, depth, top })
 * and returns the drag to draw: { phase, depth, top, settle } where depth is smoothed and
 * settle is a small extra progress for the settle at the top.
 */
export function createSwingSmoother(cfg = SWING_MOTION) {
  const s = { d: 0, v: 0, phase: 'address', top: 0, so: 0, sv: 0, lastRaw: 0, rawSpeed: 0, moving: false, settled: false };
  const out = { phase: 'address', depth: 0, top: 0, settle: 0 };
  return {
    state: s,
    reset() { s.d = 0; s.v = 0; s.phase = 'address'; s.top = 0; s.so = 0; s.sv = 0; s.lastRaw = 0; s.rawSpeed = 0; s.moving = false; s.settled = false; },
    step(live, dt) {
      const phase = live && (live.phase === 'back' || live.phase === 'down') ? live.phase : 'address';
      const raw = clamp(live ? live.depth : 0, 0, 1.1);
      const top = clamp(live ? live.top : 0, 0, 1);
      if (phase === 'address') { this.reset(); out.phase = 'address'; out.depth = 0; out.top = 0; out.settle = 0; return out; }
      const h = Math.max(1e-4, dt);
      // How fast the finger moves (smoothed), to tell a rest from a slow drag.
      const sp = Math.abs(raw - s.lastRaw) / h;
      s.rawSpeed = s.rawSpeed * 0.6 + sp * 0.4;
      s.lastRaw = raw;
      if (phase === 'back') {
        const r = springStep(s.d, s.v, raw, cfg.omega, h);
        s.d = r.x; s.v = r.v;
        // The settle: when a moving backswing comes to rest, the club carries on a touch and
        // comes back. Once per rest; moving again re-arms it.
        if (s.rawSpeed > cfg.stillSpeed * 4) { s.moving = true; s.settled = false; }
        if (s.moving && !s.settled && s.rawSpeed < cfg.stillSpeed && raw > 0.2) {
          s.settled = true; s.moving = false;
          s.sv += cfg.settle * cfg.settleOmega * 1.6 * clamp(raw, 0, 1);
        }
      } else {
        // Downswing: stiff near impact, and the lag capped at half the remaining depth.
        const near = raw < cfg.stiffFrom * Math.max(top, 1e-3);
        const r = springStep(s.d, s.v, raw, near ? cfg.stiffOmega : cfg.omega * 1.6, h);
        s.d = r.x; s.v = r.v;
        if (near) {
          const cap = raw + cfg.maxLagShare * raw;
          if (s.d > cap) { s.d = cap; s.v = Math.min(s.v, 0); }
          if (s.d < raw * 0.5) s.d = raw * 0.5;
        }
        // The settle dies away quickly once the club starts down.
        s.sv *= Math.exp(-12 * h);
      }
      const st = settleStep(s.so, s.sv, cfg.settleOmega, cfg.settleZeta, h);
      s.so = clamp(st.x, -cfg.settle, cfg.settle); s.sv = st.v;
      s.phase = phase; s.top = top;
      out.phase = phase; out.depth = clamp(s.d, 0, 1.1); out.top = top; out.settle = s.so;
      return out;
    },
  };
}

/**
 * The follow-through progress after impact: held at 1 for the hit-stop (unless reduced
 * motion), then eased out to the finish. Returns { p, fade } where fade runs 0 to 1 after the
 * finish over fadeSec.
 */
export function followThrough(sec, { reduced = false, cfg = SWING_MOTION, fadeSec = 0.22 } = {}) {
  const stop = reduced ? 0 : cfg.hitStopMs / 1000;
  const t = Math.max(0, sec - stop);
  const p = sec <= stop ? 1 : 1 + 0.5 * easeOut(t / cfg.followSec);
  const fade = clamp((t - cfg.followSec) / fadeSec, 0, 1);
  return { p, fade };
}

// Strike tints for the swing trail (linear RGB, 0 to 1).
export const TRAIL_TINT = { swing: [0.92, 0.95, 1], pured: [1, 1, 1], good: [1, 0.72, 0.26], mishit: [1, 0.32, 0.26] };
export const trailTint = (kind) => (kind === 'pured' ? TRAIL_TINT.pured : kind === 'good' ? TRAIL_TINT.good : kind ? TRAIL_TINT.mishit : TRAIL_TINT.swing);
export const TRAIL_FADE_SEC = 0.3;
