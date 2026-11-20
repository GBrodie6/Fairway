// Course furniture, built in code (neither asset source offers golf furniture as CC0 models):
// tee markers, a hole sign with live text, a park bench and ball washer, yardage posts,
// sprinkler heads, footbridges where the path crosses a stream, a clubhouse and out-buildings
// on the opening and closing holes, grandstands with an instanced crowd on tournament holes,
// flags on neighboring holes in the distance, and a flock of birds.
// Static pieces are merged into one vertex-colored mesh, so the whole set costs a few draws.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { fin } from '../core/guards.js';

const TEE_COLORS = [0x1c2a4a, 0xf2f2ee, 0xc8372c];
const YARD_COLORS = { 100: 0xc8372c, 150: 0xf2f2ee, 200: 0x2c5fa8 };

export class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._n = new THREE.Vector3(); this._c = new THREE.Color(); this._nm = new THREE.Matrix3(); }
  add(geo, matrix, color) {
    const base = this.pos.length / 3;
    const p = geo.attributes.position, n = geo.attributes.normal;
    this._nm.getNormalMatrix(matrix);
    this._c.set(color);
    for (let i = 0; i < p.count; i++) {
      this._v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this._n.fromBufferAttribute(n, i).applyMatrix3(this._nm).normalize();
      this.pos.push(this._v.x, this._v.y, this._v.z); this.nor.push(this._n.x, this._n.y, this._n.z); this.col.push(this._c.r, this._c.g, this._c.b);
    }
    const ix = geo.index ? geo.index.array : null;
    const cnt = ix ? ix.length : p.count;
    for (let i = 0; i < cnt; i++) this.idx.push(base + (ix ? ix[i] : i));
    geo.dispose();
  }
  box(w, h, d, x, y, z, rotY, color, rotX = 0) {
    this._m.makeRotationFromEuler(new THREE.Euler(rotX, rotY, 0, 'YXZ')).setPosition(x, y, z);
    this.add(new THREE.BoxGeometry(w, h, d), this._m, color);
  }
  sphere(r, x, y, z, color, sy = 1, seg = 12) {
    this._m.makeScale(1, sy, 1).setPosition(x, y, z);
    this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), this._m, color);
  }
  cyl(r0, r1, h, x, y, z, color, seg = 10) {
    this._m.makeTranslation(x, y, z);
    this.add(new THREE.CylinderGeometry(r0, r1, h, seg), this._m, color);
  }
  // A gabled roof as a triangular prism along the local z axis.
  roof(w, h, d, x, y, z, rotY, color) {
    const g = new THREE.BufferGeometry();
    const hw = w / 2, hd = d / 2;
    const v = [-hw, 0, -hd, hw, 0, -hd, 0, h, -hd, -hw, 0, hd, hw, 0, hd, 0, h, hd];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4]);
    const ng = g.toNonIndexed(); ng.computeVertexNormals(); g.dispose();
    this._m.makeRotationY(rotY).setPosition(x, y, z);
    this.add(ng, this._m, color);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function signTexture(hole) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#20382a'; g.fillRect(0, 0, 256, 192);
  g.strokeStyle = '#d9c88f'; g.lineWidth = 6; g.strokeRect(8, 8, 240, 176);
  g.fillStyle = '#f1ead2'; g.textAlign = 'center';
  g.font = '600 78px Georgia, serif'; g.fillText(String(hole.number), 128, 92);
  g.font = '500 30px Georgia, serif'; g.fillText(`Par ${hole.par}`, 128, 132);
  g.font = '400 26px Georgia, serif'; g.fillText(`${hole.yards} yards`, 128, 166);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Abstract spectators: a head and a tapered body in flat color. No likeness of anyone.
function crowdTexture() {
  const N = 8, W = 32, H = 64;
  const c = document.createElement('canvas');
  c.width = W * N; c.height = H;
  const g = c.getContext('2d');
  const shirts = ['#c8483a', '#3a6fc8', '#e8e2d0', '#3f8f5a', '#e0b23a', '#7a4fa8', '#2f3440', '#d98a4a'];
  const skins = ['#e6c3a0', '#c99a72', '#8a5a3c', '#f0d2b4'];
  for (let i = 0; i < N; i++) {
    const x = i * W + W / 2;
    g.fillStyle = shirts[i];
    g.beginPath(); g.moveTo(x - 10, H); g.lineTo(x - 11, 30); g.quadraticCurveTo(x, 20, x + 11, 30); g.lineTo(x + 10, H); g.fill();
    g.fillStyle = skins[i % skins.length];
    g.beginPath(); g.arc(x, 15, 8, 0, Math.PI * 2); g.fill();
    if (i % 3 === 0) { g.fillStyle = '#f4f4f0'; g.fillRect(x - 9, 6, 18, 5); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createProps(world, engine) {
  const tier = engine.tier;
  const { lighting } = world;
  const group = new THREE.Group();
  group.name = 'props';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.02, envMapIntensity: 0.5 });
  lighting.setup(mat, [], 'props');
  const signMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  lighting.setup(signMat, [], 'propsSign');
  const crowdTex = crowdTexture();
  const crowdMat = new THREE.MeshStandardMaterial({ map: crowdTex, alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide });
  lighting.setup(crowdMat, [(shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aVar;\nuniform float uCrowdTime;\nuniform float uCheer;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv = vec2((uv.x + aVar) / 8.0, uv.y);')
      // Spectators face the camera around the vertical axis and bob when they cheer.
      .replace('#include <project_vertex>', `vec3 ip = instanceMatrix[3].xyz; vec3 tc = cameraPosition - ip; tc.y = 0.0; tc = normalize(tc + vec3(1e-5, 0.0, 0.0)); vec3 rt = vec3(tc.z, 0.0, -tc.x);
        float bob = uCheer * max(0.0, sin(uCrowdTime * 9.0 + aVar * 3.7 + ip.x)) * 0.16;
        vec3 wp = ip + rt * position.x + vec3(0.0, position.y + bob, 0.0);
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0); gl_Position = projectionMatrix * mvPosition;`);
    shader.uniforms.uCrowdTime = crowdUniforms.uCrowdTime; shader.uniforms.uCheer = crowdUniforms.uCheer;
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
  }], 'crowd');
  const crowdUniforms = { uCrowdTime: { value: 0 }, uCheer: { value: 0 } };
  const birdMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uNight: { value: 0 } },
    vertexShader: `attribute vec4 aBird; uniform float uT; uniform vec3 uCenter;
      void main(){ float a = aBird.x + uT * aBird.y; float r = aBird.z; vec3 c = uCenter + vec3(cos(a) * r, aBird.w + sin(uT * 0.3 + aBird.x) * 4.0, sin(a) * r);
      vec3 fw = vec3(-sin(a), 0.0, cos(a)) * sign(aBird.y); vec3 rt = vec3(fw.z, 0.0, -fw.x);
      float flap = sin(uT * 7.0 + aBird.x * 5.0) * 0.5; vec3 p = c + fw * position.z + rt * position.x + vec3(0.0, abs(position.x) * flap, 0.0);
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: 'uniform float uNight; void main(){ gl_FragColor = vec4(vec3(0.03, 0.035, 0.04) * (1.0 - uNight * 0.8), 1.0); }',
    side: THREE.DoubleSide,
  });
  let disposables = [];
  let cheer = 0;

  function clear() {
    for (const c of [...group.children]) group.remove(c);
    for (const d of disposables) d.dispose();
    disposables = [];
  }

  const props = {
    group, triangles: 0, crowd: 0,
    unloadHole: clear,
    loadHole(w) {
      clear();
      const t = w.terrain, h = w.holeData;
      if (h.range) return; // the practice ground has its own furniture (rangeProps.js)
      const rng = createRng((h.seed ^ 0x51ed27) >>> 0);
      const H = (x, z) => t.heightAt(x, z);
      const b = new Builder();
      const tee0 = h.tees[0];
      const right = { x: -tee0.tz, z: tee0.tx };
      const yawOf = (dx, dz) => Math.atan2(dx, dz);
      const teeYaw = yawOf(tee0.tx, tee0.tz);

      // Tee markers: a pair of ball-shaped markers on short spikes at the front of each box,
      // with a dark band around the middle.
      h.tees.forEach((tee, i) => {
        for (const s of [-1, 1]) {
          const x = tee.x + right.x * s * (tee.w / 2 - 0.7) + tee.tx * 0.6, z = tee.z + right.z * s * (tee.w / 2 - 0.7) + tee.tz * 0.6;
          const y = H(x, z);
          b.cyl(0.012, 0.012, 0.06, x, y + 0.03, z, 0x2a2c30, 6);
          b.sphere(0.1, x, y + 0.13, z, TEE_COLORS[i], 0.82, 14);
          b.cyl(0.101, 0.101, 0.018, x, y + 0.13, z, 0x22262a, 14);
        }
      });
      // Hole sign, bench, ball washer, and bin beside the back tee on the path side.
      const side = h.path.side;
      const sx = tee0.x + right.x * side * (tee0.w / 2 + 3.2) - tee0.tx * 1.5, sz = tee0.z + right.z * side * (tee0.w / 2 + 3.2) - tee0.tz * 1.5;
      const sy = H(sx, sz);
      b.box(0.1, 1.5, 0.1, sx, sy + 0.75, sz, teeYaw, 0x4a3a2a);
      const signTex = signTexture(h);
      signMat.map = signTex; signMat.needsUpdate = true;
      disposables.push(signTex);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.72), signMat);
      board.position.set(sx - tee0.tx * 0.07, sy + 1.45, sz - tee0.tz * 0.07);
      board.rotation.y = teeYaw + Math.PI;
      board.castShadow = true;
      group.add(board);
      disposables.push(board.geometry);
      b.box(1.02, 0.78, 0.04, sx, sy + 1.45, sz, teeYaw, 0x33261a);
      // Bench: slatted seat and back on two frames.
      const bx = tee0.x + right.x * side * (tee0.w / 2 + 3.4) - tee0.tx * 5, bz = tee0.z + right.z * side * (tee0.w / 2 + 3.4) - tee0.tz * 5;
      const by = H(bx, bz);
      const benchYaw = teeYaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      const fwdB = { x: Math.sin(benchYaw), z: Math.cos(benchYaw) }, rtB = { x: Math.cos(benchYaw), z: -Math.sin(benchYaw) };
      for (let i = 0; i < 4; i++) b.box(1.5, 0.03, 0.09, bx + fwdB.x * (i * 0.11 - 0.16), by + 0.44, bz + fwdB.z * (i * 0.11 - 0.16), benchYaw, 0x7a5a3a);
      for (let i = 0; i < 3; i++) b.box(1.5, 0.09, 0.03, bx - fwdB.x * 0.24, by + 0.58 + i * 0.13, bz - fwdB.z * 0.24, benchYaw, 0x7a5a3a);
      for (const s of [-0.62, 0.62]) {
        b.box(0.06, 0.44, 0.44, bx + rtB.x * s, by + 0.22, bz + rtB.z * s, benchYaw, 0x2a2c30);
        b.box(0.06, 0.5, 0.05, bx + rtB.x * s - fwdB.x * 0.24, by + 0.66, bz + rtB.z * s - fwdB.z * 0.24, benchYaw, 0x2a2c30);
      }
      // Ball washer and bin.
      const wx = bx + rtB.x * 1.6, wz = bz + rtB.z * 1.6;
      b.cyl(0.03, 0.03, 1.0, wx, H(wx, wz) + 0.5, wz, 0x2a2c30, 8);
      b.cyl(0.09, 0.09, 0.26, wx, H(wx, wz) + 0.98, wz, 0xb8262a, 12);
      const nx2 = bx - rtB.x * 1.5, nz2 = bz - rtB.z * 1.5;
      b.cyl(0.24, 0.2, 0.7, nx2, H(nx2, nz2) + 0.35, nz2, 0x2f4a38, 12);
      // Yardage stakes at the fairway edge (square, white with a colored top) and sprinkler
      // heads on the centerline.
      for (const m of h.markers) {
        const my = H(m.x, m.z);
        b.box(0.07, 0.7, 0.07, m.x, my + 0.35, m.z, teeYaw, 0xeeeeea);
        b.box(0.075, 0.18, 0.075, m.x, my + 0.79, m.z, teeYaw, YARD_COLORS[m.yards] || 0xffffff);
        const p = h.line[Math.min(h.line.length - 1, Math.round(m.s / h.lineStep))];
        b.cyl(0.11, 0.11, 0.012, p.x, H(p.x, p.z) + 0.004, p.z, 0x1b1d1f, 14);
        b.cyl(0.05, 0.05, 0.016, p.x, H(p.x, p.z) + 0.006, p.z, YARD_COLORS[m.yards] || 0xffffff, 10);
      }
      // Concrete edging along both sides of the cart path.
      {
        const pp = h.path.pts, hw = h.path.half + 0.05;
        for (let i = 0; i < pp.length - 1; i++) {
          const a = pp[i], c = pp[i + 1];
          const dx = c.x - a.x, dz = c.z - a.z, len = Math.hypot(dx, dz);
          if (len < 0.2) continue;
          const nx = -dz / len, nz = dx / len, yaw = Math.atan2(dx, dz);
          const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
          for (const sd of [-1, 1]) {
            const ex = mx + nx * hw * sd, ez = mz + nz * hw * sd;
            if (!t.inBounds(ex, ez, 2) || t.isWater(ex, ez)) continue;
            b.box(0.11, 0.09, len + 0.05, ex, H(ex, ez) + 0.02, ez, yaw, 0xb9b4a8);
          }
        }
      }
      // By the green, on the path side: a bench and a sign pointing to the next tee.
      {
        const g = h.green, gs = h.path.side;
        const ox = g.x + g.az * gs * (g.radius + 9) + g.ax * 4, oz = g.z - g.ax * gs * (g.radius + 9) + g.az * 4;
        if (t.inBounds(ox, oz, 4) && !t.isWater(ox, oz)) {
          const oy = H(ox, oz), yaw2 = Math.atan2(g.x - ox, g.z - oz);
          const f2 = { x: Math.sin(yaw2), z: Math.cos(yaw2) }, r2 = { x: Math.cos(yaw2), z: -Math.sin(yaw2) };
          for (let i = 0; i < 4; i++) b.box(1.5, 0.03, 0.09, ox + f2.x * (i * 0.11 - 0.16), oy + 0.44, oz + f2.z * (i * 0.11 - 0.16), yaw2, 0x7a5a3a);
          for (let i = 0; i < 3; i++) b.box(1.5, 0.09, 0.03, ox - f2.x * 0.24, oy + 0.58 + i * 0.13, oz - f2.z * 0.24, yaw2, 0x7a5a3a);
          for (const sd of [-0.62, 0.62]) b.box(0.06, 0.44, 0.44, ox + r2.x * sd, oy + 0.22, oz + r2.z * sd, yaw2, 0x2a2c30);
          const px = ox + r2.x * 2.2, pz = oz + r2.z * 2.2, py = H(px, pz);
          b.box(0.07, 1.2, 0.07, px, py + 0.6, pz, yaw2, 0x4a3a2a);
          b.box(0.62, 0.2, 0.03, px + r2.x * 0.25, py + 1.1, pz + r2.z * 0.25, yaw2, 0x20382a);
        }
      }
      // Footbridge where the cart path crosses a stream.
      for (const wtr of h.water) {
        if (wtr.type !== 'stream') continue;
        const pp = h.path.pts;
        for (let i = 0; i < pp.length - 1; i++) {
          const a = pp[i], c = pp[i + 1];
          const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
          let near = 1e9;
          for (const q of wtr.pts) near = Math.min(near, Math.hypot(q.x - mx, q.z - mz));
          if (near > Math.hypot(c.x - a.x, c.z - a.z) * 0.6) continue;
          const yaw = yawOf(c.x - a.x, c.z - a.z);
          const len = wtr.half * 2 + 7;
          const y = Math.max(H(a.x, a.z), H(c.x, c.z)) + 0.25;
          b.box(2.6, 0.14, len, mx, y, mz, yaw, 0x8a6a48);
          for (const s of [-1.2, 1.2]) {
            const rx = Math.cos(yaw) * s, rz = -Math.sin(yaw) * s;
            b.box(0.08, 0.08, len, mx + rx, y + 0.95, mz + rz, yaw, 0x6a4f34);
            for (let k = -2; k <= 2; k++) b.box(0.08, 0.95, 0.08, mx + rx + Math.sin(yaw) * k * len / 4.4, y + 0.5, mz + rz + Math.cos(yaw) * k * len / 4.4, yaw, 0x6a4f34);
          }
          break;
        }
      }
      // Clubhouse and out-buildings on the opening and closing holes.
      const club = h.index === 0 || h.index === 9 ? 'tee' : h.index === 8 || h.index === 17 ? 'green' : null;
      if (club) {
        const ref = club === 'tee' ? { x: tee0.x - tee0.tx * 46 + right.x * side * 26, z: tee0.z - tee0.tz * 46 + right.z * side * 26 } : { x: h.green.x + h.green.ax * 52 - h.green.az * side * 26, z: h.green.z + h.green.az * 52 + h.green.ax * side * 26 };
        if (t.inBounds(ref.x, ref.z, 30)) {
          const yaw = teeYaw + 0.3 * side;
          const gy = H(ref.x, ref.z);
          const wall = 0xe8e2d2, roofC = 0x5a3c30, trim = 0x3a4a3e;
          b.box(22, 5.2, 11, ref.x, gy + 2.6, ref.z, yaw, wall);
          b.roof(23.4, 3.4, 12.4, ref.x, gy + 5.2, ref.z, yaw + Math.PI / 2, roofC);
          const ox = Math.cos(yaw) * 14, oz = -Math.sin(yaw) * 14;
          b.box(9, 4.2, 9, ref.x + ox, gy + 2.1, ref.z + oz, yaw, wall);
          b.roof(10.2, 2.8, 10.2, ref.x + ox, gy + 4.2, ref.z + oz, yaw, roofC);
          // Veranda posts and windows.
          const fx = Math.sin(yaw), fz = Math.cos(yaw);
          for (let k = -4; k <= 4; k++) {
            const px = ref.x + Math.cos(yaw) * k * 2.4 + fx * 6.6, pz = ref.z - Math.sin(yaw) * k * 2.4 + fz * 6.6;
            b.box(0.18, 3.0, 0.18, px, gy + 1.5, pz, yaw, trim);
            if (k < 4) b.box(1.3, 1.5, 0.08, ref.x + Math.cos(yaw) * (k * 2.4 + 1.2) + fx * 5.52, gy + 2.6, ref.z - Math.sin(yaw) * (k * 2.4 + 1.2) + fz * 5.52, yaw, 0x2c3a48);
          }
          b.box(23, 0.16, 2.4, ref.x + fx * 6.4, gy + 3.1, ref.z + fz * 6.4, yaw, roofC);
          // A small starter hut or halfway house.
          const hx = ref.x - Math.cos(yaw) * 20 + fx * 8, hz = ref.z + Math.sin(yaw) * 20 + fz * 8;
          if (t.inBounds(hx, hz, 10)) { b.box(4, 2.6, 4, hx, H(hx, hz) + 1.3, hz, yaw, 0xd8d0bc); b.roof(4.8, 1.6, 4.8, hx, H(hx, hz) + 2.6, hz, yaw, trim); }
        }
      }
      // Grandstands beside the green on tournament holes, with a crowd.
      const seats = [];
      if (h.tournament) {
        const g = h.green;
        for (const s of [-side, side]) {
          const dist = g.radius + 19;
          const cx = g.x - g.az * s * dist + g.ax * 6, cz = g.z + g.ax * s * dist + g.az * 6;
          if (!t.inBounds(cx, cz, 16) || t.surfaceAt(cx, cz) === 11) continue;
          const yaw = yawOf(g.x - cx, g.z - cz);
          const gy = H(cx, cz);
          const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
          const rows = 6, wdt = s === side ? 20 : 14;
          for (let r = 0; r < rows; r++) {
            const px = cx - fx * r * 0.85, pz = cz - fz * r * 0.85;
            b.box(wdt, 0.12, 0.8, px, gy + 0.5 + r * 0.42, pz, yaw, 0xb9bcc0);
            b.box(wdt, 0.42 + r * 0.42, 0.06, px - fx * 0.4, gy + (0.42 + r * 0.42) / 2, pz - fz * 0.4, yaw, 0x8d9197);
            const n = Math.floor(wdt / 0.62);
            for (let k = 0; k < n; k++) {
              if (rng.next() < 0.14) continue;
              const u = (k + 0.5) / n - 0.5;
              seats.push(px + rx * u * (wdt - 0.6), gy + 0.56 + r * 0.42, pz + rz * u * (wdt - 0.6), rng.int(0, 7), 0.85 + rng.next() * 0.25);
            }
          }
          b.box(wdt + 0.4, 0.08, 0.08, cx + fx * 0.5, gy + 1.2, cz + fz * 0.5, yaw, 0x2a2c30);
        }
      }
      // Flags of neighboring holes in the distance (stand-ins, unless the real other holes are
      // drawn around this one: render/scenery.js).
      for (let i = 0; i < (w.scenery ? 0 : 4); i++) {
        const a = rng.range(0, 6.28), d = rng.range(170, 420);
        const x = (t.x0 + t.maxX) / 2 + Math.cos(a) * d * 1.4, z = (t.z0 + t.maxZ) / 2 + Math.sin(a) * d * 2.0;
        if (t.inBounds(x, z, 0)) continue;
        const y = w.terrainView.outerHeightAt(x, z);
        if (w.course.theme.seaLevel !== null && y < w.course.theme.seaLevel + 1) continue;
        b.cyl(0.02, 0.02, 2.2, x, y + 1.1, z, 0xf2f2e8, 6);
        b.box(0.5, 0.34, 0.02, x + 0.26, y + 2.0, z, 0, [0xd8382c, 0xf2c230][i % 2]);
      }

      const geo = b.build();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      disposables.push(geo);
      props.triangles = geo.index.count / 3;

      // Crowd instances (capped by tier).
      const want = Math.min(seats.length / 5, tier.crowd);
      props.crowd = want;
      if (want > 0) {
        const pg = new THREE.PlaneGeometry(0.5, 1.0);
        pg.translate(0, 0.5, 0);
        const vars = new Float32Array(want);
        const im = new THREE.InstancedMesh(pg, crowdMat, want);
        const m4 = new THREE.Matrix4();
        const stride = seats.length / 5 / want;
        for (let i = 0; i < want; i++) {
          const k = Math.floor(i * stride) * 5;
          m4.makeScale(seats[k + 4], seats[k + 4], seats[k + 4]).setPosition(seats[k], seats[k + 1], seats[k + 2]);
          im.setMatrixAt(i, m4);
          vars[i] = seats[k + 3];
        }
        pg.setAttribute('aVar', new THREE.InstancedBufferAttribute(vars, 1));
        im.frustumCulled = false;
        im.castShadow = false;
        group.add(im);
        disposables.push(pg);
      }
      // Birds: a loose flock circling high over the hole.
      const NB = tier.id === 'low' ? 6 : 14;
      const bg = new THREE.InstancedBufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute([-0.55, 0, -0.1, 0, 0, 0.12, 0, 0, -0.14, 0.55, 0, -0.1, 0, 0, -0.14, 0, 0, 0.12], 3));
      const ba = new Float32Array(NB * 4);
      for (let i = 0; i < NB; i++) { ba[i * 4] = rng.range(0, 6.28); ba[i * 4 + 1] = rng.range(0.05, 0.12) * rng.sign(); ba[i * 4 + 2] = rng.range(40, 150); ba[i * 4 + 3] = rng.range(28, 70); }
      bg.setAttribute('aBird', new THREE.InstancedBufferAttribute(ba, 4));
      bg.instanceCount = NB;
      const birds = new THREE.Mesh(bg, birdMat);
      birds.frustumCulled = false;
      const mid = h.line[Math.floor(h.line.length / 2)];
      birdMat.uniforms.uCenter.value.set(mid.x, H(mid.x, mid.z), mid.z);
      group.add(birds);
      disposables.push(bg);
      props.birds = birds;
    },
    setTimeOfDay(tod) { birdMat.uniforms.uNight.value = tod.night ? 1 : 0; if (props.birds) props.birds.visible = !tod.night; },
    // The crowd reacts to a good shot.
    cheer(amount = 1) { cheer = Math.max(cheer, amount); },
    update(dt, t) {
      birdMat.uniforms.uT.value = fin(t, 0) % 3600;
      crowdUniforms.uCrowdTime.value = fin(t, 0) % 3600;
      cheer = Math.max(0, cheer - fin(dt, 0) * 0.45);
      crowdUniforms.uCheer.value = cheer;
    },
    dispose() { clear(); mat.dispose(); signMat.dispose(); crowdMat.dispose(); crowdTex.dispose(); birdMat.dispose(); },
  };
  return props;
}
