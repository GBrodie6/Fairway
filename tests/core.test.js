import { describe, it, expect } from 'vitest';
import { detectTier, TIERS, TIER_ORDER, tierById } from '../src/core/quality.js';
import { sanitizeSettings, migrateSettings, DEFAULT_SETTINGS, SETTINGS_VERSION, readUrlParams } from '../src/core/settings.js';
import { createRng, hashString, fbm2, valueNoise2 } from '../src/core/rng.js';
import { guarded, guardStats, fin, allFinite, safeLinearGradient, safeRadialGradient } from '../src/core/guards.js';
import { clamp, smoothstep, wrapAngle, lerp } from '../src/core/math.js';
import { COURSES, coursePar, courseById } from '../src/course/courses.js';
import { TOD, TOD_ORDER, bandFor } from '../src/render/timeOfDay.js';

describe('quality tiers', () => {
  it('defines four ordered tiers with rising budgets', () => {
    expect(TIER_ORDER).toEqual(['low', 'medium', 'high', 'ultra']);
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const a = TIERS[TIER_ORDER[i - 1]], b = TIERS[TIER_ORDER[i]];
      expect(b.budget.triangles).toBeGreaterThan(a.budget.triangles);
      expect(b.budget.drawCalls).toBeGreaterThan(a.budget.drawCalls);
      expect(b.pixelRatioCap).toBeGreaterThanOrEqual(a.pixelRatioCap);
      expect(b.shadows.cascades).toBeGreaterThanOrEqual(a.shadows.cascades);
      expect(b.grassRadius).toBeGreaterThanOrEqual(a.grassRadius);
      expect(b.drawDistance).toBeGreaterThan(a.drawDistance);
      expect(b.texSize).toBeGreaterThanOrEqual(a.texSize);
    }
    expect(tierById('nope').id).toBe('medium');
  });
  it('software renderers and missing WebGL2 get low', () => {
    expect(detectTier({ gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))' })).toBe('low');
    expect(detectTier({ gpu: 'llvmpipe (LLVM 15)' })).toBe('low');
    expect(detectTier({ gpu: 'NVIDIA GeForce RTX 4070', webgl2: false })).toBe('low');
  });
  it('phones start on low unless clearly strong', () => {
    expect(detectTier({ gpu: 'Mali-G52', mobile: true, memoryGb: 4, cores: 8 })).toBe('low');
    expect(detectTier({ gpu: 'Adreno (TM) 740', mobile: true, memoryGb: 8, cores: 8 })).toBe('medium');
    expect(detectTier({ gpu: 'Apple GPU', mobile: true, memoryGb: 4, cores: 6 })).toBe('medium');
    expect(detectTier({ gpu: 'Apple GPU', mobile: true, memoryGb: 2, cores: 2 })).toBe('low');
  });
  it('desktop GPUs map to medium, high, or ultra', () => {
    expect(detectTier({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)', memoryGb: 8, cores: 12 })).toBe('ultra');
    expect(detectTier({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11)', memoryGb: 8, cores: 8 })).toBe('high');
    expect(detectTier({ gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', memoryGb: 8, cores: 8 })).toBe('medium');
    expect(detectTier({ gpu: 'ANGLE (Intel, Intel(R) HD Graphics 4000)', memoryGb: 4, cores: 4 })).toBe('low');
    expect(detectTier({ gpu: '', memoryGb: 8, cores: 8 })).toBe('high');
    expect(detectTier({})).toBe('medium');
  });
});

describe('settings', () => {
  it('sanitizes garbage into defaults', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ tier: 'mega', masterVolume: 7, aimSensitivity: -4, units: 'furlongs', reducedMotion: 'true', stickScale: NaN, evil: 1 });
    expect(s.tier).toBe('auto');
    expect(s.masterVolume).toBe(1);
    expect(s.aimSensitivity).toBe(0.25);
    expect(s.units).toBe('yards');
    expect(s.reducedMotion).toBe(true);
    expect(s.stickScale).toBe(1);
    expect(s.evil).toBeUndefined();
    expect(s.version).toBe(SETTINGS_VERSION);
  });
  it('migrates version 1 saves', () => {
    const s = migrateSettings({ version: 1, volume: 0.4, leftHanded: true, tier: 'high' });
    expect(s.version).toBe(SETTINGS_VERSION);
    expect(s.masterVolume).toBe(0.4);
    expect(s.handedness).toBe('left');
    expect(s.leftHandLayout).toBe(true);
    expect(s.tier).toBe('high');
  });
  it('treats a save with no version as version 1 and survives nonsense', () => {
    expect(migrateSettings({ volume: 0.2 }).masterVolume).toBe(0.2);
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({ version: 999, tier: 'low' }).tier).toBe('low');
  });
  it('parses and clamps URL parameters', () => {
    const p = readUrlParams('?debug&course=links&tod=dusk&tier=ultra&hole=44&timescale=999&smoke=0');
    expect(p.debug).toBe(true);
    expect(p.smoke).toBe(false);
    expect(p.course).toBe('links');
    expect(p.tier).toBe('ultra');
    expect(p.hole).toBe(18);
    expect(p.timescale).toBe(60);
    expect(readUrlParams('?tier=bogus&hole=abc').tier).toBeUndefined();
    expect(readUrlParams('?hole=abc').hole).toBeUndefined();
  });
});

describe('rng and noise', () => {
  it('is deterministic and uniform enough', () => {
    const a = createRng(42), b = createRng(42);
    let sum = 0;
    for (let i = 0; i < 5000; i++) { const v = a.next(); expect(v).toBe(b.next()); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); sum += v; }
    expect(sum / 5000).toBeGreaterThan(0.47);
    expect(sum / 5000).toBeLessThan(0.53);
    expect(createRng('abc').next()).toBe(createRng('abc').next());
    expect(hashString('a')).not.toBe(hashString('b'));
  });
  it('gauss has roughly unit variance and never NaN', () => {
    const r = createRng(7);
    let s = 0, s2 = 0;
    for (let i = 0; i < 20000; i++) { const g = r.gauss(); expect(Number.isFinite(g)).toBe(true); s += g; s2 += g * g; }
    expect(Math.abs(s / 20000)).toBeLessThan(0.05);
    expect(s2 / 20000).toBeGreaterThan(0.9);
    expect(s2 / 20000).toBeLessThan(1.1);
  });
  it('int and pick stay in range and forks are independent', () => {
    const r = createRng(3);
    for (let i = 0; i < 500; i++) { const v = r.int(2, 5); expect(v).toBeGreaterThanOrEqual(2); expect(v).toBeLessThanOrEqual(5); }
    expect([1, 2, 3]).toContain(r.pick([1, 2, 3]));
    expect(r.fork('a').next()).not.toBe(r.fork('b').next());
    expect(createRng(3).fork('a').next()).toBe(createRng(3).fork('a').next());
  });
  it('noise is bounded, continuous, and seeded', () => {
    for (let i = 0; i < 400; i++) {
      const x = i * 0.37 - 50, z = i * 0.11 + 3;
      const v = fbm2(x, z, 5);
      expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(valueNoise2(x, z, 5) - valueNoise2(x + 1e-4, z, 5))).toBeLessThan(1e-2);
    }
    expect(fbm2(1.5, 2.5, 1)).not.toBe(fbm2(1.5, 2.5, 2));
    expect(fbm2(1.5, 2.5, 1)).toBe(fbm2(1.5, 2.5, 1));
  });
});

describe('guards', () => {
  it('a throwing subsystem is contained and counted', () => {
    const orig = console.error;
    console.error = () => {};
    try {
      const before = guardStats.errors.get('boom') || 0;
      const g = guarded('boom', () => { throw new Error('nope'); });
      expect(() => g()).not.toThrow();
      expect(g()).toBeUndefined();
      expect(guardStats.errors.get('boom')).toBe(before + 2);
      expect(guardStats.last.label).toBe('boom');
      expect(guarded('fine', (a, b) => a + b)(2, 3)).toBe(5);
    } finally { console.error = orig; }
  });
  it('fin and allFinite reject NaN, Infinity, and non-numbers', () => {
    expect(fin(NaN, 4)).toBe(4);
    expect(fin(Infinity)).toBe(0);
    expect(fin('3', 9)).toBe(9);
    expect(fin(2.5)).toBe(2.5);
    expect(allFinite(1, 2, 3)).toBe(true);
    expect(allFinite(1, NaN)).toBe(false);
    expect(allFinite(1, undefined)).toBe(false);
  });
  it('gradient helpers refuse non-finite geometry instead of throwing', () => {
    const calls = [];
    const ctx = {
      createLinearGradient: (...a) => { if (!a.every(Number.isFinite)) throw new TypeError('non-finite'); return { addColorStop: (o, c) => calls.push([o, c]) }; },
      createRadialGradient: (...a) => { if (!a.every(Number.isFinite)) throw new TypeError('non-finite'); return { addColorStop: (o, c) => calls.push([o, c]) }; },
    };
    expect(safeLinearGradient(ctx, 0, 0, NaN, 10, [[0, '#000']])).toBe(null);
    expect(safeRadialGradient(ctx, 0, 0, 1, 0, 0, Infinity, [[0, '#000']])).toBe(null);
    expect(safeRadialGradient(ctx, 0, 0, -1, 0, 0, 5, [[0, '#000']])).toBe(null);
    expect(safeLinearGradient(ctx, 0, 0, 10, 10, [[0, '#000'], [NaN, '#111'], [7, '#fff']])).not.toBe(null);
    expect(calls).toEqual([[0, '#000'], [1, '#fff']]);
  });
});

describe('math', () => {
  it('basic helpers', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(lerp(2, 4, 0.5)).toBe(3);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(2, 2, 3)).toBe(1);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 10);
    expect(Math.abs(wrapAngle(-7))).toBeLessThanOrEqual(Math.PI);
  });
});

describe('course and preset registries', () => {
  it('every course is 18 holes, par 72, with a unique id and name', () => {
    expect(COURSES.length).toBe(5);
    for (const c of COURSES) {
      expect(c.pars.length).toBe(18);
      expect(coursePar(c)).toBe(72);
      expect(c.pars.filter((p) => p === 3).length).toBe(4);
      expect(c.pars.filter((p) => p === 5).length).toBe(4);
    }
    expect(new Set(COURSES.map((c) => c.id)).size).toBe(5);
    expect(new Set(COURSES.map((c) => c.name)).size).toBe(5);
    expect(COURSES.filter((c) => c.flagship).map((c) => c.id)).toEqual(['parkland', 'links', 'desert']);
    expect(courseById('nope').id).toBe('parkland');
  });
  it('has the six presets with sane values and bands', () => {
    expect(TOD_ORDER).toEqual(['dawn', 'morning', 'midday', 'golden', 'dusk', 'night']);
    for (const id of TOD_ORDER) {
      const t = TOD[id];
      expect(t.sunElev).toBeGreaterThan(0);
      expect(t.exposure[0]).toBeLessThan(t.exposure[1]);
      const b = bandFor(id);
      expect(t.targetLuma).toBeGreaterThanOrEqual(b.min);
      expect(t.targetLuma).toBeLessThanOrEqual(b.max);
    }
    expect(bandFor('midday')).toMatchObject({ min: 140, max: 160, maxClippedPct: 2 });
    expect(bandFor('night').max).toBeLessThan(100);
  });
});

describe('exposure meter math', () => {
  // The controller multiplies exposure by clamp(target / max(luma, 1)) each step. From a black
  // frame it must keep climbing (the bug the gate caught was a bail-out below luma 0.5).
  const step = (target, luma, lo = 0.4, hi = 2.5) => Math.min(hi, Math.max(lo, target / Math.max(luma, 1)));
  it('a black frame still raises exposure at the maximum rate', () => {
    expect(step(62, 0.1)).toBe(2.5);
    expect(step(150, 0)).toBe(2.5);
  });
  it('a blown-out frame lowers it, and a frame on target leaves it alone', () => {
    expect(step(150, 255)).toBeLessThan(1);
    expect(step(150, 150)).toBe(1);
    expect(Number.isFinite(step(150, NaN))).toBe(false);
  });
});
