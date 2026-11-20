// The aim preview leaves the wind out: in a windy round, read where the preview says the ball
// lands and the suggested power, then take the wind away and read them again (the preview is
// recomputed by an aim change, the power by a club change and back), then put the wind back.
// On a build where the preview ignores the wind, all three agree; on the build before, they do
// not. Then a real swing (touch, the HUD's suggested power) shows the ball itself still flies
// in the wind: where it lands against where the preview said. Screenshots of the preview.
//   node scripts/tools/wind-preview.mjs <out.json> [courses] [tag]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel, swing } from '../lib/drive.mjs';

const [outFile = 'qa/tmp/wind-preview.json', courseArg = 'links,standrews,parkland', tag = 'after'] = process.argv.slice(2);
mkdirSync(path.dirname(outFile), { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const rows = [];
for (const course of courseArg.split(',')) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  ctx.setDefaultTimeout(300000);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  const pointer = await createPointer(page, { touch: true });
  const row = { course, tag };
  try {
    await page.goto(`${server.url}/?mode=stroke&course=${course}&hole=1&holes=1&tier=low&scale=0.6&seed=11`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
    if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
    await waitPhase(page, 'aim');
    await page.waitForTimeout(800);
    const read = () => page.evaluate(() => {
      const st = window.__fw.game.state, p = st.prediction, l = p.carryPoint || p.end;
      return { land: { x: +l.x.toFixed(3), z: +l.z.toFixed(3) }, carry: +p.carry.toFixed(2), power: +window.__fw.game.suggestedPower().toFixed(4), windMph: st.windInfo.speedMph };
    });
    // Recompute the preview (an aim change to the same aim) and the power (a club change and back).
    const recompute = () => page.evaluate(() => {
      const g = window.__fw.game, st = g.state, id = st.club.id;
      g.selectClub(1);
      if (st.club.id === id) { g.selectClub(-1); g.selectClub(1); } else g.selectClub(-1);
      if (st.club.id !== id) throw new Error('club not restored');
      g.setAim(st.aim);
    });
    await recompute();
    const withWind = await read();
    // Still air: the same wind object (so the readout and everything else still work), whose
    // sampler, the only thing the ball flight reads, returns no wind.
    const windSaved = await page.evaluate(() => {
      const st = window.__fw.game.state, w = st.wind;
      window.__savedWind = w;
      st.wind = new Proxy(w, { get(t, k) { if (k === 'sample') return (tt, h, out) => { out.x = 0; out.y = 0; out.z = 0; return out; }; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });
      return true;
    });
    await recompute();
    const calm = await read();
    await page.evaluate(() => { window.__fw.game.state.wind = window.__savedWind; });
    await recompute();
    const back = await read();
    row.windMph = withWind.windMph;
    row.preview = { withWind, calm, back };
    row.previewMovesWithWind = +Math.hypot(withWind.land.x - calm.land.x, withWind.land.z - calm.land.z).toFixed(3);
    row.powerMovesWithWind = +Math.abs(withWind.power - calm.power).toFixed(4);
    row.previewIgnoresWind = windSaved && row.previewMovesWithWind < 0.01 && row.powerMovesWithWind < 1e-6 && Math.hypot(back.land.x - withWind.land.x, back.land.z - withWind.land.z) < 0.01;
    await page.screenshot({ path: path.join(path.dirname(outFile), `${tag}-${course}-preview.jpg`), type: 'jpeg', quality: 80 });
    // A real swing at the suggested power: the ball flies in the real wind.
    const before = await page.evaluate(() => { const st = window.__fw.game.state; return { x: st.ball.x, z: st.ball.z, preview: st.prediction.carryPoint || st.prediction.end }; });
    await swing(page, pointer, { power: withWind.power });
    await waitPhase(page, ['aim', 'summary', 'done'], 240000);
    const shot = await page.evaluate(() => { const s = window.__fw.game.state.lastShot; const r = s && s.result; const l = r && (r.carryPoint || r.end); return l ? { land: { x: l.x, z: l.z }, carry: r.carry, strike: s.strike && s.strike.label } : null; });
    if (shot) {
      row.shot = { carry: +shot.carry.toFixed(1), strike: shot.strike, offPreview: +Math.hypot(shot.land.x - before.preview.x, shot.land.z - before.preview.z).toFixed(1) };
    }
  } catch (e) { row.failed = e.message.split('\n')[0]; }
  row.consoleErrors = errors.length;
  console.log(course, JSON.stringify(row));
  rows.push(row);
  writeFileSync(outFile, JSON.stringify(rows, null, 1));
  await ctx.close();
}
await browser.close();
await server.close();
