// Shared math helpers and unit constants. SI units internally (meters, seconds, radians).
export const YARD = 0.9144;
export const FOOT = 0.3048;
export const MPH = 0.44704;
export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
};
export const toYards = (m) => m / YARD;
export const toMeters = (yd) => yd * YARD;
export const toFeet = (m) => m / FOOT;
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
// Heading convention used everywhere: 0 points down the -Z axis, positive turns toward +X.
export const headingVec = (h) => ({ x: Math.sin(h), z: -Math.cos(h) });
export const headingTo = (fx, fz, tx, tz) => Math.atan2(tx - fx, -(tz - fz));
export const dist2 = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);
export const isFiniteNum = (x) => typeof x === 'number' && Number.isFinite(x);
