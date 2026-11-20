// Screenshots of the other holes around the one in play, for the course scenery proof: for each
// course, size and hole, the address view on the tee, a mid-fairway view (the address camera
// set down halfway to the green) and the view on the green; on the first hole also the flyover
// and the course map (on builds that have one). Also records renderer.info, the scenery's own numbers and console
// errors. Works on builds before the scenery too (the "before" pictures).
//   node scripts/tools/scenery-shots.mjs <outDir> <tag> [courses] [sizes] [holes] [tier]
//   e.g. DIST=/path/to/dist node scripts/tools/scenery-shots.mjs qa/proof/scenery/shots after parkland 390x844,1920x1080 1,7,14 medium
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel } from '../lib/drive.mjs';

const [outDir = 'qa/tmp/scenery-shots', tag = 'after', courseArg = 'parkland', sizeArg = '390x844,1920x1080', holeArg = '1,7,14', tier = 'medium'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const report = [];
const views = (process.env.VIEWS || 'tee,mid,green').split(',');

for (const size of sizeArg.split(',')) {
  const [W, H] = size.split('x').map(Number);
  const phone = W < 900;
  for (const course of courseArg.split(',')) {
    // One page per course and size; each hole is started as a real round in it (the HUD then
    // shows that hole), without reloading the assets.
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone && W < H });
    ctx.setDefaultTimeout(600000);
    const page = await ctx.newPage();
    const errors = trackErrors(page);
    const pointer = await createPointer(page, { touch: phone });
    const holes = holeArg.split(',').map(Number);
    let first = true;
    for (const hole of holes) {
      const row = { size, course, hole, tag, shots: {} };
      try {
        if (first) {
          // Desktop at half the drawing resolution, so a software-rendered frame takes seconds,
          // not tens of seconds; the phone at its own size.
          await page.goto(`${server.url}/?mode=stroke&course=${course}&hole=${hole}&holes=1&tier=${tier}&bot=1&seed=7${phone ? '' : '&scale=0.5'}`, { waitUntil: 'load' });
          await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
        } else {
          await page.evaluate(({ course, hole }) => { window.__fw.game.startRound({ courseId: course, mode: 'stroke', holes: [hole - 1], seed: 7, tod: 'morning' }); }, { course, hole });
          await page.waitForFunction((h) => window.__fw.app.world.hole === h && ['intro', 'aim'].includes(window.__fw.phase()), hole, { timeout: 600000, polling: 200 });
        }
        if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
        await waitPhase(page, 'aim');
        await page.evaluate(() => window.__fw.settle && window.__fw.settle());
        row.scenery = await page.evaluate(() => (window.__fw.sceneryStats ? window.__fw.sceneryStats() : null));
        const list = first ? [...views, 'flyover'] : views;
        for (const v of list) {
          await page.evaluate((v) => {
            const w = window.__fw.app.world, h = w.holeData;
            if (v === 'tee') w.qaView('address');
            else if (v === 'mid') {
              const i = Math.floor(h.line.length * 0.5), p = h.line[i], g = h.green;
              w.qaView('address');
              w.placeAddressCamera(p.x, p.z, Math.atan2(g.x - p.x, -(g.z - p.z)));
              w.terrainView.updateLod(w.camera, true);
              if (w.vegetation) w.vegetation.forceUpdate();
            } else w.qaView(v);
          }, v);
          // Settle: frames until the draw calls stop changing.
          let last = '', same = 0;
          for (let i = 0; i < 30 && same < 3; i++) {
            const f0 = await page.evaluate(() => window.__fw.app.loop.stats.frame);
            await page.waitForFunction((f) => window.__fw.app.loop.stats.frame > f, f0, { polling: 50 });
            const k = await page.evaluate(() => { const st = window.__fw.app.engine.stats; return `${st.calls}/${st.triangles}`; });
            same = k === last ? same + 1 : 0; last = k;
          }
          const info = await page.evaluate(() => { const st = window.__fw.app.engine.stats; const sc = window.__fw.sceneryStats ? window.__fw.sceneryStats() : null; return { draws: st.calls, tris: st.triangles, scenery: sc ? { drawnHoles: sc.drawnHoles, drawnTris: sc.drawnTris } : null }; });
          const file = path.join(outDir, `${tag}-${course}-h${hole}-${size}-${v}.jpg`);
          await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
          row.shots[v] = { file, ...info };
          console.log(tag, course, hole, size, v, JSON.stringify(info));
        }
        // The course map, where this build has one (first hole only).
        if (first && process.env.MAP !== '0') {
          const has = await page.evaluate(() => !!(window.__fw.app.openCourseMap));
          if (has) {
            await page.evaluate(() => { window.__fw.app.world.rig.enabled = true; window.__fw.app.openCourseMap(); });
            await page.waitForTimeout(600);
            const boxes = await page.evaluate(() => window.__fw.courseMapBoxes());
            const file = path.join(outDir, `${tag}-${course}-h${hole}-${size}-map.jpg`);
            await page.screenshot({ path: file, type: 'jpeg', quality: 85 });
            row.shots.map = { file, labels: boxes ? boxes.labels.filter((l) => l.box).length : 0, missing: boxes ? boxes.labels.filter((l) => !l.box && l.inView).map((l) => l.text) : null };
            console.log(tag, course, hole, size, 'map', JSON.stringify(row.shots.map));
            await page.evaluate(() => window.__fw.ui.courseMap.close());
          }
        }
        await page.evaluate(() => { window.__fw.app.world.rig.enabled = true; });
      } catch (e) { row.failed = e.message.split('\n')[0]; console.log(tag, course, hole, size, 'FAILED', row.failed); }
      row.consoleErrors = errors.length;
      row.errors = errors.slice(0, 5).map((e) => e.text.slice(0, 200));
      report.push(row);
      writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(report, null, 1));
      first = false;
    }
    if (errors.length) console.log(tag, course, size, 'console errors', errors.length, errors.slice(0, 3).map((e) => e.text.slice(0, 160)));
    await ctx.close();
  }
}
await browser.close();
await server.close();
