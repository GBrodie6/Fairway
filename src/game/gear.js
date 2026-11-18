// Gear: clubs in five rarity tiers, balls, gloves, the 14-club bag, gear drops with printed odds
// and a pity counter, duplicates into shards, and shard upgrades. Pure functions over a plain
// gear object that lives in the save. Nothing here can be bought with money: drops come from
// tokens earned by playing, and every random roll states its odds.
//
// No tier hits further. A higher tier has a smaller sweet spot and mishits cost more
// (game/strike.js); in return the ball-contact dot reaches further, for more draw, fade,
// backspin and topspin (data/spinControl.js). It is a choice, not an upgrade.
import { RARITY } from './strike.js';
import { controlRange } from '../data/spinControl.js';
import { CLUB_SPECS } from '../physics/clubs.js';
import { clamp } from '../core/math.js';

export const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
// Original model names, finishes, and glow per tier (no maker's names or marks).
export const TIER_INFO = {
  common: { name: 'Common', model: 'Meadow', color: '#b9c0c6', head: 0xb9bec3, crown: 0x1d3328, glow: 0x000000, glowStrength: 0, text: 'Satin steel. Forgiving and honest.' },
  uncommon: { name: 'Uncommon', model: 'Harrow', color: '#7fd69a', head: 0xa9c8b2, crown: 0x1f4a33, glow: 0x3d9e5c, glowStrength: 0.12, text: 'Green-tinted steel. A little more shape and spin control, a little less forgiving.' },
  rare: { name: 'Rare', model: 'Kingfisher', color: '#6fb6ff', head: 0x8fb4d8, crown: 0x14304f, glow: 0x2f7fd0, glowStrength: 0.22, text: 'Blue anodized finish. More control of curve and spin, less forgiving.' },
  epic: { name: 'Epic', model: 'Ember', color: '#c08bff', head: 0xb79ad8, crown: 0x30184a, glow: 0x8a4fd8, glowStrength: 0.35, text: 'Violet finish with a soft glow. Wide shot shaping for a clean striker.' },
  legendary: { name: 'Legendary', model: 'Solstice', color: '#ffd166', head: 0xe8c66a, crown: 0x4a3410, glow: 0xffb830, glowStrength: 0.5, text: 'Gold finish. The widest spin and shape control, unforgiving off the middle.' },
};
export const tierIndex = (r) => Math.max(0, TIERS.indexOf(r));

// Stat bars (0 to 100) for the gear screen, from the strike table.
export function clubStats(rarity) {
  const r = RARITY[rarity] || RARITY.common;
  return {
    control: Math.round(controlRange(rarity) * 100), // 50 to 100: how far the spin dot reaches
    forgiveness: Math.round(r.sweet * 100), // 100 to 68
    difficulty: Math.round((r.difficulty / 2.2) * 100), // 45 to 100
  };
}

// Balls: more spin stops faster but flies and rolls a little less. Common is neutral.
export const BALLS = {
  common: { spin: 1.0, speed: 1.0, text: 'Two-piece. Neutral.' },
  uncommon: { spin: 1.03, speed: 0.998, text: 'A little more spin.' },
  rare: { spin: 1.06, speed: 0.995, text: 'More spin, a yard or two shorter.' },
  epic: { spin: 1.09, speed: 0.992, text: 'Stops quickly, a little shorter.' },
  legendary: { spin: 1.12, speed: 0.99, text: 'Checks hard on the greens, shortest off the tee.' },
};
// Gloves: a slightly larger sweet spot (game/strike.js caps it at 8 percent).
export const GLOVES = { common: 0, uncommon: 0.02, rare: 0.04, epic: 0.06, legendary: 0.08 };

export const BAG_LIMIT = 14;
export const STARTER_IDS = CLUB_SPECS.map((c) => c.id); // DR, 3W, 5W, 4i to 9i, PW, GW, SW, LW, PT: 14
export const clubName = (clubId) => (CLUB_SPECS.find((c) => c.id === clubId) || {}).name || clubId;

export function starterGear() {
  const clubs = STARTER_IDS.map((id) => ({ uid: `${id}-common-0`, clubId: id, rarity: 'common' }));
  return {
    clubs, bag: clubs.map((c) => c.uid),
    balls: [{ uid: 'ball-common-0', rarity: 'common' }], gloves: [{ uid: 'glove-common-0', rarity: 'common' }],
    ball: 'ball-common-0', glove: 'glove-common-0',
    pity: 0, opened: 0, seq: 1,
  };
}

// Repair anything malformed (saves come from storage and the cloud).
export function sanitizeGear(g) {
  const d = starterGear();
  if (!g || typeof g !== 'object') return d;
  const ok = (r) => TIERS.includes(r);
  // One of each club per tier (two devices can each find the same club; the merged save keeps
  // one, preferring the copy in the bag).
  const bagIn = new Set(Array.isArray(g.bag) ? g.bag : []);
  const valid = Array.isArray(g.clubs) ? g.clubs.filter((c) => c && typeof c.uid === 'string' && STARTER_IDS.includes(c.clubId) && ok(c.rarity)) : [];
  const clubs = [];
  for (const c of [...valid.filter((x) => bagIn.has(x.uid)), ...valid.filter((x) => !bagIn.has(x.uid))]) {
    if (!clubs.some((x) => x.uid === c.uid || (x.clubId === c.clubId && x.rarity === c.rarity))) clubs.push(c);
  }
  // Every club type is always owned at least as a common, so the bag can always be filled.
  for (const c of d.clubs) if (!clubs.some((x) => x.clubId === c.clubId)) clubs.push(c);
  const items = (list, cur) => {
    const v = Array.isArray(list) ? list.filter((x) => x && typeof x.uid === 'string' && ok(x.rarity)) : [];
    const outL = [];
    for (const x of [...v.filter((y) => y.uid === cur), ...v.filter((y) => y.uid !== cur)]) if (!outL.some((y) => y.uid === x.uid || y.rarity === x.rarity)) outL.push(x);
    return outL;
  };
  const balls = items(g.balls, g.ball); if (!balls.length) balls.push(d.balls[0]);
  const gloves = items(g.gloves, g.glove); if (!gloves.length) gloves.push(d.gloves[0]);
  const out = { clubs, bag: [], balls, gloves, ball: balls.some((b) => b.uid === g.ball) ? g.ball : balls[0].uid, glove: gloves.some((b) => b.uid === g.glove) ? g.glove : gloves[0].uid, pity: clamp(Math.floor(Number(g.pity) || 0), 0, 99), opened: Math.max(0, Math.floor(Number(g.opened) || 0)), seq: Math.max(1, Math.floor(Number(g.seq) || 1)) };
  out.bag = fillBag(out, normalizeBag(out, Array.isArray(g.bag) ? g.bag : d.bag));
  return out;
}

// A legal bag: owned clubs only, one of each type, at most 14, always a putter.
export function normalizeBag(gear, uids) {
  const seen = new Set(), bag = [];
  for (const uid of uids || []) {
    const c = gear.clubs.find((x) => x.uid === uid);
    if (!c || seen.has(c.clubId) || bag.length >= BAG_LIMIT) continue;
    seen.add(c.clubId); bag.push(uid);
  }
  if (!seen.has('PT')) {
    const pt = gear.clubs.find((c) => c.clubId === 'PT');
    if (bag.length >= BAG_LIMIT) bag.pop();
    bag.push(pt.uid); seen.add('PT');
  }
  return bag;
}
// The game has exactly 14 club types and a 14-club limit, so a bag carries one of each: any
// type missing from a repaired bag gets its common version back.
function fillBag(gear, bag) {
  const has = new Set(bag.map((u) => gear.clubs.find((c) => c.uid === u).clubId));
  const out = [...bag];
  for (const id of STARTER_IDS) if (!has.has(id)) out.push(gear.clubs.find((c) => c.clubId === id && c.rarity === 'common') ? gear.clubs.find((c) => c.clubId === id && c.rarity === 'common').uid : gear.clubs.find((c) => c.clubId === id).uid);
  return out.sort((a, b) => STARTER_IDS.indexOf(gear.clubs.find((x) => x.uid === a).clubId) - STARTER_IDS.indexOf(gear.clubs.find((x) => x.uid === b).clubId));
}
export function bagErrors(gear, uids) {
  const errs = [];
  if (uids.length > BAG_LIMIT) errs.push(`At most ${BAG_LIMIT} clubs.`);
  const ids = uids.map((u) => (gear.clubs.find((c) => c.uid === u) || {}).clubId);
  if (ids.some((x) => !x)) errs.push('A club in the bag is not owned.');
  if (new Set(ids).size !== ids.length) errs.push('Only one of each club.');
  if (!ids.includes('PT')) errs.push('The bag needs a putter.');
  return errs;
}

// Put a club in the bag in place of the same type.
export function equipClub(gear, uid) {
  const c = gear.clubs.find((x) => x.uid === uid);
  if (!c) return gear;
  const bag = gear.bag.filter((u) => (gear.clubs.find((x) => x.uid === u) || {}).clubId !== c.clubId);
  bag.push(uid);
  // Keep the bag in the usual order (longest club first).
  bag.sort((a, b) => STARTER_IDS.indexOf(gear.clubs.find((x) => x.uid === a).clubId) - STARTER_IDS.indexOf(gear.clubs.find((x) => x.uid === b).clubId));
  return { ...gear, bag: normalizeBag(gear, bag) };
}
export function equipItem(gear, kind, uid) {
  const list = kind === 'ball' ? gear.balls : gear.gloves;
  if (!list.some((x) => x.uid === uid)) return gear;
  return { ...gear, [kind]: uid };
}

// What the game reads for one club in the bag: its rarity, and the ball and glove effects.
export function gearFor(gear, clubId) {
  const uid = gear.bag.find((u) => (gear.clubs.find((c) => c.uid === u) || {}).clubId === clubId);
  const club = gear.clubs.find((c) => c.uid === uid) || { rarity: 'common' };
  const ball = gear.balls.find((b) => b.uid === gear.ball) || { rarity: 'common' };
  const glove = gear.gloves.find((b) => b.uid === gear.glove) || { rarity: 'common' };
  return { rarity: club.rarity, model: TIER_INFO[club.rarity].model, ball: BALLS[ball.rarity], glove: GLOVES[glove.rarity] };
}

// --- drops ---
// Printed odds (percent). The pity counter guarantees Epic or better on the 20th drop in a
// row without one; that guaranteed drop is Epic 75 percent and Legendary 25 percent.
export const DROP_ODDS = { common: 50, uncommon: 28, rare: 14, epic: 6, legendary: 2 };
export const PITY_AT = 20;
export const PITY_ODDS = { epic: 75, legendary: 25 };
export const ITEM_ODDS = { club: 70, ball: 15, glove: 15 };
export const SHARDS_FOR_DUPLICATE = { common: 5, uncommon: 10, rare: 20, epic: 40, legendary: 80 };
export const UPGRADE_COST = { common: 40, uncommon: 100, rare: 250, epic: 600 }; // to the next tier

function pickWeighted(rng, table) {
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  let x = rng.next() * total;
  for (const [k, w] of Object.entries(table)) { x -= w; if (x < 0) return k; }
  return Object.keys(table)[0];
}

/**
 * Open one gear drop. Returns { gear, drop: { kind, rarity, clubId?, uid?, duplicate, shards, pity } }.
 * The caller spends the token and adds the shards to the wallet.
 */
export function openDrop(gear, rng) {
  const pityHit = gear.pity >= PITY_AT - 1;
  const rarity = pityHit ? pickWeighted(rng, PITY_ODDS) : pickWeighted(rng, DROP_ODDS);
  const kind = pickWeighted(rng, ITEM_ODDS);
  const good = tierIndex(rarity) >= tierIndex('epic');
  const pity = good ? 0 : gear.pity + 1;
  const seq = gear.seq + 1;
  let next = { ...gear, pity, opened: gear.opened + 1, seq };
  let drop;
  if (kind === 'club') {
    const clubId = STARTER_IDS[Math.floor(rng.next() * STARTER_IDS.length) % STARTER_IDS.length];
    const dup = gear.clubs.some((c) => c.clubId === clubId && c.rarity === rarity);
    if (dup) drop = { kind, rarity, clubId, duplicate: true, shards: SHARDS_FOR_DUPLICATE[rarity] };
    else {
      const uid = `${clubId}-${rarity}-${seq}`;
      next = { ...next, clubs: [...gear.clubs, { uid, clubId, rarity }] };
      drop = { kind, rarity, clubId, uid, duplicate: false, shards: 0 };
    }
  } else {
    const key = kind === 'ball' ? 'balls' : 'gloves';
    const dup = gear[key].some((x) => x.rarity === rarity);
    if (dup) drop = { kind, rarity, duplicate: true, shards: SHARDS_FOR_DUPLICATE[rarity] };
    else {
      const uid = `${kind}-${rarity}-${seq}`;
      next = { ...next, [key]: [...gear[key], { uid, rarity }] };
      drop = { kind, rarity, uid, duplicate: false, shards: 0 };
    }
  }
  drop.pity = pity;
  drop.pityGuaranteed = pityHit;
  return { gear: next, drop };
}
export const dropsUntilPity = (gear) => Math.max(1, PITY_AT - gear.pity);

// A fixed reward (campaign chapter, level milestone, drill): a specific club at a rarity.
// A duplicate becomes shards.
export function grantClub(gear, clubId, rarity) {
  if (gear.clubs.some((c) => c.clubId === clubId && c.rarity === rarity)) return { gear, shards: SHARDS_FOR_DUPLICATE[rarity], uid: null };
  const seq = gear.seq + 1, uid = `${clubId}-${rarity}-${seq}`;
  return { gear: { ...gear, seq, clubs: [...gear.clubs, { uid, clubId, rarity }] }, shards: 0, uid };
}

// Spend shards to raise one club a tier. Returns { gear, cost } or { error }.
export function upgradeClub(gear, uid, shards) {
  const c = gear.clubs.find((x) => x.uid === uid);
  if (!c) return { error: 'Not owned.' };
  const cost = UPGRADE_COST[c.rarity];
  if (!cost) return { error: 'Already Legendary.' };
  if (shards < cost) return { error: `Needs ${cost} shards.` };
  const to = TIERS[tierIndex(c.rarity) + 1];
  if (gear.clubs.some((x) => x.clubId === c.clubId && x.rarity === to)) return { error: `You already have a ${TIER_INFO[to].name} ${clubName(c.clubId)}.` };
  const seq = gear.seq + 1, nuid = `${c.clubId}-${to}-${seq}`;
  const clubs = [...gear.clubs, { uid: nuid, clubId: c.clubId, rarity: to }];
  let next = { ...gear, seq, clubs };
  if (gear.bag.includes(uid)) next = equipClub(next, nuid);
  return { gear: next, cost };
}

// Fixed rewards at level milestones (the campaign adds its own per chapter).
export const LEVEL_REWARDS = {
  3: { kind: 'drop', n: 1 }, 5: { kind: 'club', clubId: 'I7', rarity: 'uncommon' }, 8: { kind: 'drop', n: 2 },
  10: { kind: 'club', clubId: 'DR', rarity: 'uncommon' }, 15: { kind: 'club', clubId: 'PW', rarity: 'rare' },
  20: { kind: 'drop', n: 3 }, 25: { kind: 'club', clubId: 'W3', rarity: 'rare' }, 30: { kind: 'club', clubId: 'I5', rarity: 'epic' },
  35: { kind: 'drop', n: 4 }, 40: { kind: 'club', clubId: 'DR', rarity: 'legendary' },
};
