// Offline check for the PWA: visit once online (the service worker installs and the first
// hole's assets are cached as they load), then cut the network and reload.
//   node scripts/tools/offline.mjs qa/tmp/offline
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';

const [prefix = 'qa/tmp/offline'] = process.argv.slice(2);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await serveStatic(path.resolve('dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = trackErrors(page);
const out = {};
try {
  const url = `${server.url}/?tier=low&course=parkland`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  await page.evaluate(() => window.__fw.settle());
  out.swRegistered = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!(r && r.active); });
  // The page that installed the worker is not controlled until it reloads; the reload also
  // fetches the hole's assets through the worker so they are cached.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  await page.evaluate(() => window.__fw.settle());
  out.controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  out.caches = await page.evaluate(async () => { const o = {}; for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).length; return o; });
  const onlineRequests = server.requests.length;
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  await page.evaluate(() => window.__fw.settle());
  out.offlineBoot = true;
  out.requestsWhileOffline = server.requests.length - onlineRequests;
  out.offlineFrame = await page.evaluate(() => { const m = window.__fw.measure(); return { luma: +m.luma.toFixed(1), clip: +m.clippedPct.toFixed(2), envSource: window.__fw.app.world.sky.envSource, assetsLoaded: window.__fw.app.assets.stats.requests }; });
  out.menu = await page.$$eval('.screen button', (b) => b.map((x) => x.textContent));
  await page.screenshot({ path: `${prefix}-offline.png` });
} catch (e) { out.failed = e.message.split('\n')[0]; await page.screenshot({ path: `${prefix}-failed.png` }).catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
await browser.close();
await server.close();
