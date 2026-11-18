// Strike quality: how cleanly the club met the ball, from the swing the gesture produced.
//
// This sits between the swing and the ball flight. computeLaunch (physics/shot.js) builds the
// launch from the swing exactly as before; applyStrike then scales its speed, launch angle,
// spin, start direction, and side spin by a bounded amount, and the unchanged simulation flies
// the result. A perfect swing is always Pured, and a Pured strike with a Common club changes
// nothing, so the calibrated carry ladder is untouched (tests/strike.test.js).
//
// Tuned to be only a little harder than the game was: on the standard setting a decent swing
// rarely mishits, and most mishits are mild. Relaxed is close to the old game; Pro has bite.
import { clamp, DEG } from '../core/math.js';
import { SURFACES } from '../physics/surfaces.js';

export const STRIKE_KINDS = ['pured', 'good', 'heel', 'toe', 'thin', 'fat', 'shank'];
export const STRIKE_NAMES = { pured: 'Pured', good: 'Good', heel: 'Heel', toe: 'Toe', thin: 'Thin', fat: 'Fat', shank: 'Shank' };
export const DIFFICULTY = { relaxed: 0.55, standard: 1, pro: 1.5 };

// How hard each club is to strike cleanly (longer and flatter faces are harder).
export const CLUB_DIFFICULTY = { DR: 1.0, W3: 0.92, W5: 0.88, I4: 0.85, I5: 0.8, I6: 0.76, I7: 0.72, I8: 0.68, I9: 0.64, PW: 0.58, GW: 0.57, SW: 0.56, LW: 0.58, PT: 0.3 };

// Rarity: difficulty multiplier, Pured carry bonus (fraction), spin, and sweet spot size.
// Kept here so the strike model is self-contained; game/gear.js reads the same table.
export const RARITY = {
  common: { difficulty: 1.0, bonus: 0, spin: 1.0, sweet: 1.0 },
  uncommon: { difficulty: 1.25, bonus: 0.02, spin: 1.02, sweet: 0.92 },
  rare: { difficulty: 1.5, bonus: 0.04, spin: 1.04, sweet: 0.84 },
  epic: { difficulty: 1.8, bonus: 0.06, spin: 1.06, sweet: 0.76 },
  legendary: { difficulty: 2.2, bonus: 0.08, spin: 1.08, sweet: 0.68 },
};
// Every source of extra carry together (rarity, perks, stats) stops here.
export const CARRY_CAP = 0.1;
// No strike leaves less than this share of the clean carry.
export const CARRY_FLOOR = 0.4;

// Tuning of the mishit curve: below FREE there is no mishit chance at all; above it the
// chance climbs at SLOPE per unit of weighted error.
export const TUNING = { FREE: 0.14, SLOPE: 0.85, MAX: 0.85, PURE: 0.09 };

const LIE_TERM = (lie) => (lie === SURFACES.ROUGH ? 0.04 : lie === SURFACES.DEEP_ROUGH ? 0.14 : lie === SURFACES.BUNKER ? 0.18 : lie === SURFACES.WASTE ? 0.1 : lie === SURFACES.WETLAND ? 0.18 : lie === SURFACES.DIRT ? 0.08 : 0);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// The parts of the swing that make contact worse, each 0 (clean) to about 1 (very poor).
export function strikeFactors(swing, ctx = {}) {
  const tq = clamp(num(swing && swing.tempoQuality, 1), 0, 1);
  const face = Math.abs(num(swing && swing.face));
  const path = Math.abs(num(swing && swing.path));
  const power = num(swing && swing.power, 0.7);
  const ratio = num(swing && swing.tempoRatio, 3);
  const grade = swing && swing.tempoGrade;
  const tempo = 1 - tq;
  const faceT = Math.min(1, face / 8);
  const pathT = Math.min(1, path / 7);
  // A full backswing with a rushed downswing: the classic overswing.
  const over = power >= 0.97 && (grade === 'rushed' || ratio < 2.2) ? 1 : 0;
  // Timing of the crossing: a thumb lifted early (completed at its pace) or a very slow push.
  const timing = (swing && swing.auto ? 0.2 : 0) + (num(swing && swing.downMs, 250) > 650 ? 0.12 : 0);
  const lie = LIE_TERM(ctx.lie);
  const slope = Math.min(0.12, Math.max(0, num(ctx.slope)) * 0.6);
  const error = 0.55 * tempo + 0.35 * faceT + 0.25 * pathT + 0.35 * over + timing + lie + slope;
  return { tempo, face: faceT, path: pathT, over, timing, lie, slope, error, rushed: grade === 'rushed' || over > 0 };
}

/**
 * strikeResult(swing, ctx, rng)
 *   swing  the gesture result (power, face, path, tempoQuality, tempoGrade, tempoRatio, auto, downMs)
 *   ctx    { clubId, lie, slope, rarity, setting, glove (sweet spot bonus 0..0.08), forgiveness (stat, 0.85..1.15), lefty }
 *   rng    a seeded rng with next() in [0, 1)
 * Returns { kind, severity, cause, chance, x }.
 */
export function strikeResult(swing, ctx = {}, rng) {
  const r = () => (rng ? rng.next() : 0.5);
  const f = strikeFactors(swing, ctx);
  const rar = RARITY[ctx.rarity] || RARITY.common;
  const putter = ctx.clubId === 'PT';
  const setting = DIFFICULTY[ctx.setting] ?? DIFFICULTY.standard;
  const clubD = CLUB_DIFFICULTY[ctx.clubId] ?? 0.75;
  const sweet = rar.sweet * (1 + clamp(num(ctx.glove), 0, 0.08)) * clamp(num(ctx.forgiveness, 1), 0.85, 1.15);
  // Weighted error: how far from the middle of the face this swing is likely to land. The
  // sweet spot sets how often a swing misses the middle; the club's rarity difficulty sets how
  // much a miss costs (severity, below). A great swing is Pured with any club.
  const e = f.error * setting * clubD;
  const x = e / sweet;
  const chance = clamp((x - TUNING.FREE) * TUNING.SLOPE, 0, TUNING.MAX);
  if (r() >= chance) {
    const kind = e < TUNING.PURE * sweet ? 'pured' : 'good';
    return { kind, severity: 0, cause: kind === 'pured' ? 'Right out of the middle.' : '', chance, x };
  }
  // Which way it went wrong follows the biggest cause.
  const wSide = f.face * 1.0 + 0.15;
  const wHeight = putter ? 0 : f.tempo * 1.0 + f.over * 0.8 + f.timing + f.lie * 1.5 + f.slope + 0.1;
  const wShank = !putter && f.face > 0.5 && f.path > 0.45 && x > 0.6 ? 0.12 : 0.004;
  const roll = r() * (wSide + wHeight + wShank);
  // Severity: mostly mild; bad lies and big errors make it worse.
  const sev = clamp(0.18 + (x - TUNING.FREE) * 0.55 + (r() - 0.5) * 0.25, 0.08, 1) * (1 + f.lie * 1.5) * Math.sqrt(rar.difficulty);
  const severity = +clamp(sev, 0.08, 1).toFixed(3);
  const faceSign = Math.sign(num(swing && swing.face)) || (r() < 0.5 ? -1 : 1);
  if (roll < wSide) {
    // Face open (world right) for a right-hander means the heel; mirrored for a left-hander.
    const heel = (faceSign > 0) !== !!ctx.lefty;
    return { kind: heel ? 'heel' : 'toe', severity, faceSign, cause: f.face > 0.2 ? (faceSign > 0 ? 'Face open at impact: the drag drifted right on the way up.' : 'Face closed at impact: the drag drifted left on the way up.') : 'Caught it a little off the middle.', chance, x };
  }
  if (roll < wSide + wHeight) {
    const fatShare = clamp(0.42 + f.lie * 1.6 + f.slope * 2 - (f.rushed ? 0.15 : 0), 0.15, 0.85);
    const fat = r() < fatShare;
    const why = f.over ? 'A full backswing and then too fast on the way down.' : f.tempo > 0.35 ? (fat ? 'Too slow coming down: heavy, the club hit the ground first.' : 'Too fast on the way down.') : f.timing > 0.1 ? 'Thumb lifted before the line.' : f.lie > 0.1 ? 'A tough lie: the ball sat down.' : fat ? 'Heavy: the club hit the ground first.' : 'Caught it thin, low on the face.';
    return { kind: fat ? 'fat' : 'thin', severity, cause: why, chance, x };
  }
  return { kind: 'shank', severity, faceSign, cause: 'Face and path both way off: it came off the hosel.', chance, x };
}

/**
 * The launch modifiers for a strike. Multipliers on speed, launch angle, and spin; additions
 * (radians) to the start direction and the spin axis tilt. All bounded.
 */
export function strikeModifiers(strike, ctx = {}) {
  const s = clamp(num(strike && strike.severity), 0, 1);
  const rar = RARITY[ctx.rarity] || RARITY.common;
  const side = (strike && strike.faceSign) || 1;
  const m = { speed: 1, launch: 1, spin: 1, heading: 0, tilt: 0 };
  const putter = ctx.clubId === 'PT';
  switch (strike && strike.kind) {
    case 'pured': {
      // Carry rises a little faster than speed, so the speed bonus is slightly under the carry bonus.
      const bonus = Math.min(CARRY_CAP, rar.bonus + clamp(num(ctx.perkBonus), 0, 0.04));
      m.speed = 1 + bonus * 0.88;
      m.spin = rar.spin;
      break;
    }
    case 'thin':
      m.speed = 1 - (0.05 + 0.12 * s); m.launch = 0.7 + 0.18 * (1 - s); m.spin = 0.6 + 0.3 * (1 - s); break;
    case 'fat':
      m.speed = 1 - (0.07 + 0.2 * s); m.launch = 1.04; m.spin = 1.04; break;
    case 'heel':
    case 'toe':
      if (putter) { m.speed = 1 - (0.03 + 0.07 * s); m.heading = side * (0.4 + 1.2 * s) * DEG; break; }
      m.speed = 1 - (0.045 + 0.11 * s); m.heading = side * (0.8 + 2.2 * s) * DEG; m.tilt = side * (5 + 12 * s) * DEG; break;
    case 'shank':
      m.speed = 0.76 - 0.04 * s; m.launch = 0.85; m.spin = 0.85; m.heading = (ctx.lefty ? -1 : 1) * (26 + 10 * s) * DEG; m.tilt = (ctx.lefty ? -1 : 1) * 8 * DEG; break;
    default: break;
  }
  m.speed = clamp(m.speed, 0.5, 1 + CARRY_CAP);
  return m;
}

// Apply a strike to a launch from computeLaunch. Returns a new launch (the input is untouched).
export function applyStrike(launch, strike, ctx = {}) {
  const m = strikeModifiers(strike, ctx);
  const out = { ...launch };
  out.speed = num(launch.speed) * m.speed;
  if (!launch.putt) {
    out.vAngle = num(launch.vAngle) * m.launch;
    out.spin = num(launch.spin) * m.spin;
    out.axisTilt = clamp(num(launch.axisTilt) + m.tilt, -40 * DEG, 40 * DEG);
  }
  out.heading = num(launch.heading) + m.heading;
  // The ball (game/gear.js BALLS): a little more spin for a little less speed. Bounded.
  const ball = ctx.ball;
  if (ball && !launch.putt) {
    out.speed *= clamp(num(ball.speed, 1), 0.98, 1);
    out.spin *= clamp(num(ball.spin, 1), 1, 1.15);
  }
  return out;
}

// Haptic pattern per strike, and a short sound cue name the audio module plays.
export const STRIKE_HAPTIC = { pured: [10, 24, 16], good: 14, heel: [22, 30, 8], toe: [22, 30, 8], thin: [8, 12, 8, 12, 8], fat: 40, shank: [30, 20, 30] };
