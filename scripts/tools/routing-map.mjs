// Draw each course's routing as a top-down picture: every hole's corridor (the band the gap
// rule keeps 60 m apart), its fairway, green and tee, the hole numbers, the clubhouse, the walk
// from each green to the next tee, coastlines along coastal holes, and for the two real courses
// the real tee to green lines (thin, dashed) for comparison. Also prints the routing's numbers.
//   node scripts/tools/routing-map.mjs <outDir> [courses]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { COURSES, courseById } from '../../src/course/courses.js';
import { getHole } from '../../src/course/layout.js';
import { courseRouting, computeRouting, routingProblems, routingStats, toWorld } from '../../src/course/routing.js';
import { REAL_ROUTING } from '../../src/course/realRouting.js';

const [outDir = 'qa/tmp/routing', courseArg = COURSES.map((c) => c.id).join(',')] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const summary = [];
for (const id of courseArg.split(',')) {
  const course = courseById(id);
  // The time to solve it from scratch, then the routing the game uses (the stored frames).
  const t0 = performance.now();
  const solved = computeRouting(course);
  const ms = Math.round(performance.now() - t0);
  const r = courseRouting(course);
  const fresh = JSON.stringify(solved.routing) === JSON.stringify(r);
  const problems = routingProblems(course, r), stats = routingStats(course, r);
  const real = REAL_ROUTING[id] || null;
  const b = { ...r.bounds };
  if (real) for (const h of real.holes) for (const p of [h.tee, h.green]) { b.minX = Math.min(b.minX, p[0] - 60); b.maxX = Math.max(b.maxX, p[0] + 60); b.minZ = Math.min(b.minZ, p[1] - 60); b.maxZ = Math.max(b.maxZ, p[1] + 60); }
  const pad = 40, scale = Math.min(1600 / (b.maxX - b.minX), 1600 / (b.maxZ - b.minZ));
  const W = Math.round((b.maxX - b.minX) * scale + pad * 2), H = Math.round((b.maxZ - b.minZ) * scale + pad * 2);
  const X = (x) => ((x - b.minX) * scale + pad).toFixed(1), Y = (z) => ((z - b.minZ) * scale + pad).toFixed(1);
  const parts = [`<rect width="${W}" height="${H}" fill="#203024"/>`];
  const holes = r.holes.map((h, i) => ({ h, hole: getHole(course, i) }));
  // Corridors, then fairways, greens and tees.
  for (const { h } of holes) parts.push(`<polyline points="${h.line.map((p) => `${X(p.x)},${Y(p.z)}`).join(' ')}" fill="none" stroke="#3c5a3c" stroke-width="${(h.corridor * 2 * scale).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`);
  for (const { h, hole } of holes) {
    const f = { x: h.x, z: h.z, heading: h.heading };
    // Coastline along a coastal hole's length.
    if (hole.sea) {
      const pts = [];
      for (let i = 0; i < hole.line.length; i += 5) {
        const p = hole.line[i], q = hole.line[Math.min(hole.line.length - 1, i + 1)], d = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        const nx = -(q.z - p.z) / d, nz = (q.x - p.x) / d;
        const w = toWorld(f, p.x + nx * hole.sea.offset * hole.sea.side, p.z + nz * hole.sea.offset * hole.sea.side);
        pts.push(`${X(w.x)},${Y(w.z)}`);
      }
      parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#5aa7d8" stroke-width="5" stroke-dasharray="10 6"/>`);
    }
    const fw = [];
    for (let i = 0; i < hole.line.length; i += 3) if (hole.half[i] > 0) { const w = toWorld(f, hole.line[i].x, hole.line[i].z); fw.push(`${X(w.x)},${Y(w.z)}`); } else if (fw.length && fw[fw.length - 1] !== '|') fw.push('|');
    for (const seg of fw.join(' ').split('|')) if (seg.trim()) parts.push(`<polyline points="${seg.trim()}" fill="none" stroke="#7fbf5a" stroke-width="${(hole.baseHalf * 2 * scale).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    const g = toWorld(f, hole.green.x, hole.green.z);
    parts.push(`<circle cx="${X(g.x)}" cy="${Y(g.z)}" r="${(hole.green.radius * scale).toFixed(1)}" fill="#a6e07a"/>`);
    parts.push(`<circle cx="${X(h.x)}" cy="${Y(h.z)}" r="5" fill="#f2f2e8"/>`);
  }
  // Walks from each green to the next tee.
  for (let i = 1; i < holes.length; i++) parts.push(`<line x1="${X(holes[i - 1].h.green.x)}" y1="${Y(holes[i - 1].h.green.z)}" x2="${X(holes[i].h.x)}" y2="${Y(holes[i].h.z)}" stroke="#f2d27a" stroke-width="2" stroke-dasharray="4 4"/>`);
  if (real) real.holes.forEach((q, i) => {
    parts.push(`<line x1="${X(q.tee[0])}" y1="${Y(q.tee[1])}" x2="${X(q.green[0])}" y2="${Y(q.green[1])}" stroke="#ff7a7a" stroke-width="2" stroke-dasharray="6 4"/>`);
    parts.push(`<text x="${X(q.green[0])}" y="${Y(q.green[1])}" fill="#ff9a9a" font-size="14" font-family="sans-serif">${i + 1}</text>`);
  });
  for (const { h } of holes) {
    const m = h.line[Math.floor(h.line.length / 2)];
    parts.push(`<circle cx="${X(m.x)}" cy="${Y(m.z)}" r="13" fill="#10181a" opacity="0.85"/><text x="${X(m.x)}" y="${(+Y(m.z) + 5).toFixed(1)}" fill="#fff" font-size="15" font-weight="700" font-family="sans-serif" text-anchor="middle">${h.number}</text>`);
  }
  parts.push(`<rect x="${(+X(r.clubhouse.x) - 9).toFixed(1)}" y="${(+Y(r.clubhouse.z) - 9).toFixed(1)}" width="18" height="18" fill="#e8b36a" stroke="#000"/>`);
  parts.push(`<text x="12" y="24" fill="#fff" font-size="18" font-family="sans-serif">${course.name} (${r.source}): ${problems.length} problems, least gap ${stats.minGap} m (holes ${stats.minPair}), 200 m = ${(200 * scale).toFixed(0)} px</text>`);
  parts.push(`<line x1="12" y1="36" x2="${(12 + 200 * scale).toFixed(1)}" y2="36" stroke="#fff" stroke-width="3"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `${id}.png`));
  // For the real courses: how far each hole's direction and green moved from the real ones.
  let dev = null;
  if (real) {
    dev = real.holes.map((q, i) => {
      const h = r.holes[i], hr = Math.atan2(q.green[0] - q.tee[0], -(q.green[1] - q.tee[1]));
      const dh = Math.abs(Math.atan2(Math.sin(h.heading - hr), Math.cos(h.heading - hr))) * 180 / Math.PI;
      return { hole: i + 1, headingOff: +dh.toFixed(1), teeOff: Math.round(Math.hypot(h.x - q.tee[0], h.z - q.tee[1])), greenOff: Math.round(Math.hypot(h.green.x - q.green[0], h.green.z - q.green[1])) };
    });
  }
  const row = { course: id, source: r.source, solveMs: ms, nodes: solved.nodes, storedMatchesSolve: fresh, problems, ...stats, deviation: dev };
  summary.push(row);
  console.log(id, r.source, `${ms} ms to solve`, 'nodes', solved.nodes, fresh ? 'stored frames match' : 'STORED FRAMES DIFFER', 'problems', problems.length, 'least gap', stats.minGap, stats.minPair, 'walk home', stats.home, 'size', stats.width, 'x', stats.depth);
  if (dev) console.log('  heading off (deg):', dev.map((d) => d.headingOff).join(' '), '\n  green off (m):', dev.map((d) => d.greenOff).join(' '));
}
writeFileSync(path.join(outDir, 'routing.json'), JSON.stringify(summary, null, 1));
