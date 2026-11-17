// Screens: main menu, round setup, pause, hole summary, round end, and the first-run tutorial.
// Career, daily challenge, stats, and settings screens are added by their own modules and
// registered here through ui.screens.register(name, fn).
import { h } from './dom.js';
import { COURSES, courseById } from '../course/courses.js';
import { TOD_ORDER, TOD } from '../render/timeOfDay.js';
import { scoreName } from '../game/scoring.js';
import { standings, parOf } from '../game/round.js';
import { fmtToPar, fmtShort } from './format.js';
import { hashString } from '../core/rng.js';

const MODE_INFO = [
  { id: 'stroke', name: 'Stroke play', text: 'Every shot counts. Lowest total wins.' },
  { id: 'match', name: 'Match play', text: 'Win holes against a rival, one at a time.' },
  { id: 'skins', name: 'Skins', text: 'Each hole is worth a skin. Ties carry over.' },
  { id: 'ctp', name: 'Closest to the pin', text: 'One shot per hole. Nearest the flag wins.' },
];
const TOD_NAMES = { dawn: 'Dawn', morning: 'Morning', midday: 'Midday', golden: 'Golden hour', dusk: 'Dusk', night: 'Night' };

export function createScreens(root, { app, game, settings, ui, save }) {
  const layer = h('div', { class: 'screen off', 'aria-hidden': 'true' });
  root.appendChild(layer);
  const stack = [];
  const screens = { layer, registry: {} };

  function show(name, build, { modal = true } = {}) {
    layer.textContent = '';
    layer.appendChild(build());
    layer.classList.remove('off');
    layer.setAttribute('aria-hidden', 'false');
    ui.modal = modal ? name : null;
    if (!stack.length || stack[stack.length - 1].name !== name) stack.push({ name, build, modal });
    const first = layer.querySelector('button, select, input');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus({ preventScroll: true });
  }
  function hide() {
    layer.classList.add('off');
    layer.setAttribute('aria-hidden', 'true');
    layer.textContent = '';
    ui.modal = null;
    stack.length = 0;
  }
  screens.hide = hide;
  screens.show = show;
  screens.back = () => {
    stack.pop();
    const prev = stack.pop();
    if (prev) show(prev.name, prev.build, prev);
    else if (game.state.round) hide();
    else screens.menu();
  };
  screens.register = (name, fn) => { screens.registry[name] = fn; };
  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, label);

  // --- main menu ---
  screens.menu = () => show('menu', () => sheet('',
    h('h1', { class: 'title', text: 'Fairway Next' }),
    h('p', { class: 'tag', text: 'A calm round of golf. One gesture per shot.' }),
    h('div', { class: 'stack' },
      btn('Quick round', () => screens.setup(), 'btn primary'),
      screens.registry.career ? btn('Career', () => screens.registry.career()) : null,
      screens.registry.daily ? btn('Daily challenge', () => screens.registry.daily()) : null,
      h('div', { class: 'grid2' },
        btn('Driving range', () => startRange()),
        screens.registry.passplay ? btn('Pass and play', () => screens.registry.passplay()) : btn('Two players', () => screens.setup({ players: 2 }))),
      h('div', { class: 'grid2' },
        screens.registry.stats ? btn('Stats and history', () => screens.registry.stats()) : null,
        screens.registry.settings ? btn('Settings', () => screens.registry.settings()) : null),
    ),
  ), { modal: true });

  // --- quick round setup ---
  const setupState = { courseId: COURSES[0].id, holes: 9, mode: 'stroke', tod: 'morning', rival: false, players: 1 };
  screens.setup = (opts = {}) => {
    if (opts.players) setupState.players = opts.players;
    show('setup', () => {
      const cards = h('div', { class: 'cards' });
      for (const c of COURSES) {
        cards.appendChild(h('button', { class: 'card', type: 'button', 'aria-pressed': setupState.courseId === c.id ? 'true' : 'false', onclick: () => { setupState.courseId = c.id; screens.setup(); } },
          h('b', { text: c.name }), h('span', { text: c.blurb || c.style || '' })));
      }
      const modeSeg = h('div', { class: 'seg glass', role: 'group', 'aria-label': 'Game mode' });
      for (const m of MODE_INFO) modeSeg.appendChild(h('button', { type: 'button', 'aria-pressed': setupState.mode === m.id ? 'true' : 'false', onclick: () => { setupState.mode = m.id; screens.setup(); } }, m.name));
      const holeSeg = h('div', { class: 'seg glass', role: 'group', 'aria-label': 'Holes' });
      for (const n of [9, 18]) holeSeg.appendChild(h('button', { type: 'button', 'aria-pressed': setupState.holes === n ? 'true' : 'false', onclick: () => { setupState.holes = n; screens.setup(); } }, `${n} holes`));
      const tod = h('select', { 'aria-label': 'Time of day', onchange: (e) => { setupState.tod = e.target.value; } });
      for (const id of TOD_ORDER) tod.appendChild(h('option', { value: id, selected: setupState.tod === id }, TOD_NAMES[id] || id));
      const info = MODE_INFO.find((m) => m.id === setupState.mode);
      const needsRival = setupState.mode === 'match' || setupState.mode === 'skins';
      const rival = h('input', { type: 'checkbox', id: 'rival', checked: setupState.rival || needsRival, disabled: needsRival && setupState.players < 2, onchange: (e) => { setupState.rival = e.target.checked; } });
      return sheet('wide',
        h('h2', { class: 'h', text: 'Quick round' }),
        h('h3', { class: 'h', text: 'Course' }), cards,
        h('h3', { class: 'h', text: 'Format' }), h('div', { class: 'row' }, modeSeg, holeSeg),
        h('p', { class: 'muted', text: info.text }),
        h('div', { class: 'field' }, h('label', { text: 'Time of day' }), tod),
        setupState.players < 2 ? h('div', { class: 'field' }, h('label', { for: 'rival', text: 'Play against a computer rival' }), rival) : h('p', { class: 'muted', text: `${setupState.players} players share this device and pass it between shots.` }),
        h('div', { class: 'grid2', style: { marginTop: '14px' } }, btn('Back', () => screens.back()), btn('Tee off', () => startQuick(), 'btn primary')),
      );
    });
  };

  function playerList() {
    const me = { id: 'p1', name: settings.playerName || 'You', kind: 'human', handed: settings.handedness, ball: '#ffffff' };
    const needsRival = setupState.mode === 'match' || setupState.mode === 'skins';
    if (setupState.players > 1) {
      const cols = ['#ffffff', '#ffd23f', '#7fd1ff', '#ff9e7a'];
      return Array.from({ length: setupState.players }, (_, i) => ({ id: 'p' + (i + 1), name: i === 0 ? me.name : `Player ${i + 1}`, kind: 'human', ball: cols[i] }));
    }
    if (setupState.rival || needsRival) return [me, { id: 'ai1', name: 'Rowan Vale', kind: 'ai', skill: 0.62, ball: '#ffd23f' }];
    return [me];
  }
  async function startQuick() {
    hide();
    const seed = setupState.seed != null ? hashString(String(setupState.seed)) : (Date.now() ^ hashString(setupState.courseId)) >>> 0;
    await game.startRound({ courseId: setupState.courseId, mode: setupState.mode, holeCount: setupState.holes, startHole: setupState.startHole || 1, tod: setupState.tod, players: playerList(), seed });
  }
  async function startRange() {
    hide();
    await game.startRound({ courseId: setupState.courseId, mode: 'range', holeCount: 1, tod: setupState.tod, players: [{ id: 'p1', name: settings.playerName || 'You', kind: 'human' }], seed: Date.now() >>> 0 });
  }
  screens.startQuick = (opts) => { Object.assign(setupState, opts); return startQuick(); };

  // --- pause ---
  screens.pause = () => show('pause', () => sheet('',
    h('h2', { class: 'h', text: 'Paused' }),
    h('p', { class: 'muted', text: game.state.round ? `${courseById(game.state.round.courseId).name}, hole ${game.state.round.hole + 1} of ${game.state.round.holes.length}` : '' }),
    h('div', { class: 'stack' },
      btn('Resume', () => hide(), 'btn primary'),
      btn('Scorecard', () => screens.scorecard()),
      screens.registry.settings ? btn('Settings', () => screens.registry.settings()) : null,
      screens.registry.share && game.state.round ? btn('Share this round', () => screens.registry.share()) : null,
      btn('Quit round', () => { hide(); game.quit(); })),
  ));

  // --- scorecard ---
  function scorecardTable(r) {
    const pars = r.holes.map((hIdx) => courseById(r.courseId).pars[hIdx]);
    const t = h('table', { class: 'card-t' });
    const head = h('tr', {}, h('th', { text: 'Hole' }), ...r.holes.map((hIdx) => h('th', { text: String(hIdx + 1) })), h('th', { text: 'Tot' }));
    const parRow = h('tr', {}, h('td', { text: 'Par' }), ...pars.map((p) => h('td', { text: String(p) })), h('td', { text: String(pars.reduce((a, b) => a + b, 0)) }));
    t.append(head, parRow);
    r.players.forEach((p, i) => {
      const sc = r.scores[i];
      const cells = r.holes.map((_, k) => {
        const s = sc[k];
        const cls = Number.isFinite(s) ? (s < pars[k] ? 'under' : s > pars[k] ? 'over' : '') : '';
        return h('td', { class: cls, text: Number.isFinite(s) ? String(s) : '' });
      });
      const tot = sc.filter(Number.isFinite).reduce((a, b) => a + b, 0);
      t.appendChild(h('tr', {}, h('td', { text: p.name }), ...cells, h('td', { text: tot ? String(tot) : '' })));
    });
    return h('div', { class: 'scroll-x' }, t);
  }
  screens.scorecard = () => show('scorecard', () => sheet('wide', h('h2', { class: 'h', text: 'Scorecard' }), scorecardTable(game.state.round), h('div', { style: { marginTop: '14px' } }, btn('Back', () => screens.back(), 'btn'))));

  // --- hole summary ---
  screens.holeSummary = (s) => {
    if (!s || game.state.fast) return;
    const r = game.state.round;
    show('summary', () => {
      const rows = r.players.map((p, i) => {
        const st = s.strokes[i];
        return h('div', { class: 'item' }, h('span', { text: p.name }), h('span', { text: r.mode === 'ctp' ? (Number.isFinite(r.ctp[i][s.slot]) ? fmtShort(r.ctp[i][s.slot], settings.units) : 'Missed the green') : `${st}  ${scoreName(st, s.par)}` }));
      });
      const stand = standings(r);
      return sheet('',
        h('p', { class: 'muted center', text: `Hole ${s.holeIdx + 1}  Par ${s.par}` }),
        h('div', { class: 'big', text: r.players.length === 1 ? scoreName(s.strokes[0], s.par) : stand.text || 'Hole complete' }),
        h('div', { class: 'list', style: { margin: '12px 0' } }, ...rows),
        r.players.length === 1 ? h('p', { class: 'muted center', text: `Round ${fmtToPar(stand.totals[0].toPar)} through ${stand.totals[0].played}` }) : h('p', { class: 'muted center', text: stand.text }),
        h('div', { class: 'grid2', style: { marginTop: '12px' } }, btn('Scorecard', () => screens.scorecard()), btn(s.over ? 'See results' : 'Next hole', () => { hide(); game.continue(); }, 'btn primary')),
      );
    });
  };

  // --- round end ---
  screens.roundEnd = (r) => {
    if (!r) return;
    const stand = standings(r);
    if (screens.onRoundEnd) screens.onRoundEnd(r, stand);
    show('done', () => sheet('wide',
      h('h2', { class: 'h center', text: 'Round complete' }),
      h('div', { class: 'big', text: r.players.length === 1 ? `${stand.totals[0].strokes}  (${fmtToPar(stand.totals[0].toPar)})` : stand.text }),
      h('p', { class: 'muted center', text: courseById(r.courseId).name }),
      scorecardTable(r),
      h('div', { class: 'grid2', style: { marginTop: '14px' } }, btn('Main menu', () => { hide(); game.quit(); }), btn('Play again', () => startQuick(), 'btn primary')),
    ));
  };

  // --- first-run tutorial ---
  const tip = h('div', { class: 'tip glass hidden', role: 'dialog', 'aria-live': 'polite' });
  // Under the map and the menus, over the HUD.
  root.insertBefore(tip, ui.map.el);
  const STEPS = [
    { title: 'Aim', text: 'Drag across the course to aim. The ring shows where the ball should land.', until: 'aim' },
    { title: 'Backswing', text: 'Pull the ball on the swing stick down. The green mark is the power this shot needs.', until: null },
    { title: 'Strike', text: 'Then push it up through the white line. Slower back than through flies straightest.', until: 'swing' },
  ];
  let step = -1, unsub = null;
  function showStep() {
    const s = STEPS[step];
    tip.textContent = '';
    tip.append(h('div', { class: 'step', text: `${step + 1} of ${STEPS.length}  ${s.title}` }), h('div', { text: s.text }),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'btn small', type: 'button', onclick: () => advance() }, step < STEPS.length - 1 ? 'Next' : 'Got it'), h('button', { class: 'btn small', type: 'button', onclick: () => finish() }, 'Skip')));
    tip.classList.remove('hidden');
  }
  function advance() { step++; if (step >= STEPS.length) finish(); else showStep(); }
  function finish() { tip.classList.add('hidden'); settings.tutorialDone = true; save(); if (unsub) unsub(); unsub = null; step = -1; }
  screens.maybeTutorial = () => {
    if (settings.tutorialDone || step >= 0 || app.params.bot || app.params.smoke) return;
    const r = game.state.round;
    if (!r || r.players[game.state.turn].kind !== 'human') return;
    step = 0; showStep();
    unsub = game.on((type) => {
      if (step < 0) return;
      if (type === 'aim' && STEPS[step].until === 'aim' && game.state.phase === 'aim') setTimeout(() => { if (step === 0) advance(); }, 900);
      if (type === 'swing') finish();
    });
  };
  return screens;
}

export { TOD, parOf };
