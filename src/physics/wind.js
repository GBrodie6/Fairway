// Wind with gusts. Deterministic for a given seed, so a shot replays identically.
// Direction convention: dir is the heading the wind blows TOWARD (same convention as aim).
import { MPH, clamp } from '../core/math.js';
import { createRng } from '../core/rng.js';

const Z0 = 0.03; // roughness length of short grass, meters
const REF_H = 10;
const LOG_REF = Math.log((REF_H + Z0) / Z0);

// Wind speed multiplier at height h relative to the 10 m reference (log profile).
export function heightFactor(h) {
  const hh = clamp(h, 0.2, 120);
  return clamp(Math.log((hh + Z0) / Z0) / LOG_REF, 0.35, 1.45);
}

/**
 * createWind({ speedMph, dir, gustiness (0..1), seed })
 * sample(t, h, out) writes the air velocity {x, z} in m/s at time t (s) and height h (m).
 */
export function createWind({ speedMph = 0, dir = 0, gustiness = 0.25, seed = 1 } = {}) {
  const rng = createRng(seed);
  const base = Math.max(0, speedMph) * MPH;
  const g = clamp(gustiness, 0, 1);
  // Three incommensurate sine components give a smooth, non-repeating gust envelope.
  const comps = [];
  for (let i = 0; i < 3; i++) {
    comps.push({ w: rng.range(0.12, 0.2) * (1 + i * 0.9), p: rng.range(0, Math.PI * 2), a: [0.55, 0.3, 0.15][i] });
  }
  const dcomps = [];
  for (let i = 0; i < 2; i++) {
    dcomps.push({ w: rng.range(0.05, 0.11) * (1 + i * 1.3), p: rng.range(0, Math.PI * 2), a: [0.7, 0.3][i] });
  }
  const gustAt = (t) => {
    let s = 0;
    for (const c of comps) s += c.a * Math.sin(c.w * t + c.p);
    return s; // in [-1, 1]
  };
  const swingAt = (t) => {
    let s = 0;
    for (const c of dcomps) s += c.a * Math.sin(c.w * t + c.p);
    return s;
  };
  const wind = {
    speedMph: Math.max(0, speedMph),
    dir,
    gustiness: g,
    base,
    speedAt(t) {
      return Math.max(0, base * (1 + 0.45 * g * gustAt(t)));
    },
    dirAt(t) {
      return dir + 0.22 * g * swingAt(t);
    },
    sample(t, h, out) {
      const sp = wind.speedAt(t) * heightFactor(h);
      const d = wind.dirAt(t);
      out.x = sp * Math.sin(d);
      out.z = -sp * Math.cos(d);
      return out;
    },
    // Steady reference vector (10 m height, no gust) for HUD arrows, flags, grass, clouds.
    vector(out = {}) {
      out.x = base * Math.sin(dir);
      out.z = -base * Math.cos(dir);
      return out;
    },
  };
  return wind;
}

// Head/tail and cross components of a wind relative to a shot heading. Positive along = tailwind,
// positive cross = pushes the ball to the right.
export function windRelative(wind, heading, t = 0) {
  const sp = wind.speedAt ? wind.speedAt(t) : wind.base;
  const d = (wind.dirAt ? wind.dirAt(t) : wind.dir) - heading;
  return { along: sp * Math.cos(d), cross: sp * Math.sin(d) };
}

// Pick a believable wind for a hole from a course wind profile.
export function rollWind(rng, profile = {}) {
  const lo = profile.min ?? 2, hi = profile.max ?? 12;
  const prevailing = profile.prevailing ?? rng.range(0, Math.PI * 2);
  const spread = profile.spread ?? Math.PI;
  const speedMph = Math.round(lo + (hi - lo) * Math.pow(rng.next(), 1.4));
  return {
    speedMph,
    dir: prevailing + (rng.next() - 0.5) * spread,
    gustiness: profile.gustiness ?? 0.25,
    seed: rng.int(1, 1e9),
  };
}
