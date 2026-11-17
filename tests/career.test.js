import { describe, it, expect } from 'vitest';
import {
  createCareer, profileFor, spendPoint, equip, levelForXp, xpForLevel, addXp, xpForRound, makeRivals, simulateRivalRound,
  completeEvent, nextEvent, buildSeason, validateCareer, rankingPoints, TIERS, ATTRIBUTES, EQUIPMENT, UNLOCK_LEVEL, POINTS_PER_LEVEL,
} from '../src/game/career.js';
import { defaultSave, migrateSave, sanitizeSave, recordRound, recordDaily, loadSave, writeSave, SAVE_VERSION, SAVE_KEY, statsSummary, dayKey, ACHIEVEMENTS } from '../src/game/save.js';
import { createRound, beginHole, applyShot, completeHole } from '../src/game/round.js';
import { BASE_PROFILE, nominalCarry } from '../src/physics/shot.js';
import { CLUBS } from '../src/physics/clubs.js';
import { courseById } from '../src/course/courses.js';
import { getHole } from '../src/course/layout.js';
import { buildTerrain } from '../src/course/terrain.js';
import { playHoleAI } from '../src/game/planner.js';
import { createRng } from '../src/core/rng.js';
import { SURFACES } from '../src/physics/surfaces.js';

describe('career progression (pure)', () => {
  it('a new golfer has exactly the base profile, so the carry ladder is unchanged', () => {
    const c = createCareer({ name: 'Test', seed: 7 });
    expect(profileFor(c)).toEqual({ ...BASE_PROFILE });
    for (const club of CLUBS.filter((k) => !k.putter)) expect(nominalCarry(club, profileFor(c))).toBeCloseTo(nominalCarry(club, BASE_PROFILE), 6);
  });
  it('profiles stay bounded for any build, and attributes move them the right way', () => {
    const c = createCareer({ seed: 1 });
    const maxed = { ...c, attributes: Object.fromEntries(ATTRIBUTES.map((k) => [k, 999])), equipment: { driver: 'distance', irons: 'blade', putter: 'mallet', ball: 'distance' } };
    const low = { ...c, attributes: Object.fromEntries(ATTRIBUTES.map((k) => [k, -50])) };
    for (const p of [profileFor(maxed), profileFor(low)]) {
      for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
      expect(p.power).toBeGreaterThanOrEqual(0.95); expect(p.power).toBeLessThanOrEqual(1.08);
      expect(p.accuracy).toBeGreaterThanOrEqual(0.45); expect(p.accuracy).toBeLessThanOrEqual(1.3);
    }
    expect(profileFor(maxed).power).toBeGreaterThan(1);
    expect(profileFor(low).accuracy).toBeGreaterThan(1);
  });
  it('equipment trades one thing for another', () => {
    const c = { ...createCareer({ seed: 2 }), level: 10 };
    const longD = profileFor(equip(c, 'driver', 'distance')), ctl = profileFor(equip(c, 'driver', 'control'));
    expect(longD.power).toBeGreaterThan(1); expect(longD.accuracy).toBeGreaterThan(1);
    expect(ctl.power).toBeLessThan(1); expect(ctl.accuracy).toBeLessThan(1);
    for (const slot of Object.keys(EQUIPMENT)) for (const item of EQUIPMENT[slot]) {
      const fx = Object.values(item.fx);
      if (!fx.length) continue;
      // Every non-standard item has at least one gain and one cost (lower accuracy/putting/forgiveness multipliers are gains).
      const p = profileFor(equip(c, slot, item.id));
      const gains = (p.power > 1) + (p.spin > 1) + (p.accuracy < 1) + (p.putting < 1) + (p.forgiveness < 1);
      const costs = (p.power < 1) + (p.spin < 1) + (p.accuracy > 1) + (p.putting > 1) + (p.forgiveness > 1) + (p.touch > 1);
      expect(gains).toBeGreaterThan(0); expect(costs).toBeGreaterThan(0);
    }
  });
  it('locked equipment cannot be equipped, and points spend only when available', () => {
    const c = createCareer({ seed: 3 });
    expect(equip(c, 'irons', 'blade')).toBe(c);
    expect(equip({ ...c, level: UNLOCK_LEVEL.blade }, 'irons', 'blade').equipment.irons).toBe('blade');
    expect(spendPoint(c, 'power')).toBe(c);
    const d = spendPoint({ ...c, points: 1 }, 'power');
    expect(d.points).toBe(0); expect(d.attributes.power).toBe(52);
    expect(spendPoint({ ...c, points: 1 }, 'nonsense').points).toBe(1);
  });
  it('experience levels are monotonic and grant points', () => {
    for (let l = 1; l < 30; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    for (let l = 1; l < 30; l++) expect(levelForXp(xpForLevel(l))).toBe(l);
    const c = addXp(createCareer({ seed: 4 }), xpForLevel(4));
    expect(c.level).toBe(4); expect(c.points).toBe(3 * POINTS_PER_LEVEL);
    expect(xpForRound({ toPar: -3, holes: 18, birdies: 4 })).toBeGreaterThan(xpForRound({ toPar: 6, holes: 18 }));
    expect(xpForRound({ toPar: 40, holes: 9 })).toBeGreaterThan(0);
  });
  it('rivals are deterministic, distinct, and spread in skill', () => {
    const a = makeRivals(99), b = makeRivals(99);
    expect(a).toEqual(b);
    expect(new Set(a.map((r) => r.name)).size).toBe(a.length);
    expect(a[0].skill).toBeGreaterThan(a[a.length - 1].skill + 0.2);
  });
  it('a season has tiers of events on real courses', () => {
    const s = buildSeason(5, 0);
    for (const t of TIERS) expect(s.events.filter((e) => e.tier === t.tier).length).toBe(3);
    for (const e of s.events) { expect(courseById(e.courseId).id).toBe(e.courseId); expect([9, 18]).toContain(e.holes); }
  });
  it('completing events ranks the field, awards XP, and qualifies the player up a tier', () => {
    let c = createCareer({ name: 'Me', seed: 11 });
    expect(validateCareer(c)).toBe(true);
    for (let i = 0; i < 3; i++) {
      const ev = nextEvent(c);
      expect(ev.tier).toBe(1);
      const course = courseById(ev.courseId);
      const holes = Array.from({ length: ev.holes }, (_, k) => ev.startHole - 1 + k);
      const scores = holes.map((h) => course.pars[h] - 1); // a birdie on every hole wins
      const r = completeEvent(c, ev.id, { playerScores: scores, date: i });
      expect(r.result.position).toBe(1);
      expect(r.result.board.length).toBe(ev.field);
      expect(r.career.xp).toBeGreaterThan(c.xp);
      c = r.career;
      expect(validateCareer(c)).toBe(true);
    }
    expect(c.season.tier).toBe(2);
    expect(c.titles).toBe(3);
    // Re-completing an event is refused.
    const first = c.season.events[0];
    expect(completeEvent(c, first.id, { playerScores: [1] }).result).toBe(null);
  });
  it('a poor tier repeats in a new season rather than advancing', () => {
    let c = createCareer({ seed: 12 });
    for (let i = 0; i < 3; i++) {
      const ev = nextEvent(c);
      const course = courseById(ev.courseId);
      const holes = Array.from({ length: ev.holes }, (_, k) => ev.startHole - 1 + k);
      c = completeEvent(c, ev.id, { playerScores: holes.map((h) => course.pars[h] + 3) }).career;
    }
    expect(c.season.tier).toBe(1);
    expect(c.season.index).toBe(1);
    expect(nextEvent(c)).not.toBe(null);
  });
  it('ranking points favor better finishes', () => {
    expect(rankingPoints(1, 10, 1)).toBeGreaterThan(rankingPoints(2, 10, 1));
    expect(rankingPoints(1, 10, 3)).toBeGreaterThan(rankingPoints(1, 10, 1));
    expect(rankingPoints(NaN, 10, 1)).toBe(0);
  });
  it('the rival score model sits close to the planner AI on real holes', () => {
    // The AI plays parkland holes 1 to 6 for two skills; the model is compared on the same holes.
    const course = courseById('parkland');
    const holes = [0, 1, 2, 3, 4, 5];
    const res = [];
    for (const skill of [0.3, 0.5, 0.8]) {
      let ai = 0, n = 0;
      for (const h of holes) {
        const t = buildTerrain(course, getHole(course, h));
        for (let k = 0; k < 3; k++) {
          const r = playHoleAI(t, { skill, rng: createRng(h * 31 + k * 7 + 1) });
          ai += r.strokes - course.pars[h]; n++;
        }
      }
      let model = 0, m = 0;
      for (let s = 0; s < 40; s++) { const sc = simulateRivalRound({ id: 'x', skill, form: 0 }, { courseId: 'parkland', holes, seed: s }); sc.forEach((v, i) => { model += v - course.pars[holes[i]]; m++; }); }
      res.push([skill, ai / n, model / m]);
    }
    console.log('rival model', JSON.stringify(res));
    for (const [, a, b] of res) expect(Math.abs(a - b)).toBeLessThan(0.35);
  });
});

describe('saves', () => {
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
  it('round-trips through storage', () => {
    const s = store();
    const save = { ...defaultSave(), player: { name: 'Ana', handed: 'left', ball: '#ffd23f' }, career: createCareer({ name: 'Ana', seed: 3 }) };
    expect(writeSave(save, s)).toBe(true);
    const back = loadSave(s);
    expect(back.player.name).toBe('Ana');
    expect(back.career.name).toBe('Ana');
    expect(back.version).toBe(SAVE_VERSION);
  });
  it('migrates a version 1 save forward and keeps its rounds', () => {
    const v1 = { version: 1, name: 'Old', rounds: [{ id: 'a', date: 5, courseId: 'links', strokes: 80, par: 72, holes: 18 }, { bad: true }] };
    const s = migrateSave(v1);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.player.name).toBe('Old');
    expect(s.history.length).toBe(1);
    expect(s.history[0].toPar).toBe(8);
    expect(s.career).toBe(null);
    expect(s.stats.rounds).toBe(0);
  });
  it('recovers from corrupt, future, and tampered data', () => {
    const s = store();
    s.setItem(SAVE_KEY, '{not json');
    expect(loadSave(s).version).toBe(SAVE_VERSION);
    expect(migrateSave({ version: 99 }).history).toEqual([]);
    expect(migrateSave(null).version).toBe(SAVE_VERSION);
    const t = sanitizeSave({ ...defaultSave(), player: { name: 'x'.repeat(80) }, stats: { rounds: 'lots', best: 4 }, career: { v: 1, xp: 'NaN' }, history: [{ strokes: 'x' }, { strokes: 70 }] });
    expect(t.player.name.length).toBe(18);
    expect(t.stats.rounds).toBe(0);
    expect(t.stats.best).toEqual({});
    expect(t.career).toBe(null);
    expect(t.history.length).toBe(1);
  });
  it('records a round into stats, history, and achievements', () => {
    const r = createRound({ courseId: 'parkland', holeCount: 1, seed: 9 });
    beginHole(r, { x: 0, z: 0 });
    // Driver to the fairway, then holed: a birdie-two on a par 4 (hole 1 is a par 4).
    applyShot(r, 0, { from: { x: 0, z: 0, lie: SURFACES.TEE }, end: { x: 0, z: -290 }, lie: SURFACES.FAIRWAY, total: 290, carry: 270, distToPin: 80 });
    applyShot(r, 0, { from: { x: 0, z: -290, lie: SURFACES.FAIRWAY }, end: { x: 0, z: -370 }, holed: true, lie: SURFACES.GREEN, total: 80, carry: 75, distToPin: 0 });
    completeHole(r);
    const out = recordRound(defaultSave(), r, { now: 1000 });
    expect(out.save.stats.rounds).toBe(1);
    expect(out.save.stats.eagles).toBe(1);
    expect(out.save.history[0].toPar).toBe(-2);
    expect(out.unlocked).toEqual(expect.arrayContaining(['first-round', 'birdie', 'eagle', 'under-par']));
    // A second identical round unlocks nothing new.
    expect(recordRound(out.save, r, { now: 2000 }).unlocked).toEqual([]);
    const sum = statsSummary(out.save.stats);
    expect(sum.rounds).toBe(1);
    expect(sum.fairwayPct).toBe(100);
    for (const a of out.unlocked) expect(ACHIEVEMENTS.some((x) => x.id === a)).toBe(true);
  });
  it('keeps the best daily score and counts attempts', () => {
    let s = defaultSave();
    s = recordDaily(s, '2026-11-17', { strokes: 5, toPar: 1 });
    s = recordDaily(s, '2026-11-17', { strokes: 3, toPar: -1 });
    s = recordDaily(s, '2026-11-17', { strokes: 6, toPar: 2 });
    expect(s.daily['2026-11-17']).toEqual({ strokes: 3, toPar: -1, attempts: 3 });
    s = recordDaily(recordDaily(s, '2026-11-18', { strokes: 4, toPar: 0 }), '2026-11-19', { strokes: 4, toPar: 0 });
    expect(s.achievements['daily-3']).toBeTruthy();
    expect(dayKey(Date.UTC(2026, 10, 17, 23, 59))).toBe('2026-11-17');
  });
});
