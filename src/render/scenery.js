// The other holes of the course, drawn around the one being played as cheap scenery. Each
// other hole is a flat, vertex-colored drape laid on the outer ground (its rough corridor,
// fairway, green, tees, bunkers and water, and a simple flag), plus a few cone trees along its
// corridor. No textures, grass, shadows or props, and nothing here touches the physics: the
// ball plays the ground outside the current hole exactly as before (rough inside the hole's
// grid, out of bounds past it), so the drape stops at the edge of the current hole's grid and
// at its coastline.
//
// Cost: everything is two draw calls whatever the number of holes. All the drapes share one
// mesh and all the trees one instanced mesh; each frame the holes that are near enough and in
// view are found from a bounding sphere per hole, and only when that set changes are their
// index ranges and tree instances copied into what is drawn. Far holes fade out (the drape's
// alpha, the trees' size) before the distance limit, so nothing pops, and the post pass's
// aerial perspective and fog fade them on the way. Shadows and the AO pass skip both meshes.
// Built when a hole starts (world.loadHole) and freed when it ends.
import * as THREE from 'three';
import { getHole, greenRadiusAt, pinOf } from '../course/layout.js';
import { courseRouting, holeFrame, frameToFrame } from '../course/routing.js';
import { createRng } from '../core/rng.js';
import { clamp } from '../core/math.js';

// Hard budgets for everything the scenery draws, per quality tier (ultra uses high's).
export const SCENERY_BUDGET = Object.freeze({
  low: Object.freeze({ tris: 8000, draws: 2 }),
  medium: Object.freeze({ tris: 25000, draws: 4 }),
  high: Object.freeze({ tris: 60000, draws: 6 }),
  ultra: Object.freeze({ tris: 60000, draws: 6 }),
});
// How much of each hole is drawn: centerline step (m), points around a green, bunker or pond,
// trees per hole (scaled by the course's tree density), the rough corridor, the tees, and the
// distance limit (m, from the camera to the hole's bounding sphere).
export const SCENERY_DETAIL = Object.freeze({
  low: Object.freeze({ step: 34, ring: 8, blob: 6, trees: 9, rough: false, tees: 1, far: 1400 }),
  medium: Object.freeze({ step: 24, ring: 12, blob: 8, trees: 24, rough: true, tees: 3, far: 2000 }),
  high: Object.freeze({ step: 16, ring: 18, blob: 10, trees: 52, rough: true, tees: 3, far: 2700 }),
  ultra: Object.freeze({ step: 16, ring: 18, blob: 10, trees: 52, rough: true, tees: 3, far: 2700 }),
});
const LIFT = 0.35; // meters above the outer ground
const NEAR_HIDE = 14; // trees closer to the camera than this shrink away (no camera inside one)

// Tree shapes by course: height range (m), crown radius as a share of height, trunk share.
const TREE_LOOK = {
  parkland: { h: [11, 17], r: 0.36, trunk: 0.24, crown: 0x2f4a26, crown2: 0x3d5c2e },
  links: { h: [2.2, 3.4], r: 0.75, trunk: 0.08, crown: 0x4e5a2c, crown2: 0x6a6a30 },
  desert: { h: [3.5, 6], r: 0.42, trunk: 0.3, crown: 0x5e6a3a, crown2: 0x7a7a48 },
  alpine: { h: [14, 22], r: 0.24, trunk: 0.12, crown: 0x1f3a24, crown2: 0x2a4a2c },
  tropical: { h: [10, 15], r: 0.42, trunk: 0.55, crown: 0x355f2a, crown2: 0x47722f },
  augusta: { h: [17, 26], r: 0.2, trunk: 0.35, crown: 0x263f22, crown2: 0x2f4c28 },
  standrews: { h: [1.8, 3], r: 0.8, trunk: 0.06, crown: 0x5a6634, crown2: 0x6e7038 },
};
const WATER = new THREE.Color(0x3e6672);
const FLAG = [new THREE.Color(0xd8382c), new THREE.Color(0xf2c230)];

// The other holes' corridors in hole `index`'s frame, as segments for the terrain view's
// footprint (render/terrainView.js): ax, az, bx, bz, corridor half-width.
export function sceneryFootprint(course, index) {
  const routing = courseRouting(course);
  if (!routing || routing.holes.length < 2) return null;
  const me = holeFrame(routing, index), segs = [], P = {}, Q = {};
  routing.holes.forEach((h, k) => {
    if (k === index) return;
    const pts = h.line, stride = 3;
    for (let i = 0; i < pts.length - 1; i += stride) {
      const j = Math.min(pts.length - 1, i + stride);
      toMine(me, pts[i], P); toMine(me, pts[j], Q);
      segs.push(P.x, P.z, Q.x, Q.z, h.corridor);
    }
  });
  return new Float32Array(segs);
}
// A world point (routing coordinates) in a hole's frame.
function toMine(frame, p, out) {
  const c = Math.cos(frame.heading), s = Math.sin(frame.heading), dx = p.x - frame.x, dz = p.z - frame.z;
  out.x = dx * c + dz * s; out.z = -dx * s + dz * c;
  return out;
}

export function createScenery({ course, index, terrain, view, tier, surfaces }) {
  const routing = courseRouting(course);
  const group = new THREE.Group();
  group.name = 'scenery';
  const empty = { group, setVisible() {}, update() {}, stats: () => ({ holes: 0, tris: 0, drawnTris: 0, draws: 0, trees: 0 }), dispose() {}, meshes: [] };
  if (!routing || routing.holes.length < 2 || !view.outerSurfaceAt) return empty;
  const tid = SCENERY_DETAIL[tier.id] ? tier.id : 'medium';
  const detail = SCENERY_DETAIL[tid], budget = SCENERY_BUDGET[tid];
  const me = holeFrame(routing, index);
  const ground = view.outerSurfaceAt;
  const th = course.theme;
  const look = TREE_LOOK[course.look || course.id] || TREE_LOOK.parkland;
  // Surface colors: the terrain's own average colors for each surface, the ones it uses far away.
  const avg = (slot) => { const s = surfaces.find((q) => q.slot === slot); return s ? new THREE.Color(s.avg[0], s.avg[1], s.avg[2]) : new THREE.Color(0.1, 0.2, 0.05); };
  // The plain lighting of the drape comes out brighter than the terrain shader's, so the turf
  // is taken down a little to sit with this hole's own far fairway (checked by eye).
  const turf = (c) => c.multiplyScalar(0.8);
  const COL = { rough: turf(avg('firstCut').lerp(avg('rough'), 0.5)), fairway: turf(avg('fairway')), green: turf(avg('green')), tee: turf(avg('tee')), sand: avg('bunker') };

  // Keep the drape off the current hole's own ground (its grid) and out of its sea.
  const gx0 = terrain.x0 - 2, gx1 = terrain.maxX + 2, gz0 = terrain.z0 - 2, gz1 = terrain.maxZ + 2;
  const blocked = (x, z) => (x > gx0 && x < gx1 && z > gz0 && z < gz1) || (terrain.seaDistAt && terrain.seaDistAt(x, z) > -10);

  // --- the drape: one buffer for every hole ---
  const pos = [], col = [], nor = [], blk = [], holes = [];
  let idx = [];
  const _n = new THREE.Vector3();
  function vert(x, z, c, lift = LIFT) {
    const y = ground(x, z);
    // Normal from the ground the vertex lies on, so it shades like the ground beside it.
    const e = 4, gx = (ground(x + e, z) - ground(x - e, z)) / (2 * e), gz = (ground(x, z + e) - ground(x, z - e)) / (2 * e);
    _n.set(-gx, 1, -gz).normalize();
    pos.push(x, y + lift, z); col.push(c.r, c.g, c.b); nor.push(_n.x, _n.y, _n.z);
    // Blocked or not, found once per vertex (a vertex is shared by up to six triangles).
    blk.push(blocked(x, z) ? 1 : 0);
    return pos.length / 3 - 1;
  }
  const P = {};
  const mine = (frame, x, z) => frameToFrame(frame, me, x, z, P);
  // A triangle, unless any corner is on blocked ground.
  const ok = (a, b, c) => !(blk[a] || blk[b] || blk[c]);
  const tri = (a, b, c) => { if (ok(a, b, c)) idx.push(a, b, c); };
  // A band along a hole's centerline, half-width w(s), as two strips sharing the centerline.
  function band(frame, hole, from, to, wAt, c) {
    const line = hole.line, step = hole.lineStep;
    const rows = [];
    const n = Math.max(1, Math.ceil((to - from) / detail.step));
    for (let k = 0; k <= n; k++) {
      const s = from + ((to - from) * k) / n;
      const i = clamp(Math.round(s / step), 0, line.length - 1), q = line[i], r2 = line[Math.min(line.length - 1, i + 1)], r1 = line[Math.max(0, i - 1)];
      const dx = r2.x - r1.x, dz = r2.z - r1.z, d = Math.hypot(dx, dz) || 1, nx = -dz / d, nz = dx / d;
      const hw = wAt(i);
      if (!(hw > 0.5)) { rows.push(null); continue; }
      const L = mine(frame, q.x - nx * hw, q.z - nz * hw), l = vert(L.x, L.z, c);
      const C = mine(frame, q.x, q.z), m = vert(C.x, C.z, c);
      const R = mine(frame, q.x + nx * hw, q.z + nz * hw), r = vert(R.x, R.z, c);
      rows.push([l, m, r]);
    }
    for (let k = 0; k < rows.length - 1; k++) {
      const a = rows[k], b = rows[k + 1];
      if (!a || !b) continue;
      // Wound to face up (seen from above, counterclockwise), so the lighting is not flipped.
      tri(a[0], a[1], b[0]); tri(a[1], b[1], b[0]);
      tri(a[1], a[2], b[1]); tri(a[2], b[2], b[1]);
    }
  }
  // A filled outline around a center (a fan).
  function fan(frame, cx, cz, n, radiusAt, c) {
    const C = mine(frame, cx, cz), m = vert(C.x, C.z, c), rim = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, r = radiusAt(a), Q = mine(frame, cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      rim.push(vert(Q.x, Q.z, c));
    }
    for (let k = 0; k < n; k++) tri(m, rim[(k + 1) % n], rim[k]);
  }
  // A flat box on the ground (a tee) and an upright quad (flag parts).
  function quad(frame, cx, cz, ux, uz, hl, hw, c) {
    const vx = -uz, vz = ux, q = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const Q = mine(frame, cx + ux * hl * a + vx * hw * b, cz + uz * hl * a + vz * hw * b); q.push(vert(Q.x, Q.z, c)); }
    tri(q[0], q[2], q[1]); tri(q[0], q[3], q[2]);
  }
  function upright(x0, y0, z0, x1, y1, z1, height, c) {
    // A vertical quad from (x0, z0) to (x1, z1), from y0 to y0 + height (y1 is the top edge's lift).
    const base = pos.length / 3;
    pos.push(x0, y0, z0, x1, y0 + y1, z1, x1, y0 + y1 + height, z1, x0, y0 + height, z0);
    for (let k = 0; k < 4; k++) { col.push(c.r, c.g, c.b); nor.push(0, 0, 1); blk.push(0); }
    if (!blocked(x0, z0)) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // --- trees: one cone-and-trunk geometry, instanced ---
  const treeMat = [], treeCol = [], treeHole = [];
  const crownA = new THREE.Color(look.crown), crownB = new THREE.Color(look.crown2);
  const density = clamp(th.trees.density, 0.05, 1.2);

  routing.holes.forEach((rh, k) => {
    if (k === index) return;
    const hole = getHole(course, k), frame = holeFrame(routing, k);
    const start = idx.length, treeStart = treeMat.length / 16;
    const rng = createRng((hole.seed ^ 0x2c1b3c6d) >>> 0);
    const total = hole.length;
    // Rough corridor, fairway, green, tees, bunkers, water, flag (painter's order).
    if (detail.rough) band(frame, hole, -6, total + hole.green.radius * 0.6, (i) => Math.max(hole.half[i], 9) + hole.roughBand, COL.rough);
    if (hole.hasFairway) band(frame, hole, hole.fwStart, hole.fwEnd, (i) => hole.half[i], COL.fairway);
    const g = hole.green;
    fan(frame, g.x, g.z, detail.ring, (a) => greenRadiusAt(g, g.x + Math.cos(a) * 30, g.z + Math.sin(a) * 30), COL.green);
    for (const t of hole.tees.slice(0, detail.tees)) quad(frame, t.x, t.z, t.tx, t.tz, t.l / 2, t.w / 2, COL.tee);
    for (const b of hole.bunkers) for (const c of b.blobs) fan(frame, c.x, c.z, detail.blob, () => c.r, COL.sand);
    for (const w of hole.water) {
      if (w.type === 'pond') for (const c of w.blobs) fan(frame, c.x, c.z, detail.ring, () => c.r, WATER);
      else if (w.type === 'stream') {
        const pts = w.pts;
        for (let i = 0; i < pts.length - 1; i += 2) {
          const a = pts[i], b = pts[Math.min(pts.length - 1, i + 2)], d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
          quad(frame, (a.x + b.x) / 2, (a.z + b.z) / 2, (b.x - a.x) / d, (b.z - a.z) / d, d / 2 + 0.5, w.half, WATER);
        }
      }
    }
    // The flag at the hole's pin: a pole and a cloth, a little larger than life so it reads.
    const pin = pinOf(hole), F = mine(frame, pin.x, pin.z), fx = F.x, fz = F.z, fy = ground(fx, fz) + LIFT;
    const wa = 0.4 + k, wx = Math.cos(wa), wz = Math.sin(wa);
    const white = new THREE.Color(0xf2f2e8), cloth = FLAG[k % 2];
    upright(fx - wz * 0.07, fy, fz + wx * 0.07, fx + wz * 0.07, 0, fz - wx * 0.07, 3.4, white);
    upright(fx - wx * 0.07, fy, fz - wz * 0.07, fx + wx * 0.07, 0, fz + wz * 0.07, 3.4, white);
    upright(fx, fy + 2.4, fz, fx + wx * 1.5, 0, fz + wz * 1.5, 0.95, cloth);

    // Trees along both sides of the corridor (the tree line), and a few behind the green.
    const nTrees = Math.round(detail.trees * density * (0.55 + total / 900));
    const edge = (i) => Math.max(hole.half[i], 8) + hole.roughBand + th.deepBand * 0.6;
    for (let t = 0; t < nTrees; t++) {
      let lx, lz;
      if (t < nTrees * 0.88) {
        const s = rng.range(0, total), i = clamp(Math.round(s / hole.lineStep), 0, hole.line.length - 1);
        const q = hole.line[i], r2 = hole.line[Math.min(hole.line.length - 1, i + 1)], r1 = hole.line[Math.max(0, i - 1)];
        const dx = r2.x - r1.x, dz = r2.z - r1.z, d = Math.hypot(dx, dz) || 1, side = rng.sign();
        const off = edge(i) + rng.range(0, th.trees.margin + 10);
        lx = q.x - (dz / d) * off * side; lz = q.z + (dx / d) * off * side;
      } else {
        const a = rng.range(0, Math.PI * 2), r = g.radius + rng.range(16, 34);
        lx = g.x + Math.cos(a) * r; lz = g.z + Math.sin(a) * r;
        // Not in front of the green (the approach).
        if (Math.cos(a) * -g.ax + Math.sin(a) * -g.az > 0.4) continue;
      }
      const T = mine(frame, lx, lz);
      if (blocked(T.x, T.z)) continue;
      const hgt = rng.range(look.h[0], look.h[1]);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(T.x, ground(T.x, T.z) - 0.2, T.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6.28)), new THREE.Vector3(hgt, hgt, hgt));
      treeMat.push(...m.elements);
      const c = crownA.clone().lerp(crownB, rng.next());
      treeCol.push(c.r, c.g, c.b);
      treeHole.push(k);
    }

    // The hole's bounding sphere, for the distance limit and the view test.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = start; i < idx.length; i++) {
      const v = idx[i] * 3;
      minX = Math.min(minX, pos[v]); maxX = Math.max(maxX, pos[v]); minY = Math.min(minY, pos[v + 1]); maxY = Math.max(maxY, pos[v + 1]); minZ = Math.min(minZ, pos[v + 2]); maxZ = Math.max(maxZ, pos[v + 2]);
    }
    for (let t = treeStart; t < treeMat.length / 16; t++) {
      const x = treeMat[t * 16 + 12], y = treeMat[t * 16 + 13], z = treeMat[t * 16 + 14], s = treeMat[t * 16 + 5];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y + s); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    if (!(minX < maxX)) return; // nothing of this hole is outside the current hole's ground
    const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    holes.push({ k, start, count: idx.length - start, treeStart, treeCount: treeMat.length / 16 - treeStart, sphere: new THREE.Sphere(center, radius) });
  });

  // --- the tree geometry: a cone over a trunk, colored per vertex (white crown, tinted per tree) ---
  const treeGeo = (() => {
    const crown = new THREE.ConeGeometry(look.r, 1 - look.trunk * 0.6, 6, 1, true);
    crown.translate(0, look.trunk * 0.6 + (1 - look.trunk * 0.6) / 2, 0);
    const trunk = new THREE.CylinderGeometry(0.035, 0.05, look.trunk, 3, 1, true);
    trunk.translate(0, look.trunk / 2, 0);
    const parts = [[crown, [1, 1, 1]], [trunk, [0.2, 0.15, 0.1]]];
    const p = [], n = [], c = [], ix = [];
    for (const [geo, rgb] of parts) {
      const base = p.length / 3, gp = geo.attributes.position.array, gn = geo.attributes.normal.array;
      for (let i = 0; i < gp.length; i += 3) {
        p.push(gp[i], gp[i + 1], gp[i + 2]); n.push(gn[i], gn[i + 1], gn[i + 2]);
        // The crown darkens toward its base (self shade); the trunk is dark brown.
        const k = rgb[0] === 1 ? 0.62 + 0.38 * clamp((gp[i + 1] - look.trunk * 0.6) / (1 - look.trunk * 0.6), 0, 1) : 1;
        c.push(rgb[0] * k, rgb[1] * k, rgb[2] * k);
      }
      for (const v of geo.index.array) ix.push(base + v);
      geo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geo.setIndex(ix);
    return geo;
  })();
  const treeTris = treeGeo.index.count / 3;

  // --- the budget: whatever is built fits it, so whatever is drawn does too ---
  // Trees go first from the farthest holes, then whole far holes, until it fits.
  const tee = { x: terrain.tee.x, z: terrain.tee.z };
  holes.sort((a, b) => a.sphere.center.distanceTo(new THREE.Vector3(tee.x, a.sphere.center.y, tee.z)) - b.sphere.center.distanceTo(new THREE.Vector3(tee.x, b.sphere.center.y, tee.z)));
  const trisOf = (list) => list.reduce((s, h) => s + h.count / 3 + h.treeCount * treeTris, 0);
  let dropped = 0;
  for (let i = holes.length - 1; i >= 0 && trisOf(holes) > budget.tris; i--) { if (holes[i].treeCount) { holes[i].treeCount = 0; dropped++; } }
  while (holes.length && trisOf(holes) > budget.tris) { holes.pop(); dropped++; }

  // --- the meshes ---
  const drapeGeo = new THREE.BufferGeometry();
  drapeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  drapeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  drapeGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const big = pos.length / 3 > 65535;
  const master = big ? new Uint32Array(idx) : new Uint16Array(idx);
  idx = null;
  const drawIdx = new THREE.BufferAttribute(big ? new Uint32Array(master.length) : new Uint16Array(master.length), 1);
  drawIdx.setUsage(THREE.DynamicDrawUsage);
  drapeGeo.setIndex(drawIdx);
  drapeGeo.setDrawRange(0, 0);
  drapeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms = { uFar: { value: detail.far }, uNear: { value: NEAR_HIDE } };
  const fade = (shader, instanced) => {
    shader.uniforms.uFar = uniforms.uFar; shader.uniforms.uNear = uniforms.uNear;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFar;\nuniform float uNear;\nvarying float vFade;')
      .replace('#include <begin_vertex>', instanced
        // Trees: shrink to nothing near the distance limit and right next to the camera.
        ? '#include <begin_vertex>\nvec3 sOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;\nfloat sD = distance(sOrigin, cameraPosition);\nvFade = (1.0 - smoothstep(uFar * 0.78, uFar, sD)) * smoothstep(uNear, uNear + 10.0, sD);\ntransformed *= vFade;'
        // The drape: fade out near the distance limit.
        : '#include <begin_vertex>\nfloat sD = distance((modelMatrix * vec4(transformed, 1.0)).xyz, cameraPosition);\nvFade = 1.0 - smoothstep(uFar * 0.72, uFar, sD);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <color_fragment>', instanced ? '#include <color_fragment>' : '#include <color_fragment>\ndiffuseColor.a *= vFade;\nif (diffuseColor.a < 0.004) discard;');
  };
  const drapeMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
  // One pass: three.js otherwise draws a transparent double-sided material twice (back faces,
  // then front faces), which would make the drape two draw calls.
  drapeMat.forceSinglePass = true;
  drapeMat.onBeforeCompile = (s) => fade(s, false);
  drapeMat.customProgramCacheKey = () => 'scenery-drape';
  const drape = new THREE.Mesh(drapeGeo, drapeMat);
  drape.name = 'scenery-drape';
  drape.frustumCulled = false; drape.castShadow = false; drape.receiveShadow = false; drape.matrixAutoUpdate = false;
  drape.renderOrder = 2;

  const maxTrees = holes.reduce((s, h) => s + h.treeCount, 0);
  const treeMatl = new THREE.MeshLambertMaterial({ vertexColors: true });
  treeMatl.onBeforeCompile = (s) => fade(s, true);
  treeMatl.customProgramCacheKey = () => 'scenery-trees';
  const trees = new THREE.InstancedMesh(treeGeo, treeMatl, Math.max(1, maxTrees));
  trees.name = 'scenery-trees';
  trees.count = 0; trees.frustumCulled = false; trees.castShadow = false; trees.receiveShadow = false; trees.matrixAutoUpdate = false;
  trees.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trees.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, maxTrees) * 3), 3);
  trees.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const treeMatArr = new Float32Array(treeMat), treeColArr = new Float32Array(treeCol);
  group.add(drape, trees);

  // --- per frame: which holes are near enough and in view ---
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  // '#' never matches a real set, so the first update always applies one.
  let lastKey = '#', visible = true, drawnTris = 0, drawnHoles = 0;
  drape.visible = false; trees.visible = false;
  function apply(set) {
    let n = 0, t = 0;
    for (const h of set) {
      drawIdx.array.set(master.subarray(h.start, h.start + h.count), n); n += h.count;
      if (h.treeCount) {
        trees.instanceMatrix.array.set(treeMatArr.subarray(h.treeStart * 16, (h.treeStart + h.treeCount) * 16), t * 16);
        trees.instanceColor.array.set(treeColArr.subarray(h.treeStart * 3, (h.treeStart + h.treeCount) * 3), t * 3);
        t += h.treeCount;
      }
    }
    drapeGeo.setDrawRange(0, n);
    drawIdx.clearUpdateRanges(); drawIdx.addUpdateRange(0, Math.max(1, n)); drawIdx.needsUpdate = true;
    trees.count = t;
    trees.instanceMatrix.clearUpdateRanges(); trees.instanceMatrix.addUpdateRange(0, Math.max(1, t * 16)); trees.instanceMatrix.needsUpdate = true;
    trees.instanceColor.clearUpdateRanges(); trees.instanceColor.addUpdateRange(0, Math.max(1, t * 3)); trees.instanceColor.needsUpdate = true;
    drape.visible = visible && n > 0;
    trees.visible = visible && t > 0;
    drawnTris = n / 3 + t * treeTris; drawnHoles = set.length;
  }
  const scenery = {
    group, meshes: [drape, trees], holes,
    // The camera decides what is drawn: within the distance limit and inside the view.
    update(camera) {
      if (!visible) return;
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      const set = [];
      let key = '';
      for (const h of holes) {
        if (camera.position.distanceTo(h.sphere.center) - h.sphere.radius > detail.far) continue;
        if (!frustum.intersectsSphere(h.sphere)) continue;
        set.push(h); key += h.k + ',';
      }
      if (key !== lastKey) { lastKey = key; apply(set); }
    },
    setVisible(on) {
      visible = !!on;
      if (!visible) { drape.visible = false; trees.visible = false; } else { lastKey = '#'; }
    },
    stats: () => ({ holes: holes.length, dropped, tris: Math.round(trisOf(holes)), drawnTris: Math.round(drawnTris), drawnHoles, trees: maxTrees, far: detail.far, budget: budget.tris, draws: 2 }),
    // Tests: how many drape triangles that can be drawn face down (none should: the lighting
    // would flip). Upright flag quads (no vertical normal) are not counted.
    facingDown: () => {
      const p = drapeGeo.attributes.position.array;
      let down = 0, flat = 0;
      for (const h of holes) for (let i = h.start; i < h.start + h.count; i += 3) {
        const a = master[i] * 3, b = master[i + 1] * 3, c = master[i + 2] * 3;
        const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vz = p[c + 2] - p[a + 2];
        const ny = uz * vx - ux * vz; // y of (b - a) x (c - a)
        if (Math.abs(ny) < 1e-6) continue;
        flat++;
        if (ny < 0) down++;
      }
      return { down, flat };
    },
    // Tests: every drape triangle corner and tree position that can be drawn, in this hole's frame.
    corners: () => {
      const p = drapeGeo.attributes.position.array, out = [];
      for (const h of holes) for (let i = h.start; i < h.start + h.count; i++) out.push([p[master[i] * 3], p[master[i] * 3 + 2]]);
      for (const h of holes) for (let t = h.treeStart; t < h.treeStart + h.treeCount; t++) out.push([treeMatArr[t * 16 + 12], treeMatArr[t * 16 + 14]]);
      return out;
    },
    dispose() {
      drapeGeo.dispose(); drapeMat.dispose(); treeGeo.dispose(); treeMatl.dispose(); trees.dispose();
      group.clear();
    },
  };
  return scenery;
}
