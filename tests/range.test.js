import { describe, it, expect } from 'vitest';
import { YARD } from '../src/core/math.js';
import { generateRange, TARGETS, SIGN_YARDS, BAY_X, bayBall, targetFor, RANGE_COURSE } from '../src/course/range.js';
import {
  createSession, addShot, currentTarget, ballsLeft, targetPoints, medalFor, dispersion, clubAverages, sessionResult, recordSession,
  MODES, LADDER, SHAPES, MEDALS, clubAverageCarry,
} from '../src/game/range.js';

const hole = generateRange();
const shot = (o = {}) => ({ club: 'I7', carry: 160, total: 168, offline: 0, curve: 0, ballSpeed: 115, launch: 17, spin: 6800, apex: 28, strike: { kind: 'good' }, land: { x: 0, z: -146 }, rest: { x: 0, z: -153 }, target: null, ...o });
const tgt = (yards) => { const t = hole.targets.find((x) => x.yards === yards); return { yards, x: t.x, z: t.z, r: t.radius }; };

describe('range layout', () => {
  it('has five bays, signs every 25 yd to 300, targets at 75 to 275', () => {
    expect(BAY_X.length).toBe(5);
    expect(SIGN_YARDS[0]).toBe(25); expect(SIGN_YARDS[SIGN_YARDS.length - 1]).toBe(300); expect(SIGN_YARDS.length).toBe(12);
    expect(TARGETS.map((t) => t.yards)).toEqual([75, 125, 175, 225, 275]);
    for (const t of hole.targets) expect(-t.z / YARD).toBeCloseTo(t.yards, 6);
    expect(hole.range).toBe(true);
    expect(RANGE_COURSE.range).toBe(true);
  });
  it('is a valid hole shape the terrain builder can read', () => {
    for (const k of ['line', 'half', 'tees', 'green', 'pins', 'bounds', 'path', 'bunkers', 'water', 'markers', 'seed', 'lineStep', 'corridorExtra', 'roughBand']) expect(hole[k]).toBeDefined();
    expect(hole.half.length).toBe(hole.line.length);
    expect(hole.length / YARD).toBeCloseTo(360, 0);
    expect(hole.bounds.minZ).toBeLessThan(-hole.length);
  });
  it('places balls on mats and grass and picks a target by carry', () => {
    expect(bayBall(hole, 0, 'mat').x).toBe(BAY_X[0]);
    expect(bayBall(hole, 9, 'grass').x).toBe(BAY_X[4]);
    expect(bayBall(hole, 2, 'grass').z).toBeLessThan(bayBall(hole, 2, 'mat').z);
    expect(targetFor(hole, 160 * YARD).yards).toBe(175);
    expect(targetFor(hole, 60 * YARD).yards).toBe(75);
  });
});

describe('range sessions', () => {
  it('a 50-ball bucket ends after 50; unlimited never does', () => {
    let s = createSession({ mode: 'free' });
    for (let i = 0; i < 50; i++) s = addShot(s, shot()).session;
    expect(s.over).toBe(true); expect(ballsLeft(s)).toBe(0);
    let u = createSession({ mode: 'free', bucket: null });
    for (let i = 0; i < 120; i++) u = addShot(u, shot()).session;
    expect(u.over).toBe(false); expect(ballsLeft(u)).toBe(null);
  });
  it('target points: two balls per target, points by distance', () => {
    expect(targetPoints(2, true)).toBe(110); expect(targetPoints(30, false)).toBe(0);
    let s = createSession({ mode: 'target' });
    const seen = [];
    for (let i = 0; i < 10; i++) {
      const y = currentTarget(s); seen.push(y);
      const t = tgt(y);
      s = addShot(s, shot({ target: t, land: { x: t.x + 2 * YARD, z: t.z }, rest: { x: t.x + 30, z: t.z - 30 } })).session;
    }
    expect(seen).toEqual([75, 75, 125, 125, 175, 175, 225, 225, 275, 275]);
    expect(s.score).toBe(1100); expect(s.over).toBe(true);
    expect(medalFor('target', s.score)).toBe('gold');
  });
  it('long drive keeps the best total inside the grid', () => {
    let s = createSession({ mode: 'longdrive' });
    s = addShot(s, shot({ club: 'DR', total: 280, offline: 35 })).session;
    expect(s.score).toBe(0);
    s = addShot(s, shot({ club: 'DR', total: 262, offline: -12 })).session;
    s = addShot(s, shot({ club: 'DR', total: 251, offline: 2 })).session;
    expect(s.score).toBe(262);
  });
  it('the wedge ladder advances only within 5 yards', () => {
    let s = createSession({ mode: 'ladder' });
    s = addShot(s, shot({ carry: 57 })).session; expect(s.step).toBe(0);
    for (const y of LADDER) s = addShot(s, shot({ carry: y + 3 })).session;
    expect(s.score).toBe(6); expect(s.over).toBe(true);
  });
  it('shape shots read the curve (mirrored for left-handers)', () => {
    let s = createSession({ mode: 'shape' });
    const curveFor = { draw: -8, fade: 8, straight: 0 };
    for (const want of SHAPES) s = addShot(s, shot({ curve: curveFor[want], offline: 4 })).session;
    expect(s.score).toBe(6);
    let l = createSession({ mode: 'shape' });
    l = addShot(l, shot({ curve: 8, lefty: true, offline: 0 })).session;
    expect(l.score).toBe(1); // a left-hander's draw curves right
  });
  it('pressure streak ends on the first miss and uses the chosen target', () => {
    expect(currentTarget(createSession({ mode: 'streak' }))).toBe(125);
    expect(currentTarget(createSession({ mode: 'streak', target: 225 }))).toBe(225);
    let s = createSession({ mode: 'streak' });
    const t = tgt(125);
    for (let i = 0; i < 4; i++) s = addShot(s, shot({ target: t, land: { x: t.x, z: t.z } })).session;
    s = addShot(s, shot({ target: t, land: { x: t.x + 40, z: t.z } })).session;
    expect(s.score).toBe(4); expect(s.over).toBe(true);
    expect(addShot(s, shot()).session).toBe(s);
  });
});

describe('range numbers', () => {
  it('dispersion ellipse: center, axes and orientation', () => {
    const pts = [];
    for (let i = 0; i < 400; i++) { const a = (i / 400) * Math.PI * 2; pts.push({ x: 10 + Math.cos(a) * 4, y: 150 + Math.sin(a) * 12 }); }
    const e = dispersion(pts, 1);
    expect(e.x).toBeCloseTo(10, 5); expect(e.y).toBeCloseTo(150, 5);
    expect(e.a).toBeGreaterThan(e.b);
    expect(Math.abs(Math.cos(e.angle))).toBeLessThan(0.01); // major axis along y
    expect(dispersion(pts.slice(0, 2))).toBe(null);
    const flat = dispersion([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
    expect(Number.isFinite(flat.a) && Number.isFinite(flat.angle)).toBe(true);
  });
  it('club averages and the session record', () => {
    const shots = [shot({ club: 'I7', carry: 150, offline: 4, strike: { kind: 'pured' } }), shot({ club: 'I7', carry: 160, offline: -6, strike: { kind: 'thin' } }), shot({ club: 'DR', carry: 240 })];
    const av = clubAverages(shots);
    const i7 = av.find((a) => a.club === 'I7');
    expect(i7.carry).toBe(155); expect(i7.offline).toBe(-1); expect(i7.absOffline).toBe(5); expect(i7.pured).toBe(1); expect(i7.mishits).toBe(1);
    let s = createSession({ mode: 'streak' });
    const t = tgt(75);
    for (let i = 0; i < 11; i++) s = addShot(s, shot({ target: t, land: { x: t.x, z: t.z } })).session;
    const res = sessionResult(s, { dayKey: '2026-11-18', goldToday: {} });
    expect(res.medal).toBe('gold'); expect(res.tokens).toBe(1); expect(res.xp).toBeGreaterThan(0);
    const again = sessionResult(s, { dayKey: '2026-11-18', goldToday: { streak: '2026-11-18' } });
    expect(again.tokens).toBe(0);
    const rec = recordSession(null, s, res, '2026-11-18');
    expect(rec.best.streak).toBe(11); expect(rec.medals.streak).toBe('gold'); expect(rec.goldDay.streak).toBe('2026-11-18');
    expect(clubAverageCarry(rec, 'I7')).toBe(160);
  });
  it('every drill has medals in rising order', () => {
    for (const m of ['target', 'longdrive', 'ladder', 'shape', 'streak']) { const t = MEDALS[m]; expect(t.bronze < t.silver && t.silver < t.gold).toBe(true); }
    expect(Object.keys(MODES).filter((m) => !MEDALS[m])).toEqual(['free', 'test']);
  });
});

describe('club test lane', () => {
  it('reports the second club for the same swing and gives no medal', () => {
    let s = createSession({ mode: 'test' });
    const r = addShot(s, shot({ compare: { rarity: 'legendary', carry: 172, total: 178, offline: -3, strike: { kind: 'pured' } } }));
    expect(r.message).toMatch(/Legendary: carry 172 yd \(\+12\)/);
    s = r.session;
    const res = sessionResult(s, { dayKey: 'd' });
    expect(res.medal).toBe('none'); expect(res.tokens).toBe(0);
    expect(recordSession(null, s, res, 'd').best.test).toBeUndefined();
  });
});
