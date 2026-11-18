// The practice ground's furniture, built in code like the course props (props.js): five open
// hitting bays with turf mats, rubber tees, dividers and ball baskets, side nets on tall
// poles, a clubhouse with a veranda, light towers that come on at dusk, yardage signs every
// 25 yards, flags on the five target greens, a ball picker cart that drives the field, and
// practice balls lying out on the grass. Built only when the loaded hole is the range.
import * as THREE from 'three';
import { Builder } from './props.js';
import { createRng } from '../core/rng.js';
import { YARD } from '../core/math.js';
import { BAY_X, MAT_Z } from '../course/range.js';

function signAtlas(yards) {
  const cols = 4, rows = Math.ceil(yards.length / cols), W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W * cols; c.height = H * rows;
  const g = c.getContext('2d');
  yards.forEach((y, i) => {
    const x0 = (i % cols) * W, y0 = Math.floor(i / cols) * H;
    const major = y % 50 === 0;
    g.fillStyle = major ? '#f4f1e6' : '#20382a'; g.fillRect(x0, y0, W, H);
    g.strokeStyle = major ? '#20382a' : '#e8dfbf'; g.lineWidth = 8; g.strokeRect(x0 + 6, y0 + 6, W - 12, H - 12);
    g.fillStyle = major ? '#20382a' : '#f4f1e6';
    g.font = '700 84px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(y), x0 + W / 2, y0 + H / 2 + 4);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { texture: t, cols, rows };
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(30, 34, 32, 0.95)'; g.lineWidth = 2;
  for (let i = 0; i <= 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255, 244, 214, 1)'); gr.addColorStop(0.25, 'rgba(255, 226, 170, 0.55)'); gr.addColorStop(1, 'rgba(255, 210, 150, 0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRangeProps(world, engine) {
  const { lighting } = world;
  const group = new THREE.Group();
  group.name = 'rangeProps';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.02, envMapIntensity: 0.5 });
  lighting.setup(mat, [], 'rangeProps');
  const signMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  lighting.setup(signMat, [], 'rangeSigns');
  const netMat = new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x3a3a34 });
  const windowMat = new THREE.MeshBasicMaterial({ color: 0x2a3036 });
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff0d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const flagMats = [];
  let disposables = [];
  let cart = null, cartPath = [], cartT = 0;
  const glows = [];
  let lightsOn = 0, lightsTarget = 0;

  function clear() {
    for (const c of [...group.children]) group.remove(c);
    for (const d of disposables) d.dispose();
    disposables = [];
    flagMats.length = 0; glows.length = 0; cart = null; cartPath = [];
  }

  function build(w) {
    const t = w.terrain, h = w.holeData;
    const H = (x, z) => t.heightAt(x, z);
    const rng = createRng(0x7a11 ^ h.seed);
    const b = new Builder();
    // --- the bays: mats, tees, dividers, baskets, a low rail behind ---
    const half = (BAY_X[BAY_X.length - 1] - BAY_X[0]) / 2 + BAY_X[1] - BAY_X[0];
    for (const x of BAY_X) {
      const y = H(x, MAT_Z);
      b.box(1.5, 0.035, 1.5, x, y + 0.017, MAT_Z - 0.1, 0, 0x2f6b3a);
      b.box(0.5, 0.037, 1.4, x, y + 0.019, MAT_Z - 0.1, 0, 0x3d8048); // the hitting strip
      b.cyl(0.012, 0.012, 0.05, x, y + 0.045, MAT_Z, 0x1b1d1f, 8); // rubber tee
      // Ball basket with a heap of balls.
      const bx = x - 1.0, bz = MAT_Z + 0.5, by = H(bx, bz);
      b.cyl(0.2, 0.16, 0.26, bx, by + 0.13, bz, 0x2f4a38, 14);
      for (let i = 0; i < 9; i++) b.sphere(0.03, bx + rng.range(-0.11, 0.11), by + 0.27 + rng.range(0, 0.05), bz + rng.range(-0.11, 0.11), 0xf6f6f2, 1, 8);
      // Bay number plate on a short post.
      b.box(0.05, 0.75, 0.05, x + 1.2, H(x + 1.2, MAT_Z + 1.4) + 0.37, MAT_Z + 1.4, 0, 0x4a3a2a);
    }
    for (let i = 0; i <= BAY_X.length; i++) {
      const dx = (i === 0 ? BAY_X[0] - (BAY_X[1] - BAY_X[0]) / 2 : i === BAY_X.length ? BAY_X[i - 1] + (BAY_X[1] - BAY_X[0]) / 2 : (BAY_X[i - 1] + BAY_X[i]) / 2);
      const z = MAT_Z + 1.2;
      b.box(0.08, 1.05, 2.0, dx, H(dx, z) + 0.52, z, 0, 0x5a4632);
      b.box(0.1, 0.06, 2.04, dx, H(dx, z) + 1.07, z, 0, 0x3a2e22);
    }
    // A low rail well behind the bays (behind the address camera, which sits about 5 m back).
    for (let x = -half; x < half; x += 2) b.box(2.02, 0.07, 0.07, x + 1, H(x + 1, MAT_Z + 7.5) + 0.85, MAT_Z + 7.5, 0, 0x3a2e22);
    for (let x = -half; x <= half; x += 4) b.box(0.08, 0.9, 0.08, x, H(x, MAT_Z + 7.5) + 0.45, MAT_Z + 7.5, 0, 0x3a2e22);
    // --- side nets on tall poles ---
    const netX = half + 3.5;
    const netGeo = [];
    for (const side of [-1, 1]) {
      for (let z = 8; z >= -42; z -= 10) {
        const x = side * netX;
        b.cyl(0.11, 0.14, 14, x, H(x, z) + 7, z, 0x3c4044, 10);
      }
      const len = 50, x = side * netX, zc = 8 - len / 2;
      const g = new THREE.PlaneGeometry(len, 13.4);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.8, uv.getY(i) * 13.4 / 0.8);
      const m = new THREE.Mesh(g, netMat);
      m.rotation.y = Math.PI / 2;
      m.position.set(x, H(x, zc) + 7, zc);
      m.renderOrder = 2;
      group.add(m); netGeo.push(g);
    }
    disposables.push(...netGeo);
    // --- clubhouse behind the bays, facing the field ---
    {
      const cx = 0, cz = 34, cy = H(cx, cz);
      b.box(26, 0.5, 13, cx, cy + 0.1, cz, 0, 0x9a9488); // plinth
      b.box(24, 5.2, 10, cx, cy + 2.9, cz + 1, 0, 0xd8d0bc);
      b.roof(25.6, 3.4, 11.6, cx, cy + 5.5, cz + 1, Math.PI / 2, 0x5a3a2c);
      b.box(26, 0.25, 4.2, cx, cy + 3.3, cz - 5.6, 0, 0x6a4a36); // veranda roof
      for (let x = -12; x <= 12; x += 4) b.box(0.22, 3.2, 0.22, cx + x, cy + 1.7, cz - 7.4, 0, 0xeee8dc);
      b.box(3, 2.6, 0.2, cx, cy + 1.6, cz - 4.05, 0, 0x5a4632); // the door
      // Window band, a separate mesh so it can glow at night.
      const win = new THREE.Mesh(new THREE.PlaneGeometry(20, 1.6), windowMat);
      win.position.set(cx, cy + 3.0, cz - 4.02);
      win.rotation.y = Math.PI;
      group.add(win); disposables.push(win.geometry);
      // A ball dispenser kiosk beside the bays.
      const kx = -half - 6, kz = 6, ky = H(kx, kz);
      b.box(1.4, 2.0, 1.0, kx, ky + 1.0, kz, 0, 0x2f5a44);
      b.box(1.5, 0.12, 1.1, kx, ky + 2.06, kz, 0, 0x22262a);
      b.box(0.6, 0.4, 0.04, kx, ky + 1.4, kz - 0.52, 0, 0xf2c230);
    }
    // --- light towers: behind the bays and down both sides ---
    const towers = [[-26, 9], [26, 9], [-70, -70], [70, -70], [-70, -160], [70, -160]];
    for (const [x, z] of towers) {
      const gy = H(x, z);
      b.cyl(0.18, 0.28, 18, x, gy + 9, z, 0x5a6066, 10);
      b.box(3.2, 1.0, 0.4, x, gy + 18.3, z, Math.atan2(-x, -z - 120), 0x3c4044);
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), lampMat);
      const yaw = Math.atan2(-x, -(z + 140) + z);
      lamp.position.set(x, gy + 18.3, z - 0.22);
      lamp.rotation.y = yaw;
      group.add(lamp); disposables.push(lamp.geometry);
      const glow = new THREE.Sprite(glowMat);
      glow.position.set(x, gy + 18.3, z - 0.6);
      glow.scale.setScalar(9);
      glow.renderOrder = 4;
      group.add(glow); glows.push(glow);
    }
    // --- yardage signs every 25 yards, alternating sides, larger with distance ---
    const atlas = signAtlas(h.signs.map((s) => s.yards));
    signMat.map = atlas.texture; signMat.needsUpdate = true;
    disposables.push(atlas.texture);
    h.signs.forEach((s, i) => {
      const side = i % 2 ? 1 : -1;
      const x = side * (20 + (s.yards % 50 === 0 ? 8 : 0)), z = s.z;
      const sw = 2.4 + s.yards / 55, sh = sw / 2; // big enough to read from the bays
      const gy = H(x, z);
      for (const px of [-sw * 0.38, sw * 0.38]) b.box(0.12, sh + 0.6, 0.12, x + px, gy + (sh + 0.6) / 2, z + 0.08, 0, 0x4a3a2a);
      const g = new THREE.PlaneGeometry(sw, sh);
      const uv = g.attributes.uv;
      const cx = i % atlas.cols, cy = Math.floor(i / atlas.cols);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / atlas.cols, 1 - (cy + 1 - uv.getY(k)) / atlas.rows);
      const m = new THREE.Mesh(g, signMat);
      m.position.set(x, gy + 0.6 + sh / 2, z);
      m.rotation.y = Math.atan2(-x, -z + 40) * 0.25; // turned a little toward the bays
      group.add(m); disposables.push(g);
      b.box(sw + 0.08, sh + 0.08, 0.05, x, gy + 0.6 + sh / 2, z - 0.03, m.rotation.y, 0x22262a);
    });
    // --- target flags ---
    for (const tg of h.targets) {
      const gy = H(tg.x, tg.z);
      b.cyl(0.022, 0.022, 3.2, tg.x, gy + 1.6, tg.z, 0xf2f2ee, 8);
      b.cyl(0.06, 0.06, 0.01, tg.x, gy + 0.004, tg.z, 0x101010, 14);
      const fm = new THREE.MeshStandardMaterial({ color: new THREE.Color(tg.color), roughness: 0.8, side: THREE.DoubleSide });
      lighting.setup(fm, [], 'rangeFlag');
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), fm);
      flag.position.set(tg.x + 0.55, gy + 2.8, tg.z);
      flag.userData.base = { x: tg.x, y: gy + 2.8, z: tg.z };
      group.add(flag); flagMats.push(flag); disposables.push(fm, flag.geometry);
      // A ring of white disc markers around the green edge.
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2, r = tg.radius + 0.8;
        const mx = tg.x + Math.cos(ang) * r, mz = tg.z + Math.sin(ang) * r;
        b.cyl(0.14, 0.14, 0.04, mx, H(mx, mz) + 0.02, mz, 0xf4f4ee, 10);
      }
    }
    // --- practice balls out on the field ---
    const nBalls = 220;
    const ballGeo = new THREE.SphereGeometry(0.0214, 8, 6);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.35 });
    lighting.setup(ballMat, [], 'rangeBalls');
    const balls = new THREE.InstancedMesh(ballGeo, ballMat, nBalls);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < nBalls; i++) {
      const z = -rng.range(30, 270) * YARD, x = rng.range(-1, 1) * (12 + -z * 0.12);
      m4.makeTranslation(x, H(x, z) + 0.02, z);
      balls.setMatrixAt(i, m4);
    }
    balls.instanceMatrix.needsUpdate = true;
    group.add(balls); disposables.push(ballGeo, ballMat);
    // Merge the static pieces.
    const geo = b.build();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); disposables.push(geo);
    // --- the picker cart, driving a loop down the field and back ---
    cart = buildCart();
    group.add(cart);
    for (let k = 0; k < 4; k++) {
      const z0 = -60 - k * 52;
      cartPath.push({ x: -44, z: z0 }, { x: 44, z: z0 - 26 });
    }
    cartPath.push({ x: -44, z: -60 + 26 });
    cartT = 0;
    world.rangeInfo = { netX, towers: towers.length, signs: h.signs.length, targets: h.targets.length, bays: BAY_X.length };
  }

  function buildCart() {
    const b = new Builder();
    b.box(1.3, 0.55, 2.1, 0, 0.62, 0, 0, 0xe0a23a); // body
    b.box(1.2, 0.08, 1.2, 0, 1.75, -0.2, 0, 0x2a2c30); // cage roof
    for (const [x, z] of [[-0.58, 0.35], [0.58, 0.35], [-0.58, -0.8], [0.58, -0.8]]) b.box(0.05, 0.9, 0.05, x, 1.3, z, 0, 0x2a2c30);
    for (const [x, z] of [[-0.62, 0.7], [0.62, 0.7], [-0.62, -0.7], [0.62, -0.7]]) {
      const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(x, 0.28, z);
      b.add(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 14), m, 0x1b1d1f);
    }
    // Gang collector towed behind: a row of discs on an axle.
    b.box(2.6, 0.06, 0.06, 0, 0.22, 1.7, 0, 0x3c4044);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(-1.2 + i * 0.3, 0.2, 1.7);
      b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12), m, 0x5a6066);
    }
    b.box(0.06, 0.06, 0.9, 0, 0.3, 1.2, 0, 0x3c4044);
    const geo = b.build();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    disposables.push(geo);
    const g = new THREE.Group();
    g.add(m);
    return g;
  }

  function cartAt(u, out) {
    const n = cartPath.length - 1;
    // Segment lengths for constant speed.
    let total = 0;
    const lens = [];
    for (let i = 0; i < n; i++) { const l = Math.hypot(cartPath[i + 1].x - cartPath[i].x, cartPath[i + 1].z - cartPath[i].z); lens.push(l); total += l; }
    let d = ((u % total) + total) % total;
    for (let i = 0; i < n; i++) {
      if (d <= lens[i]) { const f = d / lens[i], a = cartPath[i], c = cartPath[i + 1]; out.x = a.x + (c.x - a.x) * f; out.z = a.z + (c.z - a.z) * f; out.yaw = Math.atan2(c.x - a.x, c.z - a.z); return out; }
      d -= lens[i];
    }
    return out;
  }

  const tmp = { x: 0, z: 0, yaw: 0 };
  const rp = {
    group, active: false,
    unloadHole: () => { clear(); rp.active = false; },
    loadHole(w) {
      clear();
      rp.active = !!(w.holeData && w.holeData.range);
      if (rp.active) build(w);
      rp.setTimeOfDay(w.tod || { id: w.todId });
    },
    setTimeOfDay(tod) {
      const on = tod && (tod.night || tod.id === 'dusk') ? 1 : 0;
      lightsTarget = on;
      lightsOn = on;
      glowMat.opacity = on * 0.9;
      lampMat.color.setHex(on ? 0xfff2d4 : 0x3a3a34);
      windowMat.color.setHex(on ? 0xffd89a : 0x2a3036);
    },
    update(dt, t) {
      if (!rp.active) return;
      if (lightsOn !== lightsTarget) lightsOn = lightsTarget;
      // Flags ripple a little in the wind.
      const wv = world.wind || { x: 0, z: 0 };
      const ws = Math.hypot(wv.x, wv.z);
      for (const f of flagMats) {
        const base = f.userData.base, ang = Math.atan2(wv.x, wv.z) + Math.sin(t * 2.3 + base.x) * 0.15 * Math.min(1, ws / 6);
        f.rotation.y = ang - Math.PI / 2;
        f.position.set(base.x + Math.sin(ang) * 0.55, base.y, base.z + Math.cos(ang) * 0.55);
      }
      if (cart && cartPath.length > 1) {
        cartT += dt * 3.2;
        cartAt(cartT, tmp);
        const terr = world.terrain;
        cart.position.set(tmp.x, terr.heightAt(tmp.x, tmp.z), tmp.z);
        cart.rotation.y = tmp.yaw + Math.PI;
      }
    },
    cartPosition: () => (cart ? { x: cart.position.x, y: cart.position.y, z: cart.position.z } : null),
    dispose() { clear(); mat.dispose(); signMat.dispose(); netMat.map.dispose(); netMat.dispose(); lampMat.dispose(); windowMat.dispose(); glowMat.map.dispose(); glowMat.dispose(); },
  };
  return rp;
}
