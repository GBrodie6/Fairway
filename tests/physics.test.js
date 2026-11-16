import { describe, it, expect } from 'vitest';
import { simulateShot, flatEnv, samplePath, aeroCoefficients, stepFlight, CUP_RADIUS, BALL_RADIUS } from '../src/physics/ball.js';
import { CLUBS, CLUB_SPECS } from '../src/physics/clubs.js';
import { SURFACES, surfaceProps, STIMP_10_DECEL } from '../src/physics/surfaces.js';
import { YARD, DEG, MPH } from '../src/core/math.js';
import { createWind } from '../src/physics/wind.js';

const full = (c, extra = {}) => ({ x: 0, z: 0, speed: c.speed, vAngle: c.launchRad, heading: 0, spin: c.spin, ...extra });

describe('club carry ladder', () => {
  for (const c of CLUBS.filter((k) => !k.putter)) {
    it(`${c.name} carries ${c.carry} yd within 0.2 yd`, () => {
      const r = simulateShot(full(c), flatEnv());
      expect(Math.abs(r.carry / YARD - c.carry)).toBeLessThan(0.2);
    });
  }
  it('ladder is strictly descending with sensible gaps', () => {
    const carries = CLUB_SPECS.filter((c) => !c.putter).map((c) => c.carry);
    for (let i = 1; i < carries.length; i++) {
      expect(carries[i]).toBeLessThan(carries[i - 1]);
      expect(carries[i - 1] - carries[i]).toBeLessThanOrEqual(25);
    }
  });
});

describe('hang time and apex', () => {
  const hang = Object.fromEntries(CLUBS.filter((c) => !c.putter).map((c) => [c.id, simulateShot(full(c), flatEnv())]));
  it('driver hang time is between 6.0 and 7.0 s', () => {
    expect(hang.DR.hang).toBeGreaterThan(6.0);
    expect(hang.DR.hang).toBeLessThan(7.0);
  });
  it('7 iron hang time is between 5.0 and 6.2 s', () => {
    expect(hang.I7.hang).toBeGreaterThan(5.0);
    expect(hang.I7.hang).toBeLessThan(6.2);
  });
  it('lob wedge hang time is between 3.6 and 5.0 s', () => {
    expect(hang.LW.hang).toBeGreaterThan(3.6);
    expect(hang.LW.hang).toBeLessThan(5.0);
  });
  it('hang time falls from driver to lob wedge', () => {
    const ids = CLUBS.filter((c) => !c.putter).map((c) => c.id);
    for (let i = 1; i < ids.length; i++) expect(hang[ids[i]].hang).toBeLessThan(hang[ids[i - 1]].hang + 0.05);
  });
  it('every full shot peaks between 15 and 36 yards', () => {
    for (const id in hang) {
      expect(hang[id].apex / YARD).toBeGreaterThan(15);
      expect(hang[id].apex / YARD).toBeLessThan(36);
    }
  });
});

describe('numerical safety', () => {
  it('never produces NaN across a sweep of launches, surfaces, and winds', () => {
    const wind = createWind({ speedMph: 25, dir: 1.1, gustiness: 1, seed: 7 });
    let count = 0;
    for (const surf of Object.values(SURFACES)) {
      for (const speed of [0, 0.01, 3, 40, 95]) {
        for (const ang of [-5, 0, 12, 45, 89]) {
          for (const tilt of [-35, 0, 35]) {
            const env = { ...flatEnv(surf), windAt: (t, h, o) => wind.sample(t, h, o) };
            const r = simulateShot({ x: 0, z: 0, speed, vAngle: ang * DEG, heading: 0.3, spin: 900, axisTilt: tilt * DEG }, env);
            expect(r.nan).toBeUndefined();
            for (const v of r.points) { if (!Number.isFinite(v)) throw new Error('NaN in path'); }
            expect(Number.isFinite(r.carry + r.total + r.apex + r.hang + r.end.x + r.end.y + r.end.z)).toBe(true);
            count++;
          }
        }
      }
    }
    expect(count).toBeGreaterThan(900);
  });
  it('recovers from a terrain function that returns NaN', () => {
    const env = flatEnv();
    let calls = 0;
    env.heightAt = () => (++calls > 400 ? NaN : 0);
    const r = simulateShot(full(CLUBS[6]), env);
    for (const v of r.points) expect(Number.isFinite(v)).toBe(true);
    expect(r.events[r.events.length - 1].type).toBe('stop');
  });
  it('zero speed shot stays put and terminates', () => {
    const r = simulateShot({ x: 3, z: 4, speed: 0, vAngle: 0.3, heading: 0, spin: 0 }, flatEnv());
    expect(r.total).toBeLessThan(0.01);
    expect(r.duration).toBeLessThan(2);
  });
  it('stepFlight with a still ball only applies gravity', () => {
    const s = { x: 0, y: 10, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, ax: 1, ay: 0, az: 0, t: 0 };
    stepFlight(s, 0.01, () => {});
    expect(s.vy).toBeCloseTo(-0.0981, 3);
  });
  it('aero coefficients are bounded and monotone in spin ratio', () => {
    let prev = aeroCoefficients(0);
    expect(prev.cl).toBe(0);
    for (let s = 0.02; s <= 2; s += 0.02) {
      const c = aeroCoefficients(s);
      expect(c.cl).toBeGreaterThanOrEqual(prev.cl);
      expect(c.cd).toBeGreaterThanOrEqual(prev.cd);
      expect(c.cl).toBeLessThan(0.4);
      expect(c.cd).toBeLessThan(0.6);
      prev = c;
    }
  });
});

describe('roll friction', () => {
  const putt = (speed, surf) => simulateShot({ x: 0, z: 0, speed, heading: 0, putt: true }, flatEnv(surf));
  it('a stimp 10 green rolls a 1.83 m/s ball 10 feet', () => {
    const r = putt(1.83, SURFACES.GREEN);
    expect(r.total / 0.3048).toBeGreaterThan(9.6);
    expect(r.total / 0.3048).toBeLessThan(10.4);
  });
  it('roll distance matches v^2 / 2a on each surface within 4 percent', () => {
    for (const surf of [SURFACES.GREEN, SURFACES.FRINGE, SURFACES.FAIRWAY, SURFACES.FIRST_CUT, SURFACES.ROUGH, SURFACES.DEEP_ROUGH, SURFACES.BUNKER]) {
      const a = surfaceProps(surf).rollDecel;
      const v = 4;
      const expected = (v * v) / (2 * a);
      const r = putt(v, surf);
      expect(Math.abs(r.total - expected) / expected).toBeLessThan(0.04);
    }
  });
  it('rougher surfaces stop the ball sooner', () => {
    const order = [SURFACES.GREEN, SURFACES.FRINGE, SURFACES.FAIRWAY, SURFACES.FIRST_CUT, SURFACES.ROUGH, SURFACES.DEEP_ROUGH, SURFACES.BUNKER];
    const d = order.map((s) => putt(3, s).total);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1]);
  });
  it('STIMP_10_DECEL is the textbook value', () => {
    expect(STIMP_10_DECEL).toBeCloseTo(0.549, 2);
  });
  it('a ball rolls downhill and stops on the flat', () => {
    // A 4 percent slope for 10 m, then flat.
    const env = flatEnv(SURFACES.GREEN);
    const slope = 0.04;
    env.heightAt = (x, z) => (z < -10 ? -10 * slope : z * slope);
    env.normalAt = (x, z, o) => {
      const dz = z < -10 ? 0 : slope;
      const inv = 1 / Math.hypot(dz, 1);
      o.x = 0; o.y = inv; o.z = -dz * inv;
      return o;
    };
    const flat = putt(1.5, SURFACES.GREEN).total;
    const down = simulateShot({ x: 0, z: 0, speed: 1.5, heading: 0, putt: true }, env).total;
    const up = simulateShot({ x: 0, z: -9, speed: 1.5, heading: Math.PI, putt: true }, env).total;
    expect(down).toBeGreaterThan(flat * 1.2);
    expect(up).toBeLessThan(flat * 0.85);
  });
  it('a ball left on a steep slope keeps moving rather than sticking', () => {
    const env = flatEnv(SURFACES.GREEN);
    const slope = 0.2;
    env.heightAt = (x, z) => (z < -30 ? -30 * slope : z * slope);
    env.normalAt = (x, z, o) => {
      const dz = z < -30 ? 0 : slope;
      const inv = 1 / Math.hypot(dz, 1);
      o.x = 0; o.y = inv; o.z = -dz * inv;
      return o;
    };
    const r = simulateShot({ x: 0, z: -1, speed: 0.01, heading: 0, putt: true }, env);
    expect(r.end.z).toBeLessThan(-25);
  });
});

describe('bounce and landing', () => {
  it('driver rolls out 8 to 30 yards on fairway and less in rough', () => {
    const fw = simulateShot(full(CLUBS[0]), flatEnv(SURFACES.FAIRWAY));
    const ro = simulateShot(full(CLUBS[0]), flatEnv(SURFACES.ROUGH));
    const rollFw = (fw.total - fw.carry) / YARD, rollRo = (ro.total - ro.carry) / YARD;
    expect(rollFw).toBeGreaterThan(8);
    expect(rollFw).toBeLessThan(30);
    expect(rollRo).toBeLessThan(rollFw);
  });
  it('wedges stop within 6 yards on a green', () => {
    for (const id of ['PW', 'GW', 'SW', 'LW']) {
      const c = CLUBS.find((k) => k.id === id);
      const r = simulateShot(full(c), flatEnv(SURFACES.GREEN));
      expect((r.total - r.carry) / YARD).toBeLessThan(6);
    }
  });
  it('a ball landing in water stops there and is flagged', () => {
    const r = simulateShot(full(CLUBS[6]), flatEnv(SURFACES.WATER));
    expect(r.water).toBe(true);
    expect(r.events[r.events.length - 1].type).toBe('water');
    expect(Math.abs(r.total - r.carry)).toBeLessThan(0.01);
  });
  it('a bunker kills the roll', () => {
    const r = simulateShot(full(CLUBS[6]), flatEnv(SURFACES.BUNKER));
    expect((r.total - r.carry) / YARD).toBeLessThan(2.5);
  });
  it('reports land, rollStart, and stop events in order', () => {
    const r = simulateShot(full(CLUBS[3]), flatEnv());
    const types = r.events.map((e) => e.type);
    expect(types[0]).toBe('land');
    expect(types).toContain('rollStart');
    expect(types[types.length - 1]).toBe('stop');
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].t).toBeGreaterThanOrEqual(r.events[i - 1].t);
  });
});

describe('spin axis and curve', () => {
  it('positive tilt curves right, negative curves left, symmetric', () => {
    const c = CLUBS[0];
    const right = simulateShot(full(c, { axisTilt: 10 * DEG }), flatEnv());
    const left = simulateShot(full(c, { axisTilt: -10 * DEG }), flatEnv());
    expect(right.carryPoint.x).toBeGreaterThan(8);
    expect(left.carryPoint.x).toBeLessThan(-8);
    expect(right.carryPoint.x + left.carryPoint.x).toBeCloseTo(0, 3);
  });
  it('heading rotates the whole flight without changing carry', () => {
    const c = CLUBS[5];
    const a = simulateShot(full(c), flatEnv());
    const b = simulateShot(full(c, { heading: 1.2 }), flatEnv());
    expect(b.carry).toBeCloseTo(a.carry, 4);
    expect(b.carryPoint.x).toBeCloseTo(Math.sin(1.2) * a.carry, 3);
    expect(b.carryPoint.z).toBeCloseTo(-Math.cos(1.2) * a.carry, 3);
  });
});

describe('wind effect on flight', () => {
  const shot = (speedMph, dir) => {
    const w = createWind({ speedMph, dir, gustiness: 0, seed: 1 });
    return simulateShot(full(CLUBS[0]), { ...flatEnv(), windAt: (t, h, o) => w.sample(t, h, o) });
  };
  it('headwind shortens and tailwind lengthens the carry', () => {
    const calm = shot(0, 0).carry, tail = shot(15, 0).carry, head = shot(15, Math.PI).carry;
    expect(tail).toBeGreaterThan(calm + 5);
    expect(head).toBeLessThan(calm - 12);
    // A headwind hurts more than the same tailwind helps.
    expect(calm - head).toBeGreaterThan(tail - calm);
  });
  it('crosswind moves the ball downwind', () => {
    expect(shot(15, Math.PI / 2).carryPoint.x).toBeGreaterThan(8);
    expect(shot(15, -Math.PI / 2).carryPoint.x).toBeLessThan(-8);
  });
});

describe('cup capture', () => {
  const env = () => ({ ...flatEnv(SURFACES.GREEN), cup: { x: 0, z: -3 } });
  it('a well paced putt on line drops', () => {
    const r = simulateShot({ x: 0, z: 0, speed: 2.0, heading: 0, putt: true }, env());
    expect(r.holed).toBe(true);
    expect(r.events[r.events.length - 1].type).toBe('holed');
  });
  it('a putt hit far too hard runs through', () => {
    const r = simulateShot({ x: 0, z: 0, speed: 5.5, heading: 0, putt: true }, env());
    expect(r.holed).toBe(false);
    expect(r.end.z).toBeLessThan(-4);
  });
  it('a putt wide of the cup misses', () => {
    const r = simulateShot({ x: CUP_RADIUS + BALL_RADIUS + 0.03, z: 0, speed: 2.0, heading: 0, putt: true }, env());
    expect(r.holed).toBe(false);
  });
  it('a putt left short does not drop', () => {
    const r = simulateShot({ x: 0, z: 0, speed: 1.0, heading: 0, putt: true }, env());
    expect(r.holed).toBe(false);
    expect(r.end.z).toBeGreaterThan(-3 + CUP_RADIUS);
  });
});

describe('samplePath', () => {
  it('interpolates inside the path and clamps at the ends', () => {
    const r = simulateShot(full(CLUBS[6]), flatEnv());
    const o = {};
    samplePath(r.points, -1, o);
    expect(o.x).toBeCloseTo(r.points[1], 5);
    samplePath(r.points, 1e9, o);
    expect(o.z).toBeCloseTo(r.end.z, 3);
    samplePath(r.points, r.hang / 2, o);
    expect(o.y).toBeGreaterThan(10);
    expect(Number.isFinite(o.x + o.y + o.z)).toBe(true);
  });
  it('handles an empty path', () => {
    const o = { x: 1, y: 2, z: 3 };
    expect(samplePath(new Float32Array(0), 1, o)).toBe(o);
  });
});

describe('determinism', () => {
  it('the same launch gives byte-identical paths', () => {
    const w = createWind({ speedMph: 12, dir: 0.7, gustiness: 0.8, seed: 99 });
    const env = { ...flatEnv(), windAt: (t, h, o) => w.sample(t, h, o), t0: 12.5 };
    const a = simulateShot(full(CLUBS[2], { axisTilt: 0.1 }), env);
    const b = simulateShot(full(CLUBS[2], { axisTilt: 0.1 }), env);
    expect(a.points.length).toBe(b.points.length);
    expect(Buffer.from(a.points.buffer).equals(Buffer.from(b.points.buffer))).toBe(true);
  });
  it('ball speeds are in a realistic range', () => {
    expect(CLUBS[0].speed / MPH).toBeGreaterThan(150);
    expect(CLUBS[0].speed / MPH).toBeLessThan(170);
  });
});
