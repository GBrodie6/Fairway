// HDRI handling: decode Radiance .hdr, locate the sun (or moon), and report sky statistics.
// The .hdr is shipped as-is at its 1k baked size; the game rotates it to match the game sun.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

export function decodeHdr(buf) {
  let pos = 0;
  const line = () => { let s = ''; while (pos < buf.length && buf[pos] !== 10) s += String.fromCharCode(buf[pos++]); pos++; return s; };
  if (!/^#\?(RADIANCE|RGBE)/.test(line())) throw new Error('not a Radiance HDR file');
  for (;;) { const l = line(); if (l === '') break; if (pos >= buf.length) throw new Error('bad HDR header'); }
  const m = /-Y (\d+) \+X (\d+)/.exec(line());
  if (!m) throw new Error('unsupported HDR orientation');
  const h = Number(m[1]), w = Number(m[2]);
  const data = new Float32Array(w * h * 3);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (buf[pos] === 2 && buf[pos + 1] === 2 && ((buf[pos + 2] << 8) | buf[pos + 3]) === w) {
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let count = buf[pos++];
          if (count > 128) { count -= 128; const v = buf[pos++]; while (count--) scan[x++ * 4 + c] = v; }
          else while (count--) scan[x++ * 4 + c] = buf[pos++];
        }
      }
    } else {
      for (let x = 0; x < w * 4; x++) scan[x] = buf[pos++];
    }
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      const f = e ? Math.pow(2, e - 136) : 0;
      const i = (y * w + x) * 3;
      data[i] = scan[x * 4] * f; data[i + 1] = scan[x * 4 + 1] * f; data[i + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { width: w, height: h, data };
}

// Sun direction: solid-angle weighted centroid of the brightest pixels in the upper hemisphere.
export function analyzeHdr({ width: w, height: h, data }) {
  const lum = new Float32Array(w * h);
  let total = 0, wsum = 0, max = 0;
  for (let y = 0; y < h; y++) {
    const sinT = Math.sin(((y + 0.5) / h) * Math.PI);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      lum[y * w + x] = l;
      if (y < h / 2) { total += l * sinT; wsum += sinT; if (l > max) max = l; }
    }
  }
  const mean = total / wsum;
  const thresh = Math.max(max * 0.25, mean * 8);
  let sx = 0, sy = 0, sz = 0, sw = 0;
  for (let y = 0; y < h / 2; y++) {
    const theta = ((y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const l = lum[y * w + x];
      if (l < thresh) continue;
      const phi = ((x + 0.5) / w) * 2 * Math.PI;
      const wt = l * Math.sin(theta);
      // three.js equirect mapping: u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5
      const dy = Math.cos(theta), r = Math.sin(theta);
      const a = phi - Math.PI;
      sx += Math.cos(a) * r * wt; sy += dy * wt; sz += Math.sin(a) * r * wt; sw += wt;
    }
  }
  const len = Math.hypot(sx, sy, sz) || 1;
  const dir = [sx / len, sy / len, sz / len];
  return {
    sunDir: dir.map((v) => +v.toFixed(4)),
    sunElevDeg: +((Math.asin(dir[1]) * 180) / Math.PI).toFixed(1),
    // Compass bearing of the sun in the unrotated map (0 = -Z, 90 = +X), same convention as the game.
    sunAzDeg: +((Math.atan2(dir[0], -dir[2]) * 180) / Math.PI).toFixed(1),
    meanLuminance: +mean.toFixed(4), peakLuminance: +max.toFixed(1),
    hasSun: sw > 0 && max > mean * 20,
  };
}

// Radiance RGBE encoder with the standard per-channel run-length scheme.
export function encodeHdr({ width: w, height: h, data }) {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'ascii');
  const chunks = [header];
  const rgbe = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const v = Math.max(r, g, b);
      if (v < 1e-32) { rgbe[x] = rgbe[w + x] = rgbe[2 * w + x] = rgbe[3 * w + x] = 0; continue; }
      let e = Math.ceil(Math.log2(v));
      if (Math.pow(2, e) === v) e += 1;
      const sc = 256 / Math.pow(2, e);
      rgbe[x] = Math.min(255, Math.floor(r * sc)); rgbe[w + x] = Math.min(255, Math.floor(g * sc)); rgbe[2 * w + x] = Math.min(255, Math.floor(b * sc)); rgbe[3 * w + x] = e + 128;
    }
    const out = [2, 2, (w >> 8) & 255, w & 255];
    for (let c = 0; c < 4; c++) {
      const row = rgbe.subarray(c * w, (c + 1) * w);
      let x = 0;
      while (x < w) {
        let run = 1;
        while (x + run < w && run < 127 && row[x + run] === row[x]) run++;
        if (run >= 3) { out.push(128 + run, row[x]); x += run; continue; }
        // Literal span: up to the next run of three or more.
        let n = 0;
        const start = x;
        while (x < w && n < 128) {
          let r2 = 1;
          while (x + r2 < w && r2 < 3 && row[x + r2] === row[x]) r2++;
          if (r2 >= 3) break;
          x++; n++;
        }
        out.push(n);
        for (let k = 0; k < n; k++) out.push(row[start + k]);
      }
    }
    chunks.push(Buffer.from(out));
  }
  return Buffer.concat(chunks);
}

// The game lights the scene with its own sun, so the photographed sun disc must not be counted
// a second time through the environment map (it showed up as a glare path on the ground).
// Texels far brighter than the sky are scaled down to a ceiling. Size stays 1k.
export function clampSun(img, analysis, k = 9) {
  const { width: w, height: h, data } = img;
  const cap = analysis.meanLuminance * k;
  let clamped = 0;
  for (let i = 0; i < w * h; i++) {
    const l = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
    if (l > cap) { const sc = cap / l; data[i * 3] *= sc; data[i * 3 + 1] *= sc; data[i * 3 + 2] *= sc; clamped++; }
  }
  return clamped;
}

export function processHdri(entry, srcPath, outDir) {
  const img = decodeHdr(readFileSync(srcPath));
  const before = analyzeHdr(img);
  const clampedTexels = clampSun(img, before);
  const after = analyzeHdr(img);
  mkdirSync(outDir, { recursive: true });
  const name = `${entry.id}.hdr`;
  writeFileSync(path.join(outDir, name), encodeHdr(img));
  // The sun direction comes from the original map (the clamp flattens the peak).
  return {
    file: `hdri/${name}`, bytes: statSync(path.join(outDir, name)).size,
    ...before, meanLuminance: after.meanLuminance, peakLuminance: after.peakLuminance, sourcePeakLuminance: before.peakLuminance, sourceMeanLuminance: before.meanLuminance,
    sunClampedTexels: clampedTexels, width: img.width, height: img.height,
  };
}
