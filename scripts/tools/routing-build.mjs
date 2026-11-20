// Solve the routing of every built-in course and write the frames to src/course/routingData.js,
// so the game never runs the search on a phone. tests/routing.test.js solves them again and
// fails if this file is out of date (for example after a change to the hole generator).
//   node scripts/tools/routing-build.mjs
import { writeFileSync } from 'node:fs';
import { COURSES } from '../../src/course/courses.js';
import { computeRouting } from '../../src/course/routing.js';

const lines = [
  '// Each built-in course\'s routing (course/routing.js): per hole the back tee\'s world position and',
  '// the heading of its frame, and the clubhouse. Written by scripts/tools/routing-build.mjs from',
  '// the routing search; tests/routing.test.js checks it against a fresh search. Do not edit.',
  'export const ROUTING_DATA = Object.freeze({',
];
for (const c of COURSES) {
  const t0 = performance.now();
  const { routing, nodes } = computeRouting(c);
  console.log(c.id, routing.source, Math.round(performance.now() - t0), 'ms', nodes, 'nodes');
  const frames = routing.holes.map((h) => `[${h.x}, ${h.z}, ${h.heading}]`).join(', ');
  lines.push(`  ${c.id}: Object.freeze({ seed: ${c.seed}, source: '${routing.source}', clubhouse: [${routing.clubhouse.x}, ${routing.clubhouse.z}], frames: [${frames}] }),`);
}
lines.push('});', '');
writeFileSync(new URL('../../src/course/routingData.js', import.meta.url), lines.join('\n'));
