// The shot panel through real touch: open it, set a draw, a fade and straight with the quick
// buttons, drag the dot up and down, pick a Stinger, and read the panel's curve and roll and
// the bent fan. Then on the range hit a draw, a fade and a stinger with real swing drags and
// record carry and curve for each.
//   node scripts/tools/shotpanel.mjs qa/tmp/shot/s [390x844]   (URL=https://... for a deployed copy)
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel, swing } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/shot/s', size = '390x844'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
ctx.setDefaultTimeout(300000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: true });
const out = { size, panel: {}, range: [] };
const shot = (n) => page.screenshot({ path: `${prefix}-${size}-${n}.png` });
const center = async (sel) => page.evaluate((s) => { const e = typeof s === 'string' ? document.querySelector(s) : null; if (!e || e.offsetParent === null) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
const tap = async (sel) => { const c = await center(sel); if (!c) throw new Error(`no ${sel}`); await pointer.tap(c.x, c.y); await page.waitForTimeout(450); };
const tapText = async (text, scope = '.shotpanel') => {
  const c = await page.evaluate(([t, sc]) => { const b = [...document.querySelectorAll(`${sc} button`)].find((e) => e.textContent.trim().startsWith(t) && e.offsetParent !== null); if (!b) return null; b.scrollIntoView({ block: 'nearest', inline: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, [text, scope]);
  if (!c) throw new Error(`no button ${text}`);
  await pointer.tap(c.x, c.y); await page.waitForTimeout(500);
};
const read = () => page.evaluate(() => { const g = window.__fw.game, st = g.state; return { spin: g.spin(), range: +g.spinRange().toFixed(3), shot: st.shotType.id, club: st.club.id, readout: document.querySelector('.padread') ? document.querySelector('.padread').textContent : '', carryYd: st.prediction ? +(st.prediction.carry / 0.9144).toFixed(1) : null, curveYd: g.spinReadout() ? +(g.spinReadout().curve / 0.9144).toFixed(1) : null, rollYd: g.spinReadout() ? +(g.spinReadout().roll / 0.9144).toFixed(1) : null }; });
// Drag the dot on the pad from the center toward (fx, fy) in pad units.
const dragDot = async (fx, fy) => {
  const r = await page.evaluate(() => { const b = document.querySelector('.padball').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, tx = cx + fx * r.w / 2, ty = cy - fy * r.h / 2;
  const pts = []; for (let i = 0; i <= 10; i++) pts.push({ x: cx + (tx - cx) * i / 10, y: cy + (ty - cy) * i / 10, t: i * 30 });
  await pointer.path(pts); await page.waitForTimeout(600);
};
try {
  await page.goto(`${server.url}/?tier=low&scale=0.5&bot=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  // The range: every swing tees up a new ball in the same bay.
  await page.evaluate(() => { window.__fw.app.ui.screens.hide(); return window.__fw.game.startRange({ bay: 2, surface: 'grass', tod: 'morning', players: [{ kind: 'human', name: 'You', ball: '#ffffff' }] }); });
  await waitPhase(page, 'aim');
  await page.evaluate(() => { window.__fw.game.setRangeTarget(null, 200); window.__fw.game.setClub('I5'); });
  await page.waitForTimeout(800);
  await shot('1-address');
  await tap('.spinbtn');
  out.panel.open = await read();
  await shot('2-panel');
  await tapText('Draw'); out.panel.draw = await read(); await shot('3-draw');
  await tapText('Fade'); out.panel.fade = await read(); await shot('4-fade');
  await tapText('Straight'); out.panel.straight = await read();
  await dragDot(0, 0.95); out.panel.backspin = await read(); await shot('5-backspin');
  await dragDot(0, -0.95); out.panel.topspin = await read();
  await tapText('Straight');
  await tapText('Stinger', '.shottypes'); out.panel.stinger = await read(); await shot('6-stinger');
  await tapText('Normal', '.shottypes');
  await tapText('Done');
  // Three real swings on the range: a draw, a fade, and a stinger.
  for (const kind of ['draw', 'fade', 'stinger']) {
    await waitPhase(page, 'aim');
    await page.waitForTimeout(400);
    await tap('.spinbtn');
    if (kind === 'stinger') { await tapText('Straight'); await tapText('Stinger', '.shottypes'); } else { await tapText('Normal', '.shottypes').catch(() => {}); await tapText(kind === 'draw' ? 'Draw' : 'Fade'); }
    const before = await read();
    await tapText('Done');
    const power = await page.evaluate(() => window.__fw.game.suggestedPower());
    await swing(page, pointer, { power: Math.min(1, power), backMs: 780, downMs: 260 });
    await page.waitForFunction(() => window.__fw.game.state.shot || window.__fw.game.state.lastShot, null, { timeout: 20000 });
    const res = await page.evaluate(() => { const g = window.__fw.game, s = g.state.shot || g.state.lastShot; const a = s.aim, fx = Math.sin(a), fz = -Math.cos(a), p = s.result.carryPoint || s.result.end; return { club: s.club.id, shot: s.shotType.id, strike: s.strike.kind, carryYd: +(s.result.carry / 0.9144).toFixed(1), totalYd: +(s.result.total / 0.9144).toFixed(1), rightOfAimYd: +(((p.x - s.from.x) * -fz + (p.z - s.from.z) * fx) / 0.9144).toFixed(1), apexYd: +(s.result.apex / 0.9144).toFixed(1), power: +s.swing.power.toFixed(3) }; });
    out.range.push({ kind, planned: before, ...res });
    await page.waitForTimeout(900);
    await shot(`7-${kind}-flight`);
    await page.waitForFunction(() => window.__fw.game.state.phase === 'aim', null, { timeout: 60000 }).catch(() => {});
  }
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
