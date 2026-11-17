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
// --dist=<folder> measures another build (for before and after comparisons).
const dist = path.resolve(root, process.argv.slice(2).find((a) => a.startsWith('--dist='))?.slice(7) || 'dist');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const courses = (args.course || 'parkland').split(',');
const tiers = args.tier ? String(args.tier).split(',') : TIER_ORDER;
if (!existsSync(path.join(dist, 'index.html'))) { console.error('dist/ is missing. Run "npm run build" first.'); process.exit(1); }

const server = await serveStatic(dist);
const { browser, software } = await launchBrowser();
const rows = [];
for (const course of courses) {
  for (const tier of tiers) {
    // A fresh context per run: no HTTP cache, no service worker, a cold first visit.
    const context = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = trackErrors(page);
    // --throttle=<Mbps>: emulate a real connection so downloads that the first frame does not
    // wait for are still in flight when it appears.
    if (args.throttle) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: Number(args.throttle) * 125000, uploadThroughput: 5 * 125000 });
    }
    const req0 = server.requests.length;
    const t0 = Date.now();
    await page.goto(`${server.url}/?course=${course}&tod=midday&tier=${tier}&hole=1&smoke=1`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__fw && window.__fw.ready === true, null, { timeout: 240000 });
    const readyMs = Date.now() - t0;
    const reqReady = server.requests.length;
    await page.evaluate(() => window.__fw.settle());
    const settledMs = Date.now() - t0;
    const reqSettled = server.requests.length;
    const kind = (p) => (/\.(js|css|html|webmanifest)$/.test(p) || p === '/' ? 'app' : p.includes('/textures/') ? 'textures' : p.includes('/models/') ? 'models' : p.includes('/hdri/') ? 'hdri' : 'other');
    const sumBytes = (list) => { const o = { total: 0, requests: list.length }; for (const q of list) { o.total += q.bytes; o[kind(q.path)] = (o[kind(q.path)] || 0) + q.bytes; } return o; };
    // Bytes needed for the first frame: resources that finished loading before the boot veil
    // lifted (Resource Timing, encoded body size), plus the HTML document itself.
    const firstPaintBrowser = await page.evaluate(() => {
      const at = window.__fw.readyAt;
      const nav = performance.getEntriesByType('navigation')[0];
      const o = { total: nav ? nav.encodedBodySize : 0, requests: 1 };
      for (const e of performance.getEntriesByType('resource')) {
        if (e.responseEnd > at) continue;
        const p = new URL(e.name).pathname;
        const k = /\.(js|css|html|webmanifest)$/.test(p) ? 'app' : p.includes('/textures/') ? 'textures' : p.includes('/models/') ? 'models' : p.includes('/hdri/') ? 'hdri' : 'other';
        o.total += e.encodedBodySize; o[k] = (o[k] || 0) + e.encodedBodySize; o.requests++;
      }
      return o;
    });
    const network = { firstPaint: firstPaintBrowser, polledAtReady: sumBytes(server.requests.slice(req0, reqReady)), settled: sumBytes(server.requests.slice(req0, reqSettled)), notFound: server.requests.slice(req0, reqSettled).filter((q) => q.status === 404).map((q) => q.path) };
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
    rows.push({ course, tier, readyMs, settledMs, network, consoleErrors: errors.length, ...r, withinBudget: r.after.calls <= r.budget.drawCalls && r.after.triangles <= r.budget.triangles });
    await context.close();
  }
}
await browser.close();
await server.close();
mkdirSync(path.join(root, 'qa'), { recursive: true });
const out = { when: new Date().toISOString(), software, throttleMbps: args.throttle ? Number(args.throttle) : null, note: 'SwiftShader software rendering. Counts, CPU subsystem time, and memory are valid; frame time on a real GPU is not measured here.', rows };
writeFileSync(path.join(root, 'qa', args.out || (args.throttle ? `perf-${args.throttle}mbps.json` : 'perf.json')), JSON.stringify(out, null, 1));
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('course', 9), pad('tier', 7), pad('draws', 14), pad('triangles', 22), pad('budget', 16), pad('tex MB', 7), pad('RT MB', 6), pad('cpu ms', 7), 'ok');
for (const r of rows) {
  console.log(pad(r.course, 9), pad(r.tier, 7), pad(`${r.before.calls} -> ${r.after.calls}`, 14), pad(`${(r.before.triangles / 1000).toFixed(0)}k -> ${(r.after.triangles / 1000).toFixed(0)}k`, 22),
    pad(`${r.budget.drawCalls} / ${(r.budget.triangles / 1000).toFixed(0)}k`, 16), pad((r.memory.textures / 1048576).toFixed(0), 7), pad((r.memory.renderTargets / 1048576).toFixed(0), 6), pad(r.cpuAvg.toFixed(1), 7), r.withinBudget ? 'yes' : 'OVER');
}
console.log('');
console.log('CPU per frame by system (ms). "render" includes SwiftShader rasterizing on the CPU; the other systems are JavaScript work that a GPU does not change.');
for (const r of rows) {
  const ps = r.perSystem || {};
  const js = Object.entries(ps).filter(([k]) => k !== 'render').reduce((a, [, v]) => a + (v.avg ?? v), 0);
  console.log(pad(r.course, 9), pad(r.tier, 7), 'js', js.toFixed(2), ' render', (ps.render ? (ps.render.avg ?? ps.render) : 0).toFixed(1), ' ', Object.entries(ps).map(([k, v]) => `${k} ${(v.avg ?? v).toFixed(2)}`).join('  '));
}
console.log('');
console.log(pad('course', 9), pad('tier', 7), pad('first frame MB', 15), pad('(tex/mod/hdri)', 18), pad('settled MB', 11), pad('app', 6), pad('tex', 6), pad('models', 7), pad('hdri', 6), pad('ready s', 8), 'settled s');
const mb = (b) => ((b || 0) / 1048576).toFixed(2);
for (const r of rows) {
  const n = r.network;
  console.log(pad(r.course, 9), pad(r.tier, 7), pad(mb(n.firstPaint.total), 15), pad(`${mb(n.firstPaint.textures)}/${mb(n.firstPaint.models)}/${mb(n.firstPaint.hdri)}`, 18), pad(mb(n.settled.total), 11), pad(mb(n.settled.app), 6), pad(mb(n.settled.textures), 6), pad(mb(n.settled.models), 7), pad(mb(n.settled.hdri), 6), pad((r.readyMs / 1000).toFixed(1), 8), (r.settledMs / 1000).toFixed(1));
  if (n.notFound.length) console.log('  404:', n.notFound.join(', '));
}
console.log(out.note);
