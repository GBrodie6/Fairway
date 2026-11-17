import { describe, it, expect } from 'vitest';
import { computeLaunch, dispersion, suggestClub, nominalCarry, powerToSpeedFactor, puttSpeed, puttPowerForSpeed, BASE_PROFILE, SHOT_TYPES, MAX_PUTT_SPEED } from '../src/physics/shot.js';
import { CLUBS, CLUB_BY_ID, PUTTER } from '../src/physics/clubs.js';
import { simulateShot, flatEnv } from '../src/physics/ball.js';
import { SURFACES } from '../src/physics/surfaces.js';
import { YARD, DEG } from '../src/core/math.js';

const clean = { power: 1, face: 0, path: 0, tempoQuality: 1 };
const ctx = (club, extra = {}) => ({ club, lie: SURFACES.FAIRWAY, aim: 0, x: 0, z: 0, ...extra });

describe('swing math', () => {
  it('a clean full swing from a clean lie reproduces the carry ladder within 0.2 yd', () => {
    for (const c of CLUBS.filter((k) => !k.putter)) {
      const r = simulateShot(computeLaunch(clean, ctx(c)), flatEnv());
      expect(Math.abs(r.carry / YARD - c.carry)).toBeLessThan(0.2);
    }
  });
  it('power scales ball speed monotonically', () => {
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const s = computeLaunch({ ...clean, power: p }, ctx(CLUBS[6])).speed;
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
    expect(powerToSpeedFactor(1)).toBeCloseTo(1, 10);
    expect(powerToSpeedFactor(-3)).toBeCloseTo(0.12, 10);
    expect(powerToSpeedFactor(9)).toBeLessThanOrEqual(1.08);
  });
  it('open face starts right and curves right, closed face the opposite', () => {
    const open = computeLaunch({ ...clean, face: 3 }, ctx(CLUBS[0]));
    const closed = computeLaunch({ ...clean, face: -3 }, ctx(CLUBS[0]));
    expect(open.heading).toBeGreaterThan(0);
    expect(open.axisTilt).toBeGreaterThan(0);
    expect(closed.heading).toBeCloseTo(-open.heading, 10);
    expect(closed.axisTilt).toBeCloseTo(-open.axisTilt, 10);
    expect(simulateShot(open, flatEnv()).carryPoint.x).toBeGreaterThan(10);
  });
  it('face equal to path is a straight push with no curve', () => {
    const l = computeLaunch({ ...clean, face: 3, path: 3 }, ctx(CLUBS[4]));
    expect(l.axisTilt).toBeCloseTo(0, 10);
    expect(l.heading).toBeCloseTo(3 * DEG, 10);
  });
  it('in-to-out path with a square face draws (curves left)', () => {
    const l = computeLaunch({ ...clean, face: 0, path: 4 }, ctx(CLUBS[0]));
    expect(l.heading).toBeGreaterThan(0);
    expect(l.axisTilt).toBeLessThan(0);
  });
  it('axis tilt is capped', () => {
    const l = computeLaunch({ ...clean, face: 50, path: -50 }, ctx(CLUBS[0]));
    expect(Math.abs(l.axisTilt)).toBeLessThanOrEqual(35 * DEG + 1e-9);
  });
  it('poor tempo costs distance and accuracy', () => {
    const good = computeLaunch({ ...clean, face: 2 }, ctx(CLUBS[0]));
    const bad = computeLaunch({ ...clean, face: 2, tempoQuality: 0 }, ctx(CLUBS[0]));
    expect(bad.speed).toBeLessThan(good.speed);
    expect(bad.speed).toBeGreaterThan(good.speed * 0.9);
    expect(bad.heading).toBeGreaterThan(good.heading);
  });
  it('lies cost speed in order: fairway, first cut, rough, bunker, deep rough', () => {
    const order = [SURFACES.FAIRWAY, SURFACES.FIRST_CUT, SURFACES.ROUGH, SURFACES.BUNKER, SURFACES.DEEP_ROUGH];
    const speeds = order.map((lie) => computeLaunch(clean, ctx(CLUB_BY_ID.I7, { lie })).speed);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThan(speeds[i - 1]);
  });
  it('lieRoll varies the result only on imperfect lies and stays bounded', () => {
    const a = computeLaunch(clean, ctx(CLUB_BY_ID.I7, { lie: SURFACES.FAIRWAY, lieRoll: 1 }));
    const b = computeLaunch(clean, ctx(CLUB_BY_ID.I7, { lie: SURFACES.FAIRWAY, lieRoll: -1 }));
    expect(a.speed).toBe(b.speed);
    const c = computeLaunch(clean, ctx(CLUB_BY_ID.I7, { lie: SURFACES.ROUGH, lieRoll: 1 }));
    const d = computeLaunch(clean, ctx(CLUB_BY_ID.I7, { lie: SURFACES.ROUGH, lieRoll: -1 }));
    expect(c.speed).toBeLessThan(d.speed);
    const e = computeLaunch(clean, ctx(CLUB_BY_ID.I7, { lie: SURFACES.ROUGH, lieRoll: 99 }));
    expect(e.speed).toBe(c.speed);
  });
  it('shot types shape the launch', () => {
    const fullL = computeLaunch(clean, ctx(CLUB_BY_ID.SW));
    const punch = computeLaunch(clean, ctx(CLUB_BY_ID.SW, { shotType: SHOT_TYPES.PUNCH }));
    const flop = computeLaunch(clean, ctx(CLUB_BY_ID.SW, { shotType: SHOT_TYPES.FLOP }));
    const chip = computeLaunch(clean, ctx(CLUB_BY_ID.SW, { shotType: SHOT_TYPES.CHIP }));
    expect(punch.vAngle).toBeLessThan(fullL.vAngle);
    expect(flop.vAngle).toBeGreaterThan(fullL.vAngle);
    expect(chip.speed).toBeLessThan(fullL.speed * 0.5);
    const rf = simulateShot(fullL, flatEnv()), rp = simulateShot(punch, flatEnv());
    expect(rp.apex).toBeLessThan(rf.apex * 0.7);
  });
  it('all launch values are finite for extreme inputs', () => {
    for (const power of [-1, 0, 0.5, 1, 5]) for (const face of [-90, 0, 90]) for (const tq of [-1, 0, 1, 2]) {
      for (const c of CLUBS) {
        const l = computeLaunch({ power, face, path: -face, tempoQuality: tq }, ctx(c, { lie: SURFACES.DEEP_ROUGH, lieRoll: 1 }));
        expect(Number.isFinite(l.speed + l.vAngle + l.heading + l.spin + l.axisTilt)).toBe(true);
        expect(l.speed).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('putting math', () => {
  it('putt speed is monotone, zero at zero, max at one', () => {
    expect(puttSpeed(0)).toBe(0);
    expect(puttSpeed(1)).toBeCloseTo(MAX_PUTT_SPEED, 10);
    let prev = -1;
    for (let p = 0; p <= 1; p += 0.02) { const v = puttSpeed(p); expect(v).toBeGreaterThan(prev); prev = v; }
  });
  it('puttPowerForSpeed inverts puttSpeed', () => {
    for (let p = 0.02; p <= 1; p += 0.07) expect(puttPowerForSpeed(puttSpeed(p))).toBeCloseTo(p, 6);
  });
  it('putter launch is a roll along the aim with a small face effect', () => {
    const l = computeLaunch({ power: 0.3, face: 4, path: 0, tempoQuality: 1 }, ctx(PUTTER, { lie: SURFACES.GREEN, aim: 0.5 }));
    expect(l.putt).toBe(true);
    expect(l.heading).toBeGreaterThan(0.5);
    expect(l.heading - 0.5).toBeLessThan(3 * DEG);
  });
});

describe('dispersion', () => {
  it('grows with worse lies and with wind', () => {
    const c = CLUB_BY_ID.I7;
    const fw = dispersion(c, SURFACES.FAIRWAY), ro = dispersion(c, SURFACES.ROUGH), dr = dispersion(c, SURFACES.DEEP_ROUGH);
    expect(ro.lateralDeg).toBeGreaterThan(fw.lateralDeg);
    expect(dr.lateralDeg).toBeGreaterThan(ro.lateralDeg);
    expect(dispersion(c, SURFACES.FAIRWAY, { windMps: 8 }).lateralDeg).toBeGreaterThan(fw.lateralDeg);
    expect(dr.distFrac).toBeGreaterThan(fw.distFrac);
  });
  it('woods spray more than wedges', () => {
    expect(dispersion(CLUB_BY_ID.DR, SURFACES.TEE).lateralDeg).toBeGreaterThan(dispersion(CLUB_BY_ID.SW, SURFACES.TEE).lateralDeg);
  });
  it('a better accuracy profile tightens it', () => {
    const p = { ...BASE_PROFILE, accuracy: 0.7 };
    expect(dispersion(CLUB_BY_ID.I5, SURFACES.FAIRWAY, { profile: p }).lateralDeg).toBeLessThan(dispersion(CLUB_BY_ID.I5, SURFACES.FAIRWAY).lateralDeg);
  });
});

describe('club suggestion', () => {
  it('picks the shortest club that covers the distance', () => {
    expect(suggestClub(160 * YARD).club.id).toBe('I7');
    expect(suggestClub(100 * YARD).club.id).toBe('GW');
    expect(suggestClub(60 * YARD).club.id).toBe('LW');
  });
  it('uses the driver only from the tee', () => {
    expect(suggestClub(400 * YARD, { lie: SURFACES.TEE }).club.id).toBe('DR');
    expect(suggestClub(400 * YARD, { lie: SURFACES.FAIRWAY }).club.id).toBe('W3');
  });
  it('avoids woods from deep rough and sand', () => {
    expect(suggestClub(300 * YARD, { lie: SURFACES.DEEP_ROUGH }).club.kind).not.toBe('wood');
    expect(suggestClub(300 * YARD, { lie: SURFACES.BUNKER }).club.kind).not.toBe('wood');
  });
  it('returns the putter on the green', () => {
    expect(suggestClub(5, { onGreen: true }).club.putter).toBe(true);
  });
  it('suggested power lands within 6 percent of the request on a calm flat hole', () => {
    for (const yd of [45, 70, 105, 133, 158, 190, 220]) {
      const s = suggestClub(yd * YARD);
      const l = computeLaunch({ power: s.power, face: 0, path: 0, tempoQuality: 1 }, ctx(s.club));
      const r = simulateShot(l, flatEnv());
      expect(Math.abs(r.carry / YARD - yd) / yd).toBeLessThan(0.06);
    }
  });
  it('nominalCarry matches the ladder and is cached', () => {
    expect(nominalCarry(CLUB_BY_ID.I7) / YARD).toBeCloseTo(163, 0);
    expect(nominalCarry(CLUB_BY_ID.I7)).toBe(nominalCarry(CLUB_BY_ID.I7));
    expect(nominalCarry(PUTTER)).toBe(0);
  });
});
