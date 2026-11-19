// The level creator and the community holes through real taps, drags and a two-finger pinch,
// on the production build at a phone size.
//   node scripts/tools/levels.mjs qa/proof/levels/run [390x844] [demo|live] [parts]
//   demo  the build's in-memory stand-in (?cloud=demo); live the real project (the build's
//         .env.production, or URL=https://... for a deployed copy). Live sign-up shows a picture
//         that a person (or the agent running this) reads: the tool saves it and waits for the
//         digits in <prefix>-...-answer-<n>.txt, as scripts/tools/account.mjs does.
//   parts (comma list, default all but shots): shots, count, browse, editor, offline, delete
// shots    on the range: a draw, a fade and a stinger with real swing drags, carry for each
// count    the tap count from the Create tile to a published hole, from a template, signed in
// browse   find it under New, like it, Top and Mine, the share link, play it from the card,
//          then delete it from Mine
// editor   drag the tee, the pin and a bend; every palette button; drag and pinch a bunker;
//          the bin, undo and redo; the pin dragged into water and the plain message; a bad name
// offline  publish with the connection off (queued), then it goes out when it is back
// delete   Delete my data removes the account and the holes
import path from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { launchBrowser, trackErrors } from '../lib/browser.mjs';
import { serveStatic } from '../lib/serve.mjs';
import { createPointer, waitPhase, swing, aimTo } from '../lib/drive.mjs';
import sharp from 'sharp';

const [prefix = 'qa/tmp/levels/run', size = '390x844', mode = 'demo', partsArg = 'count,browse,editor,offline,delete'] = process.argv.slice(2);
const parts = new Set(partsArg.split(','));
const [W, H] = size.split('x').map(Number);
mkdirSync(path.dirname(prefix), { recursive: true });
const server = process.env.URL ? { url: process.env.URL.replace(/\/$/, ''), close: async () => {} } : await serveStatic(path.resolve(process.env.DIST || 'dist'));
const { browser } = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < H });
ctx.setDefaultTimeout(240000);
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch: true });
const cdp = await ctx.newCDPSession(page);
const base = `${prefix}-${mode}-${size}`;
const out = { mode, size, url: server.url, parts: [...parts] };
const shot = (n) => page.screenshot({ path: `${base}-${n}.png` });
let taps = 0, counting = false;
const tally = { menu: 0, swings: 0, aim: 0, skips: 0, firstRunOnly: 0 };

async function find(text, { starts = false, within = '#ui' } = {}) {
  return page.evaluate(([t, s, w]) => {
    const b = [...document.querySelectorAll(`${w} button`)].find((e) => (s ? e.textContent.trim().startsWith(t) : e.textContent.trim() === t) && e.offsetParent !== null);
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const q = b.getBoundingClientRect();
    return { x: q.x + q.width / 2, y: q.y + q.height / 2, disabled: b.disabled };
  }, [text, starts, within]);
}
async function tap(text, opts = {}) {
  const r = await find(text, opts);
  if (!r) throw new Error(`no button "${text}"`);
  if (r.disabled) throw new Error(`button "${text}" is disabled`);
  await pointer.tap(r.x, r.y);
  if (counting) { taps++; tally[opts.kind || 'menu']++; }
  await page.waitForTimeout(opts.wait ?? 350);
}
const status = () => page.evaluate(() => [...document.querySelectorAll('.screen [role="status"]')].map((e) => e.textContent).filter(Boolean).join(' | '));
const heading = () => page.evaluate(() => (document.querySelector('.screen h2') || {}).textContent || '');
const level = () => page.evaluate(() => window.__fw.app.levelEditor.level());
const at = (x, z) => page.evaluate(([a, b]) => window.__fw.app.levelEditor.toScreen(a, b), [x, z]);
async function drag(from, to, ms = 420) {
  const steps = 12, pts = [];
  for (let i = 0; i <= steps; i++) pts.push({ x: from.x + (to.x - from.x) * (i / steps), y: from.y + (to.y - from.y) * (i / steps), t: (ms * i) / steps });
  await pointer.path(pts);
  await page.waitForTimeout(350);
}
// Two fingers on the canvas moving apart (or together) around a point.
async function pinch(c, d0, d1, ms = 500) {
  const steps = 10, t0 = Date.now();
  const tp = (d) => [{ x: c.x - d / 2, y: c.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }, { x: c.x + d / 2, y: c.y, id: 2, radiusX: 6, radiusY: 6, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(d0).slice(0, 1), timestamp: t0 / 1000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(d0), timestamp: (t0 + 20) / 1000 });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(d0 + (d1 - d0) * (i / steps)), timestamp: (t0 + 20 + (ms * i) / steps) / 1000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (t0 + ms + 60) / 1000 });
  await page.waitForTimeout(400);
}

// ---------- sign-up through the account screen (not counted) ----------
const picSrc = () => page.evaluate(() => (document.querySelector('img.robotpic') || {}).src || '');
const waitPicture = async (old = '') => { await page.waitForFunction((o) => { const i = document.querySelector('img.robotpic'); return i && i.src.startsWith('data:image/svg+xml') && i.src !== o && i.complete; }, old, { timeout: 30000 }); await page.waitForTimeout(300); return picSrc(); };
let picN = 0;
async function readDigits() {
  picN++;
  const el = page.locator('img.robotpic');
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: `${base}-pic-${picN}.png` });
  if (mode === 'demo') {
    const svg = decodeURIComponent((await picSrc()).split(',').slice(1).join(','));
    return [...svg.matchAll(/<text[^>]*>(\d)<\/text>/g)].map((m) => m[1]).join('');
  }
  // Live: the same picture, drawn larger from its own src so a person can read it.
  const svg = decodeURIComponent((await picSrc()).split(',').slice(1).join(','));
  await sharp(Buffer.from(svg)).resize({ width: 600 }).png().toFile(`${base}-pic-${picN}-large.png`);
  const f = `${base}-answer-${picN}.txt`;
  console.log(`PICTURE ${base}-pic-${picN}-large.png -> write the digits to ${f}`);
  const t0 = Date.now();
  while (!existsSync(f)) { if (Date.now() - t0 > 540000) throw new Error('no answer within 9 minutes'); await page.waitForTimeout(1000); }
  return readFileSync(f, 'utf8').trim();
}
async function typeInto(id, text) {
  const r = await page.evaluate((i) => { const e = document.getElementById(i); e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, id);
  await pointer.tap(r.x, r.y);
  await page.evaluate((i) => { document.getElementById(i).value = ''; }, id);
  await page.keyboard.type(text, { delay: 5 });
}
const user = process.env.FW_USER || `fwlv${Math.floor(100000 + Math.random() * 900000)}`;
const pass = `Fw-${Math.random().toString(36).slice(2, 10)}-7`;
async function signUp() {
  await page.evaluate(() => window.__fw.app.ui.screens.menu());
  await tap('Profile', { starts: true });
  await tap('Account (optional)');
  let src = await waitPicture();
  await typeInto('a-user', user);
  await typeInto('a-pass', pass);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const digits = await readDigits();
    if (!/^\d{5}$/.test(digits)) { await page.waitForTimeout(3100); await tap('New picture'); src = await waitPicture(src); continue; }
    const shownAt = Date.now();
    await typeInto('a-code', digits);
    const wait = 2100 - (Date.now() - shownAt);
    if (wait > 0) await page.waitForTimeout(wait);
    await tap('Create account');
    await page.waitForFunction(() => (document.querySelector('.screen h2') || {}).textContent === 'Your account' || /code was wrong|taken|went wrong|reach|problem|Too many|not available/.test([...document.querySelectorAll('.screen [role="status"]')].map((e) => e.textContent).join(' ')), null, { timeout: 40000 });
    if ((await heading()) === 'Your account') return { attempt, user };
    const st = await status();
    if (!/code was wrong/.test(st)) throw new Error(`sign-up failed: ${st}`);
    src = await waitPicture(src);
  }
  throw new Error('no sign-up after 5 pictures');
}

// ---------- playing the hole through the real swing (counts swings and aim taps) ----------
const gv = () => page.evaluate(() => { const v = window.__fw.gameView(); const s = window.__fw.game.state; return { phase: s.phase, v: v && { strokes: v.strokes, dist: v.distToPin, club: v.club.id, ideal: v.suggestedPower, human: v.human, lie: v.lieName }, putt: s.putt && s.putt.heading !== undefined ? { heading: s.putt.heading, ideal: s.putt.idealPower } : null }; });
async function playOut(tag) {
  const log = [];
  for (let n = 0; n < 40; n++) {
    let ph;
    try { ph = await waitPhase(page, ['intro', 'aim', 'summary', 'done', 'menu'], 180000); } catch { log.push('stuck'); break; }
    if (await page.evaluate(() => ['levelend'].includes(window.__fw.app.ui.modal))) break;
    if (ph === 'intro') { const r = await page.evaluate(() => window.__fw.rect('.intro-skip')); if (r) { await pointer.tap(r.x + r.w / 2, r.y + r.h / 2); if (counting) { taps++; tally.skips++; } } await page.waitForTimeout(300); continue; }
    if (ph !== 'aim') { await page.waitForTimeout(400); continue; }
    // The first-run tip (only on a brand new save).
    const tip = await page.evaluate(() => { const b = document.querySelector('.tip:not(.hidden) .row button:last-child'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (tip) { await pointer.tap(tip.x, tip.y); if (counting) { taps++; tally.firstRunOnly++; } await page.waitForTimeout(300); continue; }
    const s0 = await gv();
    if (!s0.v || !s0.v.human) { await page.waitForTimeout(300); continue; }
    if (n === 0) await shot(`${tag}-tee`);
    let read = null;
    if (s0.putt) { read = await aimTo(page, pointer, s0.putt.heading); if (counting) { taps += read.taps + read.drags; tally.aim += read.taps + read.drags; } }
    const s1 = await gv();
    const power = s1.putt ? s1.putt.ideal : s1.v.ideal;
    await swing(page, pointer, { power, backMs: s1.putt ? 690 : 780, downMs: s1.putt ? 230 : 260 });
    if (counting) { taps++; tally.swings++; }
    try { await waitPhase(page, ['flight', 'settle', 'summary', 'done'], 20000); } catch { log.push('no launch'); continue; }
    await page.waitForFunction(() => ['aim', 'summary', 'done', 'menu'].includes(window.__fw.phase()) || window.__fw.app.ui.modal === 'levelend', null, { timeout: 240000 });
    const s2 = await gv();
    log.push(`${s1.v.club} ${s1.v.dist.toFixed(1)}m -> ${s2.v ? s2.v.dist.toFixed(1) : 'in'}`);
  }
  await page.waitForFunction(() => window.__fw.app.ui.modal === 'levelend', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  return { log, result: await heading() };
}

try {
  await page.goto(`${server.url}/?tier=low&scale=0.5&timescale=4${mode === 'demo' ? '&cloud=demo' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null);
  await page.waitForTimeout(800);
  out.signUp = await signUp();
  out.username = user;
  await page.evaluate(() => window.__fw.app.ui.screens.menu());
  await page.waitForTimeout(300);
  await shot('menu');

  // ---------- 0. a draw, a fade and a stinger on the range, signed in ----------
  if (parts.has('shots')) {
    const center = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e || e.offsetParent === null) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
    const tapSel = async (sel) => { const c = await center(sel); if (!c) throw new Error(`no ${sel}`); await pointer.tap(c.x, c.y); await page.waitForTimeout(450); };
    const tapIn = async (text, scope = '.shotpanel') => {
      const c = await page.evaluate(([t, sc]) => { const b = [...document.querySelectorAll(`${sc} button`)].find((e) => e.textContent.trim().startsWith(t) && e.offsetParent !== null); if (!b) return null; b.scrollIntoView({ block: 'nearest', inline: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, [text, scope]);
      if (!c) throw new Error(`no button ${text}`);
      await pointer.tap(c.x, c.y); await page.waitForTimeout(500);
    };
    const dismissTip = async () => { const t = await center('.tip:not(.hidden) .row button:last-child'); if (t) { await pointer.tap(t.x, t.y); await page.waitForTimeout(300); } };
    const readPanel = () => page.evaluate(() => { const g = window.__fw.game, st = g.state; return { shot: st.shotType.id, club: st.club.id, readout: document.querySelector('.padread') ? document.querySelector('.padread').textContent : '' }; });
    await page.evaluate(() => { window.__fw.app.ui.screens.hide(); return window.__fw.game.startRange({ bay: 2, surface: 'grass', tod: 'morning', players: [{ kind: 'human', name: 'You', ball: '#ffffff' }] }); });
    await waitPhase(page, 'aim');
    await page.evaluate(() => { window.__fw.game.setRangeTarget(null, 200); window.__fw.game.setClub('I5'); });
    await page.waitForTimeout(800);
    out.shots = [];
    for (const kind of ['draw', 'fade', 'stinger']) {
      await waitPhase(page, 'aim');
      await page.waitForTimeout(400);
      await dismissTip();
      await tapSel('.spinbtn');
      if (kind === 'stinger') { await tapIn('Straight'); await tapIn('Stinger', '.shottypes'); } else { await tapIn('Normal', '.shottypes').catch(() => {}); await tapIn(kind === 'draw' ? 'Draw' : 'Fade'); }
      const planned = await readPanel();
      await shot(`shot-${kind}-panel`);
      await tapIn('Done');
      const power = await page.evaluate(() => window.__fw.game.suggestedPower());
      await swing(page, pointer, { power: Math.min(1, power), backMs: 780, downMs: 260 });
      await page.waitForFunction(() => window.__fw.game.state.shot || window.__fw.game.state.lastShot, null, { timeout: 20000 });
      const res = await page.evaluate(() => { const g = window.__fw.game, s = g.state.shot || g.state.lastShot; const a = s.aim, fx = Math.sin(a), fz = -Math.cos(a), p = s.result.carryPoint || s.result.end; return { club: s.club.id, shot: s.shotType.id, strike: s.strike.kind, carryYd: +(s.result.carry / 0.9144).toFixed(1), totalYd: +(s.result.total / 0.9144).toFixed(1), rightOfAimYd: +(((p.x - s.from.x) * -fz + (p.z - s.from.z) * fx) / 0.9144).toFixed(1), apexYd: +(s.result.apex / 0.9144).toFixed(1), power: +s.swing.power.toFixed(3) }; });
      out.shots.push({ kind, planned, ...res });
      console.log('shot', kind, JSON.stringify(res));
      await page.waitForTimeout(900);
      await shot(`shot-${kind}-flight`);
      await page.waitForFunction(() => window.__fw.game.state.phase === 'aim', null, { timeout: 60000 }).catch(() => {});
    }
    await page.evaluate(() => window.__fw.game.quit());
    await page.waitForTimeout(600);
  }

  // ---------- 1. the tap count ----------
  let pubId = null, pubName = null;
  if (parts.has('count')) {
    counting = true; taps = 0;
    await tap('Create', { starts: true });
    await shot('create');
    await tap('Short par 3 over water');
    await shot('editor-template');
    out.template = { level: await level(), status: await status() };
    pubName = out.template.level.name;
    await tap('Test play', { wait: 600 });
    const play = await playOut('count');
    out.testPlay = play;
    await shot('test-end');
    await tap('Back to the editor');
    out.afterTest = await status();
    await shot('editor-tested');
    await tap('Publish');
    await page.waitForFunction(() => /Published|could not|wrong|Sign in|limit/i.test([...document.querySelectorAll('.screen [role="status"]')].map((e) => e.textContent).join(' ')), null, { timeout: 30000 });
    counting = false;
    out.published = await status();
    pubId = (await page.evaluate(() => window.__fw.app.levelEditor.draft())).publishedId;
    out.publishedId = pubId;
    out.tapCount = { total: taps, ...tally, withoutGolf: tally.menu + tally.skips + tally.firstRunOnly, menuOnly: tally.menu };
    await shot('published');
  }

  // ---------- 2. browse, like, share, play, delete ----------
  if (parts.has('browse') && pubId) {
    await tap('Back');
    await tap('Browse holes');
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('.lvlist').textContent), null, { timeout: 30000 });
    const cards = () => page.evaluate(() => [...document.querySelectorAll('.lvcard')].map((c) => c.querySelector('.lvmeta').innerText.split('\n').filter(Boolean).slice(0, 3).join(' / ')));
    out.newTab = await cards();
    const idx = out.newTab.findIndex((t) => t.startsWith(pubName) && t.includes(`by ${user}`));
    out.foundInNew = idx >= 0;
    await shot('browse-new');
    const tapInCard = async (i, label) => {
      const r = await page.evaluate(([k, l]) => { const c = document.querySelectorAll('.lvcard')[k]; const b = [...c.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(l)); b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, [i, label]);
      await pointer.tap(r.x, r.y); await page.waitForTimeout(900);
    };
    if (idx >= 0) {
      await tapInCard(idx, 'Like');
      out.afterLike = (await cards())[idx];
      out.likeButton = await page.evaluate((k) => [...document.querySelectorAll('.lvcard')[k].querySelectorAll('button')].map((b) => b.textContent).join(', '), idx);
      await shot('browse-liked');
      await tapInCard(idx, 'Share');
      out.shareStatus = await status();
    }
    await tap('Top');
    await page.waitForTimeout(800);
    out.topTab = await cards();
    await tap('Mine');
    await page.waitForTimeout(800);
    out.mineTab = await cards();
    await shot('browse-mine');
    // The share link opens a preview.
    await page.evaluate(() => window.__fw.app.ui.screens.menu());
    await page.evaluate((id) => { location.hash = `#level=${id}`; }, pubId);
    await page.waitForFunction(() => window.__fw.app.ui.modal === 'levelpreview', null, { timeout: 20000 });
    out.sharePreview = await page.evaluate(() => document.querySelector('.screen .sheet').innerText.split('\n').filter(Boolean));
    await shot('share-preview');
    // Play it from the preview: counts a play and posts the best score.
    await tap('Play', { wait: 600 });
    out.publishedPlay = await playOut('published');
    out.publishedEnd = await page.evaluate(() => document.querySelector('.screen .sheet').innerText.split('\n').filter(Boolean));
    await shot('published-end');
    await tap('Back to the holes');
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('.lvlist').textContent), null, { timeout: 30000 });
    out.afterPlay = (await cards()).find((t) => t.startsWith(pubName)) || null;
    await tap('Mine');
    await page.waitForTimeout(800);
    const mine = await cards();
    const k = mine.findIndex((t) => t.startsWith(pubName));
    if (k >= 0) { await tapInCard(k, 'Delete'); out.deleteStatus = await status(); }
    await page.waitForTimeout(800);
    out.mineAfterDelete = await cards();
    await tap('New');
    await page.waitForTimeout(800);
    out.newAfterDelete = (await cards()).filter((t) => t.includes(`by ${user}`));
    await shot('browse-after-delete');
    await page.evaluate(() => { history.replaceState(null, '', location.pathname + location.search); });
  }

  // ---------- 3. the editor ----------
  if (parts.has('editor')) {
    await page.evaluate(() => window.__fw.app.ui.screens.menu());
    await tap('Create', { starts: true });
    await tap('Dogleg par 4');
    await page.waitForFunction(() => !!window.__fw.app.levelEditor.toScreen(0, 0), null, { timeout: 20000 });
    const e = { start: await level() };
    // Drag the tee, the pin and the bend handle.
    let lv = e.start;
    await drag(await at(...lv.tee), { ...(await at(...lv.tee)), x: (await at(...lv.tee)).x + 30 });
    e.teeMoved = { from: lv.tee, to: (await level()).tee };
    lv = await level();
    const pinPx = await at(...lv.pin);
    await drag(pinPx, { x: pinPx.x - 40, y: pinPx.y + 30 });
    e.pinMoved = { from: lv.pin, to: (await level()).pin, par: await page.evaluate(() => document.querySelector('.lvpar').textContent) };
    lv = await level();
    const bendPx = await at(...lv.bend[0]);
    await drag(bendPx, { x: bendPx.x + 45, y: bendPx.y });
    e.bendMoved = { from: lv.bend[0], to: (await level()).bend[0] };
    await shot('editor-dragged');
    // Every palette button.
    const counts = (l) => ({ bunkers: l.bunkers.length, water: l.water.length, trees: l.trees.length, rough: l.rough.length, hills: l.hills.length, green: l.green, bends: l.bend.length });
    e.palette = {};
    for (const b of ['Bunker', 'Water', 'Trees', 'Rough', 'Hills', 'Green size', 'Add bend']) { const before = counts(await level()); await tap(b); e.palette[b] = { before, after: counts(await level()) }; }
    await shot('editor-palette');
    // Place a bunker, drag it, pinch it bigger.
    await tap('Bunker');
    lv = await level();
    const bi = lv.bunkers.length - 1, b0 = lv.bunkers[bi];
    const bp = await at(b0[0], b0[1]);
    await drag(bp, { x: bp.x + 26, y: bp.y - 18 });
    const b1 = (await level()).bunkers[bi];
    const bp2 = await at(b1[0], b1[1]);
    await pinch(bp2, 30, 110);
    const b2 = (await level()).bunkers[bi];
    e.bunker = { placed: b0, dragged: b1, pinched: b2, grew: b2[2] > b1[2] };
    await shot('editor-pinched');
    // The bin deletes the selected piece; undo brings it back, redo removes it again.
    const n0 = (await level()).bunkers.length;
    await tap('Delete');
    const n1 = (await level()).bunkers.length;
    await tap('Undo');
    const n2 = (await level()).bunkers.length;
    await tap('Redo');
    const n3 = (await level()).bunkers.length;
    e.binUndoRedo = { before: n0, afterDelete: n1, afterUndo: n2, afterRedo: n3 };
    // Decorate adds trees and rough.
    const d0 = counts(await level());
    await tap('Decorate');
    e.decorate = { before: d0, after: counts(await level()) };
    await shot('editor-decorated');
    // The pin dragged onto the water: a plain message, and Test play is off. Undo fixes it.
    lv = await level();
    const w = lv.water[0];
    const pp = await at(...lv.pin), wp = await at(w[0], w[1]);
    await drag(pp, wp, 520);
    e.pinInWater = { status: await status(), testDisabled: (await find('Test play')).disabled, publishDisabled: (await find('Publish')).disabled };
    await shot('editor-pin-in-water');
    await tap('Undo');
    e.afterUndo = { status: await status(), testDisabled: (await find('Test play')).disabled };
    // A bad name.
    const nameBox = await page.evaluate(() => { const q = document.getElementById('lv-name').getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
    await pointer.tap(nameBox.x, nameBox.y);
    await page.evaluate(() => { document.getElementById('lv-name').value = ''; });
    await page.keyboard.type('www.spam.com', { delay: 5 });
    await page.evaluate(() => document.getElementById('lv-name').blur());
    await page.waitForTimeout(300);
    e.badName = { status: await status(), publishDisabled: (await find('Publish')).disabled };
    await tap('Undo');
    e.bytes = await page.evaluate(() => new TextEncoder().encode(JSON.stringify(window.__fw.app.levelEditor.level())).length);
    out.editor = e;
  }

  // ---------- 4. publish offline, then online ----------
  if (parts.has('offline')) {
    await page.evaluate(() => window.__fw.app.ui.screens.menu());
    await tap('Create', { starts: true });
    await tap('Short par 3 over water');
    const nameBox = await page.evaluate(() => { const q = document.getElementById('lv-name').getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
    await pointer.tap(nameBox.x, nameBox.y);
    await page.evaluate(() => { document.getElementById('lv-name').value = ''; });
    const offName = `Quiet Pond ${Math.floor(Math.random() * 90 + 10)}`;
    await page.keyboard.type(offName, { delay: 5 });
    await page.evaluate(() => document.getElementById('lv-name').blur());
    await page.waitForTimeout(300);
    await tap('Test play', { wait: 600 });
    out.offlineTest = await playOut('offline');
    await tap('Back to the editor');
    await ctx.setOffline(true);
    await tap('Publish');
    await page.waitForTimeout(800);
    out.offline = { status: await status(), draft: await page.evaluate(() => window.__fw.app.levelEditor.draft()) };
    await shot('offline-queued');
    await ctx.setOffline(false);
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('fairway-next.levelDrafts')).some((d) => d.publishedId && !d.pendingPublish && /Quiet Pond/.test(d.level.name)); } catch { return false; } }, null, { timeout: 30000 }).catch(() => {});
    out.offline.afterOnline = await page.evaluate(() => JSON.parse(localStorage.getItem('fairway-next.levelDrafts')).filter((d) => /Quiet Pond/.test(d.level.name)).map((d) => ({ name: d.level.name, publishedId: d.publishedId || null, pending: !!d.pendingPublish })));
    await page.evaluate(() => window.__fw.app.ui.screens.menu());
    await tap('Create', { starts: true });
    await tap('Browse holes');
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('.lvlist').textContent), null, { timeout: 30000 });
    out.offline.inNew = (await page.evaluate(() => [...document.querySelectorAll('.lvcard b')].map((b) => b.textContent))).filter((t) => t === offName);
  }

  // ---------- 5. Delete my data ----------
  if (parts.has('delete')) {
    await page.evaluate(() => window.__fw.app.ui.screens.menu());
    await tap('Profile', { starts: true });
    await tap('Account');
    await tap('Delete my data');
    await tap('Delete everything');
    await page.waitForTimeout(2500);
    out.afterDelete = await page.evaluate(() => ({ user: !!window.__fw.app.cloud.client.user, account: window.__fw.app.save().account }));
    // The holes by this player are gone from New.
    await page.evaluate(() => window.__fw.app.ui.screens.menu());
    await tap('Create', { starts: true });
    await tap('Browse holes');
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('.lvlist').textContent), null, { timeout: 30000 });
    out.afterDelete.myHolesInNew = (await page.evaluate(() => [...document.querySelectorAll('.lvcard')].map((c) => c.innerText))).filter((t) => t.includes(`by ${user}`)).length;
    await shot('after-delete');
  }
} catch (e) { out.failed = e.message.split('\n')[0]; await shot('failed').catch(() => {}); out.statusAtFail = await status().catch(() => ''); out.modalAtFail = await page.evaluate(() => window.__fw.app.ui.modal).catch(() => ''); }
out.consoleErrors = errors.map((e) => e.text.slice(0, 200));
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${base}.json`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
