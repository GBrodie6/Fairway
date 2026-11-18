// The season track: a free 30-tier track over four weeks. Every XP point earned during the
// season also fills the track; each tier holds a fixed reward (tokens, shards, a Mulligan, or
// a cosmetic). There is no paid track and nothing random. Pure functions over save.season.
export const SEASON_DAYS = 28;
export const SEASON_TIERS = 30;
export const XP_PER_TIER = 300;
const EPOCH = Date.UTC(2026, 0, 5); // a Monday

export const seasonIndex = (now) => Math.max(0, Math.floor((now - EPOCH) / (SEASON_DAYS * 86400000)));
export const seasonEnds = (now) => EPOCH + (seasonIndex(now) + 1) * SEASON_DAYS * 86400000;
export const SEASON_NAMES = ['Spring Links', 'Summer Greens', 'Harvest Fairways', 'Frost Line', 'Coastal Winds', 'Desert Bloom', 'Mountain Air', 'Golden Hour', 'Night Owls', 'Lagoon Days', 'Old Course', 'First Light', 'Tall Grass'];
export const seasonName = (idx) => SEASON_NAMES[idx % SEASON_NAMES.length];

// The reward on each tier (1-based).
export function tierReward(tier) {
  const cos = { 5: 'ball-mint', 10: 'trail-ice', 15: 'ball-violet', 20: 'trail-rose', 25: 'ball-gold', 30: 'trail-gold' };
  if (cos[tier]) return { kind: 'cosmetic', id: cos[tier] };
  if (tier % 8 === 0) return { kind: 'mulligan', n: 1 };
  if (tier % 3 === 0) return { kind: 'tokens', n: tier >= 20 ? 2 : 1 };
  return { kind: 'shards', n: 10 + Math.floor(tier / 5) * 5 };
}

export function rollSeason(state, now) {
  const idx = seasonIndex(now);
  if (state && state.id === idx) return { id: idx, xp: Math.max(0, Math.floor(Number(state.xp) || 0)), claimed: Array.isArray(state.claimed) ? state.claimed.filter((t) => Number.isInteger(t) && t >= 1 && t <= SEASON_TIERS) : [] };
  return { id: idx, xp: 0, claimed: [] };
}
export const tierFor = (xp) => Math.min(SEASON_TIERS, Math.floor((xp || 0) / XP_PER_TIER));
export function addSeasonXp(state, xp, now) {
  const s = rollSeason(state, now);
  return { ...s, xp: s.xp + Math.max(0, Math.round(Number(xp) || 0)) };
}
// Claim a reached tier once. Returns { state, reward } or { state, reward: null }.
export function claimTier(state, tier) {
  if (!Number.isInteger(tier) || tier < 1 || tier > tierFor(state.xp) || state.claimed.includes(tier)) return { state, reward: null };
  return { state: { ...state, claimed: [...state.claimed, tier] }, reward: tierReward(tier) };
}
