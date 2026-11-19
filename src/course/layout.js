// Hole layout generator. Pure and deterministic: (course, hole index) always gives the same
// routing, hazards, and par. The layout is geometry only (centerline, fairway width, green
// outline, bunker and water shapes, cart path, prop anchors). The terrain builder turns it
// into elevation and surfaces, and both the renderer and the physics read that one terrain.
//
// Hole-local frame: meters, x to the right, play runs toward -Z, the tee is at the origin.
import { createRng } from '../core/rng.js';
import { YARD, DEG, clamp, lerp, smoothstep } from '../core/math.js';
import { generateRange } from './range.js';

const LINE_STEP = 4; // meters between centerline samples

function chaikin(pts, iterations) {
  let p = pts;
  for (let k = 0; k < iterations; k++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

// Resample a polyline at a fixed spacing. Returns points with cumulative distance s.
export function resample(pts, step) {
  const out = [{ x: pts[0].x, z: pts[0].z, s: 0 }];
  let carry = 0, s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-9) continue;
    let d = step - carry;
    while (d <= len) {
      const f = d / len;
      s += step;
      out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, s });
      d += step;
    }
    carry = (carry + len) % step;
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  const rest = Math.hypot(last.x - tail.x, last.z - tail.z);
  if (rest > step * 0.25) out.push({ x: last.x, z: last.z, s: tail.s + rest });
  else { tail.x = last.x; tail.z = last.z; }
  return out;
}

// Position and unit tangent on the centerline at distance s (clamped), plus the right normal.
export function pointAt(line, s, out = {}) {
  const n = line.length;
  const total = line[n - 1].s;
  const ss = clamp(s, 0, total);
  let i = Math.min(n - 2, Math.floor(ss / LINE_STEP));
  while (i > 0 && line[i].s > ss) i--;
  while (i < n - 2 && line[i + 1].s < ss) i++;
  const a = line[i], b = line[i + 1];
  const span = b.s - a.s || 1;
  const f = (ss - a.s) / span;
  const tx = (b.x - a.x) / span, tz = (b.z - a.z) / span;
  out.x = a.x + (b.x - a.x) * f + tx * (s - ss);
  out.z = a.z + (b.z - a.z) * f + tz * (s - ss);
  out.tx = tx; out.tz = tz;
  // Right of the direction of travel (travel is toward -Z, right is +X).
  out.nx = -tz; out.nz = tx;
  return out;
}

export function offsetPoint(line, s, lateral, out = {}) {
  pointAt(line, s, out);
  out.x += out.nx * lateral;
  out.z += out.nz * lateral;
  return out;
}

// Smooth union of circles as a signed distance (negative inside).
export function blobSdf(blobs, x, z, k = 2.2) {
  let acc = 0;
  let minD = 1e9;
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const d = Math.hypot(x - b.x, z - b.z) - b.r;
    if (d < minD) minD = d;
    acc += Math.exp(-d / k);
  }
  // Soft minimum. Falls back to the hard minimum far from the shape.
  return minD > 40 ? minD : -k * Math.log(acc);
}

// Green outline: radius as a function of angle around the center. phi is measured from the
// approach direction, so harmonics keep their relation to the line of play.
export function greenRadiusAt(green, x, z) {
  const dx = x - green.x, dz = z - green.z;
  const ang = Math.atan2(dx * green.ax - dz * green.az, -(dx * green.az + dz * green.ax)); // 0 points back down the fairway
  const c = Math.cos(ang - green.rot), s = Math.sin(ang - green.rot);
  // Ellipse radius in direction (c, s) with semi-axes ra (along) and rc (across).
  let r = (green.ra * green.rc) / Math.sqrt((green.rc * c) ** 2 + (green.ra * s) ** 2);
  let m = 1;
  for (const h of green.harmonics) m += h.a * Math.cos(h.k * ang + h.p);
  return r * m;
}
export function greenSdf(green, x, z) {
  return Math.hypot(x - green.x, z - green.z) - greenRadiusAt(green, x, z);
}

function teeSdf(tee, x, z) {
  // Rounded rectangle aligned with the tee heading.
  const dx = x - tee.x, dz = z - tee.z;
  const along = dx * tee.tx + dz * tee.tz, across = dx * -tee.tz + dz * tee.tx;
  const r = 1.2;
  const qx = Math.abs(across) - (tee.w / 2 - r), qz = Math.abs(along) - (tee.l / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}
export { teeSdf };

function polylineDist(pts, x, z) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const vx = b.x - a.x, vz = b.z - a.z;
    const l2 = vx * vx + vz * vz || 1e-9;
    const u = clamp(((x - a.x) * vx + (z - a.z) * vz) / l2, 0, 1);
    const d = Math.hypot(x - a.x - vx * u, z - a.z - vz * u);
    if (d < best) best = d;
  }
  return best;
}
export { polylineDist };

const lengthRange = { 3: [136, 212], 4: [332, 452], 5: [492, 578] };

export function generateHole(course, index) {
  const th = course.theme;
  const par = course.pars[index];
  // A community level (game/level.js) gives the routing, green and hazards itself; the rest of
  // the hole (fairway, rough, tees, path, markers) comes from the same code as every hole.
  const lv = course.level || null;
  const rng = createRng(lv ? lv.seed >>> 0 || 1 : ((course.seed * 7919) ^ ((index + 1) * 104729)) >>> 0);
  const [lo, hi] = lengthRange[par];
  // A real course (course/realCourses.js) has a card yardage and a spec per hole; the random
  // draws still happen in the same order, so invented courses are unchanged.
  const spec = (course.holes && course.holes[index]) || null;
  const drawnYards = Math.round(rng.range(lo, hi));
  let yards = course.yards ? course.yards[index] : drawnYards;
  const L = yards * YARD;

  // --- routing: control points, then rotate so tee to green runs straight down -Z ---
  let ctrl = [{ x: 0, z: 0 }];
  let bends = [];
  if (lv) {
    // The level's route from its tee, through its bend handles, to its pin.
    ctrl = [lv.tee, ...lv.bend, lv.pin].map((p) => ({ x: p[0] - lv.tee[0], z: p[1] - lv.tee[1] }));
    for (let i = 1; i < ctrl.length - 1; i++) bends.push(Math.atan2(ctrl[i + 1].x - ctrl[i].x, -(ctrl[i + 1].z - ctrl[i].z)) - Math.atan2(ctrl[i].x - ctrl[i - 1].x, -(ctrl[i].z - ctrl[i - 1].z)));
  } else if (par === 3) {
    ctrl.push({ x: 0, z: -L });
  } else if (par === 4) {
    const f1 = rng.range(0.52, 0.64);
    let b = rng.chance(0.72) ? rng.sign() * rng.range(9, 30) * DEG : rng.range(-4, 4) * DEG;
    if (spec && typeof spec.bend === 'number') b = spec.bend * DEG;
    bends = [b];
    ctrl.push({ x: 0, z: -L * f1 });
    ctrl.push({ x: Math.sin(b) * L * (1 - f1), z: -L * f1 - Math.cos(b) * L * (1 - f1) });
  } else {
    const f1 = rng.range(0.4, 0.46), f2 = rng.range(0.74, 0.8);
    let b1 = rng.chance(0.7) ? rng.sign() * rng.range(8, 24) * DEG : rng.range(-4, 4) * DEG;
    let b2 = b1 + (rng.chance(0.55) ? rng.sign() * rng.range(8, 22) * DEG : rng.range(-4, 4) * DEG);
    if (spec && spec.bend != null) { const bb = Array.isArray(spec.bend) ? spec.bend : [spec.bend, 0]; b1 = bb[0] * DEG; b2 = b1 + bb[1] * DEG; }
    bends = [b1, b2 - b1];
    const p1 = { x: 0, z: -L * f1 };
    const p2 = { x: p1.x + Math.sin(b1) * L * (f2 - f1), z: p1.z - Math.cos(b1) * L * (f2 - f1) };
    const p3 = { x: p2.x + Math.sin(b2) * L * (1 - f2), z: p2.z - Math.cos(b2) * L * (1 - f2) };
    ctrl.push(p1, p2, p3);
  }
  const end = ctrl[ctrl.length - 1];
  const rot = Math.atan2(end.x, -end.z);
  // Rotate every point by -rot in the heading sense (heading 0 is -Z, positive toward +X).
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (const p of ctrl) {
    const x = p.x * cr + p.z * sr, z = -p.x * sr + p.z * cr;
    p.x = x; p.z = z;
  }
  // A level's own pieces, moved into the same frame (tee at the origin, green down -Z).
  const xf = lv ? (q) => { const x = q[0] - lv.tee[0], z = q[1] - lv.tee[1]; return { x: x * cr + z * sr, z: -x * sr + z * cr }; } : null;
  // Insert midpoints so the rounding only softens the corners, then round and resample.
  const dense = [ctrl[0]];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const a = ctrl[i], b = ctrl[i + 1];
    dense.push({ x: lerp(a.x, b.x, 0.5), z: lerp(a.z, b.z, 0.5) }, b);
  }
  const line = resample(chaikin(dense, 3), LINE_STEP);
  const total = line[line.length - 1].s;
  if (lv) yards = Math.round(total / YARD);
  const P = {}, Q = {};

  // --- green ---
  pointAt(line, total, P);
  let greenR = rng.range(th.greenRadius[0], th.greenRadius[1]);
  let aspect = rng.range(0.82, 1.28);
  // A double green (the Old Course): half as large again and long across the line.
  if (spec && spec.double) { greenR *= 1.45; aspect = 0.62; }
  if (lv) { greenR = lv.green; aspect = 1; }
  const green = {
    x: P.x, z: P.z, ax: P.tx, az: P.tz, // approach direction (unit)
    ra: greenR * aspect, rc: greenR / Math.sqrt(aspect), rot: rng.range(-0.6, 0.6),
    harmonics: [2, 3, 4].map((k) => ({ k, a: rng.range(0.03, 0.11) / (k - 1) * 1.6, p: rng.range(0, Math.PI * 2) })),
    radius: greenR,
    raise: rng.range(0.5, 1.5),
    tiltDir: rng.range(-0.9, 0.9), // radians off "back to front"
    tilt: rng.range(...(th.greenTilt || [0.008, 0.022])),
    tier: rng.chance(th.tierChance ?? 0.3) ? { h: rng.range(0.22, 0.38), ang: rng.range(-0.8, 0.8), off: rng.range(-0.25, 0.25) } : null,
    contourSeed: rng.int(1, 1e6),
  };
  green.maxR = Math.max(green.ra, green.rc) * 1.3;

  // --- fairway half-width profile along the centerline ---
  const baseHalf = rng.range(th.fairwayHalf[0], th.fairwayHalf[1]);
  const hasFairway = par > 3 || rng.chance(0.6);
  const fwStart = par === 3 ? total - green.maxR - rng.range(22, 38) : rng.range(72, 104);
  const fwEnd = total - (greenR * 0.9 + rng.range(5, 12));
  const wPhase = rng.range(0, 6.28), wPhase2 = rng.range(0, 6.28);
  const cap = par === 3 ? 9 : 16;
  const halfAt = (s) => {
    if (!hasFairway || s <= fwStart || s >= fwEnd) return 0;
    const b = par === 3 ? rng0par3 : baseHalf;
    const wob = 1 + 0.16 * Math.sin(s / 47 + wPhase) + 0.08 * Math.sin(s / 21 + wPhase2);
    // Rounded ends: a circular cap of length `cap` at each end.
    const e0 = clamp((s - fwStart) / cap, 0, 1), e1 = clamp((fwEnd - s) / cap, 0, 1);
    const capK = Math.sqrt(1 - (1 - e0) ** 2) * Math.sqrt(1 - (1 - e1) ** 2);
    // Narrow toward the green so the approach funnels in.
    const funnel = lerp(0.72, 1, smoothstep(total - 20, total - 110, s));
    return b * wob * capK * funnel;
  };
  const rng0par3 = rng.range(8, 11.5);
  const roughBand = rng.range(th.roughBand[0], th.roughBand[1]);

  // --- tees ---
  pointAt(line, 0, P);
  const teeDir = { tx: P.tx, tz: P.tz };
  const tees = [
    { name: 'back', s: 0, x: 0, z: 0, w: 7.5, l: 11, ...teeDir },
    { name: 'middle', s: 17, w: 7, l: 10, ...teeDir },
    { name: 'forward', s: 33, w: 6.5, l: 9, ...teeDir },
  ];
  for (let i = 1; i < tees.length; i++) {
    offsetPoint(line, tees[i].s, (i === 1 ? 1 : -1) * rng.range(2.5, 5), P);
    tees[i].x = P.x; tees[i].z = P.z;
  }

  // --- sea (coastal holes): one side of the hole falls away to a beach and the water ---
  let sea = null;
  const seaHere = lv ? false : spec && 'sea' in spec ? !!spec.sea && th.seaLevel !== null : th.seaLevel !== null && rng.chance(th.water.sea);
  if (seaHere) {
    sea = { side: spec && spec.sea ? Math.sign(spec.sea) : rng.sign(), offset: baseHalf + roughBand + rng.range(34, 58), wobble: rng.range(6, 14), phase: rng.range(0, 6.28), level: th.seaLevel };
  }
  const waterSide = sea ? sea.side : rng.sign();

  // --- ponds and streams ---
  const water = [];
  const dogSide = bends.length ? Math.sign(bends[0]) || 1 : rng.sign();
  const pondChance = par === 3 ? th.water.frontPond : th.water.pond;
  const pondHere = lv ? false : spec && spec.water ? spec.water !== 'none' : !sea && rng.chance(pondChance);
  if (pondHere) {
    const pr = rng.range(15, 27);
    let cx, cz, role;
    if (spec && spec.water === 'front') {
      // Just short of the green, across the line: the shot must carry it.
      offsetPoint(line, total - greenR - pr - rng.range(5, 9), rng.range(-0.3, 0.3) * pr, P);
      role = 'carry';
    } else if (spec && spec.water === 'greenside') {
      const side = spec.waterSide || rng.sign();
      offsetPoint(line, total - rng.range(-4, 10), side * (greenR + pr * 0.82 + rng.range(4, 8)), P);
      role = 'greenside';
    } else if (spec && spec.water === 'along') {
      // Beside the line from tee to green, most of the way.
      offsetPoint(line, total * 0.5, (spec.waterSide || rng.sign()) * (pr * 0.75 + 9), P);
      role = 'along';
    } else if (par === 3 && rng.chance(0.65)) {
      // Forced carry: the pond sits between the tee and the green, a little to one side.
      offsetPoint(line, total - greenR - pr - rng.range(7, 14), rng.range(-0.5, 0.5) * pr, P);
      role = 'carry';
    } else if (rng.chance(0.5)) {
      // Guarding one side of the green.
      const side = rng.sign();
      offsetPoint(line, total - rng.range(-4, 12), side * (greenR + pr * 0.82 + rng.range(4, 9)), P);
      role = 'greenside';
    } else {
      // Beside the landing zone.
      const s = clamp(rng.range(190, 250), 60, total - 60);
      offsetPoint(line, s, -dogSide * (halfAt(s) + pr * 0.85 + rng.range(4, 10)), P);
      role = 'landing';
    }
    cx = P.x; cz = P.z;
    const blobs = [{ x: cx, z: cz, r: pr }];
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, 6.28), d = pr * rng.range(0.55, 0.95);
      blobs.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, r: pr * rng.range(0.45, 0.75) });
    }
    water.push({ type: 'pond', role, blobs, depth: rng.range(1.2, 2.2) });
  }
  const streamHere = lv ? false : spec && spec.stream != null ? true : rng.chance(th.water.stream) && total > 150;
  // A level's ponds, as placed.
  if (lv) for (const w of lv.water) { const c = xf(w); water.push({ type: 'pond', role: 'level', blobs: [{ x: c.x, z: c.z, r: w[2] }], depth: 1.6 }); }
  if (streamHere) {
    let s = par === 3 ? total - greenR - rng.range(16, 30) : clamp(total * rng.range(0.42, 0.7), 110, total - 70);
    if (spec && spec.stream === 'front') s = total - greenR * (spec.double ? 1.3 : 1) - rng.range(12, 18);
    else if (spec && Number.isFinite(spec.stream)) s = spec.stream;
    pointAt(line, s, P);
    const ang = rng.range(-0.4, 0.4);
    const dx = P.nx * Math.cos(ang) - P.nz * Math.sin(ang), dz = P.nx * Math.sin(ang) + P.nz * Math.cos(ang);
    const pts = [];
    const span = 150, ph = rng.range(0, 6.28), amp = rng.range(4, 10);
    for (let u = -span; u <= span; u += 10) {
      const wv = Math.sin(u / 34 + ph) * amp;
      pts.push({ x: P.x + dx * u - dz * wv, z: P.z + dz * u + dx * wv });
    }
    water.push({ type: 'stream', role: 'crossing', pts, half: rng.range(1.8, 3.2), s, depth: rng.range(0.6, 1.0), ...(spec && spec.stream != null ? { spec: true } : {}) });
  }

  // --- cart path: on the side away from the sea or main water, clear of the dogleg corner ---
  const pathSide = sea ? -sea.side : water.length && water[0].type === 'pond' ? Math.sign((() => { const b = water[0].blobs[0]; pointAt(line, clamp(-b.z, 0, total), P); return -((b.x - P.x) * P.nx + (b.z - P.z) * P.nz) || 1; })()) : dogSide;
  const pathPts = [];
  const pathOff = (s) => (halfAt(s) || (par === 3 ? 10 : 12)) + roughBand * 0.75 + 7;
  for (let s = -8; s <= total + 2; s += 12) {
    const sc = clamp(s, 0, total);
    // Swing wide around the green.
    const nearGreen = smoothstep(total - 55, total - 5, sc);
    offsetPoint(line, s, pathSide * (lerp(pathOff(sc), greenR + 13, nearGreen)), P);
    pathPts.push({ x: P.x, z: P.z });
  }
  const path = { pts: chaikin(pathPts, 2), half: 1.25, side: pathSide };

  const waterDist = (x, z) => {
    let d = 1e9;
    for (const w of water) d = Math.min(d, w.type === 'pond' ? blobSdf(w.blobs, x, z) : polylineDist(w.pts, x, z) - w.half);
    return d;
  };

  // --- bunkers ---
  const bunkers = [];
  const clear = (x, z, r) => {
    if (greenSdf(green, x, z) < r + 1.2) return false;
    for (const t of tees) if (Math.hypot(x - t.x, z - t.z) < r + 12) return false;
    if (waterDist(x, z) < r + 7) return false;
    if (polylineDist(path.pts, x, z) < r + 3) return false;
    for (const b of bunkers) for (const c of b.blobs) if (Math.hypot(x - c.x, z - c.z) < r + c.r + 2.5) return false;
    if (sea) {
      // Own scratch object: the caller is still holding its candidate position in P.
      pointAt(line, clamp(-z, 0, total), Q);
      const lat = ((x - Q.x) * Q.nx + (z - Q.z) * Q.nz) * sea.side;
      if (lat > sea.offset - r - 10) return false;
    }
    return true;
  };
  const drawnGreen = rng.int(th.bunkers.green[0], th.bunkers.green[1]);
  const nGreen = lv ? 0 : spec && spec.bunkers && spec.bunkers.green != null ? spec.bunkers.green : drawnGreen;
  const usedAng = [];
  for (let i = 0, tries = 0; i < nGreen && tries < 40; tries++) {
    // Angle around the green: 0 faces back down the fairway. Keep the front open.
    const ang = rng.range(0.7, Math.PI * 2 - 0.7);
    if (usedAng.some((a) => Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang))) < 0.75)) continue;
    const br = rng.range(th.bunkers.radius[0], th.bunkers.radius[1]);
    // World direction for this angle: rotate the "back down the fairway" vector.
    const bx = -green.ax, bz = -green.az;
    const dx = bx * Math.cos(ang) - bz * Math.sin(ang), dz = bx * Math.sin(ang) + bz * Math.cos(ang);
    const edge = greenRadiusAt(green, green.x + dx * 30, green.z + dz * 30);
    const dist = edge + rng.range(2.2, 4.5) + br;
    const x = green.x + dx * dist, z = green.z + dz * dist;
    if (!clear(x, z, br)) continue;
    const blobs = [{ x, z, r: br }];
    if (!th.bunkers.pot) {
      const n = rng.int(1, 2);
      for (let k = 0; k < n; k++) {
        const side = k === 0 ? 1 : -1;
        const t = br * rng.range(0.8, 1.25);
        const r2 = br * rng.range(0.6, 0.9);
        // Spread along the tangent so the bunker wraps the green.
        const cx = x + -dz * t * side + dx * rng.range(-0.6, 1.2), cz = z + dx * t * side + dz * rng.range(-0.6, 1.2);
        if (greenSdf(green, cx, cz) > r2 + 1.2) blobs.push({ x: cx, z: cz, r: r2 });
      }
    }
    bunkers.push({ kind: 'green', blobs, depth: rng.range(th.bunkers.depth[0], th.bunkers.depth[1]), lip: rng.range(0.35, 0.6), faceX: -dx, faceZ: -dz });
    usedAng.push(ang);
    i++;
  }
  if (par > 3) {
    const drawnFw = rng.int(th.bunkers.fairway[0], th.bunkers.fairway[1]);
    const nFw = lv ? 0 : spec && spec.bunkers && spec.bunkers.fairway != null ? spec.bunkers.fairway : drawnFw;
    for (let i = 0, tries = 0; i < nFw && tries < 30; tries++) {
      const zone = par === 5 && rng.chance(0.45) ? [total - 150, total - 75] : [198, 252];
      const s = clamp(rng.range(zone[0], zone[1]), fwStart + 20, fwEnd - 25);
      const br = rng.range(th.bunkers.radius[0], th.bunkers.radius[1]) * (th.bunkers.pot ? 1 : 1.2);
      const side = rng.chance(0.65) ? dogSide : -dogSide;
      const hw = halfAt(s);
      if (hw < 6) continue;
      offsetPoint(line, s, side * (hw + br * rng.range(0.35, 0.9)), P);
      if (!clear(P.x, P.z, br)) continue;
      const blobs = [{ x: P.x, z: P.z, r: br }];
      if (!th.bunkers.pot && rng.chance(0.7)) {
        const t = br * rng.range(0.9, 1.3);
        blobs.push({ x: P.x + P.tx * t, z: P.z + P.tz * t, r: br * rng.range(0.6, 0.85) });
      }
      bunkers.push({ kind: 'fairway', blobs, depth: rng.range(th.bunkers.depth[0], th.bunkers.depth[1]) * 0.85, lip: rng.range(0.28, 0.48), faceX: P.tx, faceZ: P.tz });
      i++;
    }
  }

  // A named big bunker from the spec (a deep one in the middle of the fairway, or a pot
  // guarding a green), placed if it is clear of everything else.
  if (spec && spec.bigBunker) {
    const bb = spec.bigBunker, s = clamp(total * bb.at, 30, total - 4);
    const hw = Math.max(halfAt(s), greenR * 0.8);
    offsetPoint(line, s, (bb.side || 0) * hw, P);
    if (clear(P.x, P.z, bb.r)) bunkers.push({ kind: s > total - greenR * 2 ? 'green' : 'fairway', blobs: [{ x: P.x, z: P.z, r: bb.r }], depth: th.bunkers.depth[1] * 1.15, lip: 0.55, faceX: P.tx, faceZ: P.tz, named: true });
  }

  // A level's bunkers, as placed (the player chose them; only the green and tee are kept clear).
  if (lv) for (const b of lv.bunkers) {
    const c = xf(b), r = b[2];
    if (greenSdf(green, c.x, c.z) < r * 0.6 + 0.6) continue;
    if (tees.some((t) => Math.hypot(c.x - t.x, c.z - t.z) < r + 5)) continue;
    pointAt(line, clamp(-c.z, 0, total), P);
    bunkers.push({ kind: Math.hypot(c.x - green.x, c.z - green.z) < greenR + r + 12 ? 'green' : 'fairway', blobs: [{ x: c.x, z: c.z, r }], depth: (th.bunkers.depth[0] + th.bunkers.depth[1]) / 2, lip: 0.45, faceX: P.tx, faceZ: P.tz });
  }

  // --- pin positions: four candidates well inside the green ---
  const pins = [];
  if (lv) pins.push({ x: green.x, z: green.z });
  for (let i = 0; i < 4; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const a = (i / 4) * Math.PI * 2 + rng.range(-0.5, 0.5), d = greenR * rng.range(0.25, 0.62);
      const x = green.x + Math.cos(a) * d, z = green.z + Math.sin(a) * d;
      if (greenSdf(green, x, z) < -3.6) { pins.push({ x, z }); break; }
    }
  }
  if (!pins.length) pins.push({ x: green.x, z: green.z });

  // --- per-sample profiles used by the terrain builder ---
  const n = line.length;
  const half = new Float32Array(n);
  for (let i = 0; i < n; i++) half[i] = halfAt(line[i].s);
  const corridorExtra = roughBand + th.deepBand * 0.6 + th.trees.margin;

  // --- bounds ---
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of line) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z; }
  const lateral = baseHalf + corridorExtra + 92;
  const bounds = {
    minX: Math.floor(minX - lateral - (sea && sea.side < 0 ? 70 : 0)), maxX: Math.ceil(maxX + lateral + (sea && sea.side > 0 ? 70 : 0)),
    minZ: Math.floor(minZ - 150), maxZ: Math.ceil(maxZ + 112),
  };
  // A level's trees, rough patches and hills, in the hole's frame, for the terrain builder.
  const levelTrees = lv ? lv.trees.map(xf) : null;
  const levelRough = lv ? lv.rough.map((c) => ({ ...xf(c), r: c[2] })) : null;
  const levelHills = lv ? lv.hills.map((c) => ({ ...xf(c), r: c[2], h: c[3] })) : null;
  if (lv) for (const q of [...levelRough, ...levelHills, ...levelTrees.map((t) => ({ ...t, r: 6 })), ...water.flatMap((w) => w.blobs), ...bunkers.flatMap((b) => b.blobs)]) {
    bounds.minX = Math.min(bounds.minX, Math.floor(q.x - q.r - 30)); bounds.maxX = Math.max(bounds.maxX, Math.ceil(q.x + q.r + 30));
    bounds.minZ = Math.min(bounds.minZ, Math.floor(q.z - q.r - 30)); bounds.maxZ = Math.max(bounds.maxZ, Math.ceil(q.z + q.r + 30));
  }

  // --- prop anchors ---
  const markers = [];
  for (const yd of [100, 150, 200]) {
    const s = total - yd * YARD;
    if (s > fwStart + 10 && halfAt(s) > 5) {
      offsetPoint(line, s, -pathSide * (halfAt(s) + 1.6), P);
      markers.push({ yards: yd, x: P.x, z: P.z, s });
    }
  }
  const tournament = index === 17 || index === 0 || index === 8;

  return {
    courseId: course.id, index, number: index + 1, par, yards, length: total, double: !!(spec && spec.double),
    bearing: ((course.seed % 360) + index * 97.3) % 360,
    seed: rng.int(1, 2 ** 30),
    line, lineStep: LINE_STEP, half, baseHalf, roughBand, corridorExtra, fwStart, fwEnd, hasFairway,
    green, pins, pinIndex: index % pins.length,
    tees, teeHeading: Math.atan2(teeDir.tx, -teeDir.tz),
    bunkers, water, sea, path, markers, bounds, bends, dogSide, tournament,
    ...(lv ? { levelTrees, levelRough, levelHills } : {}),
    mowing: ['stripes', 'checker', 'diagonal'][rng.int(0, 2)],
    greenMowing: rng.chance(0.5) ? 'checker' : 'stripes',
  };
}

// Convenience: the pin for a hole, optionally overridden (daily challenge picks its own).
export function pinOf(hole, pinIndex = hole.pinIndex) {
  return hole.pins[((pinIndex % hole.pins.length) + hole.pins.length) % hole.pins.length];
}

const holeCache = new Map();
export function getHole(course, index) {
  const key = course.id + ':' + index;
  if (!holeCache.has(key)) holeCache.set(key, course.range ? generateRange(course) : generateHole(course, index));
  return holeCache.get(key);
}
