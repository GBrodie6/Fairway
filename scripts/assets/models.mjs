// Model processing: scanned Poly Haven glTF models to game-ready, meshopt-compressed GLBs.
//
// The scans are far too heavy to ship (a small tree is about a million triangles, with every
// leaf modeled as its own little mesh). The recipe per primitive:
//   foliage, built from many small cards  -> keep a seeded random subset of the cards, rebuild
//                                            each as one quad from its UV corners, and scale it
//                                            up so the canopy keeps its coverage
//   foliage, built from larger meshes     -> meshopt simplification
//   wood and rock                         -> drop the smallest loose pieces, then simplify
// Each model is normalized: base at the origin, height set to the catalog height in meters.
// Output: {id}.glb holds LOD1 plus the textures, {id}_lod0.glb holds LOD0 geometry only and
// reuses the textures of the first file (materials are matched by name at load time).
import { Document, NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder, quantize, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toFloat(acc) {
  const arr = acc.getArray();
  if (arr instanceof Float32Array && !acc.getNormalized()) return arr;
  const n = acc.getCount(), sz = acc.getElementSize();
  const out = new Float32Array(n * sz);
  const el = [];
  for (let i = 0; i < n; i++) { acc.getElement(i, el); for (let k = 0; k < sz; k++) out[i * sz + k] = el[k]; }
  return out;
}

// Pull a primitive into flat arrays with the node's world transform baked in.
function extract(prim, m) {
  const pa = prim.getAttribute('POSITION');
  const src = toFloat(pa);
  const n = pa.getCount();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  const na = prim.getAttribute('NORMAL');
  const nrm = new Float32Array(n * 3);
  if (na) {
    const s = toFloat(na);
    for (let i = 0; i < n; i++) {
      const x = s[i * 3], y = s[i * 3 + 1], z = s[i * 3 + 2];
      let nx = m[0] * x + m[4] * y + m[8] * z, ny = m[1] * x + m[5] * y + m[9] * z, nz = m[2] * x + m[6] * y + m[10] * z;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
    }
  }
  const ua = prim.getAttribute('TEXCOORD_0');
  const uv = ua ? new Float32Array(toFloat(ua)) : new Float32Array(n * 2);
  const ia = prim.getIndices();
  let idx;
  if (ia) idx = Uint32Array.from(ia.getArray());
  else { idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
  return { pos, nrm, uv, idx };
}

// Connected components by shared position. Vertices duplicated along UV seams are welded
// first (positions quantized to 17 bits per axis), otherwise one rock reads as hundreds of
// loose patches and dropping "small pieces" punches holes in it.
function components(g) {
  const nV = g.pos.length / 3;
  let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
  for (let i = 0; i < nV; i++) {
    const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  const Q = 131071;
  const sx = Q / Math.max(1e-9, mxx - mnx), sy = Q / Math.max(1e-9, mxy - mny), sz = Q / Math.max(1e-9, mxz - mnz);
  const canon = new Int32Array(nV);
  const seenPos = new Map();
  for (let i = 0; i < nV; i++) {
    const key = Math.round((g.pos[i * 3] - mnx) * sx) * 17179869184 + Math.round((g.pos[i * 3 + 1] - mny) * sy) * 131072 + Math.round((g.pos[i * 3 + 2] - mnz) * sz);
    const c = seenPos.get(key);
    if (c === undefined) { seenPos.set(key, i); canon[i] = i; } else canon[i] = c;
  }
  const parent = new Int32Array(nV);
  for (let i = 0; i < nV; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const { idx } = g;
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(canon[idx[t]]), b = find(canon[idx[t + 1]]);
    if (a !== b) parent[b] = a;
    const c = find(canon[idx[t + 2]]), a2 = find(canon[idx[t]]);
    if (c !== a2) parent[c] = a2;
  }
  const map = new Map();
  const comps = [];
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(canon[idx[t]]);
    let id = map.get(r);
    if (id === undefined) { id = comps.length; map.set(r, id); comps.push({ tris: [], min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }); }
    const c = comps[id];
    c.tris.push(t / 3);
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k] * 3;
      for (let a = 0; a < 3; a++) { const p = g.pos[v + a]; if (p < c.min[a]) c.min[a] = p; if (p > c.max[a]) c.max[a] = p; }
    }
  }
  for (const c of comps) c.size = Math.hypot(c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]);
  return comps;
}

// Rebuild geometry from a subset of triangles, compacting the vertex buffers.
function subset(g, triList) {
  const remap = new Map();
  const pos = [], nrm = [], uv = [], idx = [];
  for (const t of triList) {
    for (let k = 0; k < 3; k++) {
      const v = g.idx[t * 3 + k];
      let nv = remap.get(v);
      if (nv === undefined) {
        nv = pos.length / 3; remap.set(v, nv);
        pos.push(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]);
        nrm.push(g.nrm[v * 3], g.nrm[v * 3 + 1], g.nrm[v * 3 + 2]);
        uv.push(g.uv[v * 2], g.uv[v * 2 + 1]);
      }
      idx.push(nv);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint32Array(idx) };
}

function simplifyGeo(g, targetTris) {
  const cur = g.idx.length / 3;
  if (cur <= targetTris || cur < 8) return g;
  const target = Math.max(3, Math.floor(targetTris) * 3);
  // Attribute-aware simplification keeps the UV layout intact, so textures do not smear.
  const run = (err) => (typeof MeshoptSimplifier.simplifyWithAttributes === 'function'
    ? MeshoptSimplifier.simplifyWithAttributes(g.idx, g.pos, 3, g.uv, 2, [0.6, 0.6], null, target, err, [])
    : MeshoptSimplifier.simplify(g.idx, g.pos, 3, target, err, []));
  let [ni] = run(0.08);
  if (ni.length > target * 1.6) {
    // Topology-preserving simplification stalled. Allow a larger error.
    [ni] = run(0.4);
  }
  if (ni.length > target * 2.5 && typeof MeshoptSimplifier.simplifySloppy === 'function') {
    try {
      const r = MeshoptSimplifier.simplifySloppy(g.idx, g.pos, 3, null, target, 0.5);
      if (r && r[0] && r[0].length >= 3 && r[0].length < ni.length) ni = r[0];
    } catch (e) { /* keep the previous result */ }
  }
  const tris = [];
  const tmp = { ...g, idx: ni };
  for (let t = 0; t < ni.length / 3; t++) tris.push(t);
  return subset(tmp, tris);
}

// Local frame of a connected piece, from its geometry alone (vertex normals are unreliable on
// two-sided cards and cancel out on tubes): e1 is the longest direction from the centroid, e2
// the widest direction across it, n their cross product. thickness is the extent along n.
function frameOf(g, c, seen) {
  seen.clear();
  for (const t of c.tris) for (let k = 0; k < 3; k++) seen.add(g.idx[t * 3 + k]);
  const cnt = seen.size;
  if (cnt < 3) return null;
  let cx = 0, cy = 0, cz = 0, ax = 0, ay = 0, az = 0;
  for (const v of seen) {
    cx += g.pos[v * 3]; cy += g.pos[v * 3 + 1]; cz += g.pos[v * 3 + 2];
    ax += g.nrm[v * 3]; ay += g.nrm[v * 3 + 1]; az += g.nrm[v * 3 + 2];
  }
  cx /= cnt; cy /= cnt; cz /= cnt;
  let e1x = 0, e1y = 0, e1z = 0, far = -1;
  for (const v of seen) {
    const dx = g.pos[v * 3] - cx, dy = g.pos[v * 3 + 1] - cy, dz = g.pos[v * 3 + 2] - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > far) { far = d2; e1x = dx; e1y = dy; e1z = dz; }
  }
  const l1 = Math.sqrt(far);
  if (l1 < 1e-7) return null;
  e1x /= l1; e1y /= l1; e1z /= l1;
  let e2x = 0, e2y = 0, e2z = 0, far2 = -1;
  for (const v of seen) {
    let dx = g.pos[v * 3] - cx, dy = g.pos[v * 3 + 1] - cy, dz = g.pos[v * 3 + 2] - cz;
    const d1 = dx * e1x + dy * e1y + dz * e1z;
    dx -= d1 * e1x; dy -= d1 * e1y; dz -= d1 * e1z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > far2) { far2 = d2; e2x = dx; e2y = dy; e2z = dz; }
  }
  const l2 = Math.sqrt(far2);
  if (l2 < 1e-7) return null;
  e2x /= l2; e2y /= l2; e2z /= l2;
  let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  // Face the stored normals when they carry a direction.
  if (nx * ax + ny * ay + nz * az < 0) { nx = -nx; ny = -ny; nz = -nz; e2x = -e2x; e2y = -e2y; e2z = -e2z; }
  let amin = 1e9, amax = -1e9, bmin = 1e9, bmax = -1e9, nmin = 1e9, nmax = -1e9;
  for (const v of seen) {
    const dx = g.pos[v * 3] - cx, dy = g.pos[v * 3 + 1] - cy, dz = g.pos[v * 3 + 2] - cz;
    const a = dx * e1x + dy * e1y + dz * e1z, bb = dx * e2x + dy * e2y + dz * e2z, n = dx * nx + dy * ny + dz * nz;
    if (a < amin) amin = a; if (a > amax) amax = a; if (bb < bmin) bmin = bb; if (bb > bmax) bmax = bb; if (n < nmin) nmin = n; if (n > nmax) nmax = n;
  }
  const width = bmax - bmin, thickness = nmax - nmin;
  return { cx, cy, cz, e1: [e1x, e1y, e1z], e2: [e2x, e2y, e2z], n: [nx, ny, nz], amin, amax, bmin, bmax, width, thickness, flat: thickness < width * 0.55, cnt };
}

// Card foliage: keep a subset of the cards, rebuild each as one rectangle, and scale it up.
// The rectangle is the bounding box of the card in its own plane, and its UVs come from a
// least-squares affine fit of the card's own UV mapping, so a leaf of any outline keeps its
// texture placement.
function cardFoliage(g, cards, targetTris, rand) {
  const wantCards = Math.max(8, Math.floor(targetTris / 2));
  const frac = Math.min(1, wantCards / cards.length);
  const scale = Math.min(4.2, Math.max(1.15, Math.sqrt(Math.min(1 / frac, 16) * 1.15)));
  const pos = [], nrm = [], uv = [], idx = [];
  for (const { f, seen } of cards) {
    if (rand() > frac) continue;
    const [e1x, e1y, e1z] = f.e1, [e2x, e2y, e2z] = f.e2, [nx, ny, nz] = f.n;
    const cnt = f.cnt;
    let Saa = 0, Sab = 0, Sbb = 0, Sa = 0, Sb = 0, Su = 0, Sv = 0, Sau = 0, Sbu = 0, Sav = 0, Sbv = 0;
    for (const v of seen) {
      const dx = g.pos[v * 3] - f.cx, dy = g.pos[v * 3 + 1] - f.cy, dz = g.pos[v * 3 + 2] - f.cz;
      const a = dx * e1x + dy * e1y + dz * e1z, b = dx * e2x + dy * e2y + dz * e2z;
      const u = g.uv[v * 2], w = g.uv[v * 2 + 1];
      Saa += a * a; Sab += a * b; Sbb += b * b; Sa += a; Sb += b; Su += u; Sv += w;
      Sau += a * u; Sbu += b * u; Sav += a * w; Sbv += b * w;
    }
    const ma = Sa / cnt, mb = Sb / cnt, mu = Su / cnt, mv = Sv / cnt;
    const caa = Saa - cnt * ma * ma + 1e-12, cab = Sab - cnt * ma * mb, cbb = Sbb - cnt * mb * mb + 1e-12;
    const cau = Sau - cnt * ma * mu, cbu = Sbu - cnt * mb * mu, cav = Sav - cnt * ma * mv, cbv = Sbv - cnt * mb * mv;
    const det = caa * cbb - cab * cab;
    if (Math.abs(det) < 1e-18) continue;
    const ua = (cau * cbb - cbu * cab) / det, ub = (cbu * caa - cau * cab) / det;
    const va = (cav * cbb - cbv * cab) / det, vb = (cbv * caa - cav * cab) / det;
    const ac = (f.amin + f.amax) / 2, bc = (f.bmin + f.bmax) / 2;
    const base = pos.length / 3;
    for (const [a, b] of [[f.amin, f.bmin], [f.amax, f.bmin], [f.amax, f.bmax], [f.amin, f.bmax]]) {
      const as = ac + (a - ac) * scale, bs = bc + (b - bc) * scale;
      pos.push(f.cx + as * e1x + bs * e2x, f.cy + as * e1y + bs * e2y, f.cz + as * e1z + bs * e2z);
      nrm.push(nx, ny, nz);
      uv.push(mu + ua * (a - ma) + ub * (b - mb), mv + va * (a - ma) + vb * (b - mb));
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint32Array(idx) };
}

function mergeGeo(a, b) {
  if (!b || !b.idx.length) return a;
  if (!a || !a.idx.length) return b;
  const nA = a.pos.length / 3;
  const pos = new Float32Array(a.pos.length + b.pos.length), nrm = new Float32Array(a.nrm.length + b.nrm.length);
  const uv = new Float32Array(a.uv.length + b.uv.length), idx = new Uint32Array(a.idx.length + b.idx.length);
  pos.set(a.pos); pos.set(b.pos, a.pos.length); nrm.set(a.nrm); nrm.set(b.nrm, a.nrm.length);
  uv.set(a.uv); uv.set(b.uv, a.uv.length); idx.set(a.idx);
  for (let i = 0; i < b.idx.length; i++) idx[a.idx.length + i] = b.idx[i] + nA;
  return { pos, nrm, uv, idx };
}

// Solid pieces (wood, rock, twig stems): drop the least significant loose pieces, then simplify.
function reduceSolid(g, comps, targetTris) {
  let keep = comps;
  if (comps.length > 40) {
    // A simplified loose piece still costs about 10 triangles, so cap how many survive.
    const maxComps = Math.max(12, Math.floor(targetTris / 10));
    keep = [...comps].sort((a, b) => b.size * Math.sqrt(b.tris.length) - a.size * Math.sqrt(a.tris.length)).slice(0, maxComps);
  }
  const tris = [];
  for (const c of keep) for (const t of c.tris) tris.push(t);
  return simplifyGeo(subset(g, tris), targetTris);
}

function reducePrim(g, kind, targetTris, rand, allowCards) {
  const cur = g.idx.length / 3;
  if (cur <= targetTris) return g;
  const comps = components(g);
  // Card rebuilding suits trees, whose leaves are tiny and flat. Small plants are made of
  // curved strips (grass blades, stems) that must keep their shape, so they are simplified.
  if (allowCards && kind === 'foliage' && comps.length > 24) {
    // Split into flat cards (leaves, needle sprays) and solid pieces (twig stems as tubes).
    const cards = [], solids = [];
    const scratch = new Set();
    for (const c of comps) {
      const f = frameOf(g, c, scratch);
      if (f && f.flat && c.tris.length <= 64) cards.push({ f, seen: new Set(scratch) });
      else solids.push(c);
    }
    if (cards.length > 24 && cards.length >= comps.length * 0.3) {
      const solidTris = solids.reduce((a, c) => a + c.tris.length, 0);
      const solidBudget = solids.length ? Math.min(targetTris * 0.14, solidTris) : 0;
      const out = cardFoliage(g, cards, targetTris - solidBudget, rand);
      return solids.length && solidBudget >= 24 ? mergeGeo(out, reduceSolid(g, solids, solidBudget)) : out;
    }
  }
  return reduceSolid(g, comps, targetTris);
}

// Fill the color of transparent texels from their opaque neighbors so mipmaps do not darken
// the edges of alpha-tested foliage.
function bleedAlpha(rgba, w, h, passes = 10) {
  const src = rgba;
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = src[i * 4 + 3] > 24 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (known[j]) { r += src[j * 4]; g += src[j * 4 + 1]; b += src[j * 4 + 2]; n++; }
      }
      if (n) add.push(i, r / n, g / n, b / n);
    }
    if (!add.length) break;
    for (let k = 0; k < add.length; k += 4) {
      const i = add[k];
      src[i * 4] = add[k + 1]; src[i * 4 + 1] = add[k + 2]; src[i * 4 + 2] = add[k + 3];
      known[i] = 1;
    }
  }
  return src;
}

async function buildBaseColor(imagePath, alphaPath, size, hasAlpha) {
  const base = sharp(imagePath).resize(size, size, { fit: 'fill', kernel: 'lanczos3' });
  if (!hasAlpha) {
    const buf = await base.removeAlpha().webp({ quality: 80, effort: 5 }).toBuffer();
    const st = await sharp(imagePath).resize(8, 8, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    return { buf, avg: avgColor(st, 3) };
  }
  const meta = await sharp(imagePath).metadata();
  let rgba;
  if (alphaPath) {
    const rgb = await base.removeAlpha().raw().toBuffer();
    const a = await sharp(alphaPath).resize(size, size, { fit: 'fill', kernel: 'lanczos3' }).greyscale().raw().toBuffer();
    rgba = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = a[i]; }
  } else if (meta.hasAlpha) {
    rgba = await base.ensureAlpha().raw().toBuffer();
  } else {
    const buf = await base.removeAlpha().webp({ quality: 80, effort: 5 }).toBuffer();
    return { buf, avg: [0.2, 0.3, 0.1], opaque: true };
  }
  // Average color over the opaque texels only.
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < size * size; i += 3) if (rgba[i * 4 + 3] > 128) { r += rgba[i * 4]; g += rgba[i * 4 + 1]; b += rgba[i * 4 + 2]; n++; }
  bleedAlpha(rgba, size, size);
  const buf = await sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).webp({ quality: 82, alphaQuality: 90, effort: 5 }).toBuffer();
  const lin = (c) => Math.pow(c / 255, 2.2);
  return { buf, avg: n ? [lin(r / n), lin(g / n), lin(b / n)].map((v) => +v.toFixed(4)) : [0.2, 0.3, 0.1], coverage: +(n / (size * size / 3)).toFixed(3) };
}

function avgColor(raw, ch) {
  let r = 0, g = 0, b = 0;
  const n = raw.length / ch;
  for (let i = 0; i < n; i++) { r += raw[i * ch]; g += raw[i * ch + 1]; b += raw[i * ch + 2]; }
  const lin = (c) => Math.pow(c / 255, 2.2);
  return [lin(r / n), lin(g / n), lin(b / n)].map((v) => +v.toFixed(4));
}

function uriOf(tex, dir) {
  const uri = tex && tex.getURI();
  if (!uri) return null;
  const p = path.join(dir, decodeURIComponent(uri));
  return existsSync(p) ? p : null;
}

export async function processModel(entry, fetched, outDir) {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(fetched.gltfPath);
  const root = doc.getRoot();
  const rand0 = rng([...entry.id].reduce((a, c) => a * 131 + c.charCodeAt(0), 5));

  // Many scans hold several variants side by side. Use the tallest one.
  const nodes = root.listNodes().filter((n) => n.getMesh());
  let best = null;
  for (const node of nodes) {
    const m = node.getWorldMatrix();
    let lo = 1e9, hi = -1e9, tris = 0;
    for (const prim of node.getMesh().listPrimitives()) {
      const pa = prim.getAttribute('POSITION');
      const mn = pa.getMin([]), mx = pa.getMax([]);
      for (const y of [mn[1], mx[1]]) for (const x of [mn[0], mx[0]]) for (const z of [mn[2], mx[2]]) {
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        if (wy < lo) lo = wy; if (wy > hi) hi = wy;
      }
      tris += (prim.getIndices() ? prim.getIndices().getCount() : pa.getCount()) / 3;
    }
    const score = (hi - lo) * (entry.kind === 'tree' ? 1 : 0) + tris * 1e-9 + (entry.kind === 'tree' ? 0 : tris);
    if (!best || score > best.score) best = { node, score, tris };
  }
  if (!best) throw new Error(`${entry.asset}: no mesh nodes`);

  // Group the chosen variant's primitives by material.
  const groups = new Map();
  const m = best.node.getWorldMatrix();
  for (const prim of best.node.getMesh().listPrimitives()) {
    if (prim.getMode() !== 4) continue;
    const mat = prim.getMaterial();
    const name = mat ? mat.getName() : 'default';
    const g = extract(prim, m);
    const tt = mat && mat.getBaseColorTextureInfo();
    // Bake any KHR_texture_transform into the UVs so the shipped file needs no extension.
    const xf = tt && tt.getExtension('KHR_texture_transform');
    if (xf) {
      const s = xf.getScale(), o = xf.getOffset(), r = xf.getRotation();
      const c = Math.cos(r), sn = Math.sin(r);
      for (let i = 0; i < g.uv.length; i += 2) {
        const u = g.uv[i] * s[0], v = g.uv[i + 1] * s[1];
        g.uv[i] = c * u + sn * v + o[0];
        g.uv[i + 1] = -sn * u + c * v + o[1];
      }
    }
    if (!groups.has(name)) groups.set(name, { mat, parts: [] });
    groups.get(name).parts.push(g);
  }

  // Merge parts per material and classify.
  const mats = [];
  let totalTris = 0;
  for (const [name, grp] of groups) {
    let nV = 0, nI = 0;
    for (const p of grp.parts) { nV += p.pos.length / 3; nI += p.idx.length; }
    const g = { pos: new Float32Array(nV * 3), nrm: new Float32Array(nV * 3), uv: new Float32Array(nV * 2), idx: new Uint32Array(nI) };
    let vo = 0, io2 = 0;
    for (const p of grp.parts) {
      g.pos.set(p.pos, vo * 3); g.nrm.set(p.nrm, vo * 3); g.uv.set(p.uv, vo * 2);
      for (let i = 0; i < p.idx.length; i++) g.idx[io2 + i] = p.idx[i] + vo;
      vo += p.pos.length / 3; io2 += p.idx.length;
    }
    const mat = grp.mat;
    const baseTex = mat && mat.getBaseColorTexture();
    const basePath = uriOf(baseTex, fetched.dir);
    let alphaPath = null;
    if (basePath) {
      const want = path.basename(basePath).replace(/_diff_/i, '_alpha_').replace(/\.(jpg|png)$/i, '');
      for (const p of Object.values(fetched.alphas)) if (path.basename(p).replace(/\.(jpg|png)$/i, '').toLowerCase() === want.toLowerCase()) alphaPath = p;
    }
    // A trunk can share a texture atlas with the leaves, so the presence of an alpha map alone
    // does not make a material foliage. Trust the material's alpha mode and its name.
    const lname = name.toLowerCase();
    const namedFoliage = /leaf|leaves|twig|needle|frond|petal|flower|grass|blade/.test(lname);
    const namedWood = /bark|trunk|branch|stem|wood|dead/.test(lname) && !namedFoliage;
    const foliage = !namedWood && ((mat && mat.getAlphaMode() !== 'OPAQUE') || namedFoliage);
    if (!foliage) alphaPath = null;
    mats.push({ name, mat, g, foliage, basePath, alphaPath, tris: nI / 3 });
    totalTris += nI / 3;
  }

  // Normalize: base at the origin, height to the catalog height.
  let minY = 1e9, maxY = -1e9;
  for (const mm of mats) for (let i = 1; i < mm.g.pos.length; i += 3) { if (mm.g.pos[i] < minY) minY = mm.g.pos[i]; if (mm.g.pos[i] > maxY) maxY = mm.g.pos[i]; }
  const hSrc = Math.max(1e-4, maxY - minY);
  let cx = 0, cz = 0, cn = 0;
  const band = minY + hSrc * (entry.kind === 'tree' ? 0.06 : 1);
  const wood = mats.filter((mm) => !mm.foliage);
  for (const mm of (entry.kind === 'tree' && wood.length ? wood : mats)) {
    for (let i = 0; i < mm.g.pos.length; i += 3) if (mm.g.pos[i + 1] <= band) { cx += mm.g.pos[i]; cz += mm.g.pos[i + 2]; cn++; }
  }
  if (cn) { cx /= cn; cz /= cn; }
  const k = entry.height / hSrc;
  let radius = 0;
  for (const mm of mats) {
    const p = mm.g.pos;
    for (let i = 0; i < p.length; i += 3) {
      p[i] = (p[i] - cx) * k; p[i + 1] = (p[i + 1] - minY) * k; p[i + 2] = (p[i + 2] - cz) * k;
      const r = Math.hypot(p[i], p[i + 2]);
      if (r > radius) radius = r;
    }
  }

  // Triangle budgets: foliage takes most of it when present.
  const folTris = mats.filter((mm) => mm.foliage).reduce((a, mm) => a + mm.tris, 0);
  const woodTris = totalTris - folTris;
  const lods = [];
  for (const target of [entry.lod0, entry.lod1]) {
    const folBudget = folTris && woodTris ? target * 0.78 : folTris ? target : 0;
    const woodBudget = target - folBudget;
    const rand = rng(Math.floor(rand0() * 1e9) + target);
    const out = [];
    for (const mm of mats) {
      const share = mm.foliage ? folBudget * (mm.tris / folTris) : woodBudget * (mm.tris / Math.max(1, woodTris));
      const g = reducePrim(mm.g, mm.foliage ? 'foliage' : 'wood', Math.max(12, share), rand, entry.kind === 'tree');
      out.push({ name: mm.name, g });
    }
    lods.push(out);
  }

  // Textures, built once and stored in the LOD1 file.
  const texSize = entry.kind === 'tree' ? 1024 : entry.kind === 'rock' ? 1024 : 512;
  const matInfo = [];
  const outDoc1 = new Document(), outDoc0 = new Document();
  const quiet = new Logger(Logger.Verbosity.SILENT);
  outDoc1.setLogger(quiet); outDoc0.setLogger(quiet);
  outDoc1.createExtension(EXTTextureWebP).setRequired(true);
  const mk = async (docOut, withTextures) => {
    const map = new Map();
    for (const mm of mats) {
      const mat = docOut.createMaterial(mm.name).setMetallicFactor(0).setRoughnessFactor(mm.foliage ? 0.62 : entry.kind === 'rock' ? 0.9 : 0.85).setDoubleSided(mm.foliage);
      if (mm.foliage) mat.setAlphaMode('MASK').setAlphaCutoff(0.42);
      if (withTextures && mm.basePath) {
        const size = mm.foliage ? texSize : Math.min(texSize, entry.kind === 'rock' ? 1024 : 512);
        const bc = await buildBaseColor(mm.basePath, mm.alphaPath, size, mm.foliage);
        mat.setBaseColorTexture(docOut.createTexture(mm.name + '_color').setImage(new Uint8Array(bc.buf)).setMimeType('image/webp'));
        const info = { name: mm.name, foliage: mm.foliage, avg: bc.avg, coverage: bc.coverage };
        const nTex = mm.mat && mm.mat.getNormalTexture();
        const nPath = uriOf(nTex, fetched.dir);
        if (nPath && !mm.foliage && entry.kind !== 'plant') {
          const nb = await sharp(nPath).resize(512, 512, { fit: 'fill' }).removeAlpha().webp({ quality: 88, effort: 5, smartSubsample: true }).toBuffer();
          mat.setNormalTexture(docOut.createTexture(mm.name + '_normal').setImage(new Uint8Array(nb)).setMimeType('image/webp'));
          info.normal = true;
        }
        matInfo.push(info);
      } else if (withTextures) matInfo.push({ name: mm.name, foliage: mm.foliage, avg: [0.4, 0.4, 0.4] });
      map.set(mm.name, mat);
    }
    return map;
  };
  const mats1 = await mk(outDoc1, true);
  const mats0 = await mk(outDoc0, false);

  const write = async (docOut, matMap, lod, lodName, file) => {
    const buffer = docOut.createBuffer();
    const mesh = docOut.createMesh(lodName);
    let tris = 0;
    for (const part of lod) {
      const g = part.g;
      if (g.idx.length < 3) continue;
      const nV = g.pos.length / 3;
      const prim = docOut.createPrimitive()
        .setAttribute('POSITION', docOut.createAccessor().setType('VEC3').setArray(g.pos).setBuffer(buffer))
        .setAttribute('NORMAL', docOut.createAccessor().setType('VEC3').setArray(g.nrm).setBuffer(buffer))
        .setAttribute('TEXCOORD_0', docOut.createAccessor().setType('VEC2').setArray(g.uv).setBuffer(buffer))
        .setIndices(docOut.createAccessor().setType('SCALAR').setArray(nV > 65535 ? g.idx : Uint16Array.from(g.idx)).setBuffer(buffer))
        .setMaterial(matMap.get(part.name));
      mesh.addPrimitive(prim);
      tris += g.idx.length / 3;
    }
    const node = docOut.createNode(lodName).setMesh(mesh);
    docOut.createScene('scene').addChild(node);
    // Positions and normals are quantized (the loader bakes the dequantization transform).
    // UVs stay as floats: LOD0 reuses the LOD1 file's materials, so a per-file UV transform
    // would not carry over.
    await docOut.transform(
      dedup(), prune({ keepAttributes: true }),
      reorder({ encoder: MeshoptEncoder, level: 'medium' }),
      quantize({ pattern: /^(POSITION|NORMAL)(_\d+)?$/, quantizePosition: 14, quantizeNormal: 8 }),
    );
    docOut.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    mkdirSync(path.dirname(file), { recursive: true });
    await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write(file, docOut);
    return { tris, bytes: statSync(file).size };
  };
  const f1 = path.join(outDir, `${entry.id}.glb`), f0 = path.join(outDir, `${entry.id}_lod0.glb`);
  const r1 = await write(outDoc1, mats1, lods[1], 'lod1', f1);
  const r0 = await write(outDoc0, mats0, lods[0], 'lod0', f0);
  return {
    file: `models/${entry.id}.glb`, lod0: `models/${entry.id}_lod0.glb`,
    tris: { lod0: r0.tris, lod1: r1.tris, source: Math.round(totalTris) },
    bytes: r0.bytes + r1.bytes, bytesLod0: r0.bytes, bytesLod1: r1.bytes,
    height: entry.height, radius: +radius.toFixed(2), kind: entry.kind, materials: matInfo,
    variants: nodes.length,
  };
}
