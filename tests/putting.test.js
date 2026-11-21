import { describe, it, expect } from 'vitest';
import { courseById, COURSES } from '../src/course/courses.js';
import { getHole } from '../src/course/layout.js';
import { buildTerrain, maxCupSlopeFor, CUP_MAX_SLOPE } from '../src/course/terrain.js';
import { courseConditions } from '../src/course/conditions.js';
import { solvePutt, simulatePutt, puttCeiling } from '../src/game/planner.js';
import { simulateShot, CUP_RADIUS, CUP_CAPTURE_SPEED, GRAVITY } from '../src/physics/ball.js';
import { surfaceProps, SURFACES } from '../src/physics/surfaces.js';
import { headingTo } from '../src/core/math.js';

const DEG = Math.PI / 180;
const greenFriction = (course) => surfaceProps(SURFACES.GREEN).rollDecel / courseConditions(course).greenSpeed;
// Gravity along the ground at (x, z), m/s^2, the same as the ball's roll uses.
const pullAt = (t, x, z) => { const n = {}; t.normalAt(x, z, n); return GRAVITY * n.y * Math.hypot(n.x, n.z); };

describe('the Augusta National 17th putt (bot round, Low tier, 390x844)', () => {
  // The cup the round had before the fix, and the putt the bot hit: 0.67 m east of it, on the
  // direct line (the HUD showed no break), at power 0.681 when the HUD suggested 0.69.
  const course = courseById('augusta'), t = buildTerrain(course, getHole(course, 16));
  const OLD_CUP = { x: 7.37990715189114, z: -409.0437648102774 };
  const atOldCup = { ...t, pin: OLD_CUP, env: (extra = {}) => t.env({ cup: OLD_CUP, ...extra }) };
  const from = { x: OLD_CUP.x + Math.sin(91 * DEG) * 0.67, z: OLD_CUP.z - Math.cos(91 * DEG) * 0.67 };

  it('reproduces: it lips out at the edge of the cup and runs about 10 m into the rough', () => {
    const sol = solvePutt(atOldCup, from, OLD_CUP);
    const ceil = puttCeiling(sol.distance, sol.speed);
    expect(sol.speed / ceil).toBeCloseTo(0.69, 2);
    expect(Math.abs(sol.breakM)).toBeLessThan(0.005);
    const r = simulateShot({ x: from.x, z: from.z, speed: 0.681 * ceil, heading: headingTo(from.x, from.z, OLD_CUP.x, OLD_CUP.z), putt: true }, atOldCup.env(), { sampleEvery: 1 });
    // At the cup: inside the radius at 99 percent of it, at about 0.72 m/s, where the
    // capture limit is about 0.21 m/s, so the rule lips it out.
    const p = r.points;
    let k = 4;
    while (k < p.length && Math.hypot(p[k + 1] - OLD_CUP.x, p[k + 3] - OLD_CUP.z) >= CUP_RADIUS) k += 4;
    const d = Math.hypot(p[k + 1] - OLD_CUP.x, p[k + 3] - OLD_CUP.z);
    const v = Math.hypot(p[k + 1] - p[k - 3], p[k + 3] - p[k - 1]) / (p[k] - p[k - 4]);
    expect(d / CUP_RADIUS).toBeGreaterThan(0.95);
    expect(v).toBeGreaterThan(0.65);
    expect(v).toBeLessThan(0.8);
    expect(v).toBeGreaterThan(CUP_CAPTURE_SPEED * Math.sqrt(1 - (d / CUP_RADIUS) ** 2));
    expect(r.events.some((e) => e.type === 'lip')).toBe(true);
    expect(r.holed).toBe(false);
    expect(Math.hypot(r.end.x - OLD_CUP.x, r.end.z - OLD_CUP.z)).toBeGreaterThan(9);
    expect(r.lie).toBe(SURFACES.ROUGH);
  });

  it('the cause: that cup sat on ground steeper than the green can hold a rolling ball on', () => {
    // Gravity along the slope at the old cup beat the green's rolling friction, so a ball
    // moving downhill there never slowed down.
    expect(pullAt(t, OLD_CUP.x, OLD_CUP.z)).toBeGreaterThan(greenFriction(course));
  });
});

describe('cups are cut where a rolling ball slows down (regression)', () => {
  it('fast greens get a flatter limit; the usual and slower greens keep 4.5 percent', () => {
    expect(maxCupSlopeFor(courseById('parkland'))).toBe(CUP_MAX_SLOPE);
    expect(maxCupSlopeFor(courseById('augusta'))).toBeCloseTo(CUP_MAX_SLOPE / 1.28, 6);
    expect(maxCupSlopeFor({ conditions: { greenSpeed: 0.85 } })).toBe(CUP_MAX_SLOPE);
  });

  it('on every hole of every course, every cup is under its limit and gravity there is below the rolling friction', () => {
    for (const course of COURSES.filter((c) => !c.range && c.pars)) {
      const limit = maxCupSlopeFor(course), fr = greenFriction(course);
      for (let i = 0; i < course.pars.length; i++) {
        const t = buildTerrain(course, getHole(course, i));
        for (const p of t.pins) {
          const n = {};
          t.normalAt(p.x, p.z, n);
          const label = `${course.id} hole ${i + 1}`;
          expect(Math.hypot(n.x, n.z) / n.y, label + ' cup slope').toBeLessThan(limit);
          expect(pullAt(t, p.x, p.z), label + ' gravity against friction').toBeLessThan(fr * 0.85);
        }
      }
    }
  }, 120000);

  it("short putts at Augusta's 17th now stay near the cup when missed", () => {
    const course = courseById('augusta'), t = buildTerrain(course, getHole(course, 16)), pin = t.pin;
    let putts = 0, holed = 0, worst = 0;
    for (const dist of [0.5, 0.67, 1]) for (let a = 0; a < 360; a += 30) {
      const from = { x: pin.x + Math.sin(a * DEG) * dist, z: pin.z - Math.cos(a * DEG) * dist };
      if (t.surfaceAt(from.x, from.z) !== SURFACES.GREEN) continue;
      const sol = solvePutt(t, from, pin);
      for (const f of [0.95, 1, 1.05]) for (const o of [-1, 0, 1]) {
        const r = simulatePutt(t, from, sol.heading + o * DEG, sol.speed * f);
        putts++;
        if (r.holed) holed++;
        else worst = Math.max(worst, Math.hypot(r.end.x - pin.x, r.end.z - pin.z));
      }
    }
    expect(putts).toBeGreaterThan(250);
    expect(holed / putts).toBeGreaterThan(0.6);
    expect(worst).toBeLessThan(2);
  }, 60000);
});
