// Dev tool: screenshot the game from the Vite dev server.
//   node scripts/tools/shot.mjs "course=parkland&tod=morning&tier=high" out.png [width] [height] [evalJs]
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';

const [query = '', out = 'qa/tmp/shot.png', w = '1280', h = '720', evalJs = '', views = ''] = process.argv.slice(2);
const server = await createServer({ logLevel: 'error', server: { port: 5198, host: '127.0.0.1' } });
await server.listen();
const { browser } = await launchBrowser();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const errors = trackErrors(page);
page.on('console', (m) => { if (m.type() === 'warning' && !/GPU stall|GL Driver/.test(m.text())) console.log('warn:', m.text().slice(0, 240)); });
const t0 = Date.now();
try {
  await page.goto(`http://127.0.0.1:5198/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  await page.evaluate(() => window.__fw.settle());
  if (evalJs) console.log('eval:', JSON.stringify(await page.evaluate(evalJs)));
  const m = await page.evaluate(() => { const r = window.__fw.measure(); const i = window.__fw.info(); return { luma: +r.luma.toFixed(1), clip: +r.clippedPct.toFixed(2), exp: +r.exposure.toFixed(3), calls: r.calls, tris: r.triangles, tier: i.tier, mem: i.memory, guard: window.__fw.errors }; });
  console.log(JSON.stringify(m), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  // Extra named views: "flyover,green,bunker" writes out-flyover.png and so on.
  for (const v of views ? views.split(',') : []) {
    // "tod:dusk" switches the preset instead of moving the camera.
    const ok = await page.evaluate(async (name) => {
      let r = true;
      if (name.startsWith('tod:')) { await window.__fw.setTimeOfDay(name.slice(4)); await window.__fw.settle(); } else r = window.__fw.view(name);
      const m = window.__fw.measure();
      return { ok: r, luma: +m.luma.toFixed(1), clip: +m.clippedPct.toFixed(2), exp: +m.exposure.toFixed(2), env: window.__fw.app.world.sky.envSource };
    }, v);
    console.log('view', v, JSON.stringify(ok));
    await page.screenshot({ path: out.replace(/\.png$/, `-${v.replace(':', '_')}.png`) });
  }
} catch (e) { console.log('FAILED', e.message.split('\n')[0]); }
if (errors.length) console.log('ERRORS', errors.length, errors.slice(0, 4).map((e) => e.text.slice(0, 500)));
await browser.close();
await server.close();
