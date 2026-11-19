// Shot types (src/data/shotTypes.js): Normal is the unchanged Full shot; apex, carry and roll
// order the way each type promises; clubs and lies restrict them; every multiplier is capped;
// and the computer players pick them sensibly.
import { describe, it, expect } from 'vitest';
import { CLUBS } from '../src/physics/clubs.js';
import { computeLaunch, SHOT_TYPES, BASE_PROFILE, nominalCarry } from '../src/physics/shot.js';
import { simulateShot, flatEnv } from '../src/physics/ball.js';
import { SURFACES as S } from '../src/physics/surfaces.js';
import { SHOT_DATA, shotData, shotFitsData, shotPower, SPLASH_RANGE } from '../src/data/shotTypes.js';
import { aiPlan } from '../src/game/planner.js';
import { buildTerrain } from '../src/course/terrain.js';
import { getHole } from '../src/course/layout.js';
import { courseById } from '../src/course/courses.js';
import { shotUnlocked, newGolfer } from '../src/game/campaign.js';

const env = flatEnv();
const fly = (id, shotId) => {
  const club = CLUBS.find((c) => c.id === id), s = shotData(shotId);
  return simulateShot(computeLaunch({ power: s.power[1], face: 0, path: 0, tempoQuality: 1 }, { club, shotType: s, lie: S.FAIRWAY, aim: 0, x: 0, z: 0, profile: BASE_PROFILE }), env);
};
const roll = (r) => r.total - r.carry;

describe('shot types', () => {
  it('Normal is the physics Full shot, unchanged', () => {
    const n = shotData('full');
    expect([n.speed, n.launch, n.spin]).toEqual([SHOT_TYPES.FULL.speed, SHOT_TYPES.FULL.launch, SHOT_TYPES.FULL.spin]);
    expect(n.mishit).toBe(1); expect(n.power).toEqual([0, 1]);
    for (const c of CLUBS.filter((x) => !x.putter)) expect(nominalCarry(c, BASE_PROFILE, n)).toBe(nominalCarry(c, BASE_PROFILE, SHOT_TYPES.FULL));
    expect(shotData('nonsense')).toBe(n);
  });
  it('has the ten types the brief lists, every multiplier inside its cap', () => {
    expect(SHOT_DATA.map((s) => s.id)).toEqual(['full', 'stinger', 'knockdown', 'punch', 'high', 'flop', 'pitch', 'chip', 'bump', 'splash']);
    for (const s of SHOT_DATA) {
      for (const k of ['speed', 'launch', 'spin']) { expect(s[k]).toBeGreaterThanOrEqual(0.3); expect(s[k]).toBeLessThanOrEqual(1.5); }
      expect(s.speed).toBeLessThanOrEqual(1);
      expect(s.mishit).toBeGreaterThanOrEqual(0.5); expect(s.mishit).toBeLessThanOrEqual(2);
      expect(s.power[0]).toBeGreaterThanOrEqual(0); expect(s.power[1]).toBeLessThanOrEqual(1); expect(s.power[0]).toBeLessThan(s.power[1]);
      expect(['more', 'normal', 'less']).toContain(s.roll);
      expect(s.text.length).toBeGreaterThan(8); expect(s.text).not.toMatch(/—/);
    }
  });
  it('apex orders: Stinger and Knockdown under Normal under High; Flop over Pitch over Chip', () => {
    expect(fly('I5', 'stinger').apex).toBeLessThan(fly('I5', 'full').apex);
    expect(fly('DR', 'stinger').apex).toBeLessThan(fly('DR', 'full').apex * 0.6);
    expect(fly('I7', 'knockdown').apex).toBeLessThan(fly('I7', 'full').apex);
    expect(fly('I7', 'high').apex).toBeGreaterThan(fly('I7', 'full').apex);
    expect(fly('I7', 'punch').apex).toBeLessThan(fly('I7', 'knockdown').apex);
    expect(fly('SW', 'flop').apex).toBeGreaterThan(fly('SW', 'pitch').apex);
    expect(fly('SW', 'pitch').apex).toBeGreaterThan(fly('SW', 'chip').apex);
  });
  it('carry orders: Normal longest from a club; Knockdown and High a little shorter; the short game much shorter', () => {
    const n = fly('I7', 'full').carry;
    for (const id of ['knockdown', 'high', 'punch', 'chip', 'bump']) expect(fly('I7', id).carry).toBeLessThan(n);
    expect(fly('I7', 'high').carry).toBeGreaterThan(fly('I7', 'knockdown').carry);
    expect(fly('SW', 'pitch').carry).toBeGreaterThan(fly('SW', 'chip').carry);
    expect(fly('SW', 'flop').carry).toBeLessThan(fly('SW', 'full').carry);
  });
  it('roll behaves as stated against Normal from the same club', () => {
    for (const s of SHOT_DATA) {
      if (s.id === 'full') continue;
      const id = ['I7', 'I5', 'PW', 'SW', 'DR'].find((c) => s.clubs.includes(c));
      const r = roll(fly(id, s.id)), n = roll(fly(id, 'full'));
      if (s.roll === 'more') expect(r).toBeGreaterThan(n);
      if (s.roll === 'less') expect(r).toBeLessThanOrEqual(n + 0.5);
      if (s.roll === 'normal') expect(Math.abs(r - n)).toBeLessThanOrEqual(Math.max(2, n * 0.5));
    }
    expect(roll(fly('I7', 'bump'))).toBeGreaterThan(roll(fly('I7', 'chip')));
  });
  it('restrictions: clubs and lies', () => {
    const flop = shotData('flop'), stinger = shotData('stinger'), splash = shotData('splash'), knock = shotData('knockdown');
    expect(flop.clubs).toEqual(['SW', 'LW']);
    expect(shotFitsData(flop, 'SW', S.FAIRWAY)).toBe(true);
    for (const l of [S.DEEP_ROUGH, S.BUNKER, S.DIRT, S.WASTE]) expect(shotFitsData(flop, 'SW', l)).toBe(false);
    expect(shotFitsData(flop, 'PW', S.FAIRWAY)).toBe(false);
    expect(shotFitsData(stinger, 'DR', S.TEE)).toBe(true);
    expect(shotFitsData(stinger, 'I7', S.FAIRWAY)).toBe(false);
    expect(shotFitsData(stinger, 'W3', S.ROUGH)).toBe(false);
    expect(shotFitsData(splash, 'SW', S.BUNKER)).toBe(true);
    expect(shotFitsData(splash, 'SW', S.FAIRWAY)).toBe(false);
    expect(shotFitsData(splash, 'I7', S.BUNKER)).toBe(false);
    expect(shotPower(knock, 1)).toBe(0.85);
    expect(shotPower(stinger, 0.2)).toBe(0.6);
    expect(shotPower(shotData('full'), 0.42)).toBe(0.42);
    // Normal can be played from every lie but the green and water.
    for (const l of Object.values(S)) if (l !== S.GREEN && l !== S.WATER) expect(shotFitsData(shotData('full'), 'I7', l)).toBe(true);
  });
  it('Campaign unlocks come through the existing skill tree; base shots are always there', () => {
    const g = newGolfer('sharp');
    for (const id of ['full', 'chip', 'pitch', 'splash', 'putt']) expect(shotUnlocked(g, id)).toBe(true);
    expect(shotUnlocked(g, 'flop')).toBe(false);
    const links = newGolfer('links'); // starts with the punch
    expect(shotUnlocked(links, 'punch')).toBe(true);
    expect(shotUnlocked(links, 'stinger')).toBe(true);
    expect(shotUnlocked(links, 'knockdown')).toBe(true);
  });
  it('the computer players splash from a greenside bunker and pitch from 50 meters', () => {
    const course = courseById('parkland'), t = buildTerrain(course, getHole(course, 2));
    const pin = t.pin;
    const bunk = aiPlan(t, { x: pin.x + 20, z: pin.z + 8 }, S.BUNKER, { shots: true });
    expect(bunk.shotType.id).toBe('splash'); expect(bunk.club.id).toBe('SW');
    expect(aiPlan(t, { x: pin.x + 20, z: pin.z + 8 }, S.BUNKER, {}).shotType.id).not.toBe('splash');
    const far = aiPlan(t, { x: pin.x, z: pin.z + SPLASH_RANGE + 40 }, S.BUNKER, { shots: true });
    expect(far.shotType.id).not.toBe('splash');
    const p = aiPlan(t, { x: pin.x + 30, z: pin.z + 40 }, S.FAIRWAY, { shots: true });
    expect(['pitch', 'chip', 'full']).toContain(p.shotType.id);
  });
});
