// Terrain builder. Turns a hole layout into ONE heightfield and ONE set of surface masks.
// The renderer uploads these arrays as textures and vertices; the physics queries the very
// same arrays through heightAt / normalAt / surfaceAt. There is no second copy of the course.
//
// Grid: 1 m cells, tier independent, so the ball behaves identically on every device.
// Masks are signed-distance ramps stored in bytes: 0.5 (127.5) is the exact edge, which keeps
// edges sub-texel accurate under bilinear filtering for both the shader and surfaceAt.
import { fbm2, valueNoise2 } from '../core/rng.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { SURFACES } from '../physics/surfaces.js';
import { blobSdf, greenSdf, teeSdf, polylineDist } from './layout.js';

export const CELL = 1;
export const RAMP = 1.5; // meters each side of an edge covered by a mask ramp
const NO_WATER = -1e9;

// Mask channels, in painter's order from bottom to top. The base (rough) is implicit.
export const MASKS = ['deep', 'waste', 'dirt', 'shore', 'rock', 'firstCut', 'fairway', 'path', 'fringe', 'tee', 'green', 'bunker'];
// Physics priority: the top-most mask that covers the point wins. Same order as the shader.
const PRIORITY = [
  ['bunker', SURFACES.BUNKER], ['green', SURFACES.GREEN], ['tee', SURFACES.TEE], ['fringe', SURFACES.FRINGE],
  ['path', SURFACES.PATH], ['fairway', SURFACES.FAIRWAY], ['firstCut', SURFACES.FIRST_CUT], ['rock', SURFACES.ROCK],
  ['shore', SURFACES.WETLAND], ['dirt', SURFACES.DIRT], ['waste', SURFACES.WASTE], ['deep', SURFACES.DEEP_ROUGH],
];
export const SURFACE_ORDER = PRIORITY.map((p) => p[0]);

const toByte = (sdf) => {
  const v = 0.5 - sdf / (2 * RAMP);
  return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
};
// Smooth maximum: equals max(a, b) away from the crossover and rounds the corner near it.
const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k)) - k * 0.5 * Math.exp(-Math.abs(a - b) / k);
const ridged = (x, z, seed, oct) => {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(valueNoise2(x * f, z * f, seed + i * 53));
    sum += n * n * amp; norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
};

// The land beyond the play corridor, as a pure function of position. The outer landscape
// mesh evaluates this directly, so it meets the detailed grid without a seam.
export function makeMacro(course, hole) {
  const th = course.theme;
  const ox = (hole.seed % 9973) * 1.37, oz = ((hole.seed >> 8) % 9973) * 1.91;
  const slopeSign = (hole.seed & 1) ? 1 : -1;
  const slope = (th.slopeAlong * slopeSign * (0.4 + ((hole.seed >> 3) % 100) / 166)) / Math.max(120, hole.length);
  const base = th.baseElevation;
  const seed = hole.seed & 0xffff;
  return function macro(x, z, wild = 1, far = wild) {
    const px = x + ox, pz = z + oz;
    let h = base + fbm2(px / th.macroWave, pz / th.macroWave, seed, 4) * th.macroAmp - z * slope;
    if (wild > 0) {
      if (th.dunes > 0) h += (ridged(px / 58, pz / 58, seed + 7, 3) - 0.35) * th.dunes * wild;
      if (th.mesa > 0) {
        const m = fbm2(px / 210, pz / 210, seed + 21, 3);
        h += (smoothstep(0.1, 0.24, m) * 0.62 + smoothstep(0.3, 0.4, m) * 0.38) * th.mesa * far;
      }
      if (th.macroAmp > 9) h += Math.pow(ridged(px / 190, pz / 190, seed + 33, 3), 2) * th.macroAmp * 0.9 * far;
    }
    return h;
  };
}

export function buildTerrain(course, hole, { pinIndex } = {}) {
  const th = course.theme;
  const { line, bounds, green } = hole;
  const total = hole.length;
  const x0 = bounds.minX, z0 = bounds.minZ;
  const nx = Math.floor((bounds.maxX - bounds.minX) / CELL) + 1;
  const nz = Math.floor((bounds.maxZ - bounds.minZ) / CELL) + 1;
  const n = nx * nz;
  const macro = makeMacro(course, hole);
  const seed = hole.seed & 0xffff;

  const height = new Float32Array(n);
  const sField = new Float32Array(n);
  const tField = new Float32Array(n);
  const outside = new Float32Array(n); // meters beyond the maintained play area (negative inside)
  // waterLevel is strict: only cells in or right at a water body, so a bunker or hollow that
  // happens to sit lower than a nearby pond is not treated as water. nearLevel reaches a few
  // meters further and only drives the wet shoreline band and the tree clearing.
  const waterLevel = new Float32Array(n).fill(NO_WATER);
  const nearLevel = new Float32Array(n).fill(NO_WATER);
  const bodyId = new Uint8Array(n);
  const masks = {};
  for (const m of MASKS) masks[m] = new Uint8Array(n);
  const trees = new Uint8Array(n);

  // --- 1. distance to the centerline: along (s) and signed lateral (t) for every cell ---
  const dist = new Float32Array(n).fill(1e9);
  const REACH = 240;
  const L = line.length;
  for (let i = 0; i < L - 1; i++) {
    const a = line[i], b = line[i + 1];
    const vx = b.x - a.x, vz = b.z - a.z;
    const len = Math.hypot(vx, vz) || 1e-9;
    const ux = vx / len, uz = vz / len;
    const first = i === 0, last = i === L - 2;
    // The end segments extend as rays so s runs negative behind the tee and past the green.
    const ext = REACH;
    const bx0 = Math.min(a.x - (first ? ux * ext : 0), b.x + (last ? ux * ext : 0)) - REACH;
    const bx1 = Math.max(a.x - (first ? ux * ext : 0), b.x + (last ? ux * ext : 0)) + REACH;
    const bz0 = Math.min(a.z - (first ? uz * ext : 0), b.z + (last ? uz * ext : 0)) - REACH;
    const bz1 = Math.max(a.z - (first ? uz * ext : 0), b.z + (last ? uz * ext : 0)) + REACH;
    const ix0 = Math.max(0, Math.floor((bx0 - x0) / CELL)), ix1 = Math.min(nx - 1, Math.ceil((bx1 - x0) / CELL));
    const iz0 = Math.max(0, Math.floor((bz0 - z0) / CELL)), iz1 = Math.min(nz - 1, Math.ceil((bz1 - z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = z0 + iz * CELL - a.z;
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = x0 + ix * CELL - a.x;
        let u = px * ux + pz * uz;
        if (!(first && u < 0) && !(last && u > len)) u = u < 0 ? 0 : u > len ? len : u;
        const ex = px - ux * u, ez = pz - uz * u;
        const d = Math.sqrt(ex * ex + ez * ez);
        const k = iz * nx + ix;
        if (d < dist[k]) {
          dist[k] = d;
          sField[k] = a.s + u;
          // Right of travel is positive: cross of the tangent with the offset.
          tField[k] = (ex * -uz + ez * ux) >= 0 ? d : -d;
        }
      }
    }
  }
  for (let k = 0; k < n; k++) if (dist[k] > 1e8) { dist[k] = REACH; tField[k] = REACH; sField[k] = total / 2; }

  // Per-centerline-sample profiles, interpolated by s.
  const step = hole.lineStep;
  const halfAt = (s) => {
    if (s <= 0 || s >= total) return 0;
    const f = s / step, i = Math.min(L - 2, Math.floor(f));
    return lerp(hole.half[i], hole.half[i + 1], f - i);
  };
  // Centerline elevation profile: the macro land sampled along the line and smoothed, so the
  // hole follows the lie of the land instead of fighting it.
  const rawC = new Float32Array(L);
  for (let i = 0; i < L; i++) rawC[i] = macro(line[i].x, line[i].z, 0);
  const prof = new Float32Array(L);
  const win = Math.round(70 / step);
  for (let i = 0; i < L; i++) {
    let sum = 0, cnt = 0;
    for (let j = -win; j <= win; j++) { const q = clamp(i + j, 0, L - 1); const w = 1 - Math.abs(j) / (win + 1); sum += rawC[q] * w; cnt += w; }
    prof[i] = sum / cnt;
  }
  const profAt = (s) => {
    const f = clamp(s, 0, total) / step, i = Math.min(L - 2, Math.floor(f));
    return lerp(prof[i], prof[i + 1], f - i);
  };

  const gR = green.radius;
  const greenBase = profAt(total) + green.raise;
  // Tilt direction: mostly back to front (falls toward the fairway), rotated by tiltDir.
  const tdc = Math.cos(green.tiltDir), tds = Math.sin(green.tiltDir);
  const tiltX = green.ax * tdc - green.az * tds, tiltZ = green.ax * tds + green.az * tdc;
  const tierDx = green.tier ? green.ax * Math.cos(green.tier.ang) - green.az * Math.sin(green.tier.ang) : 0;
  const tierDz = green.tier ? green.ax * Math.sin(green.tier.ang) + green.az * Math.cos(green.tier.ang) : 0;
  const greenSurface = (x, z) => {
    const dx = x - green.x, dz = z - green.z;
    let h = greenBase + (dx * tiltX + dz * tiltZ) * green.tilt;
    h += fbm2(x / 15, z / 15, green.contourSeed, 2) * 0.17 + fbm2(x / 6.5, z / 6.5, green.contourSeed + 9, 2) * 0.035;
    if (green.tier) h += green.tier.h * smoothstep(-2.8, 2.8, dx * tierDx + dz * tierDz - green.tier.off * gR);
    return h;
  };
  // Mounds and collection hollows around the green.
  const mounds = [];
  {
    let s = green.contourSeed;
    const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const count = 3 + Math.floor(r() * 3);
    for (let i = 0; i < count; i++) {
      const a = 0.9 + r() * (Math.PI * 2 - 1.8), d = gR + 5 + r() * 7;
      const bx = -green.ax, bz = -green.az;
      const dx = bx * Math.cos(a) - bz * Math.sin(a), dz = bx * Math.sin(a) + bz * Math.cos(a);
      const hollow = r() < 0.3;
      mounds.push({ x: green.x + dx * d, z: green.z + dz * d, r: 5 + r() * 4, h: hollow ? -(0.45 + r() * 0.4) : 0.6 + r() * 1.0 });
    }
  }

  const teeH = hole.tees.map((t) => profAt(t.s) + 0.5);
  const sea = hole.sea;
  const seaD = new Float32Array(sea ? n : 0);

  // --- 2. base elevation, corridor shaping, green, tees ---
  for (let iz = 0; iz < nz; iz++) {
    const z = z0 + iz * CELL;
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * CELL;
      const k = iz * nx + ix;
      const s = sField[k], t = tField[k], at = Math.abs(t);
      const hw = halfAt(s);
      const dGreen = Math.hypot(x - green.x, z - green.z);
      // How far outside the maintained area this cell is: lateral, behind the tee, past the green.
      // Smooth union of the three limits, so the edge of the maintained area is a rounded
      // shape rather than a rectangle (hard corners showed up as straight cliff walls).
      const corridor = Math.max(hw, 9) + hole.corridorExtra;
      const out = smax(smax(at - corridor, -s - 24, 26), Math.min(s - total, dGreen) - (gR + hole.corridorExtra + 12), 26);
      outside[k] = out;
      const wild = smoothstep(-6, 34, out);
      // Big relief (mesas, ridges) keeps its distance from the play area.
      // The noise makes canyon walls wander instead of running parallel to the hole.
      const m = macro(x, z, wild, smoothstep(8, 96, out + fbm2(x / 64, z / 64, seed + 41, 3) * 44));
      const c = profAt(s);
      // Inside the corridor the land settles toward the centerline profile.
      const wc = th.corridorFlat * (1 - smoothstep(-14, 30, out));
      let h = lerp(m, c + (m - c) * 0.3, wc);
      // Local undulation fades out toward the grid edge so the detailed ground meets the
      // outer landscape (the bare macro function) without a step.
      const edgeFade = 1 - smoothstep(40, 80, out);
      h += fbm2(x / th.undulationWave, z / th.undulationWave, seed + 3, 3) * th.undulation * (0.45 + 0.55 * (1 - wild)) * edgeFade;
      h += fbm2(x / 9, z / 9, seed + 5, 2) * 0.06 * (0.3 + wild) * edgeFade;
      // Green complex.
      if (dGreen < gR * 1.4 + 26) {
        const gs = greenSdf(green, x, z);
        const wg = 1 - smoothstep(-1.0, 13, gs);
        if (wg > 0) h = lerp(h, greenSurface(x, z), wg * wg * (3 - 2 * wg));
        if (gs > -0.5) {
          const fade = smoothstep(-0.5, 3, gs);
          for (const mo of mounds) {
            const d2 = ((x - mo.x) ** 2 + (z - mo.z) ** 2) / (mo.r * mo.r);
            if (d2 < 6) h += mo.h * Math.exp(-d2 * 1.4) * fade;
          }
        }
      }
      // Tee pads: flat tops with a short bank.
      for (let i = 0; i < hole.tees.length; i++) {
        const tee = hole.tees[i];
        if (Math.abs(x - tee.x) > 16 || Math.abs(z - tee.z) > 16) continue;
        const ts = teeSdf(tee, x, z);
        if (ts < 4.5) h = lerp(h, teeH[i], 1 - smoothstep(0.2, 4.5, ts));
      }
      height[k] = h;
      if (sea) {
        // Signed distance past the coastline, positive toward the water.
        const coast = sea.offset + Math.sin(s / 85 + sea.phase) * sea.wobble + Math.sin(s / 31 + sea.phase * 2) * sea.wobble * 0.35;
        seaD[k] = t * sea.side - coast;
      }
    }
  }

  // --- 3. bunkers: a bowl with a raised lip, higher on the face toward the target ---
  const bunkerSdf = new Float32Array(n).fill(1e9);
  for (const b of hole.bunkers) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, rMin = 1e9;
    for (const c of b.blobs) { minX = Math.min(minX, c.x - c.r); maxX = Math.max(maxX, c.x + c.r); minZ = Math.min(minZ, c.z - c.r); maxZ = Math.max(maxZ, c.z + c.r); rMin = Math.min(rMin, c.r); }
    const pad = 6;
    const ix0 = Math.max(0, Math.floor((minX - pad - x0) / CELL)), ix1 = Math.min(nx - 1, Math.ceil((maxX + pad - x0) / CELL));
    const iz0 = Math.max(0, Math.floor((minZ - pad - z0) / CELL)), iz1 = Math.min(nz - 1, Math.ceil((maxZ + pad - z0) / CELL));
    const cx = b.blobs[0].x, cz = b.blobs[0].z;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = x0 + ix * CELL, z = z0 + iz * CELL, k = iz * nx + ix;
      const d = blobSdf(b.blobs, x, z, 1.6);
      if (d < bunkerSdf[k]) bunkerSdf[k] = d;
      if (d > pad) continue;
      // Which way this point faces from the bunker center, relative to the high face.
      const fx = x - cx, fz = z - cz, fl = Math.hypot(fx, fz) || 1;
      const face = clamp((fx * b.faceX + fz * b.faceZ) / fl, -1, 1);
      if (d < 0) {
        const inner = clamp(-d / (rMin * 0.62), 0, 1);
        // Steeper wall under the high face, shallow entry on the low side.
        const wall = inner * inner * (3 - 2 * inner);
        height[k] -= b.depth * wall * (1 - 0.18 * (face * 0.5 + 0.5) * (1 - inner));
      }
      const lip = b.lip * (0.45 + 0.55 * (face * 0.5 + 0.5));
      const ring = (d - 0.9) / 1.1;
      if (ring > -2.2 && ring < 3) height[k] += lip * Math.exp(-ring * ring);
    }
  }

  // --- 4. water: ponds and streams take their level from the land around them ---
  const bodies = [];
  const sampleH = (x, z) => {
    const fx = clamp((x - x0) / CELL, 0, nx - 1.001), fz = clamp((z - z0) / CELL, 0, nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz, k = iz * nx + ix;
    return (height[k] * (1 - ax) + height[k + 1] * ax) * (1 - az) + (height[k + nx] * (1 - ax) + height[k + nx + 1] * ax) * az;
  };
  for (const w of hole.water) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    const outline = [];
    if (w.type === 'pond') {
      for (const c of w.blobs) {
        minX = Math.min(minX, c.x - c.r); maxX = Math.max(maxX, c.x + c.r); minZ = Math.min(minZ, c.z - c.r); maxZ = Math.max(maxZ, c.z + c.r);
        for (let a = 0; a < 6.28; a += 0.4) outline.push([c.x + Math.cos(a) * c.r, c.z + Math.sin(a) * c.r]);
      }
    } else {
      for (const p of w.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); outline.push([p.x, p.z]); }
    }
    const sdfOf = w.type === 'pond' ? (x, z) => blobSdf(w.blobs, x, z, 3) : (x, z) => polylineDist(w.pts, x, z) - w.half;
    // Level: just under the lowest ground on the outline, so the water never floods uphill.
    let lowest = 1e9;
    for (const [ox, oz] of outline) {
      if (ox < x0 || oz < z0 || ox > x0 + (nx - 1) * CELL || oz > z0 + (nz - 1) * CELL) continue;
      if (sdfOf(ox, oz) < -2) continue;
      lowest = Math.min(lowest, sampleH(ox, oz));
    }
    if (lowest > 1e8) continue;
    const level = lowest - 0.3;
    const pad = 14;
    const ix0 = Math.max(0, Math.floor((minX - pad - x0) / CELL)), ix1 = Math.min(nx - 1, Math.ceil((maxX + pad - x0) / CELL));
    const iz0 = Math.max(0, Math.floor((minZ - pad - z0) / CELL)), iz1 = Math.min(nz - 1, Math.ceil((maxZ + pad - z0) / CELL));
    const bank = w.type === 'pond' ? 9 : 5;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = x0 + ix * CELL, z = z0 + iz * CELL, k = iz * nx + ix;
      const d = sdfOf(x, z);
      if (d > pad) continue;
      // Greens and tees keep their shape: the bank only grades unbuilt ground.
      const keep = Math.max(1 - smoothstep(-1, 5, greenSdf(green, x, z)), 0);
      if (d < bank) {
        const wgt = (1 - smoothstep(0, bank, Math.max(d, 0))) ** 1.5 * (1 - keep);
        height[k] = lerp(height[k], level + 0.12, wgt);
      }
      if (d < 0 && keep < 0.5) {
        const bed = level + 0.12 - w.depth * smoothstep(0, w.type === 'pond' ? 6 : 1.6, -d) - 0.25 * smoothstep(0, 0.9, -d);
        height[k] = Math.min(height[k], bed);
      }
      if (d < pad - 2) nearLevel[k] = Math.max(nearLevel[k], level);
      if (d < 1.2 && level >= waterLevel[k]) { waterLevel[k] = level; bodyId[k] = bodies.length + 1; }
    }
    bodies.push({ type: w.type, level, id: bodies.length + 1, minX: minX - 4, maxX: maxX + 4, minZ: minZ - 4, maxZ: maxZ + 4, ix0, ix1, iz0, iz1, source: w });
  }
  if (sea) {
    for (let k = 0; k < n; k++) {
      const d = seaD[k];
      if (d < -34) continue;
      // Dunes ease down to a beach, then a shallow shelf under the sea.
      const beach = d > 0 ? Math.max(sea.level + 1.1 - d * 0.075, sea.level - 5) : sea.level + 1.1 + (-d) * 0.03;
      height[k] = lerp(height[k], beach, smoothstep(-34, 4, d));
      nearLevel[k] = Math.max(nearLevel[k], sea.level);
      if (d > -3 && sea.level >= waterLevel[k]) { waterLevel[k] = sea.level; bodyId[k] = bodies.length + 1; }
    }
    bodies.push({ type: 'sea', level: sea.level, id: bodies.length + 1, side: sea.side });
  }
  if (th.seaLevel !== null) {
    // Coastal land never dips below the sea away from the shore (the sea plane would show through).
    for (let k = 0; k < n; k++) {
      if (sea && seaD[k] > -6) continue;
      if (waterLevel[k] > NO_WATER + 1) continue;
      const floor = th.seaLevel + 0.7;
      if (height[k] < floor) height[k] = floor + (floor - height[k]) * 0.15;
    }
  }

  // --- 5. vertex normals (central differences). Shared by the shader and the physics. ---
  const normalX = new Float32Array(n), normalZ = new Float32Array(n), slope = new Float32Array(n);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const k = iz * nx + ix;
    const hl = height[iz * nx + Math.max(0, ix - 1)], hr = height[iz * nx + Math.min(nx - 1, ix + 1)];
    const hd = height[Math.max(0, iz - 1) * nx + ix], hu = height[Math.min(nz - 1, iz + 1) * nx + ix];
    const sx = (ix > 0 && ix < nx - 1) ? 2 : 1, sz = (iz > 0 && iz < nz - 1) ? 2 : 1;
    const gx = (hr - hl) / (sx * CELL), gz = (hu - hd) / (sz * CELL);
    const inv = 1 / Math.sqrt(gx * gx + gz * gz + 1);
    normalX[k] = -gx * inv; normalZ[k] = -gz * inv;
    slope[k] = Math.sqrt(gx * gx + gz * gz);
  }

  // --- 6. surface masks ---
  const desert = th.base === 'waste';
  const pathPts = hole.path.pts;
  // Rasterize the cart path distance near the path only.
  const pathD = new Float32Array(n).fill(1e9);
  for (let i = 0; i < pathPts.length - 1; i++) {
    const a = pathPts[i], b = pathPts[i + 1];
    const pad = 6;
    const ix0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - pad - x0) / CELL)), ix1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + pad - x0) / CELL));
    const iz0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - pad - z0) / CELL)), iz1 = Math.min(nz - 1, Math.ceil((Math.max(a.z, b.z) + pad - z0) / CELL));
    const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1e-9;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const px = x0 + ix * CELL - a.x, pz = z0 + iz * CELL - a.z;
      const u = clamp((px * vx + pz * vz) / l2, 0, 1);
      const d = Math.hypot(px - vx * u, pz - vz * u);
      const k = iz * nx + ix;
      if (d < pathD[k]) pathD[k] = d;
    }
  }
  for (let iz = 0; iz < nz; iz++) {
    const z = z0 + iz * CELL;
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * CELL, k = iz * nx + ix;
      const s = sField[k], at = Math.abs(tField[k]);
      const hw = halfAt(s);
      const out = outside[k];
      const fwSdf = hw > 0.4 ? at - hw : 60;
      const dG = Math.hypot(x - green.x, z - green.z);
      const gs = dG < gR * 1.4 + 12 ? greenSdf(green, x, z) : 60;
      masks.fairway[k] = toByte(fwSdf);
      masks.firstCut[k] = toByte(fwSdf - 3.2);
      masks.green[k] = toByte(gs);
      masks.fringe[k] = toByte(gs - 1.9);
      let ts = 60;
      for (const tee of hole.tees) if (Math.abs(x - tee.x) < 14 && Math.abs(z - tee.z) < 14) ts = Math.min(ts, teeSdf(tee, x, z));
      masks.tee[k] = toByte(ts);
      masks.bunker[k] = toByte(bunkerSdf[k]);
      masks.path[k] = toByte(pathD[k] - hole.path.half);
      // Maintained rough ends where the wild ground begins.
      const edgeNoise = fbm2(x / 13, z / 13, seed + 11, 2) * 4.5;
      const roughEdge = out + hole.corridorExtra - hole.roughBand + edgeNoise; // > 0 beyond the rough band
      if (desert) {
        masks.waste[k] = toByte(-roughEdge);
      } else {
        masks.deep[k] = toByte(-roughEdge);
        // Forest floor under the tree line, dune sand on links crests.
        const forest = th.trees.forest > 0 ? out - 7 + edgeNoise : -60;
        // Dune sand shows as scattered blowouts on the crests, not a network.
        const dune = th.dunes > 0 ? (fbm2((x + 31) / 34, (z - 17) / 34, seed + 17, 3) - 0.34) * 46 + Math.min(0, out - 5) * 2 : -60;
        masks.waste[k] = toByte(-Math.max(forest, dune));
      }
      // Worn dirt along the path edge and in scattered patches under trees.
      const wear = fbm2(x / 7, z / 7, seed + 23, 2);
      masks.dirt[k] = toByte(Math.min(pathD[k] - hole.path.half - 0.4 - wear * 1.0, out > 10 && wear > 0.6 ? (0.6 - wear) * 30 : 60));
      // Rock on steep ground outside the maintained area.
      const sl = slope[k];
      masks.rock[k] = out > 2 ? Math.round(255 * smoothstep(0.62, 1.0, sl + (desert ? 0.12 : 0) + (th.macroAmp > 9 ? 0.06 : 0))) : 0;
      // Shoreline band just above and below the waterline.
      const wl = nearLevel[k];
      if (wl > NO_WATER + 1) {
        const above = height[k] - wl;
        masks.shore[k] = Math.round(255 * (1 - smoothstep(0.04, 0.3, above)) * (gs > 0.5 ? 1 : 0) * (bunkerSdf[k] > 1.5 ? 1 : 0));
      }
      // Tree density: none on the play area, ramping up beyond it. Clear of water and paths.
      let td = smoothstep(0, 12, out - th.trees.margin * 0.5) * clamp(th.trees.density, 0, 1.2);
      if (wl > NO_WATER + 1 && height[k] - wl < 1.2) td = 0;
      if (pathD[k] < 4) td = 0;
      if (masks.rock[k] > 100) td *= 0.2;
      if (sea && seaD[k] > -30) td = 0;
      trees[k] = Math.round(clamp(td, 0, 1) * 255);
    }
  }

  // --- queries (the single source of truth for physics and rendering) ---
  const maxX = x0 + (nx - 1) * CELL, maxZ = z0 + (nz - 1) * CELL;

  // Height matches the LOD0 render mesh exactly: each cell is two triangles split along the
  // (x+1, z) to (x, z+1) diagonal.
  function heightAt(x, z) {
    let fx = (x - x0) / CELL, fz = (z - z0) / CELL;
    if (!(fx >= 0)) fx = 0; else if (fx > nx - 1.0001) fx = nx - 1.0001;
    if (!(fz >= 0)) fz = 0; else if (fz > nz - 1.0001) fz = nz - 1.0001;
    const ix = fx | 0, iz = fz | 0, ax = fx - ix, az = fz - iz, k = iz * nx + ix;
    const h00 = height[k], h10 = height[k + 1], h01 = height[k + nx], h11 = height[k + nx + 1];
    return ax + az <= 1 ? h00 + (h10 - h00) * ax + (h01 - h00) * az : h11 + (h01 - h11) * (1 - ax) + (h10 - h11) * (1 - az);
  }
  function bilinear(arr, x, z) {
    let fx = (x - x0) / CELL, fz = (z - z0) / CELL;
    if (!(fx >= 0)) fx = 0; else if (fx > nx - 1.0001) fx = nx - 1.0001;
    if (!(fz >= 0)) fz = 0; else if (fz > nz - 1.0001) fz = nz - 1.0001;
    const ix = fx | 0, iz = fz | 0, ax = fx - ix, az = fz - iz, k = iz * nx + ix;
    return (arr[k] * (1 - ax) + arr[k + 1] * ax) * (1 - az) + (arr[k + nx] * (1 - ax) + arr[k + nx + 1] * ax) * az;
  }
  // Smooth normal: the interpolated vertex normal, exactly what the terrain shader lights with.
  function normalAt(x, z, out) {
    const nxv = bilinear(normalX, x, z), nzv = bilinear(normalZ, x, z);
    const ny = Math.sqrt(Math.max(1e-6, 1 - nxv * nxv - nzv * nzv));
    out.x = nxv; out.y = ny; out.z = nzv;
    return out;
  }
  function maskAt(name, x, z) { return bilinear(masks[name], x, z) / 255; }
  // Ground surface ignoring water. The shader's debug surface pass computes the same thing.
  function groundSurfaceAt(x, z) {
    for (let i = 0; i < PRIORITY.length; i++) if (bilinear(masks[PRIORITY[i][0]], x, z) >= 127.5) return PRIORITY[i][1];
    return SURFACES.ROUGH;
  }
  function waterLevelAt(x, z) {
    let fx = Math.round((x - x0) / CELL), fz = Math.round((z - z0) / CELL);
    fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx; fz = fz < 0 ? 0 : fz > nz - 1 ? nz - 1 : fz;
    return waterLevel[fz * nx + fx];
  }
  function isWater(x, z) {
    const wl = waterLevelAt(x, z);
    return wl > NO_WATER + 1 && heightAt(x, z) < wl - 0.03;
  }
  function surfaceAt(x, z) {
    return isWater(x, z) ? SURFACES.WATER : groundSurfaceAt(x, z);
  }
  const inBounds = (x, z, margin = 0) => x >= x0 + margin && x <= maxX - margin && z >= z0 + margin && z <= maxZ - margin;
  // Out of bounds: off the mapped ground, with a margin so the ball never rests on the seam.
  const isOutOfBounds = (x, z) => !inBounds(x, z, 6);

  // Exact along and lateral coordinates for any point, including ones off the grid.
  function lateralAt(x, z, out = {}) {
    let best = 1e18, bs = 0, bt = 0;
    for (let i = 0; i < L - 1; i++) {
      const a = line[i], b = line[i + 1];
      const vx = b.x - a.x, vz = b.z - a.z, len = Math.hypot(vx, vz) || 1e-9;
      const ux = vx / len, uz = vz / len, px = x - a.x, pz = z - a.z;
      let u = px * ux + pz * uz;
      if (!(i === 0 && u < 0) && !(i === L - 2 && u > len)) u = u < 0 ? 0 : u > len ? len : u;
      const ex = px - ux * u, ez = pz - uz * u, d = ex * ex + ez * ez;
      if (d < best) { best = d; bs = a.s + u; bt = (ex * -uz + ez * ux) >= 0 ? Math.sqrt(d) : -Math.sqrt(d); }
    }
    out.s = bs; out.t = bt;
    return out;
  }
  // Signed distance past the coastline (positive toward the sea), or -Infinity with no sea.
  const _lat = {};
  function seaDistAt(x, z) {
    if (!sea) return -Infinity;
    lateralAt(x, z, _lat);
    return _lat.t * sea.side - (sea.offset + Math.sin(_lat.s / 85 + sea.phase) * sea.wobble + Math.sin(_lat.s / 31 + sea.phase * 2) * sea.wobble * 0.35);
  }

  // Pin positions: the layout proposes candidates, the finished ground decides. A cup is only
  // cut where the green is close to level (under 4.5 percent), as a greenkeeper would.
  const slopeAt = (x, z) => { const o = {}; normalAt(x, z, o); return Math.hypot(o.x, o.z) / o.y; };
  let pins = hole.pins.filter((p) => groundSurfaceAt(p.x, p.z) === SURFACES.GREEN && slopeAt(p.x, p.z) < 0.045);
  if (!pins.length) {
    // No candidate is flat enough: search the green for the flattest spot well inside the edge.
    let best = null;
    for (let a = 0; a < 6.28; a += 0.35) for (let r = 0; r < green.radius * 0.6; r += 1.5) {
      const x = green.x + Math.cos(a) * r, z = green.z + Math.sin(a) * r;
      if (greenSdf(green, x, z) > -3.5) continue;
      const sl = slopeAt(x, z);
      if (!best || sl < best.sl) best = { x, z, sl };
    }
    pins = [best || { x: green.x, z: green.z }];
  }
  const pi = Number.isInteger(pinIndex) ? pinIndex : hole.pinIndex;
  const pin = pins[((pi % pins.length) + pins.length) % pins.length];
  const terrain = {
    course, hole, cell: CELL, x0, z0, nx, nz, maxX, maxZ,
    height, normalX, normalZ, slope, masks, trees, waterLevel, nearLevel, bodyId, sField, tField, outside,
    bodies, macro, pin: { x: pin.x, z: pin.z }, pins: pins.map((p) => ({ x: p.x, z: p.z })), lateralAt, seaDistAt,
    heightAt, normalAt, surfaceAt, groundSurfaceAt, maskAt, isWater, waterLevelAt, inBounds, isOutOfBounds,
    bounds: { minX: x0 + 6, maxX: maxX - 6, minZ: z0 + 6, maxZ: maxZ - 6 },
    tee: { x: hole.tees[0].x, z: hole.tees[0].z, heading: hole.teeHeading },
    outsideAt: (x, z) => bilinear(outside, x, z),
    treeDensityAt: (x, z) => bilinear(trees, x, z) / 255,
    sAt: (x, z) => bilinear(sField, x, z),
  };
  // Physics environment for simulateShot. wind and cup are filled in by the caller.
  terrain.env = (extra = {}) => ({
    heightAt, normalAt, surfaceAt, isOutOfBounds, bounds: terrain.bounds,
    waterLevel: -Infinity, cup: terrain.pin, ...extra,
  });
  return terrain;
}
