// The pros through real taps: Quick Play as a pro against a pro rival (a real swing, then the
// computer pro's turn), the roster screen, Daily and Tournament with the Play as row, and a
// Campaign mentor. Screenshots and a JSON summary.
//   node scripts/tools/pros.mjs qa/tmp/pros/p [390x844]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { waitPhase, createPointer, swing } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/pros/p', size = '390x844'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
ctx.setDefaultTimeout(300000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: true });
const out = { size };
const shot = (n) => page.screenshot({ path: `${prefix}-${size}-${n}.png` });
const tapEl = async (fn, arg) => {
  const c = await page.evaluate(([f, a]) => { const e = (new Function('a', f))(a); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, [fn, arg]);
  if (!c) throw new Error(`nothing to tap: ${arg}`);
  await pointer.tap(c.x, c.y); await page.waitForTimeout(450);
};
const tapText = (t) => tapEl("return [...document.querySelectorAll('#ui button')].find((e) => e.textContent.trim().startsWith(a) && e.offsetParent !== null)", t);
const tapChip = (row, name) => tapEl(`const rows = [...document.querySelectorAll('.prorow')]; const r = rows[${row}]; return r && [...r.querySelectorAll('.prochip')].find((e) => e.textContent.includes(a));`, name);
try {
  await page.goto(`${server.url}/?tier=low&scale=0.5&bot=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await page.waitForTimeout(600);
  // Quick Play: play as Amara Quellwood against Teodor Kellbrook.
  await tapText('Quick Play');
  await tapEl("return document.getElementById('rival')", 'rival');
  await page.evaluate(() => window.__fw.app.ui.screens.setup());
  await page.waitForTimeout(300);
  await tapChip(0, 'Quellwood');
  await tapChip(1, 'Kellbrook');
  await shot('1-quickplay');
  out.setup = await page.evaluate(() => [...document.querySelectorAll('.prorow')].map((r) => [...r.querySelectorAll('.prochip.on')].map((c) => c.textContent)));
  await tapText('Tee off');
  await page.waitForFunction(() => ['aim', 'intro'].includes(window.__fw.game.state.phase), null);
  if (await page.evaluate(() => window.__fw.game.state.phase === 'intro')) { await page.evaluate(() => document.querySelector('.intro-skip') && document.querySelector('.intro-skip').click()); }
  await waitPhase(page, 'aim');
  out.round = await page.evaluate(() => ({ players: window.__fw.game.state.round.players.map((p) => ({ name: p.name, kind: p.kind, pro: p.pro, archetype: p.archetype })), profile: window.__fw.game.state.profile, spinRange: window.__fw.game.spinRange() }));
  await shot('2-as-pro');
  const power = await page.evaluate(() => window.__fw.game.suggestedPower());
  await swing(page, pointer, { power, backMs: 780, downMs: 260 });
  // Wait for the computer pro to play and the turn to come back.
  await page.waitForFunction(() => { const s = window.__fw.game.state; return s.phase === 'aim' && s.lastShot && s.round.players[s.turn].kind === 'human'; }, null, { timeout: 240000 });
  out.afterAi = await page.evaluate(() => { const r = window.__fw.game.state.round; return r.state.map((s, i) => ({ player: r.players[i].name, strokes: s.strokes, lie: s.lie })); });
  await shot('3-after-rival');
  await page.evaluate(() => window.__fw.game.quit());
  // The roster.
  await page.evaluate(() => window.__fw.app.ui.screens.registry.pros());
  await page.waitForTimeout(500);
  out.roster = await page.evaluate(() => document.querySelectorAll('.procard').length);
  await shot('4-roster');
  // Daily and Tournament.
  await page.evaluate(() => window.__fw.app.ui.screens.registry.daily());
  await page.waitForTimeout(400);
  await tapChip(0, 'Duncairn');
  await shot('5-daily');
  out.daily = await page.evaluate(() => [...document.querySelectorAll('.prorow .prochip.on')].map((c) => c.textContent));
  await page.evaluate(() => window.__fw.app.ui.screens.registry.tournament());
  await page.waitForTimeout(400);
  await tapChip(0, 'Solvane');
  await shot('6-tournament');
  out.tournamentChip = await page.evaluate(() => [...document.querySelectorAll('.prorow .prochip.on')].map((c) => c.textContent));
  // Campaign: a Sharpshooter picks Iker Solvane as mentor and learns the Flop.
  await page.evaluate(() => window.__fw.app.updateSave((s) => ({ ...s, profile: { ...s.profile, archetype: 'sharp', xp: 2000, nodes: [] } })));
  await page.evaluate(() => window.__fw.app.ui.screens.registry.character());
  await page.waitForTimeout(400);
  await tapText('Choose a mentor');
  await tapChip(0, 'Solvane');
  await shot('7-mentor');
  await tapText('Learn the');
  out.mentor = await page.evaluate(() => ({ mentor: window.__fw.app.save().profile.mentor, text: [...document.querySelectorAll('.screen p')].map((p) => p.textContent).find((t) => t.startsWith('Shots:')) }));
  await shot('8-character');
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${prefix}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
