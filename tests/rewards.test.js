import { describe, it, expect } from 'vitest';
import { roundRewards, addTokens, ROUND_TOKENS_PER_DAY } from '../src/game/rewards.js';
import { defaultSave } from '../src/game/save.js';

const D = 86400000 * 20000;
describe('gear tokens', () => {
  it('a round gives one token, capped per day, and resets the next day', () => {
    let s = defaultSave();
    for (let i = 0; i < ROUND_TOKENS_PER_DAY + 2; i++) s = roundRewards(s, { holes: 9, now: D + i * 1000 }).save;
    expect(s.wallet.tokens).toBe(ROUND_TOKENS_PER_DAY);
    s = roundRewards(s, { holes: 9, now: D + 86400000 }).save;
    expect(s.wallet.tokens).toBe(ROUND_TOKENS_PER_DAY + 1);
  });
  it('short rounds give nothing; daily and events add their own', () => {
    expect(roundRewards(defaultSave(), { holes: 1, now: D }).tokens).toBe(0);
    expect(roundRewards(defaultSave(), { holes: 3, kind: 'daily', firstDailyToday: true, now: D }).tokens).toBe(2);
    expect(roundRewards(defaultSave(), { holes: 3, kind: 'daily', firstDailyToday: false, now: D }).tokens).toBe(1);
    expect(roundRewards(defaultSave(), { holes: 9, kind: 'career', position: 2, now: D }).tokens).toBe(3);
    expect(roundRewards(defaultSave(), { holes: 9, kind: 'career', position: 7, now: D }).tokens).toBe(2);
  });
  it('addTokens ignores junk', () => {
    const s = defaultSave();
    expect(addTokens(s, -3)).toBe(s);
    expect(addTokens(s, NaN)).toBe(s);
    expect(addTokens(s, 2).wallet.tokens).toBe(2);
  });
});
