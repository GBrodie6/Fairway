// Range sessions: free practice with a 50-ball bucket or unlimited balls, and five drills with
// medals. Pure functions over plain objects: the controller hands each finished shot here as
// a record (carry, total, offline, launch numbers, the strike), and the UI reads the readout,
// the dispersion ellipse, per-club averages, and the session summary from the results.
//
// Medal rewards are fixed, not random: bronze and silver give XP, gold also gives a gear token
// (once per drill per day). There is nothing random to disclose here.
import { YARD } from '../core/math.js';
import { TARGETS } from '../course/range.js';

export const BUCKET = 50;
export const MODES = {
  free: { id: 'free', name: 'Free practice', balls: null, text: 'Any club, any target. A 50-ball bucket or unlimited balls.' },
  target: { id: 'target', name: 'Target points', balls: 10, text: 'Ten balls, two at each target green from 75 to 275 yards. Points for landing near the flag.' },
  longdrive: { id: 'longdrive', name: 'Long drive', balls: 6, club: 'DR', text: 'Six drives. Your longest total inside the grid counts (30 yards either side of the center line).' },
  ladder: { id: 'ladder', name: 'Wedge ladder', balls: 12, text: 'Carry 50, 60, 70, 80, 90 and 100 yards in order, each within 5 yards, in twelve balls or fewer.' },
  shape: { id: 'shape', name: 'Shape shots', balls: 6, text: 'Curve the ball the way the card asks (draw, fade, or straight) and finish within 15 yards of your aim line.' },
  test: { id: 'test', name: 'Club test lane', balls: null, text: 'Each swing is replayed with a second version of the club (any tier), so you can see what a tier changes before you play it.' },
  streak: { id: 'streak', name: 'Pressure streak', balls: null, text: 'Land on the target green as many times in a row as you can. One miss ends the run.' },
};
export const MODE_IDS = Object.keys(MODES);
// Medal thresholds per drill (higher is better).
export const MEDALS = {
  target: { bronze: 200, silver: 380, gold: 560 },
  longdrive: { bronze: 235, silver: 252, gold: 268 },
  ladder: { bronze: 3, silver: 5, gold: 6 },
  shape: { bronze: 2, silver: 4, gold: 6 },
  streak: { bronze: 3, silver: 6, gold: 10 },
};
export const MEDAL_XP = { none: 10, bronze: 25, silver: 45, gold: 70 };
export const LADDER = [50, 60, 70, 80, 90, 100];
export const SHAPES = ['draw', 'fade', 'straight', 'fade', 'draw', 'straight'];
const GRID_YD = 30;

// Points for a ball landing d yards from the flag (target points).
export function targetPoints(dYd, onGreen) {
  const base = dYd <= 3 ? 100 : dYd <= 6 ? 70 : dYd <= 10 ? 45 : dYd <= 15 ? 25 : dYd <= 25 ? 10 : 0;
  return base + (onGreen ? 10 : 0);
}

export function createSession({ mode = 'free', bucket = BUCKET, bay = 2, surface = 'mat', target = 125, now = 0 } = {}) {
  const m = MODES[mode] || MODES.free;
  return {
    mode: m.id, bay, surface, started: now, target,
    balls: m.balls != null ? m.balls : bucket, // null for unlimited
    used: 0, shots: [], score: 0, step: 0, streak: 0, best: 0, over: false, last: null,
  };
}

// The target the drill asks for next (yards), or null when the player chooses.
export function currentTarget(s) {
  if (s.mode === 'target') return TARGETS[Math.floor(s.step / 2) % TARGETS.length].yards;
  if (s.mode === 'ladder') return LADDER[Math.min(s.step, LADDER.length - 1)];
  if (s.mode === 'streak') return s.target || 125;
  return null;
}
export const currentShape = (s) => (s.mode === 'shape' ? SHAPES[Math.min(s.step, SHAPES.length - 1)] : null);
export const ballsLeft = (s) => (s.balls == null ? null : Math.max(0, s.balls - s.used));

/**
 * One finished shot. rec: { club, carry, total, offline, curve, ballSpeed, launch, spin, apex,
 * strike, land: { x, z }, rest: { x, z }, target: { yards, x, z, r } | null }. Distances in
 * yards except land/rest (meters, range frame). Returns { session, message, points }.
 */
export function addShot(s, rec) {
  if (s.over) return { session: s, message: 'Session over', points: 0 };
  const shot = { ...rec, n: s.used + 1 };
  const next = { ...s, used: s.used + 1, shots: [...s.shots, shot] };
  let message = '', points = 0;
  switch (s.mode) {
    case 'target': {
      const t = rec.target;
      // Scored where the ball lands, so roll-out does not cost points.
      const d = t ? Math.hypot(rec.land.x - t.x, rec.land.z - t.z) / YARD : 99;
      const onGreen = t ? Math.hypot(rec.land.x - t.x, rec.land.z - t.z) <= t.r : false;
      points = targetPoints(d, onGreen);
      next.score = s.score + points;
      next.step = s.step + 1;
      message = points ? `${points} points, landed ${d.toFixed(1)} yd from the flag` : `No points: landed ${d.toFixed(0)} yd away`;
      break;
    }
    case 'longdrive': {
      const inGrid = Math.abs(rec.offline) <= GRID_YD;
      if (inGrid && rec.total > s.score) next.score = Math.round(rec.total);
      message = inGrid ? `${Math.round(rec.total)} yd${rec.total > s.score ? ', your best so far' : ''}` : `Outside the grid (${Math.round(Math.abs(rec.offline))} yd ${rec.offline > 0 ? 'right' : 'left'})`;
      points = inGrid ? Math.round(rec.total) : 0;
      break;
    }
    case 'ladder': {
      const want = LADDER[s.step];
      const err = rec.carry - want;
      if (Math.abs(err) <= 5) { next.step = s.step + 1; next.score = next.step; points = 1; message = `Carried ${Math.round(rec.carry)} yd. ${next.step < LADDER.length ? `Next: ${LADDER[next.step]} yd` : 'Ladder complete'}`; }
      else message = `Carried ${Math.round(rec.carry)} yd, ${Math.abs(Math.round(err))} yd ${err > 0 ? 'long' : 'short'} of ${want}. Try again`;
      if (next.step >= LADDER.length) next.over = true;
      break;
    }
    case 'shape': {
      const want = SHAPES[s.step];
      // Curve in yards, positive to the right. A right-hander's draw curves left.
      const c = rec.lefty ? -rec.curve : rec.curve;
      const shape = c < -3 ? 'draw' : c > 3 ? 'fade' : 'straight';
      const ok = shape === want && Math.abs(rec.offline) <= 15;
      if (ok) { next.score = s.score + 1; points = 1; }
      next.step = s.step + 1;
      message = ok ? `A ${shape}: nice` : shape !== want ? `That was a ${shape}, the card asked for a ${want}` : `A ${shape}, but ${Math.round(Math.abs(rec.offline))} yd off the line`;
      break;
    }
    case 'streak': {
      const t = rec.target;
      const on = t ? Math.hypot(rec.land.x - t.x, rec.land.z - t.z) <= t.r : false;
      if (on) { next.streak = s.streak + 1; next.score = Math.max(s.best, next.streak); next.best = next.score; points = 1; message = `On the green: ${next.streak} in a row`; }
      else { next.streak = 0; next.over = true; message = `Missed the green. Run over at ${s.streak}`; }
      break;
    }
    case 'test': {
      const c = rec.compare;
      message = c ? `Same swing, ${c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1)}: carry ${Math.round(c.carry)} yd (${c.carry >= rec.carry ? '+' : ''}${Math.round(c.carry - rec.carry)}), ${Math.round(Math.abs(c.offline))} yd ${c.offline > 0 ? 'right' : 'left'}, ${c.strike ? c.strike.kind : 'good'}` : `${Math.round(rec.carry)} yd carry`;
      break;
    }
    default:
      message = `${Math.round(rec.carry)} yd carry`;
  }
  if (next.balls != null && next.used >= next.balls) next.over = true;
  next.last = { message, points };
  return { session: next, message, points };
}

export function medalFor(mode, score) {
  const m = MEDALS[mode];
  if (!m) return 'none';
  return score >= m.gold ? 'gold' : score >= m.silver ? 'silver' : score >= m.bronze ? 'bronze' : 'none';
}

// Per-club averages: carry, total, offline (signed and absolute), strikes.
export function clubAverages(shots) {
  const by = {};
  for (const s of shots) {
    const a = by[s.club] || (by[s.club] = { club: s.club, n: 0, carry: 0, total: 0, offline: 0, absOffline: 0, ballSpeed: 0, pured: 0, mishits: 0 });
    a.n++; a.carry += s.carry; a.total += s.total; a.offline += s.offline; a.absOffline += Math.abs(s.offline); a.ballSpeed += s.ballSpeed || 0;
    const k = s.strike && s.strike.kind;
    if (k === 'pured') a.pured++; else if (k && k !== 'good') a.mishits++;
  }
  return Object.values(by).map((a) => ({ ...a, carry: a.carry / a.n, total: a.total / a.n, offline: a.offline / a.n, absOffline: a.absOffline / a.n, ballSpeed: a.ballSpeed / a.n }));
}

/**
 * Dispersion ellipse for landing points (x across, y along, any unit): mean, the two axis
 * half lengths at k standard deviations, and the angle of the major axis (radians from +x).
 * Fewer than three points gives null.
 */
export function dispersion(points, k = 1.5) {
  const n = points.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= n - 1; syy /= n - 1; sxy /= n - 1;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
  const angle = Math.abs(sxy) < 1e-12 ? (sxx >= syy ? 0 : Math.PI / 2) : Math.atan2(l1 - sxx, sxy);
  return { x: mx, y: my, a: k * Math.sqrt(l1), b: k * Math.sqrt(l2), angle };
}

// What a finished session is worth, and the save update for the range record.
export function sessionResult(s, { dayKey = '', goldToday = {} } = {}) {
  const medal = s.mode === 'free' || s.mode === 'test' ? 'none' : medalFor(s.mode, s.score);
  const xp = s.mode === 'free' || s.mode === 'test' ? Math.min(30, Math.round(s.used * 0.6)) : MEDAL_XP[medal];
  const tokens = medal === 'gold' && goldToday[s.mode] !== dayKey ? 1 : 0;
  return { mode: s.mode, score: s.score, medal, xp, tokens, shots: s.used, averages: clubAverages(s.shots) };
}

// Fold a finished session into the save's range record: counts, bests, per-club running sums.
export function recordSession(range, s, result, dayKey) {
  const r = { sessions: 0, balls: 0, best: {}, medals: {}, clubs: {}, goldDay: {}, ...(range || {}) };
  const out = { ...r, sessions: r.sessions + 1, balls: r.balls + s.used, best: { ...r.best }, medals: { ...r.medals }, clubs: { ...r.clubs }, goldDay: { ...r.goldDay } };
  if (MEDALS[s.mode]) {
    out.best[s.mode] = Math.max(out.best[s.mode] || 0, s.score);
    const order = ['none', 'bronze', 'silver', 'gold'];
    if (order.indexOf(result.medal) > order.indexOf(out.medals[s.mode] || 'none')) out.medals[s.mode] = result.medal;
    if (result.medal === 'gold') out.goldDay[s.mode] = dayKey;
  }
  for (const sh of s.shots) {
    const c = out.clubs[sh.club] || { n: 0, carry: 0, offline: 0 };
    out.clubs[sh.club] = { n: c.n + 1, carry: c.carry + sh.carry, offline: c.offline + Math.abs(sh.offline) };
  }
  return out;
}
export const clubAverageCarry = (range, clubId) => {
  const c = range && range.clubs && range.clubs[clubId];
  return c && c.n >= 3 ? c.carry / c.n : null;
};
