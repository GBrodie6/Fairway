// Test and QA hooks on window.__fw. The smoke test, the QA bot, the contact-sheet tool, and
// the perf tool all drive the real app through these. They read state and trigger the same
// code paths as the UI. Nothing here changes how a measured value is computed.
import { guardStats } from '../core/guards.js';

export function installHooks(app) {
  const fw = {
    ready: false,
    settled: false,
    version: 1,
    get app() { return app; },
    get game() { return app.game; },
    get ui() { return app.ui; },
    // Read model of the round for the QA bot. The bot acts only through real input events.
    gameView() { return app.game ? app.game.view() : null; },
    phase() { return app.game ? app.game.state.phase : 'boot'; },
    rect(selector) { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; },
    get errors() {
      return { count: [...guardStats.errors.values()].reduce((a, b) => a + b, 0), last: guardStats.last, bySystem: Object.fromEntries(guardStats.errors) };
    },
    info() {
      const e = app.engine;
      return {
        tier: e.tier.id, width: e.width, height: e.height, pixelRatio: e.pixelRatio, orientation: e.orientation,
        course: app.world.courseId, tod: app.world.todId, hole: app.world.hole,
        stats: { ...e.stats }, memory: e.memoryEstimate(), exposure: e.exposure.value,
        frame: app.loop.stats.frame, cpuAvg: app.loop.stats.cpuAvg, perSystem: { ...app.loop.stats.perSystem },
        contextLossCount: e.contextLossCount, budget: e.tier.budget,
      };
    },
    // Settle exposure, render, and measure the 3D viewport. See engine.measureFrame.
    // iterations: how many renders exposure may take to settle (default 28). Contact-sheet
    // close-ups pass a small number; the luma table uses the default.
    measure(iterations) {
      const { engine, world, loop } = app;
      world.update(0, loop.time);
      engine.settleExposure(world.scene, world.camera, loop.time, Number.isFinite(iterations) ? iterations : 28);
      return engine.measureFrame(world.scene, world.camera, loop.time);
    },
    async setTimeOfDay(id) { await app.setTimeOfDay(id); return app.world.todId; },
    async setCourse(id, hole) { await app.setCourse(id, hole); await app.world.whenSettled(); return app.world.courseId; },
    async setTier(id) { await app.setTier(id); await app.world.whenSettled(); return app.engine.tier.id; },
    // Wait until lazily loaded assets for the current hole are on the GPU.
    async settle() { await app.world.whenSettled(); return true; },
    // Renderer versus physics: surface ids rendered by the real shader against terrain queries.
    surfaceAgreement(samples) { return app.world.surfaceAgreement(samples); },
    // Image-based lighting versus the game sun (see world.envSunCheck).
    envSunCheck() { return app.world.envSunCheck(); },
    // Screen position (CSS pixels) of a world point in the current camera.
    project(x, y, z) {
      const cam = app.world.camera, e = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
      const vx = e[0] * x + e[4] * y + e[8] * z + e[12], vy = e[1] * x + e[5] * y + e[9] * z + e[13], vz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12], cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13], cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
      const r = app.engine.renderer.domElement.getBoundingClientRect();
      return { x: r.x + ((cx / cw) * 0.5 + 0.5) * r.width, y: r.y + (0.5 - (cy / cw) * 0.5) * r.height, behind: cw <= 0 };
    },
    // Screen boxes for the layout check: every visible HUD control, the ball, the swing zone,
    // the aim fan, and the club. Boxes are { x, y, w, h } in CSS pixels.
    layoutBoxes() {
      const out = { hud: {}, ball: null, zone: null, fan: null, club: null };
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const visible = (el) => { if (!el || !el.isConnected) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; let p = el.parentElement; while (p) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false; p = p.parentElement; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const sel = { tabLie: '.tabs .tab:nth-child(1)', tabDist: '.tabs .tab:nth-child(2)', tabWind: '.tabs .tab:nth-child(3)', hazard: '.tabs .chip.warn', putt: '.tabs .chip:not(.warn)', hole: '.holebox', score: '.scorebox', badge: '.posbadge', map: '[aria-label="Hole map and rangefinder"]', replay: '[aria-label="Replay the last shot"]', look: '.lookbtn', settings: '[aria-label="Settings and pause"]', prev: '.clubgroup .arrow:first-child', club: '.clubbtn', next: '.clubgroup .arrow:last-child', reset: '[aria-label="Aim back at the target"]' };
      for (const [k, s] of Object.entries(sel)) { const el = document.querySelector(s); if (visible(el)) out.hud[k] = box(el); }
      const z = document.querySelector('.swingzone');
      if (visible(z)) out.zone = box(z);
      const w = app.world, b = w.ball && w.ball.position;
      if (b && w.ball.group ? w.ball.group.visible !== false : true) {
        const c = fw.project(b.x, b.y, b.z), r = Math.max(4, Math.abs(fw.project(b.x, b.y + 0.0427, b.z).y - c.y));
        out.ball = { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2 };
      }
      if (w.overlays && w.overlays.screenBox) out.fan = w.overlays.screenBox(fw.project);
      if (w.club && w.club.visible && w.club.screenPoints) {
        const pts = w.club.screenPoints().map((q) => fw.project(q.x, q.y, q.z)).filter((q) => !q.behind);
        if (pts.length) { const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y); out.club = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; out.clubPts = pts.map((q) => [q.x, q.y]); }
      }
      return out;
    },
    // Move the camera for QA shots without touching game state.
    view(name) { return app.world.qaView ? app.world.qaView(name) : false; },
    // Force a WebGL context loss and restore, to prove the app survives it.
    async loseContext(ms = 200) {
      const gl = app.engine.renderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return { supported: false };
      ext.loseContext();
      await new Promise((r) => setTimeout(r, ms));
      ext.restoreContext();
      await new Promise((r) => setTimeout(r, ms + 200));
      return { supported: true, lost: app.engine.contextLossCount, contextLost: app.engine.contextLost };
    },
  };
  window.__fw = fw;
  return fw;
}
