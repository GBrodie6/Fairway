// How far the ball-contact dot can move (Part 2, ui/spinPad.js and game/spin.js), as a share of
// the full pad. One data file so every multiplier and cap is in one place.
//
// The usable range is BASE_RANGE x the club tier's multiplier x (1 + the golfer's perk), capped
// at MAX_RANGE. Higher tiers are harder to strike (game/strike.js: smaller sweet spot, harsher
// mishits) and in return reach further on the pad: more draw, fade, backspin and topspin.
// No tier and no perk adds carry. Neutral (the center) is the base flight exactly.
import { TIER_BENEFITS, tierBenefits } from './tierBenefits.js';

export const BASE_RANGE = 0.5; // a Common club reaches half way to the edge
export const MAX_RANGE = 1; // the edge of the pad, never more
// The tier's multiplier is one of the three tier benefits (data/tierBenefits.js).
export const TIER_RANGE = Object.fromEntries(Object.keys(TIER_BENEFITS).map((t) => [t, tierBenefits(t).range]));
// Golfer perks add at most this share. An archetype's own perk (by campaign archetype id;
// the pros in data/pros.json use the same ids):
export const PERK_RANGE_CAP = 0.25;
export const ARCHETYPE_RANGE = { power: 0.05, sharp: 0.2, short: 0.15, putt: 0.05, links: 0.25, all: 0.1 };
export const archetypeRange = (id) => Math.min(PERK_RANGE_CAP, ARCHETYPE_RANGE[id] || 0);
export function controlRange(rarity, perk = 0) {
  const t = TIER_RANGE[rarity] || TIER_RANGE.common;
  const p = Math.max(0, Math.min(PERK_RANGE_CAP, Number.isFinite(perk) ? perk : 0));
  return Math.min(MAX_RANGE, BASE_RANGE * t * (1 + p));
}
