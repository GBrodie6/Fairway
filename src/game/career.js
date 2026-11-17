// Career: a golfer, a season of tiered events, rivals with persistent skill, attributes and
// equipment with tradeoffs, and experience. Every function here is pure: it takes a career
// object and returns a new one (or a value), so it is unit tested and safe to save.
import { createRng, hashString } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { BASE_PROFILE } from '../physics/shot.js';
import { COURSES, courseById } from '../course/courses.js';

export const CAREER_VERSION = 1;

// --- attributes ---
// Each attribute runs 0..100 with 50 as the neutral golfer. 50 everywhere gives exactly the
// base profile, so the calibrated carry ladder is untouched for a new player.
export const ATTRIBUTES = ['power', 'accuracy', 'shortGame', 'putting', 'recovery'];
export const ATTRIBUTE_INFO = {
  power: { name: 'Power', text: 'Ball speed on full swings.' },
  accuracy: { name: 'Accuracy', text: 'How much a mistimed swing strays.' },
  shortGame: { name: 'Short game', text: 'Spin and touch on wedges and chips.' },
  putting: { name: 'Putting', text: 'How true the face is through the ball on the green.' },
  recovery: { name: 'Recovery', text: 'How well you play from rough, sand, and bad lies.' },
};
export const ATTR_MIN = 30, ATTR_MAX = 95;

// --- equipment ---
// Every choice gives something and takes something. Effects multiply the profile.
export const EQUIPMENT = {
  driver: [
    { id: 'standard', name: 'Standard driver', text: 'Balanced.', fx: {} },
    { id: 'distance', name: 'Long driver', text: 'More ball speed, less forgiving.', fx: { power: 1.03, accuracy: 1.12 } },
    { id: 'control', name: 'Control driver', text: 'Straighter, a few yards shorter.', fx: { power: 0.98, accuracy: 0.88 } },
  ],
  irons: [
    { id: 'standard', name: 'Cavity irons', text: 'Balanced.', fx: {} },
    { id: 'blade', name: 'Blade irons', text: 'More spin and control, punishes mishits.', fx: { spin: 1.06, forgiveness: 1.15 } },
    { id: 'game', name: 'Game-improvement irons', text: 'Forgiving, less spin.', fx: { spin: 0.95, forgiveness: 0.85 } },
  ],
  putter: [
    { id: 'standard', name: 'Blade putter', text: 'Balanced.', fx: {} },
    { id: 'mallet', name: 'Mallet putter', text: 'Steadier face, a little less feel.', fx: { putting: 0.88, touch: 1.04 } },
  ],
  ball: [
    { id: 'standard', name: 'Two-piece ball', text: 'Balanced.', fx: {} },
    { id: 'tour', name: 'Tour ball', text: 'More spin around the greens, less distance.', fx: { spin: 1.07, power: 0.99 } },
    { id: 'distance', name: 'Distance ball', text: 'Longer, harder to stop.', fx: { power: 1.015, spin: 0.92 } },
  ],
};
// Unlock level for each non-standard item.
export const UNLOCK_LEVEL = { distance: 3, control: 2, blade: 5, game: 2, mallet: 3, tour: 4 };

export function equipmentItem(slot, id) {
  return (EQUIPMENT[slot] || []).find((e) => e.id === id) || EQUIPMENT[slot][0];
}

// Map attributes and equipment to the physics profile. Bounded so no build breaks the game.
export function profileFor(career) {
  const a = career && career.attributes ? career.attributes : {};
  const v = (k) => (clamp(Number.isFinite(a[k]) ? a[k] : 50, ATTR_MIN, ATTR_MAX) - 50) / 50; // -0.4 .. 0.9
  const p = { ...BASE_PROFILE };
  p.power = 1 + v('power') * 0.06; // up to about +5 percent
  p.accuracy = 1 - v('accuracy') * 0.35;
  p.spin = 1 + v('shortGame') * 0.08;
  p.touch = 1 - v('shortGame') * 0.3;
  p.putting = 1 - v('putting') * 0.4;
  p.recovery = 1 - v('recovery') * 0.35;
  p.forgiveness = 1 - (v('accuracy') + v('shortGame')) * 0.1;
  const eq = (career && career.equipment) || {};
  for (const slot of Object.keys(EQUIPMENT)) {
    const fx = equipmentItem(slot, eq[slot]).fx;
    for (const [k, m] of Object.entries(fx)) p[k] *= m;
  }
  p.power = clamp(p.power, 0.95, 1.08);
  for (const k of ['accuracy', 'touch', 'putting', 'recovery', 'forgiveness']) p[k] = clamp(p[k], 0.45, 1.3);
  p.spin = clamp(p.spin, 0.88, 1.15);
  return Object.freeze(p);
}

// --- experience ---
// Level n needs 120 * n^1.5 XP in total (level 1 at 0).
export const xpForLevel = (level) => Math.round(120 * Math.pow(Math.max(0, level - 1), 1.5));
export function levelForXp(xp) {
  let l = 1;
  while (xpForLevel(l + 1) <= xp && l < 50) l++;
  return l;
}
// Points per level: 3 attribute points.
export const POINTS_PER_LEVEL = 3;

export function xpForRound({ toPar = 0, holes = 9, birdies = 0, eagles = 0, finish = null, field = 0, tier = 1 } = {}) {
  const base = holes * 6;
  const scoring = Math.max(0, holes * 0.6 - toPar) * 8;
  const bonus = birdies * 12 + eagles * 40;
  const place = finish && field ? Math.round(clamp(1 - (finish - 1) / field, 0, 1) * 60 * tier) : 0;
  return Math.round(base + scoring + bonus + place);
}

// --- rivals ---
const FIRST = ['Rowan', 'Kit', 'Ari', 'Jules', 'Sam', 'Noor', 'Teo', 'Mika', 'Ilse', 'Darian', 'Wren', 'Oskar', 'Lena', 'Pax', 'Juno', 'Ellis', 'Tamsin', 'Idris', 'Maren', 'Calla'];
const LAST = ['Vale', 'Ashby', 'Kerrow', 'Lindqvist', 'Moreau', 'Okafor', 'Tanaka', 'Holloway', 'Brannock', 'Sorel', 'Quill', 'Fenwick', 'Arden', 'Castellan', 'Ilves', 'Marchetti', 'Rook', 'Thorne', 'Halvard', 'Penrose'];
// Invented names only. Combinations are checked against nothing real; they are generated
// from short lists of common first names and invented surnames.
export function makeRivals(seed, n = 11) {
  const rng = createRng(seed ^ 0x51f15e);
  const used = new Set();
  const out = [];
  while (out.length < n) {
    const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    if (used.has(name)) continue;
    used.add(name);
    // A spread of abilities: a couple of stars, a solid middle, and some journeymen.
    const skill = clamp(0.42 + (out.length / n) * 0.4 + rng.range(-0.05, 0.05), 0.35, 0.9);
    out.push({ id: `r${out.length + 1}`, name, skill: +skill.toFixed(3), form: 0, wins: 0 });
  }
  return out.sort((a, b) => b.skill - a.skill);
}

// --- season and events ---
export const TIERS = [
  { tier: 1, name: 'Club series', holes: 9, field: 8, qualify: 3, purse: 1 },
  { tier: 2, name: 'Regional tour', holes: 18, field: 10, qualify: 3, purse: 2 },
  { tier: 3, name: 'Championship tour', holes: 18, field: 12, qualify: 1, purse: 3 },
];
const EVENT_NAMES = { 1: ['Spring Medal', 'Members Cup', 'Twilight Open'], 2: ['Coast Classic', 'Highland Invitational', 'Riverside Open'], 3: ['Grand Championship', 'Masters of the Mesa', 'Season Finale'] };

export function buildSeason(seed, index = 0) {
  const rng = createRng(seed * 7 + index * 131 + 3);
  const courses = COURSES.filter((c) => c.flagship !== false).map((c) => c.id);
  const all = COURSES.map((c) => c.id);
  const events = [];
  for (const t of TIERS) {
    const names = EVENT_NAMES[t.tier];
    for (let i = 0; i < names.length; i++) {
      const pool = t.tier === 3 ? all : courses;
      events.push({ id: `s${index}t${t.tier}e${i}`, tier: t.tier, name: names[i], courseId: pool[(i + index + t.tier) % pool.length], holes: t.holes, startHole: t.holes === 9 ? (rng.chance(0.5) ? 1 : 10) : 1, tod: rng.pick(['morning', 'midday', 'golden', 'morning', 'dawn']), field: t.field, result: null });
    }
  }
  return { index, events, tier: 1, done: false };
}

export function createCareer({ name = 'You', handed = 'right', seed = 1, ball = '#ffffff' } = {}) {
  const s = (Number.isFinite(seed) ? seed : hashString(String(seed))) >>> 0;
  return {
    v: CAREER_VERSION,
    name: String(name).slice(0, 18) || 'You', handed: handed === 'left' ? 'left' : 'right', ball,
    seed: s, xp: 0, level: 1, points: 0,
    attributes: Object.fromEntries(ATTRIBUTES.map((k) => [k, 50])),
    equipment: { driver: 'standard', irons: 'standard', putter: 'standard', ball: 'standard' },
    rivals: makeRivals(s),
    season: buildSeason(s, 0),
    ranking: {}, // id -> points this season
    titles: 0, eventsPlayed: 0, history: [],
  };
}

export const currentTier = (career) => TIERS.find((t) => t.tier === career.season.tier) || TIERS[0];
export function nextEvent(career) {
  return career.season.events.find((e) => e.tier === career.season.tier && !e.result) || null;
}
export function unlocked(career, slot, id) {
  return id === 'standard' || career.level >= (UNLOCK_LEVEL[id] || 1);
}

// Spend one attribute point. Returns the same object when the spend is not allowed.
export function spendPoint(career, attr) {
  if (!ATTRIBUTES.includes(attr) || career.points <= 0 || career.attributes[attr] >= ATTR_MAX) return career;
  return { ...career, points: career.points - 1, attributes: { ...career.attributes, [attr]: career.attributes[attr] + 2 } };
}
export function equip(career, slot, id) {
  if (!EQUIPMENT[slot] || !EQUIPMENT[slot].some((e) => e.id === id) || !unlocked(career, slot, id)) return career;
  return { ...career, equipment: { ...career.equipment, [slot]: id } };
}

// A rival's round when it is not played on screen: a seeded statistical model. Per hole, the
// score relative to par has a mean that falls with skill and course difficulty and a spread
// that narrows with skill. It was set against the planner's own AI (see tests).
export function simulateRivalRound(rival, { courseId, holes, seed }) {
  const course = courseById(courseId);
  const rng = createRng((seed ^ hashString(rival.id)) >>> 0);
  const diff = { parkland: 0, links: 0.08, desert: 0.06, alpine: 0.1, tropical: 0.04 }[course.id] || 0;
  const mean = 1.95 - rival.skill * 2.65 + diff - (rival.form || 0) * 0.15;
  const sd = 0.95 - rival.skill * 0.45;
  const scores = [];
  for (let i = 0; i < holes.length; i++) {
    const par = course.pars[holes[i]];
    const r = Math.round(mean + rng.gauss() * sd);
    scores.push(clamp(par + r, Math.max(1, par - 2), par + 4));
  }
  return scores;
}

// Ranking points by finishing position.
export function rankingPoints(position, field, tier) {
  if (!(position >= 1)) return 0;
  return Math.round(Math.max(0, field - position + 1) * 10 * tier + (position === 1 ? 25 * tier : 0));
}

// Record an event: the player's strokes per hole and the rivals' (simulated or played).
// Returns { career, result } where result has the leaderboard and the player's position.
export function completeEvent(career, eventId, { playerScores, rivalScores = {}, date = 0 }) {
  const ev = career.season.events.find((e) => e.id === eventId);
  if (!ev || ev.result) return { career, result: null };
  const course = courseById(ev.courseId);
  const holes = Array.from({ length: ev.holes }, (_, i) => ev.startHole - 1 + i);
  const par = holes.reduce((a, h) => a + course.pars[h], 0);
  const fieldRivals = career.rivals.slice(0, ev.field - 1);
  const board = [{ id: 'me', name: career.name, total: playerScores.reduce((a, b) => a + b, 0) }];
  for (const r of fieldRivals) {
    const sc = rivalScores[r.id] || simulateRivalRound(r, { courseId: ev.courseId, holes, seed: career.seed + hashString(ev.id) });
    board.push({ id: r.id, name: r.name, total: sc.reduce((a, b) => a + b, 0) });
  }
  // Ties share the better position.
  board.sort((a, b) => a.total - b.total || (a.id === 'me' ? -1 : b.id === 'me' ? 1 : 0));
  let pos = 0;
  board.forEach((e, i) => { if (i === 0 || e.total !== board[i - 1].total) pos = i + 1; e.position = pos; e.toPar = e.total - par; });
  const me = board.find((e) => e.id === 'me');
  const ranking = { ...career.ranking };
  for (const e of board) ranking[e.id] = (ranking[e.id] || 0) + rankingPoints(e.position, board.length, ev.tier);
  // Rivals' form drifts with results; skill creeps up for those who play well.
  const rivals = career.rivals.map((r) => {
    const e = board.find((b) => b.id === r.id);
    if (!e) return r;
    const rel = (e.position - 1) / Math.max(1, board.length - 1); // 0 best .. 1 worst
    return { ...r, form: +clamp((r.form || 0) * 0.6 + (0.5 - rel) * 0.8, -1, 1).toFixed(3), skill: +clamp(r.skill + (0.5 - rel) * 0.006, 0.3, 0.92).toFixed(4), wins: r.wins + (e.position === 1 ? 1 : 0) };
  });
  const events = career.season.events.map((e) => (e.id === ev.id ? { ...e, result: { position: me.position, total: me.total, toPar: me.toPar, field: board.length } } : e));
  const birdies = playerScores.filter((s, i) => s === course.pars[holes[i]] - 1).length;
  const eagles = playerScores.filter((s, i) => s <= course.pars[holes[i]] - 2).length;
  const xpGain = xpForRound({ toPar: me.toPar, holes: holes.length, birdies, eagles, finish: me.position, field: board.length, tier: ev.tier });
  let next = { ...career, rivals, ranking, season: { ...career.season, events }, eventsPlayed: career.eventsPlayed + 1, titles: career.titles + (me.position === 1 ? 1 : 0) };
  next = addXp(next, xpGain);
  next.history = [...career.history, { eventId: ev.id, name: ev.name, tier: ev.tier, courseId: ev.courseId, position: me.position, field: board.length, toPar: me.toPar, date }].slice(-60);
  next = advanceSeason(next);
  return { career: next, result: { event: ev, board, position: me.position, par, xp: xpGain } };
}

export function addXp(career, amount) {
  const xp = career.xp + Math.max(0, Math.round(amount || 0));
  const level = levelForXp(xp);
  return { ...career, xp, level, points: career.points + Math.max(0, level - career.level) * POINTS_PER_LEVEL };
}

// When every event of the current tier is played, qualify for the next tier if the player
// finished in the top places of the tier's standings; after the top tier, a new season starts.
export function tierStandings(career, tier = career.season.tier) {
  const evs = career.season.events.filter((e) => e.tier === tier);
  const pts = {};
  // Season ranking points restricted to this tier are approximated from the overall ranking,
  // which is fine because tiers are played in order.
  for (const [id, p] of Object.entries(career.ranking)) pts[id] = p;
  const rows = [{ id: 'me', name: career.name, points: pts.me || 0 }, ...career.rivals.map((r) => ({ id: r.id, name: r.name, points: pts[r.id] || 0 }))];
  rows.sort((a, b) => b.points - a.points);
  return { rows, played: evs.filter((e) => e.result).length, total: evs.length };
}
export function advanceSeason(career) {
  const s = career.season;
  const evs = s.events.filter((e) => e.tier === s.tier);
  if (evs.some((e) => !e.result)) return career;
  const t = TIERS.find((x) => x.tier === s.tier);
  const st = tierStandings(career);
  const place = st.rows.findIndex((r) => r.id === 'me') + 1;
  const qualified = place <= t.qualify || evs.some((e) => e.result.position === 1);
  if (qualified && s.tier < TIERS.length) return { ...career, season: { ...s, tier: s.tier + 1 }, lastQualified: { tier: s.tier, place } };
  if (s.tier === TIERS.length || !qualified) {
    // Season over (or not qualified): a new season at the same tier or the top tier again.
    const nextIdx = s.index + 1;
    const fresh = buildSeason(career.seed, nextIdx);
    const tier = qualified ? TIERS.length : s.tier;
    // A failed tier is replayed in the next season; the reached tier is kept.
    return { ...career, season: { ...fresh, tier: Math.max(1, tier) }, ranking: {}, lastSeason: { index: s.index, tier: s.tier, place } };
  }
  return career;
}

// Light validation for saves.
export function validateCareer(c) {
  if (!c || typeof c !== 'object') return false;
  if (c.v !== CAREER_VERSION) return false;
  if (!Number.isFinite(c.xp) || !Number.isFinite(c.level) || !c.attributes || !Array.isArray(c.rivals) || !c.season || !Array.isArray(c.season.events)) return false;
  return ATTRIBUTES.every((k) => Number.isFinite(c.attributes[k]));
}
