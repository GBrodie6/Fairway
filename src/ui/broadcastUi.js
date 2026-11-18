// Broadcast presentation: the hole intro card over the flyover, a lower third as each hole
// starts, a live leaderboard (campaign events and tournaments) with movement arrows, original
// commentary on notable shots, replay controls (angle and speed), the round recap, and the
// tournament screens (four rounds, a cut, a purse in coins, a trophy).
import { h } from './dom.js';
import { fmtDist, fmtToPar, ordinal } from './format.js';
import { courseById } from '../course/courses.js';
import { hashString } from '../core/rng.js';
import { holeIntro, shotLine, holeLine } from '../game/commentary.js';
import { roundFacts } from '../game/campaign.js';
import {
  createTournament, tournamentBoard, finishTournamentRound, roundHoles, posLabel, T_ROUNDS, T_HOLES, T_CUT_TOP, T_FIELD, PURSE,
} from '../game/tournament.js';
import { SURFACE_NAMES, SURFACES } from '../physics/surfaces.js';
import { levelForXp } from '../game/campaign.js';


export function installBroadcast(app, ui) {
  const { screens, hud } = ui;
  const game = app.game;
  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const btn = (label, onclick, cls = 'btn', extra = {}) => h('button', { class: cls, type: 'button', onclick, ...extra }, label);
  const u = () => app.settings.units;
  const root = document.getElementById('ui') || document.body;

  // ---------- live leaderboard ----------
  // Campaign events and tournaments register a provider; it returns ranked rows or null.
  let boardProvider = null;
  app.setBoardProvider = (fn) => { boardProvider = fn; };
  app.liveBoard = () => {
    const r = game.state.round;
    if (!r || !boardProvider) return null;
    const mine = (r.scores[0] || []).filter(Number.isFinite);
    try { return boardProvider(r, mine, mine.length); } catch { return null; }
  };
  app.boardBadge = () => {
    const b = app.liveBoard();
    if (!b) return null;
    const me = b.find((x) => x.me);
    return me ? `${posLabel(me)} of ${b.length}` : null;
  };
  const arrow = (m) => (m > 0 ? h('span', { class: 'mv up', 'aria-label': `up ${m}`, text: `▲${m}` }) : m < 0 ? h('span', { class: 'mv down', 'aria-label': `down ${-m}`, text: `▼${-m}` }) : h('span', { class: 'mv', text: '' }));
  const boardBlock = (rows, n = 5) => {
    const top = rows.slice(0, n);
    const me = rows.find((x) => x.me);
    if (me && !top.includes(me)) top.push(me);
    return h('div', { class: 'list board' }, ...top.map((x) => h('div', { class: `item${x.me ? ' me' : ''}` },
      h('span', { class: 'row' }, h('b', { class: 'pos', text: posLabel(x) }), arrow(x.move || 0), h('span', { text: `${x.name}${x.boss ? ' (boss)' : ''}` })),
      h('b', { text: fmtToPar(x.toPar) }))));
  };
  app.holeSummaryExtra = (s) => {
    const r = game.state.round;
    const kids = [];
    if (r && r.players[0].kind === 'human' && Number.isFinite(s.strokes[0])) kids.push(h('p', { class: 'center comm', text: holeLine(s.strokes[0] - s.par, `${r.seed}:${s.holeIdx}`) }));
    const b = app.liveBoard();
    if (b) kids.push(h('h3', { class: 'h small', text: 'Leaderboard' }), boardBlock(b));
    return kids.length ? h('div', {}, ...kids) : null;
  };

  // ---------- intro card and lower third ----------
  const intro = h('div', { class: 'introcard hidden', role: 'status', 'aria-live': 'polite' });
  root.appendChild(intro);
  function showIntro() {
    const r = game.state.round, w = app.world;
    if (!r || !w || !w.holeData) return;
    const hd = w.holeData, course = courseById(r.courseId);
    const b = app.liveBoard();
    const tied = b ? b.filter((x) => x.pos === 1).length : 0;
    const meLead = b && b.some((x) => x.me && x.pos === 1);
    const leader = !b || !b[0] ? null : tied > 1 ? `${meLead ? 'You share' : `${tied} players share`} the lead at ${fmtToPar(b[0].toPar)}` : b[0].me ? `You lead at ${fmtToPar(b[0].toPar)}` : `${b[0].name} leads at ${fmtToPar(b[0].toPar)}`;
    intro.textContent = '';
    intro.append(h('span', { class: 'kicker', text: course.name }),
      h('b', { class: 'ititle', text: `Hole ${hd.number}  ·  Par ${hd.par}  ·  ${fmtDist(hd.yards * 0.9144, u())}` }),
      h('span', { class: 'line', text: holeIntro(hd) }),
      leader ? h('span', { class: 'lead', text: leader }) : null);
    intro.classList.remove('hidden');
  }
  let pendingLT = false;
  game.on((type, d) => {
    if (type === 'hole') pendingLT = true;
    if (type === 'phase') {
      if (d === 'intro') showIntro(); else intro.classList.add('hidden');
      // The lower third waits while the first-minute tutorial is speaking.
      if (d === 'aim' && pendingLT && game.state.round && game.state.round.mode !== 'range' && game.state.round.players[game.state.turn].kind === 'human' && !(app.tutorialStep && app.tutorialStep() >= 0)) {
        pendingLT = false;
        const v = game.view();
        if (!v) return;
        const badge = app.boardBadge();
        hud.lowerThird(`Hole ${v.hole}  ·  Par ${v.par}`, `${v.player.name}  ${fmtToPar(v.toPar)}${badge ? `  ·  ${badge}` : ''}`, holeIntro(app.world.holeData), 3400);
      }
      if (d === 'replay') replayBar();
    }
  });

  // ---------- commentary on shots ----------
  app.commentFor = (s) => {
    const o = s.outcome, r = game.state.round;
    return shotLine({
      tee: s.from && s.from.lie === SURFACES.TEE, par: s.par, putt: o.putt, holed: o.holed, fromDist: s.from ? Math.hypot(s.from.x - (app.world.terrain.pin.x), s.from.z - app.world.terrain.pin.z) : 0,
      carry: o.carry, lie: SURFACE_NAMES[o.lie], water: o.water, oob: o.oob, toPin: o.distToPin, strike: o.strike, onGreen: o.lie === SURFACES.GREEN,
    }, `${r ? r.seed : 0}:${r ? r.hole : 0}:${s.strokes}`);
  };

  // ---------- replay controls ----------
  // The HUD already offers the four angles during a replay; this adds the speed.
  function replayBar() {
    const sp = game.state.replaySpeed || 0.5;
    hud.replayControls([
      [sp === 0.5 ? 'Speed: half' : 'Speed: quarter', () => game.replay(game.state.replayAngle || 'follow', sp === 0.5 ? 0.25 : 0.5)],
    ]);
  }

  // ---------- highlights and the round recap ----------
  let hl = null;
  const resetHl = () => { hl = { longestDrive: 0, longestPutt: 0, chipIns: 0, pured: 0, holes: [] }; };
  resetHl();
  game.on((type, d) => {
    if (type === 'roundStart') resetHl();
    if (type === 'swing' && d.human && d.strike && d.strike.kind === 'pured') hl.pured++;
    if (type === 'shotEnd' && game.state.round && game.state.round.players[d.player].kind === 'human') {
      const o = d.outcome;
      if (d.from && d.from.lie === SURFACES.TEE && d.par > 3) hl.longestDrive = Math.max(hl.longestDrive, o.total || 0);
      if (o.holed && o.putt) hl.longestPutt = Math.max(hl.longestPutt, Math.hypot(d.from.x - o.end.x, d.from.z - o.end.z));
      if (o.holed && !o.putt) hl.chipIns++;
    }
  });
  app.recap = (r) => {
    const f = roundFacts(r, 0), course = courseById(r.courseId);
    const pars = r.holes.map((i) => course.pars[i]);
    const sc = r.scores[0];
    // Bars above the line for under par, below for over, one per hole.
    const W = 300, H = 90, bw = W / Math.max(1, sc.length), NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: `0 0 ${W} ${H}`, width: '100%', height: String(H), role: 'img', 'aria-label': 'Score against par on each hole' })) svg.setAttribute(k, v);
    sc.forEach((s, i) => {
      const d = (s || 0) - pars[i], hgt = Math.min(40, Math.abs(d) * 16 + 3);
      const rect = document.createElementNS(NS, 'rect');
      for (const [k, v] of Object.entries({ x: i * bw + 2, y: d <= 0 ? H / 2 - hgt : H / 2, width: Math.max(2, bw - 4), height: hgt, rx: 2, fill: d < 0 ? '#c2e58a' : d === 0 ? '#9aa4ad' : '#ffb37a' })) rect.setAttribute(k, String(v));
      svg.appendChild(rect);
    });
    const axis = document.createElementNS(NS, 'line');
    for (const [k, v] of Object.entries({ x1: 0, x2: W, y1: H / 2, y2: H / 2, stroke: 'rgba(255,255,255,0.3)' })) axis.setAttribute(k, String(v));
    svg.appendChild(axis);
    const best = sc.map((s, i) => ({ d: s - pars[i], i })).sort((a, b) => a.d - b.d)[0];
    const rows = [
      ['Score', `${f.strokes} (${fmtToPar(f.toPar)})`], ['Birdies or better', String(f.birdies + f.eagles)],
      ['Fairways', `${f.fairways} of ${f.fairwayChances}`], ['Greens in regulation', `${f.gir} of ${f.holes}`], ['Putts', String(f.putts)],
      ['Pured strikes', String(hl.pured)], ['Longest drive', hl.longestDrive ? fmtDist(hl.longestDrive, u()) : 'none'],
      ['Longest putt holed', hl.longestPutt ? fmtDist(hl.longestPutt, u()) : 'none'],
    ];
    screens.show('recap', () => {
      const chart = h('div', { class: 'recapchart' }, svg);
      return sheet('recap',
        h('h2', { class: 'h', text: 'Round recap' }),
        h('p', { class: 'muted', text: `${course.name}, ${f.holes} holes.${best && best.d < 0 ? ` Best hole: the ${ordinal(r.holes[best.i] + 1)}.` : ''}${hl.chipIns ? ` ${hl.chipIns} holed from off the green.` : ''}` }),
        chart,
        h('table', { class: 'avg' }, h('tbody', {}, ...rows.map(([k, v]) => h('tr', {}, h('td', { text: k }), h('td', { text: v }))))),
        h('div', { class: 'stack', style: { marginTop: '12px' } }, btn('Back', () => screens.back())));
    });
  };

  // ---------- tournaments ----------
  const tState = () => app.save().tournament;
  function tournamentScreen() {
    screens.show('tournament', () => {
      const t = tState();
      const cabinet = app.save().trophies || [];
      if (!t || t.done) {
        const last = t && t.done ? t.result : null;
        return sheet('wide tour',
          h('h2', { class: 'h', text: 'Tournament' }),
          last ? h('div', { class: `tresult${last.trophy ? ' win' : ''}` }, h('b', { text: last.trophy ? `You won the ${t.name}!` : last.madeCut ? `${t.name}: you finished ${last.tie ? 'T' : ''}${last.position}` : `${t.name}: missed the cut` }), h('span', { text: `${fmtToPar(last.toPar)}. ${last.coins} coins.` })) : null,
          h('p', { class: 'muted', text: `Four rounds of ${T_HOLES} holes against a field of ${T_FIELD}. After round two, the top ${T_CUT_TOP} and ties make the cut. The purse is paid in coins (winner ${PURSE[0]}), and a win puts a trophy in your cabinet.` }),
          h('h3', { class: 'h small', text: 'Choose a course' }),
          h('div', { class: 'cards' }, ...['parkland', 'links', 'desert', 'alpine', 'tropical'].map((id) => btn(courseById(id).name, () => newTournament(id), 'card'))),
          cabinet.length ? h('div', {}, h('h3', { class: 'h small', text: 'Trophy cabinet' }), h('div', { class: 'list' }, ...cabinet.slice(-8).reverse().map((x) => h('div', { class: 'item' }, h('span', { text: `${x.name}, ${courseById(x.courseId).name}` }), h('b', { text: fmtToPar(x.toPar) }))))) : null,
          h('div', { class: 'stack', style: { marginTop: '10px' } }, btn('Back', () => screens.back())));
      }
      const b = tournamentBoard(t, [], 0);
      return sheet('wide tour',
        h('h2', { class: 'h', text: t.name }),
        h('p', { class: 'muted', text: `${courseById(t.courseId).name}. Round ${t.round + 1} of ${T_ROUNDS}: holes ${roundHoles(t.round)[0] + 1} to ${roundHoles(t.round)[T_HOLES - 1] + 1}.${t.cut ? ` Cut made (line ${fmtToPar(t.cutLine)}).` : t.round < 2 ? ` The cut comes after round 2.` : ''}` }),
        boardBlock(b, 8),
        h('div', { class: 'grid2', style: { marginTop: '10px' } }, btn('Back', () => screens.back()), btn(`Play round ${t.round + 1}`, () => playRound(), 'btn primary')),
        h('div', { class: 'stack', style: { marginTop: '8px' } }, btn('Withdraw', () => { app.updateSave((s) => ({ ...s, tournament: null }), 'tournament'); tournamentScreen(); }, 'btn small')));
    });
  }
  function newTournament(courseId) {
    const s = app.save();
    const t = createTournament({ courseId, seed: (Date.now() ^ hashString(courseId)) >>> 0, level: levelForXp(s.profile.xp) });
    app.updateSave((x) => ({ ...x, tournament: t }), 'tournament');
    tournamentScreen();
  }
  async function playRound() {
    const t = tState(), s = app.save();
    screens.hide();
    await game.startRound({ courseId: t.courseId, mode: 'stroke', holes: roundHoles(t.round), tod: t.tods[t.round], seed: (t.seed + t.round * 7919) >>> 0, eventId: `tour:${t.id}:${t.round}`, profile: app.golferProfile ? app.golferProfile() : undefined, golfer: true, players: [{ id: 'p1', name: s.player.name || 'You', kind: 'human', handed: s.player.handed, ball: s.player.ball }] });
  }
  app.openTournament = tournamentScreen;
  app.isTournamentRound = (r) => !!(r && typeof r.eventId === 'string' && r.eventId.startsWith('tour:'));
  // The leaderboard during a tournament round.
  const tourBoard = (r, mine, thru) => {
    const t = tState();
    if (!t || !app.isTournamentRound(r) || r.eventId !== `tour:${t.id}:${t.round}`) return null;
    return tournamentBoard(t, mine, thru).map((x) => (x.me ? { ...x, name: app.save().player.name || 'You' } : x));
  };
  // Providers are tried in turn (tournaments here; the campaign adds its own).
  app.boardProviders = app.boardProviders || [];
  app.boardProviders.push(tourBoard);
  app.setBoardProvider((r, mine, thru) => { for (const p of app.boardProviders) { const b = p(r, mine, thru); if (b) return b; } return null; });

  let lastTour = null;
  app.tournamentRoundEnd = (r) => {
    const t = tState();
    if (!t || r.eventId !== `tour:${t.id}:${t.round}`) return null;
    const scores = r.scores[0].map((x) => (Number.isFinite(x) ? x : 10));
    const out = finishTournamentRound(t, scores);
    lastTour = { ...out, roundNo: t.round + 1 };
    app.updateSave((s) => {
      let n = { ...s, tournament: out.tournament };
      const res = out.tournament.result;
      if (out.tournament.done && res) {
        n = { ...n, wallet: { ...n.wallet, coins: (n.wallet.coins || 0) + res.coins } };
        if (res.trophy) n = { ...n, trophies: [...(n.trophies || []), { name: out.tournament.name, courseId: out.tournament.courseId, toPar: res.toPar, date: Date.now() }].slice(-40) };
      }
      return n;
    }, 'tournament');
    if (app.recordPlay) app.recordPlay({ cutsMade: out.events.includes('made-cut') ? 1 : 0, tournamentWins: out.events.includes('won') ? 1 : 0 });
    return lastTour;
  };
  app.tournamentRoundEndExtra = () => {
    if (!lastTour) return null;
    const t = lastTour.tournament, ev = lastTour.events;
    const lines = [];
    if (ev.includes('made-cut')) lines.push(`You made the cut (line ${fmtToPar(t.cutLine)}).`);
    if (ev.includes('missed-cut')) lines.push(`Missed the cut by ${t.result.toPar - t.cutLine}. ${t.result.coins} coins.`);
    if (ev.includes('won')) lines.push(`Champion! ${t.result.coins} coins and a trophy for the cabinet.`);
    if (ev.includes('finished')) lines.push(`Finished ${t.result.tie ? 'T' : ''}${t.result.position}. ${t.result.coins} coins.`);
    const b = !t.done ? tournamentBoard(t, [], 0) : null;
    return h('div', { class: 'tour-end' },
      h('h3', { class: 'h', text: `${t.name}: round ${lastTour.roundNo} of ${T_ROUNDS}` }),
      ...lines.map((x) => h('p', { class: `center${ev.includes('won') ? ' good big2' : ''}`, text: x })),
      b ? boardBlock(b, 5) : t.result && t.result.board ? h('div', { class: 'list board' }, ...t.result.board.map((x) => h('div', { class: `item${x.me ? ' me' : ''}` }, h('span', { text: `${x.pos}. ${x.me ? app.save().player.name || 'You' : x.name}` }), h('b', { text: fmtToPar(x.toPar) })))) : null,
      h('div', { class: 'center' }, btn(t.done ? 'Tournaments' : `On to round ${t.round + 1}`, () => { screens.hide(); game.quit(); tournamentScreen(); }, 'btn primary')));
  };
  screens.register('tournament', tournamentScreen);
}
