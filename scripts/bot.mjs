// QA bot: plays complete rounds on the production build through real input events.
//   node scripts/bot.mjs --course parkland --holes 18 --view portrait [--tier low] [--scale 0.6]
//        [--timescale 4] [--mode stroke] [--rival] [--out qa/bot]
// Portrait runs use touch, landscape runs use the mouse. Every shot is taken on the swing
// stick with a planned pull and push (power from the HUD's green mark, a human-like spread of
// tempo); putts are read by dragging the aim, as a player would. The bot never calls a game
// method to act: it only reads state through window.__fw and moves a pointer.
// Output: <out>/<course>-<view>.json with every shot and hole, plus screenshots.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, trackErrors } from './lib/browser.mjs';
import { serveStatic } from './lib/serve.mjs';
import { waitPhase, createPointer, swing, aimTo, clickSel } from './lib/drive.mjs';
import { createRng } from '../src/core/rng.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const course = args.course || 'parkland';
const holes = Number(args.holes || 18);
const view = args.view || 'landscape';
const tier = args.tier || 'low';
const scale = Number(args.scale || 0.6);
const timescale = Number(args.timescale || 4);
const mode = args.mode || 'stroke';
const outDir = args.out || 'qa/bot';
const startHole = Number(args.start || 1);
const shotEvery = Number(args.shots || 1); // screenshot the first aim of every Nth hole
const maxMinutes = Number(args.minutes || 90);
const flow = args.flow || 'url'; // url | career | daily | passplay | resume
const touch = view === 'portrait';
const vp = view === 'portrait' ? { width: 390, height: 844 } : { width: 844, height: 390 };
mkdirSync(path.join(outDir, 'shots'), { recursive: true });

// --url plays against a deployed site instead of the local build.
const dist = path.resolve('dist');
if (!args.url && !existsSync(path.join(dist, 'index.html'))) { console.error('build first: npx vite build'); process.exit(2); }
const server = args.url ? { url: String(args.url).replace(/\/$/, ''), close: async () => {} } : await serveStatic(dist);
const { browser, software } = await launchBrowser();
const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
const page = await ctx.newPage();
const errors = trackErrors(page);
const pointer = await createPointer(page, { touch });
const rng = createRng(hashCode(`${course}:${view}`));
function hashCode(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
const tag = flow === 'url' ? `${course}-${view}` : `${flow}-${view}`;
const report = { course, view, holes, tier, scale, timescale, mode, software, input: touch ? 'touch' : 'mouse', started: new Date().toISOString(), shots: [], holesPlayed: [], result: null, errors: [], stuck: [], timing: {} };
const T0 = Date.now();
const snap = (name) => page.screenshot({ path: path.join(outDir, 'shots', `${tag}-${name}.jpg`), type: 'jpeg', quality: 70 });
const st = () => page.evaluate(() => { const v = window.__fw.gameView(); const s = window.__fw.game.state; return { phase: s.phase, v: v && { hole: v.hole, holeOf: v.holeOf, strokes: v.strokes, dist: v.distToPin, club: v.club.id, shot: v.shotType.id, lie: v.lieName, ideal: v.suggestedPower, hazard: v.hazard, human: v.human, player: v.player && v.player.name }, putt: s.putt && s.putt.heading !== undefined ? { heading: s.putt.heading, breakM: s.putt.breakM, ideal: s.putt.idealPower } : null }; });

// Tap a visible button by its text, like a person would.
async function tapText(text) {
  const r = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim() === t && x.offsetParent !== null);
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const q = b.getBoundingClientRect();
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
  }, text);
  if (!r) throw new Error(`no button "${text}"`);
  await pointer.tap(r.x, r.y);
  await page.waitForTimeout(300);
}
async function tapStarts(text) {
  const r = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim().startsWith(t) && x.offsetParent !== null && !x.disabled);
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const q = b.getBoundingClientRect();
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
  }, text);
  if (!r) throw new Error(`no button starting "${text}"`);
  await pointer.tap(r.x, r.y);
  await page.waitForTimeout(300);
}
async function boot(query) {
  await page.goto(`${server.url}/?tier=${tier}&scale=${scale}&timescale=${timescale}&bot=1${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__fw && window.__fw.ready, null, { timeout: 240000 });
}
const saveSummary = () => page.evaluate(() => { const s = window.__fw.app.save(); return { player: s.player.name, rounds: s.stats.rounds, history: s.history.slice(-3), daily: s.daily, achievements: Object.keys(s.achievements), inProgress: !!s.inProgress, career: s.career && { level: s.career.level, xp: s.career.xp, points: s.career.points, tier: s.career.season.tier, results: s.career.season.events.filter((e) => e.result).map((e) => ({ name: e.name, ...e.result })), titles: s.career.titles } }; });
let resumeAfterHoles = 0;

try {
  if (flow === 'url') await boot(`&mode=${mode}&course=${course}&holes=${holes}&hole=${startHole}&seed=${hashCode(tag)}`);
  else {
    await boot('');
    await page.evaluate(() => localStorage.clear());
    await boot('');
    if (flow === 'career') { await tapText('Career'); await tapText('Begin'); report.before = await saveSummary(); await tapText('Play event'); }
    else if (flow === 'campaign') {
      // Campaign: choose an archetype, open the next event's briefing, tee off.
      await tapStarts('Campaign');
      await snap('campaign-pick');
      await tapStarts(args.archetype || 'Power Hitter');
      await snap('campaign-hub');
      await tapStarts('Next: ');
      await snap('campaign-briefing');
      report.before = await page.evaluate(() => { const s = window.__fw.app.save(); return { profile: s.profile, campaign: s.campaign && { progress: s.campaign.progress } }; });
      await tapStarts('Tee off');
    } else if (flow === 'quick3') {
      // A 3-hole quick round against the adaptive rival, from the setup screen.
      await snap('menu');
      await tapStarts('Daily');
      await snap('daily-thisweek');
      await tapText('Back');
      await tapStarts('Quick Play');
      await tapText('3 holes');
      await page.evaluate(() => { const c = document.getElementById('rival'); if (c && !c.checked) c.click(); });
      report.rivalLabel = await page.evaluate(() => document.querySelector('label[for="rival"]').textContent);
      await snap('setup-3holes');
      await tapText('Tee off');
    } else if (flow === 'tournament') {
      // The tournament is on the main menu (stage 7) or under Quick Play (stage 8 menu).
      if (!(await page.evaluate(() => [...document.querySelectorAll('#ui button')].some((b) => b.textContent.trim() === 'Tournament' && b.offsetParent !== null)))) await tapStarts('Quick Play');
      await tapText('Tournament');
      await snap('tournament-lobby');
      await tapText('Alderwick Park');
      await snap('tournament-standings');
      await tapText('Play round 1');
    } else if (flow === 'campaign-match') {
      // Match play against a boss, which plays its shots on screen. The first four chapters are
      // marked cleared here (as if played) so the Rivalry chapter is open.
      await tapStarts('Campaign');
      await tapStarts(args.archetype || 'All-Rounder');
      await page.evaluate(() => window.__fw.app.updateSave((s) => {
        const progress = { ...s.campaign.progress };
        for (const id of window.__fw.campaignEventIds().filter((e) => /^(club|regional|tour|majors)-/.test(e))) progress[id] = { stars: 1, cleared: true, plays: 1, best: 0, met: [] };
        return { ...s, campaign: { ...s.campaign, progress } };
      }));
      await tapText('Back'); await tapStarts('Campaign');
      await tapStarts('Next: ');
      await snap('match-briefing');
      await tapStarts('Tee off');
    }
    else if (flow === 'daily') { await tapStarts('Daily'); report.daily = await page.evaluate(() => window.__fw.app.dailySetup()); await tapText('Play'); }
    else if (flow === 'passplay') { await tapText('Pass and play'); await page.selectOption('#pp-holes', '3'); await page.selectOption('#pp-mode', 'skins'); await tapText('Tee off'); }
    else if (flow === 'resume') { await tapStarts('Quick Play'); await tapText('Tee off'); resumeAfterHoles = 1; }
  }
  report.timing.bootSec = (Date.now() - T0) / 1000;
  let holeIdx = -1, firstAimOfHole = true, lastProgress = Date.now();
  for (;;) {
    if ((Date.now() - T0) / 60000 > maxMinutes) { report.stuck.push({ reason: 'time limit', at: (Date.now() - T0) / 1000 }); break; }
    let ph;
    try { ph = await waitPhase(page, ['intro', 'aim', 'summary', 'done'], 240000); } catch { report.stuck.push({ reason: 'no playable phase for 240 s', state: await st() }); break; }
    if (ph === 'intro') {
      // The hole intro card shows over the flyover; capture it on the first two holes.
      if (args.broadcast && report.holesPlayed.length < 2) { await page.waitForTimeout(1200); await snap(`intro-${report.holesPlayed.length + 1}`); report.introCards = (report.introCards || []).concat(await page.evaluate(() => { const c = document.querySelector('.introcard'); return c && !c.classList.contains('hidden') ? c.innerText.replace(/\n/g, ' / ') : null; })); }
      await clickSel(page, pointer, '.intro-skip'); await page.waitForTimeout(200); continue;
    }
    if (ph === 'summary') {
      await page.waitForTimeout(300);
      const s = await page.evaluate(() => window.__fw.game.state.holeSummary);
      report.holesPlayed.push({ hole: s.holeIdx + 1, par: s.par, strokes: s.strokes });
      process.stdout.write(`hole ${s.holeIdx + 1} par ${s.par}: ${s.strokes.join('/')}  (${((Date.now() - T0) / 60000).toFixed(1)} min)\n`);
      if (report.holesPlayed.length === 1 || report.holesPlayed.length % 6 === 0) await snap(`summary-${s.holeIdx + 1}`);
      if (resumeAfterHoles && report.holesPlayed.length === resumeAfterHoles) {
        // Leave mid-round by reloading the page, then resume from the menu.
        report.resume = { savedBefore: await saveSummary() };
        await boot('');
        report.resume.menu = await page.$$eval('.screen button', (b) => b.map((x) => x.textContent));
        await snap('resume-menu');
        await tapText('Resume round');
        resumeAfterHoles = 0;
        firstAimOfHole = true;
        continue;
      }
      // The real button: "Next hole" or "See results".
      const ok = await clickSel(page, pointer, '.screen .btn.primary');
      if (!ok) report.stuck.push({ reason: 'no continue button' });
      firstAimOfHole = true;
      await page.waitForFunction(() => window.__fw.phase() !== 'summary', null, { timeout: 120000 }).catch(() => report.stuck.push({ reason: 'summary did not close' }));
      lastProgress = Date.now();
      continue;
    }
    if (ph === 'done') {
      await page.waitForTimeout(600);
      await snap('round-end');
      if (args.broadcast) {
        await page.evaluate(() => { const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim() === 'Round recap'); if (b) b.scrollIntoView({ block: 'center' }); });
        await snap('round-end-broadcast');
        report.roundEndText = await page.evaluate(() => document.querySelector('.screen:not(.hidden) .sheet').innerText.split('\n').filter(Boolean).slice(0, 40));
        await tapText('Round recap');
        await snap('recap');
        report.recap = await page.evaluate(() => document.querySelector('.screen:not(.hidden) .sheet').innerText.split('\n').filter(Boolean));
        await tapText('Back');
      }
      if (flow.startsWith('campaign')) {
        report.campaign = await page.evaluate(() => { const s = window.__fw.app.save(); const el = document.querySelector('.campaign-result'); return { profile: s.profile, progress: s.campaign && s.campaign.progress, tokens: s.wallet.tokens, result: el ? el.innerText.split('\n').filter(Boolean) : null }; });
        await page.evaluate(() => { const el = document.querySelector('.campaign-result table'); if (el) el.scrollIntoView({ block: 'center' }); });
        await snap('round-end-xp');
      }
      report.result = await page.evaluate(() => { const r = window.__fw.game.state.round; return { scores: r.scores, players: r.players.map((p) => p.name), complete: r.complete, holes: r.holes, mode: r.mode, standings: document.querySelector('.screen .big') && document.querySelector('.screen .big').textContent }; });
      if (flow === 'quick3') {
        report.fun = await page.evaluate(() => { const s = window.__fw.app.save(); return { counters: s.counters, quests: s.quests, season: s.season, achievements: Object.keys(s.achievements), xp: s.profile.xp }; });
        await page.waitForTimeout(400);
        await tapText('Main menu');
        await tapStarts('Profile');
        await snap('profile');
        await tapText('Quests');
        await snap('quests');
        const claim = await page.evaluate(() => [...document.querySelectorAll('.quest button')].filter((b) => !b.disabled).length);
        if (claim) { await tapText('Claim'); await snap('quests-claimed'); }
        await tapText('Back');
        await tapText('Achievements');
        await snap('achievements');
        await tapText('Back');
        await tapText('Locker');
        await snap('locker');
        report.funAfter = await page.evaluate(() => { const s = window.__fw.app.save(); return { quests: s.quests, tokens: s.wallet.tokens, xp: s.profile.xp }; });
      }
      report.after = await saveSummary();
      break;
    }
    // Aim phase.
    const s0 = await st();
    if (!s0.v.human) { await page.waitForTimeout(300); continue; }
    if (s0.v.hole !== holeIdx) { holeIdx = s0.v.hole; firstAimOfHole = true; }
    if (firstAimOfHole && (holeIdx - startHole) % shotEvery === 0) { await page.waitForTimeout(500); await snap(`hole${holeIdx}-aim`); }
    firstAimOfHole = false;
    let read = null;
    if (s0.putt) read = await aimTo(page, pointer, s0.putt.heading);
    const s1 = await st();
    const ideal = s1.putt ? s1.putt.ideal : s1.v.ideal;
    // A human-like spread: power within about 3 percent, tempo between 2.5 and 3.6.
    const power = Math.min(1, Math.max(0.07, ideal * (1 + rng.gauss() * 0.03)));
    const down = s1.putt ? 230 : 250, back = down * (3 + rng.gauss() * 0.3);
    const t = Date.now();
    await swing(page, pointer, { power, backMs: back, downMs: down, drift: rng.gauss() * 0.01 });
    const sw = await page.evaluate(() => window.__fw.ui.hud.stick.lastResult);
    let p2;
    try { p2 = await waitPhase(page, ['flight', 'settle', 'summary', 'done'], 20000); } catch { p2 = 'aim'; }
    if (p2 === 'aim') {
      report.stuck.push({ reason: 'swing did not launch', state: s1, swing: sw });
      console.log(`  swing did not launch: ${JSON.stringify({ hole: s1.v.hole, club: s1.v.club, ideal: +ideal.toFixed(3), power: +power.toFixed(3), result: sw })}`);
      if (report.stuck.length % 3 === 0) await snap(`stuck-${report.stuck.length}`);
      continue;
    }
    await waitPhase(page, ['aim', 'summary', 'done', 'ai', 'intro'], 240000);
    const s2 = await st();
    const toast = await page.evaluate(() => document.querySelector('.toast').textContent);
    if (args.broadcast) {
      const card = await page.evaluate(() => { const c = document.querySelector('.shotcard'); return c && !c.classList.contains('hidden') ? c.innerText.replace(/\n/g, ' / ') : null; });
      if (card && /comm/.test(await page.evaluate(() => (document.querySelector('.shotcard .why.comm') ? 'comm' : '')))) { report.commentary = (report.commentary || []).concat(card.split(' / ').slice(-1)); if (report.commentary.length === 1) await snap('commentary'); }
      report.badges = (report.badges || []).concat(await page.evaluate(() => { const b = document.querySelector('.posbadge'); return b && !b.classList.contains('hidden') ? b.textContent : null; })).slice(-3);
      // Replay controls once, after the first full shot that left a replay.
      if (!report.replay && s2.phase === 'aim' && s1.v.club !== 'PT' && await page.evaluate(() => { const b = document.querySelector('[aria-label="Replay the last shot"]'); return !!(b && !b.classList.contains('hidden') && b.offsetParent); })) {
        await clickSel(page, pointer, '[aria-label="Replay the last shot"]');
        await page.waitForTimeout(800);
        report.replay = { controls: await page.evaluate(() => [...document.querySelectorAll('.shotcard.rp button')].map((b) => b.textContent)) };
        await snap('replay-controls');
        // Speed from the replay card, then an angle from the HUD's angle chips.
        const tapIn = async (sel, text) => { const r = await page.evaluate(([q, t]) => { const b = [...document.querySelectorAll(q)].find((x) => x.textContent.trim().startsWith(t) && x.offsetParent); if (!b) return null; const k = b.getBoundingClientRect(); return { x: k.x + k.width / 2, y: k.y + k.height / 2 }; }, [sel, text]); if (r) { await pointer.tap(r.x, r.y); await page.waitForTimeout(900); } return !!r; };
        await tapIn('.shotcard.rp button', 'Speed');
        report.replay.speed = await page.evaluate(() => window.__fw.game.state.replaySpeed);
        await tapIn('#ui button', 'Side');
        report.replay.after = await page.evaluate(() => ({ angle: window.__fw.game.state.replayAngle, speed: window.__fw.game.state.replaySpeed, phase: window.__fw.phase() }));
        await snap('replay-angle');
        const done = await page.evaluate(() => { const b = [...document.querySelectorAll('#ui button')].find((x) => x.textContent.trim() === 'Done' && x.offsetParent); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        if (done) await pointer.tap(done.x, done.y);
        await waitPhase(page, ['aim', 'summary', 'done', 'ai'], 60000).catch(() => {});
        report.replay.end = await page.evaluate(() => window.__fw.phase());
      }
    }
    console.log(`  h${s1.v.hole} ${s1.v.club} ${s1.v.shot} from ${s1.v.lie} ${s1.v.dist.toFixed(1)} m -> ${s2.v ? s2.v.dist.toFixed(1) : '-'} m  power ${sw ? sw.power.toFixed(2) : '-'} (${sw ? sw.tempoLabel : '-'})${read ? `  read ${(read.left * 57.3).toFixed(1)} deg off` : ''}  ${toast.slice(0, 60)}`);
    report.shots.push({ hole: s1.v.hole, club: s1.v.club, shot: s1.v.shot, lie: s1.v.lie, before: +s1.v.dist.toFixed(2), after: s2.v ? +s2.v.dist.toFixed(2) : null, ideal: +ideal.toFixed(3), power: sw ? +sw.power.toFixed(3) : null, tempo: sw ? sw.tempoLabel : null, ratio: sw ? +sw.tempoRatio.toFixed(2) : null, read: read && { drags: read.drags, taps: read.taps, leftDeg: +(read.left * 57.2958).toFixed(2), breakM: +s1.putt.breakM.toFixed(2) }, result: toast, sec: +((Date.now() - t) / 1000).toFixed(1) });
    lastProgress = Date.now();
  }
} catch (e) {
  report.errors.push(String(e && e.message ? e.message.split('\n')[0] : e));
  await snap('failed').catch(() => {});
}
report.guard = await page.evaluate(() => window.__fw.errors).catch(() => null);
report.consoleErrors = errors.map((e) => e.text.slice(0, 300));
report.timing.totalMin = +((Date.now() - T0) / 60000).toFixed(1);
report.timing.shots = report.shots.length;
report.timing.secPerShot = report.shots.length ? +(report.shots.reduce((a, s) => a + s.sec, 0) / report.shots.length).toFixed(1) : null;
const tempo = {}; for (const s of report.shots) tempo[s.tempo] = (tempo[s.tempo] || 0) + 1;
report.summary = {
  holes: report.holesPlayed.length,
  strokes: report.holesPlayed.reduce((a, h) => a + h.strokes[0], 0),
  par: report.holesPlayed.reduce((a, h) => a + h.par, 0),
  putts: report.shots.filter((s) => s.club === 'PT').length,
  tempo,
  stuck: report.stuck.length, consoleErrors: report.consoleErrors.length, guardErrors: report.guard ? report.guard.count : null,
};
report.summary.toPar = report.summary.strokes - report.summary.par;
writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(report, null, 1));
console.log(`${tag}: ${report.summary.holes} holes, ${report.summary.strokes} strokes (${report.summary.toPar >= 0 ? '+' : ''}${report.summary.toPar}), ${report.shots.length} shots, ${report.timing.totalMin} min, stuck ${report.stuck.length}, console errors ${report.consoleErrors.length}, guard ${report.summary.guardErrors}`);
await browser.close();
await server.close();
