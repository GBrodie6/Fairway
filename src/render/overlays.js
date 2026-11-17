// Aim and putting overlays drawn in the world: the aim line, the landing zone ring sized by
// dispersion, the putt line preview, and the green-reading grid with slope arrows.
// Colors are chosen from colorblind-safe palettes (Okabe-Ito for states, a blue-to-yellow
// sequential ramp for slope), and every state that color carries is also given in words in
// the HUD.
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { fin } from '../core/guards.js';
import { SURFACES } from '../physics/surfaces.js';

export const PALETTES = {
  off: { ok: 0xffffff, warn: 0xe69f00, line: 0xffffff, lo: [0.0, 0.27, 0.55], mid: [0.48, 0.48, 0.47], hi: [1.0, 0.86, 0.2] },
  deuteranopia: { ok: 0xffffff, warn: 0xe69f00, line: 0xffffff, lo: [0.0, 0.27, 0.55], mid: [0.48, 0.48, 0.47], hi: [1.0, 0.86, 0.2] },
  protanopia: { ok: 0xffffff, warn: 0xf0e442, line: 0xffffff, lo: [0.0, 0.27, 0.55], mid: [0.48, 0.48, 0.47], hi: [1.0, 0.86, 0.2] },
  tritanopia: { ok: 0xffffff, warn: 0xd55e00, line: 0xffffff, lo: [0.1, 0.1, 0.12], mid: [0.55, 0.2, 0.45], hi: [1.0, 0.75, 0.55] },
};

const MAX_LINE = 160;
function ribbon(maxPts, color, opacity) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(maxPts * 2 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < maxPts - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  geo.setIndex(idx);
  geo.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 4;
  // pts: flat [x,z,...] laid on the terrain, or [x,y,z,...] when y is given.
  mesh.setPath = (terrain, pts, width, stride = 2, lift = 0.05) => {
    const n = Math.min(maxPts, Math.floor(pts.length / stride));
    for (let i = 0; i < n; i++) {
      const x = pts[i * stride], z = pts[i * stride + stride - 1];
      const j = Math.min(n - 1, i + 1), k = Math.max(0, i - 1);
      let dx = pts[j * stride] - pts[k * stride], dz = pts[j * stride + stride - 1] - pts[k * stride + stride - 1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const y = (stride === 3 ? pts[i * 3 + 1] : terrain.heightAt(x, z)) + lift;
      pos[i * 6] = x - dz * width; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z + dx * width;
      pos[i * 6 + 3] = x + dz * width; pos[i * 6 + 4] = y; pos[i * 6 + 5] = z - dx * width;
    }
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
  };
  return mesh;
}

export function createOverlays(world) {
  const group = new THREE.Group();
  group.name = 'overlays';
  let palette = PALETTES.off;
  const aimLine = ribbon(MAX_LINE, 0xffffff, 0.5);
  const puttLine = ribbon(MAX_LINE, 0xffffff, 0.85);
  // Landing ring: a unit ring scaled into an ellipse (lateral by depth).
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 56).rotateX(-Math.PI / 2), ringMat);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
  ring.add(fill);
  ring.renderOrder = 4; ring.visible = false;
  group.add(aimLine, puttLine, ring);

  // Green grid: lines and arrows in one mesh each, colored per vertex by slope.
  const gridMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
    uniforms: { uT: { value: 0 }, uOpacity: { value: 0.8 } },
    vertexShader: 'attribute vec3 color; attribute float aFlow; varying vec3 vC; varying float vF; void main(){ vC = color; vF = aFlow; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // Arrows carry a pulse that runs downhill, so direction reads without relying on color.
    fragmentShader: 'uniform float uT; uniform float uOpacity; varying vec3 vC; varying float vF; void main(){ float pulse = vF < -0.5 ? 1.0 : 0.55 + 0.45 * sin((vF - uT * 0.9) * 6.2832); gl_FragColor = vec4(vC * 1.6, uOpacity * pulse); }',
  });
  let grid = null;
  const slopeColor = (s, out) => {
    // 0 to 6 percent maps across the ramp.
    const k = clamp(s / 0.06, 0, 1);
    const a = k < 0.5 ? palette.lo : palette.mid, b = k < 0.5 ? palette.mid : palette.hi, f = k < 0.5 ? k * 2 : (k - 0.5) * 2;
    out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f;
  };

  function buildGrid() {
    if (grid) { group.remove(grid); grid.geometry.dispose(); grid = null; }
    const t = world.terrain, g = t.hole.green;
    const R = g.maxR + 3;
    const pos = [], col = [], flow = [], idx = [];
    const c = [0, 0, 0], n = {};
    const quad = (ax, az, bx, bz, w, fa, fb) => {
      let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const base = pos.length / 3;
      const ya = t.heightAt(ax, az) + 0.035, yb = t.heightAt(bx, bz) + 0.035;
      pos.push(ax - dz * w, ya, az + dx * w, ax + dz * w, ya, az - dx * w, bx - dz * w, yb, bz + dx * w, bx + dz * w, yb, bz - dx * w);
      for (let i = 0; i < 4; i++) col.push(c[0], c[1], c[2]);
      flow.push(fa, fa, fb, fb);
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    const x0 = Math.floor(g.x - R), z0 = Math.floor(g.z - R), N = Math.ceil(R * 2);
    const onGreen = (x, z) => t.maskAt('fringe', x, z) >= 0.5;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = x0 + i, z = z0 + j;
      if (!onGreen(x, z)) continue;
      t.normalAt(x + 0.5, z + 0.5, n);
      const sl = Math.hypot(n.x, n.z) / n.y;
      slopeColor(sl, c);
      if (onGreen(x + 1, z)) quad(x, z, x + 1, z, 0.012, -1, -1);
      if (onGreen(x, z + 1)) quad(x, z, x, z + 1, 0.012, -1, -1);
      // Downhill arrow in the cell center, longer on steeper ground.
      if (sl > 0.004 && onGreen(x + 0.5, z + 0.5)) {
        const dl = Math.hypot(n.x, n.z) || 1, dx = n.x / dl, dz = n.z / dl;
        const len = clamp(0.16 + sl * 6, 0.16, 0.44);
        const cx = x + 0.5, cz = z + 0.5;
        const base = pos.length / 3;
        const tipx = cx + dx * len, tipz = cz + dz * len, bx = cx - dx * len, bz = cz - dz * len;
        const w = 0.085;
        pos.push(tipx, t.heightAt(tipx, tipz) + 0.04, tipz, bx - dz * w, t.heightAt(bx, bz) + 0.04, bz + dx * w, bx + dz * w, t.heightAt(bx, bz) + 0.04, bz - dx * w);
        for (let q = 0; q < 3; q++) col.push(c[0], c[1], c[2]);
        const ph = (cx * 0.37 + cz * 0.23) % 1;
        flow.push(ph + 1, ph, ph);
        idx.push(base, base + 1, base + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 1));
    geo.setIndex(idx);
    grid = new THREE.Mesh(geo, gridMat);
    grid.frustumCulled = false; grid.renderOrder = 3; grid.visible = false;
    group.add(grid);
    ov.gridTriangles = idx.length / 3;
  }

  const ov = {
    group, gridTriangles: 0, hazard: null,
    setPalette(id) { palette = PALETTES[id] || PALETTES.off; if (grid) buildGrid(); },
    loadHole() { buildGrid(); ov.hide(); },
    hide() { aimLine.visible = false; puttLine.visible = false; ring.visible = false; if (grid) grid.visible = false; },
    /**
     * Full-shot aim: a line from the ball to the predicted landing point and a ring whose
     * size is the one-sigma dispersion (lateral degrees and distance fraction).
     */
    showAim({ from, aim, prediction, disp }) {
      const t = world.terrain;
      puttLine.visible = false; if (grid) grid.visible = false;
      const land = prediction.carryPoint || prediction.end;
      const dist = Math.hypot(land.x - from.x, land.z - from.z);
      const n = clamp(Math.ceil(dist / 5), 2, MAX_LINE);
      const pts = [];
      for (let i = 0; i < n; i++) { const f = i / (n - 1); pts.push(from.x + (land.x - from.x) * f, from.z + (land.z - from.z) * f); }
      aimLine.setPath(t, pts, 0.07 + dist * 0.0009);
      aimLine.visible = true;
      // Ring: lateral radius from the angle spread at this distance, depth from the distance spread.
      const lat = Math.max(1.2, Math.tan((disp.lateralDeg * Math.PI) / 180) * dist), dep = Math.max(1.5, disp.distFrac * dist * 1.6);
      const y = t.inBounds(land.x, land.z, 1) ? t.heightAt(land.x, land.z) : land.y || 0;
      ring.position.set(fin(land.x), y + 0.06, fin(land.z));
      ring.rotation.y = -aim;
      ring.scale.set(lat, 1, dep);
      ring.visible = true;
      // Hazard check on where the ball is predicted to land and to finish.
      const landS = t.inBounds(land.x, land.z, 1) ? t.surfaceAt(land.x, land.z) : -1;
      ov.hazard = prediction.water || landS === SURFACES.WATER ? 'water' : prediction.oob || landS === -1 ? 'out of bounds' : landS === SURFACES.BUNKER || prediction.lie === SURFACES.BUNKER ? 'bunker' : null;
      const colr = ov.hazard ? palette.warn : palette.ok;
      ringMat.color.setHex(colr); fill.material.color.setHex(colr);
    },
    // Putting: the grid, and the predicted roll for the current aim and pace.
    showPutt({ path }) {
      aimLine.visible = false; ring.visible = false; ov.hazard = null;
      if (grid) grid.visible = true;
      if (path && path.length >= 8) {
        const pts = [];
        const step = Math.max(4, Math.floor(path.length / 4 / (MAX_LINE - 1)) * 4);
        for (let i = 0; i < path.length; i += step) pts.push(path[i + 1], path[i + 2] - 0.021, path[i + 3]);
        const e = path.length - 4;
        pts.push(path[e + 1], path[e + 2] - 0.021, path[e + 3]);
        puttLine.setPath(world.terrain, pts, 0.022, 3, 0.03);
        puttLine.visible = true;
      } else puttLine.visible = false;
    },
    setGridVisible(v) { if (grid) grid.visible = !!v; },
    update(dt, t) { gridMat.uniforms.uT.value = fin(t, 0) % 1000; },
    dispose() { if (grid) grid.geometry.dispose(); gridMat.dispose(); aimLine.geometry.dispose(); puttLine.geometry.dispose(); ring.geometry.dispose(); },
  };
  return ov;
}
