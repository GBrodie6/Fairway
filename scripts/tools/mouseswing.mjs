// The mouse swing on the production build, through real mouse events (Chrome DevTools input
// domain, planned timestamps): hover (the start point preview and the cursor), a press off the
// zone's centre (the track beside the press point), the same swing sampled at 60, 144 and 240 Hz
// (the result must agree), the pointer leaving the window mid swing (a safe cancel), and the
// left-handed mirror.
//   node scripts/tools/mouseswing.mjs qa/proof/desktop/p2 [1920x1080]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/desktop/p2', size = '1920x1080'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: false });
ctx.setDefaultTimeout(240000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const mouse = await createPointer(page, { touch: false });
const cdp = await ctx.newCDPSession(page);
const out = { size, steps: {} };
const shot = (n) => page.screenshot({ path: `${prefix}-${size}-${n}.jpg`, type: 'jpeg', quality: 82 });
const zoneInfo = () => page.evaluate(() => { const z = window.__fw.ui.hud.zone, r = z.el.getBoundingClientRect(), t = z.track.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, startY: z.startY(), travel: z.travel, mouse: z.mouse, wide: z.wide, track: { x: t.x, y: t.y, h: t.height }, cursor: getComputedStyle(z.el).cursor }; });
const view = () => page.evaluate(() => ({ phase: window.__fw.phase(), ideal: window.__fw.game.suggestedPower(), result: window.__fw.ui.hud.zone.lastResult }));
const move = (x, y, t, buttons) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: buttons ? 'left' : 'none', buttons: buttons ? 1 : 0, pointerType: 'mouse', timestamp: t / 1000 });
const press = (x, y, t, type) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'mouse', timestamp: t / 1000 });
// One swing: press at (x, y), back to depth over backMs (ease in-out), hold 40 ms, then up
// through the start line over downMs (accelerating), sampled at hz. Returns the zone's result.
async function swing(x, y, { power, hz = 125, backMs = 840, downMs = 280, drift = 0, leaveAt = null } = {}) {
  const z = await zoneInfo();
  const depth = power * z.travel, dt = 1000 / hz, t0 = Date.now();
  await press(x, y, t0, 'mousePressed');
  const total = backMs + 40 + downMs * 1.15;
  for (let t = dt; t <= total; t += dt) {
    let px = x, py;
    if (t <= backMs) { const u = t / backMs; py = y + depth * (0.5 - 0.5 * Math.cos(Math.PI * u)); }
    else if (t <= backMs + 40) py = y + depth;
    else { const u = Math.min(1.15, (t - backMs - 40) / downMs); py = y + depth - (depth + 18) * u * u; px = x + drift * u * u; }
    if (leaveAt != null && t >= leaveAt) { await move(Math.round(px), H + 40, t0 + t, true); break; }
    await move(Math.round(px), Math.round(py), t0 + t, true);
  }
  const end = await page.evaluate(() => window.__fw.phase());
  await press(Math.round(x), Math.round(y - 18), t0 + total + 5, 'mouseReleased');
  await page.waitForTimeout(250);
  return end;
}
async function toAim() {
  const ph = await waitPhase(page, ['intro', 'aim', 'summary', 'done']);
  if (ph === 'intro') { await clickSel(page, mouse, '.intro-skip'); await waitPhase(page, 'aim'); }
  await page.waitForTimeout(500);
}
async function newRound(seed) {
  await page.goto(`${server.url}/?mode=stroke&course=parkland&hole=4&holes=1&tier=low&scale=0.5&bot=1&seed=${seed}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await toAim();
}
try {
  await newRound(3);
  // 1. Mouse mode and the rest position.
  let z = await zoneInfo();
  out.steps.rest = z;
  await shot('1-address');
  // 2. Hover: the start point follows the cursor, the cursor is a grab hand.
  const hx = z.x + z.w * 0.72, hy = z.y + Math.min(40, z.h * 0.5);
  await move(Math.round(hx), Math.round(hy), Date.now(), false);
  await page.waitForTimeout(250);
  out.steps.hover = await page.evaluate(() => { const e = window.__fw.ui.hud.zone.el; return { hover: e.classList.contains('hover'), cursor: getComputedStyle(e).cursor, cx: e.style.getPropertyValue('--cx'), cy: e.style.getPropertyValue('--cy') }; });
  await shot('2-hover');
  // 3. A press off centre and a swing at the power guide, 125 Hz; a screenshot at the top.
  const ideal = (await view()).ideal;
  const z0 = await zoneInfo();
  const px = Math.round(z0.x + z0.w * 0.7), py = Math.round(z0.y + 30);
  {
    const depth = ideal * z0.travel, t0 = Date.now();
    await press(px, py, t0, 'mousePressed');
    for (let i = 1; i <= 20; i++) await move(px, Math.round(py + depth * (i / 20)), t0 + i * 42, true);
    await page.waitForTimeout(300);
    out.steps.top = { ...(await zoneInfo()), live: await page.evaluate(() => ({ ...window.__fw.ui.hud.zone.live })), cursorDuring: await page.evaluate(() => getComputedStyle(window.__fw.ui.hud.zone.el).cursor) };
    out.steps.top.trackBesidePress = { pressX: px, pressY: py, trackX: out.steps.top.track.x, trackTop: out.steps.top.track.y };
    await shot('3-top-of-backswing');
    for (let i = 1; i <= 8; i++) await move(px, Math.round(py + depth - (depth + 18) * (i / 8) ** 2), t0 + 900 + i * 34, true);
    await press(px, py - 18, t0 + 900 + 8 * 34 + 2, 'mouseReleased');
    await page.waitForTimeout(150);
    out.steps.swing = { phaseAfter: await page.evaluate(() => window.__fw.phase()), result: (await view()).result };
    await shot('4-launched');
  }
  // 4. The same swing at 60, 144 and 240 Hz on fresh rounds (same hole, same seed).
  out.steps.rates = {};
  for (const hz of [60, 144, 240]) {
    await newRound(5);
    const zz = await zoneInfo();
    await swing(Math.round(zz.x + zz.w / 2), Math.round(zz.y + 30), { power: 0.6, hz, drift: 4 });
    const r = (await view()).result;
    out.steps.rates[hz] = r && { power: +r.power.toFixed(3), tempoRatio: +r.tempoRatio.toFixed(3), tempo: r.tempoLabel, face: +r.face.toFixed(2), path: +r.path.toFixed(2) };
    console.log('rate', hz, JSON.stringify(out.steps.rates[hz]));
  }
  // 5. The pointer leaves the window mid backswing: cancelled, nothing hit, still at address.
  await newRound(6);
  const zl = await zoneInfo();
  const before = await page.evaluate(() => window.__fw.game.state.round.state[0].strokes);
  const endPhase = await swing(Math.round(zl.x + zl.w / 2), Math.round(zl.y + 30), { power: 0.8, hz: 125, leaveAt: 500 });
  await page.waitForTimeout(300);
  out.steps.leave = { phaseDuring: endPhase, phase: await page.evaluate(() => window.__fw.phase()), strokesBefore: before, strokesAfter: await page.evaluate(() => window.__fw.game.state.round.state[0].strokes), zoneMode: await page.evaluate(() => window.__fw.ui.hud.zone.mode), feedback: await page.evaluate(() => window.__fw.ui.hud.zone.fbEl.textContent) };
  await shot('5-left-the-window');
  // 6. Left-handed: the track sits left of the press point; the swing still works.
  await page.evaluate(() => { const a = window.__fw.app; a.settings.handedness = 'left'; a.settings.leftHandLayout = true; a.ui.applySettings(); });
  await page.waitForTimeout(600);
  const zlh = await zoneInfo();
  out.steps.lefty = { rest: zlh };
  const lx = Math.round(zlh.x + zlh.w * 0.4), ly = Math.round(zlh.y + 30);
  {
    const t0 = Date.now();
    await press(lx, ly, t0, 'mousePressed');
    for (let i = 1; i <= 14; i++) await move(lx, Math.round(ly + 0.5 * zlh.travel * (i / 14)), t0 + i * 50, true);
    await page.waitForTimeout(250);
    out.steps.lefty.track = (await zoneInfo()).track; out.steps.lefty.press = { x: lx, y: ly };
    await shot('6-lefty-top');
    for (let i = 1; i <= 8; i++) await move(lx, Math.round(ly + 0.5 * zlh.travel - (0.5 * zlh.travel + 18) * (i / 8) ** 2), t0 + 780 + i * 30, true);
    await press(lx, ly - 18, t0 + 780 + 8 * 30 + 2, 'mouseReleased');
    await page.waitForTimeout(150);
    out.steps.lefty.phaseAfter = await page.evaluate(() => window.__fw.phase());
  }
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify({ ...out, steps: { ...out.steps } }, null, 1).slice(0, 4000));
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
