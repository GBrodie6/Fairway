// The club path for the first-person swing view. Pure math with no DOM and no three.js, so it
// is unit tested (tests/clubPath.test.js). It only draws the club: the shot itself is still
// decided by game/swingGesture.js and the physics, which this file never touches.
//
// Model. The club is a rigid body that turns about a pivot above and to the player's side of
// the ball, in a tilted plane that contains the shaft at address and the target line (the
// classic swing plane, so the bottom of the arc is at the ball). A second, smaller turn at the
// grip end (the hinge) sets the club more upright at the top and is released by impact.
//
// Progress p runs from 0 (address) through 0.5 (top of a full backswing) to 1 (impact), and on
// to 1.5 (finish) after the ball has gone:
//   backswing  0 to 0.5   the turn angle follows the drag one to one (angle = top * depth)
//   downswing  0.5 to 1   a quarter sine, so for a steady drag the head is fastest at impact
//   follow     1 to 1.5   through and up on the target side, driven by time after launch
// A partial backswing (depth d < 1) tops out at p = d / 2 and enters the downswing half at the
// point with the same angle, so the club never jumps.

const DEG = Math.PI / 180;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const BALL_R = 0.02135;

// Static loft, lie angle (shaft from the ground), and length in meters, per club. Typical
// values for a modern set; no brand is modeled.
export const CLUB_GEOMETRY = {
  DR: { kind: 'driver', loft: 10.5, lie: 58, length: 1.156 },
  W3: { kind: 'wood', loft: 15, lie: 58.5, length: 1.092 },
  W5: { kind: 'wood', loft: 18, lie: 59, length: 1.067 },
  I4: { kind: 'iron', loft: 21, lie: 60.5, length: 0.978 },
  I5: { kind: 'iron', loft: 24, lie: 61, length: 0.965 },
  I6: { kind: 'iron', loft: 27, lie: 61.5, length: 0.953 },
  I7: { kind: 'iron', loft: 31, lie: 62, length: 0.940 },
  I8: { kind: 'iron', loft: 35, lie: 62.5, length: 0.927 },
  I9: { kind: 'iron', loft: 40, lie: 63, length: 0.914 },
  PW: { kind: 'wedge', loft: 45, lie: 63.5, length: 0.908 },
  GW: { kind: 'wedge', loft: 50, lie: 64, length: 0.902 },
  SW: { kind: 'wedge', loft: 56, lie: 64, length: 0.895 },
  LW: { kind: 'wedge', loft: 60, lie: 64, length: 0.889 },
  PT: { kind: 'putter', loft: 3, lie: 70, length: 0.864 },
};
export const clubGeometry = (id) => CLUB_GEOMETRY[id] || CLUB_GEOMETRY.I7;

// Arc shape per kind: the turn at the top of a full swing and at the finish, the hinge at the
// top, and the arm (grip to pivot). Putters rock from the shoulders: a short arc, no hinge.
// Sized so a full swing stays on a phone screen from the address camera (see cameraBack).
export const ARC = {
  driver: { top: 102, finish: 112, hinge: 27, arm: 0.15 },
  wood: { top: 99, finish: 109, hinge: 27, arm: 0.15 },
  iron: { top: 95, finish: 104, hinge: 30, arm: 0.15 },
  wedge: { top: 90, finish: 98, hinge: 32, arm: 0.15 },
  putter: { top: 26, finish: 22, hinge: 0, arm: 0.42 },
};
// The heel of the face sits this far from the contact point toward the player, and the shaft
// enters the head this high above the contact point (meters).
const HOSEL = { driver: [0.052, 0.012], wood: [0.045, 0.006], iron: [0.034, 0.016], wedge: [0.033, 0.018], putter: [0.05, 0.02] };
export const hoselOffset = (kind) => HOSEL[kind] || HOSEL.iron;

// --- small vector helpers on plain {x, y, z} ---
const v = (x, y, z) => ({ x, y, z });
const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, k) => v(a.x * k, a.y * k, a.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return v(a.x / l, a.y / l, a.z / l); };
// Rodrigues rotation of vector a about unit axis k by angle t.
function rot(a, k, t) {
  const c = Math.cos(t), s = Math.sin(t);
  return add(add(mul(a, c), mul(cross(k, a), s)), mul(k, dot(k, a) * (1 - c)));
}
export const vec = { v, add, sub, mul, dot, cross, norm, rot };

/**
 * The address frame for one swing.
 *   ball     {x, y, z} ball center
 *   heading  aim heading in radians (0 = -z, the game's convention)
 *   clubId   club id (DR, I7, PT, ...)
 *   lefty    true mirrors the player's side
 *   pathDeg  swing path: positive is in to out; the plane turns about the vertical through the ball
 * Returns the vectors the pose function needs, all in world space.
 */
export function swingFrame(ball, heading, clubId, { lefty = false, pathDeg = 0 } = {}) {
  const g = clubGeometry(clubId), arc = ARC[g.kind];
  const up = v(0, 1, 0);
  // Target direction, turned by the path. Path and face are in world terms as the physics uses
  // them (positive starts the ball right), so the plane turns the same way for either hand.
  const side0 = lefty ? -1 : 1;
  const f0 = v(Math.sin(heading), 0, -Math.cos(heading));
  const f = norm(rot(f0, up, -pathDeg * DEG));
  // s points from the ball toward the player (screen left for a right-hander seen from behind).
  const s = mul(norm(cross(up, f0)), side0);
  const toe = mul(s, -1);
  const lie = g.lie * DEG;
  // Contact point: the face just behind the ball, at ball-center height.
  const contact = add(ball, mul(f0, -(BALL_R + 0.003)));
  const [heel, rise] = hoselOffset(g.kind);
  const hosel = add(add(contact, mul(s, heel)), v(0, rise, 0));
  const shaft = norm(add(mul(s, Math.cos(lie)), mul(up, Math.sin(lie))));
  const grip = add(hosel, mul(shaft, g.length));
  const pivot = add(grip, mul(shaft, arc.arm));
  // Plane normal: the plane holds the line from the pivot to the contact point and the
  // (path-turned) target line, so the head meets the ball moving along that line.
  const n = norm(cross(sub(pivot, contact), f));
  return { g, arc, f, f0, s, toe, up, contact, hosel, shaft, grip, pivot, n, lefty, side: side0 };
}

/** Turn angle (degrees, backswing positive) and hinge for progress p at backswing depth `top`. */
export function arcAngles(p, top, arc) {
  const T = arc.top, H = arc.hinge;
  const d = clamp(top, 0, 1);
  let turn, hinge;
  if (p <= 0.5) {
    // One to one with the drag: p = depth / 2.
    const q = clamp(p * 2, 0, 1);
    turn = T * q;
    hinge = H * q * q;
  } else if (p <= 1) {
    // Downswing. pStart is where a backswing of depth d enters this half.
    const k = Math.sin(clamp((1 - p) * 2, 0, 1) * Math.PI / 2);
    turn = T * k;
    // The hinge unwinds in step with the turn, from the backswing's own hinge (H d^2, so a
    // partial swing does not jump) to none at impact. Its fastest release is at impact. The
    // visible lag is the separate lagDeg term, held mid-downswing and gone by impact.
    hinge = d > 1e-3 ? H * d * d * clamp(k / d, 0, 1) : 0;
  } else {
    const q = clamp((p - 1) * 2, 0, 1);
    const e = Math.sin(q * Math.PI / 2);
    turn = -arc.finish * e;
    hinge = -H * 0.9 * e * e;
  }
  return { turn, hinge };
}

/** The progress at which a backswing of depth d enters the downswing half. */
export function downswingStart(d) {
  const dd = clamp(d, 0, 1);
  return 1 - Math.asin(dd) / Math.PI;
}

/**
 * Progress from the live drag. phase is 'address', 'back', 'down'; depth is the current drag
 * depth and top the deepest point (both as a fraction of full travel).
 */
export function progressFromDrag(phase, depth, top) {
  const d = clamp(depth, 0, 1);
  if (phase === 'back') return d / 2;
  if (phase === 'down') {
    const t = clamp(top, 1e-3, 1);
    // Linear in the drag from the top back to the start line, mapped onto the quarter sine so
    // the angle matches the top exactly where the downswing begins.
    const p0 = downswingStart(t);
    const u = clamp(1 - d / t, 0, 1);
    return p0 + (1 - p0) * u;
  }
  return 0;
}

/** Follow-through progress from seconds since impact. Finishes in `dur` seconds. */
export function followProgress(sec, dur = 0.5) {
  return 1 + 0.5 * clamp(sec / dur, 0, 1);
}

/**
 * Club pose at progress p.
 *   frame   from swingFrame
 *   top     backswing depth (0 to 1), scales the arc for a partial swing
 *   faceDeg face angle, positive open (to the right for a right-hander)
 *   lagDeg  extra shaft lag during the downswing (the caller passes a speed-based value)
 * Returns world-space points: head (the contact point), hosel, grip, the shaft direction (head
 * to grip), the face normal, and the angles used.
 */
export function clubPose(frame, p, { top = 1, faceDeg = 0, lagDeg = 0 } = {}) {
  const { arc, pivot, n, contact, hosel, grip, shaft, f0, up } = frame;
  const a = arcAngles(p, top, arc);
  // The sign of the turn about n that sends the head away from the target on the backswing.
  const sgn = dot(cross(n, sub(contact, pivot)), f0) < 0 ? 1 : -1;
  const turn = a.turn * DEG * sgn;
  // Lag holds the club back (more hinge) in the middle of the downswing only.
  const hinge = (a.hinge + (p > 0.5 && p < 1 ? lagDeg : 0)) * DEG * sgn;
  // Turn every point about the pivot, then hinge the club about the grip.
  const turnPt = (q) => add(pivot, rot(sub(q, pivot), n, turn));
  const g1 = turnPt(grip);
  const hingePt = (q) => add(g1, rot(sub(turnPt(q), g1), n, hinge));
  const head = hingePt(contact), hz = hingePt(hosel);
  const shaftDir = norm(sub(g1, hz));
  // Face normal: square is the target line tipped up by the loft, carried with the club, then
  // turned about the shaft by the face angle.
  const loft = frame.g.loft * DEG;
  let face = norm(add(mul(f0, Math.cos(loft)), mul(up, Math.sin(loft))));
  face = rot(rot(face, n, turn), n, hinge);
  // Turning about the shaft by minus the face angle opens the face to the right for either hand
  // (the shaft leans the other way for a left-hander, and so does the turn).
  face = rot(face, shaftDir, -faceDeg * DEG);
  return { head, hosel: hz, grip: g1, shaft: shaftDir, face, turn: a.turn, hinge: a.hinge, sgn };
}

/** Horizontal face angle (degrees) of a pose relative to the target line: + is to the right. */
export function faceYawDeg(pose, frame) {
  const f = frame.f0;
  const right = v(-f.z, 0, f.x);
  const h = norm(v(pose.face.x, 0, pose.face.z));
  return Math.atan2(dot(h, right), dot(h, f)) / DEG;
}

// Live face and path estimates from the drag, using the same rules the gesture applies at impact
// (game/swingGesture.js). Used only to draw the club; the shot uses the gesture's own result.
export function liveFaceAndPath(st, cfg, lefty) {
  const mirror = lefty ? -1 : 1;
  let off = (st.lastX - st.startX) / cfg.travel;
  const dz = cfg.faceDeadzone;
  off = Math.abs(off) <= dz ? 0 : off - Math.sign(off) * dz;
  const face = clamp(off * cfg.faceGain, -cfg.maxFace, cfg.maxFace) * mirror;
  const depthPx = Math.max(1, st.topY - st.startY);
  const lineDeg = (Math.atan2(st.lastX - st.topX, depthPx) * 180) / Math.PI;
  const path = clamp(lineDeg * cfg.pathGain, -cfg.maxPath, cfg.maxPath) * mirror;
  return { face, path };
}

/**
 * How far behind the ball the address camera stands so the whole swing of the longest club
 * (the driver at the top and at the finish) stays on screen and clear of the HUD corner on the
 * player's side. All screen values are fractions of the viewport.
 *   aspect, fovDeg  the camera's
 *   ballFrac        where the ball sits, from the top
 *   up              camera height above the ball (m)
 *   keep            { x, y } the HUD corner box on the player's side: the club must stay below
 *                   y or beyond x (to the right of it for a right-hander, left for a lefty)
 * Returns the distance in meters (between minBack and maxBack).
 */
export function cameraBack({ aspect, fovDeg, ballFrac, up, keep = { x: 0, y: 0 }, lefty = false, minBack = 3.2, maxBack = 8 }) {
  const b = v(0, BALL_R, 0);
  const fr = swingFrame(b, 0, 'DR', { lefty });
  // The head's far corners and the grip end, not only the contact point: the drawn head is a
  // little larger than life (render/clubModel.js) and reaches about 0.15 m from the contact.
  const pts = [];
  for (const p of [0.5, 1.25, 1.5]) {
    const q = clubPose(fr, p, { top: 1 });
    pts.push(q.grip, add(q.grip, mul(q.shaft, 0.04)));
    for (const dx of [-0.15, 0.15]) for (const dy of [-0.15, 0.15]) pts.push(add(q.head, v(dx, dy, 0)));
  }
  const tanH = Math.tan((fovDeg * Math.PI) / 360);
  const margin = 0.03;
  for (let back = minBack; back <= maxBack; back += 0.1) {
    // Camera at (0, up, back) looking down -z, pitched so the ball lands at ballFrac.
    const pitch = Math.atan2(up, back) - Math.atan((2 * ballFrac - 1) * tanH);
    const c = Math.cos(pitch), sn = Math.sin(pitch);
    let ok = true;
    for (const q of pts) {
      const dx = q.x, dy = q.y - (BALL_R + up), dz = q.z - back;
      const zf = -dy * sn - dz * c, yu = dy * c - dz * sn;
      if (zf <= 0.05) { ok = false; break; }
      const sx = 0.5 + (dx / zf) / (tanH * aspect) / 2, sy = 0.5 - (yu / zf) / tanH / 2;
      if (sx < margin || sx > 1 - margin || sy < margin) { ok = false; break; }
      const inCorner = lefty ? sx > keep.x - margin && sy < keep.y + margin : sx < keep.x + margin && sy < keep.y + margin;
      if (inCorner) { ok = false; break; }
    }
    if (ok) return Math.round(back * 10) / 10;
  }
  return maxBack;
}
