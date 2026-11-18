// Note: written for the menu before the overhaul (it opens the old career, which the menu no longer
// shows); scripts/tools/screens.mjs covers the current menus. Dev tool: walk the menus with real clicks and screenshot each screen.
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
ctx.setDefaultNavigationTimeout(180000);
ctx.setDefaultTimeout(120000);
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
  await click('Daily'); await shot('daily'); log('daily', await page.$eval('.sheet .muted', (e) => e.textContent)); await click('Back');
  await click('Pass and play'); await shot('passplay'); await click('Back');
  await click('Career'); await shot('career-new');
  await page.fill('#c-name', 'Robin Test');
  await click('Begin'); await shot('career-hub');
  log('career', JSON.stringify(await page.evaluate(() => { const c = window.__fw.app.save().career; return { name: c.name, level: c.level, tier: c.season.tier, rivals: c.rivals.length, events: c.season.events.length }; })));
  await click('Equipment'); await shot('career-equipment'); await click('Done');
  await click('Standings and rivals'); await shot('career-standings'); await click('Back');
  await click('Main menu');
  await click('Quick Play'); await shot('setup'); await click('Back');
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
  // Audio: unlocked by the clicks above; render each sound offline and measure it.
  const audio = await page.evaluate(async () => {
    const a = window.__fw.app.audio;
    a.unlock();
    await new Promise((r) => setTimeout(r, 300));
    const club = (id, kind) => ({ id, kind, putter: id === 'PT' });
    const out = { ready: a.ready, state: a.ctx && a.ctx.state };
    const probes = {
      driver: (x) => x.strike(club('DR', 'wood'), 1, 1), iron: (x) => x.strike(club('I7', 'iron'), 0.9, 1), putt: (x) => x.strike(club('PT', 'putter'), 0.5, 1),
      landGreen: (x) => x.land(5, 12, true), landSand: (x) => x.land(7, 15, true), splash: (x) => x.splash(), cup: (x) => x.cup(), whoosh: (x) => x.whoosh(1), silence: () => {},
    };
    for (const [k, f] of Object.entries(probes)) out[k] = await a.probe(f, 1.0);
    return out;
  });
  console.log('audio', JSON.stringify(audio));
  // Share a round from the pause menu, then open the link in a fresh tab.
  await page.goto('about:blank');
  await page.goto(`${base}&mode=stroke&holes=3&course=links&seed=99&bot=1`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__fw && window.__fw.ready && ['intro', 'aim'].includes(window.__fw.phase()), null, { timeout: 240000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await shot('pause');
  await click('Share this round');
  const link = await page.$eval('.sheet input[aria-label="Challenge link"]', (e) => e.value);
  await shot('share');
  const p3 = await ctx.newPage();
  // The dev server needs the same test parameters the rest of this run uses.
  await p3.goto(link.replace('/#', '/?tier=low&noassets#'), { waitUntil: 'load', timeout: 180000 });
  await p3.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
  await p3.waitForTimeout(500);
  console.log('shared link', link.slice(0, 40) + '...', link.length, 'chars;', await p3.$eval('.sheet', (e) => e.textContent.slice(0, 140)));
  await p3.screenshot({ path: `${prefix}-shared-open.png` });
  await p3.close();
} catch (e) { console.log('FAILED', e.message.split('\n')[0]); await shot('failed').catch(() => {}); }
if (errors.length) console.log('ERRORS', errors.length, errors.slice(0, 5).map((e) => e.text.slice(0, 400)));
await browser.close();
await server.close();
