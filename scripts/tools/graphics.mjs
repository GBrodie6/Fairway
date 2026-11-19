// Desktop graphics on the production build, in headless Chrome with real mouse and keyboard
// events: the Graphics settings (quality, shadows, resolution scale, frame rate cap, V-Sync),
// what each one does to the renderer, the automatic tier with this machine's software GPU and
// with a desktop GPU's name reported to the page, the frame loop's measured refresh rate and
// cap, and the ?debug benchmark (frame time by tier at 1080p and 1440p).
// SwiftShader renders on the CPU: the benchmark's numbers here are not a real GPU's.
//   node scripts/tools/graphics.mjs qa/proof/desktop/p4 [1920x1080]
import path from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { createPointer, clickSel } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/desktop/p4', size = '1920x1080'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const out = { size, checks: [], steps: {} };
const check = (name, pass, detail) => { out.checks.push({ name, pass: !!pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); };
const errorsAll = [];

async function open(url, { gpuName } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: false });
  ctx.setDefaultTimeout(240000);
  if (gpuName) {
    // Report a desktop GPU's name to the page, as Chrome on a gaming PC would (the pixels still
    // come from SwiftShader). 0x9246 is UNMASKED_RENDERER_WEBGL.
    await ctx.addInitScript((name) => {
      for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
        const get = C.prototype.getParameter;
        C.prototype.getParameter = function (p) { return p === 0x9246 ? name : get.call(this, p); };
      }
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 16 });
    }, gpuName);
  }
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  const mouse = await createPointer(page, { touch: false });
  return { ctx, page, errors, mouse };
}
const shot = (page, n) => page.screenshot({ path: `${prefix}-${size}-${n}.jpg`, type: 'jpeg', quality: 82 });
const screenIn = (page) => page.waitForFunction(() => { const s = document.querySelector('.screen'); return s && getComputedStyle(s).opacity === '1'; }, null, { timeout: 30000 }).catch(() => {});
const state = (page) => page.evaluate(() => {
  const a = window.__fw.app, e = a.engine, gl = e.renderer.getContext();
  return { tier: e.tier.id, shadowLevel: e.tier.shadowLevel || 'auto', shadowsOn: e.renderer.shadowMap.enabled, cascades: e.tier.shadows.cascades, shadowSize: e.tier.shadows.size,
    width: e.width, height: e.height, renderScale: e.renderScale, cap: a.loop.stats.cap, refreshHz: +a.loop.stats.refreshHz.toFixed(1), lowLatency: e.lowLatency,
    desynchronized: !!(gl.getContextAttributes() || {}).desynchronized, autoTier: a.autoTier, gpu: a.caps.gpu, desktopGpu: a.caps.desktopGpu, settings: { tier: a.settings.tier, shadowQuality: a.settings.shadowQuality, renderScale: a.settings.renderScale, fpsCap: a.settings.fpsCap, vsync: a.settings.vsync } };
});
// Pick an option in a Settings select with the mouse and the keyboard (as a person would: click
// it, then arrow keys and Enter would open a native popup, which headless cannot show, so the
// value is chosen by keyboard on the focused element).
async function choose(page, mouse, id, value) {
  await page.evaluate((i) => document.getElementById(i).scrollIntoView({ block: 'center' }), id);
  await clickSel(page, mouse, `#${id}`);
  await page.keyboard.press('Escape').catch(() => {});
  await page.selectOption(`#${id}`, value);
  await page.waitForTimeout(400);
}
async function waitTier(page) { await page.waitForFunction(() => !window.__fw.app.benchRunning, null).catch(() => {}); await page.waitForTimeout(800); }

// PARTS=settings,fps,gpu,bench picks the parts to run (all by default).
const parts = (process.env.PARTS || 'settings,fps,gpu,bench,overlay').split(',');
const want = (k) => parts.includes(k);
let st = null;
try {
  if (want('settings')) {
  // 1. This machine: SwiftShader, so Automatic is Low; the Graphics section and its fields.
  const s1 = await open(`${server.url}/`);
  st = await state(s1.page);
  out.steps.machine = st;
  check('Software GPU: Automatic picks Low', st.autoTier === 'low' && st.tier === 'low', { gpu: st.gpu, autoTier: st.autoTier });
  check('The loop measures the display refresh rate', st.refreshHz > 20 && st.refreshHz < 400, { refreshHz: st.refreshHz });
  await s1.page.evaluate(() => window.__fw.app.ui.screens.registry.settings());
  await screenIn(s1.page);
  const fields = await s1.page.evaluate(() => ['s-tier', 's-shadow', 's-res', 's-fps', 's-vsync'].map((id) => { const el = document.getElementById(id); const lab = document.querySelector(`label[for="${id}"]`); return { id, present: !!el, label: lab && lab.textContent, options: el && el.options ? [...el.options].map((o) => o.textContent) : null }; }));
  out.steps.fields = fields;
  check('Settings has Graphics quality, Shadow quality, Resolution scale, Frame rate cap and V-Sync', fields.every((f) => f.present && f.label), fields.map((f) => f.label));
  check('Frame rate cap offers 30, 60, 120, 144 and uncapped', JSON.stringify(fields.find((f) => f.id === 's-fps').options) === JSON.stringify(['Uncapped (the display refresh rate)', '144 fps', '120 fps', '60 fps', '30 fps']));
  await s1.page.evaluate(() => document.getElementById('s-tier').scrollIntoView({ block: 'center' }));
  await s1.page.waitForTimeout(300);
  await shot(s1.page, '1-settings-graphics');

  // 2. Shadow quality Off, then Ultra on a Low tier; each rebuilds the world.
  await choose(s1.page, s1.mouse, 's-shadow', 'off'); await waitTier(s1.page);
  st = await state(s1.page);
  check('Shadow quality Off turns the shadow maps off', st.shadowLevel === 'off' && !st.shadowsOn && st.tier === 'low', { shadowLevel: st.shadowLevel, shadowsOn: st.shadowsOn });
  await choose(s1.page, s1.mouse, 's-shadow', 'ultra'); await waitTier(s1.page);
  st = await state(s1.page);
  check('Shadow quality Ultra on the Low tier: 4 cascades, the rest stays Low', st.tier === 'low' && st.cascades === 4 && st.shadowsOn, { cascades: st.cascades, size: st.shadowSize });
  await choose(s1.page, s1.mouse, 's-shadow', 'auto'); await waitTier(s1.page);

  // 3. Resolution scale: the slider with the keyboard (Home is 50 percent), then back to 100.
  const w100 = (await state(s1.page)).width;
  await s1.page.evaluate(() => document.getElementById('s-res').scrollIntoView({ block: 'center' }));
  await clickSel(s1.page, s1.mouse, '#s-res');
  await s1.page.keyboard.press('Home');
  await s1.page.waitForTimeout(500);
  st = await state(s1.page);
  const label50 = await s1.page.evaluate(() => document.getElementById('s-res-out').textContent);
  check('Resolution scale 50 percent halves the drawing size', st.renderScale === 0.5 && Math.abs(st.width - w100 / 2) <= 1 && label50 === '50%', { w100, w50: st.width, label: label50 });
  await shot(s1.page, '2-scale-50');
  await s1.page.keyboard.press('End');
  await s1.page.waitForTimeout(500);
  st = await state(s1.page);
  check('Back to 100 percent', st.renderScale === 1 && st.width === w100, { width: st.width });

  // 5. V-Sync Off: saved, and after a reload the canvas is a low-latency one.
  await choose(s1.page, s1.mouse, 's-vsync', 'off');
  await s1.page.reload({ waitUntil: 'load' });
  await s1.page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  st = await state(s1.page);
  check('V-Sync Off after a reload: a low-latency (desynchronized) canvas', st.lowLatency && st.settings.vsync === 'off', { lowLatency: st.lowLatency, contextReports: st.desynchronized });
  await s1.page.evaluate(() => { const a = window.__fw.app; a.settings.vsync = 'on'; a.saveSettings(); });
  errorsAll.push(...s1.errors);
  await s1.ctx.close();
  }

  // 4. Frame rate cap, through the Settings select: uncapped, 60 and 30, each measured over 4 s
  // in a small window, with the drawing switched off (see below).
  if (want('fps')) {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
    ctx.setDefaultTimeout(240000);
    const page = await ctx.newPage();
    const errs = trackErrors(page);
    await page.goto(`${server.url}/?tier=low&scale=0.25&noassets=1`, { waitUntil: 'load', timeout: 240000 });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    // Software rendering draws this scene at about 7 frames a second even this small, slower
    // than any cap, so for this measurement the 3D drawing and the world animation are switched
    // off: what is measured is the real frame loop paced by the browser's own frame callbacks.
    out.steps.fpsSoftware = await (async () => { const a = await page.evaluate(() => [window.__fw.app.loop.stats.frame, performance.now()]); await page.waitForTimeout(3000); const b = await page.evaluate(() => [window.__fw.app.loop.stats.frame, performance.now()]); return +((b[0] - a[0]) / ((b[1] - a[1]) / 1000)).toFixed(1); })();
    await page.evaluate(() => { const a = window.__fw.app; a.engine.render = () => {}; a.world.update = () => {}; });
    const rate = async (ms = 4000) => { const a = await page.evaluate(() => [window.__fw.app.loop.stats.frame, performance.now()]); await page.waitForTimeout(ms); const b = await page.evaluate(() => [window.__fw.app.loop.stats.frame, performance.now()]); return +((b[0] - a[0]) / ((b[1] - a[1]) / 1000)).toFixed(1); };
    const setCap = async (v) => { await page.evaluate((x) => { const a = window.__fw.app; a.ui.screens.registry.settings(); const s = document.getElementById('s-fps'); s.value = x; s.dispatchEvent(new Event('change', { bubbles: true })); a.ui.screens.back(); }, v); await page.waitForTimeout(600); };
    const r = { uncapped: await rate() };
    await setCap('60'); r.cap60 = await rate();
    await setCap('30'); r.cap30 = await rate();
    r.refreshHz = await page.evaluate(() => +window.__fw.app.loop.stats.refreshHz.toFixed(1));
    r.cap = await page.evaluate(() => window.__fw.app.loop.stats.cap);
    out.steps.fps = r;
    check('Uncapped runs at the display refresh rate (headless Chrome: 60 Hz)', r.uncapped > r.refreshHz * 0.85, r);
    check('A 60 cap draws about 60 times a second', r.cap60 <= 61.5 && r.cap60 > Math.min(r.uncapped, 60) * 0.85, r);
    check('A 30 cap draws about 30 times a second', r.cap === 30 && r.cap30 <= 31 && r.cap30 > 26, r);
    errorsAll.push(...errs);
    await ctx.close();
  }

  // 6. A desktop GPU's name: Automatic picks Ultra, and the Settings label says so.
  if (want('gpu')) {
  const s2 = await open(`${server.url}/?scale=0.25`, { gpuName: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)' });
  st = await state(s2.page);
  out.steps.desktopGpu = st;
  check('Desktop GPU (RTX 3070 reported): Automatic picks Ultra', st.autoTier === 'ultra' && st.tier === 'ultra' && st.desktopGpu, { gpu: st.gpu, autoTier: st.autoTier, tier: st.tier });
  await s2.page.evaluate(() => window.__fw.app.ui.screens.registry.settings());
  await screenIn(s2.page);
  const lab = await s2.page.evaluate(() => { const s = document.getElementById('s-tier'); s.scrollIntoView({ block: 'center' }); return s.options[0].textContent; });
  check('The tier override is in Settings and shows the automatic choice', lab === 'Automatic (Ultra)', lab);
  await choose(s2.page, s2.mouse, 's-tier', 'high'); await waitTier(s2.page);
  st = await state(s2.page);
  check('Overriding the tier to High rebuilds the world on High', st.tier === 'high' && st.settings.tier === 'high', { tier: st.tier });
  await shot(s2.page, '3-desktop-gpu-settings');
  errorsAll.push(...s2.errors);
  await s2.ctx.close();
  }

  // 7. The ?debug overlay and benchmark in a round (fewer frames than a real run: software rendering).
  if (want('bench')) {
  const s3 = await open(`${server.url}/?mode=stroke&course=parkland&hole=1&holes=1&debug=1&bot=1&seed=4`);
  await s3.page.waitForFunction(() => ['intro', 'aim'].includes(window.__fw.phase()), null);
  if (await s3.page.evaluate(() => window.__fw.phase() === 'intro')) { await clickSel(s3.page, s3.mouse, '.intro-skip'); }
  await s3.page.waitForFunction(() => window.__fw.phase() === 'aim', null);
  const t0 = Date.now();
  const bench = await s3.page.evaluate(() => window.__fw.app.bench({ warm: 2, frames: 3, batches: 2 }));
  out.steps.bench = { ...bench, seconds: Math.round((Date.now() - t0) / 1000) };
  await s3.page.waitForFunction(() => /1440p/.test(document.getElementById('fw-debug').textContent), null, { timeout: 300000 }).catch(() => {});
  const overlay = await s3.page.evaluate(() => document.getElementById('fw-debug').textContent);
  out.steps.overlay = overlay.split('\n');
  check('The ?debug overlay reports frame time by tier at 1080p and 1440p', /1080p/.test(overlay) && /1440p/.test(overlay) && ['low', 'medium', 'high', 'ultra'].every((t) => new RegExp(`\\n  ${t} `).test(overlay)), out.steps.overlay.slice(-6));
  check('The overlay shows the refresh rate and the cap', /display \d+ Hz\s+cap/.test(overlay));
  const after = await state(s3.page);
  check('After the benchmark the tier and the drawing size are back', after.tier === 'low' && after.width === W, { tier: after.tier, width: after.width });
  await shot(s3.page, '4-debug-bench');
  errorsAll.push(...s3.errors);
  await s3.ctx.close();
  }
  // 8. The overlay on a later visit: the result is kept in the browser and shown at once. The
  // saved result here is the one recorded by part 7 (BENCH_JSON points at its report).
  if (want('overlay') && process.env.BENCH_JSON) {
    const saved = JSON.parse(readFileSync(process.env.BENCH_JSON, 'utf8')).steps.bench;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    ctx.setDefaultTimeout(240000);
    await ctx.addInitScript((r) => { try { localStorage.setItem('fairway-next.bench', JSON.stringify(r)); } catch { /* fine */ } }, saved);
    const page = await ctx.newPage();
    const errs = trackErrors(page);
    await page.goto(`${server.url}/?debug=1&tier=low&scale=0.5`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
    await page.waitForFunction(() => { const e = document.getElementById('fw-debug'); return e && /1440p/.test(e.textContent); }, null, { timeout: 120000 }).catch(() => {});
    const text = await page.evaluate(() => document.getElementById('fw-debug').textContent);
    out.steps.overlayText = text.split('\n');
    check('The ?debug overlay shows frame time by tier at 1080p and 1440p', /1080p/.test(text) && /1440p/.test(text) && ['low', 'medium', 'high', 'ultra'].every((t) => new RegExp(`\\n  ${t} `).test(text)), out.steps.overlayText.slice(-6));
    check('The overlay shows the refresh rate and the cap', /display \d+ Hz\s+cap/.test(text));
    const btn = await page.evaluate(() => { const b = document.querySelector('.fw-debug-bench'); return b && b.getBoundingClientRect().width > 0 ? b.textContent : null; });
    check('The overlay has a Run benchmark button', btn === 'Run benchmark', btn);
    await page.screenshot({ path: `${prefix}-${size}-5-debug-overlay.jpg`, type: 'jpeg', quality: 85, clip: { x: 0, y: 0, width: Math.min(W, 900), height: Math.min(H, 420) } });
    errorsAll.push(...errs);
    await ctx.close();
  }
} catch (e) { out.failed = e.message.split('\n')[0]; console.log('FAILED', out.failed); }
out.consoleErrors = errorsAll.map((e) => e.text.slice(0, 200));
out.passed = out.checks.filter((c) => c.pass).length; out.total = out.checks.length;
console.log(`${out.passed} of ${out.total} checks passed, console errors ${out.consoleErrors.length}`);
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
