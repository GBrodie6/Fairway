// Frame time by tier at 1080p and 1440p, shown in the ?debug overlay (and run on load with
// ?debug&bench). For each tier the world is rebuilt as the Settings choice would, the drawing
// buffer is set to 1920x1080 and then 2560x1440 whatever the window size (the picture is drawn
// at 16:9 and stretched to the window while it runs), and whole frames (game, camera, world, HUD and the render) are timed in
// batches, each ending with a one-pixel read so the GPU has finished every frame in the batch.
// The figure is the median batch's milliseconds per frame: what the frame costs the CPU and GPU
// together, with the display's refresh rate taken out. The previous tier, shadow quality and
// size come back afterwards, and the result is kept in this browser for the next visit.
import { TIER_ORDER } from '../core/quality.js';

const KEY = 'fairway-next.bench';
export const BENCH_SIZES = Object.freeze([
  Object.freeze({ id: '1080p', width: 1920, height: 1080 }),
  Object.freeze({ id: '1440p', width: 2560, height: 1440 }),
]);

export function loadBench() {
  try { const t = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null; return t ? JSON.parse(t) : null; } catch { return null; }
}
function saveBench(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* private mode */ } }

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const tick = () => new Promise((r) => setTimeout(r, 0));

export async function runBench(app, { tiers = TIER_ORDER, sizes = BENCH_SIZES, warm = 6, frames = 12, batches = 4, onProgress } = {}) {
  const { engine, loop } = app;
  if (app.benchRunning) return app.benchResult || null;
  app.benchRunning = true;
  const before = { tier: engine.tier.id, shadows: engine.shadowLevel };
  const gl = engine.renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => { engine.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const out = { at: new Date().toISOString(), gpu: (app.caps && app.caps.gpu) || '', window: `${engine.cssWidth}x${engine.cssHeight}`, method: `median of ${batches} batches of ${frames} frames, synced`, rows: {} };
  const frameNow = () => performance.now();
  loop.stop();
  try {
    for (const id of tiers) {
      await app.setTier(id, 'auto');
      if (app.world.whenSettled) await Promise.race([app.world.whenSettled(), new Promise((r) => setTimeout(r, 20000))]);
      out.rows[id] = {};
      for (const sz of sizes) {
        if (onProgress) onProgress(`${id} ${sz.id}`);
        engine.setForcedSize(sz);
        for (let i = 0; i < warm; i++) loop.step(frameNow(), 1 / 60);
        sync();
        const per = [];
        for (let b = 0; b < batches; b++) {
          await tick();
          const t0 = performance.now();
          for (let i = 0; i < frames; i++) loop.step(frameNow(), 1 / 60);
          sync();
          per.push((performance.now() - t0) / frames);
        }
        const ms = median(per);
        out.rows[id][sz.id] = { ms: +ms.toFixed(2), worst: +Math.max(...per).toFixed(2), fps: +(1000 / ms).toFixed(1), draws: engine.stats.calls, tris: engine.stats.triangles };
      }
    }
  } finally {
    engine.setForcedSize(null);
    await app.setTier(before.tier, before.shadows);
    app.benchRunning = false;
    loop.start();
  }
  saveBench(out);
  return out;
}
