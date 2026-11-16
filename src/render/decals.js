// Persistent ground marks: ball marks on greens, divots in turf, craters and footprints in
// sand. Drawn as instanced quads laid on the terrain. The game keeps the list per hole for
// the whole round, so a mark made on the 3rd is still there if the hole is revisited.
import * as THREE from 'three';
import { safeRadialGradient } from '../core/guards.js';

export const DECAL = Object.freeze({ BALL_MARK: 0, DIVOT: 1, CRATER: 2, FOOTPRINT: 3 });
const MAX = 220;
const SIZE = { 0: [0.07, 0.085], 1: [0.11, 0.26], 2: [0.2, 0.2], 3: [0.13, 0.3] };

// One 2x2 atlas, painted on a canvas: no downloaded art.
function makeAtlas() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d');
  // Ball mark: a small dark dent with a raised pale rim on one side.
  let gr = safeRadialGradient(g, S / 2, S / 2, 2, S / 2, S / 2, S * 0.44, [[0, 'rgba(40,34,20,0.85)'], [0.55, 'rgba(60,70,30,0.55)'], [0.8, 'rgba(150,170,90,0.35)'], [1, 'rgba(0,0,0,0)']]);
  if (gr) { g.fillStyle = gr; g.fillRect(0, 0, S, S); }
  // Divot: a strip of exposed soil, ragged at the far end.
  g.save(); g.translate(S, 0);
  const dv = g.createLinearGradient(0, 0, 0, S);
  dv.addColorStop(0, 'rgba(70,50,30,0)'); dv.addColorStop(0.12, 'rgba(84,60,36,0.9)'); dv.addColorStop(0.85, 'rgba(96,72,44,0.85)'); dv.addColorStop(1, 'rgba(96,72,44,0)');
  g.fillStyle = dv;
  g.beginPath(); g.moveTo(S * 0.3, S * 0.05); g.bezierCurveTo(S * 0.72, S * 0.02, S * 0.76, S * 0.5, S * 0.68, S * 0.93); g.lineTo(S * 0.34, S * 0.96); g.bezierCurveTo(S * 0.24, S * 0.5, S * 0.22, S * 0.2, S * 0.3, S * 0.05); g.fill();
  g.restore();
  // Sand crater: a bright rim around a shaded bowl.
  g.save(); g.translate(0, S);
  gr = safeRadialGradient(g, S / 2, S / 2, 2, S / 2, S / 2, S * 0.48, [[0, 'rgba(120,100,70,0.6)'], [0.5, 'rgba(140,118,84,0.45)'], [0.72, 'rgba(250,238,205,0.5)'], [1, 'rgba(0,0,0,0)']]);
  if (gr) { g.fillStyle = gr; g.fillRect(0, 0, S, S); }
  g.restore();
  // Footprint: sole and heel pressed into sand.
  g.save(); g.translate(S, S);
  g.fillStyle = 'rgba(120,100,72,0.55)';
  g.beginPath(); g.ellipse(S / 2, S * 0.36, S * 0.2, S * 0.3, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(S / 2, S * 0.8, S * 0.15, S * 0.14, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createDecals(world) {
  const atlas = makeAtlas();
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const offs = new Float32Array(MAX * 2);
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(offs, 2));
  const mat = new THREE.MeshStandardMaterial({ map: atlas, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  world.lighting.setup(mat, [(shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aOff;').replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv = vMapUv * 0.5 + aOff;');
  }], 'decals');
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  const list = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), qy = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const tmp = {};

  function place(i, d) {
    const t = world.terrain;
    t.normalAt(d.x, d.z, tmp);
    nrm.set(tmp.x, tmp.y, tmp.z);
    q.setFromUnitVectors(up, nrm);
    qy.setFromAxisAngle(up, d.rot);
    q.multiply(qy);
    pos.set(d.x, t.heightAt(d.x, d.z) + 0.004, d.z);
    const sz = SIZE[d.type];
    scl.set(sz[0] * d.scale, 1, sz[1] * d.scale);
    m4.compose(pos, q, scl);
    mesh.setMatrixAt(i, m4);
    offs[i * 2] = (d.type % 2) * 0.5;
    offs[i * 2 + 1] = d.type < 2 ? 0.5 : 0; // canvas row 0 is the top half of the texture
  }
  function rebuild() {
    const n = Math.min(list.length, MAX);
    for (let i = 0; i < n; i++) place(i, list[list.length - n + i]);
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    geo.attributes.aOff.needsUpdate = true;
  }

  return {
    group: mesh, list,
    add(type, x, z, rot = 0, scale = 1) {
      if (![x, z, rot, scale].every(Number.isFinite)) return;
      list.push({ type, x, z, rot, scale });
      if (list.length > MAX * 2) list.splice(0, list.length - MAX);
      rebuild();
    },
    // A ball landing in sand: a crater plus the tracks of the player walking in and out.
    addBunkerVisit(x, z, heading) {
      this.add(DECAL.CRATER, x, z, 0, 1.3);
      for (let i = 0; i < 9; i++) {
        const side = i % 2 ? 0.16 : -0.16, back = 0.5 + i * 0.36;
        const fx = Math.sin(heading), fz = -Math.cos(heading);
        const px = x - fx * back + -fz * side + 0.5 * -fz, pz = z - fz * back + fx * side + 0.5 * fx;
        if (world.terrain.groundSurfaceAt(px, pz) === 7) list.push({ type: DECAL.FOOTPRINT, x: px, z: pz, rot: heading + (i % 2 ? 0.25 : -0.25), scale: 1 });
      }
      rebuild();
    },
    // Replace the whole list (when a hole loads, with that hole's saved marks).
    set(items) { list.length = 0; for (const d of items || []) list.push({ ...d }); rebuild(); },
    snapshot() { return list.map((d) => ({ ...d })); },
    loadHole() { rebuild(); },
    dispose() { geo.dispose(); mat.dispose(); atlas.dispose(); },
  };
}
