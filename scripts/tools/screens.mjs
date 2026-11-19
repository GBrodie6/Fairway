// Every screen from the overhaul, reached through real taps from the main menu, at one size:
// a screenshot each, and measurements: elements past the viewport edge, buttons under 40 px,
// text clipped inside its box, and controls that overlap each other. Then the first-minute
// tutorial in a real round (the three prompts, with a real swing).
//   node scripts/tools/screens.mjs qa/tmp/screens/s [390x844] [tutorial=1] [mouse]
// mouse: a desktop mouse (no touch) and the in-memory cloud, plus the level creator screens.
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { createPointer, waitPhase, swing } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/screens/s', size = '390x844', tut = '1', input = 'touch'] = process.argv.slice(2);
const mouse = input === 'mouse';
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DSF || 1), hasTouch: !mouse, isMobile: !mouse && W < H });
ctx.setDefaultTimeout(240000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: !mouse });
const out = { size, screens: [], tutorial: null };
const tap = async (text, startsWith = true) => {
  const r = await page.evaluate(([t, sw]) => {
    const vis = [...document.querySelectorAll('#ui button')].filter((e) => e.offsetParent !== null && !e.disabled);
    const b = vis.find((e) => e.textContent.trim() === t) || (sw && vis.find((e) => e.textContent.trim().startsWith(t)));
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const q = b.getBoundingClientRect();
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
  }, [text, startsWith]);
  if (!r) throw new Error(`no button "${text}"`);
  await pointer.tap(r.x, r.y); await page.waitForTimeout(380);
};
const measure = () => page.evaluate(() => {
  const s = document.querySelector('.screen:not(.hidden) .sheet');
  if (!s) return { none: true };
  const vw = document.documentElement.clientWidth;
  const els = [...s.querySelectorAll('*')];
  const overflow = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }).map((e) => e.className || e.tagName).slice(0, 4);
  const ctrls = [...s.querySelectorAll('button, select, input')].filter((b) => b.getBoundingClientRect().width > 0);
  const small = ctrls.filter((b) => b.tagName === 'BUTTON').filter((b) => { const r = b.getBoundingClientRect(); return r.height < 40 || r.width < 40; }).map((b) => `${b.textContent.trim().slice(0, 14)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`).slice(0, 4);
  const clipped = [...s.querySelectorAll('button, b, span, p, h2, h3')].filter((e) => e.clientWidth && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').map((e) => e.textContent.trim().slice(0, 18)).slice(0, 4);
  const boxes = ctrls.map((b) => ({ b, r: b.getBoundingClientRect() }));
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].r, c = boxes[j].r;
    if (boxes[i].b.contains(boxes[j].b) || boxes[j].b.contains(boxes[i].b)) continue;
    const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left), iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
    if (ix > 1 && iy > 1) overlaps.push(`${boxes[i].b.textContent.trim().slice(0, 10)}|${boxes[j].b.textContent.trim().slice(0, 10)}`);
  }
  return { title: (s.querySelector('h1, h2') || {}).textContent || '', overflow, small, clipped, overlaps: overlaps.slice(0, 4), docScroll: document.documentElement.scrollWidth > vw };
});
const n = { i: 0 };
const visit = async (name) => {
  await page.waitForTimeout(250);
  n.i++;
  await page.screenshot({ path: `${prefix}-${size}-${String(n.i).padStart(2, '0')}-${name}.png` });
  const m = await measure();
  out.screens.push({ name, ...m });
};
try {
  await page.goto(`${server.url}/?tier=low&scale=0.5${mouse ? '&cloud=demo' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await page.waitForTimeout(700);
  await visit('menu');
  await tap('Quick Play'); await visit('quickplay');
  await tap('Tournament'); await visit('tournament'); await tap('Back'); await tap('Back');
  await tap('Campaign'); await visit('campaign-pick');
  await tap('Links Player'); await visit('campaign-hub');
  await tap('Chapter 1').catch(async () => { await page.evaluate(() => { const b = document.querySelector('.item.chapter'); b.scrollIntoView(); b.click(); }); await page.waitForTimeout(300); });
  await visit('campaign-chapter');
  await page.evaluate(() => { const b = document.querySelector('.item.event'); b.scrollIntoView(); b.click(); }); await page.waitForTimeout(350);
  await visit('campaign-briefing'); await tap('Back'); await tap('Back');
  await tap('Character'); await visit('character'); await tap('Back');
  await tap('Skill tree'); await visit('skilltree'); await tap('Back');
  await tap('Back');
  await tap('Range'); await visit('range-lobby'); await tap('Back');
  await tap('Daily'); await visit('daily');
  await tap('Quests'); await visit('quests'); await tap('Back');
  await tap('Season track'); await visit('season'); await tap('Back'); await tap('Back');
  await tap('Profile'); await visit('profile');
  await tap('Gear'); await visit('gear'); await tap('Drops'); await visit('gear-drops'); await tap('Back');
  await tap('Locker'); await visit('locker'); await tap('Back');
  await tap('Achievements'); await visit('achievements'); await tap('Back');
  await tap('Stats and history'); await visit('stats'); await tap('Back');
  await tap('Leaderboards'); await visit('leaderboards'); await tap('Back');
  await tap('Account (optional)'); await visit('account'); await tap('Back');
  await tap('Back');
  await tap('Settings'); await visit('settings'); await tap('Back');
  if (mouse) {
    await tap('Create'); await visit('create');
    await tap('Short par 3 over water'); await page.waitForTimeout(400); await visit('editor');
    await tap('Back'); await tap('Browse holes'); await page.waitForTimeout(800); await visit('levels'); await tap('Back');
  }
  if (tut === '1') {
    // The tutorial: a 3-hole quick round on a fresh profile.
    await page.evaluate(() => { const a = window.__fw.app; a.settings.tutorialDone = false; a.saveSettings(); });
    await tap('Quick Play'); await tap('3 holes'); await tap('Tee off');
    if ((await waitPhase(page, ['intro', 'aim'])) === 'intro') { await page.waitForTimeout(500); await page.evaluate(() => window.__fw.game.skipIntro()); }
    await waitPhase(page, 'aim');
    await page.waitForTimeout(900);
    const tip = () => page.evaluate(() => { const t = document.querySelector('.tip'); return t && !t.classList.contains('hidden') ? t.innerText.replace(/\n/g, ' / ') : null; });
    const t1 = await tip();
    n.i++; await page.screenshot({ path: `${prefix}-${size}-${String(n.i).padStart(2, '0')}-tutorial-1.png` });
    const ideal = await page.evaluate(() => window.__fw.game.suggestedPower());
    await swing(page, pointer, { power: ideal, backMs: 780, downMs: 260 });
    await waitPhase(page, ['aim', 'summary'], 120000);
    await page.waitForTimeout(900);
    const t2 = await tip();
    n.i++; await page.screenshot({ path: `${prefix}-${size}-${String(n.i).padStart(2, '0')}-tutorial-2.png` });
    if (t2) await tap('Next', false);
    await page.waitForTimeout(700);
    const t3 = await tip();
    n.i++; await page.screenshot({ path: `${prefix}-${size}-${String(n.i).padStart(2, '0')}-tutorial-3.png` });
    if (t3) await tap('Got it', false);
    out.tutorial = { t1, t2, t3, done: await page.evaluate(() => window.__fw.app.settings.tutorialDone) };
  }
} catch (e) { out.failed = e.message.split('\n')[0]; await page.screenshot({ path: `${prefix}-${size}-failed.png` }).catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
out.problems = out.screens.filter((s) => s.overflow && (s.overflow.length || s.small.length || s.clipped.length || s.overlaps.length || s.docScroll)).map((s) => ({ name: s.name, overflow: s.overflow, small: s.small, clipped: s.clipped, overlaps: s.overlaps, docScroll: s.docScroll }));
console.log(JSON.stringify({ size, failed: out.failed, screens: out.screens.length, problems: out.problems, tutorial: out.tutorial, consoleErrors: out.consoleErrors }, null, 1));
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
