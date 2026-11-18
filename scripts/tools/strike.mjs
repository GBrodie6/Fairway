// Strike quality in a real round, through real touch input: a rushed swing with sideways drift
// (a mishit, very likely), its shot card and cause, a Mulligan tap that takes it back, then a
// smooth swing. Screenshots and state at each step.
//   node scripts/tools/strike.mjs qa/tmp/strike/s [390x844] [difficulty]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, swing, clickSel } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/strike/s', size = '390x844', difficulty = 'pro'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
ctx.setDefaultTimeout(300000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: true });
const out = { size, difficulty };
const shot = (n) => page.screenshot({ path: `${prefix}-${size}-${n}.png` });
const state = () => page.evaluate(() => { const s = window.__fw.game.state; const r = s.round; return { phase: s.phase, strokes: r ? r.state[0].strokes : null, ball: { x: +s.ball.x.toFixed(1), z: +s.ball.z.toFixed(1) }, lie: window.__fw.gameView() && window.__fw.gameView().lieName, mull: window.__fw.app.save().wallet.mulligans }; });
try {
  await page.goto(`${server.url}/?mode=stroke&course=parkland&hole=1&holes=1&tier=low&scale=0.6&timescale=3&bot=1&seed=7`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await page.evaluate((d) => { const a = window.__fw.app; a.settings.difficulty = d; a.saveSettings(); }, difficulty);
  if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
  await waitPhase(page, 'aim');
  out.before = await state();
  // Rushed (back 300 ms, down 260 ms) and drifting right on the way up.
  let mishit = null;
  for (let attempt = 0; attempt < 4 && !mishit; attempt++) {
    await swing(page, pointer, { power: 1, backMs: 300, downMs: 260, drift: 0.32 });
    const k = await page.evaluate(() => window.__fw.game.state.shot && window.__fw.game.state.shot.strike);
    await page.waitForTimeout(150);
    await shot(`impact-${attempt}`);
    await waitPhase(page, ['aim', 'summary']);
    await page.waitForTimeout(400);
    const card = await page.evaluate(() => { const c = document.querySelector('.shotcard'); return c && !c.classList.contains('hidden') ? c.innerText : null; });
    out[`shot${attempt}`] = { strike: k, card };
    if (k && !['pured', 'good'].includes(k.kind)) mishit = k;
    else if (attempt < 3) { await page.evaluate(() => window.__fw.game.mulligan && window.__fw.game.canMulligan() && window.__fw.game.mulligan()); await waitPhase(page, 'aim'); }
  }
  await shot('shot-card');
  out.afterMishit = await state();
  // Tap the Mulligan button on the card.
  const has = await page.evaluate(() => { const b = [...document.querySelectorAll('.shotcard button')].find((x) => /Mulligan/.test(x.textContent)); return b && !b.disabled; });
  out.cardBox = await page.evaluate(() => { const r = document.querySelector('.shotcard').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.right), Math.round(r.bottom)]; });
  out.layout = await page.evaluate(() => { const b = window.__fw.layoutBoxes(); const card = document.querySelector('.shotcard').getBoundingClientRect(); const hit = (r) => card.left < r.x + r.w && r.x < card.right && card.top < r.y + r.h && r.y < card.bottom; return { hud: Object.entries(b.hud).filter(([k, r]) => hit(r)).map(([k]) => k), zone: b.zone && hit(b.zone), fanTop: b.fan && Math.min(...b.fan.map((p) => p.y)) }; });
  if (has) {
    await clickSel(page, pointer, '.shotcard button');
    await page.waitForTimeout(800);
    out.afterMulligan = await state();
    await shot('after-mulligan');
  } else out.afterMulligan = 'no mulligan button';
  // A smooth swing.
  await swing(page, pointer, { power: 0.85, backMs: 780, downMs: 260, drift: 0 });
  out.smooth = await page.evaluate(() => window.__fw.game.state.shot && window.__fw.game.state.shot.strike);
  await page.waitForTimeout(150);
  await shot('smooth-impact');
  await waitPhase(page, ['aim', 'summary']);
  await page.waitForTimeout(400);
  await shot('smooth-card');
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
