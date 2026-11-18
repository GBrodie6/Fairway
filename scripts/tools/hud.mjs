// HUD layout check on the production build: start a real round, reach the aim phase, and for
// each viewport size take a screenshot and test every pair of HUD boxes, the ball, the aim fan,
// the swing zone, and the club for overlap. Optionally pose the club (top, impact, follow).
//   node scripts/tools/hud.mjs <outPrefix> [course] [sizes like 390x844,844x390] [moments] [lefty]
// moments: address, top, impact, follow (swing poses driven through the real swing zone).
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/hud/h', course = 'parkland', sizeArg = '390x844,844x390', momentArg = 'address', lefty = ''] = process.argv.slice(2);
mkdirSync(path.dirname(prefix), { recursive: true });
const sizes = sizeArg.split(',').map((s) => s.split('x').map(Number));
const moments = momentArg.split(',');
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const report = [];

const overlaps = (a, b, pad = 0) => a && b && a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;
// Convex polygon (screen points) against a rectangle, by separating axes.
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
const ptIn = ([x, y], r, pad = 2) => x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad;
function check(boxes, W, H) {
  const items = Object.entries(boxes.hud).map(([k, b]) => [k, b]);
  if (boxes.ball) items.push(['ball', boxes.ball]);
  if (boxes.zone) items.push(['swingZone', boxes.zone]);
  const bad = [];
  // HUD controls, the ball, and the swing zone: no two may overlap.
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const [ka, a] = items[i], [kb, b] = items[j];
    if (overlaps(a, b, 1)) bad.push(`${ka} x ${kb}`);
  }
  // The fan (its real wedge shape) against every HUD control.
  const hudItems = Object.entries(boxes.hud);
  if (boxes.fan && boxes.fan.every((p) => !p.behind)) for (const [k, r] of hudItems) if (polyHitsRect(boxes.fan, r)) bad.push(`fan x ${k}`);
  // The club (head corners and points along the shaft) against every HUD control and the zone
  // is not checked against the ball or the fan, which it touches by design at address.
  if (boxes.clubPts) for (const [k, r] of hudItems) if (boxes.clubPts.some((p) => ptIn(p, r))) bad.push(`club x ${k}`);
  const off = items.filter(([k, b]) => b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1).map(([k]) => `${k} off screen`);
  if (boxes.clubPts && boxes.clubPts.some(([x, y]) => x < 0 || y < 0 || x > W || y > H)) off.push('club partly off screen');
  const small = Object.entries(boxes.hud).filter(([k, b]) => !k.startsWith('tab') && !['hole', 'score', 'badge', 'hazard', 'putt'].includes(k) && (b.w < 47.5 || b.h < 47.5)).map(([k, b]) => `${k} ${b.w.toFixed(0)}x${b.h.toFixed(0)}`);
  return { overlaps: bad, offscreen: off, smallTargets: small };
}

for (const [W, H] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
  ctx.setDefaultTimeout(300000);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  const pointer = await createPointer(page, { touch: true });
  const tag = `${W}x${H}`;
  try {
    await page.goto(`${server.url}/?mode=stroke&course=${course}&hole=${process.env.HOLE || 1}&holes=1&tier=low&scale=0.6&bot=1&seed=${process.env.SEED || 7}${lefty ? '&lefty=1' : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
    if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
    await waitPhase(page, 'aim');
    if (lefty) await page.evaluate(() => { const a = window.__fw.app; a.settings.handedness = 'left'; a.settings.leftHandLayout = true; a.ui.applySettings(); });
    // Wait for the camera to finish easing in (headless frames are slow).
    let last = null;
    for (let i = 0; i < 80; i++) {
      const p = await page.evaluate(() => [...window.__fw.app.world.camera.position.toArray(), window.__fw.app.loop.stats.frame]);
      if (last && p[3] >= last[3] + 3) {
        if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 0.004) break;
        last = p;
      } else if (!last) last = p;
      await page.waitForTimeout(300);
    }
    // Swing moments are reached with a real drag on the swing zone (touch events with planned
    // timestamps). The finger is held at the top for that shot; for impact and follow-through
    // the game clock is slowed so the frame right after the crossing can be captured.
    const zinfo = await page.evaluate(() => { const z = window.__fw.ui.hud.zone, r = z.el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: z.startY(), travel: z.travel }; });
    const frames = async (n) => { const f0 = await page.evaluate(() => window.__fw.app.loop.stats.frame); await page.waitForFunction((f) => window.__fw.app.loop.stats.frame >= f, f0 + n, { polling: 50 }); };
    let t0 = Date.now(), down = false;
    for (const m of moments) {
      if (m === 'top') {
        t0 = Date.now();
        await pointer.down(zinfo.x, zinfo.y, t0);
        down = true;
        // Full power unless POWER=ideal (the HUD's power guide) or a number is given.
        const pw = process.env.POWER === 'ideal' ? await page.evaluate(() => window.__fw.game.suggestedPower()) : Number(process.env.POWER || 1);
        zinfo.depth = Math.max(0.1, Math.min(1, pw)) * zinfo.travel;
        for (let i = 1; i <= 16; i++) await pointer.move(zinfo.x, zinfo.y + zinfo.depth * (i / 16), t0 + 50 * i);
        await frames(3);
      } else if (m === 'impact') {
        if (!down) continue;
        await page.evaluate(() => { window.__fw.app.loop.timescale = 0.02; });
        // DRIFT (fraction of travel) moves the thumb sideways on the way up: a slice or a draw.
        const drift = Number(process.env.DRIFT || 0) * zinfo.travel;
        const tt = t0 + 800;
        for (let i = 1; i <= 8; i++) await pointer.move(zinfo.x + drift * (i / 8), zinfo.y + zinfo.depth - (zinfo.depth + 16) * (i / 8), tt + 33 * i);
        await pointer.up(zinfo.x + drift, zinfo.y - 16, tt + 33 * 8 + 1);
        down = false;
        await frames(1);
      } else if (m === 'down') {
        // Mid-downswing, finger still on the glass: the face and path already show the drift.
        if (!down) continue;
        const drift = Number(process.env.DRIFT || 0) * zinfo.travel;
        const tt = t0 + 800;
        for (let i = 1; i <= 6; i++) await pointer.move(zinfo.x + drift * (i / 6), zinfo.y + zinfo.depth - zinfo.depth * 0.8 * (i / 6), tt + 30 * i);
        await frames(3);
      } else if (m === 'next') {
        // The next shot's address (after the ball has stopped): putter views on a par 3.
        await page.evaluate(() => { window.__fw.app.loop.timescale = 4; });
        await waitPhase(page, ['aim', 'summary']);
        await page.evaluate(() => { window.__fw.app.loop.timescale = 1; });
        for (let i = 0; i < 40; i++) { const a = await page.evaluate(() => window.__fw.app.loop.stats.frame); await page.waitForTimeout(300); const b = await page.evaluate(() => window.__fw.app.loop.stats.frame); if (b > a + 6) break; }
        await frames(12);
      } else if (m === 'follow') {
        await page.evaluate(() => { window.__fw.app.loop.timescale = 0.25; });
        await page.waitForFunction(() => { const f = window.__fw.app.world.club.follow; return !f || f.t > 0.3; }, null, { polling: 30 });
        await page.evaluate(() => { window.__fw.app.loop.timescale = 0.02; });
        await frames(1);
      }
      if (m === 'follow' || m === 'impact') console.log(tag, m, 'club p', await page.evaluate(() => +window.__fw.app.world.club.p.toFixed(3)));
      const boxes = await page.evaluate(() => window.__fw.layoutBoxes());
      const res = check(boxes, W, H);
      const file = `${prefix}-${course}-${tag}-${m}${lefty ? '-lefty' : ''}.png`;
      await page.screenshot({ path: file });
      report.push({ size: tag, moment: m, file, ...res, boxes });
      console.log(tag, m, JSON.stringify(res));
    }
    await page.evaluate(() => { window.__fw.app.loop.timescale = 1; });
  } catch (e) { console.log(tag, 'FAILED', e.message.split('\n')[0]); report.push({ size: tag, failed: e.message.split('\n')[0] }); }
  if (errors.length) console.log(tag, 'console errors', errors.slice(0, 3).map((e) => e.text.slice(0, 200)));
  report.push({ size: tag, consoleErrors: errors.length });
  await ctx.close();
}
writeFileSync(`${prefix}-${course}${lefty ? '-lefty' : ''}.json`, JSON.stringify(report, null, 1));
await browser.close();
await server.close();
