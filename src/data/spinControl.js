// How far the ball-contact dot can move (Part 2, ui/spinPad.js and game/spin.js), as a share of
// the full pad. One data file so every multiplier and cap is in one place.
//
// The usable range is BASE_RANGE x the club tier's multiplier x (1 + the golfer's perk), capped
// at MAX_RANGE. Higher tiers are harder to strike (game/strike.js: smaller sweet spot, harsher
// mishits) and in return reach further on the pad: more draw, fade, backspin and topspin.
// No tier and no perk adds carry. Neutral (the center) is the base flight exactly.
export const BASE_RANGE = 0.5; // a Common club reaches half way to the edge
export const MAX_RANGE = 1; // the edge of the pad, never more
export const TIER_RANGE = { common: 1, uncommon: 1.2, rare: 1.4, epic: 1.6, legendary: 2 };
// Archetype and tree perks (campaign.js perk 'shape') add at most this share.
export const PERK_RANGE_CAP = 0.25;
export function controlRange(rarity, perk = 0) {
  const t = TIER_RANGE[rarity] || TIER_RANGE.common;
  const p = Math.max(0, Math.min(PERK_RANGE_CAP, Number.isFinite(perk) ? perk : 0));
  return Math.min(MAX_RANGE, BASE_RANGE * t * (1 + p));
}
