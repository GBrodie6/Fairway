import { describe, it, expect } from 'vitest';
import { createRng } from '../src/core/rng.js';
import {
  TIERS, TIER_INFO, starterGear, sanitizeGear, normalizeBag, bagErrors, equipClub, equipItem, gearFor,
  openDrop, DROP_ODDS, PITY_AT, PITY_ODDS, ITEM_ODDS, SHARDS_FOR_DUPLICATE, UPGRADE_COST, upgradeClub, grantClub,
  clubStats, BALLS, GLOVES, BAG_LIMIT, dropsUntilPity, tierIndex,
} from '../src/game/gear.js';
import { RARITY, CARRY_CAP, strikeModifiers } from '../src/game/strike.js';

describe('gear: tiers and caps', () => {
  it('has five tiers with original model names and no maker marks', () => {
    expect(TIERS).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary']);
    const names = TIERS.map((t) => TIER_INFO[t].model);
    expect(names).toEqual(['Meadow', 'Harrow', 'Kingfisher', 'Ember', 'Solstice']);
  });
  it('the strike table matches the brief and no tier adds carry', () => {
    const want = { common: [1, 1], uncommon: [1.25, 0.92], rare: [1.5, 0.84], epic: [1.8, 0.76], legendary: [2.2, 0.68] };
    for (const t of TIERS) {
      expect(RARITY[t].difficulty).toBeCloseTo(want[t][0], 6);
      expect(RARITY[t].sweet).toBeCloseTo(want[t][1], 6);
      const m = strikeModifiers({ kind: 'pured', severity: 0 }, { rarity: t });
      expect(m.speed).toBe(1); expect(CARRY_CAP).toBe(0);
    }
  });
  it('every tier above Common trades forgiveness for control (no strict upgrade)', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const a = clubStats(TIERS[i - 1]), b = clubStats(TIERS[i]);
      expect(b.control).toBeGreaterThan(a.control);
      expect(b.forgiveness).toBeLessThan(a.forgiveness);
      expect(b.difficulty).toBeGreaterThan(a.difficulty);
    }
  });
  it('balls trade spin for speed and gloves stay small', () => {
    expect(BALLS.common).toEqual(expect.objectContaining({ spin: 1, speed: 1 }));
    for (const t of TIERS) { expect(BALLS[t].speed).toBeLessThanOrEqual(1); expect(BALLS[t].spin).toBeGreaterThanOrEqual(1); expect(GLOVES[t]).toBeLessThanOrEqual(0.08); }
  });
});

describe('gear: odds, pity and duplicates', () => {
  it('printed odds sum to 100', () => {
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(DROP_ODDS)).toBe(100); expect(sum(PITY_ODDS)).toBe(100); expect(sum(ITEM_ODDS)).toBe(100);
  });
  it('20000 drops land near the printed odds (pity included)', () => {
    const rng = createRng(1234);
    let g = starterGear();
    const n = 20000, count = Object.fromEntries(TIERS.map((t) => [t, 0]));
    for (let i = 0; i < n; i++) { const r = openDrop(g, rng); g = { ...r.gear, clubs: starterGear().clubs, balls: starterGear().balls, gloves: starterGear().gloves }; count[r.drop.rarity]++; }
    // Without pity: 50/28/14/6/2. Pity lifts Epic and Legendary slightly; the rest stay within 1.5 points.
    expect(count.common / n * 100).toBeGreaterThan(47); expect(count.common / n * 100).toBeLessThan(51.5);
    expect(count.uncommon / n * 100).toBeGreaterThan(26); expect(count.uncommon / n * 100).toBeLessThan(29.5);
    expect(count.rare / n * 100).toBeGreaterThan(12.5); expect(count.rare / n * 100).toBeLessThan(15.5);
    expect(count.epic / n * 100).toBeGreaterThan(5.5); expect(count.epic / n * 100).toBeLessThan(9);
    expect(count.legendary / n * 100).toBeGreaterThan(1.5); expect(count.legendary / n * 100).toBeLessThan(4);
  });
  it('pity: never more than 20 drops in a row without Epic or better', () => {
    const rng = createRng(99);
    let g = starterGear(), run = 0, worst = 0;
    for (let i = 0; i < 5000; i++) {
      const r = openDrop(g, rng); g = r.gear;
      if (tierIndex(r.drop.rarity) >= tierIndex('epic')) run = 0; else run++;
      worst = Math.max(worst, run);
      expect(r.drop.pity).toBe(run);
      expect(dropsUntilPity(g)).toBe(PITY_AT - run);
    }
    expect(worst).toBeLessThanOrEqual(PITY_AT - 1);
  });
  it('the 20th drop is guaranteed Epic or better', () => {
    const rng = { next: () => 0.01 }; // would always roll Common
    let g = starterGear();
    for (let i = 0; i < PITY_AT - 1; i++) { const r = openDrop(g, rng); expect(r.drop.rarity).toBe('common'); g = r.gear; }
    const last = openDrop(g, rng);
    expect(last.drop.pityGuaranteed).toBe(true);
    expect(['epic', 'legendary']).toContain(last.drop.rarity);
    expect(last.gear.pity).toBe(0);
  });
  it('a duplicate turns into shards and adds nothing', () => {
    const rng = { next: () => 0.01 }; // common club, first club id (DR), which the starter bag owns
    const g = starterGear();
    const r = openDrop(g, rng);
    expect(r.drop).toEqual(expect.objectContaining({ kind: 'club', rarity: 'common', clubId: 'DR', duplicate: true, shards: SHARDS_FOR_DUPLICATE.common }));
    expect(r.gear.clubs.length).toBe(g.clubs.length);
    const gc = grantClub(g, 'I7', 'common');
    expect(gc.shards).toBe(5); expect(gc.gear).toBe(g);
    const gr = grantClub(g, 'I7', 'rare');
    expect(gr.shards).toBe(0); expect(gr.gear.clubs.length).toBe(15);
  });
  it('drops are deterministic for a seed', () => {
    const a = [], b = [];
    let ga = starterGear(), gb = starterGear();
    const ra = createRng(7), rb = createRng(7);
    for (let i = 0; i < 50; i++) { const x = openDrop(ga, ra); ga = x.gear; a.push(x.drop); const y = openDrop(gb, rb); gb = y.gear; b.push(y.drop); }
    expect(a).toEqual(b);
  });
});

describe('gear: bag and loadout', () => {
  it('starter bag is the fixed 14 commons and legal', () => {
    const g = starterGear();
    expect(g.bag.length).toBe(BAG_LIMIT);
    expect(bagErrors(g, g.bag)).toEqual([]);
    expect(g.clubs.every((c) => c.rarity === 'common')).toBe(true);
    expect(gearFor(g, 'DR')).toEqual(expect.objectContaining({ rarity: 'common', glove: 0 }));
  });
  it('equipping swaps the same club type, keeps 14 and the order', () => {
    let g = grantClub(starterGear(), 'I7', 'epic').gear;
    const epic = g.clubs.find((c) => c.rarity === 'epic');
    g = equipClub(g, epic.uid);
    expect(g.bag.length).toBe(14);
    expect(g.bag.filter((u) => g.clubs.find((c) => c.uid === u).clubId === 'I7')).toEqual([epic.uid]);
    expect(gearFor(g, 'I7').rarity).toBe('epic');
    expect(gearFor(g, 'I6').rarity).toBe('common');
    const order = g.bag.map((u) => g.clubs.find((c) => c.uid === u).clubId);
    expect(order.indexOf('I7')).toBe(order.indexOf('I6') + 1);
  });
  it('the bag rejects duplicates, unowned clubs, more than 14, and no putter', () => {
    const g = starterGear();
    expect(bagErrors(g, [...g.bag, g.bag[0]]).length).toBeGreaterThan(0);
    expect(bagErrors(g, g.bag.filter((u) => !u.startsWith('PT')))).toContain('The bag needs a putter.');
    expect(bagErrors(g, ['nope'])).toContain('A club in the bag is not owned.');
    const fixed = normalizeBag(g, [g.bag[0], g.bag[0], 'nope']);
    expect(bagErrors(g, fixed)).toEqual([]);
    expect(fixed.length).toBe(2);
  });
  it('balls and gloves equip only when owned', () => {
    const g = starterGear();
    expect(equipItem(g, 'ball', 'nope')).toBe(g);
    const g2 = { ...g, gloves: [...g.gloves, { uid: 'glove-rare-2', rarity: 'rare' }] };
    expect(gearFor(equipItem(g2, 'glove', 'glove-rare-2'), 'DR').glove).toBe(GLOVES.rare);
  });
  it('sanitize repairs junk and keeps every club type owned', () => {
    for (const junk of [null, 5, {}, { clubs: 'x', bag: [1, 2] }, { clubs: [{ uid: 'a', clubId: 'ZZ', rarity: 'common' }], pity: -4 }]) {
      const g = sanitizeGear(junk);
      expect(g.bag.length).toBe(14);
      expect(bagErrors(g, g.bag)).toEqual([]);
      expect(g.pity).toBeGreaterThanOrEqual(0);
    }
  });
  it('upgrades cost shards, move up one tier, and stop at Legendary', () => {
    const g = starterGear();
    const dr = g.clubs.find((c) => c.clubId === 'DR');
    expect(upgradeClub(g, dr.uid, 10).error).toMatch(/40/);
    const up = upgradeClub(g, dr.uid, UPGRADE_COST.common);
    expect(up.cost).toBe(40);
    expect(gearFor(up.gear, 'DR').rarity).toBe('uncommon');
    let leg = grantClub(g, 'DR', 'legendary').gear;
    const l = leg.clubs.find((c) => c.rarity === 'legendary');
    expect(upgradeClub(leg, l.uid, 99999).error).toMatch(/Legendary/);
  });
});

import { applyStrike } from '../src/game/strike.js';
import { migrateSave, defaultSave, SAVE_VERSION } from '../src/game/save.js';
describe('gear: ball effect and save migration', () => {
  const launch = { speed: 70, vAngle: 0.2, spin: 300, heading: 0, axisTilt: 0 };
  it('the Common ball and glove change nothing', () => {
    const a = applyStrike(launch, { kind: 'pured', severity: 0 }, { rarity: 'common' });
    const b = applyStrike(launch, { kind: 'pured', severity: 0 }, { rarity: 'common', ball: BALLS.common, glove: GLOVES.common });
    expect(b).toEqual(a);
  });
  it('better balls add spin and cost a little speed, bounded', () => {
    let prev = applyStrike(launch, { kind: 'good', severity: 0 }, { ball: BALLS.common });
    for (const t of TIERS.slice(1)) {
      const o = applyStrike(launch, { kind: 'good', severity: 0 }, { ball: BALLS[t] });
      expect(o.spin).toBeGreaterThan(prev.spin); expect(o.speed).toBeLessThan(prev.speed);
      expect(o.speed).toBeGreaterThanOrEqual(launch.speed * 0.98); expect(o.spin).toBeLessThanOrEqual(launch.spin * 1.15);
      prev = o;
    }
    const wild = applyStrike(launch, { kind: 'good', severity: 0 }, { ball: { spin: 9, speed: 0.1 } });
    expect(wild.speed).toBeCloseTo(launch.speed * 0.98, 6); expect(wild.spin).toBeCloseTo(launch.spin * 1.15, 6);
    const putt = applyStrike({ ...launch, putt: true }, { kind: 'good', severity: 0 }, { ball: BALLS.legendary });
    expect(putt.speed).toBe(launch.speed);
  });
  it('a version 4 save migrates to 5 with the starter bag and keeps its wallet', () => {
    const v4 = { ...defaultSave(), version: 4, wallet: { coins: 3, shards: 12, mulligans: 1 } };
    delete v4.gear;
    const s = migrateSave(v4);
    expect(s.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(5);
    expect(s.gear.bag.length).toBe(14);
    expect(s.wallet).toEqual(expect.objectContaining({ shards: 12, tokens: 0 }));
    expect(gearFor(s.gear, 'DR').rarity).toBe('common');
  });
});

describe('gear: merged saves', () => {
  it('two copies of the same club and tier (from two devices) collapse to one, keeping the bagged copy', () => {
    let g = grantClub(starterGear(), 'I7', 'rare').gear;
    const mine = g.clubs.find((c) => c.rarity === 'rare');
    g = equipClub(g, mine.uid);
    const merged = { ...g, clubs: [{ uid: 'I7-rare-other', clubId: 'I7', rarity: 'rare' }, ...g.clubs], balls: [...g.balls, { uid: 'ball-common-9', rarity: 'common' }] };
    const s = sanitizeGear(merged);
    expect(s.clubs.filter((c) => c.clubId === 'I7' && c.rarity === 'rare').map((c) => c.uid)).toEqual([mine.uid]);
    expect(s.balls.length).toBe(1);
    expect(gearFor(s, 'I7').rarity).toBe('rare');
  });
});
