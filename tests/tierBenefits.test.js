// Tier benefits (src/data/tierBenefits.js): bounded values with caps, the wind pushes a higher
// tier's ball less offline but never changes its carry, rough, sand and bad lies cost less,
// and a Pured strike from a good lie in calm air carries exactly the table carry with every tier.
import { describe, it, expect } from 'vitest';
import { CLUBS } from '../src/physics/clubs.js';
import { computeLaunch, SHOT_TYPES, BASE_PROFILE } from '../src/physics/shot.js';
import { simulateShot, flatEnv } from '../src/physics/ball.js';
import { SURFACES } from '../src/physics/surfaces.js';
import { createWind } from '../src/physics/wind.js';
import { strikeResult, applyStrike, strikeFactors, RARITY } from '../src/game/strike.js';
import { TIER_BENEFITS, tierBenefits, tierWind, tierProfile, benefitLines, WIND_CAP, LIE_CAP, RANGE_CAP } from '../src/data/tierBenefits.js';
import { TIER_RANGE, controlRange } from '../src/data/spinControl.js';
import { TIERS } from '../src/game/gear.js';
import { createRng } from '../src/core/rng.js';

const FULL = CLUBS.filter((c) => !c.putter);
const PERFECT = { power: 1, face: 0, path: 0, tempoQuality: 1, tempoRatio: 3, tempoGrade: 'perfect', downMs: 250 };
// A shot as the controller flies it: the tier's lie profile, a Pured strike with the tier's
// lie relief, then the flight in the tier's wind (heading 0 is -Z).
function fly(club, rarity, { lie = SURFACES.FAIRWAY, wind = null, lieRoll = 0 } = {}) {
  const l0 = computeLaunch({ power: 1, face: 0, path: 0, tempoQuality: 1 }, { club, shotType: SHOT_TYPES.FULL, lie, aim: 0, x: 0, z: 0, profile: tierProfile(BASE_PROFILE, rarity), lieRoll });
  const ctx = { clubId: club.id, rarity, lie: SURFACES.FAIRWAY, lieRelief: tierBenefits(rarity).lie };
  const s = strikeResult(PERFECT, ctx, createRng(1));
  expect(s.kind).toBe('pured');
  const launch = applyStrike(l0, s, ctx);
  const env = { ...flatEnv() };
  if (wind) env.windAt = tierWind((t, h, o) => wind.sample(t, h, o), rarity, launch.heading);
  const r = simulateShot(launch, env);
  const p = r.carryPoint || r.end;
  return { carry: r.carry, offline: p.x, loss: l0.speed };
}

describe('tier benefits', () => {
  it('are bounded values in one table, rising with the tier, Legendary at the caps', () => {
    expect(WIND_CAP).toBe(0.2); expect(LIE_CAP).toBe(0.3); expect(RANGE_CAP).toBe(2);
    expect(Object.keys(TIER_BENEFITS)).toEqual(TIERS);
    for (let i = 0; i < TIERS.length; i++) {
      const b = tierBenefits(TIERS[i]);
      expect(b.wind).toBeGreaterThanOrEqual(0); expect(b.wind).toBeLessThanOrEqual(WIND_CAP);
      expect(b.lie).toBeGreaterThanOrEqual(0); expect(b.lie).toBeLessThanOrEqual(LIE_CAP);
      expect(b.range).toBeGreaterThanOrEqual(1); expect(b.range).toBeLessThanOrEqual(RANGE_CAP);
      if (i > 0) {
        const a = tierBenefits(TIERS[i - 1]);
        expect(b.wind).toBeGreaterThan(a.wind); expect(b.lie).toBeGreaterThan(a.lie); expect(b.range).toBeGreaterThan(a.range);
        // The cost stays: a smaller sweet spot and harsher mishits at every step up.
        expect(RARITY[TIERS[i]].sweet).toBeLessThan(RARITY[TIERS[i - 1]].sweet);
        expect(RARITY[TIERS[i]].difficulty).toBeGreaterThan(RARITY[TIERS[i - 1]].difficulty);
      }
    }
    expect(tierBenefits('legendary')).toEqual({ wind: 0.2, lie: 0.3, range: 2 });
    expect(tierBenefits('common')).toEqual({ wind: 0, lie: 0, range: 1 });
    expect(tierBenefits('nonsense')).toEqual(tierBenefits('common'));
    // The spin and shape range is the same table's third value.
    for (const t of TIERS) expect(TIER_RANGE[t]).toBe(tierBenefits(t).range);
    expect(controlRange('legendary')).toBe(1); expect(controlRange('common')).toBe(0.5);
  });
  it('a Pured strike from a good lie in calm air carries the table carry exactly with every tier', () => {
    for (const club of FULL) {
      const base = fly(club, 'common').carry;
      for (const t of TIERS) for (const lie of [SURFACES.FAIRWAY, SURFACES.TEE]) expect(fly(club, t, { lie }).carry).toBe(lie === SURFACES.FAIRWAY ? base : fly(club, 'common', { lie }).carry);
    }
  });
  it('Common is untouched: the same wind function and the same profile object', () => {
    const w = (t, h, o) => o;
    expect(tierWind(w, 'common', 1)).toBe(w);
    expect(tierWind(null, 'legendary', 1)).toBe(null);
    expect(tierProfile(BASE_PROFILE, 'common')).toBe(BASE_PROFILE);
  });
  it('the wind across the line is scaled by (1 - wind); the wind along the line is not', () => {
    for (const heading of [0, 0.7, -2.1]) {
      const raw = { x: 3, z: -4 };
      const o = tierWind((t, h, out) => { out.x = raw.x; out.z = raw.z; return out; }, 'legendary', heading)(0, 10, {});
      const fx = Math.sin(heading), fz = -Math.cos(heading);
      const along = (r) => r.x * fx + r.z * fz, cross = (r) => r.x * -fz + r.z * fx;
      expect(along(o)).toBeCloseTo(along(raw), 10);
      expect(cross(o)).toBeCloseTo(cross(raw) * 0.8, 10);
    }
  });
  it('a head or tail wind changes no tier\'s carry relative to Common; a crosswind moves a higher tier less', () => {
    const club = FULL.find((c) => c.id === 'I7');
    // Along the line of the shot (heading 0): with the shot and against it.
    const behind = createWind({ speedMph: 18, dir: 0, gustiness: 0, seed: 3 });
    const against = createWind({ speedMph: 18, dir: Math.PI, gustiness: 0, seed: 3 });
    const cross = createWind({ speedMph: 18, dir: -Math.PI / 2, gustiness: 0, seed: 3 });
    for (const w of [behind, against]) {
      const c = fly(club, 'common', { wind: w }).carry;
      for (const t of TIERS) expect(Math.abs(fly(club, t, { wind: w }).carry - c)).toBeLessThan(0.01);
    }
    const c = fly(club, 'common', { wind: cross }), l = fly(club, 'legendary', { wind: cross });
    expect(Math.abs(c.offline)).toBeGreaterThan(3);
    // 20 percent less offline (measured 20.8 against 16.6 yd for a 7 iron).
    expect(Math.abs(l.offline) / Math.abs(c.offline)).toBeCloseTo(0.8, 1);
    // Less cross air takes no carry beyond the calm table carry.
    expect(l.carry).toBeLessThanOrEqual(fly(club, 'legendary').carry + 0.5);
  });
  it('rough, sand and bad lies cost less: the carry moves toward the clean carry, never past it', () => {
    for (const club of FULL) {
      const clean = fly(club, 'common').carry;
      for (const lie of [SURFACES.ROUGH, SURFACES.DEEP_ROUGH, SURFACES.BUNKER]) for (const lieRoll of [-1, 0, 1]) {
        const c = fly(club, 'common', { lie, lieRoll }).carry;
        for (const t of TIERS) {
          const l = fly(club, t, { lie, lieRoll }).carry;
          // Closer to the clean carry than Common from the same lie, and never beyond both: a
          // flyer lie (less spin, a little further for a wedge) gains nothing either.
          expect(Math.abs(l - clean)).toBeLessThanOrEqual(Math.abs(c - clean) + 0.05);
          expect(l).toBeLessThanOrEqual(Math.max(c, clean) + 0.05);
        }
      }
    }
    // The speed lost from the lie is 30 percent smaller at Legendary.
    const club = FULL.find((c) => c.id === 'I6');
    const v = (rarity) => computeLaunch({ power: 1, face: 0, path: 0, tempoQuality: 1 }, { club, shotType: SHOT_TYPES.FULL, lie: SURFACES.ROUGH, aim: 0, x: 0, z: 0, profile: tierProfile(BASE_PROFILE, rarity), lieRoll: 0 }).speed;
    const v0 = computeLaunch({ power: 1, face: 0, path: 0, tempoQuality: 1 }, { club, shotType: SHOT_TYPES.FULL, lie: SURFACES.FAIRWAY, aim: 0, x: 0, z: 0, profile: BASE_PROFILE, lieRoll: 0 }).speed;
    expect((v0 - v('legendary')) / (v0 - v('common'))).toBeCloseTo(0.7, 6);
    // The strike model's lie and slope terms (more and worse mishits) shrink by the same share.
    const sw = { power: 0.9, face: 2, path: 1, tempoQuality: 0.8, tempoRatio: 2.8 };
    const fc = strikeFactors(sw, { lie: SURFACES.BUNKER, slope: 0.15 }), fl = strikeFactors(sw, { lie: SURFACES.BUNKER, slope: 0.15, lieRelief: 0.3 });
    expect(fl.lie).toBeCloseTo(fc.lie * 0.7, 10); expect(fl.slope).toBeCloseTo(fc.slope * 0.7, 10);
    expect(strikeFactors(sw, { lie: SURFACES.FAIRWAY, lieRelief: 0.3 }).error).toBe(strikeFactors(sw, { lie: SURFACES.FAIRWAY }).error);
    // Out of range values are clamped to the cap.
    expect(strikeFactors(sw, { lie: SURFACES.BUNKER, slope: 0.15, lieRelief: 5 }).lie).toBeCloseTo(fl.lie, 10);
  });
  it('the gear card lines name the three benefits', () => {
    expect(benefitLines('legendary')).toEqual({ wind: 'Crosswind moves the ball 20 percent less', lie: 'Rough, sand and bad lies cost 30 percent less', range: 'Spin and shape range 2x' });
    expect(benefitLines('common').wind).toBe('Crosswind moves the ball the full amount');
  });
});
