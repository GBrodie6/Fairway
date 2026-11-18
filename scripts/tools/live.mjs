// Checks a deployed copy of the game in headless Chrome at phone and desktop sizes:
// console errors, every request over HTTPS, bytes loaded before the first frame and once
// settled, cache headers, the web app manifest, the service worker, and Chrome's own
// installability check (Page.getInstallabilityErrors).
//   node scripts/tools/live.mjs https://example.com/path/ qa/tmp/live/l
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from '../lib/browser.mjs';

const [base, prefix = 'qa/tmp/live/l'] = process.argv.slice(2);
if (!base) { console.error('usage: live.mjs <url> [outPrefix]'); process.exit(2); }
mkdirSync(path.dirname(prefix), { recursive: true });
const { browser, software } = await launchBrowser();
const out = { url: base, when: new Date().toISOString(), software, runs: [] };

for (const [name, opts] of [['phone 390x844', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }], ['desktop 1366x768', { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 }]]) {
  const ctx = await browser.newContext(opts);
  ctx.setDefaultTimeout(300000);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const errors = [], reqs = new Map(), headers = {};
  let bytes = 0, phase = 'boot';
  const byPhase = { firstFrame: 0, settled: 0 };
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
  cdp.on('Network.responseReceived', (e) => {
    const u = e.response.url;
    reqs.set(e.requestId, { url: u, status: e.response.status, fromSW: !!e.response.fromServiceWorker });
    const key = u.replace(base, '/').replace(/\?.*$/, '');
    if (/index\.html$|\/$|sw\.js|manifest|\.js$|\.hdr$|\.glb$|\.webp$|\.png$/.test(key) && !headers[key]) headers[key] = { status: e.response.status, type: e.response.headers['content-type'] || e.response.headers['Content-Type'], cache: e.response.headers['cache-control'] || e.response.headers['Cache-Control'] };
  });
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
  const run = { name };
  try {
    const t0 = Date.now();
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
    run.readyMs = Date.now() - t0;
    byPhase.firstFrame = bytes;
    await page.evaluate(() => window.__fw.settle());
    await page.waitForTimeout(1500);
    byPhase.settled = bytes;
    run.settledMs = Date.now() - t0;
    await page.screenshot({ path: `${prefix}-${name.split(' ')[0]}-menu.png` });
    // Service worker: registered and, after a reload, controlling the page.
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active)), null, { timeout: 120000 }).catch(() => {});
    run.serviceWorker = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? { scope: r.scope, active: !!r.active } : null; });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
    run.controlledAfterReload = await page.evaluate(() => !!navigator.serviceWorker.controller);
    // Manifest and installability, as Chrome itself judges them.
    const man = await cdp.send('Page.getAppManifest');
    let parsed = null; try { parsed = JSON.parse(man.data); } catch { /* reported below */ }
    run.manifest = { url: man.url, errors: man.errors, name: parsed && parsed.name, short_name: parsed && parsed.short_name, start_url: parsed && parsed.start_url, display: parsed && parsed.display, icons: parsed && parsed.icons && parsed.icons.map((i) => i.sizes) };
    const inst = await cdp.send('Page.getInstallabilityErrors').catch((e) => ({ installabilityErrors: [{ errorId: `call failed: ${e.message}` }] }));
    run.installabilityErrors = inst.installabilityErrors;
  } catch (e) { run.failed = e.message.split('\n')[0]; }
  const all = [...reqs.values()];
  run.requests = all.length;
  run.nonHttps = all.filter((r) => !/^https:|^data:|^blob:/.test(r.url)).map((r) => r.url);
  run.failedRequests = all.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.url}`);
  run.bytesFirstFrame = byPhase.firstFrame;
  run.bytesSettled = byPhase.settled;
  run.consoleErrors = errors;
  run.headers = headers;
  out.runs.push(run);
  console.log(name, JSON.stringify({ readyMs: run.readyMs, mbFirstFrame: +(run.bytesFirstFrame / 1e6).toFixed(2), mbSettled: +(run.bytesSettled / 1e6).toFixed(2), requests: run.requests, nonHttps: run.nonHttps.length, failed: run.failedRequests.length, consoleErrors: errors.length, sw: run.serviceWorker, controlled: run.controlledAfterReload, installabilityErrors: run.installabilityErrors, failedRun: run.failed }));
  await ctx.close();
}
await browser.close();

// Installability needs a normal (non-incognito) profile: Playwright's contexts are incognito-like
// and Chrome refuses to judge them. A persistent profile in a temporary folder is used here.
{
  const { chromium } = await import('playwright-core');
  const { mkdtempSync } = await import('node:fs');
  const os = await import('node:os');
  const { resolveChrome } = await import('../lib/browser.mjs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fw-profile-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, executablePath: resolveChrome() || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const run = { name: 'installability (persistent profile, phone)' };
  try {
    await page.goto(base, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 300000 });
    await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active)), null, { timeout: 120000 }).catch(() => {});
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 300000 });
    run.controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    run.installabilityErrors = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors;
    const man = await cdp.send('Page.getAppManifest');
    run.manifestErrors = man.errors;
  } catch (e) { run.failed = e.message.split('\n')[0]; }
  out.runs.push(run);
  console.log(run.name, JSON.stringify(run));
  await ctx.close();
}
writeFileSync(`${prefix}.json`, JSON.stringify(out, null, 1));
