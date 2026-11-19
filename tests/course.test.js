import { describe, it, expect } from 'vitest';
import { COURSES, courseById } from '../src/course/courses.js';
import { generateHole, getHole, greenSdf, pointAt, pinOf, resample } from '../src/course/layout.js';
import { buildTerrain, MASKS, SURFACE_ORDER, RAMP } from '../src/course/terrain.js';
import { SURFACES } from '../src/physics/surfaces.js';
import { simulateShot } from '../src/physics/ball.js';
import { CLUB_BY_ID } from '../src/physics/clubs.js';
import { computeLaunch } from '../src/physics/shot.js';
import { YARD } from '../src/core/math.js';
import { SURFACE_SLOTS, layersFor } from '../src/render/terrainLayers.js';
import manifest from '../src/render/assets.manifest.json';

const FLAGSHIP = COURSES.filter((c) => c.flagship);

describe('hole layouts', () => {
  for (const course of COURSES) {
    it(`${course.id}: 18 valid holes that total par 72`, () => {
      let par = 0, yards = 0;
      for (let i = 0; i < 18; i++) {
        const h = generateHole(course, i);
        par += h.par; yards += h.yards;
        expect(h.par).toBe(course.pars[i]);
        if (course.real) {
          // A real course plays its official card (course/realCourses.js, ASSETS.md).
          expect(h.yards).toBe(course.yards[i]);
        } else {
          const range = { 3: [130, 215], 4: [330, 455], 5: [490, 580] }[h.par];
          expect(h.yards).toBeGreaterThanOrEqual(range[0]);
          expect(h.yards).toBeLessThanOrEqual(range[1]);
        }
        // The centerline length matches the card yardage.
        expect(Math.abs(h.length / YARD - h.yards)).toBeLessThan(6);
        // Tee at the origin, green down -Z.
        expect(h.line[0].x).toBeCloseTo(0, 6); expect(h.line[0].z).toBeCloseTo(0, 6);
        expect(h.green.z).toBeLessThan(-100);
        expect(Math.abs(h.green.x)).toBeLessThan(2);
        // Every coordinate is finite.
        for (const p of h.line) expect(Number.isFinite(p.x + p.z + p.s)).toBe(true);
        // Pins are well inside the green.
        expect(h.pins.length).toBeGreaterThan(0);
        for (const p of h.pins) expect(greenSdf(h.green, p.x, p.z)).toBeLessThan(-3);
        // Bunkers do not sit on the putting surface.
        for (const b of h.bunkers) for (const c of b.blobs) expect(greenSdf(h.green, c.x, c.z)).toBeGreaterThan(c.r * 0.6);
        // Par 4s and 5s have a fairway with real width at the landing zone.
        if (h.par > 3) {
          const i220 = Math.round(220 / h.lineStep);
          expect(h.half[Math.min(i220, h.half.length - 1)]).toBeGreaterThan(9);
        }
        expect(h.bounds.maxX - h.bounds.minX).toBeLessThan(620);
        expect(h.bounds.maxZ - h.bounds.minZ).toBeLessThan(900);
      }
      expect(par).toBe(72);
      expect(yards).toBeGreaterThan(5900);
      if (course.real) expect(yards).toBe(course.yards.reduce((a, b) => a + b, 0));
      else expect(yards).toBeLessThan(7400);
    });
  }
  it('is deterministic', () => {
    const a = generateHole(COURSES[0], 4), b = generateHole(COURSES[0], 4);
    expect(JSON.stringify({ ...a, half: [...a.half] })).toBe(JSON.stringify({ ...b, half: [...b.half] }));
    expect(getHole(COURSES[0], 4)).toBe(getHole(COURSES[0], 4));
  });
  it('holes differ within a course and across courses', () => {
    const sig = (h) => `${h.yards}:${h.bunkers.length}:${h.green.radius.toFixed(2)}`;
    const all = new Set();
    for (const c of COURSES) for (let i = 0; i < 18; i++) all.add(c.id + sig(generateHole(c, i)));
    expect(all.size).toBe(COURSES.length * 18);
  });
  it('each course theme shows up in its hazards', () => {
    const count = (c, f) => { let n = 0; for (let i = 0; i < 18; i++) n += f(generateHole(c, i)); return n; };
    const sea = (h) => (h.sea ? 1 : 0), ponds = (h) => h.water.filter((w) => w.type === 'pond').length;
    expect(count(courseById('links'), sea)).toBeGreaterThanOrEqual(6);
    expect(count(courseById('parkland'), sea)).toBe(0);
    expect(count(courseById('desert'), sea)).toBe(0);
    expect(count(courseById('parkland'), ponds)).toBeGreaterThanOrEqual(3);
    // Links bunkers are small pots, parkland bunkers are broad.
    const avgR = (c) => { let s = 0, n = 0; for (let i = 0; i < 18; i++) for (const b of generateHole(c, i).bunkers) { s += b.blobs[0].r; n++; } return s / n; };
    expect(avgR(courseById('links'))).toBeLessThan(avgR(courseById('parkland')) - 1);
    expect(count(courseById('links'), (h) => h.bunkers.length)).toBeGreaterThan(count(courseById('parkland'), (h) => h.bunkers.length));
  });
  it('the real courses: official cards, their signature features, and their conditions', async () => {
    const { REAL_COURSE_NAMES } = await import('../src/course/realCourses.js');
    const { courseConditions, conditionedProps, CONDITION_LIMITS } = await import('../src/course/conditions.js');
    const { surfaceProps, SURFACES: S } = await import('../src/physics/surfaces.js');
    const aug = courseById('augusta'), sa = courseById('standrews');
    expect([aug.name, sa.name]).toEqual([REAL_COURSE_NAMES.augusta, REAL_COURSE_NAMES.standrews]);
    const total = (c) => c.yards.reduce((a, b) => a + b, 0);
    expect(total(aug)).toBe(7565); expect(total(sa)).toBe(7313);
    const holes = (c) => Array.from({ length: 18 }, (_, i) => generateHole(c, i));
    const A = holes(aug), B = holes(sa);
    // Augusta: water through the middle of the back nine (11, 12, 13, 15, 16) and nowhere else.
    expect(A.map((h, i) => (h.water.length ? i + 1 : 0)).filter(Boolean)).toEqual([11, 12, 13, 15, 16]);
    expect(A[13].bunkers.length).toBe(0); // the 14th has none
    // St Andrews: double greens everywhere but 1, 9, 17 and 18; the burn on 1 and 18; the sea.
    expect(B.map((h, i) => (h.double ? 0 : i + 1)).filter(Boolean)).toEqual([1, 9, 17, 18]);
    expect(B[0].water.some((w) => w.type === 'stream')).toBe(true);
    expect(B[17].water.some((w) => w.type === 'stream')).toBe(true);
    expect(B.filter((h) => h.sea).length).toBeGreaterThanOrEqual(4);
    expect(B[13].bunkers.some((b) => b.named && b.blobs[0].r > 7)).toBe(true); // the big bunker on the 14th
    for (const h of B) for (const b of h.bunkers) expect(b.blobs[0].r).toBeLessThanOrEqual(7.5); // pots
    expect(Math.max(...B.map((h) => h.green.radius))).toBeGreaterThan(Math.max(...A.map((h) => h.green.radius)));
    // Conditions: bounded, faster greens at Augusta, firmer turf at St Andrews; invented courses untouched.
    for (const c of COURSES.filter((x) => !x.real)) expect(conditionedProps(courseConditions(c))).toBe(null);
    const ca = conditionedProps(courseConditions(aug)), cs = conditionedProps(courseConditions(sa));
    expect(ca(S.GREEN).rollDecel).toBeLessThan(surfaceProps(S.GREEN).rollDecel);
    expect(cs(S.FAIRWAY).rollDecel).toBeLessThan(surfaceProps(S.FAIRWAY).rollDecel);
    expect(ca(S.GREEN).rollDecel).toBeLessThan(cs(S.GREEN).rollDecel);
    expect(courseConditions({ conditions: { greenSpeed: 9, firmness: -3 } })).toEqual({ greenSpeed: CONDITION_LIMITS.greenSpeed[1], firmness: CONDITION_LIMITS.firmness[0] });
    expect(ca(S.WATER)).toBe(surfaceProps(S.WATER));
  });
  it('pointAt extrapolates past both ends and resample keeps spacing', () => {
    const h = generateHole(COURSES[0], 0);
    const p = pointAt(h.line, -10), q = pointAt(h.line, h.length + 10);
    expect(Math.hypot(p.x - h.line[0].x, p.z - h.line[0].z)).toBeCloseTo(10, 3);
    expect(Math.hypot(q.x - h.green.x, q.z - h.green.z)).toBeCloseTo(10, 3);
    const r = resample([{ x: 0, z: 0 }, { x: 0, z: -100 }], 4);
    for (let i = 1; i < r.length - 1; i++) expect(r[i].s - r[i - 1].s).toBeCloseTo(4, 6);
    expect(r[r.length - 1].z).toBeCloseTo(-100, 6);
  });
  it('pinOf wraps any index', () => {
    const h = generateHole(COURSES[0], 2);
    expect(pinOf(h, h.pins.length)).toBe(h.pins[0]);
    expect(pinOf(h, -1)).toBe(h.pins[h.pins.length - 1]);
  });
});

describe('terrain: the one surface and elevation function', () => {
  const terrains = [];
  for (const course of FLAGSHIP) for (let i = 0; i < 18; i++) terrains.push({ course, i });
  const built = new Map();
  const get = (course, i) => {
    const k = course.id + i;
    if (!built.has(k)) built.set(k, buildTerrain(course, getHole(course, i)));
    return built.get(k);
  };

  it('all 54 flagship holes build finite terrain with the tee on a tee box and the pin on the green', () => {
    for (const { course, i } of terrains) {
      const t = get(course, i);
      for (let k = 0; k < t.height.length; k += 37) expect(Number.isFinite(t.height[k])).toBe(true);
      const label = `${course.id} hole ${i + 1}`;
      expect(t.surfaceAt(t.tee.x, t.tee.z), label + ' tee').toBe(SURFACES.TEE);
      expect(t.surfaceAt(t.pin.x, t.pin.z), label + ' pin').toBe(SURFACES.GREEN);
      expect(t.pins.length).toBeGreaterThan(0);
      for (const p of t.pins) expect(t.surfaceAt(p.x, p.z), label + ' pin candidate').toBe(SURFACES.GREEN);
      expect(t.isOutOfBounds(t.tee.x, t.tee.z)).toBe(false);
      expect(t.isOutOfBounds(t.pin.x, t.pin.z)).toBe(false);
      // The tee box is level and the green is puttable (under 6 percent at every pin).
      const n = {};
      t.normalAt(t.tee.x, t.tee.z, n);
      expect(n.y, label + ' tee flat').toBeGreaterThan(0.999);
      for (const p of t.pins) { t.normalAt(p.x, p.z, n); expect(Math.hypot(n.x, n.z) / n.y, label + ' pin slope').toBeLessThan(0.06); }
    }
  }, 120000);

  it('the fairway centerline is fairway, never water or sand, on par 4s and 5s', () => {
    for (const { course, i } of terrains) {
      const t = get(course, i), h = t.hole;
      if (h.par === 3) continue;
      let fair = 0, total = 0;
      for (let s = h.fwStart + 20; s < h.fwEnd - 20; s += 6) {
        const p = pointAt(h.line, s);
        const surf = t.surfaceAt(p.x, p.z);
        total++;
        if (surf === SURFACES.FAIRWAY) fair++;
        expect(surf, `${course.id} ${i + 1} at s=${s.toFixed(0)}`).not.toBe(SURFACES.BUNKER);
      }
      // A stream may cross, everything else on the line is fairway.
      expect(fair / total, `${course.id} ${i + 1}`).toBeGreaterThan(0.9);
    }
  }, 120000);

  it('height matches the render mesh triangulation exactly at vertices and on the diagonal', () => {
    const t = get(FLAGSHIP[0], 2);
    for (let q = 0; q < 400; q++) {
      const ix = 5 + ((q * 37) % (t.nx - 10)), iz = 5 + ((q * 91) % (t.nz - 10));
      const k = iz * t.nx + ix;
      const x = t.x0 + ix, z = t.z0 + iz;
      expect(t.heightAt(x, z)).toBeCloseTo(t.height[k], 5);
      // Midpoint of the shared diagonal (x+1, z) to (x, z+1).
      expect(t.heightAt(x + 0.5, z + 0.5)).toBeCloseTo((t.height[k + 1] + t.height[k + t.nx]) / 2, 5);
      // Inside the lower triangle the surface is the plane through its three vertices.
      expect(t.heightAt(x + 0.25, z + 0.25)).toBeCloseTo(t.height[k] + (t.height[k + 1] - t.height[k]) * 0.25 + (t.height[k + t.nx] - t.height[k]) * 0.25, 5);
    }
  });

  it('surfaceAt agrees with the mask bytes the renderer uploads, at texel centers', () => {
    // The shader classifies a fragment as the top-most mask at or above 0.5. At a texel center
    // bilinear filtering returns that texel's byte exactly, so the two must agree everywhere.
    for (const course of FLAGSHIP) {
      const t = get(course, 1);
      const order = SURFACE_ORDER;
      const ids = { bunker: SURFACES.BUNKER, green: SURFACES.GREEN, tee: SURFACES.TEE, fringe: SURFACES.FRINGE, path: SURFACES.PATH, fairway: SURFACES.FAIRWAY, firstCut: SURFACES.FIRST_CUT, rock: SURFACES.ROCK, shore: SURFACES.WETLAND, dirt: SURFACES.DIRT, waste: SURFACES.WASTE, deep: SURFACES.DEEP_ROUGH };
      let checked = 0;
      for (let k = 0; k < t.nx * t.nz; k += 13) {
        const ix = k % t.nx, iz = (k / t.nx) | 0;
        if (ix >= t.nx - 1 || iz >= t.nz - 1) continue;
        let want = SURFACES.ROUGH;
        for (const name of order) if (t.masks[name][k] >= 127.5) { want = ids[name]; break; }
        expect(t.groundSurfaceAt(t.x0 + ix, t.z0 + iz)).toBe(want);
        checked++;
      }
      expect(checked).toBeGreaterThan(5000);
    }
  });

  it('mask edges sit on the layout geometry to within a few centimeters', () => {
    const t = get(FLAGSHIP[0], 0), g = t.hole.green;
    // Walk outward from the green center and find where the mask crosses 0.5.
    for (let a = 0; a < 6.28; a += 0.7) {
      let lo = 0, hi = g.maxR + 6;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if (t.maskAt('green', g.x + Math.cos(a) * mid, g.z + Math.sin(a) * mid) >= 0.5) lo = mid; else hi = mid;
      }
      expect(Math.abs(greenSdf(g, g.x + Math.cos(a) * lo, g.z + Math.sin(a) * lo))).toBeLessThan(0.12);
    }
    expect(RAMP).toBeGreaterThan(1);
  });

  it('water is water for the physics exactly where the ground is below the water level', () => {
    let seen = 0;
    for (const { course, i } of terrains) {
      const t = get(course, i);
      for (const b of t.bodies) {
        if (b.type === 'sea') continue;
        const c = b.source.type === 'pond' ? b.source.blobs[0] : b.source.pts[Math.floor(b.source.pts.length / 2)];
        if (!t.inBounds(c.x, c.z, 4)) continue;
        expect(t.heightAt(c.x, c.z), `${course.id} ${i + 1} bed`).toBeLessThan(b.level);
        expect(t.surfaceAt(c.x, c.z)).toBe(SURFACES.WATER);
        seen++;
      }
      // No bunker is ever flooded.
      for (const bk of t.hole.bunkers) expect(t.surfaceAt(bk.blobs[0].x, bk.blobs[0].z), `${course.id} ${i + 1} bunker`).toBe(SURFACES.BUNKER);
    }
    expect(seen).toBeGreaterThan(5);
  }, 120000);

  it('bunkers are bowls with a lip', () => {
    const t = get(FLAGSHIP[0], 0);
    const b = t.hole.bunkers[0].blobs[0];
    const floor = t.heightAt(b.x, b.z);
    let rim = -1e9;
    for (let a = 0; a < 6.28; a += 0.3) rim = Math.max(rim, t.heightAt(b.x + Math.cos(a) * (b.r + 1), b.z + Math.sin(a) * (b.r + 1)));
    expect(rim - floor).toBeGreaterThan(0.45);
  });
  it('bunkers have depth, a lip, a broken edge, and an interior field on every flagship hole', () => {
    for (const course of FLAGSHIP) for (let i = 0; i < 18; i += 3) {
      const t = get(course, i);
      for (const bk of t.hole.bunkers) {
        const b = bk.blobs[0];
        // Lip to floor: the highest ground just outside the sand against the floor.
        const floor = t.heightAt(b.x, b.z);
        let rim = -1e9;
        for (let a = 0; a < 6.28; a += 0.2) rim = Math.max(rim, t.heightAt(b.x + Math.cos(a) * (b.r + 0.8), b.z + Math.sin(a) * (b.r + 0.8)));
        expect(rim - floor, `${course.id} ${i + 1}`).toBeGreaterThan(0.7);
        // The sand edge is not a circle: along rays from the center it wanders.
        const radii = [];
        for (let a = 0; a < 6.28; a += 0.26) {
          let r = 0;
          while (r < b.r * 2.5 && t.groundSurfaceAt(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r) === SURFACES.BUNKER) r += 0.1;
          radii.push(r);
        }
        const mean = radii.reduce((x, y) => x + y, 0) / radii.length;
        const sd = Math.sqrt(radii.reduce((x, y) => x + (y - mean) ** 2, 0) / radii.length);
        if (bk.blobs.length === 1) expect(sd / mean, `${course.id} ${i + 1} edge`).toBeGreaterThan(0.02);
        // The interior field the renderer uses for the damp band is set inside the sand.
        const k = Math.round((b.z - t.z0) / t.cell) * t.nx + Math.round((b.x - t.x0) / t.cell);
        expect(t.bunkerIn[k]).toBeGreaterThan(60);
      }
    }
  });

  it('a simulated drive on the real terrain lands, rolls, and stops in bounds with no NaN', () => {
    for (const course of FLAGSHIP) {
      for (const i of [0, 4, 9, 17]) {
        const t = get(course, i);
        const aim = Math.atan2(t.hole.line[40].x - t.tee.x, -(t.hole.line[40].z - t.tee.z));
        const club = t.hole.par === 3 ? CLUB_BY_ID.I7 : CLUB_BY_ID.DR;
        const launch = computeLaunch({ power: 1, face: 0, path: 0, tempoQuality: 1 }, { club, lie: SURFACES.TEE, aim, x: t.tee.x, z: t.tee.z });
        const r = simulateShot(launch, t.env());
        expect(r.nan).toBeUndefined();
        expect(Number.isFinite(r.end.x + r.end.y + r.end.z)).toBe(true);
        expect(r.total).toBeGreaterThan(100);
        expect(r.duration).toBeLessThan(60);
        // The ball rests on the ground it reports.
        if (!r.water && !r.holed) expect(Math.abs(r.end.y - (t.heightAt(r.end.x, r.end.z) + 0.02135))).toBeLessThan(0.01);
      }
    }
  }, 120000);

  it('builds in a reasonable time', () => {
    const t0 = performance.now();
    buildTerrain(FLAGSHIP[0], getHole(FLAGSHIP[0], 8));
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

describe('terrain layers', () => {
  it('every course maps all 13 surfaces to shipped texture sets', () => {
    for (const c of COURSES) {
      const { surfaces, sets } = layersFor(c.id, manifest);
      expect(surfaces.map((s) => s.slot)).toEqual(SURFACE_SLOTS);
      expect(SURFACE_SLOTS.length).toBe(MASKS.length + 1);
      expect(sets.length).toBeLessThanOrEqual(11);
      for (const s of surfaces) {
        expect(manifest.textures[s.set], `${c.id} ${s.slot} -> ${s.set}`).toBeDefined();
        expect(s.layer).toBe(sets.indexOf(s.set));
        expect(s.scale).toBeGreaterThan(0.5);
      }
    }
  });
  it('the shader paints masks in the same order the physics resolves them', () => {
    // Painter's order bottom to top is MASKS; physics priority is top to bottom.
    expect([...MASKS].reverse()).toEqual(SURFACE_ORDER);
  });
});
