// Shoot named QA views from a built copy of the game (any dist folder).
//   node scripts/tools/views.mjs <distDir> "<query>" <outPrefix> <view,view,...> [w] [h]
// A view "tod:<preset>" switches the time of day. Prints luma and clipping per view.
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';

const [dir, query, prefix, viewList, w = '640', h = '360'] = process.argv.slice(2);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await serveStatic(path.resolve(dir));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
ctx.setDefaultTimeout(300000); ctx.setDefaultNavigationTimeout(300000);
const page = await ctx.newPage();
const errors = trackErrors(page);
try {
  await page.goto(`${server.url}/?${query}&smoke=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready);
  await page.evaluate(() => { const s = document.querySelector('.screen'); if (s) s.style.display = 'none'; });
  await page.evaluate(() => window.__fw.settle());
  for (const v of viewList.split(',')) {
    const m = await page.evaluate(async (name) => {
      let ok = true;
      if (name.startsWith('tod:')) { await window.__fw.setTimeOfDay(name.slice(4)); await window.__fw.settle(); window.__fw.view('address'); } else ok = window.__fw.view(name);
      await new Promise((r) => setTimeout(r, 300));
      const r = window.__fw.measure(8);
      return { ok, luma: +r.luma.toFixed(1), clip: +r.clippedPct.toFixed(2), calls: r.calls, tris: r.triangles };
    }, v);
    await page.screenshot({ path: `${prefix}-${v.replace(':', '_')}.png` });
    console.log(v, JSON.stringify(m));
  }
} catch (e) { console.log('FAILED', e.message.split('\n')[0]); }
if (errors.length) console.log('ERRORS', errors.length, errors.slice(0, 3).map((e) => e.text.slice(0, 300)));
await browser.close();
await server.close();
