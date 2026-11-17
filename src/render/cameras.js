// Camera rig. One camera, several behaviors: address with a course preview, a flyover intro,
// ball follow, a landing camera, a green camera for putts, free look, and replay angles.
// Every mode produces a desired position and target; the rig eases toward them and keeps the
// camera above the ground. Reduced motion turns moves into cuts and removes the shake.
import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';
import { fin, allFinite } from '../core/guards.js';
import { pointAt } from '../course/layout.js';

export const REPLAY_ANGLES = ['follow', 'landing', 'side', 'high'];

export function createCameraRig(world, engine) {
  const camera = world.camera;
  const pos = camera.position.clone(), tgt = new THREE.Vector3(0, 0, -10);
  const dPos = pos.clone(), dTgt = tgt.clone();
  const shakeV = new THREE.Vector3();
  const tmp = new THREE.Vector3(), P = {};
  const rig = {
    mode: 'address', reducedMotion: false, yaw: 0, pitch: 0, shakeAmt: 0, fly: null, ctx: {}, posRate: 5, tgtRate: 8, cut: true,
    ballPos: new THREE.Vector3(), ballVel: new THREE.Vector3(),
  };
  const H = (x, z) => world.terrain.heightAt(x, z);

  rig.set = (mode, ctx = {}) => {
    rig.enabled = true;
    const changed = mode !== rig.mode;
    rig.mode = mode; rig.ctx = ctx;
    if (mode !== 'address' && mode !== 'free') { rig.yaw = 0; rig.pitch = 0; }
    if (mode === 'flyover') rig.fly = { t: 0, dur: ctx.duration || 6.5 };
    if (changed && (ctx.cut || rig.reducedMotion || mode === 'landing' || mode === 'side' || mode === 'high')) rig.cut = true;
    engine.post.state.dof.enabled = mode === 'flyover' || !!ctx.replay;
  };
  rig.shake = (amount) => { if (!rig.reducedMotion) rig.shakeAmt = Math.max(rig.shakeAmt, amount); };
  // Drag to look around from the address position.
  rig.look = (dYaw, dPitch) => { rig.yaw = clamp(rig.yaw + fin(dYaw), -2.4, 2.4); rig.pitch = clamp(rig.pitch + fin(dPitch), -0.5, 0.7); };
  rig.resetLook = () => { rig.yaw = 0; rig.pitch = 0; };
  rig.flyoverDone = () => !rig.fly || rig.fly.t >= rig.fly.dur;

  function desired(dt) {
    const c = rig.ctx, t = world.terrain;
    if (!t) return;
    const b = rig.ballPos;
    if (rig.mode === 'address' || rig.mode === 'free') {
      const putt = !!c.putt;
      const back = putt ? clamp(2.6 + (c.distance || 3) * 0.15, 2.8, 6.5) : 5.2, up = putt ? 1.35 + (c.distance || 3) * 0.05 : 2.1;
      const h = (c.aim || 0) + rig.yaw;
      const fx = Math.sin(h), fz = -Math.cos(h);
      const cx = c.x - fx * back, cz = c.z - fz * back;
      dPos.set(cx, Math.max(H(cx, cz) + 0.5, H(c.x, c.z) + up - 0.4) + (putt ? 0.35 : 0.4), cz);
      const ahead = putt ? Math.max(1.5, (c.distance || 3) * 0.6) : 70;
      const lx = c.x + fx * ahead, lz = c.z + fz * ahead;
      const ly = putt ? H(lx, lz) + 0.1 : H(c.x, c.z) + 0.9 + (H(lx, lz) - H(c.x, c.z)) * 0.5;
      dTgt.set(lx, ly + Math.tan(rig.pitch) * ahead, lz);
      rig.posRate = 6; rig.tgtRate = 9;
    } else if (rig.mode === 'flyover') {
      const hole = world.holeData;
      rig.fly.t += dt;
      const u = clamp(rig.fly.t / rig.fly.dur, 0, 1), e = u * u * (3 - 2 * u);
      const s = lerp(-20, Math.max(40, hole.length - 70), e);
      pointAt(hole.line, s, P);
      const side = hole.path.side * -1;
      const px = P.x + P.nx * side * 16, pz = P.z + P.nz * side * 16;
      dPos.set(px, H(clamp(px, t.x0 + 2, t.maxX - 2), clamp(pz, t.z0 + 2, t.maxZ - 2)) + 20 + Math.sin(Math.PI * e) * 16, pz);
      const s2 = Math.min(hole.length, s + 110);
      pointAt(hole.line, s2, P);
      dTgt.set(P.x, H(P.x, P.z) + 1, P.z);
      rig.posRate = 30; rig.tgtRate = 30;
      engine.post.state.dof.focus = dPos.distanceTo(dTgt); engine.post.state.dof.range = 140; engine.post.state.dof.maxBlur = 4;
    } else if (rig.mode === 'follow') {
      // Chase from behind along the direction of travel, with lag.
      const v = rig.ballVel;
      const sp = Math.hypot(v.x, v.z);
      let fx = c.dirX ?? 0, fz = c.dirZ ?? -1;
      if (sp > 1) { fx = v.x / sp; fz = v.z / sp; }
      const back = 7 + clamp(sp * 0.1, 0, 9);
      // A little to the right of the line so the arc of the tracer reads as a curve.
      const cx = b.x - fx * back - fz * 2.4, cz = b.z - fz * back + fx * 2.4;
      const gy = t.inBounds(cx, cz, 1) ? H(cx, cz) : b.y - 2;
      dPos.set(cx, Math.max(gy + 1.6, b.y + 1.6 - clamp(v.y * 0.05, -1.5, 1.5)), cz);
      dTgt.copy(b);
      rig.posRate = 2.6; rig.tgtRate = 10;
    } else if (rig.mode === 'landing') {
      const l = c.landing || b;
      const fx = c.dirX ?? 0, fz = c.dirZ ?? -1;
      const cx = l.x + fx * 15 - fz * 7, cz = l.z + fz * 15 + fx * 7;
      const gy = t.inBounds(cx, cz, 1) ? H(cx, cz) : l.y;
      dPos.set(cx, gy + 3.2, cz);
      dTgt.copy(b);
      rig.posRate = 30; rig.tgtRate = 9;
    } else if (rig.mode === 'green') {
      // Hold the putting position and track the ball.
      dTgt.set(b.x, b.y, b.z);
      rig.posRate = 0; rig.tgtRate = 7;
    } else if (rig.mode === 'side') {
      const a = c.from || b, l = c.landing || b;
      const mx = (a.x + l.x) / 2, mz = (a.z + l.z) / 2;
      const dx = l.x - a.x, dz = l.z - a.z, len = Math.hypot(dx, dz) || 1;
      const off = clamp(len * 0.75, 12, 190);
      // Pick the side and distance with the fewest trees, so the camera is not inside the
      // tree line, and lift it over any canopy that remains between it and the ball.
      if (!c.sidePick) {
        let best = null;
        for (const sgn of [1, -1]) for (const f of [1, 0.75, 0.5, 0.3]) {
          const o = off * f, px = mx - (dz / len) * o * sgn, pz = mz + (dx / len) * o * sgn;
          let dens = 0;
          for (let k = 0; k <= 4; k++) { const q = k / 4, sx = mx + (px - mx) * q, sz = mz + (pz - mz) * q; if (t.inBounds(sx, sz, 1) && t.treeDensityAt) dens += t.treeDensityAt(sx, sz); }
          const score = dens * 3 - f;
          if (!best || score < best.score) best = { score, px, pz, dens };
        }
        c.sidePick = best;
      }
      const cx = c.sidePick.px, cz = c.sidePick.pz;
      dPos.set(cx, (t.inBounds(cx, cz, 1) ? H(cx, cz) : a.y) + 4 + (c.apex || 0) * 0.35 + (c.sidePick.dens > 0.3 ? 16 : 0), cz);
      dTgt.set(b.x, b.y, b.z);
      rig.posRate = 30; rig.tgtRate = 6;
    } else if (rig.mode === 'high') {
      const a = c.from || b, l = c.landing || b;
      const len = Math.hypot(l.x - a.x, l.z - a.z) || 1;
      dPos.set(a.x - ((l.x - a.x) / len) * 12, a.y + clamp(len * 0.55, 14, 120), a.z - ((l.z - a.z) / len) * 12);
      dTgt.set(b.x, b.y, b.z);
      rig.posRate = 30; rig.tgtRate = 6;
    }
  }

  rig.update = (dt) => {
    if (!world.terrain) return;
    desired(dt);
    if (!allFinite(dPos.x, dPos.y, dPos.z, dTgt.x, dTgt.y, dTgt.z)) return; // never feed NaN to the camera
    const kp = rig.cut || rig.posRate >= 30 ? 1 : 1 - Math.exp(-rig.posRate * dt);
    const kt = rig.cut ? 1 : 1 - Math.exp(-rig.tgtRate * dt);
    if (rig.posRate > 0 || rig.cut) pos.lerp(dPos, kp);
    tgt.lerp(dTgt, kt);
    rig.cut = false;
    // Stay above the ground.
    const t = world.terrain;
    if (t.inBounds(pos.x, pos.z, 1)) pos.y = Math.max(pos.y, t.heightAt(pos.x, pos.z) + 0.35);
    rig.shakeAmt *= Math.exp(-9 * dt);
    if (rig.shakeAmt > 1e-4) shakeV.set((Math.random() - 0.5) * rig.shakeAmt, (Math.random() - 0.5) * rig.shakeAmt, (Math.random() - 0.5) * rig.shakeAmt); else shakeV.set(0, 0, 0);
    camera.position.copy(pos).add(shakeV);
    tmp.copy(tgt);
    if (tmp.distanceToSquared(camera.position) < 1e-6) tmp.z -= 1;
    camera.lookAt(tmp);
    camera.updateMatrixWorld(true);
  };
  // Jump straight to the current mode's view (after a hole loads, or for a screenshot).
  rig.snap = () => { rig.cut = true; rig.update(0); world.terrainView.updateLod(camera, true); if (world.vegetation) world.vegetation.forceUpdate(); };
  return rig;
}
