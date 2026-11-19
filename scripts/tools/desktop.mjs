// Desktop layout checks on the production build with a mouse (no touch): a round at address at
// each desktop size, the window resized live during the round, the Screen size setting through
// the Settings screen, the fullscreen button and the F key, and browser zoom at 75 and 150
// percent (emulated the way a browser does it: a CSS viewport of size / zoom and a device pixel
// ratio of zoom). Each step tests the HUD controls, the ball, the aim fan, the club and the swing
// zone for overlaps, and saves a screenshot.
//   node scripts/tools/desktop.mjs qa/proof/desktop/p1
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/desktop/p1'] = process.argv.slice(2);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const report = { steps: [], consoleErrors: [] };

const overlaps = (a, b, pad = 1) => a && b && a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;
function polyHitsRect(poly, r) {
  const rp = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  const axes = [[1, 0], [0, 1]];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; axes.push([-(b.y - a.y), b.x - a.x]); }
  for (const [ax, ay] of axes) {
    let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
    for (const p of poly) { const d = p.x * ax + p.y * ay; p0 = Math.min(p0, d); p1 = Math.max(p1, d); }
    for (const [x, y] of rp) { const d = x * ax + y * ay; q0 = Math.min(q0, d); q1 = Math.max(q1, d); }
    if (p1 <= q0 || q1 <= p0) return false;
  }
  return true;
}
function check(b, W, H) {
  const items = Object.entries(b.hud);
  if (b.ball) items.push(['ball', b.ball]);
  if (b.zone) items.push(['swingZone', b.zone]);
  const bad = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (overlaps(items[i][1], items[j][1])) bad.push(`${items[i][0]} x ${items[j][0]}`);
  if (b.fan && b.fan.every((p) => !p.behind)) for (const [k, r] of Object.entries(b.hud)) if (polyHitsRect(b.fan, r)) bad.push(`fan x ${k}`);
  if (b.clubPts) for (const [k, r] of Object.entries(b.hud)) if (b.clubPts.some(([x, y]) => x > r.x - 2 && x < r.x + r.w + 2 && y > r.y - 2 && y < r.y + r.h + 2)) bad.push(`club x ${k}`);
  const off = items.filter(([, r]) => r.x < -1 || r.y < -1 || r.x + r.w > W + 1 || r.y + r.h > H + 1).map(([k]) => `${k} off screen`);
  // Readability: the smallest HUD text in CSS pixels.
  return { overlaps: bad, offscreen: off };
}
const settle = async (page) => {
  let last = null;
  for (let i = 0; i < 60; i++) {
    const p = await page.evaluate(() => [...window.__fw.app.world.camera.position.toArray(), window.__fw.app.loop.stats.frame]);
    if (last && p[3] >= last[3] + 3) { if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 0.004) break; last = p; } else if (!last) last = p;
    await page.waitForTimeout(250);
  }
};
const facts = (page) => page.evaluate(() => {
  const root = document.getElementById('ui'), cs = getComputedStyle(root);
  const fonts = [...document.querySelectorAll('.hud .tab .v, .hud .holebox .n, .hud .clubbtn .cl, .hud .clubbtn .cc, .hud .posbadge')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return parseFloat(getComputedStyle(e).fontSize) * (r.height / Math.max(1, e.offsetHeight)); });
  return { desk: root.classList.contains('desk'), hs: cs.getPropertyValue('--hs').trim(), ex: cs.getPropertyValue('--ex').trim(), minHudFontPx: fonts.length ? +Math.min(...fonts).toFixed(1) : null, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, canvasPx: [window.__fw.app.engine.width, window.__fw.app.engine.height] };
});
async function step(page, name, W, H) {
  await settle(page);
  const b = await page.evaluate(() => window.__fw.layoutBoxes());
  const r = { name, size: `${W}x${H}`, ...check(b, W, H), ...(await facts(page)) };
  await page.screenshot({ path: `${prefix}-${name}.jpg`, type: 'jpeg', quality: 80 });
  report.steps.push(r);
  console.log(name, JSON.stringify({ overlaps: r.overlaps, offscreen: r.offscreen, desk: r.desk, hs: r.hs, ex: r.ex, minFont: r.minHudFontPx }));
  return r;
}
const roundUrl = () => `${server.url}/?mode=stroke&course=parkland&hole=1&holes=1&tier=low&scale=0.5&bot=1&seed=7`;
async function openRound(ctx) {
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  await page.goto(roundUrl(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  const pointer = await createPointer(page, { touch: false });
  if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
  await waitPhase(page, 'aim');
  return { page, errors, pointer };
}
const clickText = async (page, pointer, text) => {
  const r = await page.evaluate((t) => { const b = [...document.querySelectorAll('#ui button')].find((e) => e.textContent.trim().startsWith(t) && e.offsetParent !== null); if (!b) return null; b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, text);
  if (!r) throw new Error(`no button ${text}`);
  await pointer.down(r.x, r.y); await pointer.up(r.x, r.y); await page.waitForTimeout(350);
};

try {
  // 1. Each desktop size, then live resizes in the same round.
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, hasTouch: false });
  ctx.setDefaultTimeout(240000);
  const { page, errors, pointer } = await openRound(ctx);
  await step(page, 'size-1920x1080', 1920, 1080);
  for (const [W, H] of [[1366, 768], [2560, 1440], [3440, 1440], [1280, 720], [1920, 1080]]) {
    await page.setViewportSize({ width: W, height: H });
    await page.waitForTimeout(700);
    await step(page, `resize-${W}x${H}`, W, H);
  }
  // 2. Screen size through the Settings screen (Esc, Settings, the select, Back, Resume).
  for (const size of ['small', 'large', 'normal']) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await clickText(page, pointer, 'Settings');
    await page.selectOption('#s-size', size); await page.waitForTimeout(200);
    if (size === 'large') { await page.waitForTimeout(500); await page.screenshot({ path: `${prefix}-settings-1920x1080.jpg`, type: 'jpeg', quality: 80 }); }
    await clickText(page, pointer, 'Back'); await clickText(page, pointer, 'Resume');
    await page.waitForTimeout(500);
    await step(page, `screensize-${size}`, 1920, 1080);
  }
  // 3. Fullscreen: the button, then the F key.
  const fs = {};
  await clickSel(page, pointer, '.fsbtn'); await page.waitForTimeout(600);
  fs.afterButton = await page.evaluate(() => !!document.fullscreenElement);
  await page.keyboard.press('KeyF'); await page.waitForTimeout(600);
  fs.afterF = await page.evaluate(() => !!document.fullscreenElement);
  await page.keyboard.press('KeyF'); await page.waitForTimeout(600);
  fs.afterSecondF = await page.evaluate(() => !!document.fullscreenElement);
  report.fullscreen = fs;
  console.log('fullscreen', JSON.stringify(fs));
  report.consoleErrors.push(...errors.map((e) => e.text.slice(0, 200)));
  await ctx.close();
  // 4. Browser zoom, emulated: viewport = screen / zoom, device pixel ratio = zoom.
  for (const [W, H] of [[1366, 768], [1920, 1080]]) for (const z of [0.75, 1.5]) {
    const vw = Math.round(W / z), vh = Math.round(H / z);
    const c = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: z, hasTouch: false });
    c.setDefaultTimeout(240000);
    const o = await openRound(c);
    await step(o.page, `zoom${Math.round(z * 100)}-${W}x${H}`, vw, vh);
    report.consoleErrors.push(...o.errors.map((e) => e.text.slice(0, 200)));
    await c.close();
  }
} catch (e) { report.failed = e.message.split('\n')[0]; console.log('FAILED', report.failed); }
writeFileSync(`${prefix}.json`, JSON.stringify(report, null, 1));
console.log('console errors', report.consoleErrors.length);
await browser.close();
await server.close();
