// Defensive helpers. One bad value or one throwing subsystem must never kill the frame loop.
export const fin = (x, fallback = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

export function allFinite(...xs) {
  for (let i = 0; i < xs.length; i++) {
    if (typeof xs[i] !== 'number' || !Number.isFinite(xs[i])) return false;
  }
  return true;
}

const errorCounts = new Map();
export const guardStats = { errors: errorCounts, last: null };

// Wrap a subsystem tick. A throw is logged (rate limited) and the frame continues.
export function guarded(label, fn) {
  return function guardedCall(...args) {
    try {
      return fn(...args);
    } catch (err) {
      const n = (errorCounts.get(label) || 0) + 1;
      errorCounts.set(label, n);
      guardStats.last = { label, message: String(err && err.message ? err.message : err) };
      if (n <= 3 || n % 300 === 0) {
        console.error(`[fairway] subsystem "${label}" threw (count ${n}):`, err);
      }
      return undefined;
    }
  };
}

// Canvas gradients throw on non-finite stops. Always build them through this.
export function safeLinearGradient(ctx, x0, y0, x1, y1, stops) {
  if (!allFinite(x0, y0, x1, y1)) return null;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) {
    if (Number.isFinite(o)) g.addColorStop(Math.min(1, Math.max(0, o)), c);
  }
  return g;
}

export function safeRadialGradient(ctx, x0, y0, r0, x1, y1, r1, stops) {
  if (!allFinite(x0, y0, r0, x1, y1, r1) || r0 < 0 || r1 < 0) return null;
  const g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [o, c] of stops) {
    if (Number.isFinite(o)) g.addColorStop(Math.min(1, Math.max(0, o)), c);
  }
  return g;
}
