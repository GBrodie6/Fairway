// The pro golfers (data/pros.json): invented players with an archetype, five stats on the
// campaign scale, a signature shot, club preferences and a bio. They can be played in Quick
// Play, Daily and Tournament, they are computer opponents and rivals, and in Campaign one can be
// picked as a mentor, which unlocks the pro's signature shot. Every modifier goes through the
// campaign golfer's own mapping and caps (game/campaign.js profileFromStats, golferPerks), so a
// pro can never exceed what a campaign golfer can reach. No human figures: an emblem and a color.
import data from '../data/pros.json' with { type: 'json' };
import { profileFromStats, golferPerks, golferStrike, ARCHETYPES, STATS, STAT_MAX, xpToReach } from './campaign.js';
import { shotData } from '../data/shotTypes.js';
import { clamp } from '../core/math.js';

export const PRO_LEVEL = 30; // the matched level: innate perks grow as for a level 30 golfer
export const PRO_STAT_TOTAL = data.statTotal;
const HEX = /^#[0-9a-fA-F]{6}$/;
const CLUB_IDS = ['DR', 'W3', 'W5', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'PW', 'GW', 'SW', 'LW'];

function clean(p) {
  const a = ARCHETYPES[p.archetype] ? p.archetype : 'all';
  const caps = ARCHETYPES[a].caps || {};
  const stats = Object.fromEntries(STATS.map((k) => [k, clamp(Math.round(Number(p.stats && p.stats[k]) || 50), 30, Math.min(STAT_MAX, caps[k] ?? STAT_MAX))]));
  const sig = shotData(p.signature).id === p.signature ? p.signature : 'high';
  const clubs = { tee: CLUB_IDS.includes(p.clubs && p.clubs.tee) ? p.clubs.tee : 'DR', wedge: ['GW', 'SW', 'LW'].includes(p.clubs && p.clubs.wedge) ? p.clubs.wedge : 'SW', favorite: CLUB_IDS.includes(p.clubs && p.clubs.favorite) ? p.clubs.favorite : 'I7' };
  return Object.freeze({ id: String(p.id), name: String(p.name).slice(0, 24), archetype: a, color: HEX.test(p.color) ? p.color : '#e8e8e8', emblem: String(p.emblem || 'star'), signature: sig, skill: clamp(Number(p.skill) || 0.8, 0.5, 0.9), stats: Object.freeze(stats), clubs: Object.freeze(clubs), bio: String(p.bio || '') });
}
export const PROS = Object.freeze(data.pros.map(clean));
export const proById = (id) => PROS.find((p) => p.id === id) || null;

// The pro as a campaign golfer at the matched level, with no tree nodes: the archetype's innate
// perks, grown as for that level.
const golferOf = (p) => ({ archetype: p.archetype, nodes: [], xp: xpToReach(PRO_LEVEL) });
export const proPerks = (p) => golferPerks(golferOf(p));
export const proProfile = (p) => profileFromStats(p.stats, proPerks(p));
export const proStrike = (p, clubKind = 'iron') => golferStrike(golferOf(p), clubKind);

// A round player for a pro. kind 'human' plays as the pro; 'ai' is a computer opponent.
export function proPlayer(p, { id = 'p1', kind = 'human', handed = 'right' } = {}) {
  return { id, name: p.name, kind, handed, ball: p.color, pro: p.id, archetype: p.archetype, skill: p.skill, prefs: { ...p.clubs } };
}

// Emblems: plain geometric marks, one per pro (no faces, no figures).
const SHAPES = {
  bolt: 'M54 8 22 54h20l-8 38 36-50H48z',
  peak: 'M10 82 40 26l14 22 10-14 26 48z',
  diamond: 'M50 8 88 50 50 92 12 50z',
  arrow: 'M50 8 84 50H62v42H38V50H16z',
  leaf: 'M50 8C80 28 84 62 50 92 16 62 20 28 50 8zM50 22v62',
  wave: 'M8 58c14-18 28-18 42 0s28 18 42 0v26H8zM8 34c14-18 28-18 42 0s28 18 42 0v10c-14 18-28 18-42 0S22 26 8 44z',
  ring: 'M50 10a40 40 0 1 0 0.1 0zM50 30a20 20 0 1 1-0.1 0z',
  knot: 'M30 20h40l10 30-10 30H30L20 50zM40 38v24h20V38z',
  crest: 'M50 8 86 20v28c0 22-16 38-36 44C30 86 14 70 14 48V20z',
  sun: 'M50 26a24 24 0 1 0 0.1 0zM50 2v14M50 84v14M2 50h14M84 50h14M16 16l10 10M74 74l10 10M84 16 74 26M16 84l10-10',
  star: 'M50 6l12 30 32 2-25 20 9 32-28-18-28 18 9-32L6 38l32-2z',
  shield: 'M50 6 88 18v26c0 26-18 42-38 50C30 86 12 70 12 44V18zM50 22v62M26 44h48',
};
export function emblemSvg(p) {
  const d = SHAPES[p.emblem] || SHAPES.star;
  const stroke = /[MLHVCSQTAZ]/i.test(d) && (p.emblem === 'sun' || p.emblem === 'leaf' || p.emblem === 'shield') ? ` stroke="${p.color}" stroke-width="6" stroke-linecap="round"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#14211b" stroke="${p.color}" stroke-width="4"/><g transform="translate(14 14) scale(0.72)"><path d="${d}" fill="${p.color}" fill-rule="evenodd"${stroke}/></g></svg>`;
}
export const emblemSrc = (p) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(emblemSvg(p))}`;
