// Course routing: where each hole of a course sits in one shared world, so the other holes can
// be drawn around the one being played and the whole course can be drawn as a map. Every hole
// keeps its own frame (back tee at the origin, playing toward -Z) and its own definition; the
// routing only says where that frame sits: the back tee's world position and the frame's
// heading (0 is -Z, positive toward +X, so local -Z points along the tee to green line).
//
// Rules, checked by routingProblems() here and by tests/routing.test.js:
//   - no two playing corridors overlap, and there are at least ROUTING.gap (60 m) between any
//     two of them. A corridor is the centerline from just behind the back tee to the green,
//     out to the fairway's widest half-width (or the green, if wider) plus the hole's
//     corridorExtra: the rough, deep rough and tree margin the terrain builder gives it;
//   - each hole's back tee is a short walk from the previous hole's green. Near that joint two
//     consecutive holes may come closer, but past ROUTING.joint meters into either hole the gap
//     holds. The 18th counts as next to the 1st, and the clubhouse ends of a round (the 1st and
//     10th tees, the 9th and 18th greens) may gather the same way;
//   - no corridor reaches the coastline beside a coastal hole, along that hole's length (on
//     the invented courses; on the real ones the real routing wins, see courseRouting);
//   - the same course gives the same routing on every device (no Math.random, no clock).
// Invented courses are placed by a seeded search: each hole tries tee spots around the last
// green and every heading, cheapest first, with a cost that keeps the course compact and pulls
// the 9th and 18th greens toward home; a dead end backs up and takes the next choice. The two
// real courses (course/realRouting.js) use the same search, with a cost that keeps each hole's
// direction and position close to the real one.
import { getHole } from './layout.js';
import { createRng } from '../core/rng.js';
import { REAL_ROUTING } from './realRouting.js';
import { ROUTING_DATA } from './routingData.js';

export const ROUTING = Object.freeze({
  gap: 60, // meters between two corridors
  joint: 150, // meters into consecutive holes before the gap applies between them
  walkMin: 24, walkMax: 100, // from the green's edge to the next back tee
  behind: 10, // the corridor starts this far behind the back tee
  step: 20, // meters between the corridor's centerline points
  seaMargin: 6, // meters kept clear of a coastline
  budget: 6000, // search nodes before giving up on the preferred costs
});

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// --- frames ---
export function toWorld(frame, x, z, out = {}) {
  const c = Math.cos(frame.heading), s = Math.sin(frame.heading);
  out.x = frame.x + x * c - z * s;
  out.z = frame.z + x * s + z * c;
  return out;
}
export function toLocal(frame, x, z, out = {}) {
  const c = Math.cos(frame.heading), s = Math.sin(frame.heading), dx = x - frame.x, dz = z - frame.z;
  out.x = dx * c + dz * s;
  out.z = -dx * s + dz * c;
  return out;
}
// A point in hole a's frame, given in hole b's frame.
export function frameToFrame(from, to, x, z, out = {}) {
  toWorld(from, x, z, out);
  return toLocal(to, out.x, out.z, out);
}

// --- a hole's routing shape, in its own frame ---
function holeShape(hole) {
  const line = hole.line, total = line[line.length - 1].s;
  const th = hole.teeHeading;
  const pts = [{ x: -Math.sin(th) * ROUTING.behind, z: Math.cos(th) * ROUTING.behind, s: -ROUTING.behind }];
  const k = Math.max(1, Math.round(ROUTING.step / hole.lineStep));
  for (let i = 0; i < line.length; i += k) pts.push({ x: line[i].x, z: line[i].z, s: line[i].s });
  const last = line[line.length - 1];
  if (pts[pts.length - 1].s < total - 0.5) pts.push({ x: last.x, z: last.z, s: total });
  let maxHalf = 0;
  for (const v of hole.half) if (v > maxHalf) maxHalf = v;
  const corridor = Math.max(maxHalf, hole.green.maxR) + hole.corridorExtra;
  return { pts, total, corridor, greenR: hole.green.maxR, green: { x: hole.green.x, z: hole.green.z }, sea: hole.sea || null };
}

function placeShape(shape, frame) {
  const pts = new Array(shape.pts.length);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < shape.pts.length; i++) {
    const q = shape.pts[i], w = toWorld(frame, q.x, q.z);
    pts[i] = { x: w.x, z: w.z, s: q.s };
    if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x; if (w.z < minZ) minZ = w.z; if (w.z > maxZ) maxZ = w.z;
  }
  const g = toWorld(frame, shape.green.x, shape.green.z);
  // Approach direction at the green: the last centerline segment.
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  return { frame, pts, minX, maxX, minZ, maxZ, green: g, approach: Math.atan2(b.x - a.x, -(b.z - a.z)) };
}

// --- distances ---
function ptSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1e-9;
  let u = ((px - ax) * vx + (pz - az) * vz) / l2;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(px - ax - vx * u, pz - az - vz * u);
}
function segSeg(a, b, c, d) {
  const o1 = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const o2 = (b.x - a.x) * (d.z - a.z) - (b.z - a.z) * (d.x - a.x);
  const o3 = (d.x - c.x) * (a.z - c.z) - (d.z - c.z) * (a.x - c.x);
  const o4 = (d.x - c.x) * (b.z - c.z) - (d.z - c.z) * (b.x - c.x);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0;
  return Math.min(ptSeg(a.x, a.z, c.x, c.z, d.x, d.z), ptSeg(b.x, b.z, c.x, c.z, d.x, d.z), ptSeg(c.x, c.z, a.x, a.z, b.x, b.z), ptSeg(d.x, d.z, a.x, a.z, b.x, b.z));
}
// Least distance between two centerlines, using only the segments inside [lo, hi] meters of each.
function lineDist(A, B, aLo = -Infinity, aHi = Infinity, bLo = -Infinity, bHi = Infinity) {
  let best = Infinity;
  for (let i = 0; i < A.length - 1; i++) {
    if (A[i].s < aLo || A[i + 1].s > aHi) continue;
    for (let j = 0; j < B.length - 1; j++) {
      if (B[j].s < bLo || B[j + 1].s > bHi) continue;
      const d = segSeg(A[i], A[i + 1], B[j], B[j + 1]);
      if (d < best) best = d;
    }
  }
  return best;
}
const boxGap = (a, b) => Math.max(0, a.minX - b.maxX, b.minX - a.maxX, a.minZ - b.maxZ, b.minZ - a.maxZ);

// Signed lateral offset and distance along a centerline (local frame), extending the end
// segments past the tee and the green, as the terrain's own lateralAt does.
function lateral(pts, x, z, out) {
  let best = Infinity, bs = 0, bt = 0;
  const L = pts.length;
  for (let i = 0; i < L - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const vx = b.x - a.x, vz = b.z - a.z, len = Math.hypot(vx, vz) || 1e-9;
    const ux = vx / len, uz = vz / len, px = x - a.x, pz = z - a.z;
    let u = px * ux + pz * uz;
    if (!(i === 0 && u < 0) && !(i === L - 2 && u > len)) u = u < 0 ? 0 : u > len ? len : u;
    const ex = px - ux * u, ez = pz - uz * u, d = ex * ex + ez * ez;
    if (d < best) { best = d; bs = a.s + (b.s - a.s) * (u / len); bt = (ex * -uz + ez * ux) >= 0 ? Math.sqrt(d) : -Math.sqrt(d); }
  }
  out.s = bs; out.t = bt;
  return out;
}

// How far the corridor of hole j (placed) reaches past the coastline of coastal hole k, in
// meters (positive is a problem), looking only along hole k's own length.
const _lat = {}, _loc = {};
function seaIntrusion(shapeK, placedK, shapeJ, placedJ) {
  const sea = shapeK.sea;
  if (!sea) return -Infinity;
  const pts = placedJ.pts;
  let worst = -Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 8));
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
      toLocal(placedK.frame, x, z, _loc);
      lateral(shapeK.pts, _loc.x, _loc.z, _lat);
      if (_lat.s < -40 || _lat.s > shapeK.total + 40) continue;
      // The coastline wobbles by up to wobble * 1.35 around its offset.
      const coast = sea.offset - sea.wobble * 1.35 - ROUTING.seaMargin;
      const reach = _lat.t * sea.side + shapeJ.corridor - coast;
      if (reach > worst) worst = reach;
    }
  }
  return worst;
}

// Are holes i and j consecutive (i plays just before j), including the 18th back to the 1st?
const isNext = (i, j, n) => j === i + 1 || (n >= 3 && i === n - 1 && j === 0);
// The clubhouse ends of an 18-hole round: the 1st and 10th tees and the 9th and 18th greens.
// Like a joint between consecutive holes, those ends may sit close to each other (they meet
// at the clubhouse), while the gap still holds along the rest of each hole.
const hubEnd = (i, n) => (n !== 18 ? null : i === 0 || i === 9 ? 'tee' : i === 8 || i === 17 ? 'green' : null);

// The gap between the corridors of placed holes a and b (meters, edge to edge), with the joint
// between consecutive holes and the clubhouse ends left out as the rules say.
function pairGap(shapes, placed, a, b, n) {
  const A = placed[a], B = placed[b], sa = shapes[a], sb = shapes[b];
  let d;
  if (isNext(a, b, n) || isNext(b, a, n)) {
    const [p, q] = isNext(a, b, n) ? [a, b] : [b, a];
    const P = placed[p], Q = placed[q], jp = Math.min(ROUTING.joint, shapes[p].total * 0.5), jq = Math.min(ROUTING.joint, shapes[q].total * 0.5);
    d = Math.min(lineDist(P.pts, Q.pts, -Infinity, shapes[p].total - jp), lineDist(P.pts, Q.pts, -Infinity, Infinity, jq, Infinity));
  } else if (hubEnd(a, n) && hubEnd(b, n)) {
    // Each hole's body (all but its clubhouse end) against the whole of the other.
    const body = (i) => { const j = Math.min(ROUTING.joint, shapes[i].total * 0.5); return hubEnd(i, n) === 'tee' ? [j, Infinity] : [-Infinity, shapes[i].total - j]; };
    const ba = body(a), bb = body(b);
    d = Math.min(lineDist(A.pts, B.pts, ba[0], ba[1]), lineDist(A.pts, B.pts, -Infinity, Infinity, bb[0], bb[1]));
  } else d = lineDist(A.pts, B.pts);
  return d - sa.corridor - sb.corridor;
}

// The problems between placed hole a and placed hole b (both indices), as strings. The sea rule
// is left out for the real courses (see courseRouting).
function pairProblems(shapes, placed, a, b, n, list, sea = true) {
  const A = placed[a], B = placed[b], sa = shapes[a], sb = shapes[b];
  if (boxGap(A, B) < sa.corridor + sb.corridor + ROUTING.gap) {
    const gap = pairGap(shapes, placed, a, b, n);
    if (gap < ROUTING.gap - 1e-6) list.push(`holes ${a + 1} and ${b + 1}: ${gap.toFixed(1)} m between corridors`);
  }
  if (!sea) return;
  const s1 = seaIntrusion(sa, A, sb, B);
  if (s1 > 0) list.push(`hole ${b + 1} reaches ${s1.toFixed(1)} m into the sea beside hole ${a + 1}`);
  const s2 = seaIntrusion(sb, B, sa, A);
  if (s2 > 0) list.push(`hole ${a + 1} reaches ${s2.toFixed(1)} m into the sea beside hole ${b + 1}`);
}

function walkOf(shapes, placed, i, j) {
  const g = placed[i].green, t = placed[j].frame;
  return Math.hypot(t.x - g.x, t.z - g.z) - shapes[i].greenR;
}

function pointLine(p, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, ptSeg(p.x, p.z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z));
  return d;
}
// A cheap first look: a few points of hole j's centerline that are certainly too close to an
// earlier hole make it fail the full check, so most bad candidates stop here.
function quickReject(shapes, placed, j, n) {
  const pts = placed[j].pts, sj = shapes[j];
  const probes = [pts[pts.length - 1], pts[Math.floor(pts.length * 0.75)], pts[Math.floor(pts.length / 2)]];
  const jj = Math.min(ROUTING.joint, sj.total * 0.5);
  for (let k = 0; k < j; k++) {
    const Q = placed[k];
    if (!Q || isNext(j, k, n)) continue;
    const need = shapes[k].corridor + sj.corridor + ROUTING.gap, consec = isNext(k, j, n);
    const hub = hubEnd(j, n) && hubEnd(k, n) ? hubEnd(j, n) : null;
    for (const p of probes) {
      if (consec && p.s < jj) continue;
      if (hub === 'tee' ? p.s < jj : hub === 'green' ? p.s > sj.total - jj : false) continue;
      if (p.x < Q.minX - need || p.x > Q.maxX + need || p.z < Q.minZ - need || p.z > Q.maxZ + need) continue;
      if (pointLine(p, Q.pts) < need) return true;
    }
  }
  return false;
}

// Is hole j (just placed) clear of every hole placed before it?
function fits(shapes, placed, j, n, upto, sea) {
  if (quickReject(shapes, placed, j, n)) return false;
  const list = [];
  for (let k = 0; k < upto; k++) {
    if (k === j || !placed[k]) continue;
    pairProblems(shapes, placed, k, j, n, list, sea);
    if (list.length) return false;
  }
  return true;
}

// --- the search ---
function search(shapes, first, costOf, rng, opts = {}) {
  const n = shapes.length;
  const placed = new Array(n).fill(null);
  placed[0] = placeShape(shapes[0], first);
  let nodes = 0, checks = 0, deepest = 0;
  const branch = opts.branch || 3;
  const headings = (j) => (opts.headings ? opts.headings(j) : Array.from({ length: 24 }, (_, i) => i * 15 * DEG));
  const walks = [0, 0.45, 1].map((f) => ROUTING.walkMin + (ROUTING.walkMax - ROUTING.walkMin) * f);
  const phis = Array.from({ length: 11 }, (_, i) => (-125 + i * 25) * DEG);
  function candidates(j) {
    const prev = placed[j - 1], gr = shapes[j - 1].greenR, list = [];
    for (const w of walks) for (const phi of phis) {
      const ang = prev.approach + phi, r = gr + w;
      const x = prev.green.x + Math.sin(ang) * r, z = prev.green.z - Math.cos(ang) * r;
      for (const h of headings(j)) {
        const frame = { x, z, heading: wrap(h) };
        list.push({ frame, cost: costOf(j, frame, placed, w) + rng.next() * (opts.jitter || 0) });
      }
    }
    list.sort((p, q) => p.cost - q.cost);
    return list;
  }
  function dfs(j) {
    if (j === n) return true;
    if (++nodes > ROUTING.budget) return false;
    if (j > deepest) deepest = j;
    let tried = 0;
    for (const c of candidates(j)) {
      placed[j] = placeShape(shapes[j], c.frame);
      checks++;
      // (The last hole counts as next to the first, so the walk home is a joint too.)
      if (!fits(shapes, placed, j, n, j, opts.sea !== false)) { placed[j] = null; continue; }
      if (dfs(j + 1)) return true;
      placed[j] = null;
      if (nodes > ROUTING.budget || ++tried >= branch) break;
    }
    return false;
  }
  const ok = dfs(1);
  return { ok, placed, nodes, checks, deepest };
}

// --- costs ---
function generatedCost(shapes, home1, home10, center) {
  const ramp = [0, 0, 0, 0.04, 0.1, 0.25, 0.55, 1.1, 2.2];
  const n = shapes.length;
  // Meters of play left in this nine after hole j (hole lengths plus a walk each).
  const left = shapes.map((_, j) => { const end = j < 9 && n > 9 ? 8 : n - 1; let s = 0; for (let k = j + 1; k <= end; k++) s += shapes[k].total + 60; return s; });
  return (j, frame, placed, walk) => {
    const sh = shapes[j];
    const gx = frame.x + Math.sin(frame.heading) * sh.total, gz = frame.z - Math.cos(frame.heading) * sh.total;
    const mx = (frame.x + gx) / 2, mz = (frame.z + gz) / 2;
    const nine = j < 9 ? j : j - 9;
    const home = j < 9 && n > 9 ? home10 : home1;
    let c = walk * 0.35;
    const dh = Math.hypot(gx - home.x, gz - home.z);
    c += (ramp[nine] || 0) * dh;
    // Never wander further from home than the rest of the nine can walk back.
    c += 1.4 * Math.max(0, dh - left[j] * 0.6);
    const dc = Math.hypot(mx - center.x, mz - center.z);
    c += dc * 0.08 + Math.max(0, dc - 650) * 0.6;
    // Room around the green for the next hole: a green boxed in by earlier holes is a dead end.
    if (j < n - 1) {
      let room = 240;
      for (let k = 0; k < j; k++) if (placed[k]) room = Math.min(room, pointLine({ x: gx, z: gz }, placed[k].pts) - shapes[k].corridor);
      c -= Math.max(0, room) * 0.35;
    }
    return c;
  };
}

// The real courses: each hole keeps the real turn from the hole before, its real direction and
// the real walk from the last green (seen from that hole), with a weak pull toward its real
// green and, late in the round, toward the real 18th green, so the round still comes home.
function realCost(shapes, real, spread = 1.35) {
  const n = shapes.length;
  const left = shapes.map((_, j) => { let s = 0; for (let k = j + 1; k < n; k++) s += shapes[k].total + 60; return s; });
  const last = real[n - 1].green;
  const inFrame = (vx, vz, h, out) => { const c = Math.cos(h), s = Math.sin(h); out.x = vx * c + vz * s; out.z = -vx * s + vz * c; return out; };
  const a = {}, b = {};
  return (j, frame, placed, walk) => {
    const r = real[j], q = real[j - 1], prev = placed[j - 1], sh = shapes[j];
    const gx = frame.x + Math.sin(frame.heading) * sh.total, gz = frame.z - Math.cos(frame.heading) * sh.total;
    const dh = Math.abs(wrap(frame.heading - r.heading)) / DEG;
    const turn = Math.abs(wrap(frame.heading - prev.frame.heading - (r.heading - q.heading))) / DEG;
    inFrame(r.tee[0] - q.green[0], r.tee[1] - q.green[1], q.heading, a);
    inFrame(frame.x - prev.green.x, frame.z - prev.green.z, prev.frame.heading, b);
    let c = turn * 1.3 + dh * 0.9 + 0.5 * Math.hypot(a.x - b.x, a.z - b.z);
    c += 0.3 * Math.hypot(gx - r.green[0] * spread, gz - r.green[1] * spread);
    c += 1.2 * Math.max(0, Math.hypot(gx - last[0], gz - last[1]) - left[j] * 0.6);
    return c;
  };
}

// --- the routing ---
const cache = new Map();

// Solve a course's routing with the search above (no stored data). Returns the routing and the
// number of search nodes it took.
export function computeRouting(course) {
  if (!course || course.range || !course.pars || !course.pars.length) return null;
  const n = course.pars.length;
  const shapes = [];
  for (let i = 0; i < n; i++) shapes.push(holeShape(getHole(course, i)));
  const rng = createRng(((course.seed >>> 0) * 2654435761 + 0x5f3759df) >>> 0);
  const realData = !course.level && REAL_ROUTING[course.id] && REAL_ROUTING[course.id].holes.length === n ? REAL_ROUTING[course.id] : null;
  let result, clubhouse, source;
  if (realData) {
    const real = realData.holes.map((h) => ({ ...h, heading: Math.atan2(h.green[0] - h.tee[0], -(h.green[1] - h.tee[1])) }));
    const first = { x: real[0].tee[0], z: real[0].tee[1], heading: real[0].heading };
    const headings = (j) => Array.from({ length: 49 }, (_, i) => real[j].heading + (i - 24) * 5 * DEG);
    // The game's specs for these holes put some coasts where the real course has land (the
    // Old Course's 10th and 11th have the sea on the left, which faces inland on the real
    // routing), so here the real routing wins over the sea rule; the scenery does not draw
    // other holes inside the current hole's sea.
    result = search(shapes, first, realCost(shapes, real), rng, { headings, branch: 6, sea: false });
    if (!result.ok) result = search(shapes, first, realCost(shapes, real), rng, { branch: 8, sea: false });
    clubhouse = { x: 0, z: 0 };
    source = realData.source;
  } else {
    const h0 = rng.range(-Math.PI, Math.PI);
    const first = { x: 0, z: 0, heading: h0 };
    // Home for the front nine's finish and the back nine's start: across from the 1st tee.
    const side = rng.sign(), back = { x: -Math.sin(h0), z: Math.cos(h0) }, right = { x: Math.cos(h0), z: Math.sin(h0) };
    const home1 = { x: 0, z: 0 };
    const home10 = { x: right.x * 190 * side + back.x * 30, z: right.z * 190 * side + back.z * 30 };
    const center = { x: (home1.x + home10.x) / 2 - back.x * 320, z: (home1.z + home10.z) / 2 - back.z * 320 };
    result = search(shapes, first, generatedCost(shapes, home1, home10, center), rng, { jitter: 30 });
    if (!result.ok) result = search(shapes, first, (j, f, p, w) => w, rng, { jitter: 10, branch: 8 });
    clubhouse = { x: (home1.x + home10.x) / 2 + back.x * 45, z: (home1.z + home10.z) / 2 + back.z * 45 };
    source = 'generated';
  }
  if (!result.ok) throw new Error(`course routing: no layout found for ${course.id} (search reached hole ${result.deepest + 1})`);
  // Keep an invented clubhouse clear of every corridor (a real one stays where it is).
  if (source === 'generated') clubhouse = clearSpot(shapes, result.placed, clubhouse);
  const frames = result.placed.map((p) => [round(p.frame.x), round(p.frame.z), +p.frame.heading.toFixed(6)]);
  return { routing: finishRouting(course, shapes, frames, [round(clubhouse.x), round(clubhouse.z)], source), nodes: result.nodes };
}

// The full routing from each hole's frame (x, z, heading): where its centerline and green lie,
// and the bounds of the whole course.
function finishRouting(course, shapes, frames, clubhouse, source) {
  const placed = frames.map((f, i) => placeShape(shapes[i], { x: f[0], z: f[1], heading: f[2] }));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  placed.forEach((p, i) => {
    const c = shapes[i].corridor;
    minX = Math.min(minX, p.minX - c); maxX = Math.max(maxX, p.maxX + c); minZ = Math.min(minZ, p.minZ - c); maxZ = Math.max(maxZ, p.maxZ + c);
  });
  const [cx, cz] = clubhouse;
  minX = Math.min(minX, cx - 40); maxX = Math.max(maxX, cx + 40); minZ = Math.min(minZ, cz - 40); maxZ = Math.max(maxZ, cz + 40);
  const holes = placed.map((p, i) => Object.freeze({
    index: i, number: i + 1,
    x: frames[i][0], z: frames[i][1], heading: frames[i][2],
    corridor: +shapes[i].corridor.toFixed(2), length: +shapes[i].total.toFixed(2),
    green: Object.freeze({ x: round(p.green.x), z: round(p.green.z) }),
    line: Object.freeze(p.pts.map((q) => Object.freeze({ x: round(q.x), z: round(q.z), s: round(q.s) }))),
  }));
  return Object.freeze({
    courseId: course.id, source, holes: Object.freeze(holes), clubhouse: Object.freeze({ x: cx, z: cz }),
    bounds: Object.freeze({ minX: Math.floor(minX), maxX: Math.ceil(maxX), minZ: Math.floor(minZ), maxZ: Math.ceil(maxZ) }),
  });
}

// A course's routing. The built-in courses use the frames stored in course/routingData.js (the
// search's own result, written by scripts/tools/routing-build.mjs and checked against a fresh
// search by tests/routing.test.js), so a phone never runs the search; any other course (a
// community level) is solved here.
export function courseRouting(course) {
  if (!course || course.range || !course.pars || !course.pars.length) return null;
  if (cache.has(course.id)) return cache.get(course.id);
  const n = course.pars.length, stored = !course.level && ROUTING_DATA[course.id];
  let routing;
  if (stored && stored.frames.length === n && stored.seed === course.seed) {
    const shapes = [];
    for (let i = 0; i < n; i++) shapes.push(holeShape(getHole(course, i)));
    routing = finishRouting(course, shapes, stored.frames, stored.clubhouse, stored.source);
  } else routing = computeRouting(course).routing;
  cache.set(course.id, routing);
  return routing;
}

const round = (v) => Math.round(v * 100) / 100;

function clearSpot(shapes, placed, spot) {
  const ok = (x, z) => placed.every((p, i) => {
    let d = Infinity;
    for (let k = 0; k < p.pts.length - 1; k++) d = Math.min(d, ptSeg(x, z, p.pts[k].x, p.pts[k].z, p.pts[k + 1].x, p.pts[k + 1].z));
    return d > shapes[i].corridor + 12;
  });
  if (ok(spot.x, spot.z)) return spot;
  for (let r = 10; r <= 400; r += 10) for (let a = 0; a < 24; a++) {
    const x = spot.x + Math.cos((a / 24) * Math.PI * 2) * r, z = spot.z + Math.sin((a / 24) * Math.PI * 2) * r;
    if (ok(x, z)) return { x, z };
  }
  return spot;
}

// The frame of one hole: where its tee sits in the world and which way it points.
export function holeFrame(routing, index) {
  const h = routing && routing.holes[index];
  return h ? { x: h.x, z: h.z, heading: h.heading } : null;
}

// Every rule the routing must keep, as a list of problems (empty when it keeps them all).
// Used by the tests and the course map's own check.
export function routingProblems(course, routing = courseRouting(course)) {
  const n = routing.holes.length, list = [];
  const shapes = routing.holes.map((_, i) => holeShape(getHole(course, i)));
  const placed = routing.holes.map((h, i) => placeShape(shapes[i], { x: h.x, z: h.z, heading: h.heading }));
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pairProblems(shapes, placed, a, b, n, list, routing.source === 'generated');
  for (let i = 1; i < n; i++) {
    const w = walkOf(shapes, placed, i - 1, i);
    if (w < ROUTING.walkMin - 0.5 || w > ROUTING.walkMax + 0.5) list.push(`hole ${i + 1} starts ${w.toFixed(1)} m from the hole ${i} green`);
  }
  return list;
}

// Distances between corridors for every pair of holes that are not consecutive, and the walks
// between holes: for the tests and the report.
export function routingStats(course, routing = courseRouting(course)) {
  const n = routing.holes.length;
  const shapes = routing.holes.map((_, i) => holeShape(getHole(course, i)));
  const placed = routing.holes.map((h, i) => placeShape(shapes[i], { x: h.x, z: h.z, heading: h.heading }));
  // The least gap between any two corridors, measured as the rules measure it.
  let minGap = Infinity, minPair = null;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const g = pairGap(shapes, placed, a, b, n);
    if (g < minGap) { minGap = g; minPair = [a + 1, b + 1]; }
  }
  const walks = [];
  for (let i = 1; i < n; i++) walks.push(+walkOf(shapes, placed, i - 1, i).toFixed(1));
  const home = n >= 3 ? +walkOf(shapes, placed, n - 1, 0).toFixed(1) : null;
  return { minGap: +minGap.toFixed(1), minPair, walks, home, width: routing.bounds.maxX - routing.bounds.minX, depth: routing.bounds.maxZ - routing.bounds.minZ };
}

// Test hook: forget cached routings (the routing is a pure function of the course).
export function clearRoutingCache() { cache.clear(); }
