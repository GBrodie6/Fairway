// The pro golfers (src/data/pros.json, src/game/pros.js): a valid, original roster at a matched
// level, every modifier inside the campaign caps, the mentor unlock, the tournament field, and
// the balance rule: 200 simulated rounds per pro, each within 1.5 strokes per 18 of the pros'
// average at the matched level.
import { describe, it, expect } from 'vitest';
import data from '../src/data/pros.json' with { type: 'json' };
import { PROS, proById, proProfile, proStrike, proPlayer, emblemSvg, emblemSrc, PRO_STAT_TOTAL } from '../src/game/pros.js';
import { ARCHETYPE_IDS, ARCHETYPES, STATS, STAT_MAX, profileFromStats, shotUnlocked, sanitizeGolfer, newGolfer, mentorShot } from '../src/game/campaign.js';
import { shotData } from '../src/data/shotTypes.js';
import { createTournament } from '../src/game/tournament.js';
import { runCells } from '../scripts/sim/run.mjs';

describe('the pro roster', () => {
  it('twelve invented pros, two of each archetype, matched stat totals inside the caps', () => {
    expect(PROS.length).toBe(12);
    expect(new Set(PROS.map((p) => p.id)).size).toBe(12);
    expect(new Set(PROS.map((p) => p.name)).size).toBe(12);
    for (const a of ARCHETYPE_IDS) expect(PROS.filter((p) => p.archetype === a).length).toBe(2);
    for (const p of PROS) {
      expect(STATS.reduce((t, k) => t + p.stats[k], 0)).toBe(PRO_STAT_TOTAL);
      for (const k of STATS) { expect(p.stats[k]).toBeGreaterThanOrEqual(30); expect(p.stats[k]).toBeLessThanOrEqual(Math.min(STAT_MAX, ARCHETYPES[p.archetype].caps[k] ?? STAT_MAX)); }
      // The cleaned stats are the file's stats (nothing was clamped away).
      expect(p.stats).toEqual(data.pros.find((x) => x.id === p.id).stats);
      expect(shotData(p.signature).id).toBe(p.signature);
      expect(shotData(p.signature).unlock).not.toBe('base');
      expect(p.bio.length).toBeGreaterThan(40);
      for (const t of [p.name, p.bio]) expect(t).not.toMatch(/—/);
      expect(/^#[0-9a-f]{6}$/i.test(p.color)).toBe(true);
    }
    expect(data.note).toMatch(/can be edited/);
  });
  it('every pro modifier stays inside the campaign golfer\'s caps', () => {
    for (const p of PROS) {
      const pr = proProfile(p);
      expect(pr.power).toBeGreaterThanOrEqual(0.95); expect(pr.power).toBeLessThanOrEqual(1.08);
      expect(pr.spin).toBeLessThanOrEqual(1.15);
      for (const k of ['accuracy', 'touch', 'putting', 'recovery', 'forgiveness']) { expect(pr[k]).toBeGreaterThanOrEqual(0.45); expect(pr[k]).toBeLessThanOrEqual(1.3); }
      expect(proStrike(p, 'wood').forgiveness).toBeLessThanOrEqual(1.15);
      expect(proStrike(p).perkBonus).toBeUndefined();
      const pl = proPlayer(p, { kind: 'ai', id: 'ai1' });
      expect(pl).toMatchObject({ id: 'ai1', kind: 'ai', name: p.name, pro: p.id, archetype: p.archetype });
    }
    // The same mapping as the campaign golfer: the pro's stats and innate perks.
    for (const p of PROS) expect(Object.isFrozen(proProfile(p))).toBe(true);
    expect(typeof profileFromStats).toBe('function');
  });
  it('emblems are images of shapes, never markup in the page', () => {
    for (const p of PROS) {
      const svg = emblemSvg(p);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/<script|on\w+=|<image|href=/i);
      expect(emblemSrc(p).startsWith('data:image/svg+xml')).toBe(true);
    }
  });
});

describe('pros in the game', () => {
  it('a mentor teaches exactly their signature shot, and the save keeps only a real mentor', () => {
    const g = newGolfer('sharp');
    const p = proById('solvane');
    expect(shotUnlocked(g, 'flop')).toBe(false);
    expect(shotUnlocked({ ...g, mentor: 'solvane' }, 'flop')).toBe(true);
    expect(shotUnlocked({ ...g, mentor: 'solvane' }, 'bump')).toBe(false);
    expect(mentorShot('solvane')).toBe(p.signature);
    expect(sanitizeGolfer({ ...g, mentor: 'solvane' }).mentor).toBe('solvane');
    expect(sanitizeGolfer({ ...g, mentor: 'nobody' }).mentor).toBeUndefined();
  });
  it('the pros play every tournament, except the one you play as', () => {
    const t = createTournament({ courseId: 'parkland', seed: 9 });
    const ids = t.field.map((r) => r.id);
    for (const p of PROS) expect(ids).toContain(`pro:${p.id}`);
    expect(t.field.length).toBe(29);
    const t2 = createTournament({ courseId: 'parkland', seed: 9, as: 'kellbrook' });
    expect(t2.field.map((r) => r.id)).not.toContain('pro:kellbrook');
    expect(t2.field.length).toBe(29);
  });
});

describe('pro balance', () => {
  it('200 simulated rounds per pro: each within 1.5 strokes per 18 of the average at the matched level', async () => {
    const cells = PROS.map((p) => ({ kind: 'pro', pro: p.id, skill: 0.85 }));
    const rows = await runCells(cells, 200, 4);
    const per18 = rows.map((r) => (2 * r.reduce((t, x) => t + x.toPar, 0)) / r.length);
    for (const r of rows) expect(r.length).toBe(200);
    const avg = per18.reduce((a, b) => a + b, 0) / per18.length;
    for (const v of per18) expect(Math.abs(v - avg)).toBeLessThanOrEqual(1.5);
  }, 600000);
});
