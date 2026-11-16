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
    measure() {
      const { engine, world, loop } = app;
      world.update(0, loop.time);
      engine.settleExposure(world.scene, world.camera, loop.time);
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
