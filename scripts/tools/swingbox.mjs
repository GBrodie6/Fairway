// The swing guide through real input events (touch on phone and tablet sizes, the mouse on
// desktop sizes, both through the Chrome DevTools input domain with planned timestamps): five
// moments of one swing (address, mid backswing, the top, the thumb outside the box, impact),
// each with a screenshot and the overlap check (every HUD box, the power number, the ball, the
// aim fan, the club and the swing area). With the swing box (the default) also: a press outside
// the box does not start a swing, more than 1.5 box widths outside cancels with no stroke, the
// left-handed mirror, Classic track in Settings, and the tutorial's two prompts.
//   node scripts/tools/swingbox.mjs qa/proof/swingbox/after 390x844,1920x1080 [extras]
// Run it on an older build with DIST for the "before" pictures (extras off).
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/swingbox/after', sizeArg = '390x844', extrasArg = 'extras'] = process.argv.slice(2);
const extras = extrasArg === 'extras';
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const report = { sizes: {}, consoleErrors: [] };

const overlaps = (a, b, pad = 1) => a && b && a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;
function polyHitsRect(poly, r) {
  const rp = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  const axes = [[1, 0], [0, 1]];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; axes.push([-(b.y - a.y), b.x - a.x]); }
  for (const [ax, ay] of axes) {
    let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
    for (const p of poly) { const d = p.x * ax + p.y * ay; p0 = Math.min(p0, d); p1 = Math.max(p1, d); }
    for (const [x, y] of rp) { const d = x * ax + y * ay; q0 = Math.min(q0, d); q1 = Math.max(q1, d); }
    if (p1 <= q0 || q1 <= p0) return false;
  }
  return true;
}
// The classic track sits in the classic zone by design, and during a swing the thumb (and so
// the club, which follows it) is over the swing area; those pairs are not overlaps.
function check(b, W, H, { swinging = false } = {}) {
  const items = Object.entries(b.hud);
  if (b.ball) items.push(['ball', b.ball]);
  if (b.zone) items.push(['swingArea', b.zone]);
  const allowed = new Set(['swingTrack x swingArea']);
  const bad = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const k = `${items[i][0]} x ${items[j][0]}`;
    if (overlaps(items[i][1], items[j][1]) && !allowed.has(k)) bad.push(k);
  }
  if (b.fan && b.fan.every((p) => !p.behind)) for (const [k, r] of Object.entries(b.hud)) if (polyHitsRect(b.fan, r)) bad.push(`fan x ${k}`);
  if (b.clubPts) {
    const boxes = { ...b.hud, ...(swinging ? {} : { swingArea: b.zone }) };
    for (const [k, r] of Object.entries(boxes)) if (r && b.clubPts.some(([x, y]) => x > r.x - 2 && x < r.x + r.w + 2 && y > r.y - 2 && y < r.y + r.h + 2)) bad.push(`club x ${k}`);
  }
  const off = items.filter(([, r]) => r.x < -1 || r.y < -1 || r.x + r.w > W + 1 || r.y + r.h > H + 1).map(([k]) => `${k} off screen`);
  return { overlaps: bad, offscreen: off };
}

for (const size of sizeArg.split(',')) {
  const [W, H] = size.split('x').map(Number);
  const desk = W >= 1180 && H >= 640;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: !desk, isMobile: !desk && W < H });
  ctx.setDefaultTimeout(240000);
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  const ptr = await createPointer(page, { touch: !desk });
  const out = { input: desk ? 'mouse' : 'touch', moments: [], checks: [] };
  report.sizes[size] = out;
  const ok = (name, pass, detail) => { out.checks.push({ name, pass: !!pass, detail }); console.log(size, pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 240)); };
  const settle = async () => {
    let last = null;
    for (let i = 0; i < 40; i++) {
      const p = await page.evaluate(() => [...window.__fw.app.world.camera.position.toArray(), window.__fw.app.loop.stats.frame]);
      if (last && p[3] >= last[3] + 3) { if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 0.004) break; last = p; } else if (!last) last = p;
      await page.waitForTimeout(250);
    }
  };
  const frames = async (n = 2) => { const f0 = await page.evaluate(() => window.__fw.app.loop.stats.frame); await page.waitForFunction((f) => window.__fw.app.loop.stats.frame >= f, f0 + n); };
  const info = () => page.evaluate(() => {
    const z = window.__fw.ui.hud.zone, box = !!(z.boxMode && z.boxMode());
    const r = z.el.getBoundingClientRect();
    const start = box ? z.ringPoint() : { x: r.x + r.width / 2, y: z.startY() };
    return { box, start, travel: z.travel, half: box ? z.rest.halfWidth : 22, rest: box ? z.rest : null, phase: window.__fw.phase(), strokes: window.__fw.game.state.round.state[0].strokes, mode: z.mode, outline: z.outline || null, lit: !!(z.vis && z.vis.classList.contains('outside')), pct: z.pctEl ? z.pctEl.textContent : null, feedback: z.fbEl.textContent };
  });
  async function moment(name, opts) {
    await frames(2);
    await page.waitForTimeout(120);
    const b = await page.evaluate(() => window.__fw.layoutBoxes());
    const res = { name, ...check(b, W, H, opts), state: await info() };
    await page.screenshot({ path: `${prefix}-${size}-${out.moments.length + 1}-${name}.jpg`, type: 'jpeg', quality: 84 });
    out.moments.push(res);
    console.log(size, name, JSON.stringify({ overlaps: res.overlaps, offscreen: res.offscreen, lit: res.state.lit, pct: res.state.pct }));
    return res;
  }
  const newRound = async (q = '') => {
    await page.goto(`${server.url}/?mode=stroke&course=parkland&hole=4&holes=1&tier=low&scale=0.5&seed=3${q}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
    if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') { await page.evaluate(() => window.__fw.game.skipIntro()); }
    await waitPhase(page, 'aim');
    await settle();
  };
  try {
    await newRound('&bot=1');
    // 1. Address.
    await moment('address');
    // One swing with planned timestamps (900 ms back, a short excursion outside the box at the
    // top, 300 ms up through the start line): the screenshots wait in between, the timestamps
    // do not, so the swing reads as a real 3 to 1 swing.
    const s = await info();
    const { x, y } = s.start, T = s.travel;
    const t0 = Date.now();
    await ptr.down(x, y, t0);
    for (let i = 1; i <= 10; i++) await ptr.move(x, y + 0.45 * T * (i / 10), t0 + i * 40);
    await moment('mid-backswing', { swinging: true });
    for (let i = 1; i <= 10; i++) await ptr.move(x, y + T * (0.45 + 0.45 * (i / 10)), t0 + 400 + i * 45);
    await ptr.move(x, y + 0.9 * T, t0 + 880);
    await moment('top-of-backswing', { swinging: true });
    const ox = x + s.half + 30;
    for (let i = 1; i <= 4; i++) await ptr.move(x + (ox - x) * (i / 4), y + 0.9 * T, t0 + 890 + i * 12);
    await page.waitForTimeout(160);
    const outside = await moment('outside-the-box', { swinging: true });
    if (s.box) ok('Outside the box during a swing: the outline lights up', outside.state.lit && outside.state.outline === 'outside', { lit: outside.state.lit });
    for (let i = 1; i <= 4; i++) await ptr.move(ox + (x - ox) * (i / 4), y + 0.9 * T, t0 + 950 + i * 12);
    await frames(1);
    const back = await info();
    if (s.box) ok('Back inside: the outline is quiet again', !back.lit && back.outline === 'inside', { lit: back.lit });
    for (let i = 1; i <= 8; i++) { const f = i / 8; await ptr.move(x, y + 0.9 * T - (0.9 * T + 16) * f * f, t0 + 1010 + i * 37); }
    await ptr.up(x, y - 16, t0 + 1310);
    const imp = await moment('impact', { swinging: true });
    const r = await page.evaluate(() => window.__fw.ui.hud.zone.lastResult);
    ok('The swing launched', ['flight', 'settle'].includes(imp.state.phase) && r && r.power > 0.5, { phase: imp.state.phase, power: r && +r.power.toFixed(3), tempo: r && r.tempoLabel, face: r && +r.face.toFixed(2) });
    out.result = r && { power: +r.power.toFixed(3), tempo: r.tempoLabel, face: +r.face.toFixed(2), path: +r.path.toFixed(2) };

    if (extras && s.box) {
      // A press outside the box does not start a swing.
      await newRound('&bot=1');
      let b0 = await info();
      const px = b0.rest.x + b0.rest.w + 18, py = b0.start.y;
      const t1 = Date.now();
      await ptr.down(px, py, t1);
      for (let i = 1; i <= 6; i++) await ptr.move(px, py + 20 * i, t1 + i * 50);
      let mid = await info();
      await ptr.up(px, py + 120, t1 + 400);
      await page.waitForTimeout(300);
      let after = await info();
      ok('A press outside the box does not start a swing', mid.mode === null && after.strokes === b0.strokes && after.phase === 'aim', { press: [Math.round(px), Math.round(py)], box: [b0.rest.x, b0.rest.x + b0.rest.w], mode: mid.mode, phase: after.phase });
      // More than 1.5 box widths outside cancels with no stroke.
      b0 = await info();
      const t2 = Date.now();
      await ptr.down(b0.start.x, b0.start.y, t2);
      for (let i = 1; i <= 8; i++) await ptr.move(b0.start.x, b0.start.y + 0.5 * b0.travel * (i / 8), t2 + i * 50);
      const far = b0.start.x + b0.half + 1.5 * 2 * b0.half + 20;
      for (let i = 1; i <= 6; i++) await ptr.move(b0.start.x + (far - b0.start.x) * (i / 6), b0.start.y + 0.5 * b0.travel, t2 + 400 + i * 15);
      await page.waitForTimeout(250);
      mid = await info();
      await ptr.up(far, b0.start.y, t2 + 600);
      await page.waitForTimeout(300);
      after = await info();
      ok('More than 1.5 box widths outside cancels the swing, no stroke', mid.mode === null && after.strokes === b0.strokes && after.phase === 'aim' && /cancel/i.test(after.feedback), { mode: mid.mode, strokes: [b0.strokes, after.strokes], feedback: after.feedback });
      await page.screenshot({ path: `${prefix}-${size}-6-cancelled.jpg`, type: 'jpeg', quality: 84 });
      // Left-handed: the box mirrors (the power number and the guide notch on the other side).
      await page.evaluate(() => { const a = window.__fw.app; a.settings.handedness = 'left'; a.settings.leftHandLayout = true; a.ui.applySettings(); });
      await page.waitForTimeout(600); await settle();
      const L = await info();
      const t3 = Date.now();
      await ptr.down(L.start.x, L.start.y, t3);
      for (let i = 1; i <= 10; i++) await ptr.move(L.start.x, L.start.y + 0.6 * L.travel * (i / 10), t3 + i * 50);
      const lb = await page.evaluate(() => window.__fw.layoutBoxes());
      const lres = check(lb, W, H, { swinging: true });
      const sides = await page.evaluate(() => { const z = window.__fw.ui.hud.zone, p = z.pctEl.getBoundingClientRect(), v = z.vis.getBoundingClientRect(), g = z.vis.querySelector('.bguide').getBoundingClientRect(); return { pctRight: p.right, boxLeft: v.left, guideX: g.left + g.width / 2, boxCx: v.left + v.width / 2 }; });
      await page.screenshot({ path: `${prefix}-${size}-7-lefty.jpg`, type: 'jpeg', quality: 84 });
      ok('Left-handed: the box mirrors (power number on the left), no overlaps', sides.pctRight <= sides.boxLeft + 1 && lres.overlaps.length === 0 && lres.offscreen.length === 0, { ...sides, overlaps: lres.overlaps });
      for (let i = 1; i <= 8; i++) { const f = i / 8; await ptr.move(L.start.x, L.start.y + 0.6 * L.travel - (0.6 * L.travel + 16) * f * f, t3 + 550 + i * 25); }
      await ptr.up(L.start.x, L.start.y - 16, t3 + 760);
      await page.waitForTimeout(400);
      // Classic track: the old stick is still there.
      await page.evaluate(() => { const a = window.__fw.app; a.settings.handedness = 'right'; a.settings.leftHandLayout = false; a.settings.swingGuide = 'classic'; a.ui.applySettings(); });
      await newRound('&bot=1');
      await page.evaluate(() => { const a = window.__fw.app; a.settings.swingGuide = 'classic'; a.ui.applySettings(); });
      await page.waitForTimeout(500);
      const C = await page.evaluate(() => { const z = window.__fw.ui.hud.zone, t = z.track.getBoundingClientRect(); return { box: z.boxMode(), track: t.height > 0 && getComputedStyle(z.track).display !== 'none', vis: getComputedStyle(z.vis).display }; });
      const cb = check(await page.evaluate(() => window.__fw.layoutBoxes()), W, H);
      await page.screenshot({ path: `${prefix}-${size}-8-classic.jpg`, type: 'jpeg', quality: 84 });
      ok('Classic track in Settings brings the old stick back (no box), no overlaps', !C.box && C.track && C.vis === 'none' && cb.overlaps.length === 0, { ...C, overlaps: cb.overlaps });
      // The setting itself in Settings.
      const sel = await page.evaluate(() => { const a = window.__fw.app; a.ui.screens.registry.settings(); const s = document.getElementById('s-guide-style'); return s ? [...s.options].map((o) => o.textContent) : null; });
      ok('Settings has Swing guide: Box or Classic track', JSON.stringify(sel) === JSON.stringify(['Box', 'Classic track']), sel);
      await page.evaluate(() => { const a = window.__fw.app; a.settings.swingGuide = 'box'; a.saveSettings(); a.ui.screens.hide(); a.ui.applySettings(); });
    }
    if (extras && !desk && W < H) {
      // The first-run tutorial (a round without the QA flag, fresh settings): the two prompts.
      await page.evaluate(() => { try { localStorage.clear(); } catch { /* fine */ } });
      await newRound('');
      const tip = () => page.evaluate(() => { const t = document.querySelector('.tip:not(.hidden) .tiptext'); return t ? t.textContent : null; });
      const p1 = await tip();
      const s5 = await info();
      const t5 = Date.now();
      await ptr.down(s5.start.x, s5.start.y, t5);
      for (let i = 1; i <= 10; i++) await ptr.move(s5.start.x, s5.start.y + 0.5 * s5.travel * (i / 10), t5 + i * 50);
      await frames(2);
      const p2 = await tip();
      await page.screenshot({ path: `${prefix}-${size}-9-tutorial.jpg`, type: 'jpeg', quality: 84 });
      for (let i = 1; i <= 8; i++) { const f = i / 8; await ptr.move(s5.start.x, s5.start.y + 0.5 * s5.travel - (0.5 * s5.travel + 16) * f * f, t5 + 550 + i * 22); }
      await ptr.up(s5.start.x, s5.start.y - 16, t5 + 740);
      ok('Tutorial: "Press in the box and pull down", then "Swipe up through the ring"', p1 === 'Press in the box and pull down' && p2 === 'Swipe up through the ring', { first: p1, during: p2 });
    }
  } catch (e) { out.failed = e.message.split('\n')[0]; console.log(size, 'FAILED', out.failed); await page.screenshot({ path: `${prefix}-${size}-failed.jpg`, type: 'jpeg', quality: 70 }).catch(() => {}); }
  out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
  out.problems = out.moments.flatMap((m) => [...m.overlaps, ...m.offscreen].map((p) => `${m.name}: ${p}`));
  console.log(size, `moments ${out.moments.length}, problems ${out.problems.length}, checks ${out.checks.filter((c) => c.pass).length} of ${out.checks.length}, console errors ${out.consoleErrors.length}`, JSON.stringify(out.problems).slice(0, 400));
  await ctx.close();
}
writeFileSync(`${prefix}.json`, JSON.stringify(report, null, 1));
await browser.close();
await server.close();
