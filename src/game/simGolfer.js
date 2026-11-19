// A simulated golfer for the balance runs (scripts/sim). It plans like the AI (target, club,
// power, aim from the planner), swings like a person with an average swing (power, face, path
// and tempo errors), and every shot goes through the same path as a real one: computeLaunch
// with the golfer's profile, the strike model with the club's tier and the golfer's perks,
// then the unchanged simulation. Putts use the same launch the controller builds.
import { aiPlan, solvePutt, puttCeiling, dropPoint } from './planner.js';
import { computeLaunch } from '../physics/shot.js';
import { simulateShot } from '../physics/ball.js';
import { SURFACES } from '../physics/surfaces.js';
import { strikeResult, applyStrike } from './strike.js';
import { clamp, DEG, headingTo } from '../core/math.js';
import { createRng } from '../core/rng.js';
import { BASE_PROFILE } from '../physics/shot.js';
import { tierBenefits, tierWind, tierProfile } from '../data/tierBenefits.js';

// Lie modes for the balance runs: 'fairway' plays every lie through the green as a fairway lie
// (calm fairway play), 'rough' plays every fairway and first-cut lie as rough (a golfer with
// bad lies; bunkers, deep rough and the rest stay as they are). The ball's position and the
// bounce and roll are always the real terrain's.
const THROUGH_THE_GREEN = new Set([SURFACES.ROUGH, SURFACES.DEEP_ROUGH, SURFACES.FIRST_CUT, SURFACES.BUNKER, SURFACES.DIRT, SURFACES.PATH, SURFACES.WETLAND, SURFACES.WASTE, SURFACES.ROCK, SURFACES.FRINGE]);
export function playedLie(lie, mode) {
  if (mode === 'fairway' && THROUGH_THE_GREEN.has(lie)) return SURFACES.FAIRWAY;
  if (mode === 'rough' && (lie === SURFACES.FAIRWAY || lie === SURFACES.FIRST_CUT)) return SURFACES.ROUGH;
  return lie;
}

/**
 * Play one hole. opts: { profile, gearFor(clubId) -> { rarity, glove, ball }, perks(kind) ->
 * { forgiveness }, setting, skill (planning and swing spread, 0.6 = average),
 * rng, windAt, lies ('fairway' | 'rough' | null, see playedLie) }. The golfer's clubs share one
 * tier in these runs (gearFor ignores the club), so planning uses that tier's wind and lie.
 * Returns { strokes, putts, penalties, strikes: { kind: n }, pickedUp }.
 */
export function playHoleGolfer(terrain, opts) {
  const { profile = BASE_PROFILE, gearFor = () => ({}), perks = () => ({}), setting = 'standard', skill = 0.6, rng, windAt } = opts;
  // Strike dice on their own stream, one fresh draw per shot, so cells compared side by side
  // see the same dice for the same shot whatever happened on the shots before.
  const srng = opts.strikeRng || rng;
  const par = terrain.hole.par, cap = par + 5;
  let pos = { x: terrain.tee.x, z: terrain.tee.z }, lie = SURFACES.TEE;
  let strokes = 0, putts = 0, penalties = 0, t0 = 0;
  const strikes = {};
  const g = () => rng.gauss();
  while (strokes < cap) {
    let launch, r;
    if (lie === SURFACES.GREEN) {
      // The read (a person's error, not the stat) and the stroke (face error scaled by putting).
      const sol = solvePutt(terrain, pos, terrain.pin);
      const ceil = puttCeiling(sol.distance, sol.speed);
      const aim = sol.heading + g() * (0.6 + (1 - skill) * 1.6) * DEG;
      const power = clamp((sol.speed * (1 + g() * (0.05 + (1 - skill) * 0.1))) / ceil, 0.03, 1);
      const face = g() * 1.6;
      launch = { x: pos.x, z: pos.z, putt: true, speed: power * ceil, heading: aim + face * 0.45 * DEG * profile.putting, vAngle: 0, spin: 0, axisTilt: 0 };
      putts++;
    } else {
      // A golfer who knows the club plans for its usual extra carry (planBoost, a speed
      // factor); the shot itself flies with the real profile and strike.
      // The tier's benefits (data/tierBenefits.js): the guide shows them, so the plan uses them.
      const tier = (gearFor(null) || {}).rarity || 'common';
      const shotLie = playedLie(lie, opts.lies);
      const planProfile = tierProfile(opts.planBoost ? { ...profile, power: profile.power * (1 + opts.planBoost) } : profile, tier);
      const plan = aiPlan(terrain, pos, shotLie, { skill, rng, windAt: tierWind(windAt, tier, headingTo(pos.x, pos.z, terrain.pin.x, terrain.pin.z)), t0, profile: planProfile, prefs: opts.prefs || null });
      // A person's tempo: a ratio of backswing to downswing around 3, sometimes rushed.
      const ratio = 3 + g() * 0.45;
      const swing = { ...plan.swing, tempoRatio: ratio, tempoGrade: ratio < 2.2 ? 'rushed' : ratio > 3.9 ? 'slow' : 'good', downMs: 250 };
      const gear = gearFor(plan.club.id) || {};
      const rarity = gear.rarity || 'common';
      launch = computeLaunch(swing, { club: plan.club, shotType: plan.shotType, lie: shotLie, aim: plan.aim, x: pos.x, z: pos.z, profile: tierProfile(profile, rarity), lieRoll: rng.range(-1, 1) });
      const n = {};
      terrain.normalAt(pos.x, pos.z, n);
      // Calm fairway play is flat too: no slope term under the ball.
      const slope = opts.lies === 'fairway' ? 0 : Math.hypot(n.x, n.z) / Math.max(0.2, n.y);
      const ctx = { aim: plan.aim, clubId: plan.club.id, lie: shotLie, slope, setting, rarity, lieRelief: tierBenefits(rarity).lie, glove: gear.glove || 0, ball: gear.ball || null, ...(perks(plan.club.kind) || {}) };
      const st = strikeResult(swing, ctx, createRng(Math.floor(srng.next() * 2147483647) + 1));
      strikes[st.kind] = (strikes[st.kind] || 0) + 1;
      launch = applyStrike(launch, st, ctx);
    }
    const shotWind = lie === SURFACES.GREEN ? windAt : tierWind(windAt, (gearFor(null) || {}).rarity || 'common', launch.heading);
    r = simulateShot(launch, terrain.env(shotWind ? { windAt: shotWind, t0 } : {}));
    strokes++;
    t0 += r.duration + 20;
    if (r.nan) return { strokes: cap, putts, penalties, strikes, pickedUp: true, error: 'nan' };
    if (r.holed) return { strokes, putts, penalties, strikes };
    if (r.oob) { strokes++; penalties++; continue; }
    if (r.water) { strokes++; penalties++; const d = dropPoint(terrain, r, { ...pos, lie }); pos = { x: d.x, z: d.z }; lie = d.lie; continue; }
    pos = { x: r.end.x, z: r.end.z }; lie = r.lie;
  }
  return { strokes: cap, putts, penalties, strikes, pickedUp: true };
}
