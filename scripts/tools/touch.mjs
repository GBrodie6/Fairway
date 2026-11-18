// Touch controls on the production build, through real touch events (DevTools Input domain):
// drag on the course to aim, club arrows, swipe on the club button, the club list, hold to look
// around, the map, aim reset, and the left-handed layout (mirrored bottom row and drag).
//   node scripts/tools/touch.mjs qa/tmp/touch/t [390x844]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel, swing } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/touch/t', size = '390x844'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
ctx.setDefaultTimeout(300000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: true });
const out = {};
const st = () => page.evaluate(() => { const s = window.__fw.game.state; return { phase: s.phase, club: s.club.id, aim: +s.aim.toFixed(5), shot: s.shotType.id, map: window.__fw.ui.map.open, list: window.__fw.ui.hud.clubListOpen(), rig: window.__fw.app.world.rig.mode }; });
const center = async (sel) => { const r = await page.evaluate((s) => window.__fw.rect(s), sel); return r && { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
const tap = async (sel) => { const c = await center(sel); if (!c) throw new Error(`no ${sel}`); await pointer.tap(c.x, c.y); await page.waitForTimeout(350); };
const frames = async (n) => { const f0 = await page.evaluate(() => window.__fw.app.loop.stats.frame); await page.waitForFunction((f) => window.__fw.app.loop.stats.frame >= f, f0 + n, { polling: 50 }); };
try {
  await page.goto(`${server.url}/?mode=stroke&course=parkland&hole=1&holes=2&tier=low&scale=0.6&bot=1&seed=7`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
  await waitPhase(page, 'aim');
  await frames(8);
  const s0 = await st();
  // 1. Drag across the course (above the ball, outside the swing zone) turns the aim.
  const t0 = Date.now(), y = H * 0.33;
  await pointer.down(W * 0.3, y, t0);
  for (let i = 1; i <= 10; i++) await pointer.move(W * 0.3 + W * 0.4 * (i / 10), y, t0 + 40 * i);
  await pointer.up(W * 0.7, y, t0 + 440);
  await frames(2);
  const s1 = await st();
  out.dragAim = { before: s0.aim, after: s1.aim, turned: Math.abs(s1.aim - s0.aim) > 1e-3 };
  // 2. Club arrows, by position: right arrow is the shorter club in the right-handed layout.
  await tap('.clubgroup .arrow:last-child'); const s2 = await st();
  await tap('.clubgroup .arrow:first-child'); const s3 = await st();
  out.arrows = { start: s0.club, right: s2.club, left: s3.club };
  // 3. Swipe left across the club button: shorter club.
  const cb = await center('.clubbtn');
  const t1 = Date.now();
  await pointer.down(cb.x + 30, cb.y, t1);
  for (let i = 1; i <= 6; i++) await pointer.move(cb.x + 30 - 12 * i, cb.y, t1 + 25 * i);
  await pointer.up(cb.x - 42, cb.y, t1 + 170);
  await page.waitForTimeout(300);
  const s4 = await st();
  out.swipe = { before: s3.club, after: s4.club, listOpened: s4.list };
  // 4. Tap the club button: the club list; tap 7i in it.
  await tap('.clubbtn'); const s5 = await st();
  await page.screenshot({ path: `${prefix}-clublist.png` });
  const items = await page.evaluate(() => [...document.querySelectorAll('.clublist .citem')].map((b) => b.textContent));
  const i7 = await page.evaluate(() => { const b = [...document.querySelectorAll('.clublist .citem')].find((e) => e.querySelector('b').textContent === '7i'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await pointer.tap(i7.x, i7.y); await page.waitForTimeout(350);
  const s6 = await st();
  out.clubList = { opened: s5.list, items, picked: s6.club, closed: !s6.list };
  // 5. Hold the look button: the camera pans over the hole; release returns.
  const lb = await center('.lookbtn');
  await pointer.down(lb.x, lb.y, Date.now());
  await page.waitForTimeout(400); await frames(10);
  const s7 = await st();
  await page.screenshot({ path: `${prefix}-look.png` });
  await pointer.up(lb.x, lb.y, Date.now());
  await frames(3);
  const s8 = await st();
  out.look = { held: s7.rig, released: s8.rig };
  // 6. Map button opens the map; its close button closes it.
  await tap('[aria-label="Hole map and rangefinder"]'); const s9 = await st();
  await tap('[aria-label="Close map"]'); const s10 = await st();
  out.map = { opened: s9.map, closed: !s10.map };
  // 7. Aim reset after the drag.
  await tap('[aria-label="Aim back at the target"]'); const s11 = await st();
  out.reset = { before: s10.aim, after: s11.aim, backToStart: Math.abs(s11.aim - s0.aim) < 2e-3 };
  // 8. A right-handed swing drifted right: an open face (positive).
  await swing(page, pointer, { power: 0.5, backMs: 780, downMs: 260, drift: 0.3 });
  out.rightHandedDrift = await page.evaluate(() => { const r = window.__fw.ui.hud.zone.lastResult; return r && { face: +r.face.toFixed(2), path: +r.path.toFixed(2) }; });
  await waitPhase(page, ['aim', 'summary']);
  if ((await page.evaluate(() => window.__fw.phase())) === 'summary') { await clickSel(page, pointer, '.screen .btn.primary'); await waitPhase(page, ['intro', 'aim']); if ((await page.evaluate(() => window.__fw.phase())) === 'intro') await clickSel(page, pointer, '.intro-skip'); await waitPhase(page, 'aim'); }
  // 9. Left-handed layout (set as a player would in settings): mirrored bottom row and drag.
  await page.evaluate(() => { const a = window.__fw.app; a.settings.leftHandLayout = true; a.ui.applySettings(); });
  await page.waitForTimeout(500); await frames(6);
  const rects = await page.evaluate(() => ({ settings: window.__fw.rect('[aria-label="Settings and pause"]'), reset: window.__fw.rect('[aria-label="Aim back at the target"]'), left: window.__fw.rect('.clubgroup .arrow:first-child'), look: window.__fw.rect('.lookbtn') }));
  const c0 = (await st()).club;
  await tap('.clubgroup .arrow:first-child'); const c1 = (await st()).club;
  out.lefty = { settingsOnRight: rects.settings.x > rects.reset.x, lookOnLeft: rects.look.x < W / 2, leftArrowShorter: { before: c0, after: c1 } };
  await page.screenshot({ path: `${prefix}-lefty.png` });
  await swing(page, pointer, { power: 0.5, backMs: 780, downMs: 260, drift: 0.3 });
  out.leftLayoutDrift = await page.evaluate(() => { const r = window.__fw.ui.hud.zone.lastResult; return r && { face: +r.face.toFixed(2), path: +r.path.toFixed(2) }; });
} catch (e) { out.failed = e.message.split('\n')[0]; await page.screenshot({ path: `${prefix}-failed.png` }).catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${prefix}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
