// Gear tokens: earned by playing, never bought. One token opens one gear drop (game/gear.js).
// Pure functions over the save's wallet.
//   finishing a round of 3 or more holes: 1 token, up to 3 a day from rounds
//   the daily challenge: 1 more token the first time each day
//   a campaign or career event: 1 more token, 2 for a top-three finish
// Range drills, level milestones and campaign chapters add their own (game/gear.js LEVEL_REWARDS).
export const ROUND_TOKENS_PER_DAY = 3;
export const dayNumber = (now) => Math.floor(now / 86400000);

export function addTokens(save, n) {
  if (!(n > 0)) return save;
  return { ...save, wallet: { ...save.wallet, tokens: (save.wallet.tokens || 0) + n } };
}

/**
 * Tokens for one finished round. ctx: { holes, kind ('daily' | 'career' | 'campaign' | other),
 * position, firstDailyToday, now }. Returns { save, tokens, lines } where lines say why.
 */
export function roundRewards(save, ctx) {
  const now = ctx.now || Date.now();
  const day = dayNumber(now);
  const w = save.wallet || {};
  let used = w.tokenDay === day ? w.dayTokens || 0 : 0;
  let tokens = 0;
  const lines = [];
  if ((ctx.holes || 0) >= 3) {
    if (used < ROUND_TOKENS_PER_DAY) { tokens++; used++; lines.push('Round finished: +1 gear token'); }
    else lines.push(`Round tokens for today are done (${ROUND_TOKENS_PER_DAY} a day). More tomorrow.`);
  }
  if (ctx.kind === 'daily' && ctx.firstDailyToday) { tokens++; lines.push('Daily challenge: +1 gear token'); }
  if (ctx.kind === 'career' || ctx.kind === 'campaign') {
    const n = ctx.position && ctx.position <= 3 ? 2 : 1;
    tokens += n; lines.push(`Event finished${n === 2 ? ' in the top three' : ''}: +${n} gear token${n === 1 ? '' : 's'}`);
  }
  const next = { ...save, wallet: { ...w, tokens: (w.tokens || 0) + tokens, tokenDay: day, dayTokens: used } };
  return { save: next, tokens, lines };
}
