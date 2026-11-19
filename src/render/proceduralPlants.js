// Plants that neither asset source offers as a CC0 model (checked against both catalogs):
// palm trees, a columnar cactus, and reeds. Built in code from curves and cards, with their
// textures painted on a canvas. They go through the same instancing, LOD, and impostor path
// as the downloaded models.
import * as THREE from 'three';

function frondTexture() {
  const W = 128, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  // A feather-shaped frond: a midrib with leaflets angled toward the tip.
  // Narrow leaflets with gaps between them, in a muted, slightly yellow green.
  for (let i = 0; i < 58; i++) {
    const t = i / 57;
    const y = H * (0.04 + t * 0.94);
    const len = W * 0.47 * Math.sin(Math.PI * (0.12 + t * 0.86)) * (0.82 + 0.18 * Math.sin(i * 1.7));
    for (const side of [-1, 1]) {
      const shade = 80 + Math.round(40 * Math.sin(i * 0.9 + side));
      g.fillStyle = `rgb(${Math.round(shade * 0.62 + 6)},${Math.round(shade * 0.92 + 18)},${Math.round(shade * 0.36)})`;
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + side * len * 0.55, y - 5, W / 2 + side * len, y + 12);
      g.quadraticCurveTo(W / 2 + side * len * 0.52, y + 1.5, W / 2, y + 3.2);
      g.fill();
    }
  }
  g.fillStyle = '#6b6a3c';
  g.fillRect(W / 2 - 2, 0, 4, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function barkTexture(base, ring) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 256; y++) {
    const band = (y % 22) < 3 ? ring : base;
    const n = 0.85 + 0.3 * Math.sin(y * 1.7) * Math.sin(y * 0.31);
    g.fillStyle = `rgb(${Math.round(band[0] * n)},${Math.round(band[1] * n)},${Math.round(band[2] * n)})`;
    g.fillRect(0, y, 64, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function merge(geos) {
  let nV = 0, nI = 0;
  for (const g of geos) { nV += g.attributes.position.count; nI += g.index.count; }
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), uv = new Float32Array(nV * 2);
  const idx = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

// A tube along a curve with a radius profile.
function tube(points, radii, sides, vRepeat) {
  const g = new THREE.BufferGeometry();
  const n = points.length;
  const pos = [], nor = [], uv = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0), tan = new THREE.Vector3(), bx = new THREE.Vector3(), bz = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    tan.copy(points[Math.min(n - 1, i + 1)]).sub(points[Math.max(0, i - 1)]).normalize();
    bx.crossVectors(Math.abs(tan.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : up, tan).normalize();
    bz.crossVectors(tan, bx).normalize();
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const nx = bx.x * c + bz.x * sn, ny = bx.y * c + bz.y * sn, nz = bx.z * c + bz.z * sn;
      pos.push(points[i].x + nx * radii[i], points[i].y + ny * radii[i], points[i].z + nz * radii[i]);
      nor.push(nx, ny, nz);
      uv.push(s / sides, (i / (n - 1)) * vRepeat);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) {
    const a = i * (sides + 1) + s, b = a + 1, c = a + sides + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// A frond: a strip that arches out from the crown and droops under its own weight.
function frond(origin, yaw, pitch, length, width, droop) {
  const SEG = 6;
  const pos = [], nor = [], uv = [], idx = [];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const out = length * t * Math.cos(pitch - droop * t * t * 1.2);
    const up = length * t * Math.sin(pitch) - droop * length * t * t;
    const w = width * Math.sin(Math.PI * (0.1 + t * 0.85)) * 0.5 + 0.02;
    const px = origin.x + cy * out, pz = origin.z + sy * out, py = origin.y + up;
    // The strip is V-folded along the midrib like a real frond.
    pos.push(px - sy * w, py - w * 0.25, pz + cy * w, px, py, pz, px + sy * w, py - w * 0.25, pz - cy * w);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    uv.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i < SEG; i++) {
    const a = i * 3;
    idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Cactus skin: grooves between the ribs, a pale bloom on the ribs, and rows of spine clusters.
function cactusTexture(ribs) {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  for (let x = 0; x < W; x++) {
    const ph = (x / W) * ribs;
    const f = ph - Math.floor(ph); // 0 groove .. 0.5 rib crest .. 1 groove
    const crest = Math.sin(Math.PI * f);
    // Grey-olive, not grass green: saguaro skin is waxy and pale.
    const r = 86 + 28 * crest, gr = 100 + 30 * crest, b = 80 + 22 * crest;
    g.fillStyle = `rgb(${r | 0},${gr | 0},${b | 0})`;
    g.fillRect(x, 0, 1, H);
  }
  // Areoles: small pale tufts along each rib crest.
  for (let k = 0; k < ribs; k++) {
    const x = ((k + 0.5) / ribs) * W;
    for (let y = 4; y < H; y += 11) {
      g.fillStyle = 'rgba(214,206,170,0.85)';
      g.beginPath(); g.arc(x, y + (k % 2) * 5, 1.3, 0, Math.PI * 2); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
// A reed or sedge blade: a narrow strap that tapers to a point, yellowing toward the tip.
function bladeTexture() {
  const W = 32, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    const t = y / H; // 0 tip .. 1 base
    const half = (W / 2) * Math.min(1, 0.15 + t * 1.6);
    const r = Math.round(110 - t * 70), gr = Math.round(130 - t * 30), b = Math.round(50 - t * 20);
    g.fillStyle = `rgb(${r},${gr},${b})`;
    g.fillRect(W / 2 - half, y, half * 2, 1);
  }
  g.fillStyle = 'rgba(40,60,20,0.5)';
  g.fillRect(W / 2 - 0.5, 0, 1, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let shared = null;
function textures() {
  if (!shared) shared = { frond: frondTexture(), palmBark: barkTexture([98, 86, 72], [66, 56, 46]), cactus: cactusTexture(12), blade: bladeTexture() };
  return shared;
}

// A seeded random source so every variant is the same on every load.
function rand(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}
// A ribbed column: a tube whose radius rises and falls around its circumference.
function ribbed(points, radii, ribs, amp) {
  const sides = ribs * 2;
  const g = tube(points, radii, sides, 1);
  const pos = g.attributes.position, nor = g.attributes.normal;
  for (let i = 0; i < points.length; i++) {
    for (let k = 0; k <= sides; k++) {
      const v = i * (sides + 1) + k;
      const crest = k % 2 === 0 ? 1 : -1;
      const s = 1 + amp * crest;
      const px = points[i].x, py = points[i].y, pz = points[i].z;
      pos.setXYZ(v, px + (pos.getX(v) - px) * s, py + (pos.getY(v) - py) * s, pz + (pos.getZ(v) - pz) * s);
    }
  }
  g.computeVertexNormals();
  return g;
}

function palm(id, seed, H, lean) {
  const tex = textures();
  const r = rand(seed);
  const pts = [], rad = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    // A lean that curves back toward vertical near the crown, thicker at the foot.
    pts.push(new THREE.Vector3(Math.sin(t * 1.25) * lean, t * H, t * t * lean * 0.35));
    rad.push(0.24 - t * 0.08 + Math.max(0, 0.16 - t * 1.4));
  }
  const trunk = tube(pts, rad, 9, Math.round(H * 0.9));
  const top = pts[pts.length - 1];
  const fronds = [], dead = [];
  const N = 22;
  for (let i = 0; i < N; i++) {
    const yaw = (i / N) * Math.PI * 2 + r() * 0.35;
    const ring = i % 3;
    const len = 3.6 + ring * 0.6 + r() * 0.9;
    fronds.push(frond(top, yaw, [0.85, 0.4, 0.0][ring] + (r() - 0.5) * 0.2, len, 1.35 + r() * 0.4, [0.5, 0.85, 1.15][ring] + r() * 0.2));
  }
  // The boot: a few dead fronds hanging down the trunk under the crown.
  for (let i = 0; i < 7; i++) {
    const yaw = r() * Math.PI * 2;
    dead.push(frond(new THREE.Vector3(top.x, top.y - 0.4, top.z), yaw, -1.05 - r() * 0.25, 2.0 + r() * 0.8, 0.9, 0.2));
  }
  // Coconuts.
  const nuts = [];
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2;
    const sph = new THREE.SphereGeometry(0.13, 6, 5);
    sph.translate(top.x + Math.cos(a) * 0.3, top.y - 0.25 - r() * 0.15, top.z + Math.sin(a) * 0.3);
    nuts.push(sph);
  }
  const info = { height: H + 2.4, radius: 5.0, kind: 'tree', materials: [{ name: 'palm_trunk', foliage: false, avg: [0.2, 0.16, 0.12] }, { name: 'palm_fronds', foliage: true, avg: [0.06, 0.16, 0.04] }, { name: 'palm_dead', foliage: true, avg: [0.2, 0.15, 0.08] }], procedural: true };
  const wood = new THREE.MeshStandardMaterial({ map: tex.palmBark, roughness: 0.9, name: 'palm_trunk' });
  const leaf = new THREE.MeshStandardMaterial({ map: tex.frond, roughness: 0.6, alphaTest: 0.38, side: THREE.DoubleSide, name: 'palm_fronds' });
  const deadMat = new THREE.MeshStandardMaterial({ map: tex.frond, color: 0xc9a46a, roughness: 0.85, alphaTest: 0.38, side: THREE.DoubleSide, name: 'palm_dead' });
  return { id, info, lod1: [{ geometry: merge([trunk, ...nuts]), material: wood, name: 'palm_trunk' }, { geometry: merge(fronds), material: leaf, name: 'palm_fronds' }, { geometry: merge(dead), material: deadMat, name: 'palm_dead' }], lod0: null };
}
export function buildPalm() { return palm('palm', 11, 11, 1.1); }
export function buildPalm2() { return palm('palm2', 29, 8.5, 2.0); }

// Columnar cactus with 12 ribs. Arms grow out, then turn up; younger plants have none.
function saguaro(id, seed, H, arms) {
  const tex = textures();
  const r = rand(seed);
  const parts = [];
  const col = (h, rr) => {
    const pts = [], rad = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector3(0.06 * Math.sin(t * 2.0), t * h, 0)); rad.push(rr * (i === 10 ? 0.45 : i === 9 ? 0.85 : 1 - t * 0.1)); }
    return { pts, rad };
  };
  const main = col(H, 0.33);
  parts.push(ribbed(main.pts, main.rad, 12, 0.07));
  for (let k = 0; k < arms; k++) {
    const yaw = (k / arms) * Math.PI * 2 + r() * 0.9;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const y0 = H * (0.36 + r() * 0.24), out = 0.75 + r() * 0.35, up = 1.2 + r() * (H * 0.35);
    const pts = [], rad = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const bend = Math.min(1, t * 2.4);
      const h = (1 - Math.cos(bend * Math.PI / 2)) * 0.45 + Math.max(0, t - 0.42) * up * 1.7;
      const o = out * Math.sin(bend * Math.PI / 2) + 0.28;
      pts.push(new THREE.Vector3(cy * o, y0 + h, sy * o));
      rad.push(0.21 * (i === 10 ? 0.5 : i === 9 ? 0.85 : 1));
    }
    parts.push(ribbed(pts, rad, 10, 0.07));
  }
  const info = { height: H, radius: 1.5, kind: 'tree', materials: [{ name: 'cactus', foliage: false, avg: [0.07, 0.15, 0.06] }], procedural: true };
  const mat = new THREE.MeshStandardMaterial({ map: tex.cactus, roughness: 0.7, name: 'cactus' });
  return { id, info, lod1: [{ geometry: merge(parts), material: mat, name: 'cactus' }], lod0: null };
}
export function buildSaguaro() { return saguaro('saguaro', 5, 6.4, 2); }
export function buildSaguaro2() { return saguaro('saguaro2', 17, 7.6, 4); }
export function buildSaguaro3() { return saguaro('saguaro3', 23, 3.4, 0); }

// A clump of reeds and sedges: narrow tapering blades of mixed height, a few bent over,
// with cattail heads on stiff stalks.
export function buildReeds() {
  const tex = textures();
  const r = rand(7);
  const blades = [], heads = [];
  for (let i = 0; i < 46; i++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * 0.55;
    const len = 0.8 + r() * 1.3;
    blades.push(frond(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), r() * 6.28, 1.25 + r() * 0.28, len, 0.05 + r() * 0.03, 0.04 + r() * 0.35 * (len > 1.6 ? 1 : 0.4)));
  }
  for (let i = 0; i < 5; i++) {
    const a = r() * 6.28, d = r() * 0.4, h = 1.5 + r() * 0.6;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const stalk = tube([new THREE.Vector3(x, 0, z), new THREE.Vector3(x + 0.02, h, z)], [0.008, 0.006], 4, 1);
    const head = tube([new THREE.Vector3(x + 0.02, h - 0.02, z), new THREE.Vector3(x + 0.02, h + 0.22, z)], [0.028, 0.026], 6, 1);
    heads.push(stalk, head);
  }
  const info = { height: 2.2, radius: 0.8, kind: 'plant', materials: [{ name: 'reeds', foliage: true, avg: [0.1, 0.16, 0.05] }, { name: 'cattail', foliage: false, avg: [0.12, 0.07, 0.03] }], procedural: true };
  const leaf = new THREE.MeshStandardMaterial({ map: tex.blade, roughness: 0.65, alphaTest: 0.35, side: THREE.DoubleSide, name: 'reeds' });
  const brown = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.9, name: 'cattail' });
  return { id: 'reeds', info, lod1: [{ geometry: merge(blades), material: leaf, name: 'reeds' }, { geometry: merge(heads), material: brown, name: 'cattail' }], lod0: null };
}

// Flowering shrubs for the real-course looks: a rounded azalea mound in bloom (pink and
// white) and a spiky gorse bush with yellow flowers. A few squashed spheres merged into one
// mound, wearing a painted texture of leaves and blossoms.
function blossomTexture(seed, leaf, blossoms, density) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = rand(seed);
  g.fillStyle = `rgb(${leaf.join(',')})`; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 220; i++) { const v = 0.75 + r() * 0.4; g.fillStyle = `rgb(${leaf.map((x) => Math.round(x * v)).join(',')})`; g.fillRect(r() * 128, r() * 128, 3, 2); }
  for (let i = 0; i < density; i++) {
    const col = blossoms[Math.floor(r() * blossoms.length)], rad = 1.4 + r() * 2.4;
    g.fillStyle = `rgb(${col.join(',')})`;
    g.beginPath(); g.arc(r() * 128, r() * 128, rad, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
function flowerBush(id, seed, { leaf, blossoms, density, height, radius, lobes, spiky }) {
  const r = rand(seed);
  const parts = [];
  for (let i = 0; i < lobes; i++) {
    const a = r() * 6.28, d = i === 0 ? 0 : radius * (0.25 + r() * 0.45);
    const rx = radius * (0.5 + r() * 0.35), ry = height * (0.45 + r() * 0.3);
    const geo = new THREE.SphereGeometry(1, spiky ? 9 : 8, spiky ? 6 : 5);
    if (spiky) { const pos = geo.attributes.position; for (let k = 0; k < pos.count; k++) { const f = 0.82 + r() * 0.36; pos.setXYZ(k, pos.getX(k) * f, pos.getY(k) * f, pos.getZ(k) * f); } geo.computeVertexNormals(); }
    geo.scale(rx, ry, rx);
    geo.translate(Math.cos(a) * d, ry * 0.82, Math.sin(a) * d);
    parts.push(geo);
  }
  const avg = leaf.map((x, k) => (x * 0.7 + blossoms[0][k] * 0.3) / 255);
  const info = { height: height * 1.6, radius, kind: 'plant', materials: [{ name: id, foliage: false, avg }], procedural: true };
  const mat = new THREE.MeshStandardMaterial({ map: blossomTexture(seed, leaf, blossoms, density), roughness: 0.85, name: id });
  return { id, info, lod1: [{ geometry: merge(parts), material: mat, name: id }], lod0: null };
}
export function buildAzalea() { return flowerBush('azalea', 41, { leaf: [38, 72, 34], blossoms: [[236, 92, 156], [248, 176, 206], [250, 244, 246], [214, 58, 120]], density: 520, height: 0.9, radius: 1.1, lobes: 5, spiky: false }); }
export function buildAzalea2() { return flowerBush('azalea2', 43, { leaf: [40, 76, 36], blossoms: [[250, 246, 248], [246, 210, 226], [236, 120, 170]], density: 460, height: 0.75, radius: 0.95, lobes: 4, spiky: false }); }
export function buildGorse() { return flowerBush('gorse', 47, { leaf: [48, 66, 30], blossoms: [[246, 204, 40], [252, 222, 70], [230, 180, 30]], density: 300, height: 0.85, radius: 1.0, lobes: 5, spiky: true }); }

export const PROCEDURAL_BUILDERS = { palm: buildPalm, palm2: buildPalm2, saguaro: buildSaguaro, saguaro2: buildSaguaro2, saguaro3: buildSaguaro3, reeds: buildReeds, azalea: buildAzalea, azalea2: buildAzalea2, gorse: buildGorse };
