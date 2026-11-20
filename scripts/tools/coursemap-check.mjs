// The course map at real sizes with real input: for each size and course, Quick Play's course
// select opens the map through a real tap or click on Course map; the check reads every label
// box and control box from the map itself (no label overlaps another label or a control, every
// hole is labeled, controls stay on screen, touch targets are 44 px or more), then drives the
// map like a person: drag to move, a two-finger pinch on touch (DevTools touch points with two
// fingers) or the wheel on a desktop, + and -, Fit, a tap on a hole and Start on hole N, and
// checks that the setup screen now starts on that hole. In a round it also opens the map from
// the hole map's Course toggle, from the M key (on desktop) and from the scorecard, and checks
// the ball and the current hole. Screenshots of each step.
//   node scripts/tools/coursemap-check.mjs <outDir> [sizes] [courses]
//   URL=https://... runs it against a deployed copy instead of a local build.
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, clickSel } from '../lib/drive.mjs';
import { COURSES } from '../../src/course/courses.js';

const [outDir = 'qa/tmp/coursemap', sizeArg = '360x640,2560x1440', courseArg = 'parkland,links,desert,alpine,tropical,augusta,standrews'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const out = { checks: [], rows: [] };
const check = (name, pass, detail) => { out.checks.push({ name, pass: !!pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); };
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function audit(boxes, W, H, tag) {
  const labels = boxes.labels.filter((l) => l.box).map((l) => ({ ...l.box, text: l.text }));
  // Every hole (and the clubhouse) with any part on screen must have its label; zoomed in,
  // holes wholly off screen have none to place.
  const missing = boxes.labels.filter((l) => !l.box && l.inView).map((l) => l.text);
  const offScreen = boxes.labels.filter((l) => !l.box && !l.inView).length;
  const bad = [];
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (overlap(labels[i], labels[j])) bad.push(`label ${labels[i].text} x label ${labels[j].text}`);
  for (const l of labels) for (const c of boxes.controls) if (overlap(l, c)) bad.push(`label ${l.text} x ${c.cls.split(' ').pop()}`);
  for (let i = 0; i < boxes.controls.length; i++) for (let j = i + 1; j < boxes.controls.length; j++) if (overlap(boxes.controls[i], boxes.controls[j])) bad.push(`${boxes.controls[i].cls.split(' ').pop()} x ${boxes.controls[j].cls.split(' ').pop()}`);
  const off = boxes.controls.filter((c) => c.x < -1 || c.y < -1 || c.x + c.w > W + 1 || c.y + c.h > H + 1).map((c) => c.cls);
  const small = boxes.controls.filter((c) => /cmzin|cmzout|cmfit|close|cmstart/.test(c.cls) && (c.w < 43.5 || c.h < 43.5)).map((c) => `${c.cls.split(' ').pop()} ${Math.round(c.w)}x${Math.round(c.h)}`);
  check(`${tag}: every hole and the clubhouse on screen labeled, no overlaps, controls on screen and 44 px or more`, !missing.length && !bad.length && !off.length && !small.length, { labels: labels.length, offScreen, missing, overlaps: bad.slice(0, 6), off, small });
  return { labels: labels.length, offScreen, missing, overlaps: bad, off, small };
}

for (const size of sizeArg.split(',')) {
  const [W, H] = size.split('x').map(Number);
  const touch = W < 900;
  for (const course of courseArg.split(',')) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch && W < H });
    ctx.setDefaultTimeout(300000);
    const page = await ctx.newPage();
    const errors = trackErrors(page);
    const pointer = await createPointer(page, { touch });
    const tag = `${course} ${size}`;
    const row = { course, size };
    const shot = (n) => page.screenshot({ path: path.join(outDir, `${course}-${size}-${n}.jpg`), type: 'jpeg', quality: 85 });
    try {
      await page.goto(`${server.url}/?course=${course}&tier=low&scale=0.5`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
      // Quick Play's course select, then this course's card, then Course map: real taps.
      await page.evaluate(() => window.__fw.ui.screens.setup());
      await page.waitForTimeout(400);
      // The cards follow the course list's order.
      const cardIdx = COURSES.findIndex((c) => c.id === course);
      await page.evaluate((i) => { const cards = [...document.querySelectorAll('.screen .cards .card')]; if (cards[i]) { cards[i].setAttribute('data-qa', 'card'); cards[i].scrollIntoView({ block: 'center' }); } }, cardIdx);
      if (!(await clickSel(page, pointer, '.screen .card[data-qa="card"]'))) throw new Error('course card not found');
      await page.waitForTimeout(400);
      await page.evaluate(() => { const b = [...document.querySelectorAll('.screen button')].find((x) => x.textContent === 'Course map'); if (b) { b.setAttribute('data-qa', 'cm'); b.scrollIntoView({ block: 'center' }); } });
      await page.waitForTimeout(200);
      check(`${tag}: Quick Play has a Course map button`, await clickSel(page, pointer, '.screen button[data-qa="cm"]'));
      await page.waitForFunction(() => window.__fw.courseMapBoxes() !== null, null, { timeout: 20000 });
      await page.waitForTimeout(300);
      const b0 = await page.evaluate(() => window.__fw.courseMapBoxes());
      row.fit = audit(b0, W, H, `${tag} fitted`);
      check(`${tag}: the map shows this course`, await page.evaluate((id) => window.__fw.ui.courseMap.state.course.id === id, course), null);
      await shot('1-fit');
      // Drag: the view moves by the drag.
      const v0 = await page.evaluate(() => ({ ...window.__fw.ui.courseMap.state.view }));
      const cx = W / 2, cy = (b0.usable.y + b0.usable.h / 2);
      await pointer.path([{ x: cx, y: cy, t: 0 }, { x: cx + 40, y: cy + 25, t: 120 }, { x: cx + 80, y: cy + 50, t: 240 }]);
      await page.waitForFunction((o) => { const v = window.__fw.ui.courseMap.state.view; return Math.hypot((v.ox - o.ox) * v.s, (v.oy - o.oy) * v.s) > 90; }, v0, { timeout: 20000, polling: 100 }).catch(() => {});
      const v1 = await page.evaluate(() => ({ ...window.__fw.ui.courseMap.state.view }));
      const moved = Math.hypot((v0.ox - v1.ox) * v1.s, (v0.oy - v1.oy) * v1.s);
      check(`${tag}: drag moves the map with the pointer`, Math.abs(moved - Math.hypot(80, 50)) < 6, { moved: +moved.toFixed(1) });
      // Zoom in: a pinch on touch, the wheel on a desktop.
      if (touch) {
        const cdp = await page.context().newCDPSession(page);
        const t0 = Date.now() / 1000;
        const tp = (d) => [{ x: cx - d, y: cy, id: 1, radiusX: 6, radiusY: 6, force: 1 }, { x: cx + d, y: cy, id: 2, radiusX: 6, radiusY: 6, force: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(40), timestamp: t0 });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(40 + i * 10), timestamp: t0 + i * 0.03 });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.3 });
      } else {
        await page.mouse.move(cx, cy);
        for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
      }
      await page.waitForFunction((s) => window.__fw.ui.courseMap.state.view.s > s * 1.5, v1.s, { timeout: 20000, polling: 100 }).catch(() => {});
      await page.waitForTimeout(300);
      const v2 = await page.evaluate(() => ({ ...window.__fw.ui.courseMap.state.view }));
      check(`${tag}: ${touch ? 'pinch' : 'wheel'} zooms in about the fingers or pointer`, v2.s > v1.s * 1.5, { from: +v1.s.toFixed(4), to: +v2.s.toFixed(4) });
      const b1 = await page.evaluate(() => window.__fw.courseMapBoxes());
      row.zoomed = audit(b1, W, H, `${tag} zoomed`);
      await shot('2-zoomed');
      // Fit and the zoom buttons.
      await clickSel(page, pointer, '.coursemap .cmfit');
      await page.waitForFunction(() => { const st = window.__fw.ui.courseMap.state; return Math.abs(st.view.s - st.fitScale) < 1e-9; }, null, { timeout: 20000, polling: 100 }).catch(() => {});
      const vf = await page.evaluate(() => ({ ...window.__fw.ui.courseMap.state.view, fit: window.__fw.ui.courseMap.state.fitScale }));
      check(`${tag}: Fit returns to the whole course`, Math.abs(vf.s - vf.fit) < 1e-9, null);
      await clickSel(page, pointer, '.coursemap .cmzin');
      await page.waitForFunction((s) => window.__fw.ui.courseMap.state.view.s > s * 1.4, vf.s, { timeout: 20000, polling: 100 }).catch(() => {});
      const vz = await page.evaluate(() => window.__fw.ui.courseMap.state.view.s);
      check(`${tag}: the + button zooms in`, vz > vf.s * 1.4, { s: vz });
      await clickSel(page, pointer, '.coursemap .cmfit');
      await page.waitForFunction(() => { const st = window.__fw.ui.courseMap.state; return Math.abs(st.view.s - st.fitScale) < 1e-9; }, null, { timeout: 20000, polling: 100 }).catch(() => {});
      await page.waitForTimeout(200);
      // Pick a hole: tap the label of hole 7, then Start on hole 7.
      const b2 = await page.evaluate(() => window.__fw.courseMapBoxes());
      const l7 = b2.labels.find((l) => l.text === '7' && l.box);
      if (l7) await pointer.tap(l7.box.x + l7.box.w / 2, l7.box.y + l7.box.h / 2);
      await page.waitForFunction(() => window.__fw.ui.courseMap.state.selected === 6, null, { timeout: 20000, polling: 100 }).catch(() => {});
      await page.waitForTimeout(200);
      const sel = await page.evaluate(() => window.__fw.ui.courseMap.state.selected);
      check(`${tag}: a tap on hole 7 selects it`, sel === 6, { sel });
      const b3 = await page.evaluate(() => window.__fw.courseMapBoxes());
      row.picked = audit(b3, W, H, `${tag} hole picked`);
      await shot('3-picked');
      check(`${tag}: Start on hole 7 is offered`, await page.evaluate(() => { const b = document.querySelector('.coursemap .cmstart'); return b && !b.classList.contains('hidden') && b.textContent === 'Start on hole 7'; }));
      await clickSel(page, pointer, '.coursemap .cmstart');
      await page.waitForFunction(() => [...document.querySelectorAll('.screen span')].some((x) => /Starting on hole/.test(x.textContent)) && !window.__fw.ui.courseMap.open, null, { timeout: 20000, polling: 100 }).catch(() => {});
      await page.waitForTimeout(300);
      const startText = await page.evaluate(() => { const s = [...document.querySelectorAll('.screen span')].find((x) => /Starting on hole/.test(x.textContent)); return s ? s.textContent : null; });
      check(`${tag}: the setup screen now starts on hole 7`, startText === 'Starting on hole 7', { startText });
      await shot('4-setup');
      // Tee off: the round's first hole is 7.
      await page.evaluate(() => { const b = [...document.querySelectorAll('.screen button')].find((x) => x.textContent === 'Tee off'); if (b) { b.setAttribute('data-qa', 'tee'); b.scrollIntoView({ block: 'center' }); } });
      await page.waitForTimeout(300);
      await clickSel(page, pointer, '.screen button[data-qa="tee"]');
      await page.waitForFunction(() => window.__fw.game && window.__fw.game.state.round, null, { timeout: 120000 });
      const first = await page.evaluate(() => { const r = window.__fw.game.state.round; return r.holes[0] + 1; });
      check(`${tag}: the round starts on hole 7`, first === 7, { first });
      if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
      await waitPhase(page, 'aim');
      // In the round: the map button, the Course toggle, the ball and the hole in play.
      // Each step waits for its result, not a fixed time: a software-rendered frame at
      // 2560x1440 takes seconds, and the tap is handled between frames.
      const until = (fn) => page.waitForFunction(fn, null, { timeout: 20000, polling: 100 }).then(() => true).catch(() => false);
      await clickSel(page, pointer, '[aria-label="Hole map and rangefinder"]');
      await until(() => window.__fw.ui.map.open);
      check(`${tag}: the hole map has a Course toggle`, await clickSel(page, pointer, '.mapwrap .mapseg button:last-child'));
      await until(() => window.__fw.ui.courseMap.open);
      await page.waitForTimeout(300);
      const inRound = await page.evaluate(() => { const s = window.__fw.ui.courseMap.state; return { open: window.__fw.ui.courseMap.open, current: s.current, ball: !!s.ball }; });
      check(`${tag}: in a round the course map marks hole 7 and the ball`, inRound.open && inRound.current === 6 && inRound.ball, inRound);
      const b4 = await page.evaluate(() => window.__fw.courseMapBoxes());
      row.round = audit(b4, W, H, `${tag} in a round`);
      await shot('5-round');
      // Back to the hole map with its toggle, then closed.
      await clickSel(page, pointer, '.coursemap .cmseg button:first-child');
      check(`${tag}: Hole goes back to the hole map`, await until(() => window.__fw.ui.map.open && !window.__fw.ui.courseMap.open));
      await page.keyboard.press('Escape');
      await until(() => !window.__fw.ui.map.open);
      if (!touch) {
        // M: hole map, M: course map, M: closed.
        const states = [];
        const now = () => page.evaluate(() => (window.__fw.ui.courseMap.open ? 'course' : window.__fw.ui.map.open ? 'hole' : 'closed'));
        for (const want of ['hole', 'course', 'closed']) {
          await page.keyboard.press('m');
          await page.waitForFunction((w) => (window.__fw.ui.courseMap.open ? 'course' : window.__fw.ui.map.open ? 'hole' : 'closed') === w, want, { timeout: 20000, polling: 100 }).catch(() => {});
          states.push(await now());
        }
        check(`${tag}: M opens the hole map, then the course map, then closes`, states.join(',') === 'hole,course,closed', states);
      }
      // The scorecard's Course map button.
      await page.evaluate(() => window.__fw.ui.screens.scorecard());
      await until(() => !!document.querySelector('.screen button') && [...document.querySelectorAll('.screen button')].some((x) => x.textContent === 'Course map'));
      await page.evaluate(() => { const b = [...document.querySelectorAll('.screen button')].find((x) => x.textContent === 'Course map'); if (b) { b.setAttribute('data-qa', 'sc'); b.scrollIntoView({ block: 'center' }); } });
      await page.waitForTimeout(300);
      check(`${tag}: the scorecard opens the course map`, (await clickSel(page, pointer, '.screen button[data-qa="sc"]')) && (await page.waitForFunction(() => window.__fw.ui.courseMap.open, null, { timeout: 5000 }).then(() => true).catch(() => false)));
      await page.keyboard.press('Escape');
    } catch (e) { check(`${tag}: ran to the end`, false, e.message.split('\n')[0]); }
    row.consoleErrors = errors.length;
    check(`${tag}: no console errors`, errors.length === 0, errors.slice(0, 3).map((e) => e.text.slice(0, 160)));
    out.rows.push(row);
    writeFileSync(path.join(outDir, 'coursemap.json'), JSON.stringify(out, null, 1));
    await ctx.close();
  }
}
console.log(`${out.checks.filter((c) => c.pass).length} of ${out.checks.length} checks passed`);
await browser.close();
await server.close();
