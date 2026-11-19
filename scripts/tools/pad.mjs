// Controller support on the production build. No physical controller is attached here, so a
// standard-mapping gamepad is injected into the page (navigator.getGamepads returns it, as
// Chrome does for a pad that was plugged in before the page opened) and its buttons and sticks
// are set between frames. Checks: detection and the button hints, aim, club, shot type, the
// ball contact dot, the swing (hold A, release, A again), the map and the club list, menus
// (the d-pad, A, B, a setting changed with left and right), and the level editor basics.
//   node scripts/tools/pad.mjs qa/proof/desktop/p5 [1920x1080]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/desktop/p5', size = '1920x1080'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: false });
ctx.setDefaultTimeout(240000);
await ctx.addInitScript(() => {
  const btn = () => ({ pressed: false, touched: false, value: 0 });
  window.__pad = { id: 'Injected test pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, btn), vibrationActuator: null };
  Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [window.__pad, null, null, null] });
  window.__padSet = (i, on) => { window.__pad.buttons[i] = { pressed: !!on, touched: !!on, value: on ? 1 : 0 }; window.__pad.timestamp = performance.now(); };
  window.__padAxis = (i, v) => { window.__pad.axes[i] = v; window.__pad.timestamp = performance.now(); };
});
const page = await ctx.newPage();
const errors = trackErrors(page);
const out = { size, checks: [], note: 'An injected standard gamepad; no physical controller was used.' };
const ok = (name, pass, detail) => { out.checks.push({ name, pass: !!pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 260)); };
const shot = (n) => page.screenshot({ path: `${prefix}-${size}-${n}.jpg`, type: 'jpeg', quality: 82 });
const P = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const frame = () => page.evaluate(() => window.__fw.app.loop.stats.frame);
async function frames(n = 2) { const f0 = await frame(); await page.waitForFunction((f) => window.__fw.app.loop.stats.frame >= f, f0 + n, { timeout: 120000 }); }
// Set a button and wait for the next frame to poll it (set and read in one task, so the frame
// that is waited for is one that saw the change). A tap is pressed for exactly one polled frame,
// as a quick press is at any frame rate (held longer, the d-pad repeats after 380 ms).
async function setBtn(b, on) { const f0 = await page.evaluate(([i, v]) => { window.__padSet(i, v); return window.__fw.app.loop.stats.frame; }, [b, on]); await page.waitForFunction((f) => window.__fw.app.loop.stats.frame >= f, f0 + 1, { timeout: 120000 }); }
async function tap(b) { await setBtn(b, true); await setBtn(b, false); await frames(1); }
async function stick(i, v, ms) { await page.evaluate(([a, x]) => window.__padAxis(a, x), [i, v]); await frames(2); await page.waitForTimeout(ms); await page.evaluate((a) => window.__padAxis(a, 0), i); await frames(2); }
const st = () => page.evaluate(() => { const g = window.__fw.game, s = g.state; return { phase: s.phase, aim: s.aim, club: s.club.id, shot: s.shotType.id, spin: g.spin(), modal: window.__fw.app.ui.modal || null, map: !!window.__fw.app.ui.map.open, list: window.__fw.app.ui.hud.clubListOpen(), focus: document.activeElement && (document.activeElement.textContent || document.activeElement.id || document.activeElement.tagName).trim().slice(0, 40) }; });
const screenIn = () => page.waitForFunction(() => { const s = document.querySelector('.screen'); return s && !s.classList.contains('off') && getComputedStyle(s).opacity === '1'; }, null, { timeout: 30000 }).catch(() => {});

try {
  await page.goto(`${server.url}/?mode=stroke&course=parkland&hole=4&holes=1&tier=low&scale=0.35&bot=1&seed=3`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  const ph0 = await waitPhase(page, ['intro', 'aim']);
  // 1. Detection (the pad is found without a connect event) and the hints.
  await page.waitForFunction(() => window.__fw.app.ui.input.gamepad === 0, null, { timeout: 60000 });
  if (ph0 === 'intro') await tap(P.A);
  await waitPhase(page, 'aim');
  await page.waitForTimeout(700);
  const hints = await page.evaluate(() => ({ padnav: document.documentElement.classList.contains('padnav'), padmode: document.getElementById('ui').classList.contains('padmode'), badges: [...document.querySelectorAll('.padhint')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent), zoneHint: (() => { const z = document.querySelector('.padzonehint'); return z && z.getBoundingClientRect().width > 0 ? z.textContent : null; })() }));
  ok('Controller found, button hints shown', hints.padnav && hints.padmode && hints.badges.length >= 6 && !!hints.zoneHint, hints);
  await shot('1-hints');
  // 2. Aim: the left stick and the d-pad.
  let s0 = await st();
  await stick(0, 0.8, 500);
  let s1 = await st();
  await tap(P.RIGHT);
  let s2 = await st();
  ok('Left stick and d-pad aim', s1.aim > s0.aim + 0.002 && Math.abs(s2.aim - s1.aim - 0.25 * Math.PI / 180) < 1e-6, { a0: s0.aim, stick: s1.aim, dpad: s2.aim });
  // 3. Club: RB, LB, d-pad down and up.
  s0 = await st(); await tap(P.RB); s1 = await st(); await tap(P.LB); const s3 = await st(); await tap(P.DOWN); const s4 = await st(); await tap(P.UP); const s5 = await st();
  ok('LB and RB, d-pad up and down change club', s1.club !== s0.club && s3.club === s0.club && s4.club === s1.club && s5.club === s0.club, { c0: s0.club, rb: s1.club, lb: s3.club, down: s4.club, up: s5.club });
  // 4. Shot type: RT, LT.
  s0 = await st(); await tap(P.RT); s1 = await st(); await tap(P.LT); const s6 = await st();
  ok('RT and LT change shot type', s1.shot !== s0.shot && s6.shot === s0.shot, { t0: s0.shot, rt: s1.shot, lt: s6.shot });
  // 5. The ball contact dot: right stick right and up, R3 centres.
  await stick(2, 1, 350); await stick(3, -1, 350);
  s1 = await st();
  await shot('2-spin-dot');
  await tap(P.R3);
  s2 = await st();
  ok('Right stick moves the contact dot (up adds backspin), R3 centres it', s1.spin.x > 0.05 && s1.spin.y > 0.05 && s2.spin.x === 0 && s2.spin.y === 0, { moved: s1.spin, centred: s2.spin });
  // 6. Map (X, d-pad, B) and the club list (View, d-pad, A).
  await tap(P.X); await page.waitForTimeout(400); s1 = await st();
  await shot('3-map');
  await tap(P.B); s2 = await st();
  ok('X opens the map, B closes it', s1.map && !s2.map, { open: s1.map, after: s2.map });
  s0 = await st();
  await tap(P.VIEW); await page.waitForTimeout(300); s1 = await st();
  await tap(P.DOWN); await tap(P.DOWN); const f1 = (await st()).focus;
  await shot('4-club-list');
  await tap(P.A); await page.waitForTimeout(300); s2 = await st();
  ok('View opens the club list; the d-pad moves, A picks a club', s1.list && !s2.list && s2.club !== s0.club, { open: s1.list, focus: f1, before: s0.club, picked: s2.club });
  // 7. The swing: hold A for the backswing, release at the top, A again for impact.
  await waitPhase(page, 'aim');
  const ideal = await page.evaluate(() => window.__fw.game.suggestedPower());
  await page.evaluate(() => {
    const zz = window.__fw.ui.hud.zone; window.__log = [];
    const wrap = (obj, k, tag) => { const f = obj[k]; obj[k] = function (...a) { window.__log.push(`${tag}(${a.map((x) => (typeof x === 'number' ? x.toFixed(1) : x)).join(',')}) now=${performance.now().toFixed(1)} phase=${zz.meter.state.phase} frame=${window.__fw.app.loop.stats.frame}`); return f.apply(this, a); }; };
    for (const k of ['meterDown', 'meterUp', 'meterPress', 'cancel', 'setEnabled']) wrap(zz, k, k);
    wrap(zz.meter, 'press', 'meter.press'); wrap(zz.meter, 'cancel', 'meter.cancel');
  });
  // Each change carries its own time (the pad's timestamp, the page clock when it was set), and
  // the hold and the gap are measured on the page clock, so slow software frames do not stretch
  // them; a frame polls each change before the next.
  const at = (t) => page.waitForFunction((x) => performance.now() >= x, t, { polling: 5, timeout: 60000 });
  const tPress = await page.evaluate((i) => { window.__padSet(i, true); return performance.now(); }, P.A);
  await frames(1);
  await at(tPress + Math.round(1100 * Math.min(0.9, ideal)));
  const tRel = await page.evaluate((i) => { window.__padSet(i, false); return performance.now(); }, P.A);
  await frames(1);
  await at(tRel + Math.round(370 * Math.min(0.9, ideal)));
  await page.evaluate((i) => window.__padSet(i, true), P.A);
  await frames(2);
  await page.evaluate((i) => window.__padSet(i, false), P.A);
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ phase: window.__fw.phase(), result: window.__fw.ui.hud.zone.lastResult }));
  out.swingLog = (await page.evaluate(() => window.__log)).filter((l) => !/^setEnabled\(true\)/.test(l)).slice(0, 40);
  out.swingTimes = { tPress, tRel };
  ok('A: hold, release, press swings', ['flight', 'settle', 'aim', 'summary'].includes(r.phase) && r.result && r.result.power > 0.1, { phase: r.phase, power: r.result && +r.result.power.toFixed(3), tempo: r.result && r.result.tempoLabel });
  await shot('5-swing');
  await page.evaluate(() => { window.__fw.app.loop.timescale = 6; });
  await waitPhase(page, ['aim', 'summary']);
  await page.evaluate(() => { window.__fw.app.loop.timescale = 1; });
  // 8. Menus: Menu pauses with Resume focused and a hint bar; the d-pad moves; B resumes.
  if ((await st()).modal) { await tap(P.B); await page.waitForTimeout(300); }
  await tap(P.MENU); await screenIn();
  s1 = await st();
  const bar = await page.evaluate(() => { const b = document.querySelector('.padbar'); return b && b.classList.contains('on') && getComputedStyle(b).display !== 'none' ? b.textContent : null; });
  await tap(P.DOWN); const fDown = (await st()).focus;
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  await shot('6-pause-menu');
  await tap(P.UP); const fUp = (await st()).focus;
  await tap(P.B); await page.waitForTimeout(400); s2 = await st();
  ok('Menu pauses with the main action focused; the d-pad moves (with a focus ring); B goes back', s1.modal === 'pause' && /Resume/.test(s1.focus) && fDown !== s1.focus && fUp === s1.focus && ring !== 'none' && !s2.modal && !!bar, { modal: s1.modal, focus: s1.focus, down: fDown, up: fUp, ring, bar, after: s2.modal });
  // Settings through the controller: Menu, move to the Settings button, A, then a select changed
  // with left and right.
  await tap(P.MENU); await screenIn();
  for (let i = 0; i < 8 && !/^Settings/.test((await st()).focus); i++) await tap(P.DOWN);
  const onSettings = (await st()).focus;
  await tap(P.A); await screenIn(); s1 = await st();
  const sizeBefore = await page.evaluate(() => window.__fw.app.settings.screenSize);
  await page.evaluate(() => document.getElementById('s-size').focus());
  await tap(P.RIGHT);
  const sizeAfter = await page.evaluate(() => window.__fw.app.settings.screenSize);
  await tap(P.LEFT);
  const sizeBack = await page.evaluate(() => window.__fw.app.settings.screenSize);
  await shot('7-settings');
  ok('A opens Settings from the pause menu; left and right change a setting', /^Settings/.test(onSettings) && s1.modal === 'settings' && sizeAfter !== sizeBefore && sizeBack === sizeBefore, { onSettings, modal: s1.modal, sizeBefore, sizeAfter, sizeBack });
  // B twice: back to the pause menu, then to the round. Then quit to the main menu.
  await tap(P.B); await page.waitForTimeout(300); await tap(P.B); await page.waitForTimeout(300);
  // 9. The level editor basics.
  await page.evaluate(() => { window.__fw.app.ui.screens.pause(); });
  await screenIn();
  await page.evaluate(() => { const b = [...document.querySelectorAll('.screen button')].find((x) => x.textContent.trim() === 'Quit round'); if (b) b.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim().startsWith('Create')); b.click(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim().startsWith('Dogleg')); b.click(); });
  await screenIn();
  await page.waitForTimeout(600);
  const lv = () => page.evaluate(() => window.__fw.app.levelEditor.level());
  const sel = () => page.evaluate(() => window.__fw.app.levelEditor.selected());
  const ez = () => page.evaluate(() => window.__fw.app.levelEditor.zoom());
  await page.waitForFunction(() => /Move piece/.test((document.querySelector('.padbar') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => {});
  const ebar = await page.evaluate(() => { const b = document.querySelector('.padbar'); return b && b.classList.contains('on') ? b.textContent : null; });
  await tap(P.RB); const selA = await sel(); await tap(P.RB); const selB = await sel(); await tap(P.LB); const selC = await sel();
  ok('LB and RB select pieces', selA && selB && JSON.stringify(selC) === JSON.stringify(selA) && JSON.stringify(selA) !== JSON.stringify(selB), { selA, selB, selC });
  const l0 = await lv(), z0 = await ez();
  // One diagonal move (both axes together, then released): one undo step.
  await page.evaluate(() => { window.__padAxis(0, 1); window.__padAxis(1, -0.6); });
  await frames(3); await page.waitForTimeout(400);
  await page.evaluate(() => { window.__padAxis(0, 0); window.__padAxis(1, 0); });
  await frames(2);
  const l1 = await lv(), z1 = await ez();
  const moved = JSON.stringify(l1) !== JSON.stringify(l0);
  ok('The left stick moves the selected piece, one undo step for the move', moved && z1.undo === z0.undo + 1, { piece: selA, undo: [z0.undo, z1.undo] });
  await tap(P.Y); const l2 = await lv();
  await tap(P.VIEW); const l3 = await lv();
  ok('Y undoes the move, View redoes it', JSON.stringify(l2) === JSON.stringify(l0) && JSON.stringify(l3) === JSON.stringify(l1));
  // Place a bunker with the d-pad and A (the Bunker button), then X deletes it.
  const n0 = l3.bunkers.length;
  await page.evaluate(() => { const b = [...document.querySelectorAll('.sheet.editor .lvtool')].find((x) => x.textContent.trim() === 'Bunker'); b.focus(); });
  await tap(P.A); const n1 = (await lv()).bunkers.length;
  await tap(P.X); const n2 = (await lv()).bunkers.length;
  ok('A presses the focused Bunker button, X deletes the new bunker', n1 === n0 + 1 && n2 === n0, { n0, n1, n2 });
  await tap(P.RT); await tap(P.RT); const z2 = await ez();
  await stick(2, 1, 300); const z3 = await ez();
  await shot('8-editor');
  await tap(P.LT); await tap(P.LT); const z4 = await ez();
  ok('RT and LT zoom, the right stick pans', z2.zoom > 1.4 && z3.pan.x < z2.pan.x - 20 && z4.zoom === 1, { zoomIn: z2.zoom, pan: z3.pan, zoomOut: z4.zoom });
  ok('The editor shows its controller bar', !!ebar && /Move piece/.test(ebar), ebar);
  await tap(P.B); await page.waitForTimeout(400);
  ok('B leaves the editor', (await st()).modal !== 'editor', (await st()).modal);
  // 10. The mouse hides the hints; the pad brings them back.
  await page.mouse.click(5, 5);
  const off = await page.evaluate(() => document.documentElement.classList.contains('padnav'));
  await tap(P.DOWN);
  const on = await page.evaluate(() => document.documentElement.classList.contains('padnav'));
  ok('The mouse hides the hints, the controller brings them back', !off && on, { afterMouse: off, afterPad: on });
} catch (e) { out.failed = e.message.split('\n')[0]; console.log('FAILED', out.failed); await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
out.passed = out.checks.filter((c) => c.pass).length; out.total = out.checks.length;
console.log(`${out.passed} of ${out.total} checks passed, console errors ${out.consoleErrors.length}`);
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
