// Aim math. Headings follow the shared convention: 0 is -Z, positive turns toward +X.
import { clamp, wrapAngle, headingTo, dist2, DEG } from '../core/math.js';

export function aimAtTarget(from, target) {
  return headingTo(from.x, from.z, target.x, target.z);
}

export function aimPoint(from, heading, distance, out = {}) {
  out.x = from.x + Math.sin(heading) * distance;
  out.z = from.z - Math.cos(heading) * distance;
  return out;
}

// Convert a horizontal drag in pixels to a change in heading. A full-width drag sweeps
// sweepDeg degrees at sensitivity 1. Fine mode divides by 5.
export function dragToAimDelta(dxPixels, viewportWidth, { sensitivity = 1, sweepDeg = 70, fine = false } = {}) {
  if (!Number.isFinite(dxPixels) || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  const frac = dxPixels / viewportWidth;
  return frac * sweepDeg * DEG * clamp(sensitivity, 0.1, 4) * (fine ? 0.2 : 1);
}

export function nudgeAim(heading, steps, stepDeg = 0.5) {
  return wrapAngle(heading + steps * stepDeg * DEG);
}

// Keep the aim within a cone around the line to the pin so a stray drag cannot face backward.
export function clampAim(heading, reference, maxOffDeg = 100) {
  const off = wrapAngle(heading - reference);
  return wrapAngle(reference + clamp(off, -maxOffDeg * DEG, maxOffDeg * DEG));
}

export function distanceBetween(a, b) {
  return dist2(a.x, a.z, b.x, b.z);
}

// Signed lateral miss (meters, positive is right of the line) and long/short relative to a target.
export function missFromLine(from, heading, target, landing) {
  const fx = Math.sin(heading), fz = -Math.cos(heading);
  const rx = -fz, rz = fx;
  const dx = landing.x - target.x, dz = landing.z - target.z;
  return { lateral: dx * rx + dz * rz, long: dx * fx + dz * fz };
}

// Elevation-adjusted "plays like" distance: a rule of thumb used for club suggestion readouts.
export function playsLike(distance, elevationChange, windAlongMps = 0) {
  return Math.max(0, distance + elevationChange * 1.0 - windAlongMps * distance * 0.011);
}
