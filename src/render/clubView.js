// The first-person club: a floating club (no hands, arms, or body) that follows the swing drag.
// The pose comes from game/clubPath.js through the smoothing and easing in game/swingMotion.js;
// this file places the mesh, its soft shadow on the ground, the swing trail (a glowing ribbon
// from a fixed ring buffer, tinted by the strike), and the shock ring on the ground at impact.
// It never affects the shot.
import * as THREE from 'three';
import { buildClub, disposeClub } from './clubModel.js';
import { swingFrame, clubPose, downswingStart, BALL_R } from '../game/clubPath.js';
import { createSwingSmoother, followThrough, easeDown, trailTint, TRAIL_FADE_SEC } from '../game/swingMotion.js';
import { clamp } from '../core/math.js';
import { clubGeometry, hoselOffset } from '../game/clubPath.js';

// The trail: a fixed ring of head samples (about half a second at 60 Hz); each fades out
// TRAIL_FADE_SEC after it was laid down.
const TRAIL = 32;

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
  // Swing trail: one ribbon mesh over a fixed ring buffer of head samples. Vertices are
  // rewritten newest first each frame; nothing is allocated while swinging.
  const ring = { x: new Float32Array(TRAIL), y: new Float32Array(TRAIL), z: new Float32Array(TRAIL), sx: new Float32Array(TRAIL), sy: new Float32Array(TRAIL), sz: new Float32Array(TRAIL), t: new Float32Array(TRAIL), head: -1, count: 0 };
  const tPos = new Float32Array(TRAIL * 2 * 3), tA = new Float32Array(TRAIL * 2);
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('aA', new THREE.BufferAttribute(tA, 1).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < TRAIL - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  tGeo.setIndex(idx);
  const tMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uO: { value: 0 }, uC: { value: new THREE.Color(0.92, 0.95, 1) } },
    vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uO; uniform vec3 uC; varying float vA; void main(){ gl_FragColor = vec4(uC * vA * uO * 0.85, 1.0); }',
  });
  const trail = new THREE.Mesh(tGeo, tMat);
  trail.frustumCulled = false; trail.renderOrder = 6;
  group.add(trail);
  let simT = 0, trailOn = false;
  function pushTrail(pose) {
    ring.head = (ring.head + 1) % TRAIL;
    const i = ring.head, h = pose.head, sh = pose.shaft;
    ring.x[i] = h.x; ring.y[i] = h.y; ring.z[i] = h.z; ring.sx[i] = sh.x; ring.sy[i] = sh.y; ring.sz[i] = sh.z; ring.t[i] = simT;
    ring.count = Math.min(TRAIL, ring.count + 1);
  }
  function drawTrail() {
    const n = ring.count;
    let live = 0;
    for (let k = 0; k < TRAIL; k++) {
      // k = 0 is the newest sample; older ones follow; unused slots repeat the oldest.
      const i = (ring.head - Math.min(k, Math.max(0, n - 1)) + TRAIL * 2) % TRAIL;
      const age = simT - ring.t[i];
      const a = k < n ? Math.max(0, 1 - age / TRAIL_FADE_SEC) ** 1.4 : 0;
      if (a > 0) live++;
      const w = 0.034 * (0.4 + 0.6 * a);
      const o = k * 6;
      tPos[o] = ring.x[i] + ring.sx[i] * w; tPos[o + 1] = ring.y[i] + ring.sy[i] * w; tPos[o + 2] = ring.z[i] + ring.sz[i] * w;
      tPos[o + 3] = ring.x[i] - ring.sx[i] * w; tPos[o + 4] = ring.y[i] - ring.sy[i] * w; tPos[o + 5] = ring.z[i] - ring.sz[i] * w;
      tA[k * 2] = a; tA[k * 2 + 1] = a;
    }
    tGeo.attributes.position.needsUpdate = true; tGeo.attributes.aA.needsUpdate = true;
    trail.visible = live > 2;
    tMat.uniforms.uO.value = trail.visible ? 1 : 0;
  }
  const clearTrail = () => { ring.count = 0; ring.head = -1; trail.visible = false; };
  // Impact: a soft shock ring on the ground under the ball, grown and faded over 0.35 s.
  const shockTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 30, 64, 64, 63);
    r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.72, 'rgba(255,255,255,0.0)'); r.addColorStop(0.86, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const shockMat = new THREE.MeshBasicMaterial({ map: shockTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const shock = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shockMat);
  shock.renderOrder = 4; shock.visible = false; shock.frustumCulled = false;
  group.add(shock);
  const shockState = { t: -1, power: 0 };
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
    smoother: createSwingSmoother(), faceS: 0, pathS: 0,
  };
  const reduced = () => !!(world.rig && world.rig.reducedMotion);
  const m4 = new THREE.Matrix4(), mB = new THREE.Matrix4(), q = new THREE.Quaternion(), vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();

  // The contact marker: a small bright dot on the face where the ball was struck.
  const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false });
  const mark = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), markMat);
  mark.renderOrder = 8; mark.visible = false;
  function ensureClub(id, lefty, rarity = 'common') {
    if (cv.club && cv.clubId === id && cv.lefty === lefty && cv.rarity === rarity) return;
    if (cv.club) { cv.club.remove(mark); holder.remove(cv.club); disposeClub(cv.club); }
    cv.club = buildClub(id, rarity);
    cv.clubId = id; cv.lefty = lefty; cv.rarity = rarity;
    cv.club.add(mark);
    holder.add(cv.club);
  }
  // Where on the face (club space: X toward the toe, Y up, the face lofted back).
  function placeMark(strike) {
    if (!cv.club || !strike) { mark.visible = false; return; }
    const g = clubGeometry(cv.clubId), t = Math.tan((g.loft * Math.PI) / 180);
    const [heel, rise] = hoselOffset(g.kind);
    const spot = { pured: [0, 0.002], good: [0.006, -0.003], heel: [-heel * 0.75, 0], toe: [0.032, 0.002], thin: [0.002, -0.016], fat: [0, -0.02], shank: [-heel, rise * 0.6] }[strike.kind] || [0, 0];
    mark.position.set(spot[0], spot[1], spot[1] * t - 0.004);
    markMat.color.setHex(strike.kind === 'pured' ? 0xd8f5a8 : strike.kind === 'good' ? 0xffffff : strike.kind === 'shank' ? 0xff8a6a : 0xffc060);
    mark.visible = true;
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
    simT += dt;
    const following = !!cv.follow;
    // The frame right after the drag crossed the start line shows the impact pose exactly;
    // the follow-through clock starts on the frame after that.
    if (following) { if (cv.follow.fresh) cv.follow.fresh = false; else cv.follow.t += dt; }
    updateShock(dt);
    const show = following || !!ctx.show;
    group.visible = show || shock.visible;
    cv.visible = show;
    holder.visible = show;
    if (!show) { clearTrail(); faceMat.opacity = 0; blob.visible = blob2.visible = false; cv.smoother.reset(); return; }
    let fr, p, top, face = 0;
    if (following) {
      fr = cv.follow.frame; top = cv.follow.top; face = cv.follow.face;
      // One frame held exactly at impact, the hit-stop (club only), then an eased
      // follow-through to the finish, then a fade.
      const ft = followThrough(cv.follow.t, { reduced: reduced() });
      p = cv.follow.qa != null ? cv.follow.qa : cv.follow.t <= 0 ? 1 : ft.p;
      setOpacity(1 - ft.fade);
      markMat.opacity = 1 - ft.fade;
      if (ft.fade >= 1) { cv.follow = null; group.visible = shock.visible; cv.visible = false; holder.visible = false; clearTrail(); mark.visible = false; return; }
    } else {
      ensureClub(ctx.clubId, ctx.lefty, ctx.rarity);
      mark.visible = false;
      cv.lastBall = { x: ctx.ball.x, y: ctx.ball.y, z: ctx.ball.z };
      const st = ctx.state || cv.state;
      cv.state = st;
      // The drawn drag: smoothed and eased (game/swingMotion.js). Face and path drift are
      // smoothed the same way, so the face twist never flickers with the finger.
      const sm = cv.smoother.step(st, dt);
      const k = 1 - Math.exp(-30 * Math.max(dt, 0));
      cv.faceS += ((st.phase === 'down' ? st.face * 2 : 0) - cv.faceS) * k;
      cv.pathS += ((st.phase === 'down' ? st.path * 2 : 0) - cv.pathS) * k;
      fr = swingFrame(ctx.ball, ctx.heading, ctx.clubId, { lefty: ctx.lefty, pathDeg: cv.pathS });
      if (sm.phase === 'back') {
        p = clamp(sm.depth, 0, 1) / 2 + sm.settle;
        top = clamp(sm.depth + sm.settle * 2, 0, 1);
      } else if (sm.phase === 'down') {
        top = clamp(st.top, 1e-3, 1);
        const p0 = downswingStart(top);
        const u = clamp(1 - sm.depth / top, 0, 1);
        p = p0 + (1 - p0) * easeDown(u) + sm.settle * (1 - u);
      } else { p = 0; top = 0; }
      face = cv.faceS;
      setOpacity(1);
    }
    cv.frame = fr; cv.p = p; cv.top = top;
    // Shaft lag: a few degrees of extra hinge in the middle of the downswing, more when fast.
    let lag = 0;
    if (p > 0.5 && p < 1) {
      const p0 = downswingStart(Math.max(top, 1e-3));
      const u = clamp((p - p0) / Math.max(1e-3, 1 - p0), 0, 1);
      lag = 7 * clamp(cv.headSpeed / 18, 0, 1) * Math.sin(Math.PI * u);
    }
    const pose = clubPose(fr, p, { top, faceDeg: face, lagDeg: lag });
    const pose0 = clubPose(fr, p, { top, faceDeg: 0, lagDeg: lag });
    // Signed rotation about n for the mesh, recovered the same way clubPose applies it.
    const sgn = pose.sgn;
    pose.turnRad = pose.turn * Math.PI / 180 * sgn;
    pose.hingeRad = (pose.hinge + (p > 0.5 && p < 1 ? lag : 0)) * Math.PI / 180 * sgn;
    pose.headNoFace = pose0.head;
    place(fr, pose, face);
    // Head speed for the lag.
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
    // The trail: laid down through the downswing and into the first part of the finish; the
    // ribbon then fades within TRAIL_FADE_SEC.
    const downswing = !following && cv.state.phase === 'down' && p > 0.56;
    const finishing = following && cv.follow.t < 0.16;
    if (downswing && !trailOn) { trailOn = true; clearTrail(); tMat.uniforms.uC.value.setRGB(...trailTint(null)); }
    if (downswing || finishing) pushTrail(pose);
    if (!downswing && !following) trailOn = false;
    drawTrail();
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
  cv.impact = ({ face = 0, path = 0, strike = null, power = 0.7 } = {}) => {
    if (!cv.frame) return;
    placeMark(strike);
    // Tint the trail by the strike: white pured, amber good, red for a mishit.
    tMat.uniforms.uC.value.setRGB(...trailTint(strike ? strike.kind : 'good'));
    cv.follow = { t: 0, fresh: true, frame: cv.frame, top: Math.max(cv.top, 0.05), face: face * 2, path, ball: cv.lastBall ? { ...cv.lastBall } : null };
    cv.p = 1;
    cv.smoother.reset();
    // The shock ring on the ground under the ball (not for putts).
    if (cv.lastBall && cv.clubId !== 'PT') { shockState.t = 0; shockState.power = clamp(power, 0.2, 1); shockState.x = cv.lastBall.x; shockState.z = cv.lastBall.z; shockState.y = cv.lastBall.y - BALL_R; }
  };
  function updateShock(dt) {
    if (shockState.t < 0) { shock.visible = false; return; }
    shockState.t += dt;
    const u = shockState.t / 0.35;
    if (u >= 1) { shockState.t = -1; shock.visible = false; return; }
    const t = world.terrain, x = shockState.x, z = shockState.z;
    const gy = t && t.inBounds(x, z, 1) ? t.heightAt(x, z) : shockState.y;
    shock.position.set(x, gy + 0.006, z);
    const sc = 0.12 + (0.55 + 0.75 * shockState.power) * (1 - (1 - u) ** 2);
    shock.scale.set(sc, 1, sc);
    shockMat.opacity = (1 - u) * (0.28 + 0.32 * shockState.power);
    shock.visible = true;
  }
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
  cv.dispose = () => { if (cv.club) disposeClub(cv.club); shadowMat.map.dispose(); shadowMat.dispose(); tGeo.dispose(); tMat.dispose(); faceLine.geometry.dispose(); faceMat.dispose(); shock.geometry.dispose(); shockMat.dispose(); shockTex.dispose(); };
  // For the swing proof: the head's distance from the ball's surface (meters), or null.
  cv.headToBall = () => { if (!cv.lastPose || !cv.lastBall) return null; const h = cv.lastPose.head, b = cv.lastBall; return Math.max(0, Math.hypot(h.x - b.x, h.y - b.y, h.z - b.z) - BALL_R); };
  return cv;
}
