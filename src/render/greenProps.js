// The cup, the flagstick, and the flag. The flag is a small cloth simulated with Verlet
// integration and distance constraints, pinned along the pole and driven by the game wind.
import * as THREE from 'three';
import { CUP_RADIUS } from '../physics/ball.js';
import { fin } from '../core/guards.js';

const FLAG_W = 0.62, FLAG_H = 0.42, NX = 11, NY = 7;
const POLE_H = 2.13;

export function createGreenProps(world) {
  const { lighting } = world;
  const group = new THREE.Group();
  group.name = 'greenProps';

  // Cup: a white liner dropped into the hole the terrain shader cuts. Inside faces only.
  const linerMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.55, side: THREE.BackSide });
  lighting.setup(linerMat);
  const liner = new THREE.Mesh(new THREE.CylinderGeometry(CUP_RADIUS, CUP_RADIUS, 0.11, 28, 1, true), linerMat);
  liner.position.y = -0.055 + 0.002;
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.9 });
  lighting.setup(floorMat);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(CUP_RADIUS, 28).rotateX(-Math.PI / 2), floorMat);
  floor.position.y = -0.105;
  // The lip: the exposed top edge of the liner, a thin bright ring just below the turf.
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  lighting.setup(lipMat);
  const lip = new THREE.Mesh(new THREE.RingGeometry(CUP_RADIUS - 0.006, CUP_RADIUS + 0.0015, 40).rotateX(-Math.PI / 2), lipMat);
  lip.position.y = -0.012;
  const cup = new THREE.Group();
  cup.add(liner, floor, lip);
  group.add(cup);

  // Flagstick with a ferrule at the base.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.45, metalness: 0.05 });
  lighting.setup(poleMat);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0095, POLE_H, 10), poleMat);
  pole.position.y = POLE_H / 2 - 0.1;
  pole.castShadow = true;
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x20232a, roughness: 0.5 });
  lighting.setup(bandMat);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.5, 10), bandMat);
  band.position.y = 0.42;
  band.castShadow = true;
  const stick = new THREE.Group();
  stick.add(pole, band);
  group.add(stick);

  // Flag cloth.
  const n = NX * NY;
  const px = new Float32Array(n * 3), prev = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(px, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const uvs = new Float32Array(n * 2);
  const idx = [];
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    uvs[k * 2] = i / (NX - 1); uvs[k * 2 + 1] = 1 - j / (NY - 1);
    if (i < NX - 1 && j < NY - 1) idx.push(k, k + NX, k + 1, k + 1, k + NX, k + NX + 1);
  }
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xd8382c, roughness: 0.75, side: THREE.DoubleSide });
  lighting.setup(flagMat);
  const flag = new THREE.Mesh(geo, flagMat);
  flag.castShadow = true;
  flag.frustumCulled = false;
  group.add(flag);

  const top = POLE_H - 0.12;
  const restX = FLAG_W / (NX - 1), restY = FLAG_H / (NY - 1), restD = Math.hypot(restX, restY);
  const origin = new THREE.Vector3();
  function resetCloth(dirX, dirZ) {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = (j * NX + i) * 3;
      px[k] = origin.x + dirX * i * restX; px[k + 1] = origin.y + top - j * restY; px[k + 2] = origin.z + dirZ * i * restX;
      prev[k] = px[k]; prev[k + 1] = px[k + 1]; prev[k + 2] = px[k + 2];
    }
    posAttr.needsUpdate = true;
  }

  function constrain(a, b, rest) {
    const ax = a * 3, bx = b * 3;
    const dx = px[bx] - px[ax], dy = px[bx + 1] - px[ax + 1], dz = px[bx + 2] - px[ax + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const diff = (d - rest) / d;
    const pinnedA = a % NX === 0, pinnedB = b % NX === 0;
    if (pinnedA && pinnedB) return;
    const wa = pinnedA ? 0 : pinnedB ? 1 : 0.5, wb = pinnedB ? 0 : pinnedA ? 1 : 0.5;
    px[ax] += dx * diff * wa; px[ax + 1] += dy * diff * wa; px[ax + 2] += dz * diff * wa;
    px[bx] -= dx * diff * wb; px[bx + 1] -= dy * diff * wb; px[bx + 2] -= dz * diff * wb;
  }

  let acc = 0;
  const STEP = 1 / 90;
  function stepCloth(t, wind) {
    const wx = fin(wind.x, 0), wz = fin(wind.z, 0);
    const ws = Math.hypot(wx, wz);
    for (let j = 0; j < NY; j++) for (let i = 1; i < NX; i++) {
      const k = (j * NX + i) * 3;
      // Wind with a travelling ripple so the flag flutters instead of streaming rigidly.
      const flutter = Math.sin(t * (7 + ws * 0.6) - i * 0.9 + j * 0.5) * (0.5 + ws * 0.22);
      const ax = wx * 3.4 + -wz * flutter * 0.55, az = wz * 3.4 + wx * flutter * 0.55;
      const ay = -9.81 * 0.55 + flutter * 0.7 * Math.min(1, ws * 0.3);
      const vx = (px[k] - prev[k]) * 0.985, vy = (px[k + 1] - prev[k + 1]) * 0.985, vz = (px[k + 2] - prev[k + 2]) * 0.985;
      prev[k] = px[k]; prev[k + 1] = px[k + 1]; prev[k + 2] = px[k + 2];
      px[k] += vx + ax * STEP * STEP; px[k + 1] += vy + ay * STEP * STEP; px[k + 2] += vz + az * STEP * STEP;
    }
    for (let it = 0; it < 4; it++) {
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const k = j * NX + i;
        if (i < NX - 1) constrain(k, k + 1, restX);
        if (j < NY - 1) constrain(k, k + NX, restY);
        if (i < NX - 1 && j < NY - 1) { constrain(k, k + NX + 1, restD); constrain(k + 1, k + NX, restD); }
      }
    }
    // A sample that went non-finite is snapped back so one bad step cannot spread.
    for (let k = 0; k < n * 3; k++) if (!Number.isFinite(px[k])) { px[k] = prev[k] = k % 3 === 1 ? origin.y + top : k % 3 === 0 ? origin.x : origin.z; }
  }

  const props = {
    group, flagVisible: true,
    loadHole(w) {
      const t = w.terrain;
      origin.set(t.pin.x, t.heightAt(t.pin.x, t.pin.z), t.pin.z);
      cup.position.copy(origin);
      stick.position.copy(origin);
      const wd = w.wind || { x: 2, z: 0 };
      const l = Math.hypot(wd.x, wd.z) || 1;
      resetCloth(wd.x / l, wd.z / l);
      geo.computeVertexNormals();
      // Alternate flag colors hole by hole, as courses do for front, middle, and back pins.
      flagMat.color.setHex([0xd8382c, 0xf2c230, 0xf4f4f0][w.hole % 3]);
    },
    update(dt, t, w) {
      if (!flag.visible) return;
      acc = Math.min(acc + fin(dt, 0), 0.1);
      let steps = 0;
      while (acc >= STEP && steps < 6) { stepCloth(t, w.wind || { x: 2, z: 0 }); acc -= STEP; steps++; }
      if (steps) { posAttr.needsUpdate = true; geo.computeVertexNormals(); }
    },
    // The flagstick is pulled when putting from close range.
    setFlagVisible(v) { stick.visible = v; flag.visible = v; props.flagVisible = v; },
    flagTop(out) { return out.set(origin.x, origin.y + top, origin.z); },
    dispose() { geo.dispose(); },
  };
  return props;
}
