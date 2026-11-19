// What a higher club tier gives back for its cost. One data file so every value and cap is in
// one place; game/strike.js holds the cost (RARITY: a smaller sweet spot and harsher mishits).
//
// None of it adds carry. A Pured strike from a good lie in calm air carries exactly the club's
// table carry at that power with every tier (tests/strike.test.js and tests/tierBenefits.test.js),
// so the power guide's mark is exact. The benefits only take away part of a penalty:
//
//   wind   the wind pushes the ball less: the part of the wind blowing across the line of the
//          shot is scaled by (1 - wind), so a crosswind moves the ball less offline. The part
//          along the line (a headwind or a tailwind) acts in full on every tier, so the wind
//          never gives a tier carry. Calm air is unchanged. Cap WIND_CAP (20 percent).
//   lie    smaller distance and accuracy penalties from rough, sand and bad lies: the speed lost
//          from the lie (physics/shot.js, through the profile's recovery), the spin the lie
//          takes away (profile.lieRelief, so a flyer does not fly further), and the lie and slope
//          terms of the strike model (more and worse mishits from a bad lie) are scaled by
//          (1 - lie). A fairway, tee or green lie has no penalty to reduce. Cap LIE_CAP
//          (30 percent).
//   range  the existing wider spin and shape range: the ball-contact dot reaches further
//          (data/spinControl.js multiplies its base range by this, and its own MAX_RANGE, the
//          edge of the pad, still applies). Cap RANGE_CAP (2, twice the Common range).
//
// The guide and the aim fan read the same values, so what the game shows is what the ball does.
export const WIND_CAP = 0.2;
export const LIE_CAP = 0.3;
export const RANGE_CAP = 2;

export const TIER_BENEFITS = Object.freeze({
  common: Object.freeze({ wind: 0, lie: 0, range: 1 }),
  uncommon: Object.freeze({ wind: 0.05, lie: 0.08, range: 1.2 }),
  rare: Object.freeze({ wind: 0.1, lie: 0.15, range: 1.4 }),
  epic: Object.freeze({ wind: 0.15, lie: 0.22, range: 1.6 }),
  legendary: Object.freeze({ wind: 0.2, lie: 0.3, range: 2 }),
});

const bound = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

// A tier's benefits, clamped to the caps. An unknown tier gets Common's (none).
export function tierBenefits(rarity) {
  const b = TIER_BENEFITS[rarity] || TIER_BENEFITS.common;
  return { wind: bound(b.wind, 0, WIND_CAP), lie: bound(b.lie, 0, LIE_CAP), range: bound(b.range, 1, RANGE_CAP) };
}

// The wind the ball feels with this tier, for a shot heading `heading` (radians, 0 = -Z, the
// game's convention): the part of the wind across the line of the shot is scaled by
// (1 - wind); the part along the line (head or tail) is left as it is, so no tier gains or loses
// carry from the wind. Returns the input unchanged for Common and when there is no wind, so
// Common shots are bit for bit as before.
export function tierWind(windAt, rarity, heading = 0) {
  const w = tierBenefits(rarity).wind;
  if (!windAt || w <= 0) return windAt;
  const k = 1 - w, fx = Math.sin(heading), fz = -Math.cos(heading);
  return (t, h, out) => {
    const o = windAt(t, h, out) || out;
    const x = Number.isFinite(o.x) ? o.x : 0, z = Number.isFinite(o.z) ? o.z : 0;
    const along = x * fx + z * fz;
    o.x = along * fx + (x - along * fx) * k;
    o.z = along * fz + (z - along * fz) * k;
    return o;
  };
}

// The profile a shot flies with from a lie: the lie's speed loss scaled down by the tier
// (profile.recovery multiplies it in physics/shot.js; lower is a smaller penalty) and the spin
// the lie takes away scaled down by the same share (profile.lieRelief), so the lie's effect
// moves toward a clean strike and never past it. Returns the same object for Common.
export function tierProfile(profile, rarity) {
  const l = tierBenefits(rarity).lie;
  if (!profile || l <= 0) return profile;
  return { ...profile, recovery: profile.recovery * (1 - l), lieRelief: l };
}

// Short lines for the gear card and the compare view.
export function benefitLines(rarity) {
  const b = tierBenefits(rarity);
  const pct = (v) => `${Math.round(v * 100)} percent`;
  return {
    wind: b.wind > 0 ? `Crosswind moves the ball ${pct(b.wind)} less` : 'Crosswind moves the ball the full amount',
    lie: b.lie > 0 ? `Rough, sand and bad lies cost ${pct(b.lie)} less` : 'Rough, sand and bad lies cost the full amount',
    range: `Spin and shape range ${b.range.toFixed(1).replace(/\.0$/, '')}x`,
  };
}
