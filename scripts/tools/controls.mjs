// Dev tool: keyboard and gamepad controls in a real round.
//   node scripts/tools/controls.mjs qa/tmp/ctl
// Keyboard events go through the DevTools Input domain with planned timestamps. Gamepads
// cannot be emulated by the browser automation, so the gamepad part replaces
// navigator.getGamepads with a scripted pad: it proves the mapping, not real hardware.
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { waitPhase } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/ctl'] = process.argv.slice(2);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await createServer({ logLevel: 'error', server: { port: 5198, host: '127.0.0.1' } });
await server.listen();
const { browser } = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
const errors = trackErrors(page);
const cdp = await page.context().newCDPSession(page);
let clock = 0;
const KEYS = { Space: [' ', 32], Enter: ['Enter', 13], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Digit2: ['2', 50], KeyM: ['m', 77], Escape: ['Escape', 27] };
async function key(code, at) {
  clock = Math.max(clock + 1, at ?? Date.now());
  const [k, vk] = KEYS[code];
  const base = { code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, timestamp: clock / 1000 };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: k.length === 1 ? k : undefined });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base, timestamp: (clock + 30) / 1000 });
  clock += 30;
}
const st = () => page.evaluate(() => { const s = window.__fw.game.state; return { phase: s.phase, club: s.club.id, shot: s.shotType.id, aim: +s.aim.toFixed(4), map: window.__fw.ui.map.open, modal: window.__fw.ui.modal }; });
try {
  await page.goto('http://127.0.0.1:5198/?mode=stroke&course=parkland&hole=1&holes=1&tier=low&seed=4&noassets', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  await page.evaluate(() => { window.__fw.app.settings.tutorialDone = true; });
  if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await key('Enter');
  await waitPhase(page, 'aim');
  const s0 = await st();
  await key('ArrowDown'); const s1 = await st();
  await key('ArrowUp'); await key('ArrowUp'); const s2 = await st();
  await key('ArrowRight'); await key('ArrowRight'); const s3 = await st();
  await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown'); await key('Digit2'); const s4 = await st();
  await key('KeyM'); const s5 = await st(); await key('Escape'); const s6 = await st();
  console.log('keyboard', JSON.stringify({ start: s0, down: s1.club, upUp: s2.club, aimRight: +(s3.aim - s2.aim).toFixed(4), shotType2: s4.shot, mapOpen: s5.map, mapClosedByEsc: !s6.map }));
  await page.screenshot({ path: `${prefix}-keyboard-aim.png` });
  // Three-press meter: start, set power after 0.8 s (about 73 percent), strike when the marker returns.
  const t0 = Date.now();
  await key('Space', t0); await key('Space', t0 + 800); await key('Space', t0 + 800 + 0.727 * 370);
  const swing = await page.evaluate(() => window.__fw.ui.hud.stick.lastResult);
  console.log('meter swing', JSON.stringify(swing && { power: +swing.power.toFixed(3), face: +swing.face.toFixed(2), label: swing.tempoLabel }), 'phase', (await st()).phase);
  await waitPhase(page, ['aim', 'summary'], 240000);
  // Scripted gamepad.
  await page.evaluate(() => {
    const pad = { index: 0, id: 'scripted pad', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), vibrationActuator: null };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
    const ev = new Event('gamepadconnected'); ev.gamepad = pad; window.dispatchEvent(ev);
  });
  const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const press = async (b) => { await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: true, value: 1 }; }, b); await frames(2); await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, value: 0 }; }, b); await frames(2); };
  const g0 = await st();
  await press(5); const g1 = await st();
  await press(4); const g2 = await st();
  await page.evaluate(() => { window.__pad.axes[0] = 0.8; }); await frames(6); await page.evaluate(() => { window.__pad.axes[0] = 0; }); await frames(1); const g3 = await st();
  await press(2); const g4 = await st(); await press(1); const g5 = await st();
  await press(9); const g6 = await st(); await press(1); const g7 = await st();
  console.log('gamepad', JSON.stringify({ start: g0.club, rb: g1.club, lb: g2.club, stickAim: +(g3.aim - g2.aim).toFixed(4), xMap: g4.map, bClose: !g5.map, startPause: g6.modal, bResume: g7.modal }));
  // The pad reports when each press happened (Gamepad.timestamp); presses are a frame apart.
  const padPress = async (b, at) => { await page.evaluate(([i, t]) => { window.__pad.timestamp = t; window.__pad.buttons[i] = { pressed: true, value: 1 }; }, [b, at]); await frames(1); await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, value: 0 }; }, b); await frames(1); };
  const now = await page.evaluate(() => performance.now());
  await padPress(0, now); await padPress(0, now + 700); await padPress(0, now + 700 + (700 / 1100) * 370);
  console.log('gamepad meter', JSON.stringify(await page.evaluate(() => { const r = window.__fw.ui.hud.stick.lastResult; return r && { power: +r.power.toFixed(3), label: r.tempoLabel }; })), 'phase', (await st()).phase);
  await page.screenshot({ path: `${prefix}-gamepad.png` });
} catch (e) { console.log('FAILED', e.message.split('\n')[0]); await page.screenshot({ path: `${prefix}-failed.png` }).catch(() => {}); }
if (errors.length) console.log('ERRORS', errors.length, errors.slice(0, 5).map((e) => e.text.slice(0, 300)));
await browser.close();
await server.close();
