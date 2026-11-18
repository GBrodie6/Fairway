// Menu screens beyond the basics: settings, stats and history, achievements, the daily
// challenge, the career hub, pass and play, and challenge links. Also the glue that records
// finished rounds into the save. Registered into ui.screens.
import { h } from './dom.js';
import { fmtDist, fmtToPar, ordinal } from './format.js';
import { COURSES, courseById } from '../course/courses.js';
import { TOD_ORDER } from '../render/timeOfDay.js';
import { TIER_ORDER } from '../core/quality.js';
import { hashString, createRng } from '../core/rng.js';
import { loadSave, writeSave, recordRound, recordDaily, unlock, dayKey, statsSummary, ACHIEVEMENTS } from '../game/save.js';
import {
  createCareer, profileFor, spendPoint, equip, nextEvent, completeEvent, currentTier, tierStandings, xpForLevel,
  ATTRIBUTES, ATTRIBUTE_INFO, EQUIPMENT, UNLOCK_LEVEL, unlocked, TIERS, simulateRivalRound,
} from '../game/career.js';
import { makeChallenge, challengeUrl, readChallengeFromHash, mergeIntoChallenge, toCompact, challengeStandings } from '../game/share.js';
import { holesFor } from '../game/round.js';

const TOD_NAMES = { dawn: 'Dawn', morning: 'Morning', midday: 'Midday', golden: 'Golden hour', dusk: 'Dusk', night: 'Night' };
const BALLS = ['#ffffff', '#ffd23f', '#ff9e7a', '#7fd1ff'];

export function installMenus(app, ui) {
  const { game, settings } = app;
  const screens = ui.screens;
  let save = loadSave();
  app.save = () => save;
  const persist = () => writeSave(save);
  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, label);
  const back = () => btn('Back', () => screens.back());
  const field = (label, control, id) => h('div', { class: 'field' }, h('label', { for: id, text: label }), control);
  const toastUnlocks = (ids) => { ids.forEach((id, i) => { const a = ACHIEVEMENTS.find((x) => x.id === id); if (a) setTimeout(() => ui.hud.toast(`Achievement: ${a.name}`, a.text, 2600), 600 + i * 2800); }); };
  let context = null; // { kind: 'career', eventId } | { kind: 'daily', key } | { kind: 'challenge', challenge } | null

  // ---------- settings ----------
  screens.register('settings', () => screens.show('settings', () => {
    const save2 = () => { app.saveSettings(); ui.applySettings(); };
    const select = (id, value, options, onchange) => {
      const s = h('select', { id, onchange: (e) => onchange(e.target.value) });
      for (const [v, label] of options) s.appendChild(h('option', { value: v, selected: String(value) === String(v) }, label));
      return s;
    };
    const range = (id, value, min, max, step, onchange) => h('input', { type: 'range', id, min, max, step, value, oninput: (e) => onchange(Number(e.target.value)) });
    const check = (id, value, onchange) => h('input', { type: 'checkbox', id, checked: !!value, onchange: (e) => onchange(e.target.checked) });
    const name = h('input', { type: 'text', id: 's-name', value: save.player.name, maxlength: 18, onchange: (e) => { save = { ...save, player: { ...save.player, name: String(e.target.value).slice(0, 18) || 'You' } }; settings.playerName = save.player.name; persist(); save2(); } });
    return sheet('wide',
      h('h2', { class: 'h', text: 'Settings' }),
      h('h3', { class: 'h', text: 'Player' }),
      field('Name', name, 's-name'),
      field('Golfer', select('s-hand', settings.handedness, [['right', 'Right-handed'], ['left', 'Left-handed']], (v) => { settings.handedness = v; save2(); }), 's-hand'),
      field('Left-handed layout', check('s-lh', settings.leftHandLayout, (v) => { settings.leftHandLayout = v; save2(); }), 's-lh'),
      field('Swing drag length', range('s-stick', settings.stickScale, 0.7, 1.5, 0.05, (v) => { settings.stickScale = v; save2(); }), 's-stick'),
      field('Power guide while swinging', check('s-guide', settings.powerGuide, (v) => { settings.powerGuide = v; save2(); }), 's-guide'),
      field('Aim sensitivity', range('s-aim', settings.aimSensitivity, 0.25, 3, 0.05, (v) => { settings.aimSensitivity = v; save2(); }), 's-aim'),
      field('Units', select('s-units', settings.units, [['yards', 'Yards and feet'], ['meters', 'Meters']], (v) => { settings.units = v; save2(); }), 's-units'),
      h('h3', { class: 'h', text: 'Display' }),
      field('Graphics quality', select('s-tier', settings.tier, [['auto', `Automatic (${app.engine.tier.id})`], ...TIER_ORDER.map((t) => [t, t[0].toUpperCase() + t.slice(1)])], async (v) => { settings.tier = v; app.saveSettings(); await app.setTier(v === 'auto' ? app.autoTier : v); }), 's-tier'),
      field('Color vision', select('s-cb', settings.colorblind, [['off', 'Standard'], ['deuteranopia', 'Deuteranopia'], ['protanopia', 'Protanopia'], ['tritanopia', 'Tritanopia']], (v) => { settings.colorblind = v; save2(); }), 's-cb'),
      field('Reduce motion', check('s-rm', settings.reducedMotion, (v) => { settings.reducedMotion = v; save2(); }), 's-rm'),
      field('Show ball spin', check('s-spin', settings.spinViz, (v) => { settings.spinViz = v; save2(); }), 's-spin'),
      field('Vibration', check('s-hap', settings.haptics, (v) => { settings.haptics = v; save2(); }), 's-hap'),
      h('h3', { class: 'h', text: 'Sound' }),
      field('Master volume', range('s-mv', settings.masterVolume, 0, 1, 0.05, (v) => { settings.masterVolume = v; save2(); }), 's-mv'),
      field('Effects', range('s-sv', settings.sfxVolume, 0, 1, 0.05, (v) => { settings.sfxVolume = v; save2(); }), 's-sv'),
      field('Ambience', range('s-av', settings.ambientVolume, 0, 1, 0.05, (v) => { settings.ambientVolume = v; save2(); }), 's-av'),
      field('Music', check('s-mu', settings.musicEnabled, (v) => { settings.musicEnabled = v; if (v && !settings.musicVolume) settings.musicVolume = 0.4; save2(); }), 's-mu'),
      h('div', { class: 'grid2', style: { marginTop: '14px' } }, btn('Show the tutorial again', () => { settings.tutorialDone = false; app.saveSettings(); ui.hud.toast('The tutorial will show on your next shot', '', 2000); }), back()),
    );
  }));

  // ---------- stats, history, achievements ----------
  screens.register('stats', () => screens.show('stats', () => {
    const s = statsSummary(save.stats);
    const u = settings.units;
    const item = (k, v) => h('div', { class: 'item' }, h('span', { text: k }), h('b', { text: v == null ? '--' : String(v) }));
    const hist = save.history.slice(-12).reverse().map((r) => h('div', { class: 'item' }, h('span', { text: `${courseById(r.courseId).name}, ${r.holes} holes` }), h('span', { text: `${r.strokes} (${fmtToPar(r.toPar)})` })));
    const ach = ACHIEVEMENTS.map((a) => h('div', { class: 'item' }, h('span', {}, h('b', { text: a.name }), h('span', { class: 'muted', text: `  ${a.text}` })), h('span', { class: `badge ${save.achievements[a.id] ? 'on' : ''}`, text: save.achievements[a.id] ? 'Earned' : 'Locked' })));
    return sheet('wide',
      h('h2', { class: 'h', text: 'Stats and history' }),
      h('div', { class: 'list' },
        item('Rounds', s.rounds), item('Scoring per 18 holes', s.scoring == null ? null : fmtToPar(s.scoring)), item('Putts per hole', s.puttsPerHole),
        item('Fairways hit', s.fairwayPct == null ? null : `${s.fairwayPct}%`), item('Greens in regulation', s.girPct == null ? null : `${s.girPct}%`),
        item('Birdies', s.birdies), item('Eagles', s.eagles), item('Holes in one', s.holesInOne), item('Longest drive', s.longestDrive ? fmtDist(s.longestDrive, u) : null)),
      h('h3', { class: 'h', text: 'Recent rounds' }),
      hist.length ? h('div', { class: 'list' }, ...hist) : h('p', { class: 'muted', text: 'No rounds yet.' }),
      h('h3', { class: 'h', text: `Achievements  ${Object.keys(save.achievements).length} of ${ACHIEVEMENTS.length}` }),
      h('div', { class: 'list' }, ...ach),
      h('div', { style: { marginTop: '14px' } }, back()),
    );
  }));

  // ---------- daily challenge ----------
  // Three holes chosen from the date, the same for everyone on that day.
  function dailySetup(now = Date.now()) {
    const key = dayKey(now);
    const rng = createRng(hashString(`daily:${key}`));
    const course = COURSES[rng.int(0, COURSES.length - 1)];
    const start = rng.int(0, 15);
    return { key, courseId: course.id, holes: [start, start + 1, start + 2], tod: rng.pick(['dawn', 'morning', 'midday', 'golden', 'golden', 'dusk']), seed: hashString(`daily-seed:${key}`) };
  }
  app.dailySetup = dailySetup;
  screens.register('daily', () => screens.show('daily', () => {
    const d = dailySetup();
    const best = save.daily[d.key];
    const c = courseById(d.courseId);
    const par = d.holes.reduce((a, i) => a + c.pars[i], 0);
    return sheet('',
      h('h2', { class: 'h', text: 'Daily challenge' }),
      h('p', { class: 'muted', text: `Today: ${c.name}, holes ${d.holes[0] + 1} to ${d.holes[2] + 1} (par ${par}), ${TOD_NAMES[d.tod]}. The same three holes and the same wind for everyone today.` }),
      h('div', { class: 'big', text: best ? `${best.strokes}  (${fmtToPar(best.toPar)})` : 'Not played yet' }),
      h('p', { class: 'muted center', text: best ? `Your best today, ${best.attempts} ${best.attempts === 1 ? 'attempt' : 'attempts'}` : 'Your best score today is kept.' }),
      h('div', { class: 'grid2' }, back(), btn(best ? 'Try again' : 'Play', () => { context = { kind: 'daily', key: d.key }; screens.hide(); game.startRound({ courseId: d.courseId, mode: 'daily', holes: d.holes, tod: d.tod, seed: d.seed, players: [me()] }); }, 'btn primary')),
    );
  }));

  const me = () => ({ id: 'p1', name: save.player.name, kind: 'human', handed: settings.handedness, ball: save.player.ball || '#ffffff' });

  // ---------- pass and play ----------
  const pp = { n: 2, names: ['', 'Player 2', 'Player 3', 'Player 4'], courseId: COURSES[0].id, holes: 9, mode: 'stroke' };
  screens.register('passplay', () => screens.show('passplay', () => {
    pp.names[0] = pp.names[0] || save.player.name;
    const count = h('div', { class: 'seg glass', role: 'group', 'aria-label': 'Players' });
    for (const n of [2, 3, 4]) count.appendChild(h('button', { type: 'button', 'aria-pressed': pp.n === n ? 'true' : 'false', onclick: () => { pp.n = n; screens.registry.passplay(); } }, `${n} players`));
    const names = Array.from({ length: pp.n }, (_, i) => field(`Player ${i + 1}`, h('input', { type: 'text', id: `pp-${i}`, value: pp.names[i], maxlength: 18, oninput: (e) => { pp.names[i] = e.target.value; } }), `pp-${i}`));
    const course = h('select', { id: 'pp-course', onchange: (e) => { pp.courseId = e.target.value; } });
    for (const c of COURSES) course.appendChild(h('option', { value: c.id, selected: c.id === pp.courseId }, c.name));
    const mode = h('select', { id: 'pp-mode', onchange: (e) => { pp.mode = e.target.value; } });
    for (const [v, l] of [['stroke', 'Stroke play'], ['skins', 'Skins'], ['match', 'Match play (2 players)'], ['ctp', 'Closest to the pin']]) mode.appendChild(h('option', { value: v, selected: v === pp.mode }, l));
    const holes = h('select', { id: 'pp-holes', onchange: (e) => { pp.holes = Number(e.target.value); } });
    for (const n of [3, 9, 18]) holes.appendChild(h('option', { value: n, selected: n === pp.holes }, `${n} holes`));
    return sheet('',
      h('h2', { class: 'h', text: 'Pass and play' }),
      h('p', { class: 'muted', text: 'Share one device. The game says whose turn it is before every shot.' }),
      count, h('div', { style: { marginTop: '8px' } }, ...names),
      field('Course', course, 'pp-course'), field('Format', mode, 'pp-mode'), field('Length', holes, 'pp-holes'),
      h('div', { class: 'grid2', style: { marginTop: '12px' } }, back(), btn('Tee off', () => {
        const players = Array.from({ length: pp.mode === 'match' ? 2 : pp.n }, (_, i) => ({ id: `p${i + 1}`, name: (pp.names[i] || `Player ${i + 1}`).trim().slice(0, 18) || `Player ${i + 1}`, kind: 'human', ball: BALLS[i] }));
        const uniq = new Set(); players.forEach((p, i) => { while (uniq.has(p.name)) p.name = `${p.name.slice(0, 15)} ${i + 1}`; uniq.add(p.name); });
        context = null; screens.hide();
        game.startRound({ courseId: pp.courseId, mode: pp.mode, holeCount: pp.holes, tod: 'morning', players, seed: Date.now() >>> 0 });
      }, 'btn primary')),
    );
  }));

  // ---------- real-time play (behind ?online only) ----------
  // A static site has no server to relay live turns, so this build does not offer it. The
  // flag exists so the menu entry and its explanation can be reviewed.
  if (app.params.online) screens.register('online', () => screens.show('online', () => sheet('',
    h('h2', { class: 'h', text: 'Online play' }),
    h('p', { class: 'muted', text: 'Playing live against someone on another device needs a server to pass turns between you, and this version of the game is a static site with no server. It is switched off.' }),
    h('p', { class: 'muted', text: 'You can still play friends two ways: a challenge link (pause, then Share this round), where each of you plays the same holes in the same wind and the scores travel inside the link, or pass and play on one device.' }),
    h('div', { class: 'grid2' }, back(), btn('Pass and play', () => screens.registry.passplay(), 'btn primary')))));

  // ---------- challenge links (async multiplayer) ----------
  async function share(url, title) {
    try { if (navigator.share) { await navigator.share({ title, url }); return 'shared'; } } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(url); return 'copied'; } catch { return 'shown'; }
  }
  screens.register('share', () => {
    const r = game.state.round;
    if (!r) return;
    const ch = context && context.kind === 'challenge' ? toCompact(mergeIntoChallenge(context.challenge, save.player.name, r.scores[0])) : makeChallenge(r);
    const url = challengeUrl(location.origin + location.pathname, ch);
    screens.show('share', () => sheet('',
      h('h2', { class: 'h', text: 'Challenge a friend' }),
      h('p', { class: 'muted', text: 'Send this link. Your friend plays the same holes in the same wind, and can send their scores back the same way. Nothing is uploaded: the scores travel inside the link.' }),
      h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Challenge link', style: { width: '100%', font: 'inherit', fontSize: '12px', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.08)', color: 'inherit', border: '1px solid var(--line)' }, onfocus: (e) => e.target.select() }),
      h('div', { class: 'grid2', style: { marginTop: '12px' } }, back(), btn('Share link', async (e) => { const how = await share(url, 'Fairway Next challenge'); e.target.textContent = how === 'copied' ? 'Copied' : how === 'shared' ? 'Shared' : 'Select and copy the link'; }, 'btn primary')),
    ));
  });
  // Opening a challenge link.
  function openChallenge(res) {
    if (!res) return false;
    if (!res.ok) {
      screens.show('challenge-bad', () => sheet('', h('h2', { class: 'h', text: 'This challenge link will not open' }), h('p', { class: 'muted', text: res.reason }), h('div', {}, btn('Main menu', () => screens.menu(), 'btn primary'))));
      return true;
    }
    const ch = res.challenge;
    const c = courseById(ch.courseId);
    const st = challengeStandings(ch);
    screens.show('challenge', () => sheet('',
      h('h2', { class: 'h', text: 'A challenge' }),
      h('p', { class: 'muted', text: `${c.name}, ${ch.holes.length} holes, ${TOD_NAMES[ch.tod]}. Same pins and wind for everyone.` }),
      h('div', { class: 'list' }, ...st.map((p) => h('div', { class: 'item' }, h('span', { text: p.name }), h('span', { text: p.played ? `${p.total} (${fmtToPar(p.toPar)}) through ${p.played}` : 'not started' })))),
      h('div', { class: 'grid2', style: { marginTop: '12px' } }, btn('Not now', () => screens.menu()), btn('Accept', () => {
        context = { kind: 'challenge', challenge: ch };
        screens.hide();
        // Recorded scores of the others appear in the summary; the local player plays alone.
        game.startRound({ courseId: ch.courseId, mode: 'stroke', holes: ch.holes, tod: ch.tod, seed: ch.seed, players: [me()] });
      }, 'btn primary')),
    ));
    return true;
  }
  app.openChallengeFromHash = () => openChallenge(readChallengeFromHash(location.hash));

  // ---------- career ----------
  screens.register('career', () => (save.career ? careerHub() : careerCreate()));
  function careerCreate() {
    const st = { name: save.player.name, handed: settings.handedness, ball: save.player.ball || '#ffffff' };
    screens.show('career-new', () => {
      const balls = h('div', { class: 'row', role: 'group', 'aria-label': 'Ball color' });
      for (const b of BALLS) balls.appendChild(h('button', { type: 'button', class: 'card', 'aria-pressed': st.ball === b ? 'true' : 'false', 'aria-label': `Ball color ${b}`, style: { width: '48px', minHeight: '48px', background: b, borderRadius: '50%' }, onclick: (e) => { st.ball = b; balls.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === e.currentTarget ? 'true' : 'false')); } }));
      const hand = h('select', { id: 'c-hand', onchange: (e) => { st.handed = e.target.value; } }, h('option', { value: 'right', selected: st.handed === 'right' }, 'Right-handed'), h('option', { value: 'left', selected: st.handed === 'left' }, 'Left-handed'));
      return sheet('',
        h('h2', { class: 'h', text: 'Start a career' }),
        h('p', { class: 'muted', text: 'Play a season of club, regional, and championship events. Finish near the top to move up. Experience buys better attributes and unlocks equipment.' }),
        field('Name', h('input', { type: 'text', id: 'c-name', value: st.name, maxlength: 18, oninput: (e) => { st.name = e.target.value; } }), 'c-name'),
        field('Golfer', hand, 'c-hand'),
        h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Ball' }), balls),
        h('div', { class: 'grid2', style: { marginTop: '12px' } }, back(), btn('Begin', () => {
          const name = (st.name || 'You').trim().slice(0, 18) || 'You';
          save = { ...save, player: { ...save.player, name, handed: st.handed, ball: st.ball }, career: createCareer({ name, handed: st.handed, ball: st.ball, seed: (Date.now() ^ hashString(name)) >>> 0 }) };
          settings.handedness = st.handed; app.saveSettings(); ui.applySettings(); persist();
          careerHub();
        }, 'btn primary')),
      );
    });
  }
  function careerHub() {
    const c = save.career;
    screens.show('career', () => {
      const ev = nextEvent(c);
      const tier = currentTier(c);
      const stand = tierStandings(c);
      const myPlace = stand.rows.findIndex((r) => r.id === 'me') + 1;
      const toNext = xpForLevel(c.level + 1) - c.xp;
      const evCard = ev ? h('div', { class: 'card', style: { marginBottom: '10px' } },
        h('b', { text: `${ev.name}` }), h('span', { text: `${tier.name}. ${courseById(ev.courseId).name}, ${ev.holes} holes, ${TOD_NAMES[ev.tod]}. Field of ${ev.field}.` })) : h('p', { class: 'muted', text: 'Season complete.' });
      const results = c.season.events.filter((e) => e.result).map((e) => h('div', { class: 'item' }, h('span', { text: e.name }), h('span', { text: `${ordinal(e.result.position)} of ${e.result.field}  ${fmtToPar(e.result.toPar)}` })));
      return sheet('wide',
        h('h2', { class: 'h', text: `${c.name}  Level ${c.level}` }),
        h('p', { class: 'muted', text: `Season ${c.season.index + 1}, ${tier.name}. ${stand.rows.some((r) => r.points > 0) ? `${ordinal(myPlace)} in the standings.` : 'No events played yet this season.'} ${c.titles} ${c.titles === 1 ? 'title' : 'titles'}. ${toNext} XP to the next level${c.points ? `, ${c.points} ${c.points === 1 ? 'point' : 'points'} to spend` : ''}.` }),
        evCard,
        h('div', { class: 'grid2' }, btn('Attributes', () => careerAttributes()), btn('Equipment', () => careerEquipment())),
        h('div', { class: 'grid2', style: { marginTop: '10px' } }, btn('Standings and rivals', () => careerStandings()), ev ? btn('Play event', () => playEvent(ev), 'btn primary') : btn('Main menu', () => screens.menu())),
        results.length ? h('h3', { class: 'h', text: 'This season' }) : null,
        results.length ? h('div', { class: 'list' }, ...results) : null,
        h('div', { style: { marginTop: '12px' } }, btn('Main menu', () => screens.menu())),
      );
    });
  }
  function careerAttributes() {
    screens.show('career-attr', () => {
      const c = save.career;
      const rows = ATTRIBUTES.map((k) => h('div', { class: 'field' },
        h('span', { class: 'lab' }, h('b', { text: ATTRIBUTE_INFO[k].name }), h('span', { class: 'muted', text: `  ${ATTRIBUTE_INFO[k].text}` })),
        h('span', { class: 'row' }, h('b', { text: String(c.attributes[k]) }), h('button', { class: 'btn small', type: 'button', disabled: c.points <= 0, 'aria-label': `Raise ${ATTRIBUTE_INFO[k].name}`, onclick: () => { save = { ...save, career: spendPoint(save.career, k) }; persist(); careerAttributes(); } }, '+2'))));
      return sheet('', h('h2', { class: 'h', text: 'Attributes' }), h('p', { class: 'muted', text: `${c.points} ${c.points === 1 ? 'point' : 'points'} to spend. You earn three each level.` }), ...rows, h('div', { style: { marginTop: '12px' } }, btn('Done', () => careerHub(), 'btn primary')));
    });
  }
  function careerEquipment() {
    screens.show('career-eq', () => {
      const c = save.career;
      const blocks = Object.entries(EQUIPMENT).map(([slot, items]) => h('div', {},
        h('h3', { class: 'h', text: slot[0].toUpperCase() + slot.slice(1) }),
        h('div', { class: 'cards' }, ...items.map((it) => {
          const open = unlocked(c, slot, it.id);
          return h('button', { class: 'card', type: 'button', disabled: !open, 'aria-pressed': c.equipment[slot] === it.id ? 'true' : 'false', onclick: () => { save = { ...save, career: equip(save.career, slot, it.id) }; persist(); careerEquipment(); } },
            h('b', { text: it.name }), h('span', { text: open ? it.text : `Unlocks at level ${UNLOCK_LEVEL[it.id]}` }));
        }))));
      return sheet('wide', h('h2', { class: 'h', text: 'Equipment' }), h('p', { class: 'muted', text: 'Every choice gives something and costs something.' }), ...blocks, h('div', { style: { marginTop: '12px' } }, btn('Done', () => careerHub(), 'btn primary')));
    });
  }
  function careerStandings() {
    screens.show('career-st', () => {
      const c = save.career;
      const st = tierStandings(c);
      const rivals = new Map(c.rivals.map((r) => [r.id, r]));
      const rows = st.rows.map((r, i) => {
        const rv = rivals.get(r.id);
        return h('div', { class: 'item' }, h('span', { text: `${i + 1}. ${r.name}${r.id === 'me' ? ' (you)' : ''}` }), h('span', { text: `${r.points} pts${rv ? `  form ${rv.form > 0.2 ? 'hot' : rv.form < -0.2 ? 'cold' : 'steady'}${rv.wins ? `, ${rv.wins} ${rv.wins === 1 ? 'win' : 'wins'}` : ''}` : ''}` }));
      });
      return sheet('wide', h('h2', { class: 'h', text: `${currentTier(c).name} standings` }), h('p', { class: 'muted', text: `Top ${currentTier(c).qualify} (or any event winner) move up when the tier is done.` }), h('div', { class: 'list' }, ...rows), h('div', { style: { marginTop: '12px' } }, btn('Back', () => careerHub())));
    });
  }
  function playEvent(ev) {
    const c = save.career;
    // The rival with the closest ranking plays alongside you on screen; the rest of the field
    // is simulated from their skill.
    const partner = c.rivals[Math.min(c.rivals.length - 1, Math.max(0, Math.floor(c.rivals.length / 2) - (c.season.tier - 1) * 2))];
    context = { kind: 'career', eventId: ev.id, partnerId: partner.id };
    screens.hide();
    const holes = Array.from({ length: ev.holes }, (_, i) => ev.startHole - 1 + i);
    game.startRound({ courseId: ev.courseId, mode: 'stroke', holes, tod: ev.tod, seed: (c.seed ^ hashString(ev.id)) >>> 0, eventId: ev.id, profile: profileFor(c), players: [{ ...me(), handed: c.handed, ball: c.ball }, { id: partner.id, name: partner.name, kind: 'ai', skill: partner.skill, ball: '#ffd23f' }] });
  }

  // ---------- resume ----------
  app.resumeAvailable = () => !!save.inProgress;
  app.resume = () => {
    if (!save.inProgress) return;
    const r = save.inProgress;
    context = r.eventId && save.career ? { kind: 'career', eventId: r.eventId, partnerId: r.players[1] && r.players[1].id } : null;
    screens.hide();
    game.resumeRound(r, { profile: context && save.career ? profileFor(save.career) : undefined });
  };

  // ---------- recording results ----------
  game.on((type, d) => {
    // A round started from somewhere else (quick round, range) clears the menu context.
    if (type === 'roundStart' && context) {
      const r = d;
      const keep = (context.kind === 'career' && r.eventId === context.eventId) || (context.kind === 'daily' && r.mode === 'daily') || (context.kind === 'challenge' && r.seed === context.challenge.seed && r.courseId === context.challenge.courseId);
      if (!keep) context = null;
    }
    if (type === 'holeEnd') {
      const r = game.state.round;
      // Keep a resumable copy after every hole (without the per-hole state, which is null now).
      if (!d.over && r.mode !== 'range') { save = { ...save, inProgress: JSON.parse(JSON.stringify(r)) }; persist(); }
    }
    if (type === 'quit') { save = { ...save, inProgress: null }; persist(); context = null; }
  });
  screens.onRoundEnd = (r) => {
    const now = Date.now();
    let unlockedIds = [];
    const rec = recordRound({ ...save, inProgress: null }, r, { now });
    save = rec.save; unlockedIds = rec.unlocked;
    const scores = r.scores[0].filter(Number.isFinite);
    const course = courseById(r.courseId);
    const toPar = scores.reduce((a, s, i) => a + s - course.pars[r.holes[i]], 0);
    if (context && context.kind === 'daily') save = recordDaily(save, context.key, { strokes: scores.reduce((a, b) => a + b, 0), toPar }, now);
    if (context && context.kind === 'career' && save.career) {
      const rivalScores = {};
      r.players.forEach((p, i) => { if (p.kind === 'ai') rivalScores[p.id] = r.scores[i]; });
      const before = save.career;
      const out = completeEvent(before, context.eventId, { playerScores: r.scores[0], rivalScores, date: now });
      if (out.result) {
        save = { ...save, career: out.career };
        if (out.result.position === 1) { const u = unlock(save, ['career-win'], now); save = u.save; unlockedIds = unlockedIds.concat(u.unlocked); }
        if (out.career.season.tier >= 3) { const u = unlock(save, ['tour-card'], now); save = u.save; unlockedIds = unlockedIds.concat(u.unlocked); }
        screens.lastEvent = { ...out.result, levelUp: out.career.level > before.level, tierUp: out.career.season.tier > before.season.tier };
      }
    }
    if (context && context.kind === 'challenge') screens.lastChallenge = mergeIntoChallenge(context.challenge, save.player.name, r.scores[0]);
    persist();
    toastUnlocks(unlockedIds);
  };
  // Extra lines on the round-end screen for the context the round was played in.
  screens.roundEndExtra = () => {
    if (context && context.kind === 'career' && screens.lastEvent) {
      const e = screens.lastEvent;
      const rows = e.board.slice(0, 5).map((b) => h('div', { class: 'item' }, h('span', { text: `${b.position}. ${b.name}` }), h('span', { text: `${b.total} (${fmtToPar(b.toPar)})` })));
      return h('div', {}, h('h3', { class: 'h', text: `${e.event.name}: you finished ${ordinal(e.position)} of ${e.board.length}` }), h('div', { class: 'list' }, ...rows),
        h('p', { class: 'muted', text: `${e.xp} XP earned.${e.levelUp ? ' Level up: you have attribute points to spend.' : ''}${e.tierUp ? ' You qualified for the next tier.' : ''}` }),
        h('div', { style: { marginTop: '8px' } }, btn('Career', () => { context = null; screens.hide(); game.quit(); careerHub(); })));
    }
    if (context && context.kind === 'daily') {
      const best = save.daily[context.key];
      return best ? h('p', { class: 'muted center', text: `Daily best today: ${best.strokes} (${fmtToPar(best.toPar)}), ${best.attempts} ${best.attempts === 1 ? 'attempt' : 'attempts'}.` }) : null;
    }
    if (context && context.kind === 'challenge' && screens.lastChallenge) {
      const st = challengeStandings(screens.lastChallenge);
      const url = challengeUrl(location.origin + location.pathname, toCompact(screens.lastChallenge));
      return h('div', {}, h('h3', { class: 'h', text: 'Challenge standings' }), h('div', { class: 'list' }, ...st.map((p) => h('div', { class: 'item' }, h('span', { text: p.name }), h('span', { text: `${p.total} (${fmtToPar(p.toPar)})` })))),
        h('div', { style: { marginTop: '8px' } }, btn('Send your scores back', async (ev) => { const how = await share(url, 'Fairway Next challenge'); ev.target.textContent = how === 'copied' ? 'Link copied' : how === 'shared' ? 'Shared' : url; })));
    }
    return null;
  };
  app.menuContext = () => context;
  return { simulateRivalRound };
}
