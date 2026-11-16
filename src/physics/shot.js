// Swing math: turns a swing result (power, face, path, tempo) plus club, lie, shot type, and
// player profile into launch conditions for the ball model. Pure functions.
import { clamp, DEG } from '../core/math.js';
import { surfaceProps, SURFACES } from './surfaces.js';
import { CLUBS, PUTTER } from './clubs.js';
import { simulateShot, flatEnv } from './ball.js';

export const SHOT_TYPES = Object.freeze({
  FULL: { id: 'full', name: 'Full', speed: 1, launch: 1, spin: 1 },
  PUNCH: { id: 'punch', name: 'Punch', speed: 0.9, launch: 0.58, spin: 0.75 },
  FLOP: { id: 'flop', name: 'Flop', speed: 0.72, launch: 1.4, spin: 1.05, wedgeOnly: true },
  CHIP: { id: 'chip', name: 'Chip', speed: 0.42, launch: 0.62, spin: 0.5 },
  PUTT: { id: 'putt', name: 'Putt', speed: 1, launch: 0, spin: 0 },
});
export const shotTypeById = (id) => Object.values(SHOT_TYPES).find((s) => s.id === id) || SHOT_TYPES.FULL;

// A neutral profile. Career attributes and equipment produce other profiles, but tests of the
// base carry ladder always run against this one.
export const BASE_PROFILE = Object.freeze({
  power: 1, // ball speed multiplier
  accuracy: 1, // face and path error multiplier (lower is better)
  spin: 1, // backspin multiplier
  touch: 1, // short game dispersion multiplier
  putting: 1, // putt face error multiplier
  recovery: 1, // scales the penalty from bad lies (lower is better)
  forgiveness: 1, // tempo error multiplier
});

// Ball speed as a fraction of full for a given power fraction. Linear, with a floor so a tiny
// swing still moves the ball.
export function powerToSpeedFactor(power) {
  const p = clamp(power, 0, 1.1);
  return 0.3 + 0.7 * p;
}

export const MAX_PUTT_SPEED = 9.0; // m/s at 100 percent, about a 240 ft putt on a stimp 10 green
export function puttSpeed(power) {
  const p = clamp(power, 0, 1);
  // Squared response gives fine control on short putts.
  return MAX_PUTT_SPEED * (0.1 * p + 0.9 * p * p);
}
// Inverse of puttSpeed for assist readouts and AI.
export function puttPowerForSpeed(v) {
  const s = clamp(v / MAX_PUTT_SPEED, 0, 1);
  // 0.9 p^2 + 0.1 p - s = 0
  return clamp((-0.1 + Math.sqrt(0.01 + 3.6 * s)) / 1.8, 0, 1);
}

/**
 * computeLaunch: deterministic given the same inputs and lieRoll.
 * swing: { power 0..1, face deg, path deg, tempoQuality 0..1 }
 * ctx: { club, shotType, lie (surface id), aim (heading rad), x, z, profile, lieRoll (-1..1) }
 */
export function computeLaunch(swing, ctx) {
  const club = ctx.club || CLUBS[0];
  const profile = ctx.profile || BASE_PROFILE;
  const lie = surfaceProps(ctx.lie ?? SURFACES.FAIRWAY);
  const type = club.putter ? SHOT_TYPES.PUTT : (ctx.shotType || SHOT_TYPES.FULL);
  const tq = clamp(swing.tempoQuality ?? 1, 0, 1);
  const face = (swing.face || 0) * profile.accuracy;
  const path = (swing.path || 0) * profile.accuracy;
  if (club.putter) {
    const pf = face * profile.putting;
    return {
      x: ctx.x, z: ctx.z, putt: true,
      speed: puttSpeed(swing.power) * (0.97 + 0.03 * tq),
      vAngle: 0, spin: 0, axisTilt: 0,
      heading: ctx.aim + pf * 0.45 * DEG,
    };
  }
  const lieRoll = clamp(ctx.lieRoll ?? 0, -1, 1);
  const rec = profile.recovery;
  const onTee = ctx.lie === SURFACES.TEE;
  // Woods struggle more from bad lies than wedges do.
  const clubLie = club.kind === 'wood' && !onTee ? 1.35 : club.kind === 'wedge' ? 0.8 : 1;
  const loss = clamp((lie.powerLoss + lie.powerVar * lieRoll) * rec * clubLie, 0, 0.85);
  const tempoLoss = (1 - tq) * 0.08 * profile.forgiveness;
  const speed = club.speed * profile.power * powerToSpeedFactor(swing.power) * type.speed * (1 - loss) * (1 - tempoLoss);
  // A poor tempo also opens the face a little in the direction it was already going.
  const faceEff = face * (1 + (1 - tq) * 0.6 * profile.forgiveness);
  const spin = club.spin * profile.spin * type.spin * powerToSpeedFactor(swing.power) * lie.spinKeep;
  const tilt = clamp((faceEff - path) * club.tiltGain * DEG, -35 * DEG, 35 * DEG);
  const startWeight = club.kind === 'wood' ? 0.82 : 0.75;
  const heading = ctx.aim + (startWeight * faceEff + (1 - startWeight) * path) * DEG;
  let vAngle = club.launchRad * type.launch;
  // Bunker and deep rough lies launch a touch higher with less speed.
  if (ctx.lie === SURFACES.BUNKER) vAngle *= 1.08;
  return { x: ctx.x, z: ctx.z, speed, vAngle, heading, spin, axisTilt: tilt, putt: false };
}

// Expected dispersion (one sigma) for the aim overlay and the AI: lateral degrees and
// distance fraction. Reflects lie, club, shot type, and wind strength.
export function dispersion(club, lieId, { windMps = 0, profile = BASE_PROFILE, shotType = SHOT_TYPES.FULL } = {}) {
  const lie = surfaceProps(lieId);
  if (club.putter) return { lateralDeg: 0.6 * profile.putting, distFrac: 0.035 * profile.putting };
  const base = club.kind === 'wood' ? 2.6 : club.kind === 'iron' ? 2.0 : 1.5;
  const windFactor = 1 + clamp(windMps / 9, 0, 1.2) * 0.5;
  const typeFactor = shotType.id === 'chip' ? 0.7 * profile.touch : shotType.id === 'flop' ? 1.3 * profile.touch : 1;
  return {
    lateralDeg: base * lie.spread * windFactor * typeFactor * profile.accuracy,
    distFrac: (0.03 + lie.powerVar + 0.01 * (lie.spread - 1)) * windFactor * typeFactor,
  };
}

// Full-carry lookup on flat calm ground for a profile, used by club suggestion. Cached.
const carryCache = new Map();
export function nominalCarry(club, profile = BASE_PROFILE, shotType = SHOT_TYPES.FULL, power = 1) {
  if (club.putter) return 0;
  const key = `${club.id}|${shotType.id}|${power.toFixed(3)}|${profile.power.toFixed(4)}|${profile.spin.toFixed(4)}`;
  let v = carryCache.get(key);
  if (v === undefined) {
    const launch = computeLaunch({ power, face: 0, path: 0, tempoQuality: 1 }, { club, shotType, lie: SURFACES.FAIRWAY, aim: 0, x: 0, z: 0, profile });
    v = simulateShot(launch, flatEnv()).carry;
    carryCache.set(key, v);
  }
  return v;
}

// Choose the club (and power) that best reaches a carry distance in meters.
export function suggestClub(distance, { lie = SURFACES.FAIRWAY, profile = BASE_PROFILE, onGreen = false, allowDriver = true } = {}) {
  if (onGreen) return { club: PUTTER, power: 1 };
  const lp = surfaceProps(lie);
  const eff = distance / Math.max(0.2, 1 - lp.powerLoss);
  let best = null;
  for (const c of CLUBS) {
    if (c.putter) continue;
    if (c.id === 'DR' && (!allowDriver || (lie !== SURFACES.TEE))) continue;
    if (c.kind === 'wood' && (lie === SURFACES.DEEP_ROUGH || lie === SURFACES.BUNKER || lie === SURFACES.WETLAND)) continue;
    const full = nominalCarry(c, profile);
    // Prefer the shortest club whose full carry covers the distance.
    if (full >= eff * 0.985) {
      if (!best || full < best.full) best = { club: c, full };
    }
  }
  if (!best) {
    // Out of range: take the longest allowed club.
    for (const c of CLUBS) {
      if (c.putter) continue;
      if (c.id === 'DR' && lie !== SURFACES.TEE) continue;
      if (c.kind === 'wood' && (lie === SURFACES.DEEP_ROUGH || lie === SURFACES.BUNKER || lie === SURFACES.WETLAND)) continue;
      const full = nominalCarry(c, profile);
      if (!best || full > best.full) best = { club: c, full };
    }
    return { club: best.club, power: 1 };
  }
  // carry scales close to linearly with the speed factor, so invert it for a starting power.
  const ratio = clamp(eff / best.full, 0, 1);
  const power = clamp((Math.pow(ratio, 0.62) - 0.3) / 0.7, 0.05, 1);
  return { club: best.club, power };
}
