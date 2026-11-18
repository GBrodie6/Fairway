// Strike quality (src/game/strike.js): the ladder is untouched by a perfect swing with common
// clubs, every modifier is bounded, mishits follow rarity and difficulty, and it is
// deterministic with a seed.
import { describe, it, expect } from 'vitest';
import { CLUBS } from '../src/physics/clubs.js';
import { computeLaunch, SHOT_TYPES, nominalCarry, BASE_PROFILE } from '../src/physics/shot.js';
import { simulateShot, flatEnv } from '../src/physics/ball.js';
import { SURFACES } from '../src/physics/surfaces.js';
import { strikeResult, strikeModifiers, applyStrike, strikeFactors, RARITY, DIFFICULTY, CARRY_CAP, CARRY_FLOOR, STRIKE_KINDS } from '../src/game/strike.js';
import { createRng } from '../src/core/rng.js';

const env = flatEnv();
const PERFECT = { power: 1, face: 0, path: 0, tempoQuality: 1, tempoRatio: 3, tempoGrade: 'perfect', downMs: 250 };
const launchFor = (club) => computeLaunch({ power: 1, face: 0, path: 0, tempoQuality: 1 }, { club, shotType: SHOT_TYPES.FULL, lie: SURFACES.FAIRWAY, aim: 0, x: 0, z: 0, profile: BASE_PROFILE });
const carryOf = (club, strike, rarity = 'common') => simulateShot(applyStrike(launchFor(club), strike, { clubId: club.id, rarity }), env).carry;
const FULL = CLUBS.filter((c) => !c.putter);

// A human-like swing: tempo, face drift, and path spread around clean.
function humanSwing(rng, scale = 1) {
  const ratio = 3 * Math.exp(rng.gauss() * 0.22 * scale);
  const err = Math.abs(Math.log(ratio / 3));
  const tq = Math.max(0, Math.min(1, 1 - Math.max(0, err - 0.07) / (Math.LN2 - 0.07)));
  return { power: Math.min(1, 0.8 + rng.gauss() * 0.1), face: Math.max(-8, Math.min(8, rng.gauss() * 1.6 * scale)), path: rng.gauss() * 1.8 * scale, tempoQuality: tq, tempoRatio: ratio, tempoGrade: err < 0.14 ? 'perfect' : err < 0.36 ? 'good' : ratio > 3 ? 'slow' : 'rushed', downMs: 250 };
}
function rates(clubId, rarity, setting, n = 3000, seed = 5) {
  const rng = createRng(seed);
  const c = Object.fromEntries(STRIKE_KINDS.map((k) => [k, 0]));
  for (let i = 0; i < n; i++) c[strikeResult(humanSwing(rng), { clubId, rarity, setting, lie: SURFACES.FAIRWAY }, rng).kind]++;
  const mis = (n - c.pured - c.good) / n;
  return { ...c, mis, pured: c.pured / n };
}

describe('strike quality', () => {
  it('a perfect swing is always Pured, and with common clubs it reproduces the carry ladder exactly', () => {
    const rng = createRng(1);
    for (const club of FULL) {
      for (const setting of Object.keys(DIFFICULTY)) {
        const s = strikeResult(PERFECT, { clubId: club.id, rarity: 'common', setting, lie: SURFACES.FAIRWAY }, rng);
        expect(s.kind).toBe('pured');
      }
      const m = strikeModifiers({ kind: 'pured' }, { clubId: club.id, rarity: 'common' });
      expect(m).toEqual({ speed: 1, launch: 1, spin: 1, heading: 0, tilt: 0 });
      expect(carryOf(club, { kind: 'pured' })).toBe(nominalCarry(club));
    }
  });

  it('carry never drops below 40 percent of the clean shot and never rises past the cap', () => {
    for (const club of FULL) {
      const clean = nominalCarry(club);
      for (const kind of STRIKE_KINDS) for (const severity of [0, 0.25, 0.5, 0.75, 1]) for (const rarity of Object.keys(RARITY)) {
        const c = carryOf(club, { kind, severity, faceSign: 1 }, rarity);
        expect(c / clean).toBeGreaterThanOrEqual(CARRY_FLOOR);
        expect(c / clean).toBeLessThanOrEqual(1 + CARRY_CAP + 0.005);
      }
    }
  });

  it('thin and fat lose 10 to 40 percent, heel and toe 7 to 25 percent, a shank goes sharply offline', () => {
    for (const club of FULL) {
      const clean = nominalCarry(club);
      for (const kind of ['thin', 'fat']) {
        expect(1 - carryOf(club, { kind, severity: 0.1 }) / clean).toBeGreaterThan(0.05);
        expect(1 - carryOf(club, { kind, severity: 1 }) / clean).toBeLessThanOrEqual(0.41);
      }
      for (const kind of ['heel', 'toe']) {
        const loss = 1 - carryOf(club, { kind, severity: 1, faceSign: 1 }) / clean;
        expect(loss).toBeGreaterThan(0.1);
        expect(loss).toBeLessThanOrEqual(0.25);
      }
      const L = applyStrike(launchFor(club), { kind: 'shank', severity: 0.5 }, { clubId: club.id });
      expect((L.heading * 180) / Math.PI).toBeGreaterThan(25);
    }
  });

  it('the Pured bonus follows the rarity table: 0, 2, 4, 6, 8 percent (within 0.7 points across the bag)', () => {
    const want = { common: 0, uncommon: 0.02, rare: 0.04, epic: 0.06, legendary: 0.08 };
    for (const id of ['DR', 'I7', 'SW']) {
      const club = FULL.find((c) => c.id === id);
      const clean = nominalCarry(club);
      for (const [r, b] of Object.entries(want)) expect(Math.abs(carryOf(club, { kind: 'pured' }, r) / clean - 1 - b)).toBeLessThanOrEqual(0.007);
    }
  });

  it('only a little harder: on standard an average swing mishits rarely with common clubs', () => {
    const dr = rates('DR', 'common', 'standard'), i7 = rates('I7', 'common', 'standard'), sw = rates('SW', 'common', 'standard');
    expect(dr.mis).toBeGreaterThan(0.02);
    expect(dr.mis).toBeLessThan(0.12);
    expect(i7.mis).toBeLessThan(dr.mis);
    expect(sw.mis).toBeLessThan(i7.mis + 0.01);
    expect(rates('PT', 'common', 'standard').mis).toBeLessThan(0.02);
  });

  it('mishits rise with rarity and with the difficulty setting', () => {
    let prev = -1;
    for (const r of Object.keys(RARITY)) { const m = rates('DR', r, 'standard').mis; expect(m).toBeGreaterThan(prev); prev = m; }
    const relaxed = rates('I7', 'common', 'relaxed').mis, standard = rates('I7', 'common', 'standard').mis, pro = rates('I7', 'common', 'pro').mis;
    expect(relaxed).toBeLessThan(standard);
    expect(pro).toBeGreaterThan(standard);
  });

  it('bad lies, overswing, and an early release cause more mishits', () => {
    const rng = createRng(3);
    const base = { ...PERFECT, tempoQuality: 0.8, power: 0.9 };
    expect(strikeFactors(base, { lie: SURFACES.BUNKER }).error).toBeGreaterThan(strikeFactors(base, { lie: SURFACES.FAIRWAY }).error);
    expect(strikeFactors({ ...base, power: 1, tempoGrade: 'rushed' }).over).toBe(1);
    expect(strikeFactors({ ...base, auto: true }).timing).toBeGreaterThan(0);
    // Fat shots are likelier from sand than from the fairway.
    const fat = (lie) => { let n = 0; for (let i = 0; i < 4000; i++) { const s = strikeResult({ ...base, tempoQuality: 0.4 }, { clubId: 'I7', lie }, rng); if (s.kind === 'fat') n++; } return n; };
    expect(fat(SURFACES.BUNKER)).toBeGreaterThan(fat(SURFACES.FAIRWAY));
  });

  it('every mishit names its cause in plain words', () => {
    const rng = createRng(9);
    for (let i = 0; i < 500; i++) {
      const s = strikeResult(humanSwing(rng, 3), { clubId: 'DR', lie: SURFACES.ROUGH, setting: 'pro' }, rng);
      if (s.kind !== 'pured' && s.kind !== 'good') expect(s.cause.length).toBeGreaterThan(8);
    }
  });

  it('no NaN from broken input, and the same seed gives the same strikes', () => {
    const junk = [{}, null, { face: NaN, path: Infinity, tempoQuality: NaN, power: NaN }, { face: 99, path: -99, tempoQuality: -3 }];
    for (const j of junk) {
      const s = strikeResult(j, { clubId: 'DR' }, createRng(1));
      expect(STRIKE_KINDS).toContain(s.kind);
      const L = applyStrike(launchFor(FULL[0]), s, { clubId: 'DR' });
      for (const k of ['speed', 'vAngle', 'heading', 'spin', 'axisTilt']) expect(Number.isFinite(L[k])).toBe(true);
    }
    const run = (seed) => { const rng = createRng(seed); return Array.from({ length: 200 }, () => strikeResult(humanSwing(rng, 2), { clubId: 'I5', setting: 'pro' }, rng).kind).join(); };
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(43));
  });

  it('applyStrike leaves the original launch untouched', () => {
    const L = launchFor(FULL[0]);
    const copy = { ...L };
    applyStrike(L, { kind: 'thin', severity: 1 }, { clubId: 'DR' });
    expect(L).toEqual(copy);
  });
});
