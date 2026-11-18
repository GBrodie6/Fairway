// Dev tool: replay angles, the putting grid in each color-vision palette, the spin display,
// and reduced motion, on the production build through real input.
//   node scripts/tools/replay.mjs qa/tmp/replay
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, swing, clickSel, aimTo } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/replay'] = process.argv.slice(2);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await serveStatic(path.resolve('dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
ctx.setDefaultTimeout(600000);
const errors = trackErrors(page);
const pointer = await createPointer(page, {});
const shot = (n) => page.screenshot({ path: `${prefix}-${n}.png` });
const tapText = async (t) => {
  const r = await page.evaluate((x) => { const b = [...document.querySelectorAll('#ui button')].find((e) => (e.textContent.trim() === x || e.textContent.trim().startsWith(x)) && e.offsetParent !== null); if (!b) return null; b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, t);
  if (!r) throw new Error(`no button ${t}`);
  await pointer.tap(r.x, r.y); await page.waitForTimeout(250);
};
const out = {};
try {
  // Par 3 (parkland hole 4) so the second shot is usually a putt.
  await page.goto(`${server.url}/?mode=stroke&course=parkland&hole=4&holes=1&tier=low&scale=0.6&timescale=4&bot=1&seed=21`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
  await waitPhase(page, 'aim');
  const ideal = await page.evaluate(() => window.__fw.game.suggestedPower());
  await swing(page, pointer, { power: ideal, backMs: 780, downMs: 260 });
  await waitPhase(page, ['aim', 'summary']);
  out.afterTee = await page.evaluate(() => ({ lie: window.__fw.gameView().lieName, dist: +window.__fw.gameView().distToPin.toFixed(1), canReplay: window.__fw.gameView().canReplay }));
  // Replay: the real button, then each angle from the replay bar.
  await clickSel(page, pointer, '[aria-label="Replay the last shot"]');
  await page.waitForFunction(() => { const b = document.querySelector('.replaybar'); return b && !b.classList.contains('hidden'); });
  out.replayPhase = await page.evaluate(() => window.__fw.phase());
  for (const a of ['Follow', 'Landing', 'Side', 'High']) {
    // A replay that finished on its own returns to aim; start it again from the button.
    if ((await page.evaluate(() => window.__fw.phase())) !== 'replay') { await clickSel(page, pointer, '[aria-label="Replay the last shot"]'); await page.waitForFunction(() => { const b = document.querySelector('.replaybar'); return b && !b.classList.contains('hidden'); }); }
    await tapText(a);
    await page.waitForTimeout(1200);
    await shot(`angle-${a.toLowerCase()}`);
    out[`angle${a}`] = await page.evaluate(() => ({ phase: window.__fw.phase(), angle: window.__fw.game.state.replayAngle, rig: window.__fw.app.world.rig.mode }));
  }
  await tapText('Done');
  out.afterDone = await page.evaluate(() => window.__fw.phase());
  // On the green: the grid in each palette, with the spin display switched on for the ball.
  if (out.afterTee.lie === 'Green') {
    const h = await page.evaluate(() => window.__fw.game.state.putt.heading);
    await aimTo(page, pointer, h);
    for (const pal of ['off', 'deuteranopia', 'protanopia', 'tritanopia']) {
      await page.evaluate((p) => { const a = window.__fw.app; a.settings.colorblind = p; a.settings.spinViz = true; a.ui.applySettings(); }, pal);
      await page.waitForTimeout(400);
      await shot(`grid-${pal}`);
    }
  }
  // Reduced motion: a new round goes straight to the shot with no flyover.
  await page.evaluate(() => { const a = window.__fw.app; a.settings.reducedMotion = true; a.ui.applySettings(); });
  await page.evaluate(() => window.__fw.game.quit());
  await page.waitForTimeout(300);
  await tapText('Quick Play');
  await tapText('Tee off');
  const seen = new Set();
  for (let i = 0; i < 60; i++) { seen.add(await page.evaluate(() => window.__fw.phase())); if (seen.has('aim')) break; await page.waitForTimeout(250); }
  out.reducedMotionPhases = [...seen];
  out.rigReduced = await page.evaluate(() => window.__fw.app.world.rig.reducedMotion);
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
await browser.close();
await server.close();
