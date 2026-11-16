// Procedural texture generation. Used for (a) the water, cloud, and detail noise maps that
// are always generated, and (b) the fallback for any PBR set whose download fails.
// Everything here is tileable: noise is evaluated on a wrapped lattice.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

function hash(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Periodic value noise in [0,1]. period is the lattice size the noise wraps on.
export function tileNoise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const w = (v) => ((v % period) + period) % period;
  const a = hash(w(ix), w(iy), seed), b = hash(w(ix + 1), w(iy), seed);
  const c = hash(w(ix), w(iy + 1), seed), d = hash(w(ix + 1), w(iy + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function tileFbm(u, v, basePeriod, octaves, seed, gain = 0.5) {
  let amp = 1, sum = 0, norm = 0, p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tileNoise(u * p, v * p, p, seed + o * 17);
    norm += amp; amp *= gain; p *= 2;
  }
  return sum / norm;
}

// Periodic Worley (cellular) noise, returns 1 - distance to the nearest feature point.
export function tileWorley(u, v, cells, seed) {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j;
    const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
    const px = cx + hash(wx, wy, seed), py = cy + hash(wx, wy, seed + 7);
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < best) best = d;
  }
  return 1 - Math.min(1, Math.sqrt(best));
}

function heightToNormal(h, size, strength) {
  const out = Buffer.alloc(size * size * 3);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 3;
    out[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
    out[i + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255); // GL convention, +Y up
    out[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
  }
  return out;
}

export async function generateWaterNormal(file, size = 512) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // Ridged noise reads as wind ripples rather than blobs.
    const a = 1 - Math.abs(tileFbm(u, v, 6, 4, 11) * 2 - 1);
    const b = tileFbm(u + 0.37, v + 0.11, 12, 3, 23);
    h[y * size + x] = a * 0.7 + b * 0.3;
  }
  const n = heightToNormal(h, size, 9);
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(n, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 92, effort: 5, smartSubsample: true }).toFile(file);
}

export async function generateCloudNoise(file, size = 512) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const perlin = tileFbm(u, v, 4, 5, 3);
    const w1 = tileWorley(u, v, 6, 5) * 0.625 + tileWorley(u, v, 12, 6) * 0.25 + tileWorley(u, v, 24, 7) * 0.125;
    const w2 = tileWorley(u, v, 16, 9) * 0.6 + tileWorley(u, v, 32, 10) * 0.4;
    // Perlin-Worley: billowy base shapes with cellular edges.
    const pw = Math.min(1, Math.max(0, (perlin - (1 - w1) * 0.55) / (1 - (1 - w1) * 0.55 + 1e-5) * 1.35));
    const i = (y * size + x) * 4;
    out[i] = Math.round(pw * 255);
    out[i + 1] = Math.round(w1 * 255);
    out[i + 2] = Math.round(w2 * 255);
    out[i + 3] = Math.round(perlin * 255);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(out, { raw: { width: size, height: size, channels: 4 } }).webp({ quality: 88, alphaQuality: 88, effort: 5 }).toFile(file);
}

export async function generateDetailNoise(file, size = 256) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const i = (y * size + x) * 4;
    out[i] = Math.round(tileFbm(u, v, 4, 5, 31) * 255);
    out[i + 1] = Math.round(tileFbm(u, v, 8, 4, 47) * 255);
    out[i + 2] = Math.round(tileFbm(u, v, 32, 3, 59) * 255);
    out[i + 3] = Math.round(tileWorley(u, v, 10, 71) * 255);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(out, { raw: { width: size, height: size, channels: 4 } }).webp({ quality: 88, alphaQuality: 88, effort: 5 }).toFile(file);
}

// Fallback PBR set built from multi-octave noise: raw albedo RGB, normal RGB, rough, height.
export function generateFallbackSet(entry, size = 1024) {
  const fb = entry.fallback;
  const seed = [...entry.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) | 0;
  const h = new Float32Array(size * size);
  const albedo = Buffer.alloc(size * size * 3), rough = Buffer.alloc(size * size), height = Buffer.alloc(size * size);
  const toSrgb = (c) => Math.round(Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2) * 255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const fine = tileFbm(u, v, 64, 4, seed), mid = tileFbm(u, v, 12, 4, seed + 5), big = tileFbm(u, v, 3, 3, seed + 9);
    const hv = fine * 0.55 + mid * 0.3 + big * 0.15;
    h[y * size + x] = hv;
    const shade = 1 + (hv - 0.5) * 0.9 * fb.grain + (mid - 0.5) * 0.25;
    const i = (y * size + x) * 3;
    albedo[i] = toSrgb(fb.color[0] * shade * (1 + (big - 0.5) * 0.12));
    albedo[i + 1] = toSrgb(fb.color[1] * shade);
    albedo[i + 2] = toSrgb(fb.color[2] * shade * (1 - (big - 0.5) * 0.12));
    rough[y * size + x] = Math.round(Math.min(1, fb.rough + (fine - 0.5) * 0.1) * 255);
    height[y * size + x] = Math.round(hv * 255);
  }
  return { size, albedo, normal: heightToNormal(h, size, 6 * fb.grain + 1), rough, height };
}
