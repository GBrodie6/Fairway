// Draw calls, triangles and frame cost per quality tier at fixed camera views, for the course
// scenery work (the other holes drawn around the current one). For each course, tier and view
// the world is rebuilt as the Settings choice would, the camera is put at the view, and whole
// frames are timed in batches, each ending with a one-pixel read so the GPU has finished.
// When the world has other-hole scenery, batches alternate scenery on and off (A B A B ...)
// so both sides run on the same machine load, and the result gives both medians.
// SwiftShader renders on the CPU: the milliseconds are a software rasterizer's, useful only to
// compare builds and settings with each other on this machine, never as a real GPU's.
//   node scripts/tools/scenery-bench.mjs <out.json> [courses] [hole] [views] [tiers] [WxH] [batches]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';

const [outFile = 'qa/tmp/scenery-bench.json', courseArg = 'parkland', holeArg = '1', viewArg = 'address,flyover,green', tierArg = 'low,medium,high,ultra', sizeArg = '960x540', batchArg = '6'] = process.argv.slice(2);
mkdirSync(path.dirname(outFile), { recursive: true });
const [BW, BH] = sizeArg.split('x').map(Number);
const batches = Number(batchArg), frames = Number(process.env.FRAMES || 3);
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const out = { at: new Date().toISOString(), size: sizeArg, method: `median of ${batches} batches of ${frames} frames, synced; scenery on and off alternate by batch`, runs: [] };

for (const course of courseArg.split(',')) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(900000);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  // scenery=1 turns the other holes on at every tier (Low defaults to off); older builds ignore it.
  await page.goto(`${server.url}/?mode=stroke&course=${course}&hole=${holeArg}&holes=1&tier=low&bot=1&seed=7&scenery=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  for (const tier of tierArg.split(',')) {
    const rows = await page.evaluate(async ({ tier, views, BW, BH, batches, frames }) => {
      const app = window.__fw.app, { engine, loop } = app;
      await app.setTier(tier, 'auto');
      if (app.world.whenSettled) await Promise.race([app.world.whenSettled(), new Promise((r) => setTimeout(r, 30000))]);
      const gl = engine.renderer.getContext(), px = new Uint8Array(4);
      const sync = () => { engine.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      const tick = () => new Promise((r) => setTimeout(r, 0));
      const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
      const res = [];
      loop.stop();
      engine.setForcedSize({ width: BW, height: BH });
      try {
        for (const view of views) {
          const w = app.world;
          if (!w.qaView(view)) { res.push({ view, skipped: true }); continue; }
          // The scenery switch, when this build has one (null on builds without scenery).
          const sc = w.scenery || null;
          const setOn = (on) => { if (sc) sc.setVisible(on); };
          const sides = sc ? [true, false] : [true];
          const per = { true: [], false: [] }, info = {};
          // Settle: render until the draw calls and triangles stop changing (vegetation, LOD
          // and textures fill in over a few frames after a tier change or a camera move).
          let last = '', same = 0, settleFrames = 0;
          for (let i = 0; i < 40 && same < 3; i++) {
            loop.step(performance.now(), 1 / 60); sync(); settleFrames++;
            const k = `${engine.stats.calls}/${engine.stats.triangles}`;
            same = k === last ? same + 1 : 0; last = k;
            if (i % 5 === 4) await tick();
          }
          for (const on of sides) {
            setOn(on);
            for (let i = 0; i < 2; i++) loop.step(performance.now(), 1 / 60);
            sync();
            info[on] = { draws: engine.stats.calls, tris: engine.stats.triangles };
          }
          for (let b = 0; b < batches; b++) for (const on of (b % 2 ? [...sides].reverse() : sides)) {
            setOn(on);
            loop.step(performance.now(), 1 / 60); sync();
            await tick();
            const t0 = performance.now();
            for (let i = 0; i < frames; i++) loop.step(performance.now(), 1 / 60);
            sync();
            per[on].push((performance.now() - t0) / frames);
          }
          setOn(true);
          loop.step(performance.now(), 1 / 60); sync();
          const after = { draws: engine.stats.calls, tris: engine.stats.triangles };
          const row = { view, settleFrames, draws: info.true.draws, tris: info.true.tris, drawsAfter: after.draws, trisAfter: after.tris, ms: +median(per.true).toFixed(1), batchesMs: per.true.map((v) => +v.toFixed(1)) };
          // With the scenery: each on batch sits next to an off batch, so the ratio of each pair
          // cancels slow drift in the machine's speed; the median ratio is the cost.
          if (sc) {
            const ratios = per.true.map((v, i) => v / per.false[i]);
            Object.assign(row, { offDraws: info.false.draws, offTris: info.false.tris, offMs: +median(per.false).toFixed(1), offBatchesMs: per.false.map((v) => +v.toFixed(1)), costRatio: +median(ratios).toFixed(4), ratios: ratios.map((v) => +v.toFixed(4)), scenery: sc.stats() });
          }
          res.push(row);
        }
      } finally {
        engine.setForcedSize(null);
        loop.start();
      }
      return res;
    }, { tier, views: viewArg.split(','), BW, BH, batches, frames });
    for (const r of rows) {
      out.runs.push({ course, hole: Number(holeArg), tier, ...r });
      console.log(course, tier, JSON.stringify(r));
    }
    writeFileSync(outFile, JSON.stringify(out, null, 1));
  }
  out.runs.push({ course, consoleErrors: errors.length, errors: errors.slice(0, 5).map((e) => e.text.slice(0, 200)) });
  if (errors.length) console.log(course, 'console errors', errors.length);
  await ctx.close();
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
