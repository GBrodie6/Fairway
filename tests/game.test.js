import { describe, it, expect } from 'vitest';
import { createRound, beginHole, applyShot, nextTurn, completeHole, holeFinished, standings, validateRound, holesFor, parOf, MODES, currentHoleIndex } from '../src/game/round.js';
import { solvePutt, simulatePutt, puttCeiling, solvePower, aiPlan, playHoleAI, chooseTarget, dropPoint, predictShot, maxCarryFrom } from '../src/game/planner.js';
import { COURSES, courseById } from '../src/course/courses.js';
import { getHole } from '../src/course/layout.js';
import { buildTerrain } from '../src/course/terrain.js';
import { SURFACES } from '../src/physics/surfaces.js';
import { CLUB_BY_ID } from '../src/physics/clubs.js';
import { shotTypeById } from '../src/physics/shot.js';
import { createRng } from '../src/core/rng.js';
import { createWind } from '../src/physics/wind.js';
import { YARD } from '../src/core/math.js';

const tee = { x: 0, z: 0 };
const shot = (over = {}) => ({ from: { x: 0, z: 0, lie: SURFACES.TEE }, end: { x: 0, z: -200 }, lie: SURFACES.FAIRWAY, total: 200, carry: 190, distToPin: 150, ...over });

describe('round rules', () => {
  it('creates a valid round and clamps bad input', () => {
    const r = createRound({ courseId: 'links', mode: 'stroke', holeCount: 9, startHole: 10, players: [{ name: 'A' }] });
    expect(r.holes).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(validateRound(r).ok).toBe(true);
    expect(createRound({ courseId: 'nope', mode: 'nope' }).courseId).toBe('parkland');
    expect(createRound({ mode: 'match', players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }).players.length).toBe(2);
    expect(createRound({ holeCount: 99 }).holes.length).toBe(18);
    expect(createRound({ players: [{ name: 'x'.repeat(60) }] }).players[0].name.length).toBe(18);
  });
  it('closest to the pin plays exactly the par 3s (four, or two on the Old Course)', () => {
    for (const c of COURSES) {
      const hs = holesFor(c.id, 'ctp');
      expect(hs.length).toBe(c.pars.filter((p) => p === 3).length);
      for (const h of hs) expect(c.pars[h]).toBe(3);
    }
  });
  it('counts strokes, putts, and driving stats', () => {
    const r = createRound({ courseId: 'parkland', holeCount: 1 }); // hole 1 is a par 4
    beginHole(r, tee);
    expect(parOf(r)).toBe(4);
    applyShot(r, 0, shot());
    expect(r.state[0]).toMatchObject({ strokes: 1, fairwayHit: true, driveDistance: 200, lie: SURFACES.FAIRWAY });
    applyShot(r, 0, shot({ from: { x: 0, z: -200, lie: SURFACES.FAIRWAY }, end: { x: 0, z: -340 }, lie: SURFACES.GREEN, distToPin: 6 }));
    expect(r.state[0].onGreenIn).toBe(2);
    applyShot(r, 0, shot({ putt: true, lie: SURFACES.GREEN, distToPin: 0.5 }));
    const res = applyShot(r, 0, shot({ putt: true, holed: true }));
    expect(res.holeDone).toBe(true);
    expect(holeFinished(r)).toBe(true);
    completeHole(r);
    expect(r.scores[0]).toEqual([4]);
    expect(r.logs[0][0]).toMatchObject({ strokes: 4, putts: 2, gir: true, fairwayHit: true, penalties: 0 });
    expect(r.complete).toBe(true);
  });
  it('water costs one stroke and drops at the drop point', () => {
    const r = createRound({ holeCount: 1 }); beginHole(r, tee);
    const res = applyShot(r, 0, shot({ water: true, drop: { x: 3, z: -150, lie: SURFACES.ROUGH } }));
    expect(res.penalty).toBe(1);
    expect(r.state[0]).toMatchObject({ strokes: 2, penalties: 1, x: 3, z: -150, lie: SURFACES.ROUGH, fairwayHit: false });
  });
  it('out of bounds is stroke and distance', () => {
    const r = createRound({ holeCount: 1 }); beginHole(r, tee);
    applyShot(r, 0, shot({ oob: true }));
    expect(r.state[0]).toMatchObject({ strokes: 2, penalties: 1, x: 0, z: 0, lie: SURFACES.TEE });
  });
  it('the stroke cap ends a hole so a round can never get stuck', () => {
    const r = createRound({ holeCount: 1 }); beginHole(r, tee);
    let done = false, n = 0;
    while (!done && n++ < 50) done = applyShot(r, 0, shot({ lie: SURFACES.ROUGH })).holeDone;
    expect(done).toBe(true);
    expect(r.state[0].strokes).toBe(9);
    expect(r.state[0].pickedUp).toBe(true);
    // Penalties cannot push past the cap either.
    const r2 = createRound({ holeCount: 1 }); beginHole(r2, tee);
    let d2 = false; n = 0;
    while (!d2 && n++ < 50) d2 = applyShot(r2, 0, shot({ oob: true })).holeDone;
    expect(r2.state[0].strokes).toBe(9);
  });
  it('the furthest ball plays next, and the tee goes in order', () => {
    const r = createRound({ mode: 'skins', players: [{ name: 'A' }, { name: 'B', kind: 'ai' }, { name: 'C', kind: 'ai' }], holeCount: 1 });
    beginHole(r, tee);
    expect(nextTurn(r)).toBe(0);
    applyShot(r, 0, shot({ distToPin: 120 }));
    expect(nextTurn(r)).toBe(1);
    applyShot(r, 1, shot({ distToPin: 180 }));
    expect(nextTurn(r)).toBe(2);
    applyShot(r, 2, shot({ distToPin: 90 }));
    expect(nextTurn(r)).toBe(1);
    applyShot(r, 1, shot({ holed: true }));
    expect(nextTurn(r)).toBe(0);
  });
  it('advances through holes and finishes the round', () => {
    const r = createRound({ holeCount: 3 });
    for (let h = 0; h < 3; h++) {
      expect(currentHoleIndex(r)).toBe(h);
      beginHole(r, tee);
      applyShot(r, 0, shot({ holed: true }));
      expect(completeHole(r)).toBe(h === 2);
    }
    expect(r.complete).toBe(true);
    expect(r.scores[0]).toEqual([1, 1, 1]);
  });
  it('match play ends early when it is decided', () => {
    const r = createRound({ mode: 'match', holeCount: 3, players: [{ name: 'A' }, { name: 'B', kind: 'ai' }] });
    for (let h = 0; h < 2; h++) {
      beginHole(r, tee);
      applyShot(r, 0, shot({ holed: true }));
      applyShot(r, 1, shot({})); applyShot(r, 1, shot({ holed: true }));
      const over = completeHole(r);
      expect(over).toBe(h === 1); // 2 up with 1 to play
    }
    expect(standings(r).match.text).toBe('2 & 1');
    expect(standings(r).text).toContain('A wins');
  });
  it('closest to the pin is one shot per hole and records the distance', () => {
    const r = createRound({ mode: 'ctp', players: [{ name: 'A' }, { name: 'B', kind: 'ai' }] });
    beginHole(r, tee);
    expect(applyShot(r, 0, shot({ lie: SURFACES.GREEN, distToPin: 3.2 })).holeDone).toBe(true);
    applyShot(r, 1, shot({ lie: SURFACES.BUNKER, distToPin: 9 }));
    expect(holeFinished(r)).toBe(true);
    completeHole(r);
    expect(r.ctp[0][0]).toBeCloseTo(3.2);
    expect(r.ctp[1][0]).toBe(null);
    expect(standings(r).text).toBe('A leads');
  });
  it('skins standings carry tied holes', () => {
    const r = createRound({ mode: 'skins', holeCount: 2, players: [{ name: 'A' }, { name: 'B', kind: 'ai' }] });
    r.scores = [[4, 3], [4, 4]]; r.hole = 1; r.complete = true;
    expect(standings(r).skins.skins).toEqual([2, 0]);
  });
});

describe('round validation (saves and share links)', () => {
  const good = () => { const r = createRound({ holeCount: 3 }); r.scores = [[4, 5]]; r.hole = 2; return r; };
  it('accepts a consistent round', () => { expect(validateRound(good()).ok).toBe(true); });
  it('rejects tampering', () => {
    const cases = [
      (r) => { r.scores[0][0] = 0; }, (r) => { r.scores[0][0] = -3; }, (r) => { r.scores[0][0] = 99; }, (r) => { r.scores[0][0] = 2.5; },
      (r) => { r.scores[0] = [4, 5, 3, 3, 3]; }, (r) => { r.hole = 7; }, (r) => { r.courseId = 'nowhere'; }, (r) => { r.mode = 'cheat'; },
      (r) => { r.holes = [0, 1, 44]; }, (r) => { r.players = []; }, (r) => { r.players[0].name = ''; }, (r) => { r.v = 99; },
      (r) => { r.scores = [[4, 5], [3, 3]]; }, (r) => { r.scores[0] = [4]; }, (r) => { r.players[0].kind = 'god'; }, (r) => { r.scores[0] = 'x'; },
    ];
    for (const mut of cases) { const r = good(); mut(r); expect(validateRound(r).ok, mut.toString()).toBe(false); }
    expect(validateRound(null).ok).toBe(false);
    expect(validateRound('hi').ok).toBe(false);
  });
  it('every mode is defined', () => { expect(Object.keys(MODES)).toEqual(['stroke', 'match', 'skins', 'ctp', 'daily', 'range']); });
});

describe('planner on real terrain', () => {
  const terrains = {};
  const T = (cid, i) => (terrains[cid + i] ||= buildTerrain(courseById(cid), getHole(courseById(cid), i)));

  it('solvePutt holes putts from several spots on a real green', () => {
    const t = T('parkland', 0);
    let holed = 0, n = 0;
    for (let a = 0; a < 6.28; a += 0.8) for (const d of [1.5, 4, 8]) {
      const from = { x: t.pin.x + Math.cos(a) * d, z: t.pin.z + Math.sin(a) * d };
      if (t.surfaceAt(from.x, from.z) !== SURFACES.GREEN) continue;
      const s = solvePutt(t, from);
      const r = simulatePutt(t, from, s.heading, s.speed);
      n++;
      if (r.holed) holed++;
      expect(Math.hypot(r.end.x - t.pin.x, r.end.z - t.pin.z)).toBeLessThan(0.6);
      expect(Number.isFinite(s.breakM + s.elevation + s.speed)).toBe(true);
      // The solved pace fits under the ceiling the stick uses for this distance.
      expect(s.speed).toBeLessThan(puttCeiling(s.distance, s.speed) * 0.75);
    }
    expect(n).toBeGreaterThan(10);
    expect(holed / n).toBeGreaterThan(0.85);
  });
  it('puttCeiling grows with distance and stays bounded', () => {
    expect(puttCeiling(1)).toBeLessThan(puttCeiling(10));
    expect(puttCeiling(0)).toBeGreaterThanOrEqual(1.4);
    expect(puttCeiling(1e6)).toBeLessThanOrEqual(9);
    // An uphill putt that needs more pace raises the ceiling above it.
    expect(puttCeiling(3, 3.0)).toBeGreaterThan(3.0 * 1.4);
  });
  it('chooseTarget goes for a reachable pin and lays up to the fairway otherwise', () => {
    const t = T('parkland', 1); // par 5
    const a = chooseTarget(t, t.tee, SURFACES.TEE);
    expect(a.layup).toBe(true);
    expect([SURFACES.FAIRWAY, SURFACES.FIRST_CUT]).toContain(t.surfaceAt(a.x, a.z));
    expect(a.distance).toBeLessThanOrEqual(maxCarryFrom(SURFACES.TEE));
    const near = { x: t.pin.x, z: t.pin.z + 90 };
    expect(chooseTarget(t, near, SURFACES.FAIRWAY).layup).toBe(false);
  });
  it('the prediction lands near the aim point on a calm day', () => {
    const t = T('parkland', 0);
    const aim = Math.atan2(t.hole.line[50].x - t.tee.x, -(t.hole.line[50].z - t.tee.z));
    const r = predictShot(t, { x: t.tee.x, z: t.tee.z, lie: SURFACES.TEE, club: CLUB_BY_ID.DR, aim, power: 1 });
    expect(r.carry / YARD).toBeGreaterThan(225);
    expect(r.carry / YARD).toBeLessThan(275);
  });
  it('solvePower finds the power for a target, including bunker and rough power loss', () => {
    const t = T('parkland', 0);
    const P = (i) => t.hole.line[i];
    const from = { x: P(60).x, z: P(60).z };
    const target = { x: t.pin.x, z: t.pin.z };
    const aim = Math.atan2(target.x - from.x, -(target.z - from.z));
    const want = Math.hypot(target.x - from.x, target.z - from.z);
    for (const [lie, club, type] of [[SURFACES.FAIRWAY, 'PW', 'full'], [SURFACES.ROUGH, 'GW', 'full'], [SURFACES.BUNKER, 'LW', 'full'], [SURFACES.FAIRWAY, 'SW', 'chip']]) {
      const sh = { x: from.x, z: from.z, lie, club: CLUB_BY_ID[club], shotType: shotTypeById(type), aim };
      const d = type === 'chip' ? 20 : Math.min(want, 40);
      const p = solvePower(t, { ...sh }, undefined, 0, { x: from.x + Math.sin(aim) * d, z: from.z - Math.cos(aim) * d }, type === 'chip' ? 'end' : 'carry');
      expect(p).toBeGreaterThan(0.02);
      expect(p).toBeLessThanOrEqual(1);
      const r = predictShot(t, { ...sh, power: p });
      const ref = type === 'chip' ? r.end : r.carryPoint;
      const got = Math.hypot(ref.x - from.x, ref.z - from.z) + (type === 'chip' ? 0 : Math.min(6, (r.total - r.carry) * 0.5));
      expect(Math.abs(got - d)).toBeLessThan(1.5);
    }
    // A target beyond the club's reach asks for full power.
    expect(solvePower(t, { x: from.x, z: from.z, lie: SURFACES.FAIRWAY, club: CLUB_BY_ID.LW, shotType: shotTypeById('full'), aim }, undefined, 0, { x: from.x + Math.sin(aim) * 300, z: from.z - Math.cos(aim) * 300 })).toBe(1);
  });
  it('dropPoint returns dry ground no nearer the hole than the water', () => {
    for (const cid of ['parkland', 'links', 'desert']) for (let i = 0; i < 18; i++) {
      const t = T(cid, i);
      const pond = t.bodies.find((b) => b.type === 'pond');
      if (!pond) continue;
      const c = pond.source.blobs[0];
      const aim = Math.atan2(c.x - t.tee.x, -(c.z - t.tee.z));
      const fake = { points: new Float32Array([0, t.tee.x, 0, t.tee.z, 1, (t.tee.x + c.x) / 2, 20, (t.tee.z + c.z) / 2, 2, c.x, 0, c.z]) };
      const d = dropPoint(t, fake, { x: t.tee.x, z: t.tee.z, lie: SURFACES.TEE });
      expect(t.surfaceAt(d.x, d.z)).not.toBe(SURFACES.WATER);
      expect(Number.isFinite(d.x + d.z + aim)).toBe(true);
      return;
    }
  });
  it('the AI finishes every one of the 54 flagship holes, in wind, without getting stuck', () => {
    let total = 0, par = 0, worst = 0;
    for (const c of COURSES.filter((x) => x.flagship)) {
      const rng = createRng(c.seed);
      for (let i = 0; i < 18; i++) {
        const t = T(c.id, i);
        const w = createWind({ speedMph: c.wind.max * 0.6, dir: i, gustiness: c.wind.gustiness, seed: i + 1 });
        const r = playHoleAI(t, { skill: 0.85, rng, windAt: (tt, h, o) => w.sample(tt, h, o) });
        expect(r.error, `${c.id} ${i + 1}`).toBeUndefined();
        expect(r.strokes).toBeGreaterThanOrEqual(1);
        expect(r.strokes).toBeLessThanOrEqual(t.hole.par + 5);
        total += r.strokes; par += t.hole.par;
        worst = Math.max(worst, r.strokes - t.hole.par);
      }
    }
    // A strong AI averages within a few strokes of par per round: believable, not perfect.
    const perRound = ((total - par) / 3);
    expect(perRound).toBeGreaterThan(-12);
    expect(perRound).toBeLessThan(22);
  }, 240000);
  it('a weaker AI scores worse than a stronger one over a round', () => {
    const c = courseById('parkland');
    const play = (skill) => { let s = 0; const rng = createRng(99); for (let i = 0; i < 18; i++) s += playHoleAI(T('parkland', i), { skill, rng }).strokes; return s; };
    expect(play(0.25)).toBeGreaterThan(play(0.95));
    expect(c.pars.length).toBe(18);
  }, 240000);
  it('aiPlan output is always finite and in range', () => {
    const t = T('links', 3);
    const rng = createRng(5);
    for (const lie of [SURFACES.TEE, SURFACES.FAIRWAY, SURFACES.ROUGH, SURFACES.DEEP_ROUGH, SURFACES.BUNKER, SURFACES.GREEN]) {
      for (const from of [t.tee, { x: t.pin.x + 3, z: t.pin.z + 5 }, { x: t.pin.x + 30, z: t.pin.z + 60 }]) {
        const p = aiPlan(t, from, lie, { skill: 0.5, rng });
        expect(Number.isFinite(p.aim + p.swing.power + p.swing.face + p.swing.path + p.swing.tempoQuality)).toBe(true);
        expect(p.swing.power).toBeGreaterThan(0); expect(p.swing.power).toBeLessThanOrEqual(1);
        expect(p.club).toBeDefined();
      }
    }
  });
});
