// Community holes (src/game/level.js): the strict loader (with a fuzz test), templates, par,
// the publish checks, auto-decorate, and that a level is built by the same hole and terrain
// builders as the built-in holes, with its pieces where they were placed.
import { describe, it, expect } from 'vitest';
import {
  parseLevel, serializeLevel, levelBytes, levelPar, levelYards, levelProblems, nameProblem, TEMPLATES, templateById,
  blankLevel, randomLevel, autoDecorate, levelCourse, LEVEL_CAPS, LEVEL_AREA, LEVEL_VERSION,
} from '../src/game/level.js';
import { courseById, registerCourse } from '../src/course/courses.js';
import { generateHole, getHole, greenSdf } from '../src/course/layout.js';
import { buildTerrain } from '../src/course/terrain.js';
import { SURFACES } from '../src/physics/surfaces.js';
import { createRng } from '../src/core/rng.js';
import { createRound, validateRound } from '../src/game/round.js';
import { simulateShot } from '../src/physics/ball.js';
import { computeLaunch, BASE_PROFILE } from '../src/physics/shot.js';
import { CLUBS } from '../src/physics/clubs.js';

const build = (lv) => { const c = registerCourse(levelCourse(lv, courseById(lv.theme))); const h = generateHole(c, 0); return { c, h, t: buildTerrain(c, h) }; };

describe('the level format and loader', () => {
  it('round-trips and is compact', () => {
    for (const t of TEMPLATES) {
      const lv = t.make();
      const again = parseLevel(serializeLevel(lv));
      expect(again.ok).toBe(true);
      expect(again.level).toEqual(lv);
      expect(levelBytes(lv)).toBeLessThan(2000);
      expect(lv.v).toBe(LEVEL_VERSION);
    }
  });
  it('refuses unknown fields, clamps coordinates, and caps hazards and trees', () => {
    const lv = TEMPLATES[0].make();
    expect(parseLevel({ ...lv, extra: 1 }).ok).toBe(false);
    expect(parseLevel({ ...lv, v: 2 }).ok).toBe(false);
    const far = parseLevel({ ...lv, pin: [99999, -99999], tee: [-1e9, 1e9] }).level;
    expect(far.pin).toEqual([LEVEL_AREA.maxX, LEVEL_AREA.minZ]);
    expect(far.tee).toEqual([LEVEL_AREA.minX, LEVEL_AREA.maxZ]);
    const many = parseLevel({ ...lv, bunkers: Array.from({ length: 30 }, () => [0, -50, 4]), water: Array.from({ length: 30 }, () => [0, -80, 9]), trees: Array.from({ length: 900 }, () => [20, -40]) }).level;
    expect(many.bunkers.length + many.water.length + many.rough.length + many.hills.length).toBe(LEVEL_CAPS.hazards);
    expect(many.trees.length).toBe(LEVEL_CAPS.trees);
    expect(parseLevel({ ...lv, green: 999 }).level.green).toBe(20);
  });
  it('fuzz: 4000 kinds of garbage never throw and never produce bad numbers', () => {
    const rng = createRng(2026);
    const junkValue = (d = 0) => {
      const k = rng.int(0, 11);
      if (k === 0) return null; if (k === 1) return undefined; if (k === 2) return NaN; if (k === 3) return Infinity;
      if (k === 4) return 'x'.repeat(rng.int(0, 40)); if (k === 5) return rng.range(-1e12, 1e12); if (k === 6) return true;
      if (k === 7 && d < 3) return Array.from({ length: rng.int(0, 6) }, () => junkValue(d + 1));
      if (k === 8 && d < 3) return { a: junkValue(d + 1), v: 1 };
      if (k === 9) return [rng.range(-500, 500), rng.range(-800, 100), rng.range(-5, 60), rng.range(-9, 9)];
      if (k === 10) return Symbol.for('s').toString();
      return rng.int(-5, 5);
    };
    const keys = ['v', 'name', 'theme', 'seed', 'tee', 'pin', 'bend', 'green', 'bunkers', 'water', 'rough', 'hills', 'trees'];
    for (let i = 0; i < 4000; i++) {
      let input;
      const mode = i % 5;
      if (mode === 0) input = junkValue();
      else if (mode === 1) input = String(junkValue()) + '{"v":1';
      else {
        input = { v: rng.chance(0.8) ? 1 : junkValue() };
        for (const k of keys) if (rng.chance(0.85)) input[k] = junkValue();
        if (mode === 3) { input.tee = [0, 0]; input.pin = [rng.range(-300, 300), rng.range(-900, 50)]; }
        if (mode === 4) input = JSON.stringify(input);
      }
      let r;
      expect(() => { r = parseLevel(input); }).not.toThrow();
      expect(typeof r.ok).toBe('boolean');
      if (r.ok) {
        const nums = [];
        const walk = (v) => { if (typeof v === 'number') nums.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); else expect(['string', 'number']).toContain(typeof v); };
        walk(r.level);
        for (const n of nums) expect(Number.isFinite(n)).toBe(true);
        expect(typeof r.level.name).toBe('string');
        expect(Object.keys(r.level).sort()).toEqual(keys.slice().sort());
        expect(levelBytes(r.level)).toBeLessThan(LEVEL_CAPS.bytes + 1);
      } else expect(r.error.length).toBeGreaterThan(5);
    }
  });
});

describe('templates, par and checks', () => {
  it('six templates plus random and blank, each playable', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['par3water', 'dogleg4', 'long5', 'links', 'desert', 'alpine']);
    expect(levelPar(templateById('par3water').make())).toBe(3);
    expect(levelPar(templateById('dogleg4').make())).toBe(4);
    expect(levelPar(templateById('long5').make())).toBe(5);
    expect(templateById('par3water').make().water.length).toBeGreaterThan(0);
    for (const t of TEMPLATES) expect(levelProblems(t.make())).toEqual([]);
    for (let s = 1; s < 40; s++) expect(levelProblems(randomLevel(s))).toEqual([]);
    expect(levelProblems(blankLevel())).toEqual([]);
  });
  it('par follows the distance', () => {
    const lv = blankLevel();
    expect(levelPar({ ...lv, pin: [0, -200] })).toBe(3);
    expect(levelPar({ ...lv, pin: [0, -300] })).toBe(4);
    expect(levelPar({ ...lv, pin: [0, -500] })).toBe(5);
    expect(levelYards({ ...lv, pin: [0, -91.44] })).toBe(100);
  });
  it('plain messages for broken holes', () => {
    const lv = TEMPLATES[0].make();
    expect(levelProblems({ ...lv, water: [[lv.pin[0], lv.pin[1], 10]] })).toContain('The pin is in the water.');
    expect(levelProblems({ ...lv, water: [[0, 0, 8]] })).toContain('The tee is in the water.');
    expect(levelProblems({ ...lv, pin: [0, -30] })[0]).toMatch(/too short/);
    expect(levelProblems({ ...lv, bunkers: [[lv.pin[0], lv.pin[1], 6]] })).toContain('A bunker covers the green.');
    expect(nameProblem('ok')).toMatch(/at least 3/);
    expect(nameProblem('Sh1t Hole')).toMatch(/different name/);
    expect(nameProblem('Sunny Dell')).toBe(null);
  });
  it('auto-decorate adds trees and rough clear of the green, tee and water, inside the caps', () => {
    const lv = templateById('dogleg4').make();
    const d = autoDecorate(lv, 5);
    expect(d.trees.length).toBeGreaterThan(20);
    expect(d.rough.length).toBeGreaterThan(0);
    for (const t of d.trees) {
      expect(Math.hypot(t[0] - d.pin[0], t[1] - d.pin[1])).toBeGreaterThan(d.green + 10);
      for (const w of d.water) expect(Math.hypot(t[0] - w[0], t[1] - w[1])).toBeGreaterThan(w[2]);
    }
    expect(levelProblems(d)).toEqual([]);
    let big = d;
    for (let i = 0; i < 20; i++) big = autoDecorate(big, i);
    expect(big.trees.length).toBeLessThanOrEqual(LEVEL_CAPS.trees);
  });
});

describe('levels are built by the same builders', () => {
  it('the hole and terrain come out of generateHole and buildTerrain, with the pieces placed', () => {
    for (const t of TEMPLATES) {
      const lv = autoDecorate(t.make(), 3);
      const { c, h, t: terr } = build(lv);
      expect(h.par).toBe(levelPar(lv));
      expect(Math.abs(h.yards - levelYards(lv))).toBeLessThan(12);
      expect(h.green.radius).toBe(lv.green);
      // The cup is on the green, and the terrain agrees with the physics surface there.
      expect(terr.surfaceAt(terr.pin.x, terr.pin.z)).toBe(SURFACES.GREEN);
      expect(greenSdf(h.green, terr.pin.x, terr.pin.z)).toBeLessThan(0);
      expect(terr.surfaceAt(terr.tee.x, terr.tee.z)).toBe(SURFACES.TEE);
      // Ponds are water and bunkers are sand where they were placed.
      for (const w of h.water) expect(terr.surfaceAt(w.blobs[0].x, w.blobs[0].z)).toBe(SURFACES.WATER);
      for (const b of h.bunkers) expect(terr.surfaceAt(b.blobs[0].x, b.blobs[0].z)).toBe(SURFACES.BUNKER);
      // Trees grow where they were placed.
      if (h.levelTrees.length) expect(Math.max(...h.levelTrees.map((p) => terr.treeDensityAt(p.x, p.z)))).toBeGreaterThan(0.5);
      expect(getHole(c, 0)).toBe(getHole(c, 0));
      // A real shot flies on it.
      const launch = computeLaunch({ power: 0.8, face: 0, path: 0, tempoQuality: 1 }, { club: CLUBS[6], lie: SURFACES.TEE, aim: terr.tee.heading, x: terr.tee.x, z: terr.tee.z, profile: BASE_PROFILE });
      const r = simulateShot(launch, terr.env());
      expect(Number.isFinite(r.total)).toBe(true);
    }
  });
  it('rough patches play as rough and hills raise the ground', () => {
    const lv = { ...blankLevel(), rough: [[0, -150, 12]], hills: [[30, -220, 20, 5]] };
    const { h, t } = build(lv);
    expect(t.surfaceAt(h.levelRough[0].x, h.levelRough[0].z)).toBe(SURFACES.ROUGH);
    const flat = build(blankLevel()).t;
    expect(t.heightAt(h.levelHills[0].x, h.levelHills[0].z) - flat.heightAt(h.levelHills[0].x, h.levelHills[0].z)).toBeGreaterThan(3);
  });
  it('a level round is a valid round while its course is registered', () => {
    const lv = TEMPLATES[1].make();
    const c = registerCourse(levelCourse(lv, courseById(lv.theme)));
    const r = createRound({ courseId: c.id, mode: 'stroke', holes: [0], players: [{ name: 'A' }] });
    expect(r.courseId).toBe(c.id);
    expect(validateRound(r).ok).toBe(true);
  });
});
