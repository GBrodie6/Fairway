// The account screens through real taps and typing, at a phone size, on the production build.
//   node scripts/tools/account.mjs qa/tmp/acct/a [390x844] [demo|live|off]
//   demo  the build's in-memory stand-in (?cloud=demo); the digits are read from the demo
//         picture's own text
//   live  the real project (the build's .env.production, or URL=https://... for a deployed
//         copy). The picture is saved as <prefix>-live-<size>-pic-<n>.png and the tool waits for
//         a person (or the agent running it) to read it and write the 5 digits to
//         <prefix>-live-<size>-answer-<n>.txt ("new" asks for a new picture, up to 5 times)
//   off   a build without Supabase values
// The flow: a wrong code (the friendly message and a new picture), sign-up, a change saved to
// the cloud, a leaderboard score, sign out, the device save wiped, sign in, the cloud save
// restored, Delete my data, and a failed sign-in for the deleted account.
import path from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { createPointer } from '../lib/drive.mjs';

const [prefix = 'qa/tmp/acct/a', size = '390x844', mode = 'demo'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: mode === 'live' ? 2 : 1, hasTouch: true, isMobile: W < H });
ctx.setDefaultTimeout(240000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: true });
const out = { mode, size, url: server.url };
const base = `${prefix}-${mode}-${size}`;
const shot = (n) => page.screenshot({ path: `${base}-${n}.png` });
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
const tapAccount = async () => { const has = await page.evaluate(() => [...document.querySelectorAll('#ui button')].some((e) => e.textContent.trim() === 'Account' && e.offsetParent !== null)); await tapText(has ? 'Account' : 'Account (optional)'); };
const toProfile = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim().startsWith('Profile')); if (b) b.click(); }); await page.waitForTimeout(400); };
const statusText = () => page.evaluate(() => [...document.querySelectorAll('.screen [role="status"]')].map((e) => e.textContent).join(' | '));
const heading = () => page.evaluate(() => (document.querySelector('.screen h2') || {}).textContent || '');
const waitHeading = (t, ms = 40000) => page.waitForFunction((x) => document.querySelector('.screen h2') && document.querySelector('.screen h2').textContent === x, t, { timeout: ms });
const picSrc = () => page.evaluate(() => (document.querySelector('img.robotpic') || {}).src || '');
const waitPicture = async (old = '') => { await page.waitForFunction((o) => { const i = document.querySelector('img.robotpic'); return i && i.src.startsWith('data:image/svg+xml') && i.src !== o && i.complete; }, old, { timeout: 30000 }); await page.waitForTimeout(300); return picSrc(); };
let picN = 0;
// Read the 5 digits: from the demo picture's text, or from a person reading the saved picture.
async function readDigits() {
  picN++;
  const el = page.locator('img.robotpic');
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: `${base}-pic-${picN}.png` });
  if (mode === 'demo') {
    const svg = decodeURIComponent((await picSrc()).split(',').slice(1).join(','));
    return [...svg.matchAll(/<text[^>]*>(\d)<\/text>/g)].map((m) => m[1]).join('');
  }
  const f = `${base}-answer-${picN}.txt`;
  console.log(`PICTURE ${base}-pic-${picN}.png -> write the digits to ${f}`);
  const t0 = Date.now();
  while (!existsSync(f)) { if (Date.now() - t0 > 540000) throw new Error('no answer within 9 minutes'); await page.waitForTimeout(1000); }
  return readFileSync(f, 'utf8').trim();
}
// Console errors per phase: the deliberate wrong code and wrong password steps get server
// errors by design (Chrome logs every 4xx and 5xx reply), so they are counted apart.
const phases = [];
let phaseName = 'start', phaseAt = 0;
const phase = (n) => { phases.push({ phase: phaseName, errors: errors.slice(phaseAt).map((e) => e.text.slice(0, 160)) }); phaseName = n; phaseAt = errors.length; };
const user = process.env.FW_USER || `fwtest${Math.floor(100000 + Math.random() * 900000)}`;
const pass = `Fw-${Math.random().toString(36).slice(2, 10)}-9`;
try {
  await page.goto(`${server.url}/?tier=low&scale=0.5${mode === 'demo' ? '&cloud=demo' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await page.waitForTimeout(800);
  // The account lives under Profile.
  await page.evaluate(() => { const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim().startsWith('Profile')); if (b) b.click(); });
  await page.waitForTimeout(400);
  await tapText('Account (optional)');
  if (mode === 'off') {
    out.offText = await page.evaluate(() => document.querySelector('.screen .sheet').textContent.slice(0, 200));
    await shot('account-off');
  } else {
    out.username = user;
    out.cloudEnabled = await page.evaluate(() => window.__fw.app.cloud.enabled);
    let src = await waitPicture();
    await shot('signup');
    out.signupScreen = await page.evaluate(() => ({ fields: [...document.querySelectorAll('.screen input')].map((i) => `${i.id}:${i.type}`), alt: document.querySelector('img.robotpic').alt, lines: [...document.querySelectorAll('.screen p')].map((p) => p.textContent).filter((t) => /digits|email/.test(t)), emailAnywhere: /@|email address/i.test(document.querySelector('.screen').textContent.replace('There is no email on this account, so a forgotten password cannot be reset.', '')) }));
    // 1. A wrong code: the friendly message and a new picture.
    phase('deliberate wrong code');
    await type('a-user', user.toUpperCase());
    await type('a-pass', pass);
    await type('a-code', '00000');
    await page.waitForTimeout(2300);
    await tapText('Create account');
    await page.waitForFunction(() => /code was wrong|taken|went wrong|reach|problem|Too many/.test([...document.querySelectorAll('.screen [role="status"]')].map((e) => e.textContent).join(' ')), null, { timeout: 30000 });
    out.wrongCode = { status: await statusText() };
    const newSrc = await waitPicture(src);
    out.wrongCode.newPicture = newSrc !== src;
    await shot('wrong-code');
    src = newSrc;
    // 2. Sign up with the digits read from the picture (up to 5 pictures).
    phase('sign-up (a misread picture is refused by the server)');
    for (let attempt = 1; attempt <= 5; attempt++) {
      const digits = await readDigits();
      if (!/^\d{5}$/.test(digits)) { out[`picture${attempt}`] = 'asked for a new one'; await page.waitForTimeout(3100); await tapText('New picture'); src = await waitPicture(src); continue; }
      const shownAt = Date.now();
      await type('a-code', digits);
      // At least 2 seconds after the picture (the screen also waits it out).
      const wait = 2100 - (Date.now() - shownAt);
      if (wait > 0) await page.waitForTimeout(wait);
      await tapText('Create account');
      await page.waitForFunction(() => (document.querySelector('.screen h2') || {}).textContent === 'Your account' || /code was wrong|taken|went wrong|reach|problem|Too many|not available/.test([...document.querySelectorAll('.screen [role="status"]')].map((e) => e.textContent).join(' ')), null, { timeout: 40000 });
      if ((await heading()) === 'Your account') { out.signUp = { attempt, digits }; break; }
      out[`picture${attempt}`] = await statusText();
      if (!/code was wrong/.test(out[`picture${attempt}`])) throw new Error(`sign-up failed: ${out[`picture${attempt}`]}`);
      src = await waitPicture(src);
    }
    if (!out.signUp) throw new Error('no sign-up after 5 pictures');
    phase('signed in: save, score, board, sign out');
    out.signedIn = await page.evaluate(() => ({ user: window.__fw.app.cloud.client.user, account: window.__fw.app.save().account }));
    await shot('signed-in');
    // 3. A change saved to the cloud.
    const marker = Math.floor(Math.random() * 1e6);
    out.marker = marker;
    await page.evaluate((m) => window.__fw.app.updateSave((s) => ({ ...s, counters: { ...(s.counters || {}), qaMarker: m }, updatedAt: Date.now() })), marker);
    await tapText('Sync now');
    await page.waitForFunction(() => /Synced\.|could not|problem|offline/i.test([...document.querySelectorAll('.screen [role="status"]')].map((e) => e.textContent).join(' ')), null, { timeout: 30000 });
    out.synced = await statusText();
    // 4. A leaderboard score as the game posts it, then the board.
    const posted = await page.evaluate(async () => { const r = await window.__fw.app.postScore('longdrive', 287); return r.error ? { error: r.error, detail: r.detail || null } : 'ok'; });
    out.posted = posted;
    await tapText('Back');
    await tapText('Leaderboards');
    await tapText('Weekly long drive');
    await page.waitForTimeout(1500);
    out.board = await page.evaluate(() => [...document.querySelectorAll('.screen .list .item')].map((e) => e.textContent));
    out.boardHasMe = await page.evaluate(() => !!document.querySelector('.screen .list .item.me'));
    await shot('leaderboard');
    await tapText('Back');
    await tapAccount();
    // 5. Sign out, wipe this device's progress, sign in, and the cloud save comes back.
    await tapText('Sign out');
    out.afterSignOut = await page.evaluate(() => ({ user: !!window.__fw.app.cloud.client.user, account: window.__fw.app.save().account }));
    await page.evaluate(() => window.__fw.app.updateSave((s) => ({ ...s, counters: {}, updatedAt: 1 })));
    out.markerAfterWipe = await page.evaluate(() => (window.__fw.app.save().counters || {}).qaMarker ?? null);
    await tapText('I have an account');
    phase('deliberate wrong password');
    await type('a-user', user);
    await type('a-pass', 'wrong-password-1');
    await tapText('Sign in');
    await page.waitForFunction(() => /do not match|went wrong|reach/.test([...document.querySelectorAll('.screen [role="status"]')].map((e) => e.textContent).join(' ')), null, { timeout: 30000 });
    out.wrongPassword = await statusText();
    phase('sign in, restore, delete');
    await type('a-pass', pass);
    await tapText('Sign in');
    await waitHeading('Your account');
    out.signedBackIn = await page.evaluate(() => ({ account: window.__fw.app.save().account, marker: (window.__fw.app.save().counters || {}).qaMarker ?? null }));
    out.restored = out.signedBackIn.marker === marker;
    await shot('signed-back-in');
    // 6. Delete my data, then the account is gone: signing in fails.
    await tapText('Delete my data');
    await shot('delete');
    await tapText('Delete everything');
    await page.waitForTimeout(2500);
    out.afterDelete = await page.evaluate(() => ({ user: !!window.__fw.app.cloud.client.user, account: window.__fw.app.save().account, queue: localStorage.getItem('fairway-next.syncqueue'), session: localStorage.getItem('fairway-next.session') }));
    await toProfile();
    await tapAccount();
    await tapText('I have an account');
    phase('deliberate sign-in to the deleted account');
    await type('a-user', user);
    await type('a-pass', pass);
    await tapText('Sign in');
    await page.waitForFunction(() => /do not match|went wrong|reach/.test([...document.querySelectorAll('.screen [role="status"]')].map((e) => e.textContent).join(' ')), null, { timeout: 30000 });
    out.signInAfterDelete = await statusText();
    out.accountGone = /do not match/.test(out.signInAfterDelete) && !(await page.evaluate(() => !!window.__fw.app.cloud.client.user));
    await shot('after-delete');
  }
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); out.statusAtFail = await statusText().catch(() => ''); }
phase('end');
out.consoleErrorsByPhase = phases.filter((p) => p.errors.length || !/deliberate/.test(p.phase));
out.unexpectedConsoleErrors = phases.filter((p) => !/deliberate|misread/.test(p.phase)).flatMap((p) => p.errors);
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${base}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
