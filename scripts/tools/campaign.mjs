// Campaign screens through real taps on the production build, at one size: choosing an
// archetype, the hub, a chapter, a briefing, the character sheet, the skill tree (learning a
// skill and a respec), and the level-up card with the first evolution. Experience is seeded
// here as if earned (the earning rules are unit tested and the bot plays real events).
//   node scripts/tools/campaign.mjs qa/tmp/campaign/c [390x844] [archetype]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { createPointer } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/campaign/c', size = '390x844', arch = 'Sharpshooter'] = process.argv.slice(2);
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
const tapButton = async (text, startsWith = false) => {
  const r = await page.evaluate(([t, sw]) => {
    const label = (e) => [e.textContent.trim(), (e.getAttribute('aria-label') || '').trim()];
    const b = [...document.querySelectorAll('#ui button')].find((e) => label(e).some((x) => (sw ? x.startsWith(t) : x === t)) && e.offsetParent !== null && !e.disabled);
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const q = b.getBoundingClientRect();
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
  }, [text, startsWith]);
  if (!r) throw new Error(`no button "${text}"`);
  await pointer.tap(r.x, r.y); await page.waitForTimeout(400);
};
const measure = (name) => page.evaluate((n) => {
  const s = document.querySelector('.screen:not(.hidden) .sheet') || document.querySelector('.sheet');
  if (!s) return { name: n, none: true };
  const vw = document.documentElement.clientWidth;
  const over = [...s.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }).map((e) => e.className || e.tagName).slice(0, 5);
  const small = [...s.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.height < 40 || r.width < 40); }).map((b) => `${b.textContent.trim().slice(0, 16)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
  // Text cut off inside buttons (scrollWidth past clientWidth).
  const clipped = [...s.querySelectorAll('button, b, span')].filter((e) => e.clientWidth && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map((e) => e.textContent.trim().slice(0, 20)).slice(0, 5);
  return { name: n, overflow: over, smallButtons: small, clipped, docScroll: document.documentElement.scrollWidth > vw };
}, name);
const step = async (name) => { await page.waitForTimeout(250); await shot(name); out.screens[name] = await measure(name); };
try {
  await page.goto(`${server.url}/?tier=low&scale=0.5`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await page.waitForTimeout(600);
  await tapButton('Campaign', true);
  await step('pick');
  await tapButton(arch, true);
  await step('hub');
  await tapButton('Character');
  await step('character-l1');
  out.l1 = await page.evaluate(() => window.__fw.app.golferProfile());
  await tapButton('Back');
  await tapButton('Chapter 1', true);
  await step('chapter');
  await tapButton('Monthly Medal', true);
  await step('briefing');
  await tapButton('Back');
  await tapButton('Back');
  // Ten levels of experience as if earned, then the level-up card from the round-end path.
  out.levelUp = await page.evaluate(() => { const r = window.__fw.app.addXp(3300, 'QA'); return r; });
  await page.evaluate(() => { const l = window.__fw.app.pendingLevelUp; window.__fw.app.pendingLevelUp = null; window.__fw.app.showLevelUp(l.from, l.to); });
  await step('levelup');
  await tapButton('Skill tree');
  await step('tree-empty');
  // Learn the first two skills in the first branch through taps.
  const first = await page.evaluate(() => [...document.querySelectorAll('.tree .node')].slice(0, 2).map((b) => b.getAttribute('aria-label')));
  out.firstNodes = first;
  for (let i = 0; i < 2; i++) {
    const r = await page.evaluate((k) => { const b = [...document.querySelectorAll('.tree .node')][k]; b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, i);
    await pointer.tap(r.x, r.y); await page.waitForTimeout(300);
    await tapButton('Learn', true);
  }
  await step('tree-learned');
  out.afterLearn = await page.evaluate(() => { const s = window.__fw.app.save(); return { nodes: s.profile.nodes, xp: s.profile.xp }; });
  await tapButton('Back');
  // The tree was opened from the level-up card; close it to get back to the hub.
  if (await page.evaluate(() => [...document.querySelectorAll('#ui button')].some((b) => b.textContent.trim() === 'Later' && b.offsetParent !== null))) await tapButton('Later');
  await tapButton('Character');
  await step('character-l10');
  out.l10 = await page.evaluate(() => window.__fw.app.golferProfile());
  await tapButton('Skill tree');
  await tapButton('Respec (free)');
  await step('respec');
  await tapButton('Respec');
  out.afterRespec = await page.evaluate(() => window.__fw.app.save().profile);
  await step('tree-respec');
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
