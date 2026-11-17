// The ball and everything that presents a shot: a PBR ball with a dimple normal map, a soft
// contact shadow, the glowing tracer with apex and landing markers, impact particles, and an
// optional spin stripe. All positions come from the precomputed physics path.
import * as THREE from 'three';
import { BALL_RADIUS } from '../physics/ball.js';
import { SURFACES } from '../physics/surfaces.js';
import { fin, safeRadialGradient } from '../core/guards.js';
import { clamp } from '../core/math.js';

// Dimple normal map painted on a canvas: staggered rows of shallow dents.
function dimpleNormalMap() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S), d = img.data;
  const cols = 16, rows = 18, r = S / cols * 0.42;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = Math.floor((y / S) * rows);
    const cx = ((Math.floor((x / S) * cols - (row % 2) * 0.5) + 0.5 + (row % 2) * 0.5) / cols) * S, cy = ((row + 0.5) / rows) * S;
    let dx = x - cx; if (dx > S / 2) dx -= S; if (dx < -S / 2) dx += S;
    const dy = y - cy, dist = Math.hypot(dx, dy);
    if (dist < r) {
      const k = (dist / r), slope = Math.sin(k * Math.PI) * 0.55;
      const i = (y * S + x) * 4;
      d[i] = 128 + (dx / (dist || 1)) * slope * 127; d[i + 1] = 128 + (dy / (dist || 1)) * slope * 127;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); t.anisotropy = 4;
  return t;
}
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = safeRadialGradient(g, 32, 32, 1, 32, 32, 31, [[0, 'rgba(0,0,0,0.75)'], [0.45, 'rgba(0,0,0,0.42)'], [1, 'rgba(0,0,0,0)']]);
  if (gr) { g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
  return new THREE.CanvasTexture(c);
}

const MAX_TRACE = 420, MAX_PARTICLES = 220;
const PART_COLORS = { grass: [0.12, 0.3, 0.06], sand: [0.78, 0.68, 0.48], dirt: [0.3, 0.2, 0.12], water: [0.8, 0.9, 1.0] };

export function createBallView(world, engine) {
  const { lighting, scene } = world;
  const group = new THREE.Group();
  group.name = 'ball';
  const normalMap = dimpleNormalMap();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0, normalMap, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 0.9 });
  lighting.setup(mat, [], 'ball');
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 20), mat);
  ball.castShadow = true;
  group.add(ball);
  // Spin stripe: a thin colored band, shown only when the option is on.
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS * 1.005, BALL_RADIUS * 0.06, 6, 32), new THREE.MeshBasicMaterial({ color: 0xe8553d }));
  stripe.visible = false;
  ball.add(stripe);
  // Contact shadow: a soft blob on the ground under the ball, sharper as the ball nears it.
  const blobTex = blobTexture();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  blob.renderOrder = 3;
  group.add(blob);

  // Tracer: a camera-facing ribbon along the flown path, bright enough to bloom a little.
  const tracePos = new Float32Array(MAX_TRACE * 2 * 3), traceAlpha = new Float32Array(MAX_TRACE * 2);
  const traceGeo = new THREE.BufferGeometry();
  traceGeo.setAttribute('position', new THREE.BufferAttribute(tracePos, 3).setUsage(THREE.DynamicDrawUsage));
  traceGeo.setAttribute('aAlpha', new THREE.BufferAttribute(traceAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < MAX_TRACE - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  traceGeo.setIndex(idx);
  traceGeo.setDrawRange(0, 0);
  const traceMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(1.0, 0.92, 0.7) }, uGain: { value: 1.6 } },
    vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uGain; varying float vA; void main(){ gl_FragColor = vec4(uColor * uGain * vA, vA); }',
  });
  const tracer = new THREE.Mesh(traceGeo, traceMat);
  tracer.frustumCulled = false; tracer.renderOrder = 5;
  group.add(tracer);
  // Apex and landing markers.
  const ringGeo = new THREE.RingGeometry(0.72, 1, 40).rotateX(-Math.PI / 2);
  const markMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const landMark = new THREE.Mesh(ringGeo, markMat);
  landMark.visible = false; landMark.renderOrder = 4;
  const apexMark = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
  apexMark.visible = false;
  group.add(landMark, apexMark);

  // Particles: pooled camera-facing quads, simulated on the CPU.
  const pGeo = new THREE.InstancedBufferGeometry();
  pGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  pGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const pPos = new Float32Array(MAX_PARTICLES * 4), pCol = new Float32Array(MAX_PARTICLES * 4);
  pGeo.setAttribute('aP', new THREE.InstancedBufferAttribute(pPos, 4).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aC', new THREE.InstancedBufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage));
  pGeo.instanceCount = 0;
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uSun: { value: lighting.sunRadiance } },
    vertexShader: 'attribute vec4 aP; attribute vec4 aC; varying vec4 vC; varying vec2 vU; void main(){ vC = aC; vU = position.xy; vec4 mv = viewMatrix * vec4(aP.xyz, 1.0); mv.xy += position.xy * aP.w; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uSun; varying vec4 vC; varying vec2 vU; void main(){ float d = length(vU) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC.rgb * (0.25 + 0.2 * uSun), vC.a * (1.0 - d * d)); }',
  });
  const particles = new THREE.Mesh(pGeo, pMat);
  particles.frustumCulled = false; particles.renderOrder = 6;
  group.add(particles);
  const pool = [];

  const cam = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
  const view = {
    group, ball, position: ball.position, tracePoints: [], traceCount: 0, visualScale: 1, spin: { axis: new THREE.Vector3(1, 0, 0), rate: 0 }, shake: 0,
    setColor(hex) { mat.color.set(hex); },
    setSpinViz(v) { stripe.visible = !!v; },
    place(x, y, z) { ball.position.set(fin(x), fin(y), fin(z)); ball.visible = true; },
    hide() { ball.visible = false; blob.visible = false; },
    // Tracer control. The controller appends points as the ball flies.
    clearTrace() { view.tracePoints.length = 0; traceGeo.setDrawRange(0, 0); landMark.visible = false; apexMark.visible = false; },
    addTrace(x, y, z) {
      const tp = view.tracePoints;
      if (tp.length >= MAX_TRACE * 3) return;
      const n = tp.length;
      if (n >= 3 && Math.hypot(x - tp[n - 3], y - tp[n - 2], z - tp[n - 1]) < 0.35) return;
      tp.push(x, y, z);
    },
    showLanding(x, y, z, radius = 1.6) { landMark.position.set(x, y + 0.03, z); landMark.scale.setScalar(radius); landMark.visible = true; },
    showApex(x, y, z) { apexMark.position.set(x, y, z); apexMark.visible = true; },
    hideMarkers() { landMark.visible = false; apexMark.visible = false; },
    // Burst of debris: kind is grass, sand, dirt, or water.
    burst(kind, x, y, z, { count = 18, speed = 3, up = 3.5, dirX = 0, dirZ = 0, size = 0.035 } = {}) {
      const c = PART_COLORS[kind] || PART_COLORS.grass;
      for (let i = 0; i < count && pool.length < MAX_PARTICLES; i++) {
        const a = Math.random() * 6.283, s = speed * (0.3 + Math.random() * 0.8);
        pool.push({ x, y: y + 0.02, z, vx: Math.cos(a) * s + dirX * speed * 0.8, vy: up * (0.4 + Math.random() * 0.9), vz: Math.sin(a) * s + dirZ * speed * 0.8, life: 0, max: 0.5 + Math.random() * 0.7, size: size * (0.6 + Math.random() * 0.9) * (kind === 'water' ? 1.6 : 1), r: c[0] * (0.7 + Math.random() * 0.6), g: c[1] * (0.7 + Math.random() * 0.6), b: c[2] * (0.7 + Math.random() * 0.6), drag: kind === 'water' ? 0.6 : 1.6 });
      }
    },
    burstFor(surface, x, y, z, opts) {
      const kind = surface === SURFACES.BUNKER || surface === SURFACES.WASTE ? 'sand' : surface === SURFACES.WATER ? 'water' : surface === SURFACES.DIRT || surface === SURFACES.PATH ? 'dirt' : 'grass';
      view.burst(kind, x, y, z, opts);
    },
    update(dt, t, w) {
      const camera = w.camera, terr = w.terrain;
      cam.setFromMatrixPosition(camera.matrixWorld);
      const b = ball.position;
      // Readability: grow the ball slightly with distance so it never drops below about 3 pixels.
      const dist = cam.distanceTo(b);
      const px = (BALL_RADIUS * 2 * engine.height) / (2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(dist, 0.1));
      view.visualScale = clamp(3.2 / Math.max(px, 0.01), 1, 14);
      ball.scale.setScalar(view.visualScale);
      if (view.spin.rate && ball.visible) ball.rotateOnWorldAxis(view.spin.axis, view.spin.rate * dt);
      // Contact shadow under the ball.
      if (ball.visible && terr) {
        const gy = terr.heightAt(b.x, b.z);
        const h = Math.max(0, b.y - gy - BALL_RADIUS);
        blob.visible = h < 40;
        const s = (BALL_RADIUS * 3.2 + h * 0.22) * view.visualScale;
        blob.position.set(b.x, gy + 0.006, b.z);
        blob.scale.set(s, 1, s);
        blob.material.opacity = clamp(0.8 / (1 + h * 0.9), 0, 0.8);
      }
      // Rebuild the ribbon facing the camera.
      const tp = view.tracePoints, n = tp.length / 3;
      if (n >= 2) {
        const width = 0.05;
        for (let i = 0; i < n; i++) {
          p0.set(tp[i * 3], tp[i * 3 + 1], tp[i * 3 + 2]);
          const j = Math.min(n - 1, i + 1), k = Math.max(0, i - 1);
          dir.set(tp[j * 3] - tp[k * 3], tp[j * 3 + 1] - tp[k * 3 + 1], tp[j * 3 + 2] - tp[k * 3 + 2]).normalize();
          toCam.copy(cam).sub(p0);
          const d = toCam.length();
          side.crossVectors(dir, toCam).normalize().multiplyScalar(width + d * 0.0016);
          tracePos[i * 6] = p0.x + side.x; tracePos[i * 6 + 1] = p0.y + side.y; tracePos[i * 6 + 2] = p0.z + side.z;
          tracePos[i * 6 + 3] = p0.x - side.x; tracePos[i * 6 + 4] = p0.y - side.y; tracePos[i * 6 + 5] = p0.z - side.z;
          const a = 0.25 + 0.75 * (i / (n - 1));
          traceAlpha[i * 2] = a; traceAlpha[i * 2 + 1] = a;
        }
        traceGeo.attributes.position.needsUpdate = true; traceGeo.attributes.aAlpha.needsUpdate = true;
        traceGeo.setDrawRange(0, (n - 1) * 6);
      } else traceGeo.setDrawRange(0, 0);
      // Particles.
      let live = 0;
      for (let i = pool.length - 1; i >= 0; i--) {
        const p = pool[i];
        p.life += dt;
        if (p.life >= p.max) { pool.splice(i, 1); continue; }
        p.vy -= 9.81 * dt; p.vx *= 1 - p.drag * dt; p.vz *= 1 - p.drag * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      for (const p of pool) {
        if (live >= MAX_PARTICLES) break;
        pPos[live * 4] = p.x; pPos[live * 4 + 1] = p.y; pPos[live * 4 + 2] = p.z; pPos[live * 4 + 3] = p.size;
        pCol[live * 4] = p.r; pCol[live * 4 + 1] = p.g; pCol[live * 4 + 2] = p.b; pCol[live * 4 + 3] = 1 - p.life / p.max;
        live++;
      }
      pGeo.instanceCount = live;
      if (live) { pGeo.attributes.aP.needsUpdate = true; pGeo.attributes.aC.needsUpdate = true; }
      if (landMark.visible) landMark.rotation.y = t * 0.6;
    },
    dispose() { scene.remove(group); normalMap.dispose(); blobTex.dispose(); mat.dispose(); traceGeo.dispose(); traceMat.dispose(); pGeo.dispose(); pMat.dispose(); ringGeo.dispose(); },
  };
  return view;
}
