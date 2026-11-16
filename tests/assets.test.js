import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import manifest from '../src/render/assets.manifest.json';
import { TEXTURES, MODELS, HDRIS, PROCEDURAL_TEXTURES } from '../scripts/assets/catalog.mjs';
import { tileNoise, tileFbm, tileWorley, generateFallbackSet } from '../scripts/assets/procedural.mjs';
import { analyzeHdr } from '../scripts/assets/hdri.mjs';

const ALLOWED = new Set(['CC0 1.0', 'original work']);
const shipped = [];
for (const t of Object.values(manifest.textures)) for (const f of Object.values(t.files)) shipped.push(f.a, f.n);
for (const m of Object.values(manifest.models)) if (!m.failed) shipped.push(m.file, m.lod0);
for (const h of Object.values(manifest.hdris)) if (!h.failed) shipped.push(h.file);
for (const p of Object.values(manifest.procedural)) shipped.push(p.file);
const present = shipped.length > 0 && shipped.every((f) => existsSync(path.join('public', 'assets', f)));

describe('asset manifest', () => {
  it('covers every catalog entry', () => {
    for (const e of TEXTURES) expect(manifest.textures[e.id], `texture ${e.id}`).toBeDefined();
    for (const e of MODELS) expect(manifest.models[e.id], `model ${e.id}`).toBeDefined();
    for (const e of HDRIS) expect(manifest.hdris[e.id], `hdri ${e.id}`).toBeDefined();
    for (const e of PROCEDURAL_TEXTURES) expect(manifest.procedural[e.id], `procedural ${e.id}`).toBeDefined();
  });
  it('has no stale entries that the catalog no longer lists', () => {
    expect(Object.keys(manifest.textures).sort()).toEqual(TEXTURES.map((e) => e.id).sort());
    expect(Object.keys(manifest.models).sort()).toEqual(MODELS.map((e) => e.id).sort());
    expect(Object.keys(manifest.hdris).sort()).toEqual(HDRIS.map((e) => e.id).sort());
  });
  it('every shipped asset carries a verified permissive license with a source URL', () => {
    for (const group of ['textures', 'models', 'hdris']) {
      for (const [id, r] of Object.entries(manifest[group])) {
        if (r.failed) continue;
        expect(ALLOWED.has(r.license), `${group}/${id} license ${r.license}`).toBe(true);
        if (r.source !== 'procedural') {
          expect(r.url, `${group}/${id} url`).toMatch(/^https:\/\/(polyhaven\.com|ambientcg\.com)\//);
          expect(r.licenseUrl).toMatch(/^https:\/\//);
          expect(r.licenseEvidence).toMatch(/CC0/);
        }
      }
    }
  });
  it('every PBR set ships 512 and 1024 with a sane average color and roughness', () => {
    for (const [id, t] of Object.entries(manifest.textures)) {
      expect(t.files['512'], id).toBeDefined();
      for (const c of t.avg) { expect(c).toBeGreaterThan(0); expect(c).toBeLessThan(1); }
      expect(t.rough).toBeGreaterThan(0.2);
      expect(t.rough).toBeLessThanOrEqual(1);
      expect(t.scale).toBeGreaterThan(0.5);
    }
    for (const id of ['fairway', 'green', 'rough', 'bunker']) expect(manifest.textures[id].files['1024']).toBeDefined();
  });
  it('model LODs respect their triangle targets and LOD1 is lighter than LOD0', () => {
    for (const e of MODELS) {
      const m = manifest.models[e.id];
      if (m.failed) continue;
      expect(m.tris.lod0, `${e.id} lod0`).toBeLessThanOrEqual(e.lod0 * 1.25);
      expect(m.tris.lod1, `${e.id} lod1`).toBeLessThanOrEqual(e.lod1 * 1.25);
      expect(m.tris.lod1).toBeLessThanOrEqual(m.tris.lod0);
      expect(m.tris.lod1).toBeGreaterThan(20);
      expect(m.height).toBe(e.height);
      expect(m.radius).toBeGreaterThan(0);
      expect(m.materials.length).toBeGreaterThan(0);
    }
  });
  it('trees have a foliage material and a wood material', () => {
    for (const e of MODELS.filter((m) => m.kind === 'tree' && !/quiver/.test(m.id))) {
      const m = manifest.models[e.id];
      if (m.failed) continue;
      expect(m.materials.some((x) => x.foliage), `${e.id} foliage`).toBe(true);
      expect(m.materials.some((x) => !x.foliage), `${e.id} wood`).toBe(true);
    }
  });
  it('every HDRI is the 1k baked size with a located sun above the horizon', () => {
    for (const [id, h] of Object.entries(manifest.hdris)) {
      if (h.failed) continue;
      expect(h.bytes, id).toBeGreaterThan(500000);
      expect(h.bytes, id).toBeLessThan(2500000);
      expect(h.sunElevDeg).toBeGreaterThan(0);
      expect(h.sunDir.length).toBe(3);
    }
  });
  it('total shipped size is under the 60 MB budget', () => {
    const total = manifest.totals.textures + manifest.totals.models + manifest.totals.hdris;
    expect(total).toBeLessThan(60 * 1048576);
    expect(manifest.totals.shippedBytes).toBeLessThan(60 * 1048576);
  });
  it.skipIf(!present)('every file in the manifest exists on disk with the recorded size class', () => {
    for (const f of shipped) expect(statSync(path.join('public', 'assets', f)).size, f).toBeGreaterThan(500);
  });
});

describe('procedural generators', () => {
  it('tileable noise wraps exactly at the period', () => {
    for (const [x, y] of [[0.3, 0.7], [3.9, 1.2], [5.5, 5.5]]) {
      expect(tileNoise(x, y, 8, 3)).toBeCloseTo(tileNoise(x + 8, y, 8, 3), 10);
      expect(tileNoise(x, y, 8, 3)).toBeCloseTo(tileNoise(x, y + 8, 8, 3), 10);
    }
    expect(tileFbm(0.02, 0.5, 4, 4, 9)).toBeCloseTo(tileFbm(1.02, 0.5, 4, 4, 9), 10);
    expect(tileWorley(0.1, 0.9, 6, 2)).toBeCloseTo(tileWorley(1.1, 0.9, 6, 2), 10);
  });
  it('noise stays in range', () => {
    for (let i = 0; i < 300; i++) {
      const u = (i * 0.137) % 1, v = (i * 0.731) % 1;
      for (const n of [tileFbm(u, v, 4, 5, 1), tileWorley(u, v, 8, 4)]) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1); }
    }
  });
  it('the fallback PBR set is complete and tiles', () => {
    const set = generateFallbackSet(TEXTURES[0], 64);
    expect(set.albedo.length).toBe(64 * 64 * 3);
    expect(set.normal.length).toBe(64 * 64 * 3);
    expect(set.rough.length).toBe(64 * 64);
    expect(set.height.length).toBe(64 * 64);
    // Normals point mostly up.
    let z = 0;
    for (let i = 2; i < set.normal.length; i += 3) z += set.normal[i];
    expect(z / (64 * 64)).toBeGreaterThan(200);
    // Opposite edges match closely (wrapped lattice).
    let diff = 0;
    for (let y = 0; y < 64; y++) diff += Math.abs(set.height[y * 64] - set.height[y * 64 + 63]);
    expect(diff / 64).toBeLessThan(40);
  });
  it('finds the sun in a synthetic HDR map', () => {
    const w = 64, h = 32;
    const data = new Float32Array(w * h * 3).fill(0.5);
    // A bright spot at u = 0.75 (compass east), 30 degrees above the horizon.
    const y = Math.round((60 / 180) * h), x = Math.round(0.75 * w);
    for (let c = 0; c < 3; c++) data[(y * w + x) * 3 + c] = 5000;
    const r = analyzeHdr({ width: w, height: h, data });
    expect(r.hasSun).toBe(true);
    expect(r.sunElevDeg).toBeGreaterThan(22);
    expect(r.sunElevDeg).toBeLessThan(36);
    expect(Number.isFinite(r.sunAzDeg)).toBe(true);
  });
});
