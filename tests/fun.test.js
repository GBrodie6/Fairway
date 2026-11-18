import { describe, it, expect } from 'vitest';
import { pickQuests, rollQuests, progressQuests, claimQuest, unclaimed, QUEST_POOL, questDef } from '../src/game/quests.js';
import { rollSeason, addSeasonXp, claimTier, tierFor, tierReward, SEASON_TIERS, XP_PER_TIER, seasonIndex, seasonEnds } from '../src/game/season.js';
import { COSMETICS, sanitizeCosmetics, grantCosmetic, equipCosmetic, cosmeticById, DEFAULT_COSMETICS } from '../src/game/cosmetics.js';
import { FEATS, newFeats } from '../src/game/feats.js';
import { emptyStreaks, updateStreaks, hotStreak } from '../src/game/streaks.js';
import { miniGameForWeek, MINI_GAMES, rollWeekly, recordWeekly, adaptiveRivalSkill, rivalLabel } from '../src/game/weekly.js';
import { ACHIEVEMENTS, defaultSave } from '../src/game/save.js';

const DAY = 86400000, T = Date.UTC(2026, 10, 18);
describe('quests', () => {
  it('three daily and three weekly, the same for everyone on the same day', () => {
    expect(pickQuests('daily', '2026-11-18').map((q) => q.id)).toEqual(pickQuests('daily', '2026-11-18').map((q) => q.id));
    expect(new Set(pickQuests('weekly', '2026-W47').map((q) => q.id)).size).toBe(3);
    const s = rollQuests(null, '2026-11-18', '2026-W47');
    expect(s.daily.list.length).toBe(3); expect(s.weekly.list.length).toBe(3);
    expect(rollQuests(s, '2026-11-18', '2026-W47')).toEqual(s);
    expect(rollQuests(s, '2026-11-19', '2026-W47').daily.key).toBe('2026-11-19');
  });
  it('progress fills to the goal, completes once, claims once for the reward', () => {
    let s = rollQuests(null, 'd', 'w');
    const q = s.daily.list[0], d = questDef(q.id);
    let r = progressQuests(s, { [d.stat]: d.goal - 1 });
    expect(r.completed.length).toBe(0);
    r = progressQuests(r.state, { [d.stat]: 5 });
    expect(r.completed.map((x) => x.id)).toContain(d.id);
    expect(r.state.daily.list[0].progress).toBe(d.goal);
    expect(progressQuests(r.state, { [d.stat]: 5 }).completed.map((x) => x.id)).not.toContain(d.id);
    expect(unclaimed(r.state)).toBeGreaterThanOrEqual(1);
    const c = claimQuest(r.state, d.id);
    expect(c.reward.xp).toBe(d.xp);
    expect(c.state.done).toBe(1);
    expect(claimQuest(c.state, d.id).reward).toBe(null);
    expect(claimQuest(s, d.id).reward).toBe(null);
  });
  it('weekly quests give a gear token and nothing in the pool is random', () => {
    for (const q of QUEST_POOL.weekly) expect(q.tokens).toBe(1);
    for (const q of [...QUEST_POOL.daily, ...QUEST_POOL.weekly]) expect(q.goal).toBeGreaterThan(0);
  });
});

describe('season track', () => {
  it('fills with XP, rolls over each season, and claims each tier once', () => {
    let s = rollSeason(null, T);
    s = addSeasonXp(s, XP_PER_TIER * 3 + 10, T);
    expect(tierFor(s.xp)).toBe(3);
    const c = claimTier(s, 3);
    expect(c.reward).toEqual(tierReward(3));
    expect(claimTier(c.state, 3).reward).toBe(null);
    expect(claimTier(c.state, 4).reward).toBe(null);
    const next = addSeasonXp(c.state, 10, seasonEnds(T) + 1000);
    expect(next.id).toBe(seasonIndex(T) + 1); expect(next.xp).toBe(10); expect(next.claimed).toEqual([]);
    expect(tierFor(1e9)).toBe(SEASON_TIERS);
  });
  it('every tier has a fixed reward and every cosmetic reward exists', () => {
    for (let t = 1; t <= SEASON_TIERS; t++) {
      const r = tierReward(t);
      expect(['tokens', 'shards', 'mulligan', 'cosmetic']).toContain(r.kind);
      if (r.kind === 'cosmetic') expect(cosmeticById(r.id)).toBeTruthy();
    }
  });
});

describe('cosmetics', () => {
  it('defaults are owned, an old ball color carries over, and only owned items equip', () => {
    const c = sanitizeCosmetics(null, '#ffd23f');
    expect(c.ball).toBe('ball-yellow');
    expect(c.owned).toEqual(DEFAULT_COSMETICS.owned);
    expect(equipCosmetic(c, 'ball-gold')).toBe(c);
    const g = grantCosmetic(c, 'ball-gold');
    expect(equipCosmetic(g, 'ball-gold').ball).toBe('ball-gold');
    expect(sanitizeCosmetics({ owned: ['nope', 'trail-ice'], trail: 'trail-ice' }).trail).toBe('trail-ice');
  });
});

describe('achievements', () => {
  it('there are at least 50, with unique ids, and every feat cosmetic exists', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const f of FEATS) if (f.cosmetic) expect(cosmeticById(f.cosmetic)).toBeTruthy();
    for (const c of COSMETICS.filter((x) => x.source === 'feat')) expect(FEATS.some((f) => f.id === c.feat)).toBe(true);
  });
  it('checks read the save and never throw on a fresh one', () => {
    const s = defaultSave();
    expect(newFeats(s)).toEqual([]);
    const busy = { ...s, stats: { ...s.stats, rounds: 12, birdies: 11, longestDrive: 290 * 0.9144 }, counters: { pured: 60, parStreakBest: 5, matchWins: 1 }, history: [{ courseId: 'links', holes: 9, toPar: 2, strokes: 38 }] };
    const ids = newFeats(busy);
    for (const id of ['rounds-10', 'birdies-10', 'drive-280', 'pured-50', 'par-train-5', 'match-win', 'course-links']) expect(ids).toContain(id);
    expect(ids).not.toContain('drive-320');
    expect(newFeats({ ...busy, achievements: { 'rounds-10': 1 } })).not.toContain('rounds-10');
  });
});

describe('streaks', () => {
  it('counts runs, resets on a miss, and announces at 3', () => {
    let s = emptyStreaks(), said = [];
    for (const toPar of [0, -1, -1, 0, 1]) { const r = updateStreaks(s, { type: 'hole', toPar }); s = r.streaks; if (r.announce) said.push(r.announce); }
    // One line per hole: the birdie run outranks the par run reaching 3 on the same hole.
    expect(said).toEqual(['Back-to-back birdies']);
    let p = emptyStreaks(), last = null;
    for (const toPar of [0, 0, 0]) { const r = updateStreaks(p, { type: 'hole', toPar }); p = r.streaks; last = r.announce || last; }
    expect(last).toBe('3 holes at par or better');
    expect(s.par).toBe(0); expect(s.best.par).toBe(4); expect(s.best.birdie).toBe(2);
    for (let i = 0; i < 3; i++) s = updateStreaks(s, { type: 'strike', kind: 'pured' }).streaks;
    expect(hotStreak(s).key).toBe('pure');
    s = updateStreaks(s, { type: 'strike', kind: 'thin' }).streaks;
    expect(hotStreak(s)).toBe(null);
  });
});

describe('weekly and the adaptive rival', () => {
  it('the mini-game rotates by week and the weekly record resets', () => {
    expect(miniGameForWeek(T)).toEqual(miniGameForWeek(T + DAY));
    const seen = new Set(); for (let w = 0; w < 4; w++) seen.add(miniGameForWeek(T + w * 7 * DAY).id);
    expect(seen.size).toBe(MINI_GAMES.length);
    let wk = recordWeekly(null, T, { longdrive: 251 });
    wk = recordWeekly(wk, T + DAY, { longdrive: 240 });
    expect(wk.longdrive).toBe(251);
    expect(rollWeekly(wk, T + 8 * DAY).longdrive).toBe(0);
  });
  it('the rival follows recent form, leaning a little toward the rival, within bounds', () => {
    expect(adaptiveRivalSkill([])).toBe(0.55);
    const good = Array.from({ length: 8 }, () => ({ holes: 9, toPar: -2 }));
    const bad = Array.from({ length: 8 }, () => ({ holes: 9, toPar: 14 }));
    expect(adaptiveRivalSkill(good)).toBeGreaterThan(adaptiveRivalSkill(bad));
    const even = adaptiveRivalSkill(Array.from({ length: 8 }, () => ({ holes: 9, toPar: 3 })));
    // The rival model's expected score per hole over par for that skill sits a little under the player's.
    expect(1.95 - 2.65 * even).toBeLessThan(3 / 9);
    expect(adaptiveRivalSkill(Array.from({ length: 8 }, () => ({ holes: 9, toPar: -40 })))).toBe(0.88);
    expect(rivalLabel(0.9)).toBe('sharp');
  });
});
