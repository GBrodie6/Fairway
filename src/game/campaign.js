// Campaign and golfer progression: six archetypes with perks and weaknesses (and evolutions at
// levels 10 and 25), levels to 40 with one skill point per level, five stats, a 20-node skill
// tree per archetype (stats, perks, and shot unlocks), and six chapters of events with
// objectives, stars, and a named boss in each chapter. Pure functions over plain objects.
//
// Golfer: save.profile = { xp, archetype, nodes: [ids], respecs }. Every effect is a bounded
// modifier: a level 1 golfer of any archetype has the base physics profile and no carry bonus,
// so a perfect strike with a Common club still lands on the calibrated carry ladder.
import { shotData } from '../data/shotTypes.js';
import { createRng, hashString } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { BASE_PROFILE } from '../physics/shot.js';
import { courseById } from '../course/courses.js';
import { makeRivals, simulateRivalRound } from './career.js';

// ---------------------------------------------------------------- stats and levels
export const STATS = ['driving', 'approach', 'shortGame', 'putting', 'management'];
export const STAT_INFO = {
  driving: { name: 'Driving', text: 'Ball speed on full swings, felt most off the tee.' },
  approach: { name: 'Approach', text: 'How far a mistimed or drifting swing strays.' },
  shortGame: { name: 'Short game', text: 'Spin and touch on wedges, chips, and pitches.' },
  putting: { name: 'Putting', text: 'How square the putter face stays through the ball.' },
  management: { name: 'Course management', short: 'Management', text: 'Playing from rough, sand, and awkward lies, and keeping tempo.' },
};
export const STAT_BASE = 50, STAT_MAX = 95;
export const MAX_LEVEL = 40;
// Total XP to reach a level (level 1 at 0). About 10 events to level 10 and 90 to level 40.
export const xpToReach = (level) => (level <= 1 ? 0 : Math.round(90 * Math.pow(Math.min(level, MAX_LEVEL) - 1, 1.6)));
export function levelForXp(xp) {
  let l = 1;
  while (l < MAX_LEVEL && xpToReach(l + 1) <= (xp || 0)) l++;
  return l;
}
export function xpProgress(xp) {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return { level, into: 0, need: 0, frac: 1 };
  const a = xpToReach(level), b = xpToReach(level + 1);
  return { level, into: xp - a, need: b - a, frac: (xp - a) / (b - a) };
}
export const evolutionStage = (level) => (level >= 25 ? 2 : level >= 10 ? 1 : 0);

// ---------------------------------------------------------------- archetypes
// innate: a perk from level 1 that never changes a pured carry; it grows 1.5x at the first
// evolution and 2x at the second. caps: the weakness, a lower ceiling on some stats.
// signature: the stat that gains +4 at each evolution.
export const ARCHETYPES = {
  power: {
    id: 'power', name: 'Power Hitter', titles: ['Power Hitter', 'Long Baller', 'Thunder Driver'], color: '#ff8a5a', signature: 'driving',
    text: 'Big drives and a forgiving strike off the tee.', innateText: 'A bigger sweet spot with the driver and woods.',
    weakness: 'Short game capped at 78, putting at 82.', caps: { shortGame: 78, putting: 82 }, innate: { woodSweet: 0.07 },
  },
  sharp: {
    id: 'sharp', name: 'Sharpshooter', titles: ['Sharpshooter', 'Pin Seeker', 'Flag Hunter'], color: '#6fb6ff', signature: 'approach',
    text: 'Irons that hold their line. Lives on the green in regulation.', innateText: 'Face and path errors stray a little less (1 percent, growing as you evolve).',
    weakness: 'Driving capped at 74.', caps: { driving: 74 }, innate: { accuracy: 0.01 },
  },
  short: {
    id: 'short', name: 'Short Game Artist', titles: ['Short Game Artist', 'Wedge Wizard', 'Greenside Maestro'], color: '#7fd69a', signature: 'shortGame',
    text: 'Gets up and down from anywhere.', innateText: 'Chips and pitches are 8 percent tighter.',
    weakness: 'Driving capped at 72.', caps: { driving: 72 }, innate: { touch: 0.08 },
  },
  putt: {
    id: 'putt', name: 'Putting Specialist', titles: ['Putting Specialist', 'Green Reader', 'Silk Stroke'], color: '#c08bff', signature: 'putting',
    text: 'Holes everything inside ten feet.', innateText: 'The putter face strays 10 percent less.',
    weakness: 'Driving capped at 74, approach at 82.', caps: { driving: 74, approach: 82 }, innate: { putting: 0.1 },
  },
  links: {
    id: 'links', name: 'Links Player', titles: ['Links Player', 'Wind Cheater', 'Storm Rider'], color: '#e8d27a', signature: 'management',
    text: 'Keeps it low, plays the ground, and loves bad weather.', innateText: 'Rough and sand cost 8 percent less. The punch shot from the start.',
    weakness: 'Short game capped at 80.', caps: { shortGame: 80 }, innate: { recovery: 0.08 }, startShots: ['punch'],
  },
  all: {
    id: 'all', name: 'All-Rounder', titles: ['All-Rounder', 'Complete Golfer', 'Total Player'], color: '#d8dde2', signature: null,
    text: 'No weakness and no single strength.', innateText: 'An extra skill point at levels 5 and 15.',
    weakness: 'Smaller perks than the specialists.', caps: {}, innate: {}, bonusPoints: [5, 15], perkScale: 0.8,
  },
};
export const ARCHETYPE_IDS = Object.keys(ARCHETYPES);

export function pointsTotal(level, archetype) {
  const a = ARCHETYPES[archetype];
  let p = Math.max(0, Math.min(level, MAX_LEVEL) - 1);
  if (a && a.bonusPoints) p += a.bonusPoints.filter((l) => level >= l).length;
  return p;
}

// ---------------------------------------------------------------- skill trees
// Four branches of five nodes. Each node needs the one before it in its branch. Kinds:
//   stat  { stat, amount }         +amount to a stat (capped)
//   perk  { perk, value }          a bounded modifier (see PERK_LIMITS)
//   shot  { shot }                 unlocks a shot type: punch, high, flop, bump
export const SHOTS = { punch: 'Punch', high: 'High', flop: 'Flop', bump: 'Bump and run' };
export const PERK_INFO = {
  // Stored as pureCarry so old saves keep their nodes. It is part of the golfer's profile (ball
  // speed on every full swing, half the value), so the power guide includes it exactly.
  pureCarry: { name: 'Clean speed', unit: 'ball speed on full swings, shown in the guide', fmt: (v) => `+${(v * 50).toFixed(1)} percent` },
  sweet: { name: 'Sweet spot', unit: 'sweet spot size', fmt: (v) => `+${Math.round(v * 100)} percent` },
  woodSweet: { name: 'Wood sweet spot', unit: 'sweet spot with driver and woods', fmt: (v) => `+${Math.round(v * 100)} percent` },
  accuracy: { name: 'True line', unit: 'less face and path error', fmt: (v) => `${Math.round(v * 100)} percent` },
  touch: { name: 'Soft hands', unit: 'tighter chips and pitches', fmt: (v) => `${Math.round(v * 100)} percent` },
  spin: { name: 'Bite', unit: 'more wedge and iron spin', fmt: (v) => `+${Math.round(v * 100)} percent` },
  putting: { name: 'Steady stroke', unit: 'less putter face error', fmt: (v) => `${Math.round(v * 100)} percent` },
  recovery: { name: 'Escape artist', unit: 'smaller penalty from rough and sand', fmt: (v) => `${Math.round(v * 100)} percent` },
  tempo: { name: 'Smooth tempo', unit: 'less tempo error', fmt: (v) => `${Math.round(v * 100)} percent` },
};
// Totals across innate perks and tree perks are capped here.
export const PERK_LIMITS = { pureCarry: 0.04, sweet: 0.12, woodSweet: 0.15, accuracy: 0.2, touch: 0.25, spin: 0.06, putting: 0.25, recovery: 0.25, tempo: 0.15 };

const S = (stat, amount = 4) => ({ kind: 'stat', stat, amount, cost: 1 });
const P = (perk, value, cost = 2) => ({ kind: 'perk', perk, value, cost });
const U = (shot) => ({ kind: 'shot', shot, cost: 1 });
// Branch templates per archetype: [driving branch, approach branch, short game branch, green branch].
const TREES = {
  power: [
    [S('driving'), P('woodSweet', 0.04), S('driving'), P('pureCarry', 0.02), P('pureCarry', 0.02, 3)],
    [S('approach'), U('punch'), S('approach'), P('accuracy', 0.04), U('high')],
    [S('shortGame', 3), U('bump'), P('spin', 0.02), U('flop'), S('shortGame', 3)],
    [S('putting', 3), S('management'), P('tempo', 0.05), P('putting', 0.06), S('management')],
  ],
  sharp: [
    [S('driving', 3), P('sweet', 0.03), S('driving', 3), U('punch'), P('pureCarry', 0.01)],
    [S('approach', 3), P('accuracy', 0.012), S('approach', 3), U('high'), P('accuracy', 0.015, 3)],
    [S('shortGame'), U('bump'), P('spin', 0.03), U('flop'), S('shortGame')],
    [S('putting'), S('management'), P('tempo', 0.05), P('putting', 0.06), S('management')],
  ],
  short: [
    [S('driving', 3), P('sweet', 0.03), S('driving', 3), U('punch'), P('pureCarry', 0.01)],
    [S('approach'), U('high'), S('approach'), P('accuracy', 0.04), S('approach', 3)],
    [S('shortGame'), U('flop'), P('touch', 0.08), U('bump'), P('spin', 0.04, 3)],
    [S('putting'), S('management'), P('touch', 0.06), P('putting', 0.06), S('management')],
  ],
  putt: [
    [S('driving', 3), P('sweet', 0.03), S('driving', 3), U('punch'), P('pureCarry', 0.01)],
    [S('approach'), U('high'), S('approach'), P('accuracy', 0.04), S('approach', 3)],
    [S('shortGame'), U('bump'), P('touch', 0.05), U('flop'), S('shortGame')],
    [S('putting'), P('putting', 0.06), S('putting'), P('putting', 0.06, 3), S('management')],
  ],
  links: [
    [S('driving'), P('sweet', 0.03), S('driving', 3), P('pureCarry', 0.01), S('driving', 3)],
    [S('approach'), U('high'), S('approach'), P('accuracy', 0.04), S('approach', 3)],
    [S('shortGame', 3), U('bump'), P('spin', 0.02), U('flop'), S('shortGame', 3)],
    [S('management'), P('recovery', 0.06), S('management'), P('tempo', 0.06, 3), S('putting')],
  ],
  all: [
    [S('driving'), P('sweet', 0.03), S('driving'), U('punch'), P('pureCarry', 0.015)],
    [S('approach'), U('high'), S('approach'), P('accuracy', 0.04), S('approach')],
    [S('shortGame'), U('bump'), P('touch', 0.05), U('flop'), S('shortGame')],
    [S('putting'), S('management'), P('putting', 0.05), P('recovery', 0.05), S('management')],
  ],
};
export const BRANCH_NAMES = ['Off the tee', 'Approach', 'Short game', 'On the green'];

function nodeName(n) {
  if (n.kind === 'stat') return `${STAT_INFO[n.stat].short || STAT_INFO[n.stat].name} +${n.amount}`;
  if (n.kind === 'shot') return `${SHOTS[n.shot]} shot`;
  return PERK_INFO[n.perk].name;
}
function nodeText(n, scale = 1) {
  if (n.kind === 'stat') return `Raise ${STAT_INFO[n.stat].name.toLowerCase()} by ${n.amount}.`;
  if (n.kind === 'shot') return { punch: 'A low, running shot under the wind and branches.', high: 'A high, soft shot that stops quickly.', flop: 'A very high wedge that lands softly.', bump: 'A low chip that runs out like a putt.' }[n.shot];
  return `${PERK_INFO[n.perk].fmt(n.value * scale)} ${PERK_INFO[n.perk].unit}.`;
}
const treeCache = {};
export function treeFor(archetype) {
  if (treeCache[archetype]) return treeCache[archetype];
  const a = ARCHETYPES[archetype] || ARCHETYPES.all;
  const scale = a.perkScale || 1;
  const nodes = [];
  (TREES[a.id] || TREES.all).forEach((branch, b) => branch.forEach((spec, t) => {
    const n = { ...spec, id: `${a.id}-${b}-${t}`, branch: b, tier: t, requires: t > 0 ? `${a.id}-${b}-${t - 1}` : null };
    if (n.kind === 'perk') n.value = +(n.value * scale).toFixed(4);
    n.name = nodeName(n); n.text = nodeText(n);
    nodes.push(n);
  }));
  treeCache[archetype] = nodes;
  return nodes;
}

export function newGolfer(archetype = null, xp = 0) {
  const n = Number(xp);
  return { xp: Number.isFinite(n) ? Math.min(1e8, Math.max(0, Math.floor(n))) : 0, archetype: ARCHETYPES[archetype] ? archetype : null, nodes: [], respecs: 0 };
}
export function sanitizeGolfer(g) {
  const out = newGolfer(g && g.archetype, g && g.xp);
  if (!g || !out.archetype) return out;
  const tree = treeFor(out.archetype);
  const level = levelForXp(out.xp);
  let budget = pointsTotal(level, out.archetype);
  const owned = new Set();
  // Keep nodes in order while they are legal and affordable.
  for (const id of Array.isArray(g.nodes) ? g.nodes : []) {
    const n = tree.find((x) => x.id === id);
    if (!n || owned.has(id) || (n.requires && !owned.has(n.requires)) || n.cost > budget) continue;
    owned.add(id); budget -= n.cost;
  }
  out.nodes = [...owned];
  out.respecs = Math.max(0, Math.floor(Number(g.respecs) || 0));
  return out;
}
export const golferLevel = (g) => levelForXp((g && g.xp) || 0);
export function pointsSpent(g) {
  if (!g || !g.archetype) return 0;
  const tree = treeFor(g.archetype);
  return g.nodes.reduce((a, id) => a + ((tree.find((n) => n.id === id) || {}).cost || 0), 0);
}
export const pointsFree = (g) => (g && g.archetype ? pointsTotal(golferLevel(g), g.archetype) - pointsSpent(g) : 0);

export function canBuy(g, id) {
  if (!g || !g.archetype) return { ok: false, reason: 'Choose an archetype first.' };
  const n = treeFor(g.archetype).find((x) => x.id === id);
  if (!n) return { ok: false, reason: 'Unknown skill.' };
  if (g.nodes.includes(id)) return { ok: false, reason: 'Already learned.' };
  if (n.requires && !g.nodes.includes(n.requires)) return { ok: false, reason: 'Learn the skill before it first.' };
  if (pointsFree(g) < n.cost) return { ok: false, reason: `Needs ${n.cost} skill point${n.cost === 1 ? '' : 's'}.` };
  return { ok: true, node: n };
}
export function buyNode(g, id) {
  return canBuy(g, id).ok ? { ...g, nodes: [...g.nodes, id] } : g;
}
// Respec: every point back, free. The count is kept for the profile page.
export const respec = (g) => ({ ...g, nodes: [], respecs: (g.respecs || 0) + 1 });

// The recommended path: the archetype's signature branch first, then the cheapest available.
export function autoBuild(archetype, level) {
  let g = { ...newGolfer(archetype, xpToReach(level)) };
  const tree = treeFor(archetype);
  const sig = { power: 0, sharp: 1, short: 2, putt: 3, links: 3, all: -1 }[archetype];
  const order = [...tree].sort((a, b) => (a.branch === sig ? 0 : 1) - (b.branch === sig ? 0 : 1) || a.tier - b.tier || a.branch - b.branch);
  for (let guard = 0; guard < 40; guard++) {
    const next = order.find((n) => canBuy(g, n.id).ok);
    if (!next) break;
    g = buyNode(g, next.id);
  }
  return g;
}

// ---------------------------------------------------------------- what the golfer plays like
export function golferStats(g) {
  const out = Object.fromEntries(STATS.map((s) => [s, STAT_BASE]));
  if (!g || !g.archetype) return out;
  const a = ARCHETYPES[g.archetype];
  const tree = treeFor(g.archetype);
  for (const id of g.nodes) { const n = tree.find((x) => x.id === id); if (n && n.kind === 'stat') out[n.stat] += n.amount; }
  const stage = evolutionStage(golferLevel(g));
  if (a.signature) out[a.signature] += 4 * stage;
  else for (const s of STATS) out[s] += stage; // the All-Rounder grows a little everywhere
  for (const s of STATS) out[s] = clamp(out[s], 30, Math.min(STAT_MAX, a.caps[s] ?? STAT_MAX));
  return out;
}
export function golferPerks(g) {
  const out = Object.fromEntries(Object.keys(PERK_LIMITS).map((k) => [k, 0]));
  if (!g || !g.archetype) return out;
  const a = ARCHETYPES[g.archetype];
  const grow = [1, 1.5, 2][evolutionStage(golferLevel(g))];
  for (const [k, v] of Object.entries(a.innate || {})) out[k] += v * grow;
  const tree = treeFor(g.archetype);
  for (const id of g.nodes) { const n = tree.find((x) => x.id === id); if (n && n.kind === 'perk') out[n.perk] += n.value; }
  for (const k of Object.keys(out)) out[k] = clamp(out[k], 0, PERK_LIMITS[k]);
  return out;
}
// A shot type is unlocked by the skill tree node it names in data/shotTypes.js ('base' shots
// are always there; the Stinger and Knockdown come with the Punch node, for example).
export function shotUnlocked(g, shotId) {
  if (shotId === 'putt') return true;
  const d = shotData(shotId);
  const via = d.id === shotId ? d.unlock : shotId;
  if (via === 'base') return true;
  if (!g || !g.archetype) return false;
  if ((ARCHETYPES[g.archetype].startShots || []).includes(via)) return true;
  const tree = treeFor(g.archetype);
  return g.nodes.some((id) => { const n = tree.find((x) => x.id === id); return n && n.kind === 'shot' && n.shot === via; });
}

// The physics profile for the golfer: the same mapping and bounds as the career's profileFor,
// with the five campaign stats, then perks. All stats at 50 and no perks is the base profile.
export function golferProfile(g) {
  const st = golferStats(g), pk = golferPerks(g);
  const v = (k) => (clamp(st[k], 30, STAT_MAX) - 50) / 50;
  const p = { ...BASE_PROFILE };
  p.power = (1 + v('driving') * 0.07) * (1 + pk.pureCarry * 0.5);
  p.accuracy = (1 - v('approach') * 0.2) * (1 - pk.accuracy);
  p.spin = (1 + v('shortGame') * 0.08) * (1 + pk.spin);
  p.touch = (1 - v('shortGame') * 0.3) * (1 - pk.touch);
  p.putting = (1 - v('putting') * 0.4) * (1 - pk.putting);
  p.recovery = (1 - v('management') * 0.35) * (1 - pk.recovery);
  p.forgiveness = (1 - (v('approach') + v('management')) * 0.08) * (1 - pk.tempo);
  p.power = clamp(p.power, 0.95, 1.08);
  for (const k of ['accuracy', 'touch', 'putting', 'recovery', 'forgiveness']) p[k] = clamp(p[k], 0.45, 1.3);
  p.spin = clamp(p.spin, 0.88, 1.15);
  return Object.freeze(p);
}
// What the strike model reads: a sweet spot multiplier (capped again in game/strike.js). No
// strike adds carry; the speed perk lives in the profile above.
export function golferStrike(g, clubKind = 'iron') {
  const pk = golferPerks(g);
  const sweet = 1 + pk.sweet + (clubKind === 'wood' ? pk.woodSweet : 0);
  return { forgiveness: clamp(sweet, 0.85, 1.15) };
}

// ---------------------------------------------------------------- bosses and chapters
// Invented people; no likeness of anyone. Shown as initials on a colored badge.
export const BOSSES = {
  ashvale: { id: 'ashvale', name: 'Corin Ashvale', title: 'Club champion', skill: 0.62, color: '#7fd69a', trait: 'Never misses a fairway and never lets you forget it.' },
  quillon: { id: 'quillon', name: 'Dessa Quillon', title: 'Regional number one', skill: 0.7, color: '#6fb6ff', trait: 'A wedge magician. Anything inside 100 yards is a birdie chance.' },
  wren: { id: 'wren', name: 'Tobiah Wren', title: 'Tour long hitter', skill: 0.76, color: '#ff8a5a', trait: 'Long and loose. Drives it 300 and goes for every green.' },
  castellane: { id: 'castellane', name: 'Imogen Castellane', title: 'Major winner', skill: 0.82, color: '#c08bff', trait: 'An ice-cold putter who closes out every lead.' },
  halloran: { id: 'halloran', name: 'Rafe Halloran', title: 'Your rival', skill: 0.84, color: '#ffd166', trait: 'Beat you at the club years ago. Has been waiting for a rematch.' },
  blackwood: { id: 'blackwood', name: 'Saoirse Blackwood', title: 'World number one', skill: 0.88, color: '#e8e8e8', trait: 'The best in the game. No weaknesses, only patience.' },
};
const O = (kind, target, text, main = false) => ({ kind, target, text, main });
// Each chapter's events: [name, course, holes, tod, field, objectives, options].
const CH = [
  { id: 'club', name: 'The Club', text: 'Win your way up at home.', boss: 'ashvale', reward: { clubId: 'PW', rarity: 'uncommon' }, events: [
    ['Monthly Medal', 'parkland', 3, 'morning', 6, [O('finish', 3, 'Finish in the top 3', true), O('birdies', 1, 'Make a birdie'), O('fairways', 2, 'Hit 2 fairways')]],
    ['Twilight Stableford', 'parkland', 3, 'golden', 6, [O('toPar', 1, 'Finish at 1 over or better', true), O('gir', 2, 'Hit 2 greens in regulation'), O('rangeMedal', 'target', 'Hold a bronze in Target points (range)')]],
    ['Members Cup', 'tropical', 6, 'midday', 6, [O('finish', 2, 'Finish in the top 2', true), O('putts', 11, '11 putts or fewer'), O('birdies', 1, 'Make a birdie')]],
    ['Club Championship', 'parkland', 6, 'morning', 6, [O('beatBoss', 0, 'Beat Corin Ashvale', true), O('toPar', 0, 'Finish at even par or better'), O('fairways', 3, 'Hit 3 fairways')], { boss: true }],
  ] },
  { id: 'regional', name: 'Regional Circuit', text: 'New courses, stronger fields.', boss: 'quillon', reward: { clubId: 'I7', rarity: 'rare' }, events: [
    ['Coastline Open', 'links', 6, 'morning', 8, [O('finish', 4, 'Finish in the top 4', true), O('fairways', 3, 'Hit 3 fairways'), O('noDouble', 0, 'No double bogeys')]],
    ['Red Rock Classic', 'desert', 6, 'midday', 8, [O('finish', 3, 'Finish in the top 3', true), O('gir', 3, 'Hit 3 greens in regulation'), O('birdies', 2, 'Make 2 birdies')]],
    ['Pinewood Invitational', 'alpine', 6, 'dawn', 8, [O('toPar', 1, 'Finish at 1 over or better', true), O('putts', 11, '11 putts or fewer'), O('rangeMedal', 'ladder', 'Hold a bronze in the Wedge ladder (range)')]],
    ['Lagoon Pro-Am', 'tropical', 6, 'golden', 8, [O('finish', 2, 'Finish in the top 2', true), O('birdies', 2, 'Make 2 birdies'), O('noDouble', 0, 'No double bogeys')]],
    ['Regional Final', 'links', 9, 'morning', 8, [O('beatBoss', 0, 'Beat Dessa Quillon', true), O('finish', 1, 'Win the event'), O('gir', 4, 'Hit 4 greens in regulation')], { boss: true }],
  ] },
  { id: 'tour', name: 'The Tour', text: 'Nine-hole events against the touring pros.', boss: 'wren', reward: { clubId: 'DR', rarity: 'rare' }, events: [
    ['Harbor Lights Classic', 'tropical', 9, 'golden', 10, [O('finish', 5, 'Finish in the top 5', true), O('toPar', 0, 'Finish at even par or better'), O('fairways', 4, 'Hit 4 fairways')]],
    ['Canyon Masters', 'desert', 9, 'morning', 10, [O('finish', 4, 'Finish in the top 4', true), O('longDrive', 270, 'Drive one 270 yards or more'), O('birdies', 2, 'Make 2 birdies')]],
    ['Highland Trophy', 'alpine', 9, 'midday', 10, [O('finish', 3, 'Finish in the top 3', true), O('noDouble', 0, 'No double bogeys'), O('putts', 16, '16 putts or fewer')]],
    ['Dunes Invitational', 'links', 9, 'dawn', 10, [O('finish', 3, 'Finish in the top 3', true), O('gir', 5, 'Hit 5 greens in regulation'), O('rangeMedal', 'longdrive', 'Hold a bronze in Long drive (range)')]],
    ['Tour Championship', 'parkland', 9, 'golden', 10, [O('beatBoss', 0, 'Beat Tobiah Wren', true), O('finish', 1, 'Win the event'), O('toPar', -1, 'Finish at 1 under or better')], { boss: true }],
  ] },
  { id: 'majors', name: 'The Majors', text: 'The four biggest weeks of the year.', boss: 'castellane', reward: { clubId: 'I9', rarity: 'epic' }, events: [
    ['The Spring Major', 'parkland', 9, 'morning', 12, [O('finish', 5, 'Finish in the top 5', true), O('birdies', 2, 'Make 2 birdies'), O('noDouble', 0, 'No double bogeys')]],
    ['The Desert Major', 'desert', 9, 'midday', 12, [O('finish', 4, 'Finish in the top 4', true), O('gir', 5, 'Hit 5 greens in regulation'), O('toPar', -1, 'Finish at 1 under or better')]],
    ['The Mountain Major', 'alpine', 9, 'dawn', 12, [O('finish', 3, 'Finish in the top 3', true), O('putts', 15, '15 putts or fewer'), O('fairways', 5, 'Hit 5 fairways')]],
    ['The Open Links', 'links', 9, 'golden', 12, [O('beatBoss', 0, 'Beat Imogen Castellane', true), O('finish', 1, 'Win the event'), O('rangeMedal', 'target', 'Hold a gold in Target points (range)')], { boss: true }],
  ] },
  { id: 'rivalry', name: 'Rivalry', text: 'Match play against Rafe Halloran, hole by hole.', boss: 'halloran', reward: { clubId: 'DR', rarity: 'epic' }, events: [
    ['Grudge Match', 'parkland', 3, 'morning', 2, [O('matchWin', 0, 'Win the match', true), O('birdies', 1, 'Make a birdie'), O('noDouble', 0, 'No double bogeys')], { match: true }],
    ['Seaside Showdown', 'links', 6, 'golden', 2, [O('matchWin', 0, 'Win the match', true), O('fairways', 3, 'Hit 3 fairways'), O('putts', 11, '11 putts or fewer')], { match: true }],
    ['Desert Duel', 'desert', 6, 'midday', 2, [O('matchWin', 0, 'Win the match', true), O('gir', 3, 'Hit 3 greens in regulation'), O('birdies', 2, 'Make 2 birdies')], { match: true }],
    ['The Decider', 'alpine', 9, 'dusk', 2, [O('matchWin', 0, 'Win the match', true), O('toPar', 0, 'Finish at even par or better'), O('noDouble', 0, 'No double bogeys')], { match: true, boss: true }],
  ] },
  { id: 'final', name: 'The Final', text: 'Everyone you have beaten, and the world number one.', boss: 'blackwood', reward: { clubId: 'PT', rarity: 'legendary' }, events: [
    ['Qualifier', 'tropical', 9, 'morning', 12, [O('finish', 6, 'Finish in the top 6', true), O('birdies', 2, 'Make 2 birdies'), O('fairways', 5, 'Hit 5 fairways')]],
    ['Semi-final Series', 'links', 9, 'midday', 12, [O('finish', 4, 'Finish in the top 4', true), O('gir', 5, 'Hit 5 greens in regulation'), O('putts', 15, '15 putts or fewer')]],
    ['Championship Eve', 'alpine', 9, 'golden', 12, [O('finish', 3, 'Finish in the top 3', true), O('toPar', -1, 'Finish at 1 under or better'), O('noDouble', 0, 'No double bogeys')]],
    ['The Grand Final', 'parkland', 9, 'golden', 12, [O('beatBoss', 0, 'Beat Saoirse Blackwood', true), O('finish', 1, 'Win the Grand Final'), O('toPar', -2, 'Finish at 2 under or better')], { boss: true }],
  ] },
];
export const CHAPTERS = CH.map((c, ci) => ({
  id: c.id, index: ci, name: c.name, text: c.text, boss: c.boss, reward: c.reward,
  events: c.events.map(([name, courseId, holes, tod, field, objectives, opt = {}], ei) => ({
    id: `${c.id}-${ei + 1}`, chapter: ci, index: ei, name, courseId, holes, tod, field, mode: opt.match ? 'match' : 'stroke',
    boss: opt.boss || opt.match ? c.boss : null, bossEvent: !!opt.boss,
    startHole: 1 + ((ci * 5 + ei * 3) % (19 - holes)), objectives: objectives.map((o, oi) => ({ ...o, id: `${c.id}-${ei + 1}-o${oi}` })),
  })),
}));
export const ALL_EVENTS = CHAPTERS.flatMap((c) => c.events);
export const eventById = (id) => ALL_EVENTS.find((e) => e.id === id) || null;
export const holesOf = (ev) => Array.from({ length: ev.holes }, (_, i) => (ev.startHole - 1 + i) % 18);

export const CAMPAIGN_VERSION = 1;
export function createCampaign(seed = 1) {
  return { v: CAMPAIGN_VERSION, seed: seed >>> 0, rivals: makeRivals(seed >>> 0, 14), progress: {} };
}
export function sanitizeCampaign(c) {
  if (!c || typeof c !== 'object' || c.v !== CAMPAIGN_VERSION || !Array.isArray(c.rivals)) return null;
  const progress = {};
  for (const [id, p] of Object.entries(c.progress || {})) {
    if (!eventById(id) || !p || typeof p !== 'object') continue;
    progress[id] = { stars: clamp(Math.floor(Number(p.stars) || 0), 0, 3), cleared: !!p.cleared, plays: Math.max(0, Math.floor(Number(p.plays) || 0)), best: Number.isFinite(p.best) ? p.best : null, met: Array.isArray(p.met) ? p.met.filter((x) => typeof x === 'string') : [] };
  }
  return { v: CAMPAIGN_VERSION, seed: c.seed >>> 0, rivals: c.rivals, progress };
}
export const eventCleared = (c, id) => !!(c && c.progress[id] && c.progress[id].cleared);
export function chapterUnlocked(c, ci) {
  if (ci <= 0) return true;
  const prev = CHAPTERS[ci - 1];
  return eventCleared(c, prev.events[prev.events.length - 1].id);
}
export function eventUnlocked(c, id) {
  const ev = eventById(id);
  if (!ev || !chapterUnlocked(c, ev.chapter)) return false;
  return ev.index === 0 || eventCleared(c, CHAPTERS[ev.chapter].events[ev.index - 1].id);
}
export function chapterStars(c, ci) {
  const ch = CHAPTERS[ci];
  return { got: ch.events.reduce((a, e) => a + ((c && c.progress[e.id] && c.progress[e.id].stars) || 0), 0), total: ch.events.length * 3 };
}
export function nextCampaignEvent(c) {
  return ALL_EVENTS.find((e) => eventUnlocked(c, e.id) && !eventCleared(c, e.id)) || null;
}

// The field: the boss (if any) and the strongest rivals for the chapter.
export function fieldFor(c, ev) {
  const rivals = [...c.rivals].sort((a, b) => b.skill - a.skill);
  // Later chapters draw from the top of the tour; early ones from the middle.
  const skip = Math.max(0, 4 - ev.chapter);
  const lift = ev.chapter * 0.035;
  const pool = rivals.slice(skip, skip + Math.max(0, ev.field - 1 - (ev.boss ? 1 : 0))).map((r) => ({ ...r, skill: clamp(r.skill + lift, 0.3, 0.86) }));
  if (ev.boss) pool.unshift({ ...BOSSES[ev.boss], id: `boss-${ev.boss}`, form: 0, boss: true });
  return ev.mode === 'match' ? pool.filter((r) => r.boss).slice(0, 1) : pool;
}

// Facts from a finished round for one player (strokes, birdies, fairways, greens, putts, longest drive).
export function roundFacts(round, playerIdx = 0) {
  const course = courseById(round.courseId);
  const scores = round.scores[playerIdx] || [], logs = round.logs[playerIdx] || [];
  const f = { strokes: 0, par: 0, toPar: 0, holes: 0, birdies: 0, eagles: 0, doubles: 0, fairways: 0, fairwayChances: 0, gir: 0, putts: 0, longestDrive: 0 };
  scores.forEach((s, i) => {
    if (!Number.isFinite(s)) return;
    const par = course.pars[round.holes[i]], l = logs[i] || {};
    f.holes++; f.strokes += s; f.par += par;
    if (s - par <= -2) f.eagles++; else if (s - par === -1) f.birdies++; else if (s - par >= 2) f.doubles++;
    if (l.fairwayHit !== null && l.fairwayHit !== undefined) { f.fairwayChances++; if (l.fairwayHit) f.fairways++; }
    if (l.gir) f.gir++;
    f.putts += l.putts || 0;
    f.longestDrive = Math.max(f.longestDrive, l.driveDistance || 0);
  });
  f.toPar = f.strokes - f.par;
  return f;
}

const MEDAL_RANK = { none: 0, bronze: 1, silver: 2, gold: 3 };
export function objectiveMet(o, ctx) {
  const f = ctx.facts;
  switch (o.kind) {
    case 'finish': return ctx.position != null && ctx.position <= o.target;
    case 'toPar': return f.toPar <= o.target;
    case 'birdies': return f.birdies + f.eagles >= o.target;
    case 'fairways': return f.fairways >= o.target;
    case 'gir': return f.gir >= o.target;
    case 'putts': return f.holes > 0 && f.putts <= o.target;
    case 'noDouble': return f.holes > 0 && f.doubles === 0;
    case 'longDrive': return f.longestDrive / 0.9144 >= o.target;
    case 'beatBoss': return ctx.bossTotal != null && f.strokes < ctx.bossTotal;
    case 'matchWin': return ctx.match === 'win';
    case 'rangeMedal': {
      const want = o.text.includes('gold') ? 3 : o.text.includes('silver') ? 2 : 1;
      return MEDAL_RANK[(ctx.rangeMedals || {})[o.target] || 'none'] >= want;
    }
    default: return false;
  }
}

// XP for an event, line by line.
export function eventXp(ev, ctx, firstClear) {
  const f = ctx.facts;
  const lines = [];
  lines.push(['Holes played', f.holes * 8]);
  const under = Math.max(0, Math.round(f.holes * 0.5) - f.toPar);
  if (under) lines.push(['Scoring', under * 9]);
  if (f.birdies) lines.push([`Birdies (${f.birdies})`, f.birdies * 14]);
  if (f.eagles) lines.push([`Eagles (${f.eagles})`, f.eagles * 45]);
  const met = ev.objectives.filter((o) => objectiveMet(o, ctx));
  if (met.length) lines.push([`Objectives (${met.length} of ${ev.objectives.length})`, met.reduce((a, o) => a + (o.main ? 60 : 30), 0)]);
  if (ctx.position != null && ev.mode !== 'match') { const n = ev.field; const pl = Math.round(Math.max(0, (n - ctx.position) / Math.max(1, n - 1)) * 50 * (1 + ev.chapter * 0.4)); if (pl) lines.push([`Finish (${ctx.position} of ${n})`, pl]); }
  if (ev.mode === 'match' && ctx.match === 'win') lines.push(['Match won', 80 + ev.chapter * 10]);
  if (firstClear) lines.push(['First clear', 50 + ev.chapter * 25]);
  const base = lines.reduce((a, l) => a + l[1], 0);
  // Practice pays: a silver or better in any range drill adds 10 percent.
  if (Object.values(ctx.rangeMedals || {}).some((m) => MEDAL_RANK[m] >= 2)) lines.push(['Practice bonus (range silver)', Math.round(base * 0.1)]);
  return { lines, total: lines.reduce((a, l) => a + l[1], 0) };
}

/**
 * Record a finished campaign event. input: { facts (roundFacts), rivalScores: {id: [scores]},
 * match: 'win' | 'loss' | 'halved' | null, rangeMedals, date }.
 * Returns { campaign, result } with the board, position, objectives, stars, XP lines, and
 * rewards (tokens on a first clear; the chapter's club when its last event is first cleared).
 */
export function completeCampaignEvent(c, eventId, input) {
  const ev = eventById(eventId);
  if (!ev) return { campaign: c, result: null };
  const course = courseById(ev.courseId);
  const holes = holesOf(ev);
  const par = holes.reduce((a, hh) => a + course.pars[hh], 0);
  const field = fieldFor(c, ev);
  const board = [{ id: 'me', name: input.name || 'You', total: input.facts.strokes }];
  const seed = (c.seed + hashString(ev.id) + ((c.progress[ev.id] && c.progress[ev.id].plays) || 0) * 7919) >>> 0;
  for (const r of field) {
    const sc = (input.rivalScores && input.rivalScores[r.id]) || simulateRivalRound(r, { courseId: ev.courseId, holes, seed });
    board.push({ id: r.id, name: r.name, total: sc.reduce((a, b) => a + b, 0), boss: !!r.boss });
  }
  board.sort((a, b) => a.total - b.total || (a.id === 'me' ? -1 : b.id === 'me' ? 1 : 0));
  let pos = 0;
  board.forEach((e, i) => { if (i === 0 || e.total !== board[i - 1].total) pos = i + 1; e.position = pos; e.toPar = e.total - par; });
  const me = board.find((e) => e.id === 'me');
  const boss = board.find((e) => e.boss);
  const ctx = { facts: input.facts, position: ev.mode === 'match' ? null : me.position, bossTotal: boss ? boss.total : null, match: input.match || null, rangeMedals: input.rangeMedals || {} };
  const objectives = ev.objectives.map((o) => ({ ...o, met: objectiveMet(o, ctx) }));
  const cleared = objectives.some((o) => o.main && o.met);
  const prev = c.progress[ev.id] || { stars: 0, cleared: false, plays: 0, best: null, met: [] };
  const firstClear = cleared && !prev.cleared;
  const met = [...new Set([...prev.met, ...objectives.filter((o) => o.met).map((o) => o.id)])];
  const stars = Math.min(3, met.length);
  const xp = eventXp(ev, ctx, firstClear);
  const tokens = firstClear ? (ev.bossEvent ? 2 : 1) : 0;
  const ch = CHAPTERS[ev.chapter];
  const chapterReward = firstClear && ev.index === ch.events.length - 1 ? ch.reward : null;
  const progress = { ...c.progress, [ev.id]: { stars, cleared: prev.cleared || cleared, plays: prev.plays + 1, best: prev.best == null ? me.toPar : Math.min(prev.best, me.toPar), met } };
  return {
    campaign: { ...c, progress },
    result: { event: ev, board, position: me.position, par, objectives, stars, newStars: stars - prev.stars, cleared, firstClear, xp, tokens, chapterReward, boss: boss || null },
  };
}

// Save migration helper: a career save carries its experience into the golfer.
export function golferFromCareer(career, existing) {
  const xp = Math.max((existing && existing.xp) || 0, (career && career.xp) || 0);
  return { ...newGolfer(existing && existing.archetype, xp), nodes: (existing && existing.nodes) || [], respecs: (existing && existing.respecs) || 0 };
}
