// Texture processing: 2K source PBR maps to shipped tier-resolution files.
//   {id}_a_{res}.webp   albedo with baked AO in RGB, height in alpha   (sRGB)
//   {id}_n_{res}.jpg    normal XY in RG (GL convention), roughness in B (linear, 4:4:4)
// WebP is used for albedo (smaller, alpha support). The normal + roughness pack is a 4:4:4
// JPEG because lossy WebP always subsamples chroma, which smears the normal channels.
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { generateFallbackSet } from './procedural.mjs';

const BASE = 2048;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

async function loadRaw(file, channels, size = BASE) {
  let img = sharp(file).resize(size, size, { kernel: 'lanczos3', fit: 'fill' });
  img = channels === 1 ? img.greyscale() : img.removeAlpha().toColourspace('srgb');
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== channels) throw new Error(`expected ${channels} channels in ${file}, got ${info.channels}`);
  return data;
}

export async function loadSourceSet(files) {
  const albedo = await loadRaw(files.albedo, 3);
  const normal = await loadRaw(files.normal, 3);
  const rough = files.rough ? await loadRaw(files.rough, 1) : null;
  const ao = files.ao ? await loadRaw(files.ao, 1) : null;
  const height = files.height ? await loadRaw(files.height, 1) : null;
  return { size: BASE, albedo, normal, rough, ao, height };
}

export async function processTextureSet(entry, src, outDir) {
  const size = src.size;
  const n = size * size;
  const albedo = Buffer.from(src.albedo);
  // Flatten: divide out the low-frequency brightness so a tiled field reads evenly.
  if (entry.flatten > 0) {
    const low = await sharp(albedo, { raw: { width: size, height: size, channels: 3 } })
      .resize(24, 24, { kernel: 'cubic' }).blur(1.2).resize(size, size, { kernel: 'cubic' }).raw().toBuffer();
    const mean = [0, 0, 0];
    for (let i = 0; i < n * 3; i++) mean[i % 3] += low[i];
    for (let c = 0; c < 3; c++) mean[c] /= n;
    for (let i = 0; i < n * 3; i++) {
      const ratio = Math.pow(mean[i % 3] / Math.max(4, low[i]), entry.flatten);
      albedo[i] = Math.max(0, Math.min(255, Math.round(albedo[i] * ratio)));
    }
  }
  if (src.ao) {
    for (let i = 0; i < n; i++) {
      const k = 1 - 0.5 * (1 - src.ao[i] / 255);
      albedo[i * 3] = Math.round(albedo[i * 3] * k);
      albedo[i * 3 + 1] = Math.round(albedo[i * 3 + 1] * k);
      albedo[i * 3 + 2] = Math.round(albedo[i * 3 + 2] * k);
    }
  }
  // Height: stretch to the full range so height blending between layers has contrast.
  const height = Buffer.alloc(n);
  let lo = 255, hi = 0;
  const hsrc = src.height;
  const lum = (i) => (albedo[i * 3] * 0.3 + albedo[i * 3 + 1] * 0.59 + albedo[i * 3 + 2] * 0.11);
  for (let i = 0; i < n; i += 7) { const v = hsrc ? hsrc[i] : lum(i); if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) height[i] = Math.max(0, Math.min(255, Math.round((((hsrc ? hsrc[i] : lum(i)) - lo) / span) * 255)));

  const rgba = Buffer.alloc(n * 4);
  const nr = Buffer.alloc(n * 3);
  let ar = 0, ag = 0, ab = 0, rsum = 0;
  for (let i = 0; i < n; i++) {
    const r = albedo[i * 3], g = albedo[i * 3 + 1], b = albedo[i * 3 + 2];
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = height[i];
    const rr = src.rough ? src.rough[i] : 235;
    nr[i * 3] = src.normal[i * 3]; nr[i * 3 + 1] = src.normal[i * 3 + 1]; nr[i * 3 + 2] = rr;
    if (i % 5 === 0) { ar += srgbToLinear(r / 255); ag += srgbToLinear(g / 255); ab += srgbToLinear(b / 255); rsum += rr / 255; }
  }
  const cnt = Math.ceil(n / 5);
  const result = { avg: [ar / cnt, ag / cnt, ab / cnt].map((v) => +v.toFixed(4)), rough: +(rsum / cnt).toFixed(3), files: {}, bytes: 0 };
  mkdirSync(outDir, { recursive: true });
  for (const res of entry.sizes) {
    const aName = `${entry.id}_a_${res}.webp`, nName = `${entry.id}_n_${res}.jpg`;
    await sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).resize(res, res, { kernel: 'lanczos3' })
      .webp({ quality: res >= 2048 ? 58 : res >= 1024 ? 72 : 78, alphaQuality: 55, effort: 5, smartSubsample: true }).toFile(path.join(outDir, aName));
    await sharp(nr, { raw: { width: size, height: size, channels: 3 } }).resize(res, res, { kernel: 'lanczos3' })
      .jpeg({ quality: res >= 2048 ? 68 : res >= 1024 ? 78 : 84, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(path.join(outDir, nName));
    const ba = statSync(path.join(outDir, aName)).size, bn = statSync(path.join(outDir, nName)).size;
    result.files[res] = { a: `textures/${aName}`, n: `textures/${nName}`, bytes: ba + bn };
    result.bytes += ba + bn;
  }
  return result;
}

export async function processFallback(entry, outDir) {
  const g = generateFallbackSet(entry, 1024);
  const up = async (buf, ch) => sharp(buf, { raw: { width: g.size, height: g.size, channels: ch } }).resize(BASE, BASE, { kernel: 'cubic' }).raw().toBuffer();
  const src = { size: BASE, albedo: await up(g.albedo, 3), normal: await up(g.normal, 3), rough: await up(g.rough, 1), ao: null, height: await up(g.height, 1) };
  return processTextureSet({ ...entry, flatten: 0 }, src, outDir);
}
