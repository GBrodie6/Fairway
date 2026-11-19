// Tournament mode: four rounds of six holes on one course against a field of 29, a cut to the
// top 15 and ties after two rounds, a purse in coins (earned, never bought), and a trophy for
// a win. Plus the live leaderboard (with movement) that campaign events use too. Pure.
import { PROS } from './pros.js';
import { createRng, hashString } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { courseById } from '../course/courses.js';
import { makeRivals, simulateRivalRound } from './career.js';

export const T_ROUNDS = 4, T_HOLES = 6, T_FIELD = 30, T_CUT_AFTER = 2, T_CUT_TOP = 15;
// Purse in coins by finishing position (made cut only); a missed cut pays a little.
export const PURSE = [900, 540, 340, 240, 190, 160, 140, 120, 100, 90, 80, 70, 60, 55, 50];
export const MISSED_CUT_COINS = 25;
const NAMES = ['Lakeside Invitational', 'Harvest Classic', 'Coastal Championship', 'Summit Open', 'Golden Hour Masters', 'Founders Trophy'];

export const roundHoles = (r) => Array.from({ length: T_HOLES }, (_, i) => (r * T_HOLES + i) % 18);

export function createTournament({ courseId = 'parkland', seed = 1, level = 1, as = null } = {}) {
  const s = seed >>> 0;
  const rng = createRng(s ^ 0x7a11);
  // The field strengthens a little with the player's level, inside the rivals' usual range.
  const lift = clamp((level - 1) * 0.004, 0, 0.12);
  // The tour pros (data/pros.json) play every tournament, except the one you play as; the rest
  // of the field are generated rivals.
  const pros = PROS.filter((p) => p.id !== as).map((p) => ({ id: `pro:${p.id}`, name: p.name, skill: p.skill, form: 0, wins: 0 }));
  const field = [...pros, ...makeRivals(s, T_FIELD - 1 - pros.length)].map((r) => ({ ...r, skill: +clamp(r.skill - 0.06 + lift, 0.3, 0.86).toFixed(3) }));
  return {
    v: 1, id: `t${s}`, name: NAMES[s % NAMES.length], courseId, seed: s, field,
    tods: Array.from({ length: T_ROUNDS }, () => rng.pick(['morning', 'midday', 'golden', 'dawn'])),
    round: 0, me: [], cut: null, done: false, missedCut: false, result: null,
  };
}

// A rival's per-hole scores for a round (seeded, so the same every time it is asked).
export function rivalRound(t, rival, r) {
  return simulateRivalRound(rival, { courseId: t.courseId, holes: roundHoles(r), seed: (t.seed + hashString(`${t.id}:${r}`)) >>> 0 });
}
const parOf = (t, r) => roundHoles(r).reduce((a, h) => a + courseById(t.courseId).pars[h], 0);
const inField = (t, r) => (t.cut && r >= T_CUT_AFTER ? t.field.filter((f) => t.cut.includes(f.id)) : t.field);

// Positions with ties ("T3"): rows need .toPar; sorted best first.
export function rank(rows) {
  const out = [...rows].sort((a, b) => a.toPar - b.toPar || (a.me ? -1 : b.me ? 1 : 0));
  let pos = 0;
  out.forEach((r, i) => { if (i === 0 || r.toPar !== out[i - 1].toPar) pos = i + 1; r.pos = pos; });
  for (const r of out) r.tie = out.filter((x) => x.pos === r.pos).length > 1;
  return out;
}
export const posLabel = (r) => `${r.tie ? 'T' : ''}${r.pos}`;

/**
 * The leaderboard through the current round's hole `thru` (0 to 6), with movement against
 * the board one hole earlier. meScores: the player's per-hole scores this round so far.
 */
export function tournamentBoard(t, meScores, thru) {
  const course = courseById(t.courseId);
  const r = t.round, holes = roundHoles(r);
  const parThru = (n) => holes.slice(0, n).reduce((a, h) => a + course.pars[h], 0);
  const build = (n) => {
    const prevMe = t.me.reduce((a, sc, i) => a + sc.reduce((x, y) => x + y, 0) - parOf(t, i), 0);
    const rows = [{ id: 'me', me: true, name: 'You', toPar: prevMe + meScores.slice(0, n).reduce((a, b) => a + b, 0) - parThru(n) }];
    for (const f of inField(t, r)) {
      let prev = 0;
      for (let i = 0; i < r; i++) prev += rivalRound(t, f, i).reduce((a, b) => a + b, 0) - parOf(t, i);
      const cur = rivalRound(t, f, r).slice(0, n).reduce((a, b) => a + b, 0) - parThru(n);
      rows.push({ id: f.id, name: f.name, toPar: prev + cur });
    }
    return rank(rows);
  };
  const now = build(thru), before = thru > 0 ? build(thru - 1) : null;
  for (const row of now) { const b = before && before.find((x) => x.id === row.id); row.move = b ? b.pos - row.pos : 0; }
  return now;
}

/** Record the player's finished round. Returns { tournament, events: [...] }. */
export function finishTournamentRound(t, scores) {
  if (t.done) return { tournament: t, events: [] };
  const next = { ...t, me: [...t.me, scores], round: t.round + 1 };
  const events = [];
  const board = () => {
    const rows = [{ id: 'me', me: true, name: 'You', toPar: next.me.reduce((a, sc, i) => a + sc.reduce((x, y) => x + y, 0) - parOf(next, i), 0) }];
    for (const f of inField(next, next.round - 1)) {
      let tot = 0;
      for (let i = 0; i < next.round; i++) tot += rivalRound(next, f, i).reduce((a, b) => a + b, 0) - parOf(next, i);
      rows.push({ id: f.id, name: f.name, toPar: tot });
    }
    return rank(rows);
  };
  if (next.round === T_CUT_AFTER) {
    const b = board();
    const line = b[Math.min(b.length, T_CUT_TOP) - 1].toPar;
    next.cut = b.filter((r) => !r.me && r.toPar <= line).map((r) => r.id);
    const me = b.find((r) => r.me);
    next.cutLine = line;
    if (me.toPar > line) {
      next.done = true; next.missedCut = true;
      next.result = { position: me.pos, tie: me.tie, toPar: me.toPar, coins: MISSED_CUT_COINS, trophy: false, madeCut: false };
      events.push('missed-cut');
      return { tournament: next, events };
    }
    events.push('made-cut');
  }
  if (next.round >= T_ROUNDS) {
    const b = board(), me = b.find((r) => r.me);
    next.done = true;
    const coins = PURSE[me.pos - 1] || MISSED_CUT_COINS;
    next.result = { position: me.pos, tie: me.tie, toPar: me.toPar, coins, trophy: me.pos === 1, madeCut: true, board: b.slice(0, 10).map((r) => ({ name: r.name, pos: posLabel(r), toPar: r.toPar, me: !!r.me })) };
    events.push(me.pos === 1 ? 'won' : 'finished');
  }
  return { tournament: next, events };
}

export function sanitizeTournament(t) {
  if (!t || typeof t !== 'object' || t.v !== 1 || !Array.isArray(t.field) || !Array.isArray(t.me) || !courseById(t.courseId)) return null;
  if (t.me.some((sc) => !Array.isArray(sc) || sc.length !== T_HOLES || sc.some((x) => !Number.isFinite(x)))) return null;
  return t;
}

/**
 * The campaign's live board: the player's scores so far against the field's simulated rounds,
 * revealed hole by hole, with movement. field: [{ id, name, scores: [per hole] }].
 */
export function eventBoard(meName, meScores, field, pars, thru) {
  const build = (n) => {
    const par = pars.slice(0, n).reduce((a, b) => a + b, 0);
    const rows = [{ id: 'me', me: true, name: meName, toPar: meScores.slice(0, n).reduce((a, b) => a + b, 0) - par }];
    for (const f of field) rows.push({ id: f.id, name: f.name, boss: !!f.boss, toPar: f.scores.slice(0, n).reduce((a, b) => a + b, 0) - par });
    return rank(rows);
  };
  const now = build(thru), before = thru > 0 ? build(thru - 1) : null;
  for (const row of now) { const b = before && before.find((x) => x.id === row.id); row.move = b ? b.pos - row.pos : 0; }
  return now;
}
