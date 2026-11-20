import { describe, it, expect } from 'vitest';
import { COURSES } from '../src/course/courses.js';
import { generateHole, getHole } from '../src/course/layout.js';
import { buildTerrain } from '../src/course/terrain.js';
import { courseRouting, computeRouting, routingProblems, routingStats, clearRoutingCache, toWorld, toLocal, frameToFrame, holeFrame, ROUTING } from '../src/course/routing.js';
import { REAL_ROUTING } from '../src/course/realRouting.js';

// A fingerprint of everything a hole definition holds (pars, yards, shape, hazards, pins).
const holeKey = (h) => JSON.stringify(h, (k, v) => (v instanceof Float32Array ? Array.from(v, (x) => +x.toFixed(4)) : typeof v === 'number' ? +v.toFixed(6) : v));

describe('course routing', () => {
  it('frames: world and local are inverses, and local -Z points along the heading', () => {
    const f = { x: 120, z: -40, heading: 0.7 };
    const w = toWorld(f, 3, -50), l = toLocal(f, w.x, w.z);
    expect(l.x).toBeCloseTo(3, 9); expect(l.z).toBeCloseTo(-50, 9);
    const g = toWorld(f, 0, -100);
    expect(g.x - f.x).toBeCloseTo(Math.sin(0.7) * 100, 9);
    expect(g.z - f.z).toBeCloseTo(-Math.cos(0.7) * 100, 9);
    const o = { x: -300, z: 80, heading: -2.1 };
    const p = frameToFrame(f, o, 10, -20), back = frameToFrame(o, f, p.x, p.z);
    expect(back.x).toBeCloseTo(10, 9); expect(back.z).toBeCloseTo(-20, 9);
  });

  for (const course of COURSES) {
    it(`${course.id}: deterministic, 18 holes, no overlaps, ${ROUTING.gap} m between corridors, each hole starts near the last green`, () => {
      // The search gives the same answer every time, and the frames the game ships
      // (course/routingData.js) are exactly that answer.
      const a = JSON.stringify(computeRouting(course).routing);
      const b = JSON.stringify(computeRouting(course).routing);
      expect(b).toBe(a);
      clearRoutingCache();
      expect(JSON.stringify(courseRouting(course))).toBe(a);
      const r = courseRouting(course);
      expect(r.holes.length).toBe(18);
      for (const h of r.holes) expect(Number.isFinite(h.x + h.z + h.heading)).toBe(true);
      // Every rule: corridors apart (with the joint between consecutive holes), clear of the
      // sea beside coastal holes, and every walk from a green to the next tee in range.
      expect(routingProblems(course, r)).toEqual([]);
      const st = routingStats(course, r);
      expect(st.minGap).toBeGreaterThanOrEqual(ROUTING.gap - 1e-6);
      for (const w of st.walks) { expect(w).toBeGreaterThanOrEqual(ROUTING.walkMin - 0.5); expect(w).toBeLessThanOrEqual(ROUTING.walkMax + 0.5); }
      // The green in the routing is the hole's own green, moved by the hole's frame.
      for (let i = 0; i < 18; i++) {
        const hole = getHole(course, i), g = toWorld(holeFrame(r, i), hole.green.x, hole.green.z);
        expect(Math.hypot(g.x - r.holes[i].green.x, g.z - r.holes[i].green.z)).toBeLessThan(0.05);
      }
    }, 120000);
  }

  it('different seeds give different routings', () => {
    const base = COURSES.find((c) => c.id === 'parkland');
    const other = { ...base, id: 'parkland-seed-test', seed: base.seed + 1 };
    const a = computeRouting(base).routing, b = computeRouting(other).routing;
    expect(a.holes.map((h) => h.heading)).not.toEqual(b.holes.map((h) => h.heading));
  }, 120000);

  it('the real courses follow their real routing (OpenStreetMap) where the gap rule allows', () => {
    for (const id of ['augusta', 'standrews']) {
      const course = COURSES.find((c) => c.id === id), r = courseRouting(course), real = REAL_ROUTING[id].holes;
      expect(r.source).toBe('OpenStreetMap');
      expect(r.clubhouse).toEqual({ x: 0, z: 0 });
      // The 1st hole is where it really is.
      const h0 = Math.atan2(real[0].green[0] - real[0].tee[0], -(real[0].green[1] - real[0].tee[1]));
      expect(Math.hypot(r.holes[0].x - real[0].tee[0], r.holes[0].z - real[0].tee[1])).toBeLessThan(1);
      expect(Math.abs(r.holes[0].heading - h0)).toBeLessThan(1e-3);
      const off = r.holes.map((h, i) => {
        const hr = Math.atan2(real[i].green[0] - real[i].tee[0], -(real[i].green[1] - real[i].tee[1]));
        return Math.abs(Math.atan2(Math.sin(h.heading - hr), Math.cos(h.heading - hr))) * 180 / Math.PI;
      });
      // The opening holes keep the real direction; later the 60 m gap and corridors that may
      // not cross (the Old Course's 11th crosses its 7th) turn some holes, never right around.
      for (const d of off.slice(0, 6)) expect(d).toBeLessThanOrEqual(10);
      expect(off.filter((d) => d <= 30).length).toBeGreaterThanOrEqual(11);
      for (const d of off) expect(d).toBeLessThanOrEqual(120 + 1e-3); // headings are stored to 6 decimals
    }
  }, 120000);

  it('routing changes no hole definition and no physics ground', () => {
    clearRoutingCache();
    const course = COURSES.find((c) => c.id === 'links');
    const before = [0, 5, 17].map((i) => holeKey(generateHole(course, i)));
    const t0 = buildTerrain(course, generateHole(course, 5));
    const h0 = Array.from(t0.height.subarray(0, 4000));
    computeRouting(course);
    expect([0, 5, 17].map((i) => holeKey(getHole(course, i)))).toEqual(before);
    expect([0, 5, 17].map((i) => holeKey(generateHole(course, i)))).toEqual(before);
    const t1 = buildTerrain(course, generateHole(course, 5));
    expect(Array.from(t1.height.subarray(0, 4000))).toEqual(h0);
  }, 120000);

  it('a one-hole course (a community level) and the range', () => {
    const level = { ...COURSES[0], id: 'lvl:routing-test', pars: [4] };
    const r = courseRouting(level);
    expect(r.holes.length).toBe(1);
    expect(r.holes[0].x).toBe(0);
    expect(courseRouting({ id: 'range', range: true, pars: [] })).toBe(null);
  });
});
