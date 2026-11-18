// Versioned local save: player, career, round history, aggregate stats, daily challenge
// results, achievements, and a round in progress. Everything is validated on load and old
// versions are migrated forward one step at a time. Pure functions plus thin storage I/O.
import { validateCareer } from './career.js';
import { validateRound } from './round.js';
import { courseById } from '../course/courses.js';
import { YARD } from '../core/math.js';
import { starterGear, sanitizeGear } from './gear.js';

export const SAVE_VERSION = 5;
export const SAVE_KEY = 'fairway-next.save';
const HISTORY_CAP = 100;

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    player: { name: 'You', handed: 'right', ball: '#ffffff' },
    career: null,
    history: [],
    stats: emptyStats(),
    daily: {},
    achievements: {},
    inProgress: null,
    // v4: when this save last changed (for the cloud conflict rule) and the signed-in account
    // on this device (null for a guest).
    updatedAt: 0,
    account: null,
    // Earned currencies and items. Nothing here can be bought.
    wallet: { coins: 0, shards: 0, mulligans: 1, tokens: 0, tokenDay: 0, dayTokens: 0 },
    // v5: clubs in rarity tiers, the 14-club bag, balls, gloves, and the drop pity counter.
    gear: starterGear(),
  };
}
export function emptyStats() {
  return { rounds: 0, holes: 0, strokes: 0, par: 0, putts: 0, fairways: 0, fairwayChances: 0, gir: 0, eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, holesInOne: 0, longestDrive: 0, threePutts: 0, best: {} };
}

// Migrations: each takes a save at version n and returns version n + 1.
// v1 (first internal format): { version: 1, name, rounds: [...] }
// v2 added stats, daily, achievements, and split the player out.
// v3 added the career and a resumable round.
export const MIGRATIONS = {
  1: (s) => ({
    version: 2,
    player: { name: typeof s.name === 'string' ? s.name : 'You', handed: 'right', ball: '#ffffff' },
    history: Array.isArray(s.rounds) ? s.rounds.filter((r) => r && Number.isFinite(r.strokes)).map((r) => ({ id: String(r.id || r.date || Math.random()), date: Number(r.date) || 0, courseId: r.courseId || 'parkland', mode: r.mode || 'stroke', holes: Number(r.holes) || 18, strokes: r.strokes, par: Number(r.par) || 72, toPar: r.strokes - (Number(r.par) || 72) })) : [],
    stats: emptyStats(),
    daily: {},
    achievements: {},
  }),
  2: (s) => ({ ...s, version: 3, career: null, inProgress: null }),
  // v4 added cloud sync metadata: updatedAt and the account link (none for an old save).
  3: (s) => ({ ...s, version: 4, updatedAt: 0, account: null }),
  // v5 added gear (the fixed starter bag of 14 Common clubs) and gear tokens.
  4: (s) => ({ ...s, version: 5, gear: starterGear(), wallet: { ...(s.wallet || {}), tokens: 0 } }),
};

export function migrateSave(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.version)) return defaultSave();
  let s = raw;
  let guard = 0;
  while (s.version < SAVE_VERSION && MIGRATIONS[s.version] && guard++ < 10) s = MIGRATIONS[s.version](s);
  if (s.version !== SAVE_VERSION) return defaultSave(); // from the future or broken: start clean
  return sanitizeSave(s);
}

export function sanitizeSave(s) {
  const d = defaultSave();
  const out = { ...d, ...s, version: SAVE_VERSION };
  out.player = { ...d.player, ...(s.player && typeof s.player === 'object' ? s.player : {}) };
  out.player.name = String(out.player.name || 'You').slice(0, 18);
  out.history = Array.isArray(s.history) ? s.history.filter((h) => h && Number.isFinite(h.strokes)).slice(-HISTORY_CAP) : [];
  out.stats = { ...emptyStats(), ...(s.stats && typeof s.stats === 'object' ? s.stats : {}) };
  for (const k of Object.keys(emptyStats())) if (k !== 'best' && !Number.isFinite(out.stats[k])) out.stats[k] = 0;
  if (!out.stats.best || typeof out.stats.best !== 'object') out.stats.best = {};
  out.daily = s.daily && typeof s.daily === 'object' ? s.daily : {};
  out.achievements = s.achievements && typeof s.achievements === 'object' ? s.achievements : {};
  out.career = validateCareer(s.career) ? s.career : null;
  out.inProgress = s.inProgress && validateRound(s.inProgress).ok ? s.inProgress : null;
  out.updatedAt = Number.isFinite(s.updatedAt) ? s.updatedAt : 0;
  const w = s.wallet && typeof s.wallet === 'object' ? s.wallet : {};
  const cnt = (v, d) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e7) : d);
  out.wallet = { coins: cnt(w.coins, 0), shards: cnt(w.shards, 0), mulligans: cnt(w.mulligans, 1), tokens: cnt(w.tokens, 0), tokenDay: cnt(w.tokenDay, 0), dayTokens: cnt(w.dayTokens, 0) };
  out.gear = sanitizeGear(s.gear);
  const a = s.account;
  out.account = a && typeof a === 'object' && typeof a.userId === 'string' ? { userId: a.userId, email: String(a.email || ''), displayName: String(a.displayName || '').slice(0, 18) } : null;
  return out;
}

// Mark a save as changed now (the cloud conflict rule compares these times).
export const touchSave = (save, now = Date.now()) => ({ ...save, updatedAt: now });

const mem = new Map();
const fallbackStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
function storage() {
  try { if (typeof localStorage !== 'undefined') { localStorage.setItem('__fw_t', '1'); localStorage.removeItem('__fw_t'); return localStorage; } } catch { /* private mode or blocked */ }
  return fallbackStorage;
}
export function loadSave(store = storage()) {
  try {
    const txt = store.getItem(SAVE_KEY);
    if (!txt) return defaultSave();
    return migrateSave(JSON.parse(txt));
  } catch { return defaultSave(); }
}
export function writeSave(save, store = storage()) {
  try { store.setItem(SAVE_KEY, JSON.stringify(save)); return true; } catch { return false; }
}

// --- achievements ---
export const ACHIEVEMENTS = [
  { id: 'first-round', name: 'First round', text: 'Finish a round.' },
  { id: 'birdie', name: 'Birdie', text: 'Make a birdie.' },
  { id: 'eagle', name: 'Eagle', text: 'Make an eagle.' },
  { id: 'ace', name: 'Hole in one', text: 'Hole a tee shot.' },
  { id: 'under-par', name: 'In red figures', text: 'Finish a round under par.' },
  { id: 'no-three-putts', name: 'Steady hands', text: 'Finish 18 holes without a three-putt.' },
  { id: 'long-drive', name: 'Long ball', text: 'Hit a drive of 300 yards.' },
  { id: 'fairways', name: 'Fairway finder', text: 'Hit every fairway in a round of nine or more holes.' },
  { id: 'all-courses', name: 'Well travelled', text: 'Finish a round on every course.' },
  { id: 'daily-3', name: 'Habit', text: 'Play the daily challenge on three days.' },
  { id: 'career-win', name: 'Winner', text: 'Win a career event.' },
  { id: 'tour-card', name: 'Tour card', text: 'Reach the championship tour in your career.' },
];

// Fold a finished round into the save. Returns { save, unlocked: [ids], entry }.
// playerIdx is the human whose stats are kept (pass and play keeps player 1).
export function recordRound(save, round, { now = 0, playerIdx = 0 } = {}) {
  const course = courseById(round.courseId);
  const scores = round.scores[playerIdx] || [];
  const logs = round.logs[playerIdx] || [];
  const played = scores.map((s, i) => ({ s, par: course.pars[round.holes[i]], log: logs[i] })).filter((x) => Number.isFinite(x.s));
  if (!played.length || round.mode === 'range' || round.mode === 'ctp') return { save, unlocked: [], entry: null };
  const strokes = played.reduce((a, x) => a + x.s, 0), par = played.reduce((a, x) => a + x.par, 0);
  const st = { ...save.stats, best: { ...save.stats.best } };
  st.rounds += 1; st.holes += played.length; st.strokes += strokes; st.par += par;
  let birdies = 0, eagles = 0, aces = 0, three = 0, fw = 0, fwc = 0, longest = 0;
  for (const x of played) {
    const d = x.s - x.par;
    if (x.s === 1) aces++;
    if (d <= -2) eagles++; else if (d === -1) birdies++; else if (d === 0) st.pars++; else if (d === 1) st.bogeys++; else st.doubles++;
    const l = x.log || {};
    st.putts += l.putts || 0;
    if ((l.putts || 0) >= 3) three++;
    if (l.gir) st.gir++;
    if (l.fairwayHit !== null && l.fairwayHit !== undefined) { fwc++; if (l.fairwayHit) fw++; }
    if (l.driveDistance > longest) longest = l.driveDistance;
  }
  st.birdies += birdies; st.eagles += eagles; st.holesInOne += aces; st.threePutts += three; st.fairways += fw; st.fairwayChances += fwc;
  st.longestDrive = Math.max(st.longestDrive, longest);
  const key = `${round.courseId}:${played.length}`;
  const toPar = strokes - par;
  if (st.best[key] === undefined || toPar < st.best[key]) st.best[key] = toPar;
  const entry = { id: `${now}-${round.seed}`, date: now, courseId: round.courseId, mode: round.mode, holes: played.length, strokes, par, toPar, birdies, putts: played.reduce((a, x) => a + ((x.log && x.log.putts) || 0), 0), eventId: round.eventId || null };
  let next = { ...save, stats: st, history: [...save.history, entry].slice(-HISTORY_CAP) };
  const coursesPlayed = new Set(next.history.map((h) => h.courseId));
  const checks = {
    'first-round': true, birdie: birdies + eagles > 0, eagle: eagles > 0, ace: aces > 0, 'under-par': toPar < 0,
    'no-three-putts': played.length >= 18 && three === 0, 'long-drive': longest >= 300 * YARD, fairways: played.length >= 9 && fwc > 0 && fw === fwc,
    'all-courses': coursesPlayed.size >= 5,
  };
  const r = unlock(next, Object.keys(checks).filter((k) => checks[k]), now);
  return { save: r.save, unlocked: r.unlocked, entry };
}
export function unlock(save, ids, now = 0) {
  const ach = { ...save.achievements };
  const got = [];
  for (const id of ids) if (!ach[id] && ACHIEVEMENTS.some((a) => a.id === id)) { ach[id] = now || 1; got.push(id); }
  return { save: got.length ? { ...save, achievements: ach } : save, unlocked: got };
}

// --- daily challenge ---
export const dayKey = (date) => {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
export function recordDaily(save, key, { strokes, toPar }, now = 0) {
  const prev = save.daily[key];
  const best = !prev || strokes < prev.strokes ? { strokes, toPar, attempts: (prev ? prev.attempts : 0) + 1 } : { ...prev, attempts: prev.attempts + 1 };
  let next = { ...save, daily: { ...save.daily, [key]: best } };
  const days = Object.keys(next.daily).length;
  if (days >= 3) next = unlock(next, ['daily-3'], now).save;
  return next;
}

// Derived numbers for the stats screen.
export function statsSummary(stats) {
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
  return {
    rounds: stats.rounds,
    scoring: stats.holes ? +((stats.strokes - stats.par) / stats.holes * 18).toFixed(1) : null, // per 18 holes, to par
    puttsPerHole: stats.holes ? +(stats.putts / stats.holes).toFixed(2) : null,
    fairwayPct: pct(stats.fairways, stats.fairwayChances),
    girPct: pct(stats.gir, stats.holes),
    birdies: stats.birdies, eagles: stats.eagles, holesInOne: stats.holesInOne,
    longestDrive: stats.longestDrive,
  };
}
