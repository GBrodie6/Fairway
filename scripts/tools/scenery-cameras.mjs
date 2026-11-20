// The cameras over the other holes: on each course, aim a full driver at the nearest other hole
// (the aim is set through the game's aim, the swing is a real drag on the swing area) so the ball
// flies off this hole toward it, and while the ball-follow camera trails it, read every frame
// the camera's height above the ground that is drawn under it and its distance to the nearest
// tree of another hole that is still drawn full size (trees shrink away inside 14 m). Also the
// flyover, address and green views, which must draw other holes. Screenshots along the flight.
//   node scripts/tools/scenery-cameras.mjs <outDir> [courses] [size] [tier]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel, swing } from '../lib/drive.mjs';

const [outDir = 'qa/tmp/scenery-cameras', courseArg = 'parkland,links,desert,alpine,tropical,augusta,standrews', size = '390x844', tier = 'medium'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const [W, H] = size.split('x').map(Number);
const touch = W < 900;
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const rows = [];
for (const course of courseArg.split(',')) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch && W < H });
  ctx.setDefaultTimeout(300000);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  const pointer = await createPointer(page, { touch });
  const row = { course, size, tier };
  try {
    await page.goto(`${server.url}/?mode=stroke&course=${course}&hole=1&holes=1&tier=${tier}&scale=0.6&seed=7&scenery=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
    if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
    await waitPhase(page, 'aim');
    await page.evaluate(() => window.__fw.settle());
    // The views that must show other holes.
    row.views = {};
    for (const v of ['address', 'flyover', 'green']) {
      row.views[v] = await page.evaluate((v) => { const w = window.__fw.app.world; w.qaView(v); w.scenery.update(w.camera); return w.scenery.stats().drawnHoles; }, v);
    }
    await page.evaluate(() => { const w = window.__fw.app.world; w.rig.enabled = true; window.__fw.game.returnToAddress && window.__fw.game.returnToAddress(); });
    // Aim at the nearest other hole's drape, from the tee.
    const target = await page.evaluate(() => {
      const w = window.__fw.app.world, t = w.terrain, sc = w.scenery, pts = sc.corners();
      let best = null;
      for (const [x, z] of pts) { const d = Math.hypot(x - t.tee.x, z - t.tee.z); if (d > 140 && d < 260 && (!best || d < best.d)) best = { x, z, d }; }
      if (!best) for (const [x, z] of pts) { const d = Math.hypot(x - t.tee.x, z - t.tee.z); if (!best || d < best.d) best = { x, z, d }; }
      const g = window.__fw.game, st = g.state;
      g.setAim(Math.atan2(best.x - st.ball.x, -(best.z - st.ball.z)));
      return best;
    });
    row.target = { d: Math.round(target.d) };
    await page.waitForTimeout(600);
    // Trees of other holes, drawn full size (outside the 14 to 24 m shrink), for the clearance.
    await page.evaluate(() => {
      const w = window.__fw.app.world, sc = w.scenery;
      window.__treePts = sc.corners().slice(-sc.stats().trees);
      window.__camLog = [];
      const t0 = performance.now();
      const step = () => {
        const cam = w.camera.position, t = w.terrain;
        const inGrid = cam.x > t.x0 && cam.x < t.maxX && cam.z > t.z0 && cam.z < t.maxZ;
        const ground = inGrid ? t.heightAt(cam.x, cam.z) : w.terrainView.outerSurfaceAt(cam.x, cam.z);
        let near = Infinity;
        for (const [x, z] of window.__treePts) near = Math.min(near, Math.hypot(x - cam.x, z - cam.z));
        window.__camLog.push({ t: performance.now() - t0, phase: window.__fw.phase(), y: +(cam.y - ground).toFixed(2), near: +near.toFixed(1), inGrid, mode: w.rig.mode });
        if (window.__camLog.length < 4000 && ['aim', 'flight'].includes(window.__fw.phase())) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await swing(page, pointer, { power: 1 });
    // Screenshots in flight.
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(outDir, `${course}-${size}-flight${i}.jpg`), type: 'jpeg', quality: 80 });
    }
    await waitPhase(page, ['aim', 'summary', 'done'], 240000).catch(() => {});
    const log = await page.evaluate(() => window.__camLog);
    const flight = log.filter((s) => s.phase === 'flight');
    row.frames = flight.length;
    row.outsideGridFrames = flight.filter((s) => !s.inGrid).length;
    row.minHeight = flight.length ? Math.min(...flight.map((s) => s.y)) : null;
    // A tree within 14 m of the camera is shrunk to nothing; this is the nearest one drawn.
    row.minTreeDistance = flight.length ? Math.min(...flight.map((s) => s.near)) : null;
    row.result = await page.evaluate(() => { const s = window.__fw.game.state; return { phase: window.__fw.phase(), lastShot: s.lastShot ? { oob: !!s.lastShot.oob, water: !!s.lastShot.water } : null }; });
    row.pass = row.views.address >= 0 && row.views.flyover > 0 && row.frames > 10 && row.minHeight > 0.3;
  } catch (e) { row.pass = false; row.failed = e.message.split('\n')[0]; }
  row.consoleErrors = errors.length;
  if (errors.length) { row.pass = false; row.errors = errors.slice(0, 3).map((e) => e.text.slice(0, 160)); }
  console.log(row.pass ? 'PASS' : 'FAIL', course, JSON.stringify(row));
  rows.push(row);
  writeFileSync(path.join(outDir, 'cameras.json'), JSON.stringify(rows, null, 1));
  await ctx.close();
}
await browser.close();
await server.close();
