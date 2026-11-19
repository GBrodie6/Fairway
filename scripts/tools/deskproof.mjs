// Desktop proof at one window size, with the mouse driven through real input events (Chrome
// DevTools protocol, the same path as a real mouse): the main menu, a hole at address,
// mid-swing, the spin pad, the shot selector, the scorecard, the level editor and the community
// browser. Each step is measured: HUD boxes against each other, the ball, the aim fan, the
// club and the swing zone; menu cards for controls past the window edge, controls overlapping,
// text clipped in its box; and the smallest text on screen in CSS pixels.
//   node scripts/tools/deskproof.mjs qa/proof/desktop/p6 1920x1080
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/desktop/p6', size = '1920x1080'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const live = !!process.env.URL;
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: false });
ctx.setDefaultTimeout(240000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const mouse = await createPointer(page, { touch: false });
const cdp = await ctx.newCDPSession(page);
const out = { size, live, steps: [] };

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
const hudCheck = (b) => {
  const items = Object.entries(b.hud);
  if (b.ball) items.push(['ball', b.ball]);
  if (b.zone) items.push(['swingZone', b.zone]);
  const bad = [];
  // With a mouse on a desktop the swing track sits beside the press point inside the wide swing
  // zone by design (Part 2), so that pair is not an overlap; everything else is checked.
  const allowed = new Set(['swingTrack x swingZone', 'swingZone x swingTrack']);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (overlaps(items[i][1], items[j][1]) && !allowed.has(`${items[i][0]} x ${items[j][0]}`)) bad.push(`${items[i][0]} x ${items[j][0]}`);
  if (b.fan && b.fan.every((p) => !p.behind)) for (const [k, r] of Object.entries(b.hud)) if (polyHitsRect(b.fan, r)) bad.push(`fan x ${k}`);
  if (b.clubPts) for (const [k, r] of Object.entries(b.hud)) if (b.clubPts.some(([x, y]) => x > r.x - 2 && x < r.x + r.w + 2 && y > r.y - 2 && y < r.y + r.h + 2)) bad.push(`club x ${k}`);
  const off = items.filter(([, r]) => r.x < -1 || r.y < -1 || r.x + r.w > W + 1 || r.y + r.h > H + 1).map(([k]) => `${k} off screen`);
  return { overlaps: bad, offscreen: off };
};
// Menu cards: controls past the edge, overlapping controls, clipped text; the smallest text.
const sheetCheck = () => page.evaluate(() => {
  const s = document.querySelector('.screen:not(.off) .sheet');
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const res = { overflow: [], overlaps: [], clipped: [], minFontPx: null };
  const texts = [...document.querySelectorAll('#ui *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.off, .hidden, [aria-hidden="true"]'));
  // The drawn size: the font size times the zoom of the element and its ancestors (menus) and
  // the CSS scale of its ancestors (the HUD groups).
  const drawn = (e) => {
    let f = parseFloat(getComputedStyle(e).fontSize), p = e;
    while (p && p.nodeType === 1) { const cs = getComputedStyle(p); const z = parseFloat(cs.zoom || 1); if (z && z !== 1) f *= z; const sc = cs.scale && cs.scale !== 'none' ? parseFloat(cs.scale) : 1; if (sc && sc !== 1) f *= sc; p = p.parentElement; }
    return f;
  };
  const sizes = texts.map((e) => ({ px: drawn(e), what: `${String(e.className || e.tagName).slice(0, 24)}: ${e.textContent.trim().slice(0, 18)}` })).sort((a, b) => a.px - b.px);
  res.minFontPx = sizes.length ? +sizes[0].px.toFixed(1) : null;
  res.smallest = sizes.slice(0, 3).map((x) => `${x.px.toFixed(1)} ${x.what}`);
  if (!s) return res;
  const ctrls = [...s.querySelectorAll('button, select, input')].filter((b) => b.getBoundingClientRect().width > 0);
  res.overflow = [...s.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }).map((e) => String(e.className || e.tagName)).slice(0, 4);
  res.clipped = [...s.querySelectorAll('button, b, span, p, h2, h3')].filter((e) => e.clientWidth && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').map((e) => e.textContent.trim().slice(0, 18)).slice(0, 4);
  const boxes = ctrls.map((b) => ({ b, r: b.getBoundingClientRect() }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].r, c = boxes[j].r;
    if (boxes[i].b.contains(boxes[j].b) || boxes[j].b.contains(boxes[i].b)) continue;
    const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left), iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
    if (ix > 1 && iy > 1) res.overlaps.push(`${boxes[i].b.textContent.trim().slice(0, 10)}|${boxes[j].b.textContent.trim().slice(0, 10)}`);
  }
  const r = s.getBoundingClientRect();
  res.card = { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) };
  res.cardFits = r.width <= vw && r.left >= 0;
  void vh;
  return res;
});
const settle = async () => {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const p = await page.evaluate(() => [...window.__fw.app.world.camera.position.toArray(), window.__fw.app.loop.stats.frame]);
    if (last && p[3] >= last[3] + 3) { if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 0.004) break; last = p; } else if (!last) last = p;
    await page.waitForTimeout(250);
  }
};
const screenIn = () => page.waitForFunction(() => { const s = document.querySelector('.screen'); return s && !s.classList.contains('off') && getComputedStyle(s).opacity === '1'; }, null, { timeout: 30000 }).catch(() => {});
let n = 0;
async function step(name, { hud = false } = {}) {
  await page.waitForTimeout(300);
  n++;
  const file = `${prefix}-${size}-${n}-${name}.jpg`;
  const r = { name, file };
  if (hud) Object.assign(r, hudCheck(await page.evaluate(() => window.__fw.layoutBoxes())));
  Object.assign(r, { sheet: await sheetCheck() });
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  out.steps.push(r);
  console.log(name, JSON.stringify({ overlaps: r.overlaps, offscreen: r.offscreen, sheet: r.sheet }).slice(0, 400));
  return r;
}
const center = (sel) => page.evaluate((s) => { const e = typeof s === 'string' ? document.querySelector(s) : null; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height } : null; }, sel);
const click = async (sel) => { const c = await center(sel); if (!c) throw new Error(`nothing to click: ${sel}`); await mouse.move(c.x, c.y); await page.waitForTimeout(120); await mouse.tap(c.x, c.y); await page.waitForTimeout(400); };
const clickText = async (text, scope = '#ui') => {
  const c = await page.evaluate(([t, sc]) => { const b = [...document.querySelectorAll(`${sc} button`)].find((e) => e.offsetParent !== null && !e.disabled && (e.textContent.trim() === t || e.textContent.trim().startsWith(t))); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, [text, scope]);
  if (!c) throw new Error(`no button "${text}"`);
  await mouse.move(c.x, c.y); await page.waitForTimeout(120); await mouse.tap(c.x, c.y); await page.waitForTimeout(450);
};

try {
  // 1. The main menu (the in-memory community, so the browser has holes to show).
  await page.goto(`${server.url}/?tier=low&scale=0.5${live ? '' : '&cloud=demo'}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await screenIn();
  await page.mouse.move(W / 2, H / 2);
  await step('menu');
  // 2. A hole at address (the round starts from a link; the flyover is skipped with the mouse).
  await page.goto(`${server.url}/?mode=stroke&course=parkland&hole=4&holes=1&tier=low&scale=0.5&bot=1&seed=3${live ? '' : '&cloud=demo'}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await click('.intro-skip');
  await waitPhase(page, 'aim');
  await settle();
  await step('address', { hud: true });
  // 3. Mid-swing: press in the wide zone under the ball, drag to about 70 percent, hold; then the
  // pointer leaves the window, which cancels the swing safely (nothing is hit).
  const z = await page.evaluate(() => { const zz = window.__fw.ui.hud.zone, r = zz.el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 30, travel: zz.travel }; });
  const t0 = Date.now();
  await mouse.move(z.x, z.y, t0); await mouse.down(z.x, z.y, t0 + 20);
  for (let i = 1; i <= 14; i++) await mouse.move(z.x, z.y + z.travel * 0.7 * (i / 14), t0 + 20 + i * 45);
  await page.waitForTimeout(500);
  await step('mid-swing', { hud: true });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(z.x), y: H + 40, button: 'left', buttons: 1, pointerType: 'mouse', timestamp: (Date.now() + 5) / 1000 });
  await page.waitForTimeout(200);
  await mouse.up(z.x, H - 2);
  await page.waitForTimeout(300);
  const afterCancel = await page.evaluate(() => ({ phase: window.__fw.phase(), strokes: window.__fw.game.state.round.state[0].strokes }));
  out.cancel = afterCancel;
  // 4. The spin pad: open the shot panel, drag the contact dot up and to the right.
  await click('.spinbtn');
  await page.waitForTimeout(400);
  const pad = await center('.padball');
  if (pad) {
    const t1 = Date.now();
    await mouse.move(pad.x, pad.y, t1); await mouse.down(pad.x, pad.y, t1 + 10);
    for (let i = 1; i <= 8; i++) await mouse.move(pad.x + pad.w * 0.18 * (i / 8), pad.y - pad.h * 0.2 * (i / 8), t1 + 10 + i * 30);
    await mouse.up(pad.x + pad.w * 0.18, pad.y - pad.h * 0.2, t1 + 300);
  }
  await page.waitForTimeout(300);
  out.spin = await page.evaluate(() => window.__fw.game.spin());
  await step('spin-pad', { hud: true });
  // 5. The shot selector: pick another shot type with the mouse and hover the next one.
  const types = await page.evaluate(() => [...document.querySelectorAll('.shottypes button')].filter((b) => !b.disabled && b.getBoundingClientRect().width).map((b) => b.textContent.trim()));
  if (types.length > 1) {
    await clickText(types[1], '.shottypes');
    const hov = await page.evaluate((t) => { const b = [...document.querySelectorAll('.shottypes button')].find((e) => e.textContent.trim() === t); if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, types[2] || types[0]);
    if (hov) await mouse.move(hov.x, hov.y);
  }
  out.shotType = await page.evaluate(() => window.__fw.game.state.shotType.id);
  await step('shot-selector', { hud: true });
  await clickText('Done', '.shotpanel');
  // 6. The scorecard: the settings button (pause), then Scorecard.
  await click('.b-settings');
  await screenIn();
  await clickText('Scorecard');
  await screenIn();
  await step('scorecard');
  // 7. The level editor: Back, Quit round, Create, a template.
  await clickText('Back'); await screenIn();
  await clickText('Quit round'); await screenIn();
  await clickText('Create'); await screenIn();
  await clickText('Dogleg'); await screenIn();
  await page.waitForTimeout(500);
  const cv = await center('.lvcanvas');
  if (cv) { await mouse.move(cv.x, cv.y); await page.mouse.wheel(0, -240); await page.waitForTimeout(300); }
  await step('level-editor');
  // 8. The community browser: Back to Create, then Browse.
  await clickText('Back'); await screenIn();
  await clickText('Browse'); await screenIn();
  await page.waitForTimeout(1500);
  await step('community-browser');
} catch (e) { out.failed = e.message.split('\n')[0]; console.log('FAILED', out.failed); await page.screenshot({ path: `${prefix}-${size}-failed.jpg`, type: 'jpeg', quality: 70 }).catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
out.problems = out.steps.flatMap((s) => [...(s.overlaps || []), ...(s.offscreen || []), ...(s.sheet.overflow || []).map((x) => `past the edge: ${x}`), ...(s.sheet.overlaps || []).map((x) => `controls overlap: ${x}`), ...(s.sheet.clipped || []).map((x) => `clipped: ${x}`)].map((p) => `${s.name}: ${p}`));
console.log(`${out.steps.length} screens, problems ${out.problems.length}, console errors ${out.consoleErrors.length}`, JSON.stringify(out.problems).slice(0, 600));
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
