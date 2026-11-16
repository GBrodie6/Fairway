// Ball physics: flight (drag + Magnus lift), bounce (rigid body with friction and spin),
// and roll (rolling resistance + slope). Everything is deterministic and fixed-step so a
// shot can be simulated up front, replayed, shared, and predicted by the aim overlay.
import { clamp } from '../core/math.js';
import { SURFACES, surfaceProps } from './surfaces.js';

export const BALL_MASS = 0.04593;
export const BALL_RADIUS = 0.02135;
export const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;
export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.225;
export const CUP_RADIUS = 0.054;
// Dead-center capture speed for a regulation cup (Holmes, "Putting: How a golf ball and hole interact").
export const CUP_CAPTURE_SPEED = 1.63;

// Aerodynamic model. Coefficients depend on the spin ratio S = omega * r / v.
// Fitted against published tour launch-monitor averages (see scripts/tools/fit-aero.mjs).
export const AERO = {
  cd0: 0.22,
  cd1: 0.25,
  clMax: 0.35,
  clK: 0.1,
  spinDecay: 22, // seconds, exponential time constant
};

const K_AERO = (0.5 * AIR_DENSITY * BALL_AREA) / BALL_MASS;
export const SIM_DT = 1 / 120;

export function aeroCoefficients(spinRatio, aero = AERO) {
  const s = clamp(spinRatio, 0, 1.2);
  return {
    cd: aero.cd0 + aero.cd1 * s,
    cl: (aero.clMax * s) / (aero.clK + s),
  };
}

// Acceleration for the flight phase. axis is the unit spin axis, wind is air velocity.
function flightAccel(vx, vy, vz, wx, wy, wz, spin, ax, ay, az, aero, out) {
  const rx = vx - wx, ry = vy - wy, rz = vz - wz;
  const vr = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (vr < 1e-6) {
    out[0] = 0; out[1] = -GRAVITY; out[2] = 0;
    return;
  }
  const s = (spin * BALL_RADIUS) / vr;
  const sc = s < 0 ? 0 : s > 1.2 ? 1.2 : s;
  const cd = aero.cd0 + aero.cd1 * sc;
  const cl = (aero.clMax * sc) / (aero.clK + sc);
  const kd = K_AERO * cd * vr;
  // Lift direction is axis x relative velocity (unit), magnitude K * cl * vr^2.
  const lx = ay * rz - az * ry;
  const ly = az * rx - ax * rz;
  const lz = ax * ry - ay * rx;
  const kl = K_AERO * cl * vr;
  out[0] = -kd * rx + kl * lx;
  out[1] = -GRAVITY - kd * ry + kl * ly;
  out[2] = -kd * rz + kl * lz;
}

const _a1 = [0, 0, 0], _a2 = [0, 0, 0], _a3 = [0, 0, 0], _a4 = [0, 0, 0];
const _w = { x: 0, y: 0, z: 0 };
const NO_WIND = () => {};

// One RK4 flight step. Mutates s = {x,y,z,vx,vy,vz,spin,ax,ay,az,t}.
export function stepFlight(s, dt, windAt, aero = AERO) {
  _w.x = 0; _w.y = 0; _w.z = 0;
  windAt(s.t, s.y, _w);
  const wx = _w.x, wy = _w.y || 0, wz = _w.z;
  const { ax, ay, az, spin } = s;
  flightAccel(s.vx, s.vy, s.vz, wx, wy, wz, spin, ax, ay, az, aero, _a1);
  const h = dt * 0.5;
  flightAccel(s.vx + _a1[0] * h, s.vy + _a1[1] * h, s.vz + _a1[2] * h, wx, wy, wz, spin, ax, ay, az, aero, _a2);
  flightAccel(s.vx + _a2[0] * h, s.vy + _a2[1] * h, s.vz + _a2[2] * h, wx, wy, wz, spin, ax, ay, az, aero, _a3);
  flightAccel(s.vx + _a3[0] * dt, s.vy + _a3[1] * dt, s.vz + _a3[2] * dt, wx, wy, wz, spin, ax, ay, az, aero, _a4);
  const d6 = dt / 6;
  const nvx = s.vx + d6 * (_a1[0] + 2 * _a2[0] + 2 * _a3[0] + _a4[0]);
  const nvy = s.vy + d6 * (_a1[1] + 2 * _a2[1] + 2 * _a3[1] + _a4[1]);
  const nvz = s.vz + d6 * (_a1[2] + 2 * _a2[2] + 2 * _a3[2] + _a4[2]);
  // Position from the RK4 velocity estimates.
  s.x += d6 * (s.vx + 2 * (s.vx + _a1[0] * h) + 2 * (s.vx + _a2[0] * h) + (s.vx + _a3[0] * dt));
  s.y += d6 * (s.vy + 2 * (s.vy + _a1[1] * h) + 2 * (s.vy + _a2[1] * h) + (s.vy + _a3[1] * dt));
  s.z += d6 * (s.vz + 2 * (s.vz + _a1[2] * h) + 2 * (s.vz + _a2[2] * h) + (s.vz + _a3[2] * dt));
  s.vx = nvx; s.vy = nvy; s.vz = nvz;
  s.spin *= Math.exp(-dt / aero.spinDecay);
  s.t += dt;
}

// Flat, featureless environment used by tests and the range.
export function flatEnv(surface = SURFACES.FAIRWAY, height = 0) {
  return {
    heightAt: () => height,
    normalAt: (x, z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; },
    surfaceAt: () => surface,
    windAt: NO_WIND,
    waterLevel: -Infinity,
    cup: null,
  };
}

function spinAxis(heading, tilt, out) {
  // Pure backspin axis points to the right of travel. Positive tilt curves the ball right.
  const fx = Math.sin(heading), fz = -Math.cos(heading);
  // right = forward x up
  const rx = -fz, rz = fx;
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  out.ax = rx * c;
  out.ay = -sn;
  out.az = rz * c;
}

const _n = { x: 0, y: 1, z: 0 };

/**
 * Simulate a full shot from launch to rest.
 * launch: { x, z, y?, speed, vAngle, heading, spin, axisTilt, putt? }
 * env: { heightAt(x,z), normalAt(x,z,out), surfaceAt(x,z), windAt(t,h,out), waterLevel, cup:{x,z}|null, t0? }
 * Returns { points, events, carry, total, apex, hang, end:{x,y,z}, lie, holed, water, oob, duration }.
 * points is a Float32Array of [t,x,y,z] rows sampled every sampleEvery steps.
 */
export function simulateShot(launch, env, opts = {}) {
  const aero = opts.aero || AERO;
  const dt = SIM_DT;
  const sampleEvery = opts.sampleEvery || 2;
  const maxTime = opts.maxTime || 90;
  const windAt = env.windAt || NO_WIND;
  const t0 = env.t0 || 0;
  const wind = (t, h, out) => windAt(t0 + t, h, out);
  const R = BALL_RADIUS;
  // Terrain reads are sanitized: a non-finite height falls back to the last good one so a
  // bad sample can never poison the trajectory.
  let lastGoodH = 0;
  const rawHeight = env.heightAt;
  const heightAt = (x, z) => {
    const h = rawHeight(x, z);
    if (Number.isFinite(h)) lastGoodH = h;
    return lastGoodH;
  };
  const startGround = heightAt(launch.x, launch.z);
  const s = {
    x: launch.x, y: (launch.y ?? startGround) + R, z: launch.z,
    vx: 0, vy: 0, vz: 0, spin: Math.max(0, launch.spin || 0),
    ax: 1, ay: 0, az: 0, t: 0,
  };
  const pts = [];
  const events = [];
  const push = () => { pts.push(s.t, s.x, s.y, s.z); };
  const result = {
    points: null, events, carry: 0, total: 0, apex: 0, hang: 0,
    carryPoint: null, end: null, lie: SURFACES.ROUGH, holed: false, water: false, oob: false, duration: 0,
  };
  let phase = launch.putt ? 'roll' : 'flight';
  let rvx = 0, rvz = 0; // rolling velocity (horizontal)
  let bounces = 0;
  let steps = 0;
  let apex = s.y;
  let landed = false;

  if (phase === 'flight') {
    const ca = Math.cos(launch.vAngle), sa = Math.sin(launch.vAngle);
    s.vx = launch.speed * ca * Math.sin(launch.heading);
    s.vz = -launch.speed * ca * Math.cos(launch.heading);
    s.vy = launch.speed * sa;
    spinAxis(launch.heading, launch.axisTilt || 0, s);
  } else {
    rvx = launch.speed * Math.sin(launch.heading);
    rvz = -launch.speed * Math.cos(launch.heading);
  }
  push();

  const finish = (type) => {
    const gy = heightAt(s.x, s.z);
    if (type !== 'water') s.y = gy + R;
    events.push({ type, t: s.t, x: s.x, y: s.y, z: s.z });
    push();
  };

  while (s.t < maxTime) {
    steps++;
    if (phase === 'flight') {
      const px = s.x, py = s.y, pz = s.z, pt = s.t;
      const pGap = py - R - heightAt(px, pz);
      stepFlight(s, dt, wind, aero);
      if (s.y > apex) apex = s.y;
      const ground = heightAt(s.x, s.z);
      const gap = s.y - R - ground;
      if (gap <= 0 && s.vy < 0.5) {
        // Interpolate the contact point between the previous and current positions.
        const f = pGap > 0 ? clamp(pGap / (pGap - gap), 0, 1) : 0;
        s.x = px + (s.x - px) * f;
        s.z = pz + (s.z - pz) * f;
        s.t = pt + dt * f;
        const cg = heightAt(s.x, s.z);
        s.y = cg + R;
        const surf = env.surfaceAt(s.x, s.z);
        if (!landed) {
          landed = true;
          result.carry = Math.hypot(s.x - launch.x, s.z - launch.z);
          result.hang = s.t;
          result.carryPoint = { x: s.x, y: cg, z: s.z, surface: surf };
        }
        if (surf === SURFACES.WATER || cg < (env.waterLevel ?? -Infinity)) {
          result.water = true;
          events.push({ type: 'land', t: s.t, x: s.x, y: s.y, z: s.z, surface: SURFACES.WATER, speed: Math.hypot(s.vx, s.vy, s.vz) });
          finish('water');
          break;
        }
        const sp = surfaceProps(surf);
        env.normalAt(s.x, s.z, _n);
        const vn = s.vx * _n.x + s.vy * _n.y + s.vz * _n.z;
        let tx = s.vx - vn * _n.x, ty = s.vy - vn * _n.y, tz = s.vz - vn * _n.z;
        const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
        const impact = Math.abs(vn);
        events.push({ type: bounces === 0 ? 'land' : 'bounce', t: s.t, x: s.x, y: s.y, z: s.z, surface: surf, speed: Math.hypot(s.vx, s.vy, s.vz) });
        // Restitution softens with impact speed (the turf gives).
        const e = sp.restitution * clamp(1 - impact / 45, 0.45, 1);
        // Tangential response: sliding friction impulse, capped at the rolling solution.
        // u is the backspin surface speed. Backspin opposes forward motion at contact.
        const u = s.spin * BALL_RADIUS * Math.max(0, Math.cos(launch.axisTilt || 0));
        const slideDrop = sp.bounceFriction * (1 + e) * impact;
        const rollSolution = (5 * vt - 2 * u * sp.grip) / 7;
        let vtAfter = Math.max(vt - slideDrop, rollSolution);
        // Turf deformation (pitch mark) absorbs forward speed on steep, hard impacts.
        if (vtAfter > 0) vtAfter *= 1 - sp.soft * clamp(impact / 18, 0, 1);
        if (vtAfter < -0.35 * vt - 1.5) vtAfter = -0.35 * vt - 1.5; // limit spin-back
        // Spin lost to the turf.
        s.spin *= clamp(1 - sp.grip * 0.75, 0.05, 1);
        const scale = vt > 1e-6 ? vtAfter / vt : 0;
        tx *= scale; ty *= scale; tz *= scale;
        const vnAfter = -e * vn;
        bounces++;
        if (vnAfter < 0.7 || bounces >= 8 || sp.plug) {
          // Settle into a roll.
          phase = 'roll';
          rvx = tx; rvz = tz;
          if (sp.plug) { rvx *= 0.25; rvz *= 0.25; }
          events.push({ type: 'rollStart', t: s.t, x: s.x, y: s.y, z: s.z, surface: surf });
        } else {
          s.vx = tx + vnAfter * _n.x;
          s.vy = ty + vnAfter * _n.y;
          s.vz = tz + vnAfter * _n.z;
          s.y += 1e-4;
        }
      }
    } else {
      // Roll phase: rolling resistance opposes motion, gravity pulls down the slope.
      const surf = env.surfaceAt(s.x, s.z);
      const gy = heightAt(s.x, s.z);
      if (surf === SURFACES.WATER || gy < (env.waterLevel ?? -Infinity)) {
        result.water = true;
        finish('water');
        break;
      }
      const sp = surfaceProps(surf);
      env.normalAt(s.x, s.z, _n);
      // Tangential gravity for a heightfield normal (nx, ny, nz): g * (nx*ny, nz*ny) horizontally.
      const gxs = GRAVITY * _n.x * _n.y;
      const gzs = GRAVITY * _n.z * _n.y;
      const speed = Math.sqrt(rvx * rvx + rvz * rvz);
      const fr = sp.rollDecel * (opts.rollScale || 1);
      const slopeMag = Math.sqrt(gxs * gxs + gzs * gzs);
      if (speed < 0.06 && slopeMag <= fr * 1.05) {
        finish('stop');
        break;
      }
      let axr = gxs, azr = gzs;
      if (speed > 1e-5) {
        axr -= (fr * rvx) / speed;
        azr -= (fr * rvz) / speed;
      }
      let nvx = rvx + axr * dt, nvz = rvz + azr * dt;
      // Friction cannot reverse the direction of travel within one step.
      if (speed > 1e-5 && slopeMag <= fr && nvx * rvx + nvz * rvz < 0) { nvx = 0; nvz = 0; }
      rvx = nvx; rvz = nvz;
      s.x += rvx * dt;
      s.z += rvz * dt;
      s.y = heightAt(s.x, s.z) + R;
      s.t += dt;
      if (env.cup) {
        const dx = s.x - env.cup.x, dz = s.z - env.cup.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < CUP_RADIUS) {
          const sp2 = Math.sqrt(rvx * rvx + rvz * rvz);
          const cap = CUP_CAPTURE_SPEED * Math.sqrt(Math.max(0, 1 - (d / CUP_RADIUS) * (d / CUP_RADIUS)));
          if (sp2 <= cap) {
            result.holed = true;
            s.x = env.cup.x; s.z = env.cup.z;
            s.y = heightAt(s.x, s.z) - 0.06;
            events.push({ type: 'holed', t: s.t, x: s.x, y: s.y, z: s.z });
            push();
            break;
          }
          // Lip out: the cup edge deflects and slows the ball once.
          if (!s.lipped) {
            s.lipped = true;
            const side = dx * rvz - dz * rvx > 0 ? 1 : -1;
            const ang = side * 0.35 * (1 - d / CUP_RADIUS + 0.3);
            const c = Math.cos(ang), sn = Math.sin(ang);
            const ox = rvx * c - rvz * sn, oz = rvx * sn + rvz * c;
            rvx = ox * 0.72; rvz = oz * 0.72;
            events.push({ type: 'lip', t: s.t, x: s.x, y: s.y, z: s.z });
          }
        }
      }
      if (env.bounds && (s.x < env.bounds.minX || s.x > env.bounds.maxX || s.z < env.bounds.minZ || s.z > env.bounds.maxZ)) {
        result.oob = true;
        finish('oob');
        break;
      }
    }
    if (env.bounds && phase === 'flight' && (s.x < env.bounds.minX - 80 || s.x > env.bounds.maxX + 80 || s.z < env.bounds.minZ - 80 || s.z > env.bounds.maxZ + 80)) {
      result.oob = true;
      finish('oob');
      break;
    }
    if (steps % sampleEvery === 0) push();
    if (!Number.isFinite(s.x + s.y + s.z + s.vx + s.vy + s.vz + rvx + rvz)) {
      // Never propagate a NaN. Stop the ball at the last sampled good position.
      const n = pts.length;
      s.x = pts[n - 3]; s.y = pts[n - 2]; s.z = pts[n - 1]; s.t = pts[n - 4];
      result.nan = true;
      finish('stop');
      break;
    }
  }
  if (s.t >= maxTime && events[events.length - 1]?.type !== 'stop') finish('stop');
  if (!landed) {
    result.carry = Math.hypot(s.x - launch.x, s.z - launch.z);
    result.hang = launch.putt ? 0 : s.t;
  }
  result.points = new Float32Array(pts);
  result.apex = apex - (startGround + R);
  result.total = Math.hypot(s.x - launch.x, s.z - launch.z);
  result.end = { x: s.x, y: s.y, z: s.z };
  result.duration = s.t;
  result.lie = result.water ? SURFACES.WATER : env.surfaceAt(s.x, s.z);
  if (env.isOutOfBounds && !result.water && !result.holed && env.isOutOfBounds(s.x, s.z)) result.oob = true;
  return result;
}

// Position along a simulated trajectory at time t. Writes into out {x,y,z}.
export function samplePath(points, t, out) {
  const n = points.length / 4;
  if (n === 0) return out;
  if (t <= points[0]) { out.x = points[1]; out.y = points[2]; out.z = points[3]; return out; }
  const last = (n - 1) * 4;
  if (t >= points[last]) { out.x = points[last + 1]; out.y = points[last + 2]; out.z = points[last + 3]; return out; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid * 4] <= t) lo = mid; else hi = mid;
  }
  const a = lo * 4, b = hi * 4;
  const span = points[b] - points[a];
  const f = span > 1e-9 ? (t - points[a]) / span : 0;
  out.x = points[a + 1] + (points[b + 1] - points[a + 1]) * f;
  out.y = points[a + 2] + (points[b + 2] - points[a + 2]) * f;
  out.z = points[a + 3] + (points[b + 3] - points[a + 3]) * f;
  return out;
}
