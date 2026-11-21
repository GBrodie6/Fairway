// The maps and the scenery inside a community hole: from the creator's Create tile, a template,
// Test play, then the hole map (the map button) and its Course toggle, through real taps or
// clicks. A community hole is a course of one hole: no other holes are drawn around it, and the
// course map shows that one hole. Records what each map shows, the scenery's numbers and
// console errors, with screenshots.
//   node scripts/tools/level-maps.mjs <outDir> [sizes]
//   URL=https://... runs it against a deployed copy instead of a local build.
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel } from '../lib/drive.mjs';

const [outDir = 'qa/tmp/level-maps', sizeArg = '390x844,1920x1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const rows = [];
for (const size of sizeArg.split(',')) {
  const [W, H] = size.split('x').map(Number);
  const phone = W < 900;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone && W < H });
  ctx.setDefaultTimeout(300000);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  const pointer = await createPointer(page, { touch: phone });
  const row = { size, checks: [] };
  const check = (name, pass, detail) => { row.checks.push({ name, pass: !!pass, detail }); console.log(size, pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); };
  const tapText = async (text, starts = false) => {
    const r = await page.evaluate(([t, s]) => {
      const b = [...document.querySelectorAll('#ui button')].find((e) => (s ? e.textContent.trim().startsWith(t) : e.textContent.trim() === t) && e.offsetParent !== null && !e.disabled);
      if (!b) return null;
      b.scrollIntoView({ block: 'center' });
      const q = b.getBoundingClientRect();
      return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
    }, [text, starts]);
    if (!r) throw new Error(`no button "${text}"`);
    await pointer.tap(r.x, r.y);
    await page.waitForTimeout(400);
  };
  const shot = (n) => page.screenshot({ path: path.join(outDir, `${size}-${n}.jpg`), type: 'jpeg', quality: 80 });
  try {
    // Medium on the desktop, where Show other holes is on by default; Low with it forced on
    // for the phone, so both paths that would build the scenery are tried.
    await page.goto(`${server.url}/?cloud=demo&bot=1&seed=5${phone ? '&tier=low&scenery=1&scale=0.6' : '&tier=medium&scale=0.5'}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
    await page.waitForTimeout(800);
    await tapText('Create', true);
    await tapText('Short par 3 over water');
    await tapText('Test play');
    if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
    await waitPhase(page, 'aim');
    await page.evaluate(() => window.__fw.settle && window.__fw.settle());
    const round = await page.evaluate(() => ({ course: window.__fw.app.world.course.id, level: !!window.__fw.app.world.course.level, holes: window.__fw.game.state.round.holes.length, otherHoles: window.__fw.app.world.otherHoles }));
    row.round = round;
    check('the test play is a community hole of one hole', round.level && round.holes === 1, round);
    const sc = await page.evaluate(() => window.__fw.sceneryStats());
    check('no other holes are built around it', sc === null, sc);
    await shot('1-address');
    check('the map button opens the hole map', (await clickSel(page, pointer, '[aria-label="Hole map and rangefinder"]')) && (await page.waitForFunction(() => window.__fw.ui.map.open, null, { timeout: 10000 }).then(() => true).catch(() => false)));
    await page.waitForTimeout(500);
    await shot('2-hole-map');
    check('the hole map has a Course toggle', await clickSel(page, pointer, '.mapwrap .mapseg button:last-child'));
    const opened = await page.waitForFunction(() => window.__fw.ui.courseMap.open, null, { timeout: 10000 }).then(() => true).catch(() => false);
    check('Course opens the course map', opened);
    await page.waitForTimeout(600);
    const boxes = await page.evaluate(() => window.__fw.courseMapBoxes());
    const labels = boxes ? boxes.labels.map((l) => ({ text: l.text, placed: !!l.box })) : null;
    row.courseMap = { labels, title: await page.evaluate(() => { const t = document.querySelector('.coursemap .cmtitle, .coursemap h2, .coursemap .chip'); return t ? t.textContent : null; }) };
    check('the course map shows the one hole and labels it', labels && labels.filter((l) => /^\d+$/.test(l.text)).length === 1 && labels.every((l) => l.placed), labels);
    await shot('3-course-map');
    // Back to the hole map with the Hole toggle, then close with the close button.
    await clickSel(page, pointer, '.coursemap .cmseg button:first-child');
    await page.waitForTimeout(500);
    const back = await page.evaluate(() => ({ courseMap: window.__fw.ui.courseMap.open, holeMap: window.__fw.ui.map.open }));
    check('Hole goes back to the hole map', !back.courseMap && back.holeMap, back);
    await clickSel(page, pointer, '.mapwrap .close');
    await page.waitForTimeout(400);
    const closed = await page.evaluate(() => ({ courseMap: window.__fw.ui.courseMap.open, holeMap: window.__fw.ui.map.open, phase: window.__fw.phase() }));
    check('the maps close and play goes on', !closed.courseMap && !closed.holeMap && closed.phase === 'aim', closed);
  } catch (e) { row.failed = e.message.split('\n')[0]; console.log(size, 'FAILED', row.failed); }
  row.consoleErrors = errors.length;
  row.errors = errors.slice(0, 5).map((e) => e.text.slice(0, 200));
  check('no console errors', errors.length === 0, row.errors);
  rows.push(row);
  writeFileSync(path.join(outDir, 'level-maps.json'), JSON.stringify(rows, null, 1));
  await ctx.close();
}
await browser.close();
await server.close();
const failed = rows.flatMap((r) => r.checks.filter((c) => !c.pass)).length + rows.filter((r) => r.failed).length;
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
