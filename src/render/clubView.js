// The first-person club: a floating club (no hands, arms, or body) that follows the swing drag.
// The pose comes from game/clubPath.js; this file places the mesh, its soft shadow on the
// ground, and the speed streak behind the head near impact. It never affects the shot.
import * as THREE from 'three';
import { buildClub, disposeClub } from './clubModel.js';
import { swingFrame, clubPose, progressFromDrag, followProgress, downswingStart } from '../game/clubPath.js';
import { clamp } from '../core/math.js';

const TRAIL = 16;

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(0,0,0,0.55)'); r.addColorStop(0.55, 'rgba(0,0,0,0.25)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createClubView(world) {
  const group = new THREE.Group();
  group.name = 'club';
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  group.add(holder);
  // Soft contact shadows: one under the head, one stretched under the shaft.
  const shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat);
  const blob2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat);
  blob.renderOrder = blob2.renderOrder = 3;
  group.add(blob, blob2);
  // Speed streak: a ribbon through the head's recent positions, bright at the head.
  const tPos = new Float32Array(TRAIL * 2 * 3), tA = new Float32Array(TRAIL * 2);
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('aA', new THREE.BufferAttribute(tA, 1).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < TRAIL - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  tGeo.setIndex(idx);
  const tMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uO: { value: 0 } },
    vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uO; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * vA * uO * 0.8, 1.0); }',
  });
  const trail = new THREE.Mesh(tGeo, tMat);
  trail.frustumCulled = false; trail.renderOrder = 6;
  group.add(trail);
  const hist = [];
  // Face line: where the face points, drawn on the ground from the head during the downswing,
  // so an open or closed face reads before the ball leaves. Orange open, blue closed (a
  // colorblind-safe pair), white square; the angle is drawn at the same doubled scale as the face.
  const faceMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const faceLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateX(-Math.PI / 2), faceMat);
  faceLine.renderOrder = 7; faceLine.frustumCulled = false;
  group.add(faceLine);
  const FACE_SQUARE = new THREE.Color(0xffffff), FACE_OPEN = new THREE.Color(0xe69f00), FACE_CLOSED = new THREE.Color(0x56b4e9);

  const cv = {
    group, visible: false, clubId: null, lefty: false, club: null, p: 0, top: 0, opacity: 1,
    follow: null, lastPose: null, frame: null, headSpeed: 0, state: { phase: 'address', depth: 0, top: 0, face: 0, path: 0 },
  };
  const m4 = new THREE.Matrix4(), mB = new THREE.Matrix4(), q = new THREE.Quaternion(), vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();

  function ensureClub(id, lefty) {
    if (cv.club && cv.clubId === id && cv.lefty === lefty) return;
    if (cv.club) { holder.remove(cv.club); disposeClub(cv.club); }
    cv.club = buildClub(id);
    cv.clubId = id; cv.lefty = lefty;
    holder.add(cv.club);
  }

  // Place the club for pose `pose` in frame `fr`: the address placement (club space onto the
  // world), then the turn and hinge about the plane normal, then the face twist about the shaft.
  function place(fr, pose, faceDeg) {
    const toe = fr.toe, up = fr.up, back = vA.set(-fr.f0.x, -fr.f0.y, -fr.f0.z);
    // Address basis: X toe, Y up, Z back. For a left-hander the toe is mirrored, which makes the
    // basis left handed: three.js flips the winding for that case, so the club is a true mirror.
    mB.makeBasis(vB.set(toe.x, toe.y, toe.z), vC.set(up.x, up.y, up.z), back);
    mB.setPosition(fr.contact.x, fr.contact.y, fr.contact.z);
    // Rigid turn plus hinge, both about n; their sum is the club's rotation.
    const sgnTurn = pose.turnRad, sgnHinge = pose.hingeRad;
    q.setFromAxisAngle(vA.set(fr.n.x, fr.n.y, fr.n.z), sgnTurn + sgnHinge);
    m4.makeRotationFromQuaternion(q);
    // Translate so the contact point lands on pose.head.
    const c = vB.set(fr.contact.x, fr.contact.y, fr.contact.z).applyMatrix4(m4);
    m4.setPosition(pose.headNoFace.x - c.x, pose.headNoFace.y - c.y, pose.headNoFace.z - c.z);
    m4.multiply(mB);
    // Face twist about the shaft through the hosel.
    if (faceDeg) {
      const tw = new THREE.Matrix4().makeRotationAxis(vC.set(pose.shaft.x, pose.shaft.y, pose.shaft.z), -faceDeg * Math.PI / 180);
      const h = pose.hosel;
      const t1 = new THREE.Matrix4().makeTranslation(h.x, h.y, h.z), t0 = new THREE.Matrix4().makeTranslation(-h.x, -h.y, -h.z);
      m4.premultiply(t0).premultiply(tw).premultiply(t1);
    }
    holder.matrix.copy(m4);
    holder.matrixWorldNeedsUpdate = true;
  }

  function setOpacity(o) {
    cv.opacity = o;
    if (!cv.club) return;
    for (const m of cv.club.userData.materials) { m.opacity = o; m.depthWrite = o > 0.98; }
    shadowMat.opacity = o;
  }

  function shadowAt(mesh, x, z, y, size, strength) {
    const t = world.terrain;
    const gy = t && t.inBounds(x, z, 1) ? t.heightAt(x, z) : 0;
    mesh.position.set(x, gy + 0.004, z);
    const lift = Math.max(0, y - gy);
    const s = size * (1 + lift * 1.4);
    mesh.scale.set(s, 1, s);
    mesh.visible = strength * Math.exp(-lift * 2.2) > 0.04;
    return gy;
  }

  /**
   * Per frame. ctx: { show, ball {x,y,z}, heading, clubId, lefty, state } where state is the
   * live drag ({ phase: 'address' | 'back' | 'down', depth, top, face, path }).
   */
  cv.update = (dt, ctx) => {
    const following = !!cv.follow;
    // The frame right after the drag crossed the start line shows the impact pose exactly;
    // the follow-through clock starts on the frame after that.
    if (following) { if (cv.follow.fresh) cv.follow.fresh = false; else cv.follow.t += dt; }
    const show = following || !!ctx.show;
    group.visible = show;
    cv.visible = show;
    if (!show) { hist.length = 0; tMat.uniforms.uO.value = 0; faceMat.opacity = 0; return; }
    let fr, p, top, face = 0;
    if (following) {
      fr = cv.follow.frame; top = cv.follow.top; face = cv.follow.face;
      // One frame held exactly at impact, then through to the finish, then a fade.
      p = cv.follow.qa != null ? cv.follow.qa : cv.follow.t <= 0 ? 1 : followProgress(cv.follow.t, 0.5);
      const fade = clamp((cv.follow.t - 0.5) / 0.22, 0, 1);
      setOpacity(1 - fade);
      if (fade >= 1) { cv.follow = null; group.visible = false; cv.visible = false; hist.length = 0; return; }
    } else {
      ensureClub(ctx.clubId, ctx.lefty);
      cv.lastBall = { x: ctx.ball.x, y: ctx.ball.y, z: ctx.ball.z };
      const st = ctx.state || cv.state;
      cv.state = st;
      fr = swingFrame(ctx.ball, ctx.heading, ctx.clubId, { lefty: ctx.lefty, pathDeg: st.phase === 'down' ? st.path * 2 : 0 });
      p = progressFromDrag(st.phase, st.depth, st.top);
      top = st.phase === 'down' ? st.top : st.depth;
      face = st.phase === 'down' ? st.face * 2 : 0;
      setOpacity(1);
    }
    cv.frame = fr; cv.p = p; cv.top = top;
    // Shaft lag: a few degrees of extra hinge in the middle of the downswing, more when fast.
    let lag = 0;
    if (p > 0.5 && p < 1) {
      const p0 = downswingStart(Math.max(top, 1e-3));
      const u = clamp((p - p0) / Math.max(1e-3, 1 - p0), 0, 1);
      lag = 9 * clamp(cv.headSpeed / 18, 0, 1) * Math.sin(Math.PI * u);
    }
    const pose = clubPose(fr, p, { top, faceDeg: face, lagDeg: lag });
    const pose0 = clubPose(fr, p, { top, faceDeg: 0, lagDeg: lag });
    // Signed rotation about n for the mesh, recovered the same way clubPose applies it.
    const sgn = pose.sgn;
    pose.turnRad = pose.turn * Math.PI / 180 * sgn;
    pose.hingeRad = (pose.hinge + (p > 0.5 && p < 1 ? lag : 0)) * Math.PI / 180 * sgn;
    pose.headNoFace = pose0.head;
    place(fr, pose, face);
    // Head speed for the lag and the streak.
    if (cv.lastPose && dt > 0) {
      const a = cv.lastPose.head, b = pose.head;
      const sp = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / dt;
      cv.headSpeed = cv.headSpeed * 0.4 + sp * 0.6;
    }
    cv.lastPose = pose;
    // Shadows.
    shadowAt(blob, pose.head.x, pose.head.z, pose.head.y, 0.16, 1);
    const mx = (pose.head.x + pose.grip.x) / 2, mz = (pose.head.z + pose.grip.z) / 2, my = (pose.head.y + pose.grip.y) / 2;
    shadowAt(blob2, mx, mz, my * 0.35, 0.22, 0.6);
    // Streak: only when the head is moving fast near impact.
    hist.unshift({ x: pose.head.x, y: pose.head.y, z: pose.head.z });
    if (hist.length > TRAIL) hist.length = TRAIL;
    const fast = clamp((cv.headSpeed - 6) / 14, 0, 1) * (p > 0.75 && p < 1.25 ? 1 : 0);
    tMat.uniforms.uO.value = tMat.uniforms.uO.value * 0.6 + fast * 0.4;
    const n = hist.length, sh = pose.shaft;
    for (let i = 0; i < TRAIL; i++) {
      const h = hist[Math.min(i, n - 1)];
      const w = 0.03 * (1 - i / TRAIL);
      tPos[i * 6] = h.x + sh.x * w; tPos[i * 6 + 1] = h.y + sh.y * w; tPos[i * 6 + 2] = h.z + sh.z * w;
      tPos[i * 6 + 3] = h.x - sh.x * w; tPos[i * 6 + 4] = h.y - sh.y * w; tPos[i * 6 + 5] = h.z - sh.z * w;
      const a = i < n ? Math.pow(1 - i / TRAIL, 1.5) : 0;
      tA[i * 2] = a; tA[i * 2 + 1] = a;
    }
    tGeo.attributes.position.needsUpdate = true; tGeo.attributes.aA.needsUpdate = true;
    trail.visible = tMat.uniforms.uO.value > 0.02 && n > 2;
    // Face line from the second half of the downswing to just after impact.
    const faceOn = p > 0.62 && p < 1.08;
    const fo = faceOn ? clamp((p - 0.62) / 0.12, 0, 1) * (p > 1 ? clamp((1.08 - p) / 0.08, 0, 1) : 1) : 0;
    faceMat.opacity = fo * 0.95 * cv.opacity;
    faceLine.visible = fo > 0.01;
    if (faceLine.visible) {
      // The face's yaw as it will be at impact: the target line turned by the face angle.
      const a = (-face * Math.PI) / 180, f0 = fr.f0;
      const fx = f0.x * Math.cos(a) + f0.z * Math.sin(a), fz = -f0.x * Math.sin(a) + f0.z * Math.cos(a), l = Math.hypot(fx, fz) || 1;
      // From the ball forward, so it reads against the fan's center line.
      const t = world.terrain, b = (cv.follow && cv.follow.ball) || ctx.ball || pose.head, hx = b.x, hz = b.z;
      const gy = t && t.inBounds(hx, hz, 1) ? t.heightAt(hx, hz) : pose.head.y - 0.02;
      faceLine.position.set(hx, gy + 0.03, hz);
      faceLine.rotation.set(0, Math.atan2(fx / l, fz / l) + Math.PI, 0);
      faceLine.scale.set(0.03, 1, 2.6);
      const k = clamp(Math.abs(face) / 8, 0, 1);
      faceMat.color.copy(FACE_SQUARE).lerp(face > 0 ? FACE_OPEN : FACE_CLOSED, k < 0.08 ? 0 : 0.35 + 0.65 * k);
    }
  };

  /** The drag crossed the start line: hold the impact pose this frame, then follow through. */
  cv.impact = ({ face = 0, path = 0 } = {}) => {
    if (!cv.frame) return;
    cv.follow = { t: 0, fresh: true, frame: cv.frame, top: Math.max(cv.top, 0.05), face: face * 2, path, ball: cv.lastBall ? { ...cv.lastBall } : null };
    cv.p = 1;
  };
  // Points on the club in world space for the layout check: the head's corners and points
  // along the shaft from the hosel to the grip end.
  cv.screenPoints = () => {
    if (!cv.club || !group.visible || !cv.lastPose) return [];
    holder.updateMatrixWorld(true);
    const pts = [];
    const head = cv.club.children[0];
    head.geometry.computeBoundingBox();
    const bb = head.geometry.boundingBox, m = head.matrixWorld;
    for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m));
    const a = cv.lastPose.hosel, g = cv.lastPose.grip;
    for (let i = 0; i <= 24; i++) { const f = i / 24; pts.push(new THREE.Vector3(a.x + (g.x - a.x) * f, a.y + (g.y - a.y) * f, a.z + (g.z - a.z) * f)); }
    return pts;
  };
  cv.dispose = () => { if (cv.club) disposeClub(cv.club); shadowMat.map.dispose(); shadowMat.dispose(); tGeo.dispose(); tMat.dispose(); faceLine.geometry.dispose(); faceMat.dispose(); };
  return cv;
}
