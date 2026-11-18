// The practice ground through real taps and real swings on the production build: the lobby,
// a session in the chosen drill, the per-shot readout, the dispersion map, and the summary.
// Also frames the scene from fixed cameras (bays, field, targets, clubhouse, lights at dusk).
//   node scripts/tools/range.mjs qa/tmp/range/r [390x844] [mode] [balls] [tod]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { createPointer, waitPhase, swing } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/range/r', size = '390x844', mode = 'free', ballsArg = '4', tod = 'morning'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const balls = Number(ballsArg);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
ctx.setDefaultTimeout(240000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: true });
const out = { size, mode, tod, shots: [], screens: {} };
const shot = (n) => page.screenshot({ path: `${prefix}-${size}-${mode}-${n}.png` });
const tapButton = async (text, startsWith = false) => {
  const r = await page.evaluate(([t, sw]) => {
    const b = [...document.querySelectorAll('#ui button')].find((e) => (sw ? e.textContent.trim().startsWith(t) : e.textContent.trim() === t) && e.offsetParent !== null && !e.disabled);
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const q = b.getBoundingClientRect();
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
  }, [text, startsWith]);
  if (!r) throw new Error(`no button "${text}"`);
  await pointer.tap(r.x, r.y); await page.waitForTimeout(450);
};
const measure = (name) => page.evaluate((n) => {
  const s = document.querySelector('.screen:not(.hidden) .sheet') || document.querySelector('.sheet');
  if (!s) return { name: n, none: true };
  const vw = document.documentElement.clientWidth;
  const over = [...s.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }).map((e) => e.className || e.tagName).slice(0, 5);
  const small = [...s.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.height < 40 || r.width < 40); }).map((b) => `${b.textContent.trim().slice(0, 16)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
  return { name: n, overflow: over, smallButtons: small, docScroll: document.documentElement.scrollWidth > vw };
}, name);
// HUD boxes during play: the shot card against the other HUD pieces.
const hudCheck = () => page.evaluate(() => {
  const b = window.__fw.layoutBoxes ? window.__fw.layoutBoxes() : null;
  const card = document.querySelector('.shotcard');
  if (!b || !card || card.classList.contains('hidden')) return { card: null };
  const c = card.getBoundingClientRect();
  const hit = (r) => c.left < r.x + r.w && r.x < c.right && c.top < r.y + r.h && r.y < c.bottom;
  return { card: [Math.round(c.x), Math.round(c.y), Math.round(c.right), Math.round(c.bottom)], overlaps: Object.entries(b.hud).filter(([, r]) => hit(r)).map(([k]) => k), zone: !!(b.zone && hit(b.zone)) };
});
try {
  await page.goto(`${server.url}/?tier=low&scale=0.6&timescale=4`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await page.waitForTimeout(600);
  await tapButton('Driving range');
  if (mode !== 'free') await tapButton({ target: 'Target points', longdrive: 'Long drive', ladder: 'Wedge ladder', shape: 'Shape shots', streak: 'Pressure streak', test: 'Club test lane' }[mode], true);
  if (tod === 'dusk') await tapButton('Evening lights');
  if (process.env.GRASS) await tapButton('Grass');
  await shot('lobby');
  out.screens.lobby = await measure('lobby');
  await tapButton('Start');
  await waitPhase(page, 'aim');
  await page.waitForTimeout(900);
  if (await page.evaluate(() => [...document.querySelectorAll('#ui button')].some((b) => b.textContent.trim() === 'Skip' && b.offsetParent !== null))) await tapButton('Skip');
  await shot('address');
  out.hudStart = await page.evaluate(() => ({ hole: document.querySelector('.holebox').innerText.replace(/\n/g, ' / '), score: document.querySelector('.scorebox').innerText.replace(/\n/g, ' / '), club: window.__fw.game.state.club.id, target: window.__fw.game.state.rangeTarget && window.__fw.game.state.rangeTarget.yards }));
  for (let i = 0; i < balls; i++) {
    await waitPhase(page, 'aim');
    // Swing at the suggested power with a human-like spread.
    const ideal = await page.evaluate(() => window.__fw.game.suggestedPower());
    await swing(page, pointer, { power: Math.min(1, ideal * (0.97 + (i % 3) * 0.03)), backMs: 760 + (i % 4) * 30, downMs: 250 + (i % 2) * 20, drift: (i % 3 - 1) * 0.04 });
    await waitPhase(page, 'aim', 120000);
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => { const r = window.__fw.app.rangeSession(); const last = r && r.shots[r.shots.length - 1]; return last && { club: last.club, carry: +last.carry.toFixed(1), total: +last.total.toFixed(1), offline: +last.offline.toFixed(1), curve: +last.curve.toFixed(1), ballSpeed: +last.ballSpeed.toFixed(1), launch: +last.launch.toFixed(1), spin: Math.round(last.spin), apex: +last.apex.toFixed(1), strike: last.strike && last.strike.kind, msg: r.last && r.last.message, score: r.score, used: r.used, over: r.over }; });
    out.shots.push(s);
    if (i === 0) { await shot('card'); out.hud1 = await hudCheck(); out.card = await page.evaluate(() => document.querySelector('.shotcard').innerText.replace(/\n/g, ' / ')); }
    if (s && s.over) break;
  }
  const over = await page.evaluate(() => { const r = window.__fw.app.rangeSession(); return !r || r.over; });
  if (!over) {
    // The dispersion map from the map button, then end the session from it.
    await page.evaluate(() => window.__fw.ui.hud.hideShotCard());
    const mb = await page.evaluate(() => { const b = document.querySelector('.topright .roundbtn'); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
    await pointer.tap(mb.x, mb.y); await page.waitForTimeout(600);
    await shot('map');
    out.screens.map = await measure('map');
    await tapButton('End session');
  } else await page.waitForTimeout(2600);
  await page.waitForTimeout(600);
  await shot('summary');
  out.screens.summary = await measure('summary');
  out.summary = await page.evaluate(() => document.querySelector('.screen:not(.hidden) .sheet') && document.querySelector('.screen:not(.hidden) .sheet').innerText.split('\n').slice(0, 6).join(' / '));
  out.save = await page.evaluate(() => { const s = window.__fw.app.save(); return { range: s.range, xp: s.profile && s.profile.xp, tokens: s.wallet.tokens }; });
  // Scene views from fixed cameras: behind the bays, the field from above the tee line, the
  // targets from the side, the clubhouse, and the cart.
  await tapButton('Range menu');
  await tapButton('Start');
  await waitPhase(page, 'aim');
  await page.waitForTimeout(800);
  const views = {
    bays: [8, 4.2, 14, -2, 1, -12],
    field: [0, 16, 12, 0, 0, -150],
    targets: [60, 22, -140, 0, 0, -170],
    clubhouse: [10, 6, -14, 0, 3, 34],
  };
  await page.evaluate(() => window.__fw.app.world.overlays.hide());
  for (const [name, v] of Object.entries(views)) {
    await page.evaluate((c) => { const w = window.__fw.app.world; w.rig.enabled = false; const t = w.terrain; const y0 = t.heightAt(c[0], c[2]), y1 = t.heightAt(c[3], c[5]); w.camera.position.set(c[0], y0 + c[1], c[2]); w.camera.lookAt(c[3], y1 + c[4], c[5]); w.camera.updateMatrixWorld(true); w.terrainView.updateLod(w.camera, true); if (w.vegetation) w.vegetation.forceUpdate(); }, v);
    await page.waitForTimeout(700);
    await shot(`view-${name}`);
  }
  // The picker cart, wherever it is on its loop.
  await page.evaluate(() => { const w = window.__fw.app.world, p = w.rangeProps.cartPosition(); if (!p) return; w.camera.position.set(p.x + 9, p.y + 4, p.z + 9); w.camera.lookAt(p.x, p.y + 0.8, p.z); w.camera.updateMatrixWorld(true); w.terrainView.updateLod(w.camera, true); if (w.vegetation) w.vegetation.forceUpdate(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const w = window.__fw.app.world, p = w.rangeProps.cartPosition(); w.camera.position.set(p.x + 9, p.y + 4, p.z + 9); w.camera.lookAt(p.x, p.y + 0.8, p.z); w.camera.updateMatrixWorld(true); });
  await shot('view-cart');
  out.rangeInfo = await page.evaluate(() => window.__fw.app.world.rangeInfo);
  out.lieAtBay = await page.evaluate(() => window.__fw.gameView().lieName);
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${prefix}-${size}-${mode}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
