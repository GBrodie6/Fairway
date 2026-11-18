// The gear screens through real taps on the production build: the bag, one club with its stat
// bars, gear drops with the printed odds (tokens are seeded here as if earned, which the
// unit tests cover), equip and compare, balls, and then a round with the equipped club's
// finish. Measures horizontal overflow and button sizes on every screen.
//   node scripts/tools/gear.mjs qa/tmp/gear/g [390x844]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { createPointer, waitPhase, clickSel } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/gear/g', size = '390x844'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
ctx.setDefaultTimeout(240000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: true });
const out = { size, screens: {} };
const shot = (n) => page.screenshot({ path: `${prefix}-${size}-${n}.png` });
// Find a visible button by its text (exact, or the start of it), scroll it into view, tap it.
const tapButton = async (text, startsWith = false) => {
  const r = await page.evaluate(([t, sw]) => {
    const b = [...document.querySelectorAll('#ui button')].find((e) => (sw ? e.textContent.trim().startsWith(t) && !e.disabled : e.textContent.trim() === t) && e.offsetParent !== null);
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const q = b.getBoundingClientRect();
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
  }, [text, startsWith]);
  if (!r) throw new Error(`no button "${text}"`);
  await pointer.tap(r.x, r.y); await page.waitForTimeout(450);
};
const tapText = (text) => tapButton(text, false);
const tapStarts = (text) => tapButton(text, true);
// Layout checks for the visible sheet: no horizontal overflow, and small buttons.
const measure = (name) => page.evaluate((n) => {
  const s = document.querySelector('.screen:not(.hidden) .sheet') || document.querySelector('.sheet');
  const vw = document.documentElement.clientWidth;
  const over = [...s.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }).map((e) => e.className || e.tagName).slice(0, 5);
  const small = [...s.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.height < 40 || r.width < 40); }).map((b) => `${b.textContent.trim().slice(0, 20)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
  return { name: n, sheetW: Math.round(s.getBoundingClientRect().width), vw, overflow: over, smallButtons: small, docScroll: document.documentElement.scrollWidth > vw };
}, name);
try {
  await page.goto(`${server.url}/?tier=low&scale=0.5&fresh=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await page.waitForTimeout(800);
  await tapText('Gear');
  await shot('bag');
  out.screens.bag = await measure('bag');
  out.bag = await page.evaluate(() => [...document.querySelectorAll('.gear .clubrow')].map((e) => e.textContent));
  await tapStarts('DR');
  await shot('driver');
  out.screens.driver = await measure('driver');
  await tapText('Bag');
  await tapText('Drops');
  await shot('drops-empty');
  out.screens.dropsEmpty = await measure('drops-empty');
  out.oddsText = await page.evaluate(() => [...document.querySelectorAll('.gear .odds .item')].map((e) => e.textContent));
  // Seed 6 tokens as if earned from rounds (the earning rules are unit tested).
  await page.evaluate(() => window.__fw.app.updateSave((s) => ({ ...s, wallet: { ...s.wallet, tokens: 6 } })));
  await tapText('Bag'); await tapText('Drops');
  out.drops = [];
  for (let i = 0; i < 6; i++) {
    await tapStarts('Open a gear drop');
    out.drops.push(await page.evaluate(() => { const r = document.querySelector('.dropresult'); return r ? r.innerText.replace(/\n/g, ' / ') : null; }));
    if (i === 0) await shot('drop-1');
  }
  await shot('drops-after');
  out.screens.dropsAfter = await measure('drops-after');
  out.gearAfter = await page.evaluate(() => { const g = window.__fw.app.save().gear; return { clubs: g.clubs.length, balls: g.balls.length, gloves: g.gloves.length, pity: g.pity, opened: g.opened, shards: window.__fw.app.save().wallet.shards, tokens: window.__fw.app.save().wallet.tokens }; });
  // A rare 7 iron as if from a chapter reward, then compare and equip through taps.
  await page.evaluate(() => window.__fw.app.updateSave((s) => {
    const add = [{ uid: 'I7-rare-qa', clubId: 'I7', rarity: 'rare' }, { uid: 'DR-legendary-qa', clubId: 'DR', rarity: 'legendary' }].filter((c) => !s.gear.clubs.some((x) => x.clubId === c.clubId && x.rarity === c.rarity));
    return { ...s, gear: { ...s.gear, seq: s.gear.seq + 1, clubs: [...s.gear.clubs, ...add] } };
  }));
  await tapText('Bag');
  await tapStarts('7i');
  await tapText('Compare');
  await shot('compare');
  out.screens.compare = await measure('compare');
  out.compare = await page.evaluate(() => [...document.querySelectorAll('.compare .statrow')].map((e) => e.innerText.replace(/\n/g, ' ')));
  await tapText('Equip');
  out.equippedI7 = await page.evaluate(() => window.__fw.app.gearFor('I7'));
  await tapText('Bag');
  await tapStarts('DR');
  await tapStarts('Equip');
  out.equippedDR = await page.evaluate(() => window.__fw.app.gearFor('DR'));
  await tapText('Bag');
  await tapText('Balls');
  await shot('balls');
  out.screens.balls = await measure('balls');
  await tapText('Bag');
  await shot('bag-after');
  // A round with the Legendary driver: the club finish and the tier ring on the club button.
  await page.goto(`${server.url}/?mode=stroke&course=parkland&hole=1&holes=1&tier=low&scale=0.6&seed=3`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') await clickSel(page, pointer, '.intro-skip');
  await waitPhase(page, 'aim');
  await page.waitForTimeout(600);
  // Close the first-round tips so the club head is in view.
  if (await page.evaluate(() => [...document.querySelectorAll('#ui button')].some((b) => b.textContent.trim() === 'Skip' && b.offsetParent !== null))) await tapText('Skip');
  await page.waitForTimeout(400);
  out.clubBtnTier = await page.evaluate(() => document.querySelector('.clubbtn').dataset.tier);
  await shot('round-legendary-driver');
  await page.evaluate(() => window.__fw.game.setClub('I7'));
  await page.waitForTimeout(1200);
  await shot('round-rare-7i');
  out.clubBtnTierI7 = await page.evaluate(() => document.querySelector('.clubbtn').dataset.tier);
  out.clubMaterial = await page.evaluate(() => { const c = window.__fw.app.world.club && window.__fw.app.world.club.group; let r = null; if (c) c.traverse((o) => { if (!r && o.userData && o.userData.rarity) r = o.userData.rarity; }); return r; });
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
