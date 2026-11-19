// Swing frames through real touch drags, with the frame loop stepped by hand so every capture
// lands on a known moment: address, 25 percent, 50 percent, the top (after a short pause),
// mid-downswing, the impact frame (the frame on which the drag crosses the start line), and
// the follow-through. The drag is sampled like a real finger: uneven gaps of 6 to 26 ms and a
// pixel or two of wobble. Every frame of the swing also records the displayed club progress and
// the club head's distance from the ball, for the smoothness and impact numbers.
//   node scripts/tools/swingframes.mjs <outdir> [390x844] [left]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel } from '../lib/drive.mjs';

const [outDir = 'qa/tmp/swing', size = '390x844', hand = 'right'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(outDir, { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
ctx.setDefaultTimeout(300000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: true });
const out = { size, hand, frames: [], captures: {} };
const tag = `${size}${hand === 'left' ? '-left' : ''}${process.env.TIER ? '-' + process.env.TIER : ''}`;
// A seeded wobble so before and after see the same finger.
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
try {
  await page.goto(`${server.url}/?mode=stroke&course=parkland&hole=1&holes=1&tier=${process.env.TIER || 'low'}&scale=0.6&bot=1&seed=7`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  if (hand === 'left') await page.evaluate(() => { const a = window.__fw.app; a.settings.handedness = 'left'; a.settings.leftHandLayout = true; a.saveSettings && a.saveSettings(); a.ui.applySettings(); });
  if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
  await waitPhase(page, 'aim');
  await page.waitForTimeout(1200);
  // From here the loop only moves when this tool steps it, on one clock with the touch events.
  const clock = await page.evaluate(() => { window.__fw.app.loop.stop(); return performance.now(); });
  let tl = 0; // ms on the shared timeline
  const T0 = Date.now() + 50;
  const step = async (ms) => {
    const n = Math.max(1, Math.round(ms / (1000 / 60)));
    const rows = await page.evaluate(([c, t, k]) => {
      const loop = window.__fw.app.loop, cv = window.__fw.app.world.club, rows = [];
      for (let i = 0; i < k; i++) {
        loop.step(c + t + (i + 1) * (1000 / 60), 1 / 60);
        const h = cv.lastPose && cv.lastPose.head, b = cv.lastBall;
        rows.push({ cpu: loop.stats.cpuMs, sys: { ...loop.stats.perSystem }, world: loop.stats.perSystem.world, ui: loop.stats.perSystem.ui, p: cv.p, live: window.__fw.ui.hud.zone.live.phase, depth: window.__fw.ui.hud.zone.live.depth, head: h ? [h.x, h.y, h.z] : null, ball: b ? [b.x, b.y, b.z] : null, follow: !!cv.follow, visible: cv.visible });
      }
      return rows;
    }, [clock, tl, n]);
    for (const r of rows) out.frames.push({ t: +(tl += 1000 / 60).toFixed(1), ...r });
  };
  const snap = async (name) => {
    await page.screenshot({ path: `${outDir}/${name}-${tag}.png` });
    const f = out.frames[out.frames.length - 1];
    const d = f && f.head && f.ball ? Math.hypot(f.head[0] - f.ball[0], f.head[1] - f.ball[1], f.head[2] - f.ball[2]) : null;
    out.captures[name] = { t: f ? f.t : 0, p: f ? +f.p.toFixed(4) : null, headToBallCm: d == null ? null : +(d * 100).toFixed(2) };
  };
  const zone = await page.evaluate(() => { const z = window.__fw.ui.hud.zone; const r = z.el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: z.startY(), travel: z.travel }; });
  out.zone = zone;
  await step(100);
  await snap('1-address');
  // Touch down on the start line, then the backswing over 900 ms to full depth.
  const at = (ms) => T0 + ms;
  // Chrome delivers touch moves with the next frame: let it, so each move is handled before
  // the loop steps (the game's own loop is stopped, so this frame draws nothing new).
  const flush = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
  await pointer.down(zone.x, zone.y, at(tl));
  await flush();
  await step(30);
  const moveTo = async (frac, ms, wobble = 1.5) => {
    // Uneven samples like a real finger, each followed by the frames that pass until the next.
    const startDepth = moveTo.depth || 0, startT = tl, endT = tl + ms;
    while (tl < endT) {
      const gap = 6 + rnd() * 20, t = Math.min(endT, tl + gap);
      const f = (t - startT) / ms;
      const d = startDepth + (frac - startDepth) * f;
      await pointer.move(zone.x + (rnd() - 0.5) * 2 * wobble, zone.y + d * zone.travel + (rnd() - 0.5) * 2 * wobble, at(t));
      await flush();
      await step(t - tl);
    }
    moveTo.depth = frac;
  };
  await moveTo(0.25, 250); await snap('2-quarter');
  await moveTo(0.5, 250); await snap('3-half');
  await moveTo(1.0, 500);
  // A short pause at the top (it counts toward the downswing time in the tempo).
  await step(110);
  await snap('4-top');
  // Downswing over about 250 ms after the pause (close to 3 to 1): halfway, then through the line.
  await moveTo(0.5, 120, 1);
  await snap('5-mid-downswing');
  const before = out.frames.length;
  // The last samples: up to just under the line, then across it. The crossing completes the
  // gesture on that touch event; the next frame is the impact frame.
  await moveTo(0.04, 115, 0.5);
  out.preCrossing = out.frames[out.frames.length - 1];
  await pointer.move(zone.x, zone.y - 14, at(tl + 8));
  await flush();
  await step(16);
  await snap('6-impact');
  out.impactFrame = out.frames[out.frames.length - 1];
  await pointer.up(zone.x, zone.y - 14, at(tl + 1));
  await step(200);
  await snap('7-follow-through');
  out.downswingFrames = out.frames.length - before;
  // Smoothness: the frame-to-frame change of the head's velocity (m/s per frame) over the drag.
  const swingRows = out.frames.filter((f) => f.head && !f.follow && (f.live === 'back' || f.live === 'down'));
  let worst = 0, sum = 0, n = 0;
  for (let i = 2; i < swingRows.length; i++) {
    const a = swingRows[i - 2].head, b = swingRows[i - 1].head, c = swingRows[i].head;
    const acc = Math.hypot(c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1], c[2] - 2 * b[2] + a[2]) * 60 * 60;
    worst = Math.max(worst, acc); sum += acc; n++;
  }
  out.smoothness = { frames: swingRows.length, worstHeadAccel: +worst.toFixed(1), meanHeadAccel: +(sum / Math.max(1, n)).toFixed(1), unit: 'm/s^2 from the second difference of the head position per 60 Hz frame' };
  // Frame cost over the swing frames (CPU time of every subsystem, render submission included;
  // SwiftShader, so a software number, not a phone GPU number).
  const cpu = swingRows.map((f) => f.cpu).filter(Number.isFinite).sort((x, y) => x - y);
  const pct = (q) => +cpu[Math.min(cpu.length - 1, Math.floor(q * cpu.length))].toFixed(2);
  out.frameCost = { tier: process.env.TIER || 'low', frames: cpu.length, meanMs: +(cpu.reduce((x, y) => x + y, 0) / cpu.length).toFixed(2), p50Ms: pct(0.5), p95Ms: pct(0.95), maxMs: pct(1) };
  out.shot = await page.evaluate(() => { const s = window.__fw.game.state.shot; return s ? { strike: s.strike.kind, power: +s.swing.power.toFixed(3), tempo: s.swing.tempoGrade, ratio: +s.swing.tempoRatio.toFixed(2) } : null; });
  await page.evaluate(() => window.__fw.app.loop.start());
} catch (e) { out.failed = e.message.split('\n')[0]; await page.screenshot({ path: `${outDir}/failed-${tag}.png` }).catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
const { frames, ...summary } = out;
console.log(JSON.stringify(summary, null, 1));
writeFileSync(`${outDir}/swing-${tag}.json`, JSON.stringify(out));
await browser.close();
await server.close();
