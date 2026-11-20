// The renderer and physics agreement check (world.surfaceAgreement, the same one the smoke test
// runs) with the other holes drawn, on every course: the surface ids the real terrain shader
// draws and the mesh heights, against the terrain queries the ball uses. The smoke test runs on
// the Low tier, where the other holes are off by default, so this runs it with them forced on
// (?scenery=1) on the Medium tier. Same thresholds as the smoke test: at least 99 percent of
// samples agree and no mesh vertex is 2 cm or more from the physics height.
//   node scripts/tools/scenery-agreement.mjs <out.json> [courses] [tier]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { COURSES } from '../../src/course/courses.js';

const [outFile = 'qa/tmp/scenery-agreement.json', courseArg = COURSES.map((c) => c.id).join(','), tier = 'medium'] = process.argv.slice(2);
mkdirSync(path.dirname(outFile), { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const rows = [];
let failures = 0;
for (const course of courseArg.split(',')) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(300000);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  const row = { course, tier };
  try {
    await page.goto(`${server.url}/?course=${course}&tier=${tier}&scenery=1&smoke=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready === true, null);
    await page.evaluate(() => window.__fw.settle());
    row.scenery = await page.evaluate(() => window.__fw.sceneryStats());
    const ag = await page.evaluate(() => window.__fw.surfaceAgreement(96));
    Object.assign(row, { agreePct: +ag.agreePct.toFixed(2), samples: ag.samples, maxHeightError: +ag.maxHeightError.toFixed(4), heightSamples: ag.heightSamples });
    row.pass = !!row.scenery && row.scenery.holes > 0 && ag.agreePct >= 99 && ag.maxHeightError < 0.02 && ag.samples > 5000 && ag.heightSamples > 1000;
    // What the other holes add when a hole starts: their own build, and the outer ground with
    // their footprint against the same ground without (a second load with them off).
    await page.goto(`${server.url}/?course=${course}&tier=${tier}&scenery=0&smoke=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready === true, null);
    row.outerMsOff = await page.evaluate(() => +window.__fw.app.world.terrainView.outerMs.toFixed(1));
  } catch (e) { row.pass = false; row.failed = e.message.split('\n')[0]; }
  row.consoleErrors = errors.length;
  if (errors.length) row.pass = false;
  if (!row.pass) failures++;
  console.log(row.pass ? 'PASS' : 'FAIL', course, JSON.stringify({ agreePct: row.agreePct, maxHeightError: row.maxHeightError, holes: row.scenery && row.scenery.holes, buildMs: row.scenery && row.scenery.buildMs, outerMs: row.scenery && row.scenery.outerMs, outerMsOff: row.outerMsOff, consoleErrors: row.consoleErrors, failed: row.failed }));
  rows.push(row);
  await ctx.close();
}
writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), tier, rows }, null, 1));
console.log(`${rows.length - failures} of ${rows.length} courses pass`);
await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
