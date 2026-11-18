import { describe, it, expect } from 'vitest';
import {
  STATS, ARCHETYPES, ARCHETYPE_IDS, MAX_LEVEL, xpToReach, levelForXp, xpProgress, evolutionStage, pointsTotal, treeFor, newGolfer,
  sanitizeGolfer, pointsFree, canBuy, buyNode, respec, autoBuild, golferStats, golferPerks, golferProfile, golferStrike, shotUnlocked,
  PERK_LIMITS, STAT_MAX, CHAPTERS, ALL_EVENTS, eventById, holesOf, createCampaign, sanitizeCampaign, chapterUnlocked, eventUnlocked,
  fieldFor, objectiveMet, completeCampaignEvent, nextCampaignEvent, golferFromCareer, BOSSES, chapterStars,
} from '../src/game/campaign.js';
import { BASE_PROFILE, nominalCarry, SHOT_TYPES } from '../src/physics/shot.js';
import { CLUBS } from '../src/physics/clubs.js';
import { courseById } from '../src/course/courses.js';

const facts = (o = {}) => ({ strokes: 20, par: 20, toPar: 0, holes: 6, birdies: 0, eagles: 0, doubles: 0, fairways: 0, fairwayChances: 4, gir: 0, putts: 12, longestDrive: 0, ...o });

describe('levels and points', () => {
  it('levels run 1 to 40 and xp is monotonic', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(1e9)).toBe(MAX_LEVEL);
    for (let l = 2; l <= MAX_LEVEL; l++) { expect(xpToReach(l)).toBeGreaterThan(xpToReach(l - 1)); expect(levelForXp(xpToReach(l))).toBe(l); expect(levelForXp(xpToReach(l) - 1)).toBe(l - 1); }
    expect(xpProgress(xpToReach(5) + 10).level).toBe(5);
    expect(evolutionStage(9)).toBe(0); expect(evolutionStage(10)).toBe(1); expect(evolutionStage(25)).toBe(2);
  });
  it('one skill point per level; the All-Rounder gets two extra', () => {
    expect(pointsTotal(1, 'power')).toBe(0); expect(pointsTotal(40, 'power')).toBe(39);
    expect(pointsTotal(40, 'all')).toBe(41); expect(pointsTotal(4, 'all')).toBe(3); expect(pointsTotal(5, 'all')).toBe(5);
  });
});

describe('archetypes and trees', () => {
  it('six archetypes, each with a 20-node tree of four branches', () => {
    expect(ARCHETYPE_IDS).toEqual(['power', 'sharp', 'short', 'putt', 'links', 'all']);
    for (const a of ARCHETYPE_IDS) {
      const t = treeFor(a);
      expect(t.length).toBe(20);
      expect(new Set(t.map((n) => n.id)).size).toBe(20);
      expect(t.filter((n) => n.kind === 'shot').length).toBeGreaterThanOrEqual(3);
      expect(ARCHETYPES[a].titles.length).toBe(3);
    }
  });
  it('every archetype can unlock punch, high, flop and bump and run', () => {
    for (const a of ARCHETYPE_IDS) {
      const g = autoBuild(a, 40);
      for (const s of ['punch', 'high', 'flop', 'bump']) expect(shotUnlocked(g, s)).toBe(true);
      expect(shotUnlocked(newGolfer(a), 'full')).toBe(true);
    }
    expect(shotUnlocked(newGolfer('links'), 'punch')).toBe(true);
    expect(shotUnlocked(newGolfer('power'), 'punch')).toBe(false);
  });
  it('buying needs points and the node before it; respec refunds everything', () => {
    let g = newGolfer('power', xpToReach(3));
    expect(pointsFree(g)).toBe(2);
    const t = treeFor('power');
    expect(canBuy(g, t[1].id).ok).toBe(false);
    g = buyNode(g, t[0].id);
    expect(g.nodes).toEqual([t[0].id]);
    expect(buyNode(g, t[0].id)).toBe(g);
    expect(canBuy(g, t[1].id).reason).toMatch(/Needs 2/);
    g = respec(g);
    expect(g.nodes).toEqual([]); expect(g.respecs).toBe(1); expect(pointsFree(g)).toBe(2);
  });
  it('sanitize drops illegal or unaffordable nodes', () => {
    const t = treeFor('sharp');
    const g = sanitizeGolfer({ xp: xpToReach(2), archetype: 'sharp', nodes: [t[1].id, t[0].id, 'nope', t[5].id, t[6].id] });
    expect(g.nodes).toEqual([t[0].id]);
    expect(sanitizeGolfer(null).archetype).toBe(null);
    expect(sanitizeGolfer({ archetype: 'wizard', xp: -5 }).xp).toBe(0);
  });
});

describe('bounded effects', () => {
  it('a level 1 golfer of any archetype reproduces the base carry ladder', () => {
    for (const a of ARCHETYPE_IDS) {
      const p = golferProfile(newGolfer(a));
      expect(p.power).toBe(1); expect(p.spin).toBe(1);
      for (const c of CLUBS.filter((x) => !x.putter)) expect(nominalCarry(c, p, SHOT_TYPES.FULL)).toBeCloseTo(nominalCarry(c, BASE_PROFILE, SHOT_TYPES.FULL), 9);
      expect(golferStrike(newGolfer(a)).perkBonus).toBe(0);
    }
  });
  it('stats, perks and the profile stay inside their caps at every level', () => {
    for (const a of ARCHETYPE_IDS) {
      for (const lvl of [1, 5, 10, 15, 25, 30, 40]) {
        const g = autoBuild(a, lvl);
        const st = golferStats(g), pk = golferPerks(g), p = golferProfile(g), s = golferStrike(g, 'wood');
        for (const k of STATS) { expect(st[k]).toBeLessThanOrEqual(Math.min(STAT_MAX, ARCHETYPES[a].caps[k] ?? STAT_MAX)); expect(st[k]).toBeGreaterThanOrEqual(30); }
        for (const [k, v] of Object.entries(pk)) expect(v).toBeLessThanOrEqual(PERK_LIMITS[k] + 1e-12);
        expect(p.power).toBeGreaterThanOrEqual(0.95); expect(p.power).toBeLessThanOrEqual(1.08);
        expect(p.spin).toBeLessThanOrEqual(1.15);
        for (const k of ['accuracy', 'touch', 'putting', 'recovery', 'forgiveness']) { expect(p[k]).toBeGreaterThanOrEqual(0.45); expect(p[k]).toBeLessThanOrEqual(1.3); }
        expect(s.perkBonus).toBeLessThanOrEqual(0.04); expect(s.forgiveness).toBeLessThanOrEqual(1.15);
        for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
  it('weaknesses cap the stat even with every node and both evolutions', () => {
    expect(golferStats(autoBuild('power', 40)).shortGame).toBeLessThanOrEqual(75);
    expect(golferStats(autoBuild('short', 40)).driving).toBeLessThanOrEqual(72);
    expect(golferStats(autoBuild('power', 40)).driving).toBeGreaterThan(golferStats(autoBuild('short', 40)).driving);
  });
  it('evolutions grow the innate perk', () => {
    expect(golferPerks(newGolfer('putt', xpToReach(10))).putting).toBeCloseTo(0.15, 6);
    expect(golferPerks(newGolfer('putt', xpToReach(25))).putting).toBeCloseTo(0.2, 6);
  });
});

describe('chapters and events', () => {
  it('six chapters of 4 to 6 events, each with a boss and three objectives', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual(['club', 'regional', 'tour', 'majors', 'rivalry', 'final']);
    for (const c of CHAPTERS) {
      expect(c.events.length).toBeGreaterThanOrEqual(4); expect(c.events.length).toBeLessThanOrEqual(6);
      expect(BOSSES[c.boss]).toBeTruthy();
      expect(c.events[c.events.length - 1].boss).toBe(c.boss);
      for (const e of c.events) {
        expect(e.objectives.length).toBe(3);
        expect(e.objectives.filter((o) => o.main).length).toBe(1);
        const hs = holesOf(e);
        expect(hs.length).toBe(e.holes);
        for (const hh of hs) expect(courseById(e.courseId).pars[hh]).toBeGreaterThan(2);
      }
    }
    expect(new Set(ALL_EVENTS.map((e) => e.id)).size).toBe(ALL_EVENTS.length);
  });
  it('events unlock in order and chapters after their boss event', () => {
    let c = createCampaign(7);
    expect(eventUnlocked(c, 'club-1')).toBe(true);
    expect(eventUnlocked(c, 'club-2')).toBe(false);
    expect(chapterUnlocked(c, 1)).toBe(false);
    for (const e of CHAPTERS[0].events) {
      const main = e.objectives.find((o) => o.main);
      const ctxFacts = facts({ strokes: 10, toPar: -10, birdies: 3, fairways: 9, gir: 9, putts: 5 });
      const r = completeCampaignEvent(c, e.id, { facts: ctxFacts, rivalScores: {}, rangeMedals: { target: 'bronze' } });
      expect(r.result.cleared).toBe(true);
      expect(r.result.objectives.find((o) => o.id === main.id).met).toBe(true);
      c = r.campaign;
    }
    expect(chapterUnlocked(c, 1)).toBe(true);
    expect(nextCampaignEvent(c).id).toBe('regional-1');
    expect(chapterStars(c, 0).got).toBe(12);
  });
  it('the boss is in the field; rivalry events are match play against the boss alone', () => {
    const c = createCampaign(3);
    const bossEv = eventById('club-4');
    expect(fieldFor(c, bossEv).some((r) => r.boss)).toBe(true);
    expect(fieldFor(c, bossEv).length).toBe(bossEv.field - 1);
    const m = eventById('rivalry-1');
    expect(m.mode).toBe('match');
    expect(fieldFor(c, m).map((r) => r.name)).toEqual(['Rafe Halloran']);
  });
  it('objectives read the round facts, and stars are the best ever met', () => {
    const ev = eventById('club-1');
    let c = createCampaign(1);
    const r1 = completeCampaignEvent(c, ev.id, { facts: facts({ strokes: 40, toPar: 20, fairways: 3 }), rivalScores: {} });
    expect(r1.result.cleared).toBe(false);
    expect(r1.result.stars).toBe(1); // the fairways objective
    expect(r1.result.firstClear).toBe(false);
    expect(r1.result.tokens).toBe(0);
    c = r1.campaign;
    const r2 = completeCampaignEvent(c, ev.id, { facts: facts({ strokes: 8, toPar: -12, birdies: 2 }), rivalScores: {} });
    expect(r2.result.cleared).toBe(true); expect(r2.result.firstClear).toBe(true); expect(r2.result.tokens).toBe(1);
    expect(r2.result.stars).toBe(3);
    expect(r2.result.xp.total).toBeGreaterThan(r1.result.xp.total);
    expect(objectiveMet({ kind: 'rangeMedal', target: 'target', text: 'Hold a gold' }, { facts: facts(), rangeMedals: { target: 'silver' } })).toBe(false);
    expect(objectiveMet({ kind: 'matchWin' }, { facts: facts(), match: 'win' })).toBe(true);
  });
  it('the chapter reward comes with the first clear of the boss event, and campaign saves sanitize', () => {
    let c = createCampaign(2);
    for (const e of CHAPTERS[0].events.slice(0, 3)) c = completeCampaignEvent(c, e.id, { facts: facts({ strokes: 5, toPar: -15, birdies: 4 }), rivalScores: {} }).campaign;
    const r = completeCampaignEvent(c, 'club-4', { facts: facts({ strokes: 5, toPar: -15, birdies: 4, fairways: 5 }), rivalScores: {} });
    expect(r.result.chapterReward).toEqual(CHAPTERS[0].reward);
    expect(r.result.tokens).toBe(2);
    const again = completeCampaignEvent(r.campaign, 'club-4', { facts: facts({ strokes: 5, toPar: -15 }), rivalScores: {} });
    expect(again.result.chapterReward).toBe(null);
    const s = sanitizeCampaign(JSON.parse(JSON.stringify(r.campaign)));
    expect(s.progress['club-4'].cleared).toBe(true);
    expect(sanitizeCampaign({ v: 99 })).toBe(null);
    expect(sanitizeCampaign({ ...r.campaign, progress: { nope: { stars: 9 } } }).progress).toEqual({});
  });
  it('career experience carries into the golfer', () => {
    expect(golferFromCareer({ xp: 900 }, null).xp).toBe(900);
    expect(golferFromCareer({ xp: 10 }, { xp: 500, archetype: 'sharp', nodes: [] }).xp).toBe(500);
  });
});

import { migrateSave, defaultSave, SAVE_VERSION } from '../src/game/save.js';
import { createCareer } from '../src/game/career.js';
describe('save migration to v6', () => {
  it('a v5 save with a career keeps its experience in the golfer and starts without a campaign', () => {
    const v5 = { ...defaultSave(), version: 5, career: { ...createCareer({ seed: 4 }), xp: 1500, level: 5 }, profile: { xp: 40 } };
    delete v5.campaign;
    const s = migrateSave(v5);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.profile.xp).toBe(1500);
    expect(s.profile.archetype).toBe(null);
    expect(s.campaign).toBe(null);
    expect(s.career).toBeTruthy();
  });
  it('junk golfer and campaign data is repaired', () => {
    const s = migrateSave({ ...defaultSave(), profile: { xp: 'x', archetype: 'power', nodes: ['nope'] }, campaign: { v: 1, seed: 3, rivals: [], progress: { 'club-1': { stars: 7, cleared: 1 } } } });
    expect(s.profile.xp).toBe(0); expect(s.profile.nodes).toEqual([]);
    expect(s.campaign.progress['club-1'].stars).toBe(3);
  });
});
