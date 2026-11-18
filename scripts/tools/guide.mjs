// The tier carry on the club card and in the power guide, measured in the real build on the
// range at the 125-yard target: the same 7 iron as Common, as Legendary for a player with the
// default Pured rate, and as Legendary for a player who pures 70 percent of clean strikes.
// The bag and the Pured rate are set directly (the earning rules are unit tested).
//   node scripts/tools/guide.mjs qa/tmp/guide/g [390x844]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/guide/g', size = '390x844'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
ctx.setDefaultTimeout(240000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const out = { size, rows: [] };
try {
  await page.goto(`${server.url}/?tier=low&scale=0.5`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  // A Legendary 7 iron in the gear (not yet in the bag).
  await page.evaluate(() => window.__fw.app.updateSave((s) => ({ ...s, gear: { ...s.gear, clubs: [...s.gear.clubs, { uid: 'I7-legendary-qa', clubId: 'I7', rarity: 'legendary' }] } })));
  await page.evaluate(() => window.__fw.game.startRange({ bay: 2, surface: 'mat', tod: 'morning', players: [{ kind: 'human', name: 'You', ball: '#ffffff' }] }));
  await waitPhase(page, 'aim');
  await page.evaluate(() => window.__fw.game.setRangeTarget(125));
  const configs = [
    ['Common 7 iron', 'common', null],
    ['Legendary 7 iron, default Pured rate', 'legendary', null],
    ['Legendary 7 iron, Pured rate 70 percent', 'legendary', { rate: 0.7, count: 200 }],
  ];
  for (const [label, tier, mix] of configs) {
    await page.evaluate(([t, m]) => {
      const app = window.__fw.app, g = window.__fw.game;
      app.updateSave((s) => {
        const want = s.gear.clubs.find((c) => c.clubId === 'I7' && c.rarity === t).uid;
        const bag = s.gear.bag.map((u) => (s.gear.clubs.find((c) => c.uid === u).clubId === 'I7' ? want : u));
        return { ...s, gear: { ...s.gear, bag }, strikeMix: m };
      });
      // Re-pick the club so the guide recomputes with the new bag.
      g.setClub('I8'); g.setClub('I7');
    }, [tier, mix]);
    await page.waitForTimeout(700);
    const row = await page.evaluate(() => {
      const g = window.__fw.game, st = g.state;
      return { card: document.querySelector('.clubbtn .cc').textContent, carryYd: +(g.clubCarry(st.club) / 0.9144).toFixed(1), factor: +g.guideFactor(st.club).toFixed(4), guidePower: +g.suggestedPower().toFixed(3), fanCarryYd: st.prediction ? +(st.prediction.carry / 0.9144).toFixed(1) : null, fanTotalYd: st.prediction ? +(st.prediction.total / 0.9144).toFixed(1) : null };
    });
    out.rows.push({ label, ...row });
    await page.screenshot({ path: `${prefix}-${size}-${tier}${mix ? '-pure70' : ''}.png` });
  }
} catch (e) { out.failed = e.message.split('\n')[0]; }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
