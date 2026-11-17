// Dev tool: walk the menus with real clicks and screenshot each screen.
//   node scripts/tools/menus.mjs qa/tmp/menu [w] [h]
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { makeChallenge, encodeChallenge } from '../../src/game/share.js';
import { createRound } from '../../src/game/round.js';

const [prefix = 'qa/tmp/menu', w = '960', h = '540'] = process.argv.slice(2);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await createServer({ logLevel: 'error', server: { port: 5198, host: '127.0.0.1' } });
await server.listen();
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = trackErrors(page);
const shot = (name) => page.screenshot({ path: `${prefix}-${name}.png` });
const click = async (name) => { await page.getByRole('button', { name, exact: true }).first().click(); await page.waitForTimeout(250); };
const base = 'http://127.0.0.1:5198/?tier=low&noassets';
const log = (...a) => console.log(...a);
try {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  await page.waitForTimeout(600);
  await shot('main');
  log('main buttons', await page.$$eval('.screen button', (b) => b.map((x) => x.textContent)));
  await click('Settings'); await shot('settings');
  // Change units and handedness through the real controls.
  await page.selectOption('#s-units', 'meters');
  await page.check('#s-lh');
  log('settings', JSON.stringify(await page.evaluate(() => ({ units: window.__fw.app.settings.units, lefty: document.getElementById('ui').classList.contains('lefty'), stored: JSON.parse(localStorage.getItem('fairway-next.settings') || '{}').units }))));
  await page.selectOption('#s-units', 'yards'); await page.uncheck('#s-lh');
  await click('Back');
  await click('Stats and history'); await shot('stats'); await click('Back');
  await click('Daily challenge'); await shot('daily'); log('daily', await page.$eval('.sheet .muted', (e) => e.textContent)); await click('Back');
  await click('Pass and play'); await shot('passplay'); await click('Back');
  await click('Career'); await shot('career-new');
  await page.fill('#c-name', 'Robin Test');
  await click('Begin'); await shot('career-hub');
  log('career', JSON.stringify(await page.evaluate(() => { const c = window.__fw.app.save().career; return { name: c.name, level: c.level, tier: c.season.tier, rivals: c.rivals.length, events: c.season.events.length }; })));
  await click('Equipment'); await shot('career-equipment'); await click('Done');
  await click('Standings and rivals'); await shot('career-standings'); await click('Back');
  await click('Main menu');
  await click('Quick round'); await shot('setup'); await click('Back');
  // A valid challenge link and a tampered one.
  const r = createRound({ courseId: 'desert', holeCount: 3, seed: 777, tod: 'golden', players: [{ name: 'Sam' }] });
  r.scores[0] = [4, 3, 5];
  const tok = encodeChallenge(makeChallenge(r));
  await page.goto('about:blank');
  await page.goto(`${base}#c=${tok}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  await page.waitForTimeout(500);
  await shot('challenge');
  log('challenge', await page.$eval('.sheet', (e) => e.textContent.slice(0, 160)));
  const bad = tok.slice(0, -2) + (tok.endsWith('a') ? 'bb' : 'aa');
  // Same tab, hash change only (a pasted link).
  await page.evaluate((b) => { location.hash = 'c=' + b; }, bad);
  await page.waitForTimeout(800);
  await shot('challenge-bad');
  log('tampered', await page.$eval('.sheet', (e) => e.textContent.slice(0, 160)));
} catch (e) { console.log('FAILED', e.message.split('\n')[0]); await shot('failed').catch(() => {}); }
if (errors.length) console.log('ERRORS', errors.length, errors.slice(0, 5).map((e) => e.text.slice(0, 400)));
await browser.close();
await server.close();
