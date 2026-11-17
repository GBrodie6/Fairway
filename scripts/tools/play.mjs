// Dev tool: play shots through the real input pipeline and screenshot each phase.
//   node scripts/tools/play.mjs "mode=stroke&course=parkland&hole=3&holes=1&tier=medium" qa/tmp/play [shots] [w] [h] [touch]
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { waitPhase, createPointer, swing, dragAim, clickSel, aimTo } from '../lib/drive.mjs';

const [query = 'mode=stroke&holes=1', prefix = 'qa/tmp/play', shotsArg = '3', w = '960', h = '540', touchArg = '0'] = process.argv.slice(2);
const touch = touchArg === '1';
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await createServer({ logLevel: 'error', server: { port: 5198, host: '127.0.0.1' } });
await server.listen();
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch });
const shot = async (name) => { await page.screenshot({ path: `${prefix}-${name}.png` }); };
const view = () => page.evaluate(() => { const v = window.__fw.gameView(); return v && { phase: v.phase, hole: v.hole, strokes: v.strokes, dist: +v.distToPin.toFixed(1), club: v.club.id, shotType: v.shotType.id, lie: v.lieName, ideal: +v.suggestedPower.toFixed(3), aim: +v.aim.toFixed(4), hazard: v.hazard, message: v.message, putt: v.putt && { breakM: +v.putt.breakM.toFixed(2), ideal: +v.putt.idealPower.toFixed(3) } }; });
const t0 = Date.now();
try {
  await page.goto(`http://127.0.0.1:5198/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  await page.evaluate(() => window.__fw.settle());
  let ph = await waitPhase(page, ['intro', 'aim', 'ai']);
  if (ph === 'intro') {
    await page.waitForTimeout(1500);
    await shot('0-flyover');
    await clickSel(page, pointer, '.intro-skip');
    ph = await waitPhase(page, ['aim', 'ai']);
  }
  console.log('ready', `${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(await view()));
  const shots = Number(shotsArg);
  for (let s = 1; s <= shots; s++) {
    ph = await waitPhase(page, ['aim', 'summary', 'done']);
    if (ph !== 'aim') break;
    await page.waitForTimeout(400);
    const before = await view();
    await shot(`${s}-aim`);
    if (s === 1 && await page.evaluate(() => !!document.querySelector('.tip:not(.hidden)'))) {
      await shot('tutorial');
      await clickSel(page, pointer, '.tip .row button:last-child');
    }
    if (s === 1) {
      // Prove drag-to-aim and the reset button.
      await dragAim(page, pointer, 60);
      const a = await view();
      await clickSel(page, pointer, '[aria-label="Aim back at the target"]');
      const b = await view();
      console.log('drag aim', JSON.stringify({ before: before.aim, dragged: a.aim, reset: b.aim }));
      // The map with the rangefinder.
      await clickSel(page, pointer, '[aria-label="Hole map and rangefinder"]');
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => window.__fw.rect('.mapwrap canvas'));
      if (r) await pointer.tap(r.x + r.w * 0.5, r.y + r.h * 0.3);
      await page.waitForTimeout(200);
      await shot(`${s}-map`);
      console.log('map readout', await page.evaluate(() => document.querySelector('.mapwrap .chip').textContent));
      await clickSel(page, pointer, '[aria-label="Close map"]');
    }
    let v = await view();
    if (v.putt) {
      // Read the break: aim along the solved line.
      const h = await page.evaluate(() => window.__fw.game.state.putt.heading);
      const taps = await aimTo(page, pointer, h);
      v = await view();
      console.log('putt read', JSON.stringify({ ...taps, aim: v.aim, solved: +h.toFixed(4), breakM: v.putt.breakM }));
      await shot(`${s}-putt-read`);
    }
    const power = v.putt ? v.putt.ideal : v.ideal;
    const sw = await swing(page, pointer, { power, backMs: v.putt ? 600 : 780, downMs: v.putt ? 220 : 260 });
    const got = await page.evaluate(() => { const r = window.__fw.ui.hud.stick.lastResult; return r && { power: +r.power.toFixed(3), face: +r.face.toFixed(2), path: +r.path.toFixed(2), tempo: r.tempoLabel, ratio: +r.tempoRatio.toFixed(2) }; });
    console.log(`shot ${s}`, JSON.stringify({ before: v, swing: got, travel: sw.travel }));
    // Flight frames.
    let k = 0;
    const tf = Date.now();
    while (k < 4) {
      const p = await page.evaluate(() => window.__fw.phase());
      if (p !== 'flight') break;
      await page.waitForTimeout(k === 0 ? 600 : 1400);
      if ((await page.evaluate(() => window.__fw.phase())) !== 'flight') break;
      await shot(`${s}-flight${k}`); k++;
    }
    await waitPhase(page, ['settle', 'aim', 'summary', 'done', 'ai']);
    await shot(`${s}-result`);
    await waitPhase(page, ['aim', 'summary', 'done', 'ai']);
    const after = await view();
    const info = await page.evaluate(() => { const i = window.__fw.info(); return { calls: i.stats.calls, tris: i.stats.triangles, cpu: +i.cpuAvg.toFixed(1) }; });
    console.log(`result ${s}`, `${((Date.now() - tf) / 1000).toFixed(1)}s`, JSON.stringify({ after, toast: await page.evaluate(() => document.querySelector('.toast').textContent), info }));
  }
  const fin = await page.evaluate(() => window.__fw.phase());
  if (fin === 'summary' || fin === 'done') { await page.waitForTimeout(500); await shot('summary'); }
} catch (e) { console.log('FAILED', e.message.split('\n')[0]); await shot('failed').catch(() => {}); }
console.log('guard', JSON.stringify(await page.evaluate(() => window.__fw.errors).catch(() => null)));
if (errors.length) console.log('ERRORS', errors.length, errors.slice(0, 5).map((e) => e.text.slice(0, 400)));
await browser.close();
await server.close();
