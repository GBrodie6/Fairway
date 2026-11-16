// Runtime asset access. The manifest is bundled; the heavy files are fetched lazily after
// first paint. If the processed files are not present in this build (ASSETS_PRESENT false),
// every loader resolves to null and the renderer keeps its procedural stand-ins, so the game
// always runs and never requests a file that does not exist.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import manifest from './assets.manifest.json';

/* global __ASSETS_PRESENT__ */
export const ASSETS_PRESENT = typeof __ASSETS_PRESENT__ !== 'undefined' ? __ASSETS_PRESENT__ : false;
export const MANIFEST = manifest;

export function createAssets({ enabled = ASSETS_PRESENT, onBytes, base = './assets/' } = {}) {
  const BASE = base;
  const gltf = new GLTFLoader();
  gltf.setMeshoptDecoder(MeshoptDecoder);
  const hdr = new HDRLoader();
  const cache = new Map();
  const stats = { requests: 0, bytes: 0, gpuBytes: 0, failed: 0 };

  const once = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn().catch((err) => { stats.failed++; console.warn('[assets] failed', key, err && err.message); return null; }));
    return cache.get(key);
  };

  async function bitmap(file, { flipY = false } = {}) {
    const res = await fetch(BASE + file);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${file}`);
    const blob = await res.blob();
    stats.requests++; stats.bytes += blob.size;
    return createImageBitmap(blob, { imageOrientation: flipY ? 'flipY' : 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }

  const assets = {
    enabled, manifest, stats,
    has(group, id) { const r = manifest[group] && manifest[group][id]; return !!(enabled && r && !r.failed); },
    info(group, id) { return manifest[group] ? manifest[group][id] : undefined; },

    // Pick the best shipped resolution that does not exceed the tier's texture size.
    pickSize(id, want) {
      const rec = manifest.textures[id];
      if (!rec) return 0;
      const sizes = Object.keys(rec.files).map(Number).sort((a, b) => a - b);
      let best = sizes[0];
      for (const s of sizes) if (s <= want) best = s;
      return best;
    },

    // Raw pixels for one PBR set: { size, albedo: ImageBitmap, nr: ImageBitmap }.
    textureSetBitmaps(id, want) {
      if (!assets.has('textures', id)) return Promise.resolve(null);
      const size = assets.pickSize(id, want);
      const f = manifest.textures[id].files[size];
      return once(`tsb:${id}:${size}`, async () => {
        const [albedo, nr] = await Promise.all([bitmap(f.a), bitmap(f.n)]);
        return { size, albedo, nr };
      });
    },

    // A standalone tiling texture pair for non-terrain materials (bark, buildings, paths).
    textureSet(id, want, { anisotropy = 8 } = {}) {
      if (!assets.has('textures', id)) return Promise.resolve(null);
      const size = assets.pickSize(id, want);
      const f = manifest.textures[id].files[size];
      return once(`ts:${id}:${size}`, async () => {
        const [a, n] = await Promise.all([bitmap(f.a, { flipY: true }), bitmap(f.n, { flipY: true })]);
        const mk = (img, srgb) => {
          const t = new THREE.Texture(img);
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.anisotropy = anisotropy; t.generateMipmaps = true;
          t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
          t.needsUpdate = true;
          return t;
        };
        stats.gpuBytes += size * size * 4 * 1.33 * 2;
        if (onBytes) onBytes(stats.gpuBytes);
        return { size, map: mk(a, true), nr: mk(n, false), avg: manifest.textures[id].avg };
      });
    },

    texture(group, id, { srgb = false, repeat = true, anisotropy = 4 } = {}) {
      const rec = manifest[group] && manifest[group][id];
      if (!enabled || !rec || rec.failed) return Promise.resolve(null);
      return once(`tx:${group}:${id}`, async () => {
        const img = await bitmap(rec.file, { flipY: true });
        const t = new THREE.Texture(img);
        if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = anisotropy; t.needsUpdate = true;
        stats.gpuBytes += img.width * img.height * 4 * 1.33;
        if (onBytes) onBytes(stats.gpuBytes);
        return t;
      });
    },

    // Model: { info, lod1: [{ geometry, material }], lod0: [...] | null }.
    model(id, { lod0 = false } = {}) {
      if (!assets.has('models', id)) return Promise.resolve(null);
      const rec = manifest.models[id];
      return once(`m:${id}:${lod0 ? 1 : 0}`, async () => {
        const base = await once(`mf:${rec.file}`, () => gltf.loadAsync(BASE + rec.file));
        if (!base) return null;
        // The files store quantized positions with a dequantization transform on the node.
        // Bake it into float positions so instancing can treat every part as model space.
        const v = new THREE.Vector3();
        const parts = (root) => {
          const out = [];
          root.updateMatrixWorld(true);
          root.traverse((o) => {
            if (!o.isMesh) return;
            const src = o.geometry.attributes.position;
            const arr = new Float32Array(src.count * 3);
            for (let i = 0; i < src.count; i++) { v.fromBufferAttribute(src, i).applyMatrix4(o.matrixWorld); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            if (o.geometry.attributes.normal) g.setAttribute('normal', o.geometry.attributes.normal);
            if (o.geometry.attributes.uv) g.setAttribute('uv', o.geometry.attributes.uv);
            g.setIndex(o.geometry.index);
            g.computeBoundingSphere(); g.computeBoundingBox();
            out.push({ geometry: g, material: o.material, name: o.material.name });
          });
          return out;
        };
        const lod1 = parts(base.scene);
        stats.requests++; stats.bytes += rec.bytesLod1 || 0;
        let l0 = null;
        if (lod0) {
          const g0 = await once(`mf:${rec.lod0}`, () => gltf.loadAsync(BASE + rec.lod0));
          if (g0) {
            // LOD0 ships geometry only. Reuse the textured materials from the LOD1 file by name.
            const byName = new Map(lod1.map((p) => [p.name, p.material]));
            l0 = parts(g0.scene).map((p) => ({ geometry: p.geometry, material: byName.get(p.name) || p.material, name: p.name }));
            stats.requests++; stats.bytes += rec.bytesLod0 || 0;
          }
        }
        return { id, info: rec, lod1, lod0: l0 };
      });
    },

    hdri(id) {
      if (!assets.has('hdris', id)) return Promise.resolve(null);
      const rec = manifest.hdris[id];
      return once(`h:${id}`, async () => {
        const tex = await hdr.loadAsync(BASE + rec.file);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        stats.requests++; stats.bytes += rec.bytes;
        return { texture: tex, info: rec };
      });
    },
  };
  return assets;
}
