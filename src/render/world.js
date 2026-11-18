// World: the 3D scene for one hole. Owns the terrain view, lighting, sky, water, vegetation,
// and props, and exposes the terrain that the physics plays on.
import * as THREE from 'three';
import { todById } from './timeOfDay.js';
import { courseById } from '../course/courses.js';
import { getHole } from '../course/layout.js';
import { buildTerrain } from '../course/terrain.js';
import { createLighting } from './lighting.js';
import { createTerrainView, createSurfaceIdMaterial } from './terrainView.js';
import { MANIFEST } from './assets.js';
import { createGreenProps } from './greenProps.js';
import { createDecals } from './decals.js';
import { createSky } from './sky.js';
import { createWater } from './water.js';
import { createVegetation } from './vegetation.js';
import { createGrass } from './grass.js';
import { createProps } from './props.js';
import { createBallView } from './ballView.js';
import { createCameraRig } from './cameras.js';
import { createOverlays } from './overlays.js';
import { createClubView } from './clubView.js';
import { DEG, clamp } from '../core/math.js';
import { fin } from '../core/guards.js';

export function createWorld(engine, { courseId, todId, hole = 1, assets }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, engine.width / engine.height, 0.3, 14000);
  const lighting = createLighting(scene, camera, engine.tier);

  const world = {
    scene, camera, lighting, assets,
    courseId, todId, hole,
    course: null, holeData: null, terrain: null, terrainView: null,
    sunDir: new THREE.Vector3(0.3, 0.8, 0.4).normalize(),
    time: 0, ready: false, loading: null, buildMs: 0,
    systems: [], // { update(dt, t), dispose() } added by later stages
    baseFov: 55,
  };

  // Game wind as a steady vector (m/s). The game sets this; the flag, grass, trees, clouds,
  // and water all read it.
  world.wind = { x: 2.2, z: -0.8 };
  world.sky = createSky(world, engine);
  world.water = createWater(world, engine);
  scene.add(world.water.group);
  const waterGroup = world.water.group;
  world.waterGroup = waterGroup;
  world.vegetation = createVegetation(world, engine);
  scene.add(world.vegetation.group);
  world.grass = createGrass(world, engine);
  scene.add(world.grass.group);
  world.props = createProps(world, engine);
  scene.add(world.props.group);
  world.ball = createBallView(world, engine);
  scene.add(world.ball.group);
  world.ball.hide();
  world.overlays = createOverlays(world);
  scene.add(world.overlays.group);
  // The camera rig drives the camera while a round is in play. QA views switch it off.
  world.rig = createCameraRig(world, engine);
  world.rig.enabled = false;
  world.systems.push(world.sky, world.water, world.vegetation, world.grass, world.props, world.ball, world.overlays);
  world.greenProps = createGreenProps(world);
  scene.add(world.greenProps.group);
  world.decals = createDecals(world);
  scene.add(world.decals.group);
  world.systems.push(world.greenProps, world.decals);
  // The first-person club. The UI supplies what it should show through world.clubSource.
  world.club = createClubView(world);
  scene.add(world.club.group);
  world.systems.push({ update: (dt) => { if (world.clubSource) world.club.update(dt, world.clubSource()); }, dispose: () => world.club.dispose() });

  // --- time of day ---
  world.setTimeOfDay = (id) => {
    const tod = todById(id);
    world.todId = tod.id; world.tod = tod;
    const bearing = world.holeData ? world.holeData.bearing : 0;
    const el = tod.sunElev * DEG, az = (tod.sunAz - bearing) * DEG;
    world.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const sunCol = new THREE.Color(tod.sunColor[0], tod.sunColor[1], tod.sunColor[2]);
    lighting.setSun(world.sunDir, sunCol, tod.sunIntensity);
    const fogC = new THREE.Color(tod.fog.color[0], tod.fog.color[1], tod.fog.color[2]);
    // The environment map carries the sky light. The hemisphere light is only a small fill.
    lighting.setAmbient(fogC.clone().lerp(new THREE.Color(0.55, 0.7, 1.0), 0.5), new THREE.Color(0.32, 0.36, 0.2), tod.ambient * (tod.night ? 0.03 : 0.16));
    const p = engine.post.state;
    p.sunDir.copy(world.sunDir);
    p.fogColor.copy(fogC);
    p.fogDensity = tod.fog.density; p.fogHaze = tod.fog.haze; p.fogHeight = tod.fog.height; p.fogMax = tod.fog.max;
    p.fogBase = world.terrain ? world.terrain.heightAt(world.terrain.tee.x, world.terrain.tee.z) - 4 : 0;
    p.contrast = tod.grade.contrast; p.saturation = tod.grade.saturation;
    p.tint.setRGB(tod.grade.tint[0], tod.grade.tint[1], tod.grade.tint[2]);
    p.shaftStrength = tod.shafts * 0.3;
    p.shaftColor.copy(sunCol);
    // Heat shimmer over the desert floor in daylight.
    p.shimmer = world.courseId === 'desert' && !tod.night && tod.sunElev > 15 ? 1 : 0;
    engine.exposure.target = tod.targetLuma;
    engine.exposure.min = tod.exposure[0]; engine.exposure.max = tod.exposure[1];
    if (world.terrainView) world.terrainView.uniforms.uDew.value = tod.dew;
    for (const s of world.systems) if (s.setTimeOfDay) s.setTimeOfDay(tod, world);
  };

  // --- camera helpers ---
  world.resize = () => {
    camera.aspect = engine.width / engine.height;
    // Hold the horizontal field of view in portrait so the hole stays in frame.
    const base = world.baseFov;
    camera.fov = camera.aspect >= 1 ? base : Math.min(88, (2 * Math.atan((Math.tan((base * DEG) / 2) / Math.max(camera.aspect, 0.45)) * 0.72)) / DEG);
    camera.updateProjectionMatrix();
    lighting.resize();
  };

  // Stand behind a point and look along a heading. Used for the address view.
  world.placeAddressCamera = (x, z, heading, { back = 5.2, up = 2.1, lookAhead = 70 } = {}) => {
    const t = world.terrain;
    const fx = Math.sin(heading), fz = -Math.cos(heading);
    const cx = x - fx * back, cz = z - fz * back;
    const ground = Math.max(t.heightAt(cx, cz), t.heightAt(x, z) - 0.5);
    camera.position.set(cx, ground + up, cz);
    const lx = x + fx * lookAhead, lz = z + fz * lookAhead;
    camera.lookAt(lx, t.heightAt(x, z) + 0.9 + (t.heightAt(lx, lz) - t.heightAt(x, z)) * 0.5, lz);
    camera.updateMatrixWorld(true);
  };

  // --- hole loading ---
  world.loadHole = async (cId, holeNumber) => {
    const course = courseById(cId);
    const index = clamp(Math.round(fin(holeNumber, 1)) - 1, 0, 17);
    const t0 = performance.now();
    const holeData = getHole(course, index);
    const terrain = buildTerrain(course, holeData);
    world.buildMs = performance.now() - t0;
    if (world.terrainView) { scene.remove(world.terrainView.group); world.terrainView.dispose(); }
    for (const s of world.systems) if (s.unloadHole) s.unloadHole();
    world.course = course; world.courseId = course.id; world.hole = index + 1;
    world.holeData = holeData; world.terrain = terrain;
    world.terrainView = createTerrainView({ terrain, course, lighting, tier: engine.tier, assets, manifest: MANIFEST, engine });
    scene.add(world.terrainView.group);
    world.setTimeOfDay(world.todId);
    // Address view from the tee toward the first landing area or the green.
    const aimS = Math.min(holeData.length, holeData.par === 3 ? holeData.length : 235);
    const li = Math.min(holeData.line.length - 1, Math.round(aimS / holeData.lineStep));
    const aim = holeData.line[li];
    world.addressHeading = Math.atan2(aim.x - terrain.tee.x, -(aim.z - terrain.tee.z));
    world.placeAddressCamera(terrain.tee.x, terrain.tee.z, world.addressHeading);
    world.resize();
    world.terrainView.updateLod(camera, true);
    for (const s of world.systems) if (s.loadHole) await s.loadHole(world);
    world.ready = true;
    // Heavy textures arrive after first paint.
    world.loading = world.terrainView.loadTextures().then((ok) => {
      engine.textureBytes = world.terrainView.memoryBytes() + (assets ? assets.stats.gpuBytes : 0);
      return ok;
    });
    return world;
  };
  world.setCourse = (id, holeNumber = 1) => world.loadHole(id, holeNumber);
  // Resolves when lazily loaded assets for the current hole are on the GPU.
  world.whenSettled = async () => {
    if (world.loading) await world.loading;
    for (const s of world.systems) if (s.whenSettled) await s.whenSettled();
    if (world.terrainView && world.terrainView.ready) world.terrainView.setTextureMix(1);
  };

  world.update = (dt, t) => {
    world.time = t;
    if (world.terrainView) { world.terrainView.updateLod(camera); world.terrainView.update(dt); }
    for (const s of world.systems) if (s.update) s.update(dt, t, world);
    lighting.update();
  };

  // Named camera views for QA shots and contact sheets. Returns false if the hole has no such
  // feature (for example no water), so the caller can label the frame honestly.
  world.qaView = (name) => {
    world.rig.enabled = false;
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
    const t = world.terrain, h = world.holeData;
    const H = (x, z) => t.heightAt(x, z);
    const look = (px, py, pz, lx, ly, lz) => { camera.position.set(px, py, pz); camera.lookAt(lx, ly, lz); camera.updateMatrixWorld(true); world.terrainView.updateLod(camera, true); if (world.vegetation) world.vegetation.forceUpdate(); };
    const mid = h.line[Math.floor(h.line.length * 0.55)];
    const fwd = { x: Math.sin(world.addressHeading), z: -Math.cos(world.addressHeading) };
    if (name === 'address') { world.placeAddressCamera(t.tee.x, t.tee.z, world.addressHeading); world.terrainView.updateLod(camera, true); if (world.vegetation) world.vegetation.forceUpdate(); return true; }
    if (name === 'flyover') {
      const px = t.tee.x - fwd.x * 70, pz = t.tee.z - fwd.z * 70;
      look(px, H(t.tee.x, t.tee.z) + 58, pz, mid.x, H(mid.x, mid.z), mid.z);
      return true;
    }
    if (name === 'top') {
      const cx = (t.x0 + t.maxX) / 2, cz = (t.z0 + t.maxZ) / 2;
      camera.up.set(0, 0, -1);
      look(cx, H(cx, cz) + Math.max(t.maxZ - t.z0, (t.maxX - t.x0) * 1.9) * 0.62, cz + 0.01, cx, H(cx, cz), cz);
      camera.up.set(0, 1, 0);
      return true;
    }
    if (name === 'green') {
      const g = h.green;
      const px = g.x - g.ax * (g.radius + 16) + g.az * 5, pz = g.z - g.az * (g.radius + 16) - g.ax * 5;
      look(px, H(px, pz) + 2.4, pz, t.pin.x, H(t.pin.x, t.pin.z) + 0.6, t.pin.z);
      return true;
    }
    if (name === 'mountains') {
      // A telephoto look at the highest part of the backdrop, to inspect steep faces.
      let best = null;
      const oh = world.terrainView.outerHeightAt;
      if (!oh) return false;
      for (let a = 0; a < 6.283; a += 0.05) {
        const x = t.tee.x + Math.cos(a) * 1700, z = t.tee.z + Math.sin(a) * 1700, y = oh(x, z);
        if (!best || y > best.y) best = { x, y, z };
      }
      camera.fov = 22; camera.updateProjectionMatrix();
      look(t.tee.x, H(t.tee.x, t.tee.z) + 30, t.tee.z, best.x, best.y * 0.75, best.z);
      return true;
    }
    if (name === 'landing') {
      // Eye height in the tee-shot landing zone, looking down the fairway: old divots.
      const i = Math.min(h.line.length - 1, Math.round(230 / h.lineStep));
      const p = h.line[i], q = h.line[Math.min(h.line.length - 1, i + 6)];
      look(p.x, H(p.x, p.z) + 1.4, p.z, q.x, H(q.x, q.z), q.z);
      return true;
    }
    if (name === 'grass') {
      // Ball height in the landing zone at the edge of the fairway, looking across the first
      // cut into the rough: the near-camera blades at the distance a player sees them at address.
      const i = Math.min(h.line.length - 1, Math.round(230 / h.lineStep));
      const p = h.line[i], q = h.line[Math.min(h.line.length - 1, i + 1)];
      const dl = Math.hypot(q.x - p.x, q.z - p.z) || 1, nx = -(q.z - p.z) / dl, nz = (q.x - p.x) / dl;
      let edge = 0;
      for (let d = 2; d < 60; d += 0.5) { const s = t.surfaceAt(p.x + nx * d, p.z + nz * d); if (s === 0 || s === 1 || s === 2) { edge = d; break; } }
      if (!edge) return false;
      const ex = p.x + nx * edge, ez = p.z + nz * edge, bx = ex - nx * 3, bz = ez - nz * 3;
      look(bx - (q.x - p.x) / dl * 1.2, H(bx, bz) + 1.2, bz - (q.z - p.z) / dl * 1.2, ex + nx * 2, H(ex, ez), ez + nz * 2);
      return true;
    }
    if (name === 'greenclose') {
      // Standing on the green 4 m from the pin: grain, collar, and ball marks at putting range.
      const g = h.green;
      const px = t.pin.x - g.ax * 4 + g.az * 1.5, pz = t.pin.z - g.az * 4 - g.ax * 1.5;
      look(px, H(px, pz) + 1.55, pz, t.pin.x + g.ax * 2, H(t.pin.x, t.pin.z), t.pin.z + g.az * 2);
      return true;
    }
    if (name === 'bunker') {
      const b = h.bunkers[0];
      if (!b) return false;
      const c = b.blobs[0];
      // From the short grass between the bunker and the centerline (nothing grows there).
      let near = h.line[0], nd = 1e9;
      for (const p of h.line) { const d = Math.hypot(p.x - c.x, p.z - c.z); if (d < nd) { nd = d; near = p; } }
      const ux = (near.x - c.x) / (nd || 1), uz = (near.z - c.z) / (nd || 1);
      const px = c.x + ux * (c.r + 7), pz = c.z + uz * (c.r + 7);
      look(px, H(px, pz) + 2.0, pz, c.x, H(c.x, c.z) + 0.2, c.z);
      return true;
    }
    if (name === 'bunkermid' || name === 'bunkertop') {
      // The same bunker from 30 m back on the tee side, and from above at a steep angle.
      const b = h.bunkers[0];
      if (!b) return false;
      const c = b.blobs[0];
      const fl = Math.hypot(b.faceX, b.faceZ) || 1, dx = b.faceX / fl, dz = b.faceZ / fl, l = 1;
      if (name === 'bunkermid') {
        // On the centerline about 30 m back toward the tee, as a player approaching it.
        let ni = 0, nd = 1e9;
        h.line.forEach((p, i) => { const d = Math.hypot(p.x - c.x, p.z - c.z); if (d < nd) { nd = d; ni = i; } });
        let j = ni;
        while (j > 0 && Math.hypot(h.line[j].x - c.x, h.line[j].z - c.z) < c.r + 28) j--;
        const p = h.line[j];
        look(p.x, Math.max(H(p.x, p.z), H(c.x, c.z)) + 3.5, p.z, c.x, H(c.x, c.z), c.z);
      } else {
        const px = c.x - (dx / l) * (c.r * 0.8 + 3), pz = c.z - (dz / l) * (c.r * 0.8 + 3);
        look(px, H(c.x, c.z) + c.r * 1.5 + 9, pz, c.x, H(c.x, c.z), c.z);
      }
      return true;
    }
    if (name.startsWith('species:')) {
      // The nearest plant of a species to the middle of the hole, framed from 2.5 heights away.
      const v = world.vegetation && world.vegetation.nearest ? world.vegetation.nearest(name.slice(8), mid.x, mid.z) : null;
      if (!v) return false;
      const dist = Math.max(2.5, v.height * 1.6), ang = Math.atan2(mid.z - v.z, mid.x - v.x);
      const px = v.x + Math.cos(ang) * dist, pz = v.z + Math.sin(ang) * dist;
      look(px, H(px, pz) + Math.max(1.2, v.height * 0.45), pz, v.x, v.y + v.height * 0.45, v.z);
      return true;
    }
    if (name === 'tee') {
      // The tee box from the side: markers, the mown tee, and the hole beyond.
      const lat = { x: -fwd.z, z: fwd.x };
      const px = t.tee.x + lat.x * 7 - fwd.x * 4, pz = t.tee.z + lat.z * 7 - fwd.z * 4;
      look(px, H(px, pz) + 1.6, pz, t.tee.x + fwd.x * 6, H(t.tee.x, t.tee.z) + 0.3, t.tee.z + fwd.z * 6);
      return true;
    }
    if (name === 'water') {
      const w = t.bodies.find((b) => b.type !== 'sea');
      if (w) {
        const cx = (w.minX + w.maxX) / 2, cz = (w.minZ + w.maxZ) / 2;
        const dx = t.tee.x - cx, dz = t.tee.z - cz, l = Math.hypot(dx, dz) || 1;
        const r = Math.max(w.maxX - w.minX, w.maxZ - w.minZ) / 2;
        const px = cx + (dx / l) * (r + 10), pz = cz + (dz / l) * (r + 10);
        look(px, Math.max(H(px, pz), w.level) + 3.2, pz, cx, w.level, cz);
        return true;
      }
      if (h.sea) {
        const lat = { x: -fwd.z * h.sea.side, z: fwd.x * h.sea.side };
        const px = mid.x + lat.x * (h.sea.offset - 18), pz = mid.z + lat.z * (h.sea.offset - 18);
        look(px, H(px, pz) + 3.0, pz, px + lat.x * 80 + fwd.x * 60, 0.5, pz + lat.z * 80 + fwd.z * 60);
        return true;
      }
      return false;
    }
    if (name === 'treeline') {
      const side = -h.path.side;
      const lat = { x: -fwd.z * side, z: fwd.x * side };
      look(mid.x - lat.x * 6, H(mid.x, mid.z) + 1.9, mid.z - lat.z * 6, mid.x + lat.x * 60 + fwd.x * 30, H(mid.x, mid.z) + 6, mid.z + lat.z * 60 + fwd.z * 30);
      return true;
    }
    if (name === 'rough') {
      const i = Math.floor(h.line.length * 0.4);
      const p = h.line[i];
      const side = -h.path.side;
      const lat = { x: -fwd.z * side, z: fwd.x * side };
      const off = (h.half[i] || 10) + 6;
      const px = p.x + lat.x * off, pz = p.z + lat.z * off;
      look(px - fwd.x * 3, H(px, pz) + 0.75, pz - fwd.z * 3, px + fwd.x * 14, H(px, pz) + 0.25, pz + fwd.z * 14);
      return true;
    }
    if (name === 'fairway') {
      const i = Math.floor(h.line.length * 0.5);
      const p = h.line[i], q = h.line[Math.min(h.line.length - 1, i + 20)];
      look(p.x, H(p.x, p.z) + 1.7, p.z, q.x, H(q.x, q.z) + 0.6, q.z);
      return true;
    }
    return false;
  };

  // QA: is the image-based lighting really rotated to the game sun? Render a mirror ball lit
  // only by the environment, find the brightest reflection, and compare its direction with
  // the sun direction the rest of the scene uses.
  world.envSunCheck = () => {
    const size = 160;
    const probe = new THREE.Scene();
    probe.environment = scene.environment;
    probe.environmentRotation.copy(scene.environmentRotation);
    probe.environmentIntensity = 1;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0 }));
    probe.add(ball);
    // Look along the horizontal direction away from the sun so the sun reflects near the center.
    const s = world.sunDir;
    const hx = s.x, hz = s.z, hl = Math.hypot(hx, hz) || 1;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    cam.position.set((hx / hl) * 3, 0, (hz / hl) * 3);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, depthBuffer: true });
    engine.renderer.setRenderTarget(rt);
    engine.renderer.setClearColor(0x000000, 1);
    engine.renderer.clear();
    engine.renderer.render(probe, cam);
    const buf = new Float32Array(size * size * 4);
    engine.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    engine.renderer.setRenderTarget(null);
    // Luminance-weighted centroid of the brightest reflections.
    let max = 0;
    for (let i = 0; i < buf.length; i += 4) max = Math.max(max, buf[i] + buf[i + 1] + buf[i + 2]);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const view = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate();
    const acc = new THREE.Vector3(), n = new THREE.Vector3(), r = new THREE.Vector3();
    let wsum = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const l = buf[i] + buf[i + 1] + buf[i + 2];
      if (l < max * 0.5) continue;
      const u = ((x + 0.5) / size) * 2 - 1, v = ((y + 0.5) / size) * 2 - 1;
      const d2 = u * u + v * v;
      if (d2 > 0.96) continue;
      // Sphere normal at this pixel, then the mirror direction for the view ray.
      n.copy(right).multiplyScalar(u).addScaledVector(upv, v).addScaledVector(view, -Math.sqrt(1 - d2));
      r.copy(view).addScaledVector(n, -2 * view.dot(n));
      acc.addScaledVector(r, l); wsum += l;
    }
    rt.dispose(); ball.geometry.dispose(); ball.material.dispose();
    if (!wsum) return { ok: false, reason: 'no bright reflection found', source: world.sky.envSource };
    acc.normalize();
    const azOf = (v3) => (Math.atan2(v3.x, -v3.z) * 180) / Math.PI;
    let dAz = azOf(acc) - azOf(s);
    dAz = ((dAz + 540) % 360) - 180;
    return {
      ok: true, source: world.sky.envSource, hasSun: world.sky.hdriInfo ? world.sky.hdriInfo.hasSun : null,
      angleDeg: (Math.acos(clamp(acc.dot(s), -1, 1)) * 180) / Math.PI, azimuthErrorDeg: dAz,
      sunElevDeg: (Math.asin(s.y) * 180) / Math.PI, brightElevDeg: (Math.asin(acc.y) * 180) / Math.PI,
    };
  };

  // QA: render the terrain top-down with flat surface ids and compare against the physics.
  world.surfaceAgreement = (samples = 96) => {
    const t = world.terrain, v = world.terrainView;
    const mat = createSurfaceIdMaterial(v.tex, v.uniforms.uGrid.value);
    const size = 512;
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const hole2 = world.holeData;
    // A window centered on the green, then one on the landing zone.
    const windows = [{ x: hole2.green.x, z: hole2.green.z, r: 42 }, { x: t.tee.x, z: t.tee.z, r: 30 }];
    const mid = hole2.line[Math.floor(hole2.line.length / 2)];
    windows.push({ x: mid.x, z: mid.z, r: 60 });
    let total = 0, agree = 0, heightErr = 0, heightN = 0;
    const saved = { waterVisible: waterGroup.visible };
    waterGroup.visible = false;
    const prevOverride = scene.overrideMaterial;
    const hidden = [];
    scene.traverse((o) => { if (o.isMesh && !o.userData.terrain && o.visible) { o.visible = false; hidden.push(o); } });
    v.outer.visible = false;
    // LOD0 everywhere inside the window so heights are exact.
    scene.overrideMaterial = mat;
    const buf = new Uint8Array(size * size * 4);
    for (const w of windows) {
      const cam = new THREE.OrthographicCamera(-w.r, w.r, w.r, -w.r, 1, 4000);
      cam.position.set(w.x, 2000, w.z);
      cam.up.set(0, 0, -1);
      cam.lookAt(w.x, 0, w.z);
      cam.updateMatrixWorld(true);
      engine.renderer.setRenderTarget(rt);
      engine.renderer.setClearColor(0x000000, 1);
      engine.renderer.clear();
      engine.renderer.render(scene, cam);
      engine.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      for (let j = 0; j < samples; j++) for (let i = 0; i < samples; i++) {
        const px = Math.floor(((i + 0.5) / samples) * size), py = Math.floor(((j + 0.5) / samples) * size);
        // Pixel center to world: x grows right, z grows down the image (up vector is -Z).
        const wx = w.x - w.r + ((px + 0.5) / size) * 2 * w.r;
        const wz = w.z + w.r - ((py + 0.5) / size) * 2 * w.r;
        if (!t.inBounds(wx, wz, 2)) continue;
        const id = buf[(py * size + px) * 4];
        total++;
        if (id === t.groundSurfaceAt(wx, wz)) agree++;
      }
    }
    scene.overrideMaterial = prevOverride;
    for (const o of hidden) o.visible = true;
    v.outer.visible = true;
    waterGroup.visible = saved.waterVisible;
    engine.renderer.setRenderTarget(null);
    // Height: every vertex of the nearest chunk meshes against terrain.heightAt.
    for (const c of v.chunks) {
      const g = c.mesh.geometry, pos = g.attributes.position;
      if (!pos) continue;
      const stride = Math.max(1, Math.floor(pos.count / 400));
      for (let i = 0; i < pos.count; i += stride) {
        const hy = t.heightAt(pos.getX(i), pos.getZ(i));
        const dy = Math.abs(hy - pos.getY(i));
        // Skirt vertices sit deliberately below the surface. Skip them.
        if (dy > 0.3) continue;
        heightErr = Math.max(heightErr, dy); heightN++;
      }
    }
    rt.dispose(); mat.dispose();
    return { samples: total, agree, agreePct: total ? (agree / total) * 100 : 0, maxHeightError: heightErr, heightSamples: heightN };
  };

  const onRestore = () => { if (world.sky && world.sky.restore) world.sky.restore(); };
  engine.listeners.restore.add(onRestore);

  world.dispose = () => {
    if (world.terrainView) world.terrainView.dispose();
    for (const s of world.systems) if (s.dispose) s.dispose();
    lighting.dispose();
    engine.listeners.restore.delete(onRestore);
    scene.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  };

  world.todId = todId;
  return world;
}
