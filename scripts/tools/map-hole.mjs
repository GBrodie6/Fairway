// Dev tool: renders top-down maps of generated holes (surface colors with hillshade) to a
// contact sheet, straight from the terrain arrays. Usage: node scripts/tools/map-hole.mjs parkland 1,2,3
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { courseById } from '../../src/course/courses.js';
import { getHole } from '../../src/course/layout.js';
import { buildTerrain } from '../../src/course/terrain.js';
import { SURFACES } from '../../src/physics/surfaces.js';

const course = courseById(process.argv[2] || 'parkland');
const holes = (process.argv[3] || '1,2,3,4,5,6').split(',').map(Number);
const out = process.argv[4] || `qa/tmp/map-${course.id}.jpg`;
const COL = {
  [SURFACES.ROUGH]: [70, 120, 52], [SURFACES.DEEP_ROUGH]: [52, 92, 44], [SURFACES.FIRST_CUT]: [92, 150, 60], [SURFACES.FAIRWAY]: [118, 178, 70],
  [SURFACES.FRINGE]: [110, 190, 84], [SURFACES.GREEN]: [140, 214, 100], [SURFACES.TEE]: [130, 200, 96], [SURFACES.BUNKER]: [232, 214, 168],
  [SURFACES.DIRT]: [140, 108, 76], [SURFACES.PATH]: [190, 186, 176], [SURFACES.WETLAND]: [96, 96, 70], [SURFACES.WATER]: [56, 110, 170],
  [SURFACES.WASTE]: [172, 128, 84], [SURFACES.ROCK]: [120, 112, 104],
};
const tiles = [];
const H = 560;
for (const num of holes) {
  const hole = getHole(course, num - 1);
  const t0 = performance.now();
  const t = buildTerrain(course, hole);
  const ms = performance.now() - t0;
  const buf = Buffer.alloc(t.nx * t.nz * 3);
  let hmin = 1e9, hmax = -1e9;
  for (let k = 0; k < t.height.length; k++) { if (t.height[k] < hmin) hmin = t.height[k]; if (t.height[k] > hmax) hmax = t.height[k]; }
  for (let iz = 0; iz < t.nz; iz++) for (let ix = 0; ix < t.nx; ix++) {
    const k = iz * t.nx + ix;
    const x = t.x0 + ix, z = t.z0 + iz;
    const c = COL[t.surfaceAt(x, z)] || [255, 0, 255];
    const shade = 0.72 + 0.9 * (-t.normalX[k] * 0.6 - t.normalZ[k] * 0.6) + (t.trees[k] / 255) * -0.12;
    const o = (iz * t.nx + ix) * 3;
    for (let q = 0; q < 3; q++) buf[o + q] = Math.max(0, Math.min(255, c[q] * shade));
  }
  const dot = (x, z, col) => { const ix = Math.round(x - t.x0), iz = Math.round(z - t.z0); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const o = ((iz + a) * t.nx + ix + b) * 3; buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; } };
  dot(t.pin.x, t.pin.z, [255, 40, 40]); dot(t.tee.x, t.tee.z, [255, 255, 255]);
  const w = Math.round((t.nx / t.nz) * H);
  const label = Buffer.from(`<svg width="${Math.max(w, 150)}" height="34" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="34" fill="#111"/><text x="4" y="14" font-family="sans-serif" font-size="12" fill="#fff">#${num} par ${hole.par} ${hole.yards}y ${hole.mowing}</text><text x="4" y="29" font-family="sans-serif" font-size="11" fill="#bbb">${t.nx}x${t.nz} ${ms.toFixed(0)}ms dz ${(hmax - hmin).toFixed(0)}m b${hole.bunkers.length} w${hole.water.length}${hole.sea ? ' sea' : ''}</text></svg>`);
  const img = await sharp(buf, { raw: { width: t.nx, height: t.nz, channels: 3 } }).resize(w, H).png().toBuffer();
  tiles.push({ w: Math.max(w, 150), buf: await sharp({ create: { width: Math.max(w, 150), height: H + 34, channels: 3, background: '#111' } }).composite([{ input: img, top: 0, left: 0 }, { input: label, top: H, left: 0 }]).png().toBuffer() });
}
const W = tiles.reduce((a, t) => a + t.w + 6, 0);
let x = 0;
mkdirSync('qa/tmp', { recursive: true });
await sharp({ create: { width: W, height: H + 34, channels: 3, background: '#000' } }).composite(tiles.map((t) => { const c = { input: t.buf, left: x, top: 0 }; x += t.w + 6; return c; })).jpeg({ quality: 86 }).toFile(out);
console.log('wrote', out);
