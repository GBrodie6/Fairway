// Ball contact: where on the ball the player asks the club to meet it, from the ball diagram's
// dot (ui/spinPad.js). Left and right curve the ball (a draw or a fade), up adds backspin and
// launch, down takes spin off and launches lower for more roll. Everything here is a bounded
// modifier on the launch from computeLaunch (after the strike), before the unchanged flight
// simulation. The center is neutral and returns the launch untouched.
//
// SPIN_SIGN is the one place the curve direction is fixed: a positive spin axis tilt curves the
// ball to the right of its travel (physics/ball.js spinAxis). The dot's x is in world terms
// (+1 curves right), so a right-hander's draw is x < 0 and a left-hander's draw is x > 0; the
// pad labels follow the handedness (ui/spinPad.js).
import { clamp, DEG } from '../core/math.js';
import { simulateShot, flatEnv } from '../physics/ball.js';
import { computeLaunch, SHOT_TYPES, BASE_PROFILE } from '../physics/shot.js';
import { SURFACES } from '../physics/surfaces.js';
import { controlRange } from '../data/spinControl.js';

export const SPIN_SIGN = 1;
export const SPIN_FX = Object.freeze({
  tiltDeg: 16, // spin axis tilt at the edge of the pad
  startDeg: 1.4, // start line opposite the curve at the edge, so the ball bends back toward the aim
  backspinUp: 0.3, // up to +30 percent backspin at the top
  backspinDown: 0.5, // up to -50 percent backspin at the bottom (low spin, more roll)
  launchUp: 0.1, // up to +10 percent launch angle at the top
  launchDown: 0.16, // up to -16 percent launch angle at the bottom
  carryCost: 0.06, // up to 6 percent carry at the edge of the pad, never a gain
  mishit: 0.14, // added to the strike model's error at the edge (scaled by the square)
});
const num = (v) => (Number.isFinite(v) ? v : 0);

// Keep the dot inside the pad and inside this club's usable range (a circle).
export function clampOffset(o, range = 1) {
  const x = clamp(num(o && o.x), -1, 1), y = clamp(num(o && o.y), -1, 1);
  const R = clamp(num(range), 0, 1), r = Math.hypot(x, y);
  if (r <= R || r === 0) return { x, y };
  return { x: (x / r) * R, y: (y / r) * R };
}
export const isNeutral = (o) => !o || (Math.abs(num(o.x)) < 1e-6 && Math.abs(num(o.y)) < 1e-6);
// How far from the center, 0 to 1 (the edge of the pad).
export const offsetSize = (o) => (o ? clamp(Math.hypot(num(o.x), num(o.y)), 0, 1) : 0);

/** The modifiers for an offset: tilt and heading in radians, multipliers on spin, launch, speed. */
export function spinModifiers(o) {
  const c = clampOffset(o, 1);
  const r = Math.hypot(c.x, c.y);
  return {
    tilt: SPIN_SIGN * c.x * SPIN_FX.tiltDeg * DEG,
    heading: -SPIN_SIGN * c.x * SPIN_FX.startDeg * DEG,
    spin: 1 + (c.y >= 0 ? c.y * SPIN_FX.backspinUp : c.y * SPIN_FX.backspinDown),
    launch: 1 + (c.y >= 0 ? c.y * SPIN_FX.launchUp : c.y * SPIN_FX.launchDown),
    speed: 1 - SPIN_FX.carryCost * r * r,
    r,
  };
}

// The carry guard: spin and launch changes move carry by different amounts for each club (a
// low-spinning driver loses more than a wedge), so the ball speed is set so the flat, calm
// carry is exactly (1 - cost) of the neutral carry: about 6 percent less at the edge of the
// pad, never more and never a gain. The speed factor stays between 0.7 and 1.08. Found by
// bisection on the real simulation, per club, shot type, profile and dot position (rounded to
// 0.05), and cached.
const guardCache = new Map();
const ENV = flatEnv();
const K_MIN = 0.7, K_MAX = 1.08;
export function carryGuard(club, shotType = SHOT_TYPES.FULL, o, profile = BASE_PROFILE) {
  if (!club || club.putter || isNeutral(o)) return 1;
  const c = clampOffset(o, 1);
  const qx = Math.round(c.x * 20) / 20, qy = Math.round(c.y * 20) / 20;
  const key = `${club.id}|${shotType.id}|${qx}|${qy}|${num(profile.power).toFixed(4)}|${num(profile.spin).toFixed(4)}`;
  if (guardCache.has(key)) return guardCache.get(key);
  const base = computeLaunch({ power: 1, face: 0, path: 0, tempoQuality: 1 }, { club, shotType, lie: SURFACES.FAIRWAY, aim: 0, x: 0, z: 0, profile });
  const neutral = simulateShot(base, ENV).carry;
  const m = spinModifiers({ x: qx, y: qy });
  const want = neutral * m.speed;
  const carryAt = (k) => simulateShot(shape(base, m, k), ENV).carry;
  let k;
  if (carryAt(K_MAX) <= want) k = K_MAX;
  else if (carryAt(K_MIN) >= want) k = K_MIN;
  else {
    let lo = K_MIN, hi = K_MAX;
    for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (carryAt(mid) > want) hi = mid; else lo = mid; }
    k = lo;
  }
  if (guardCache.size > 4000) guardCache.clear();
  guardCache.set(key, k);
  return k;
}
function shape(launch, m, speedK) {
  return { ...launch, speed: launch.speed * speedK, vAngle: launch.vAngle * m.launch, spin: launch.spin * m.spin, axisTilt: clamp(num(launch.axisTilt) + m.tilt, -40 * DEG, 40 * DEG), heading: num(launch.heading) + m.heading };
}

/**
 * Apply the dot to a launch (a new object; the input is untouched). ctx: { club, shotType,
 * profile } for the carry guard. Neutral, a putt, or no club returns the launch as it is.
 */
export function applySpin(launch, o, ctx = {}) {
  if (!launch || launch.putt || isNeutral(o) || (ctx.club && ctx.club.putter)) return launch;
  const m = spinModifiers(o);
  const k = ctx.club ? carryGuard(ctx.club, ctx.shotType || SHOT_TYPES.FULL, o, ctx.profile || BASE_PROFILE) : m.speed;
  return shape(launch, m, k);
}

// The usable range for a club tier and a golfer perk (data/spinControl.js has the caps).
export const spinRange = (rarity, perk = 0) => controlRange(rarity, perk);

// The pad labels for a golfer: which side is the draw.
export function padLabels(lefty = false) {
  return { left: lefty ? 'Fade' : 'Draw', right: lefty ? 'Draw' : 'Fade', up: 'More backspin', down: 'Topspin' };
}
// The quick buttons, as dot positions for a golfer (a draw is x < 0 for a right-hander).
export function quickOffset(kind, range = 1, lefty = false) {
  const side = lefty ? -1 : 1;
  const r = clamp(num(range), 0, 1) * 0.8;
  if (kind === 'draw') return { x: -side * r, y: 0 };
  if (kind === 'fade') return { x: side * r, y: 0 };
  return { x: 0, y: 0 };
}

// Curve and roll from a prediction (meters): curve is how far the landing point sits right
// (+) or left (-) of the start line, roll is total minus carry.
export function curveAndRoll(prediction, from, aim) {
  if (!prediction) return { curve: 0, roll: 0 };
  const land = prediction.carryPoint || prediction.end;
  const fx = Math.sin(aim), fz = -Math.cos(aim);
  const right = (land.x - from.x) * -fz + (land.z - from.z) * fx;
  return { curve: right, roll: Math.max(0, prediction.total - prediction.carry) };
}
