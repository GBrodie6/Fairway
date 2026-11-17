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

const CLEAN = { face: 0, path: 0, tempoQuality: 1 };

// Simulate a shot from a swing and context on this terrain. windAt may be omitted.
export function simulateFrom(terrain, swing, ctx, windAt, t0 = 0) {
  const launch = computeLaunch(swing, ctx);
  const env = terrain.env(windAt ? { windAt, t0 } : {});
  const r = simulateShot(launch, env);
  r.launch = launch;
  return r;
}

// The nominal (error-free) result for the current aim, club, and power.
export function predictShot(terrain, { x, z, lie, club, shotType, aim, power = 1, profile = BASE_PROFILE }, windAt, t0 = 0) {
  return simulateFrom(terrain, { ...CLEAN, power }, { club, shotType, lie, aim, x, z, profile, lieRoll: 0 }, windAt, t0);
}

// Putting uses a speed ceiling scaled to the putt at hand, so the stick has useful resolution
// on a 3 foot putt and a 60 foot putt alike. Full power sends the ball about 1.8 times as far
// as the hole on level ground.
// needed is the pace the putt solver found: an uphill putt needs more than level ground does,
// and the ceiling must always leave room above it or the hole would be out of reach.
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
  let best = null;
  const span = clamp(0.9 / Math.max(dist, 0.6), 0.06, 0.5); // radians either side of the direct line
  const evalAt = (h) => {
    // Bisect speed so the ball would stop about 35 cm past the hole if it missed.
    let lo = 0.2, hi = MAX_PUTT_SPEED, pick = null;
    for (let i = 0; i < 16; i++) {
      const v = (lo + hi) / 2;
      const r = simulatePutt(terrain, from, h, v);
      const fx = Math.sin(direct), fz = -Math.cos(direct);
      const along = (r.end.x - from.x) * fx + (r.end.z - from.z) * fz;
      const miss = Math.hypot(r.end.x - pin.x, r.end.z - pin.z);
      const cand = { heading: h, speed: v, holed: r.holed, miss: r.holed ? 0 : miss };
      if (!pick || cand.miss < pick.miss || (cand.holed && !pick.holed)) pick = cand;
      if (r.holed) { hi = v; if (hi - lo < 0.02) break; continue; }
      if (along < dist + 0.35) lo = v; else hi = v;
    }
    return pick;
  };
  const N = 9;
  for (let pass = 0; pass < 2; pass++) {
    const center = best ? best.heading : direct, width = pass === 0 ? span : span / N * 1.5;
    for (let i = 0; i < N; i++) {
      const h = center + (i / (N - 1) - 0.5) * 2 * width;
      const c = evalAt(h);
      // Prefer holed putts, then the smallest miss, then the gentlest pace.
      if (!best || (c.holed && !best.holed) || (c.holed === best.holed && c.miss < best.miss - 1e-4)) best = c;
    }
    if (best.holed && pass === 0) continue;
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
export function aiPlan(terrain, from, lie, { skill = 0.6, rng, windAt, t0 = 0, profile = BASE_PROFILE } = {}) {
  const pin = terrain.pin;
  const g = () => (rng ? rng.gauss() : 0);
  const sk = clamp(skill, 0, 1);
  if (lie === SURFACES.GREEN) {
    const sol = solvePutt(terrain, from, pin);
    const ceil = puttCeiling(sol.distance, sol.speed);
    // Better players read the line and pace more exactly.
    const heading = sol.heading + g() * (0.25 + (1 - sk) * 1.5) * DEG;
    const speed = sol.speed * (1 + g() * (0.03 + (1 - sk) * 0.07));
    return { club: PUTTER, shotType: SHOT_TYPES.PUTT, aim: heading, swing: { power: clamp(speed / ceil, 0.03, 1), face: 0, path: 0, tempoQuality: 1 }, target: pin, puttCeiling: ceil };
  }
  const target = chooseTarget(terrain, from, lie, profile);
  const dist = Math.hypot(target.x - from.x, target.z - from.z);
  const nearGreen = !target.layup && dist < 32 && lie !== SURFACES.BUNKER;
  const shotType = nearGreen ? SHOT_TYPES.CHIP : SHOT_TYPES.FULL;
  let pick;
  if (nearGreen) {
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
  }
  const d = dispersion(pick.club, lie, { profile, shotType });
  const err = 0.35 + (1 - sk) * 1.25;
  const swing = {
    power: clamp(power * (1 + g() * d.distFrac * err), 0.05, 1),
    face: clamp(g() * d.lateralDeg * 0.55 * err, -7, 7),
    path: clamp(g() * d.lateralDeg * 0.25 * err, -5, 5),
    tempoQuality: clamp(1 - Math.abs(g()) * (1 - sk) * 0.5, 0.3, 1),
  };
  return { club: pick.club, shotType, aim, swing, target };
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
