// Renderer engine: owns the WebGL renderer, the HDR post pipeline, sizing (DPR, resize,
// orientation), context loss and restore, auto exposure, and the frame statistics that the
// debug overlay and the QA tools read.
import * as THREE from 'three';
import { createPost } from './post.js';
import { tierById } from '../core/quality.js';
import { clamp } from '../core/math.js';
import { fin } from '../core/guards.js';

export function createEngine({ container, tierId = 'medium', renderScale = 1 }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'fw-canvas';
  canvas.setAttribute('aria-label', 'Golf course view');
  canvas.setAttribute('role', 'img');
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, depth: false, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false,
  });
  // Linear workflow: materials write linear light into the HDR target. Tone mapping and the
  // sRGB encode happen once, in the composite pass, so three's own output transform is off.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x000000, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.sortObjects = true;

  let tier = tierById(tierId);
  const post = createPost(renderer, tier);
  const engine = {
    canvas, renderer, post,
    get tier() { return tier; },
    width: 1, height: 1, pixelRatio: 1, cssWidth: 1, cssHeight: 1, orientation: 'landscape',
    renderScale,
    contextLost: false,
    contextLossCount: 0,
    stats: { calls: 0, triangles: 0, sceneCalls: 0, sceneTriangles: 0, geometries: 0, textures: 0, programs: 0 },
    exposure: { auto: true, target: 150, min: 0.05, max: 40, speed: 2.2, value: 1 },
    listeners: { resize: new Set(), tier: new Set(), restore: new Set() },
    textureBytes: 0, // maintained by the asset manager
  };

  function applySize() {
    const rect = container.getBoundingClientRect();
    const cw = Math.max(1, Math.floor(fin(rect.width, 1)));
    const ch = Math.max(1, Math.floor(fin(rect.height, 1)));
    const dpr = clamp(fin(window.devicePixelRatio, 1), 0.5, 4);
    const pr = Math.min(dpr, tier.pixelRatioCap) * clamp(fin(engine.renderScale, 1), 0.1, 2);
    engine.cssWidth = cw; engine.cssHeight = ch; engine.pixelRatio = pr;
    engine.width = Math.max(2, Math.round(cw * pr));
    engine.height = Math.max(2, Math.round(ch * pr));
    engine.orientation = cw >= ch ? 'landscape' : 'portrait';
    renderer.setPixelRatio(1);
    renderer.setSize(engine.width, engine.height, false);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    post.setSize(engine.width, engine.height);
    for (const fn of engine.listeners.resize) fn(engine);
  }

  let resizeQueued = false;
  function queueResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; applySize(); });
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queueResize) : null;
  if (ro) ro.observe(container);
  window.addEventListener('resize', queueResize);
  window.addEventListener('orientationchange', queueResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', queueResize);
  // DPR changes (browser zoom, moving between monitors) fire through this media query.
  let dprQuery = null;
  function watchDpr() {
    if (!window.matchMedia) return;
    if (dprQuery) dprQuery.removeEventListener('change', onDpr);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  }
  function onDpr() { queueResize(); watchDpr(); }
  watchDpr();

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    engine.contextLost = true;
    engine.contextLossCount++;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    engine.contextLost = false;
    applySize();
    for (const fn of engine.listeners.restore) fn(engine);
  });

  engine.resize = applySize;
  engine.setRenderScale = (s) => { engine.renderScale = s; applySize(); };
  engine.setTier = (id) => {
    const next = tierById(id);
    if (next === tier) return;
    tier = next;
    renderer.shadowMap.enabled = !!tier.shadows.enabled;
    post.setTier(tier);
    applySize();
    for (const fn of engine.listeners.tier) fn(tier);
  };

  let exposureClock = 0;
  // Closed-loop auto exposure on the measured display luma, like a camera meter.
  function updateExposure(dt) {
    const ex = engine.exposure;
    if (!ex.auto) { post.state.exposure = ex.value; return; }
    exposureClock += dt;
    post.state.measured.age += dt;
    if (exposureClock >= 0.12) {
      exposureClock = 0;
      post.measureLumaAsync();
    }
    const m = post.state.measured;
    if (m.age < 0.5 && !m.used) {
      m.used = true;
      // A near-black frame still drives the meter (floor of 1), otherwise a jump from midday
      // to night would leave the exposure stuck and the screen black.
      const ratio = clamp(ex.target / Math.max(m.luma, 1), 0.5, 2);
      // Display luma responds sub-linearly to exposure through the tone curve, so damp the step.
      const step = Math.pow(ratio, clamp(ex.speed * 0.22, 0.1, 0.9));
      ex.value = clamp(ex.value * step, ex.min, ex.max);
    }
    if (m.age === 0) m.used = false;
    post.state.exposure = ex.value;
  }

  engine.render = (scene, camera, time, dt = 0) => {
    if (engine.contextLost) return;
    renderer.info.reset();
    updateExposure(dt);
    post.render(scene, camera, time);
    const r = renderer.info.render;
    engine.stats.calls = r.calls; engine.stats.triangles = r.triangles;
    engine.stats.geometries = renderer.info.memory.geometries;
    engine.stats.textures = renderer.info.memory.textures;
    engine.stats.programs = renderer.info.programs ? renderer.info.programs.length : 0;
  };

  // Synchronously converge exposure for capture and measurement. Deterministic.
  engine.settleExposure = (scene, camera, time, iterations = 28) => {
    const ex = engine.exposure;
    let luma = 0;
    for (let i = 0; i < iterations; i++) {
      post.state.exposure = ex.value;
      post.render(scene, camera, time);
      luma = post.measureLumaSync();
      if (!ex.auto) break;
      const ratio = clamp(ex.target / Math.max(luma, 1), 0.4, 2.5);
      if (Math.abs(ratio - 1) < 0.004) break;
      ex.value = clamp(ex.value * Math.pow(ratio, 0.75), ex.min, ex.max);
    }
    post.state.exposure = ex.value;
    return luma;
  };

  /**
   * Render one frame and read back the real canvas pixels (the 3D viewport only, no HUD).
   * Returns mean Rec.709 luma on the 0..255 display values and the percent of clipped pixels.
   * This is the measurement the smoke test reports. It does not adjust anything.
   */
  engine.measureFrame = (scene, camera, time) => {
    renderer.info.reset();
    post.render(scene, camera, time);
    const gl = renderer.getContext();
    const w = engine.width, h = engine.height;
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0, clipped = 0, crushed = 0;
    const n = w * h;
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (r >= 254 || g >= 254 || b >= 254) clipped++;
      if (r <= 1 && g <= 1 && b <= 1) crushed++;
    }
    return {
      luma: sum / n, clippedPct: (clipped / n) * 100, crushedPct: (crushed / n) * 100,
      width: w, height: h, exposure: engine.exposure.value,
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    };
  };

  engine.memoryEstimate = () => ({ renderTargets: post.memoryBytes(), textures: engine.textureBytes });
  engine.dispose = () => {
    if (ro) ro.disconnect();
    window.removeEventListener('resize', queueResize);
    window.removeEventListener('orientationchange', queueResize);
    post.dispose();
    renderer.dispose();
    canvas.remove();
  };

  applySize();
  return engine;
}
