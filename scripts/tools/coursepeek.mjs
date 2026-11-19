// Tee views and hole maps of chosen holes, for a look at a course.
//   node scripts/tools/coursepeek.mjs <outPrefix> <courseId> <holes like 1,12,16> [390x844] [tier]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/peek/p', course = 'augusta', holesArg = '1', size = '390x844', tier = 'low'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const out = { course, size, holes: [] };
for (const hole of holesArg.split(',').map(Number)) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
  ctx.setDefaultTimeout(300000);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  try {
    await page.goto(`${server.url}/?mode=stroke&course=${course}&hole=${hole}&holes=1&tier=${tier}&scale=0.6&bot=1&seed=3&tod=${process.env.TOD || 'midday'}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
    if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await page.evaluate(() => document.querySelector('.intro-skip') && document.querySelector('.intro-skip').click());
    await waitPhase(page, 'aim');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${prefix}-${course}-${hole}-${size}-tee.png` });
    const info = await page.evaluate(() => { const v = window.__fw.game.view(); const t = window.__fw.app.world.terrain; return { yards: v.yards, par: v.par, name: window.__fw.app.world.course ? window.__fw.app.world.course.name : null, conditions: t.conditions, water: t.hole.water.map((w) => w.type + ':' + (w.role || '')), sea: !!t.hole.sea, double: !!t.hole.double, bunkers: t.hole.bunkers.length }; });
    await page.evaluate(() => window.__fw.app.ui.map.open && window.__fw.app.ui.map.toggle ? window.__fw.app.ui.map.toggle() : (document.querySelector('[aria-label="Hole map and rangefinder"]') || {}).click && document.querySelector('[aria-label="Hole map and rangefinder"]').click());
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${prefix}-${course}-${hole}-${size}-map.png` });
    out.holes.push({ hole, ...info, errors: errors.map((e) => e.text.slice(0, 160)) });
  } catch (e) { out.holes.push({ hole, failed: e.message.split('\n')[0] }); }
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${prefix}-${course}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
