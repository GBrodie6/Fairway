// Procedural golf clubs: shaft, grip, and a head shaped per kind (driver, wood, iron, wedge,
// putter) with the club's own loft and lie. Original design: plain satin steel, a deep green
// crown on the woods, a charcoal grip; no logos or marks of any maker.
//
// Club space: the origin is the contact point on the face (where the ball is struck), X points
// to the toe, Y up, Z out of the back of the head (away from the target). A right-handed club
// is built; the view mirrors it for a left-hander.
import * as THREE from 'three';
import { clubGeometry, hoselOffset, BALL_R } from '../game/clubPath.js';

const DEG = Math.PI / 180;
const COLORS = {
  steel: 0xb9bec3, face: 0xa3a9ae, crown: 0x1d3328, sole: 0x8d9398, shaft: 0xc8cdd1, grip: 0x29332e, ferrule: 0x161a18, putter: 0x50565b, sight: 0xeeede4, groove: 0x6d7378,
};

// Shear every vertex so the face plane through the origin leans back by the loft.
function loftShear(geo, loft, fromZ = Infinity) {
  const p = geo.attributes.position, t = Math.tan(loft);
  for (let i = 0; i < p.count; i++) if (p.getZ(i) <= fromZ) p.setZ(i, p.getZ(i) + p.getY(i) * t);
  p.needsUpdate = true;
}
function vertexColors(geo, fn) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { col.setHex(fn(p.getX(i), p.getY(i), p.getZ(i))); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// Iron and wedge: a blade with a rounded toe, a straight sole, a top line that falls toward
// the heel, and a cavity-thick lower back. Wedges have a taller toe and a wider sole.
function bladeHead(kind, loft) {
  const wedge = kind === 'wedge';
  const sole = -BALL_R, heel = -hoselOffset(kind)[0];
  const toe = wedge ? 0.044 : 0.043, topToe = wedge ? 0.044 : 0.034, topHeel = wedge ? 0.022 : 0.018;
  const s = new THREE.Shape();
  s.moveTo(heel, sole + 0.004);
  s.quadraticCurveTo(heel, sole, heel + 0.006, sole);
  s.lineTo(toe - 0.012, sole);
  s.quadraticCurveTo(toe + 0.002, sole + 0.002, toe + 0.002, sole + 0.02);
  s.quadraticCurveTo(toe + 0.002, topToe, toe - 0.014, topToe);
  s.lineTo(heel + 0.006, topHeel);
  s.quadraticCurveTo(heel - 0.002, topHeel - 0.002, heel - 0.002, topHeel - 0.012);
  s.lineTo(heel, sole + 0.004);
  const depth = wedge ? 0.016 : 0.013;
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.0018, bevelSegments: 2, curveSegments: 8 });
  // The lower back is thicker (the cavity's muscle): push back vertices near the sole.
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), y = p.getY(i);
    if (z > depth * 0.5) p.setZ(i, z + Math.max(0, 0.012 - (y - sole)) * (wedge ? 1.1 : 0.9));
  }
  loftShear(geo, loft);
  geo.computeVertexNormals();
  // Grooves: darker horizontal bands on the face only.
  return vertexColors(geo, (x, y, z) => {
    const onFace = z - y * Math.tan(loft) < 0.001;
    if (onFace && x > heel + 0.008 && x < toe - 0.006) { const g = ((y - sole) / 0.0036) % 1; if (g > 0.78 && y > sole + 0.004) return COLORS.groove; }
    return onFace ? COLORS.face : COLORS.steel;
  });
}

// Driver and fairway woods: an ellipsoid body flattened into a lofted face at the front and a
// flat sole underneath.
function woodHead(kind, loft) {
  const drv = kind === 'driver';
  const hx = drv ? 0.059 : 0.047, hy = drv ? 0.031 : 0.019, hz = drv ? 0.062 : 0.045;
  const sole = -BALL_R, cy = sole + hy * (drv ? 0.98 : 1.0);
  const geo = new THREE.SphereGeometry(1, 40, 20);
  const p = geo.attributes.position, t = Math.tan(loft);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * hx + (drv ? 0.006 : 0.004), y = p.getY(i) * hy + cy, z = p.getZ(i) * hz + hz * 0.92;
    // Pear shape: narrower at the heel, deeper at the toe.
    if (x < 0) z = hz * 0.92 + (z - hz * 0.92) * (1 + x * 4);
    y = Math.max(y, sole);
    const zf = y * t;
    if (z < zf) z = zf;
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return vertexColors(geo, (x, y, z) => (z - y * t < 0.0008 ? COLORS.face : y < sole + 0.003 ? COLORS.sole : COLORS.crown));
}

// Putter: a mallet-like block, low and long, with a sight line on top.
function putterHead(loft) {
  const sole = -BALL_R;
  const geo = new THREE.BoxGeometry(0.104, 0.024, 0.034, 6, 2, 3);
  geo.translate(0.006, sole + 0.012, 0.017);
  const p = geo.attributes.position;
  // Round the back corners.
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - 0.006, z = p.getZ(i);
    if (z > 0.02) { const r = Math.abs(x) / 0.052; p.setZ(i, 0.02 + (z - 0.02) * Math.sqrt(Math.max(0, 1 - r * r * r))); }
  }
  loftShear(geo, loft);
  geo.computeVertexNormals();
  return vertexColors(geo, (x, y, z) => (y > sole + 0.0235 && Math.abs(x - 0.006) < 0.0016 ? COLORS.sight : COLORS.putter));
}

// Readability on a phone: the head is drawn a quarter larger (about the contact point, so the
// face still meets the ball), and the shaft and grip thicker than life.
const HEAD_SCALE = 1.25, SHAFT_SCALE = 1.9, GRIP_SCALE = 1.35;

/** A club group in club space. kind from clubGeometry(id). */
export function buildClub(clubId) {
  const g = clubGeometry(clubId), kind = g.kind, loft = g.loft * DEG, lie = g.lie * DEG;
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.32, envMapIntensity: 1.0, transparent: true });
  const head = new THREE.Mesh(kind === 'driver' || kind === 'wood' ? woodHead(kind, loft) : kind === 'putter' ? putterHead(loft * 0.6) : bladeHead(kind, loft), metal);
  head.scale.setScalar(HEAD_SCALE);
  group.add(head);
  // Shaft direction in club space: toward the player (-X) and up, at the lie angle.
  const d = new THREE.Vector3(-Math.cos(lie), Math.sin(lie), 0);
  const [heel, rise] = hoselOffset(kind);
  const hosel = new THREE.Vector3(-heel, rise, kind === 'putter' ? 0.004 : 0.006);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  const piece = (len, r0, r1, mat, from, seg = 14) => {
    const c = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
    c.translate(0, len / 2, 0);
    const m = new THREE.Mesh(c, mat);
    m.quaternion.copy(q);
    m.position.copy(hosel).addScaledVector(d, from);
    group.add(m);
    return m;
  };
  const steel = new THREE.MeshStandardMaterial({ color: COLORS.shaft, metalness: 0.85, roughness: 0.28, transparent: true });
  const gripMat = new THREE.MeshStandardMaterial({ color: COLORS.grip, metalness: 0.0, roughness: 0.82, transparent: true });
  const dark = new THREE.MeshStandardMaterial({ color: COLORS.ferrule, metalness: 0.2, roughness: 0.5, transparent: true });
  const hoselLen = kind === 'driver' || kind === 'wood' ? 0.035 : kind === 'putter' ? 0.06 : 0.055;
  // The hosel is part of the head (same metal, but plain color).
  const hoselMat = kind === 'driver' || kind === 'wood' ? dark : new THREE.MeshStandardMaterial({ color: kind === 'putter' ? COLORS.putter : COLORS.steel, metalness: 0.75, roughness: 0.32, transparent: true });
  const S = SHAFT_SCALE, G = GRIP_SCALE;
  piece(hoselLen, (kind === 'driver' ? 0.0085 : 0.0068) * S * 0.8, 0.0062 * S * 0.8, hoselMat, -0.01);
  piece(0.012, 0.0062 * S * 0.8, 0.0058 * S * 0.8, dark, hoselLen - 0.01);
  const gripLen = 0.265, shaftLen = g.length - gripLen - hoselLen;
  piece(shaftLen, 0.0046 * S, 0.0074 * S, steel, hoselLen, 12);
  piece(gripLen, 0.0105 * G, 0.0132 * G, gripMat, hoselLen + shaftLen, 16);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.0134 * G, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), gripMat);
  cap.quaternion.copy(q);
  cap.position.copy(hosel).addScaledVector(d, g.length);
  group.add(cap);
  group.userData = { kind, materials: [metal, steel, gripMat, dark, hoselMat], length: g.length };
  group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 5; } });
  return group;
}

export function disposeClub(group) {
  group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  for (const m of new Set(group.userData.materials || [])) m.dispose();
}
