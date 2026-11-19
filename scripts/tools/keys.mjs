// Keyboard control on the production build: every shortcut on the Controls screen through real
// key events (Chrome DevTools input), checked against the game state, plus the guard that no
// shortcut fires while typing, the level editor's keys and mouse (wheel zoom, middle button and
// Space pans, Ctrl+Z and Ctrl+Y, Delete, number keys), and a tooltip on every icon button.
//   node scripts/tools/keys.mjs qa/proof/desktop/p3 [1920x1080]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/desktop/p3', size = '1920x1080'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: false });
ctx.setDefaultTimeout(240000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const out = { size, checks: [] };
// Software rendering runs at a few frames a second, so the 0.3 s fades take longer: wait first.
// Chrome starts a CSS fade on the next committed frame, and a software-rendered frame can take
// seconds here: wait until an open screen has fully faded in before capturing.
const shot = async (n) => {
  await page.waitForFunction(() => { const s = document.querySelector('.screen'); return !window.__fw.app.ui.modal || (s && getComputedStyle(s).opacity === '1'); }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${prefix}-${size}-${n}.jpg`, type: 'jpeg', quality: 82 });
};
const ok = (name, pass, detail) => { out.checks.push({ name, pass: !!pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); };
const st = () => page.evaluate(() => { const g = window.__fw.game, s = g.state; return { phase: s.phase, aim: s.aim, club: s.club.id, shot: s.shotType.id, spin: g.spin(), modal: window.__fw.app.ui.modal, rig: window.__fw.app.world.rig.mode, map: window.__fw.app.ui.map.open, replayAngle: s.replayAngle || null, target: s.target ? Math.atan2(s.target.x - s.ball.x, -(s.target.z - s.ball.z)) : null }; });
const key = async (k, wait = 220) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
try {
  await page.goto(`${server.url}/?mode=stroke&course=parkland&hole=1&holes=1&tier=low&scale=0.5&bot=1&seed=11&cloud=demo`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  const ph = await waitPhase(page, ['intro', 'aim']);
  if (ph === 'intro') { await key('Space', 400); }
  await waitPhase(page, 'aim');
  await page.waitForTimeout(600);
  // ? overlay
  await key('Shift+Slash', 400);
  let s = await st(); ok('? opens the Controls list', s.modal === 'controls');
  await shot('1-shortcuts');
  await key('Shift+Slash', 400); s = await st(); ok('? closes it', s.modal === null);
  // Aim
  const a0 = (await st()).aim;
  await key('KeyA'); await key('KeyA'); const a1 = (await st()).aim;
  await key('KeyD'); const a2 = (await st()).aim;
  await key('Shift+KeyA'); const a3 = (await st()).aim;
  await key('ArrowLeft'); const a4 = (await st()).aim;
  ok('A and D aim (0.5 degrees, Shift 0.1)', a1 < a0 && a2 > a1 && a3 < a2 && Math.abs((a2 - a3) * 57.2958 - 0.1) < 0.02, { a0, a1, a2, a3 });
  ok('Left arrow aims', a4 < a3);
  await key('KeyR'); s = await st(); ok('R resets aim to the target', Math.abs(s.aim - s.target) < 0.002, { aim: s.aim, target: s.target });
  // Club
  const c0 = (await st()).club; await key('KeyS'); const c1 = (await st()).club; await key('KeyW'); const c2 = (await st()).club;
  await key('ArrowDown'); const c3 = (await st()).club; await key('ArrowUp'); const c4 = (await st()).club;
  ok('W and S, up and down arrows change club', c1 !== c0 && c2 === c0 && c3 !== c0 && c4 === c0, { c0, c1, c2, c3, c4 });
  // Shot type
  const t0 = (await st()).shot; await key('KeyE'); const t1 = (await st()).shot; await key('KeyQ'); const t2 = (await st()).shot;
  ok('Q and E change shot type', t1 !== t0 && t2 === t0, { t0, t1, t2 });
  // Spin dot
  await key('Shift+ArrowRight'); await key('Shift+ArrowUp'); const sp = (await st()).spin;
  await key('Shift+KeyR'); const sp0 = (await st()).spin;
  ok('Shift and arrows move the spin dot; Shift+R centres it', sp.x > 0 && sp.y > 0 && sp0.x === 0 && sp0.y === 0, { sp, sp0 });
  // Tab scorecard
  await key('Tab', 400); s = await st(); ok('Tab opens the scorecard', s.modal === 'scorecard');
  await shot('2-scorecard');
  await key('Tab', 400); s = await st(); ok('Tab closes it', s.modal === null);
  // Map
  await key('KeyM', 400); s = await st(); ok('M opens the map', s.map === true);
  await shot('3-map');
  await key('KeyM', 400); s = await st(); ok('M closes the map', s.map === false);
  // Camera
  await key('KeyC', 600); s = await st(); ok('C looks around', s.rig === 'peek', s.rig);
  await key('KeyC', 900); s = await st(); ok('C comes back', s.rig === 'address', s.rig);
  // Esc
  await key('Escape', 400); s = await st(); ok('Esc pauses', s.modal === 'pause');
  await key('Escape', 400); s = await st(); ok('Esc closes the pause menu', s.modal === null);
  // Typing guard: the Settings name field.
  await key('Escape', 400);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.screen button')].find((x) => x.textContent.trim() === 'Settings'); b.click(); });
  await page.waitForTimeout(400);
  await page.click('#s-name', { clickCount: 3 });
  const before = await st();
  await page.keyboard.type('Wade Q?', { delay: 20 });
  await page.keyboard.press('KeyF');
  const after = await st();
  ok('No shortcut fires while typing', after.club === before.club && after.aim === before.aim && after.shot === before.shot && after.modal === 'settings' && !(await page.evaluate(() => !!document.fullscreenElement)), { value: await page.inputValue('#s-name') });
  await page.evaluate(() => { const i = document.getElementById('s-name'); i.blur(); });
  await key('Escape', 300); await key('Escape', 300);
  if ((await st()).modal) await key('Escape', 300);
  // Space: hold for the backswing, release, press again for impact.
  await waitPhase(page, 'aim');
  const ideal = await page.evaluate(() => window.__fw.game.suggestedPower());
  await page.keyboard.down('Space');
  await page.waitForTimeout(Math.round(1100 * Math.min(0.9, ideal)));
  await page.keyboard.up('Space');
  await page.waitForTimeout(Math.round(370 * Math.min(0.9, ideal)));
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ phase: window.__fw.phase(), result: window.__fw.ui.hud.zone.lastResult }));
  ok('Space hold, release, press swings', ['flight', 'settle', 'aim', 'summary'].includes(r.phase) && r.result && r.result.power > 0.1, { phase: r.phase, power: r.result && +r.result.power.toFixed(3), tempo: r.result && r.result.tempoLabel });
  await shot('4-space-swing');
  // Z replay, C angle, Z end
  await page.evaluate(() => { window.__fw.app.loop.timescale = 6; });
  await waitPhase(page, ['aim', 'summary']);
  await page.evaluate(() => { window.__fw.app.loop.timescale = 1; });
  if ((await st()).phase === 'aim') {
    await key('KeyZ', 600); s = await st(); ok('Z replays the last shot', s.phase === 'replay', s.phase);
    const ang0 = s.replayAngle; await key('KeyC', 500); s = await st(); ok('C changes the replay angle', s.replayAngle !== ang0, { from: ang0, to: s.replayAngle });
    await shot('5-replay');
    await key('KeyZ', 600); s = await st(); ok('Z ends the replay', s.phase === 'aim', s.phase);
  } else ok('Z replays the last shot', false, 'the hole ended on the first shot');
  // Tooltips on every icon button
  const tips = await page.evaluate(() => [...document.querySelectorAll('#ui button')].filter((b) => !b.textContent.trim() || b.classList.contains('roundbtn') || b.classList.contains('arrow') || b.classList.contains('iconbtn')).map((b) => ({ cls: b.className, title: b.title || '' })));
  ok('Every icon button has a tooltip', tips.every((t) => t.title.length > 3), tips.filter((t) => t.title.length <= 3));
  out.tooltips = tips;
  // Level editor
  await key('Escape', 300);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.screen button')].find((x) => x.textContent.trim() === 'Quit round'); if (b) b.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim().startsWith('Create')); b.click(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim().startsWith('Dogleg')); b.click(); });
  await page.waitForTimeout(800);
  const lv = () => page.evaluate(() => window.__fw.app.levelEditor.level());
  const cv = await page.evaluate(() => { const r = document.querySelector('.lvcanvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const teeFit = await page.evaluate(() => { const l = window.__fw.app.levelEditor.level(); return window.__fw.app.levelEditor.toScreen(l.tee[0], l.tee[1]); });
  const n0 = (await lv()).bunkers.length;
  await key('Digit1'); const n1 = (await lv()).bunkers.length;
  await key('Delete'); const n2 = (await lv()).bunkers.length;
  await key('Control+KeyZ'); const n3 = (await lv()).bunkers.length;
  await key('Control+KeyY'); const n4 = (await lv()).bunkers.length;
  await key('Control+Shift+KeyZ'); const n5 = (await lv()).bunkers.length;
  ok('1 places a bunker, Delete removes it, Ctrl+Z and Ctrl+Y undo and redo', n1 === n0 + 1 && n2 === n0 && n3 === n0 + 1 && n4 === n0, { n0, n1, n2, n3, n4, n5 });
  const w0 = (await lv()).water.length; await key('Digit2'); const w1 = (await lv()).water.length; ok('2 places water', w1 === w0 + 1, { w0, w1 });
  // Wheel zoom about the cursor
  const p0 = await page.evaluate(() => { const l = window.__fw.app.levelEditor.level(); return window.__fw.app.levelEditor.toScreen(l.pin[0], l.pin[1]); });
  await page.mouse.move(cv.x + cv.w / 2, cv.y + cv.h / 2);
  for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(120); }
  const p1 = await page.evaluate(() => { const l = window.__fw.app.levelEditor.level(); return window.__fw.app.levelEditor.toScreen(l.pin[0], l.pin[1]); });
  const tee0 = await page.evaluate(() => { const l = window.__fw.app.levelEditor.level(); return window.__fw.app.levelEditor.toScreen(l.tee[0], l.tee[1]); });
  ok('The wheel zooms the map', Math.hypot(p1.x - (cv.x + cv.w / 2), p1.y - (cv.y + cv.h / 2)) > Math.hypot(p0.x - (cv.x + cv.w / 2), p0.y - (cv.y + cv.h / 2)) * 1.5, { before: p0, after: p1 });
  await shot('6-editor-zoomed');
  // Middle button pan
  await page.mouse.move(cv.x + cv.w * 0.5, cv.y + cv.h * 0.5);
  await page.mouse.down({ button: 'middle' }); await page.mouse.move(cv.x + cv.w * 0.5 + 80, cv.y + cv.h * 0.5 + 40, { steps: 6 }); await page.mouse.up({ button: 'middle' });
  const tee1 = await page.evaluate(() => { const l = window.__fw.app.levelEditor.level(); return window.__fw.app.levelEditor.toScreen(l.tee[0], l.tee[1]); });
  ok('The middle button pans', Math.abs(tee1.x - tee0.x - 80) < 3 && Math.abs(tee1.y - tee0.y - 40) < 3, { tee0, tee1 });
  // Space and drag pans (and moves nothing)
  const lvBefore = JSON.stringify(await lv());
  await page.keyboard.down('Space');
  await page.mouse.move(cv.x + cv.w * 0.5, cv.y + cv.h * 0.5);
  await page.mouse.down(); await page.mouse.move(cv.x + cv.w * 0.5 - 60, cv.y + cv.h * 0.5, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up('Space');
  const tee2 = await page.evaluate(() => { const l = window.__fw.app.levelEditor.level(); return window.__fw.app.levelEditor.toScreen(l.tee[0], l.tee[1]); });
  ok('Space and drag pans and moves nothing', Math.abs(tee2.x - tee1.x + 60) < 3 && JSON.stringify(await lv()) === lvBefore, { tee1, tee2 });
  await key('Digit0'); const tee3 = await page.evaluate(() => { const l = window.__fw.app.levelEditor.level(); return window.__fw.app.levelEditor.toScreen(l.tee[0], l.tee[1]); });
  ok('0 fits the hole again', Math.hypot(tee3.x - teeFit.x, tee3.y - teeFit.y) < 2, { teeFit, tee3 });
  // Typing a number into the name places nothing
  const b0 = (await lv()).bunkers.length;
  await page.click('#lv-name'); await page.keyboard.type('Hole 12', { delay: 20 });
  ok('Number keys in the name field type, they place nothing', (await lv()).bunkers.length === b0 && /12$/.test(await page.inputValue('#lv-name')));
  await page.evaluate(() => document.getElementById('lv-name').blur());
  await shot('7-editor');
} catch (e) { out.failed = e.message.split('\n')[0]; console.log('FAILED', out.failed); await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
out.passed = out.checks.filter((c) => c.pass).length; out.total = out.checks.length;
console.log(`${out.passed} of ${out.total} checks passed, console errors ${out.consoleErrors.length}`);
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
