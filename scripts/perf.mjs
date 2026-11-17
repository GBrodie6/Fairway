// npm run perf: measured rendering cost per quality tier.
// Reports renderer.info (draw calls, triangles) with and without vegetation, grass, and props,
// CPU time per subsystem, texture and render target memory, and compares against each tier's
// stated budget. Runs in headless Chrome with SwiftShader, so wall-clock frame time here is a
// software rasterizer number and is NOT representative of a real GPU. Draw calls, triangle
// counts, CPU-side subsystem time, and memory are valid.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, trackErrors } from './lib/browser.mjs';
import { serveStatic } from './lib/serve.mjs';
import { TIERS, TIER_ORDER } from '../src/core/quality.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const courses = (args.course || 'parkland').split(',');
const tiers = args.tier ? String(args.tier).split(',') : TIER_ORDER;
if (!existsSync(path.join(dist, 'index.html'))) { console.error('dist/ is missing. Run "npm run build" first.'); process.exit(1); }

const server = await serveStatic(dist);
const { browser, software } = await launchBrowser();
const rows = [];
for (const course of courses) {
  for (const tier of tiers) {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
    const errors = trackErrors(page);
    const t0 = Date.now();
    await page.goto(`${server.url}/?course=${course}&tod=midday&tier=${tier}&hole=1&smoke=1`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__fw && window.__fw.ready === true, null, { timeout: 240000 });
    const readyMs = Date.now() - t0;
    await page.evaluate(() => window.__fw.settle());
    const settledMs = Date.now() - t0;
    const r = await page.evaluate(async () => {
      const fw = window.__fw, w = fw.app.world;
      const groups = [w.vegetation.group, w.grass.group, w.props.group];
      for (const g of groups) g.visible = false;
      const before = fw.measure();
      for (const g of groups) g.visible = true;
      const after = fw.measure();
      // Let the loop run so the per-subsystem CPU averages settle.
      await new Promise((res) => setTimeout(res, 2500));
      const info = fw.info();
      return {
        before: { calls: before.calls, triangles: before.triangles }, after: { calls: after.calls, triangles: after.triangles },
        perSystem: info.perSystem, cpuAvg: info.cpuAvg, memory: info.memory, budget: info.budget,
        veg: { counts: w.vegetation.counts, drawn: w.vegetation.drawn, triangles: w.vegetation.triangles },
        grass: w.grass.blades || 0, terrainTris: w.terrainView.triangles, propTris: w.props.triangles, crowd: w.props.crowd,
        assetBytes: fw.app.assets.stats.bytes, assetRequests: fw.app.assets.stats.requests, buildMs: w.buildMs,
      };
    });
    rows.push({ course, tier, readyMs, settledMs, consoleErrors: errors.length, ...r, withinBudget: r.after.calls <= r.budget.drawCalls && r.after.triangles <= r.budget.triangles });
    await page.close();
  }
}
await browser.close();
await server.close();
mkdirSync(path.join(root, 'qa'), { recursive: true });
const out = { when: new Date().toISOString(), software, note: 'SwiftShader software rendering. Counts, CPU subsystem time, and memory are valid; frame time on a real GPU is not measured here.', rows };
writeFileSync(path.join(root, 'qa', 'perf.json'), JSON.stringify(out, null, 1));
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('course', 9), pad('tier', 7), pad('draws', 14), pad('triangles', 22), pad('budget', 16), pad('tex MB', 7), pad('RT MB', 6), pad('cpu ms', 7), 'ok');
for (const r of rows) {
  console.log(pad(r.course, 9), pad(r.tier, 7), pad(`${r.before.calls} -> ${r.after.calls}`, 14), pad(`${(r.before.triangles / 1000).toFixed(0)}k -> ${(r.after.triangles / 1000).toFixed(0)}k`, 22),
    pad(`${r.budget.drawCalls} / ${(r.budget.triangles / 1000).toFixed(0)}k`, 16), pad((r.memory.textures / 1048576).toFixed(0), 7), pad((r.memory.renderTargets / 1048576).toFixed(0), 6), pad(r.cpuAvg.toFixed(1), 7), r.withinBudget ? 'yes' : 'OVER');
}
console.log(out.note);
