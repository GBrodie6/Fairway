// The account screens through real taps and typing, at a phone size, on the production build.
//   node scripts/tools/account.mjs qa/tmp/acct/a [390x844] [demo]
// With "demo" the build's in-memory stand-in is used (?cloud=demo): sign up, see the synced
// account, post a score, read a leaderboard, sign out and back in, and delete everything.
// Without it, the screens show the cloud-off state of a build without Supabase keys.
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { createPointer } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/acct/a', size = '390x844', mode = 'demo'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
ctx.setDefaultTimeout(240000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: true });
const out = { mode, size };
const shot = (n) => page.screenshot({ path: `${prefix}-${mode}-${size}-${n}.png` });
const tapText = async (text) => {
  const r = await page.evaluate((t) => { const b = [...document.querySelectorAll('#ui button')].find((e) => e.textContent.trim() === t && e.offsetParent !== null); if (!b) return null; b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, text);
  if (!r) throw new Error(`no button "${text}"`);
  await pointer.tap(r.x, r.y); await page.waitForTimeout(400);
};
const type = async (id, text) => {
  const r = await page.evaluate((i) => { const e = document.getElementById(i); e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, id);
  await pointer.tap(r.x, r.y);
  await page.evaluate((i) => { document.getElementById(i).value = ''; }, id);
  await page.keyboard.type(text, { delay: 5 });
};
const statusText = () => page.evaluate(() => [...document.querySelectorAll('.screen [role="status"]')].map((e) => e.textContent).join(' | '));
try {
  await page.goto(`${server.url}/?tier=low&scale=0.5${mode === 'demo' ? '&cloud=demo' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await page.waitForTimeout(800);
  await shot('menu');
  // The account lives under Profile.
  await page.evaluate(() => { const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim().startsWith('Profile')); if (b) b.click(); });
  await page.waitForTimeout(400);
  await tapText('Account (optional)');
  await shot('account');
  if (mode === 'demo') {
    await type('a-name', 'Ana Birdie');
    await type('a-email', 'ana@example.com');
    await type('a-pass', 'fairway-1');
    await tapText('Create account');
    await page.waitForFunction(() => document.querySelector('.screen h2') && document.querySelector('.screen h2').textContent === 'Your account', null, { timeout: 30000 });
    out.signedIn = await page.evaluate(() => ({ user: !!window.__fw.app.cloud.client.user, account: window.__fw.app.save().account }));
    await shot('signed-in');
    // A leaderboard score as the game posts it after a daily round, then the board.
    out.posted = await page.evaluate(async () => (await window.__fw.app.postScore('daily', -1)).error || 'ok');
    await tapText('Back');
    await tapText('Leaderboards');
    await page.waitForTimeout(600);
    out.board = await page.evaluate(() => [...document.querySelectorAll('.screen .list .item')].map((e) => e.textContent));
    await shot('leaderboard');
    await tapText('Back');
    await tapText('Account');
    await tapText('Sign out');
    out.afterSignOut = await page.evaluate(() => ({ user: !!window.__fw.app.cloud.client.user, account: window.__fw.app.save().account }));
    await tapText('I have an account');
    await type('a-email', 'ana@example.com');
    await type('a-pass', 'wrong-pass');
    await tapText('Sign in');
    await page.waitForTimeout(500);
    out.wrongPassword = await statusText();
    await shot('wrong-password');
    await type('a-pass', 'fairway-1');
    await tapText('Sign in');
    await page.waitForFunction(() => document.querySelector('.screen h2') && document.querySelector('.screen h2').textContent === 'Your account', null, { timeout: 30000 });
    out.signedBackIn = await page.evaluate(() => window.__fw.app.save().account);
    await tapText('Delete account and data');
    await shot('delete');
    await tapText('Delete everything');
    await page.waitForTimeout(800);
    out.afterDelete = await page.evaluate(() => ({ user: !!window.__fw.app.cloud.client.user, history: window.__fw.app.save().history.length, account: window.__fw.app.save().account }));
  } else {
    out.offText = await page.evaluate(() => document.querySelector('.screen .sheet').textContent.slice(0, 200));
    await tapText('Privacy');
    await shot('privacy');
    await tapText('Back');
    await tapText('Back');
    await tapText('Leaderboards');
    await shot('leaderboard-off');
  }
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${prefix}-${mode}-${size}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
