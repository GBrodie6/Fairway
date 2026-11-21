// Short putts on the steepest greens of every course, in Node (the game's own terrain, putt
// solver and ball simulation, no browser): for each course, the 3 holes whose pin sits on the
// steepest ground; from 0.3, 0.5, 0.75, 1, 1.5 and 2 m in 24 directions around the pin, the
// solver's read (the HUD's line and pace) is putted 9 ways (pace x0.95, x1 and x1.05, line
// -1, 0 and +1 degree), plus the direct line at the solver's pace (what a player who does not
// read the break hits). Reports how many are holed, how many lip out, and how far misses and
// lip-outs run, with the slope at each pin against what the green's rolling friction can hold.
//   node scripts/tools/putt-survey.mjs <out.json> [courses]
//   HOLES=augusta:17,6 surveys those holes of that course instead of its 3 steepest.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { courseById } from '../../src/course/courses.js';
import { getHole } from '../../src/course/layout.js';
import { buildTerrain } from '../../src/course/terrain.js';
import { courseConditions } from '../../src/course/conditions.js';
import { solvePutt, simulatePutt } from '../../src/game/planner.js';
import { headingTo } from '../../src/core/math.js';
import { surfaceProps, SURFACES } from '../../src/physics/surfaces.js';
import { GRAVITY } from '../../src/physics/ball.js';

const [outFile = 'qa/tmp/putt-survey.json', courseArg = 'parkland,links,desert,alpine,tropical,augusta,standrews'] = process.argv.slice(2);
mkdirSync(path.dirname(outFile), { recursive: true });
const DISTS = [0.3, 0.5, 0.75, 1, 1.5, 2], DIRS = 24, DEG = Math.PI / 180;
const slopeOf = (t, x, z) => { const o = {}; t.normalAt(x, z, o); return { s: Math.hypot(o.x, o.z) / o.y, pull: GRAVITY * o.y * Math.hypot(o.x, o.z) }; };
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))].toFixed(2); };

const out = { when: new Date().toISOString(), dists: DISTS, dirs: DIRS, courses: [] };
for (const id of courseArg.split(',')) {
  const course = courseById(id), cond = courseConditions(course);
  const friction = surfaceProps(SURFACES.GREEN).rollDecel / cond.greenSpeed;
  // Every hole's pin: slope there and the steepest ground within 2 m of it.
  const holes = [];
  for (let i = 0; i < course.pars.length; i++) {
    const t = buildTerrain(course, getHole(course, i));
    const p = slopeOf(t, t.pin.x, t.pin.z);
    let ring = 0;
    for (let r = 0.3; r <= 2.01; r += 0.3) for (let k = 0; k < 24; k++) { const a = (k / 24) * 2 * Math.PI; ring = Math.max(ring, slopeOf(t, t.pin.x + Math.sin(a) * r, t.pin.z - Math.cos(a) * r).s); }
    holes.push({ hole: i + 1, t, pinSlope: p.s, pull: p.pull, ring2m: ring });
  }
  holes.sort((a, b) => b.pinSlope - a.pinSlope || b.ring2m - a.ring2m);
  const row = { course: id, greenSpeed: cond.greenSpeed, friction: +friction.toFixed(4), holdSlope: null, pins: holes.map((h) => ({ hole: h.hole, pinSlopePct: +(h.pinSlope * 100).toFixed(2), ring2mPct: +(h.ring2m * 100).toFixed(2), pullOverFriction: +(h.pull / friction).toFixed(3) })), greens: [] };
  // The steepest slope on which a rolling ball still slows down (gravity along it = friction).
  row.holdSlope = +((friction / GRAVITY) * 100).toFixed(2);
  const forced = (process.env.HOLES || '').startsWith(`${id}:`) ? process.env.HOLES.slice(id.length + 1).split(',').map(Number) : null;
  const chosen = forced ? forced.map((n) => holes.find((h) => h.hole === n)) : holes.slice(0, 3);
  for (const h of chosen) {
    const t = h.t, pin = t.pin;
    const g = { hole: h.hole, pinSlopePct: +(h.pinSlope * 100).toFixed(2), ring2mPct: +(h.ring2m * 100).toFixed(2), putts: 0, holed: 0, lipOuts: 0, lipRuns: [], missRuns: [], over2m: 0, over5m: 0, offGreen: 0, byDist: {} };
    for (const d of DISTS) {
      const bd = { putts: 0, holed: 0, lipOuts: 0, over2m: 0, maxRun: 0 };
      for (let k = 0; k < DIRS; k++) {
        const a = (k / DIRS) * 2 * Math.PI;
        const from = { x: pin.x + Math.sin(a) * d, z: pin.z - Math.cos(a) * d };
        if (t.surfaceAt(from.x, from.z) !== SURFACES.GREEN) continue;
        const sol = solvePutt(t, from, pin);
        const tries = [];
        for (const f of [0.95, 1, 1.05]) for (const o of [-1, 0, 1]) tries.push([sol.heading + o * DEG, sol.speed * f]);
        tries.push([headingTo(from.x, from.z, pin.x, pin.z), sol.speed]);
        for (const [hd, v] of tries) {
          const r = simulatePutt(t, from, hd, v);
          const lip = r.events.some((e) => e.type === 'lip');
          const run = r.holed ? 0 : Math.hypot(r.end.x - pin.x, r.end.z - pin.z);
          g.putts++; bd.putts++;
          if (r.holed) { g.holed++; bd.holed++; continue; }
          if (lip) { g.lipOuts++; bd.lipOuts++; g.lipRuns.push(run); } else g.missRuns.push(run);
          if (run > 2) { g.over2m++; bd.over2m++; }
          if (run > 5) g.over5m++;
          if (r.lie !== SURFACES.GREEN) g.offGreen++;
          bd.maxRun = Math.max(bd.maxRun, +run.toFixed(2));
        }
      }
      g.byDist[d] = bd;
    }
    g.lipRun = { median: pct(g.lipRuns, 0.5), p90: pct(g.lipRuns, 0.9), max: pct(g.lipRuns, 1) };
    g.missRun = { median: pct(g.missRuns, 0.5), p90: pct(g.missRuns, 0.9), max: pct(g.missRuns, 1) };
    delete g.lipRuns; delete g.missRuns;
    row.greens.push(g);
    console.log(`${id} hole ${g.hole}: pin ${g.pinSlopePct}% (within 2 m up to ${g.ring2mPct}%), friction holds ${row.holdSlope}%: ${g.putts} putts, holed ${g.holed}, lip-outs ${g.lipOuts} (run median ${g.lipRun.median} m, max ${g.lipRun.max} m), misses past 2 m ${g.over2m}, past 5 m ${g.over5m}, off the green ${g.offGreen}`);
  }
  out.courses.push(row);
  writeFileSync(outFile, JSON.stringify(out, null, 1));
}
