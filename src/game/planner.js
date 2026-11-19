// Shot planning on real terrain: the nominal prediction behind the aim overlay, the putt
// solver behind the putt line and break readout, the water drop point, and the AI's choice of
// club, aim, and swing. Pure functions over the terrain and physics, so they are testable and
// the AI plays by exactly the same ball model as the player.
import { simulateShot } from '../physics/ball.js';
import { computeLaunch, suggestClub, nominalCarry, SHOT_TYPES, BASE_PROFILE, MAX_PUTT_SPEED, dispersion } from '../physics/shot.js';
import { CLUBS, PUTTER } from '../physics/clubs.js';
import { SURFACES } from '../physics/surfaces.js';
import { clamp, headingTo, wrapAngle, DEG } from '../core/math.js';
import { pointAt } from '../course/layout.js';
import { applySpin } from './spin.js';
import { shotData, shotFitsData, shotPower, SPLASH_RANGE } from '../data/shotTypes.js';

const CLEAN = { face: 0, path: 0, tempoQuality: 1 };

// Simulate a shot from a swing and context on this terrain. windAt may be omitted.
// ctx.spin is the ball-contact dot (game/spin.js); without it the launch is the plain one.
export function simulateFrom(terrain, swing, ctx, windAt, t0 = 0) {
  let launch = computeLaunch(swing, ctx);
  if (ctx.spin) launch = applySpin(launch, ctx.spin, ctx);
  const env = terrain.env(windAt ? { windAt, t0 } : {});
  const r = simulateShot(launch, env);
  r.launch = launch;
  return r;
}

// The nominal (error-free) result for the current aim, club, and power.
export function predictShot(terrain, { x, z, lie, club, shotType, aim, power = 1, profile = BASE_PROFILE, spin = null }, windAt, t0 = 0) {
  return simulateFrom(terrain, { ...CLEAN, power }, { club, shotType, lie, aim, x, z, profile, lieRoll: 0, spin }, windAt, t0);
}

// Putting uses a speed ceiling scaled to the putt at hand, so the stick has useful resolution
// on a 3 foot putt and a 60 foot putt alike. Full power sends the ball about 1.8 times as far
// as the hole on level ground.
// needed is the pace the putt solver found: an uphill putt needs more than level ground does,
// and the ceiling must always leave room above it or the hole would be out of reach.
// Power (0..1) that sends the ball the right distance toward `target`, found by bisection on
// the same prediction the aim overlay draws. mode 'carry' lands short of the target by part of
// the expected roll (approach shots), 'end' finishes at the target (chips and layups).
export function solvePower(terrain, shot, windAt, t0, target, mode = 'carry') {
  const want = Math.hypot(target.x - shot.x, target.z - shot.z);
  const fx = Math.sin(shot.aim), fz = -Math.cos(shot.aim);
  const reach = (power) => {
    const r = predictShot(terrain, { ...shot, power }, windAt, t0);
    const ref = mode === 'end' ? r.end : (r.carryPoint || r.end);
    const along = (ref.x - shot.x) * fx + (ref.z - shot.z) * fz;
    return mode === 'end' ? along : along + Math.min(6, Math.max(0, r.total - r.carry) * 0.5);
  };
  // The stick ignores swings shallower than 6 percent, so never suggest less than 7.
  let lo = 0.07, hi = 1;
  if (reach(hi) <= want) return 1;
  if (reach(lo) >= want) return lo;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < want) lo = mid; else hi = mid;
  }
  return clamp((lo + hi) / 2, 0.07, 1);
}

export function puttCeiling(distance, needed = 0) {
  const level = Math.sqrt(2 * 0.549 * (distance * 1.8 + 1.2));
  return clamp(Math.max(level, needed * 1.45), 1.4, MAX_PUTT_SPEED);
}

export function simulatePutt(terrain, from, heading, speed) {
  return simulateShot({ x: from.x, z: from.z, speed, heading, putt: true }, terrain.env());
}

/**
 * Find the heading and speed that hole a putt (or leave it closest), by searching headings
 * around the direct line and bisecting on speed for each. Returns
 * { heading, speed, holed, breakM (lateral aim offset at the hole, + is right), elevation, miss }.
 */
export function solvePutt(terrain, from, pin = terrain.pin) {
  const dist = Math.hypot(pin.x - from.x, pin.z - from.z);
  const direct = headingTo(from.x, from.z, pin.x, pin.z);
  const elevation = terrain.heightAt(pin.x, pin.z) - terrain.heightAt(from.x, from.z);
  if (dist < 0.02) return { heading: direct, speed: 0.3, holed: true, breakM: 0, elevation, miss: 0, distance: dist };
  // Iterate like a golfer reading a putt: roll one, see where it passed the hole and how far
  // it ran, then correct the line by the angular miss and the pace by the over or under run.
  let best = null;
  let h = direct;
  let v = Math.sqrt(Math.max(0.3, 2 * 0.549 * (dist + 0.3) + 2 * 9.81 * Math.max(-dist * 0.03, elevation)));
  for (let it = 0; it < 18; it++) {
    v = clamp(v, 0.25, MAX_PUTT_SPEED);
    const r = simulatePutt(terrain, from, h, v);
    const p = r.points;
    let dmin = 1e9, cx = from.x, cz = from.z, ck = 0;
    for (let k = 0; k < p.length; k += 4) {
      const d = Math.hypot(p[k + 1] - pin.x, p[k + 3] - pin.z);
      if (d < dmin) { dmin = d; cx = p[k + 1]; cz = p[k + 3]; ck = k; }
    }
    const endMiss = r.holed ? 0 : Math.hypot(r.end.x - pin.x, r.end.z - pin.z);
    const cand = { heading: h, speed: v, holed: r.holed, miss: endMiss };
    if (!best || (cand.holed && !best.holed) || (cand.holed === best.holed && cand.miss < best.miss)) best = cand;
    if (r.holed) break;
    // Line: turn by the angle between where the ball passed and where the hole is.
    const turn = wrapAngle(headingTo(from.x, from.z, pin.x, pin.z) - headingTo(from.x, from.z, cx, cz));
    h += clamp(turn, -0.25, 0.25) * 0.85;
    // Pace: short if the closest point is where it stopped, otherwise judge the run past.
    const stoppedShort = ck >= p.length - 8;
    if (stoppedShort) v *= 1 + clamp((dmin + 0.3) / Math.max(dist, 0.5), 0.02, 0.6) * 0.55;
    else {
      const past = Math.hypot(r.end.x - cx, r.end.z - cz);
      v *= clamp(1 - ((past - 0.35) / (dist + past + 0.5)) * 0.5, 0.75, 1.06);
    }
  }
  const off = wrapAngle(best.heading - direct);
  return { ...best, breakM: Math.tan(off) * dist, elevation, distance: dist };
}

// Where to drop after a water ball: the last point of the shot's path over dry land, pulled
// back a little toward where it was hit from, and never closer to the hole than that.
export function dropPoint(terrain, result, from) {
  const p = result.points;
  for (let i = p.length - 4; i >= 0; i -= 4) {
    const x = p[i + 1], z = p[i + 2 + 1];
    if (!terrain.inBounds(x, z, 8)) continue;
    const s = terrain.surfaceAt(x, z);
    if (s === SURFACES.WATER) continue;
    const dx = from.x - x, dz = from.z - z, l = Math.hypot(dx, dz) || 1;
    for (const back of [3, 6, 10, 0]) {
      const bx = x + (dx / l) * Math.min(back, l), bz = z + (dz / l) * Math.min(back, l);
      const bs = terrain.surfaceAt(bx, bz);
      if (bs !== SURFACES.WATER && terrain.inBounds(bx, bz, 8)) return { x: bx, z: bz, lie: bs === SURFACES.GREEN ? SURFACES.FRINGE : bs };
    }
  }
  return { x: from.x, z: from.z, lie: from.lie };
}

const playable = (c, lie) => !c.putter && !(c.id === 'DR' && lie !== SURFACES.TEE) && !(c.kind === 'wood' && (lie === SURFACES.DEEP_ROUGH || lie === SURFACES.BUNKER || lie === SURFACES.WETLAND));
export function maxCarryFrom(lie, profile = BASE_PROFILE) {
  let best = 0;
  for (const c of CLUBS) if (playable(c, lie)) best = Math.max(best, nominalCarry(c, profile));
  return best;
}

// Where a sensible player aims: the pin if it is reachable, otherwise the furthest safe spot
// on the fairway centerline.
export function chooseTarget(terrain, from, lie, profile = BASE_PROFILE) {
  const pin = terrain.pin, hole = terrain.hole;
  const toPin = Math.hypot(pin.x - from.x, pin.z - from.z);
  const reach = maxCarryFrom(lie, profile) * 0.98;
  if (toPin <= reach + 8) return { x: pin.x, z: pin.z, layup: false, distance: toPin };
  const sNow = terrain.sAt(from.x, from.z);
  const P = {};
  let pick = null;
  for (let s = Math.min(hole.length, sNow + reach); s > sNow + 30; s -= 6) {
    pointAt(hole.line, s, P);
    const d = Math.hypot(P.x - from.x, P.z - from.z);
    if (d > reach) continue;
    const surf = terrain.surfaceAt(P.x, P.z);
    if (surf === SURFACES.FAIRWAY || surf === SURFACES.FIRST_CUT) { pick = { x: P.x, z: P.z, layup: true, distance: d }; break; }
    if (!pick && surf !== SURFACES.WATER && surf !== SURFACES.BUNKER) pick = { x: P.x, z: P.z, layup: true, distance: d };
  }
  return pick || { x: pin.x, z: pin.z, layup: false, distance: toPin };
}

/**
 * The AI's plan for one shot. skill 0..1. rng supplies the human-like error.
 * Returns { club, shotType, aim, swing, target }.
 */
// shots: true lets the plan use the shot types (data/shotTypes.js): a splash from a greenside
// bunker, a pitch from 30 to 70 meters, a stinger off the tee and a knockdown approach into a
// strong wind. The balance runs leave it off, so their numbers compare across builds.
export function aiPlan(terrain, from, lie, { skill = 0.6, rng, windAt, t0 = 0, profile = BASE_PROFILE, shots = false } = {}) {
  const pin = terrain.pin;
  const g = () => (rng ? rng.gauss() : 0);
  const sk = clamp(skill, 0, 1);
  if (lie === SURFACES.GREEN) {
    const sol = solvePutt(terrain, from, pin);
    const ceil = puttCeiling(sol.distance, sol.speed);
    // Better players read the line and pace more exactly.
    const heading = sol.heading + g() * (0.7 + (1 - sk) * 2.4) * DEG;
    const speed = sol.speed * (1 + g() * (0.06 + (1 - sk) * 0.12));
    return { club: PUTTER, shotType: SHOT_TYPES.PUTT, aim: heading, swing: { power: clamp(speed / ceil, 0.03, 1), face: 0, path: 0, tempoQuality: 1 }, target: pin, puttCeiling: ceil };
  }
  const target = chooseTarget(terrain, from, lie, profile);
  const dist = Math.hypot(target.x - from.x, target.z - from.z);
  let nearGreen = !target.layup && dist < 32 && lie !== SURFACES.BUNKER;
  let shotType = nearGreen ? SHOT_TYPES.CHIP : SHOT_TYPES.FULL;
  let pick;
  const special = shots ? aiShot(terrain, from, lie, target, dist, { windAt, t0, profile }) : null;
  if (special) {
    shotType = special.shotType; pick = { club: special.club, power: special.power };
    if (special.toEnd) nearGreen = true;
  } else if (nearGreen) {
    // Chip: choose the club and power whose predicted total distance matches.
    const club = CLUBS.find((c) => c.id === (dist < 14 ? 'SW' : 'PW'));
    pick = { club, power: clamp(dist / 34 + 0.12, 0.12, 1) };
  } else {
    const elev = terrain.heightAt(target.x, target.z) - terrain.heightAt(from.x, from.z);
    pick = suggestClub(Math.max(8, dist + elev * 0.9), { lie, profile });
  }
  let aim = headingTo(from.x, from.z, target.x, target.z);
  let power = pick.power;
  // Two rounds of correction against the real terrain and wind: see where the clean shot
  // finishes and move the aim and power by the miss.
  for (let i = 0; i < 2; i++) {
    const r = predictShot(terrain, { x: from.x, z: from.z, lie, club: pick.club, shotType, aim, power, profile }, windAt, t0);
    const ref = nearGreen || lie === SURFACES.GREEN ? r.end : (r.carryPoint || r.end);
    const got = Math.hypot(ref.x - from.x, ref.z - from.z);
    const gotH = headingTo(from.x, from.z, ref.x, ref.z);
    aim = wrapAngle(aim - wrapAngle(gotH - headingTo(from.x, from.z, target.x, target.z)) * 0.9);
    const want = nearGreen ? dist : dist - (target.layup ? 0 : Math.min(6, (r.total - r.carry) * 0.5));
    if (got > 1) power = clamp(power * Math.pow(want / got, 0.8), 0.08, 1);
    if (shotType.id !== 'full' && shotType.id !== 'chip') power = shotPower(shotData(shotType.id), power);
  }
  const d = dispersion(pick.club, lie, { profile, shotType });
  const err = 0.7 + (1 - sk) * 1.6;
  const swing = {
    power: clamp(power * (1 + g() * d.distFrac * err), 0.05, 1),
    face: clamp(g() * d.lateralDeg * 0.55 * err, -7, 7),
    path: clamp(g() * d.lateralDeg * 0.25 * err, -5, 5),
    tempoQuality: clamp(1 - Math.abs(g()) * (1 - sk) * 0.5, 0.3, 1),
  };
  return { club: pick.club, shotType, aim, swing, target };
}

// The AI's shot type, when one fits better than a full swing or a chip. Returns null for the
// default plan, or { shotType, club, power, toEnd }.
function aiShot(terrain, from, lie, target, dist, { windAt, t0, profile }) {
  const club = (id) => CLUBS.find((c) => c.id === id);
  const fits = (id, clubId) => shotFitsData(shotData(id), clubId, lie);
  // A greenside bunker: splash it out with the sand wedge.
  if (lie === SURFACES.BUNKER && !target.layup && dist < SPLASH_RANGE && fits('splash', 'SW')) return { shotType: shotData('splash'), club: club('SW'), power: clamp(dist / 48 + 0.18, 0.15, 1), toEnd: true };
  // A pitch from 30 to 70 meters: a wedge that carries most of the way and checks.
  if (!target.layup && dist >= 30 && dist < 70) {
    const id = dist < 45 ? 'SW' : dist < 58 ? 'GW' : 'PW';
    if (fits('pitch', id)) return { shotType: shotData('pitch'), club: club(id), power: clamp(dist / 80 + 0.2, 0.2, 1), toEnd: false };
  }
  // Into a strong wind: a stinger off the tee with a long club, or a knockdown approach.
  if (windAt) {
    const w = { x: 0, y: 0, z: 0 };
    windAt(t0, 10, w);
    const a = headingTo(from.x, from.z, target.x, target.z), fx = Math.sin(a), fz = -Math.cos(a);
    const along = (w.x || 0) * fx + (w.z || 0) * fz;
    if (along < -5.5) {
      if (lie === SURFACES.TEE && dist > 170) {
        const pick = suggestClub(dist, { lie, profile });
        if (pick.club && fits('stinger', pick.club.id)) return { shotType: shotData('stinger'), club: pick.club, power: 1, toEnd: false };
      }
      if (dist > 90 && dist < 175) {
        // One more club, swung three-quarter.
        const pick = suggestClub(dist / 0.8, { lie, profile });
        if (pick.club && fits('knockdown', pick.club.id)) return { shotType: shotData('knockdown'), club: pick.club, power: 0.8, toEnd: false };
      }
    }
  }
  return null;
}

// Play one hole start to finish with the AI, with no rendering. Used by tests (it proves a
// hole can always be finished on the real terrain) and to resolve unseen opponents quickly.
export function playHoleAI(terrain, { skill = 0.7, rng, windAt, par = terrain.hole.par, cap = par + 5 } = {}) {
  let pos = { x: terrain.tee.x, z: terrain.tee.z }, lie = SURFACES.TEE;
  let strokes = 0, putts = 0, penalties = 0, t0 = 0;
  const log = [];
  while (strokes < cap) {
    const plan = aiPlan(terrain, pos, lie, { skill, rng, windAt, t0 });
    let r;
    if (plan.club.putter) r = simulatePutt(terrain, pos, plan.aim, plan.swing.power * plan.puttCeiling);
    else r = simulateFrom(terrain, plan.swing, { club: plan.club, shotType: plan.shotType, lie, aim: plan.aim, x: pos.x, z: pos.z, lieRoll: rng ? rng.range(-1, 1) : 0 }, windAt, t0);
    strokes++;
    if (plan.club.putter) putts++;
    t0 += r.duration + 20;
    log.push({ club: plan.club.id, from: lie, to: r.lie, total: r.total, holed: r.holed, water: r.water, oob: r.oob });
    if (r.nan) return { strokes: cap, putts, penalties, log, error: 'nan' };
    if (r.holed) return { strokes, putts, penalties, log, holed: true };
    if (r.oob) { strokes++; penalties++; continue; }
    if (r.water) { strokes++; penalties++; const d = dropPoint(terrain, r, { ...pos, lie }); pos = { x: d.x, z: d.z }; lie = d.lie; continue; }
    pos = { x: r.end.x, z: r.end.z }; lie = r.lie;
  }
  return { strokes: cap, putts, penalties, log, pickedUp: true };
}
