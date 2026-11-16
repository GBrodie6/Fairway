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
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    const y = H * (0.04 + t * 0.94);
    const len = W * 0.47 * Math.sin(Math.PI * (0.12 + t * 0.86)) * (0.85 + 0.15 * Math.sin(i * 1.7));
    for (const side of [-1, 1]) {
      const shade = 70 + Math.round(60 * Math.sin(i * 0.9 + side));
      g.fillStyle = `rgb(${Math.round(shade * 0.42)},${shade + 40},${Math.round(shade * 0.3)})`;
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + side * len * 0.55, y - 9, W / 2 + side * len, y + 14);
      g.quadraticCurveTo(W / 2 + side * len * 0.5, y + 5, W / 2, y + 7);
      g.fill();
    }
  }
  g.fillStyle = '#6f7d3a';
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

let shared = null;
function textures() {
  if (!shared) shared = { frond: frondTexture(), palmBark: barkTexture([128, 112, 92], [84, 72, 58]), cactus: barkTexture([78, 118, 70], [58, 92, 54]) };
  return shared;
}

export function buildPalm() {
  const tex = textures();
  const H = 11;
  const pts = [], rad = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    // A gentle lean and curve, thicker at the foot.
    pts.push(new THREE.Vector3(Math.sin(t * 1.3) * 1.1, t * H, t * t * 0.5));
    rad.push(0.26 - t * 0.1 + (i === 0 ? 0.12 : 0));
  }
  const trunk = tube(pts, rad, 8, 9);
  const top = pts[pts.length - 1];
  const fronds = [];
  const N = 15;
  for (let i = 0; i < N; i++) {
    const yaw = (i / N) * Math.PI * 2 + (i % 2) * 0.2;
    const ring = i % 3;
    fronds.push(frond(top, yaw, [0.75, 0.35, -0.05][ring], 4.2 + ring * 0.5, 1.5, [0.55, 0.85, 1.1][ring]));
  }
  const info = { height: H + 2.4, radius: 5.2, kind: 'tree', materials: [{ name: 'palm_trunk', foliage: false, avg: [0.2, 0.16, 0.12] }, { name: 'palm_fronds', foliage: true, avg: [0.06, 0.16, 0.04] }], procedural: true };
  const wood = new THREE.MeshStandardMaterial({ map: tex.palmBark, roughness: 0.9, name: 'palm_trunk' });
  const leaf = new THREE.MeshStandardMaterial({ map: tex.frond, roughness: 0.6, alphaTest: 0.42, side: THREE.DoubleSide, name: 'palm_fronds' });
  return { id: 'palm', info, lod1: [{ geometry: trunk, material: wood, name: 'palm_trunk' }, { geometry: merge(fronds), material: leaf, name: 'palm_fronds' }], lod0: null };
}

export function buildSaguaro() {
  const tex = textures();
  const parts = [];
  const H = 6.2;
  const col = (x, z, h, r, lean) => {
    const pts = [], rad = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3(x + lean * t * t, 0, z).setY(t * h)); rad.push(r * (i === 8 ? 0.55 : 1 - t * 0.12)); }
    return { pts, rad };
  };
  const main = col(0, 0, H, 0.34, 0.1);
  parts.push(tube(main.pts, main.rad, 10, 3));
  // Two arms: out, then up.
  for (const [side, y0, len, h] of [[1, 2.6, 0.95, 2.3], [-1, 3.3, 0.8, 1.7]]) {
    const pts = [], rad = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const bend = Math.min(1, t * 2.2);
      pts.push(new THREE.Vector3(side * len * Math.sin(bend * Math.PI / 2), y0 + (1 - Math.cos(bend * Math.PI / 2)) * 0.5 + Math.max(0, t - 0.45) * h * 1.8, 0.05 * side));
      rad.push(0.2 * (i === 8 ? 0.55 : 1));
    }
    parts.push(tube(pts, rad, 8, 2));
  }
  const info = { height: H, radius: 1.4, kind: 'tree', materials: [{ name: 'cactus', foliage: false, avg: [0.07, 0.16, 0.06] }], procedural: true };
  const mat = new THREE.MeshStandardMaterial({ map: tex.cactus, roughness: 0.75, name: 'cactus' });
  return { id: 'saguaro', info, lod1: [{ geometry: merge(parts), material: mat, name: 'cactus' }], lod0: null };
}

export function buildReeds() {
  const tex = textures();
  const blades = [];
  let seed = 7;
  const r = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 16; i++) {
    const yaw = r() * 6.28;
    blades.push(frond(new THREE.Vector3((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5), yaw, 1.35 + r() * 0.15, 1.3 + r() * 0.7, 0.07, 0.08 + r() * 0.2));
  }
  const info = { height: 1.9, radius: 0.6, kind: 'plant', materials: [{ name: 'reeds', foliage: true, avg: [0.1, 0.18, 0.05] }], procedural: true };
  const leaf = new THREE.MeshStandardMaterial({ map: tex.frond, roughness: 0.6, alphaTest: 0.3, side: THREE.DoubleSide, name: 'reeds', color: 0xc8d890 });
  return { id: 'reeds', info, lod1: [{ geometry: merge(blades), material: leaf, name: 'reeds' }], lod0: null };
}

export const PROCEDURAL_BUILDERS = { palm: buildPalm, saguaro: buildSaguaro, reeds: buildReeds };
