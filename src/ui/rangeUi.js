// The practice ground: the lobby (drill, bay, mat or grass, bucket, light), the in-session
// readout and drill line, the dispersion map with the group ellipse and per-club averages,
// and the session summary with medal, XP and any gear token.
import { h } from './dom.js';
import { fmtDist } from './format.js';
import { YARD } from '../core/math.js';
import { CLUB_SPECS } from '../physics/clubs.js';
import { TARGETS, RANGE_YARDS } from '../course/range.js';
import {
  MODES, MODE_IDS, MEDALS, createSession, addShot, currentTarget, currentShape, ballsLeft, dispersion, clubAverages,
  sessionResult, recordSession,
} from '../game/range.js';
import { addTokens } from '../game/rewards.js';
import { TIERS as TIER_IDS, TIER_INFO } from '../game/gear.js';
import { dayKey } from '../game/save.js';

const TIER_NAMES = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
const MEDAL_NAMES = { none: 'No medal', bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const CLUB_COLORS = ['#ffd166', '#6fb6ff', '#7fd69a', '#ff8a6a', '#c08bff', '#f2f2ee', '#5ad1c8', '#ffb37a', '#9fb4ff', '#e8e27a', '#ff9ed1', '#b8e07a', '#d0d0d0'];
const shortOf = (id) => (CLUB_SPECS.find((c) => c.id === id) || {}).short || id;

export function installRange(app, ui) {
  const { screens } = ui;
  const game = app.game;
  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const btn = (label, onclick, cls = 'btn', extra = {}) => h('button', { class: cls, type: 'button', onclick, ...extra }, label);
  const back = () => btn('Back', () => screens.back());
  const opts = { mode: 'free', bay: 2, surface: 'mat', bucket: 50, tod: 'morning', testClub: 'I7', testTier: 'legendary', streakTarget: 125 };
  let session = null, lastResult = null;
  const u = () => app.settings.units;

  const seg = (label, cur, list, onPick) => h('div', { class: 'field' }, h('label', { text: label }),
    h('div', { class: 'seg', role: 'group', 'aria-label': label }, ...list.map(([id, name]) => h('button', { type: 'button', 'aria-pressed': cur === id ? 'true' : 'false', onclick: () => onPick(id) }, name))));

  // ---------- lobby ----------
  function lobby() {
    screens.show('range', () => {
      const r = app.save().range || {};
      const cards = h('div', { class: 'drills' }, ...MODE_IDS.map((id) => {
        const m = MODES[id], medal = (r.medals || {})[id], best = (r.best || {})[id];
        return h('button', { class: `card drill${medal ? ` m-${medal}` : ''}`, type: 'button', 'aria-pressed': opts.mode === id ? 'true' : 'false', onclick: () => { opts.mode = id; lobby(); } },
          h('b', { text: m.name }),
          h('span', { class: 'muted small', text: m.text }),
          id !== 'free' ? h('span', { class: 'small', text: `${medal ? `${MEDAL_NAMES[medal]}. ` : ''}${best ? `Best ${best}${id === 'longdrive' ? ' yd' : ''}` : 'Not played yet'}` }) : null);
      }));
      const m = MEDALS[opts.mode];
      return sheet('wide range',
        h('h2', { class: 'h', text: 'Practice ground' }),
        h('p', { class: 'muted small', text: `Five bays, target greens at ${TARGETS.map((t) => t.yards).join(', ')} yards, signs every 25 yards.` }),
        cards,
        m ? h('p', { class: 'muted small', text: `Medals: bronze ${m.bronze}, silver ${m.silver}, gold ${m.gold}. Gold also earns a gear token, once a day per drill.` }) : null,
        opts.mode === 'test' ? testPickers() : null,
        opts.mode === 'streak' ? seg('Target green', String(opts.streakTarget), TARGETS.map((t) => [String(t.yards), `${t.yards}`]), (id) => { opts.streakTarget = Number(id); lobby(); }) : null,
        seg('Bay', String(opts.bay), [0, 1, 2, 3, 4].map((i) => [String(i), String(i + 1)]), (id) => { opts.bay = Number(id); lobby(); }),
        seg('Hit from', opts.surface, [['mat', 'Mat'], ['grass', 'Grass']], (id) => { opts.surface = id; lobby(); }),
        opts.mode === 'free' ? seg('Balls', String(opts.bucket), [['50', '50-ball bucket'], ['0', 'Unlimited']], (id) => { opts.bucket = Number(id); lobby(); }) : null,
        seg('Light', opts.tod, [['morning', 'Morning'], ['golden', 'Golden'], ['dusk', 'Evening lights']], (id) => { opts.tod = id; lobby(); }),
        h('div', { class: 'grid2', style: { marginTop: '12px' } }, back(), btn('Start', () => start(), 'btn primary')));
    });
  }

  // The test lane: which club, and which tier to compare with the one in the bag.
  function testPickers() {
    const inBag = app.gearFor ? app.gearFor(opts.testClub).rarity : 'common';
    if (opts.testTier === inBag) opts.testTier = TIER_IDS.find((x) => x !== inBag);
    const clubSel = h('select', { id: 'r-club', 'aria-label': 'Club to test', onchange: (e) => { opts.testClub = e.target.value; lobby(); } },
      ...CLUB_SPECS.filter((c) => !c.putter).map((c) => h('option', { value: c.id, selected: c.id === opts.testClub ? true : null, text: c.name })));
    return h('div', {},
      h('div', { class: 'field' }, h('label', { for: 'r-club', text: 'Club' }), clubSel),
      seg(`Compare your ${TIER_NAMES[inBag]} with`, opts.testTier, TIER_IDS.filter((x) => x !== inBag).map((x) => [x, TIER_NAMES[x]]), (id) => { opts.testTier = id; lobby(); }),
      h('p', { class: 'muted small', text: 'The second club is only simulated here, to compare. It is not added to your gear.' }));
  }

  async function start() {
    screens.hide();
    if (opts.mode === 'longdrive') opts.surface = 'mat'; // the driver is hit from a mat tee
    session = createSession({ mode: opts.mode, bucket: opts.mode === 'free' && opts.bucket === 0 ? null : 50, bay: opts.bay, surface: opts.surface, target: opts.streakTarget, now: Date.now() });
    lastResult = null; lastAsked = null;
    const compare = opts.mode === 'test' ? { clubId: opts.testClub, rarity: opts.testTier } : null;
    await game.startRange({ bay: opts.bay, surface: opts.surface, tod: opts.tod, club: MODES[opts.mode].club || null, compare, profile: app.golferProfile ? app.golferProfile() : null, players: [{ kind: 'human', name: app.save().player.name, ball: app.save().player.ball }] });
    pointAtTarget();
  }
  // Point the game at the drill's target (or let the game pick by club in free practice).
  let lastAsked = null;
  function pointAtTarget() {
    const y = session && currentTarget(session);
    const changed = y !== lastAsked;
    lastAsked = y;
    if (y && (session.mode === 'target' || session.mode === 'streak')) game.setRangeTarget(y, null, { suggest: changed });
    else if (y && session.mode === 'ladder') game.setRangeTarget(null, y, { suggest: changed });
  }

  // A shot finished on the range.
  game.on((type, data) => {
    if (type !== 'rangeShot' || !session) return;
    const t = data.target;
    const rec = {
      club: data.club, carry: data.carry / YARD, total: data.total / YARD, offline: data.offline / YARD, curve: data.curve / YARD,
      ballSpeed: data.ballSpeed, launch: data.launch, spin: data.spin, apex: data.apex / YARD, strike: data.strike, lefty: data.lefty,
      land: data.land, rest: data.rest, target: t ? { yards: t.yards, x: t.x, z: t.z, r: t.radius } : null,
      rarity: data.rarity, compare: data.compare ? { ...data.compare, carry: data.compare.carry / YARD, total: data.compare.total / YARD, offline: data.compare.offline / YARD } : null,
    };
    const r = addShot(session, rec);
    session = r.session;
    data.drill = { message: r.message, points: r.points, mode: session.mode };
    const tname = t ? `${t.name} green, ${t.yards} yd` : '';
    ui.hud.shotCard({ outcome: { carry: data.carry, total: data.total, offline: data.offline, strike: data.strike }, message: data.holed ? 'In the cup!' : tname, range: data, drill: data.drill });
    if (data.holed && ui.hud.toast) ui.hud.toast('In the cup!', 'Straight in on the range', 2400);
    if (session.over) setTimeout(() => finish(), 1600);
    else pointAtTarget();
  });

  // What the HUD shows in the top right during a session.
  app.rangeHud = () => {
    if (!session) return null;
    const left = ballsLeft(session);
    const m = MODES[session.mode];
    const y = currentTarget(session), shape = currentShape(session);
    let sn = '', ss = '';
    if (session.mode === 'target') { sn = String(session.score); ss = `points. Next ${y} yd`; }
    else if (session.mode === 'longdrive') { sn = session.score ? fmtDist(session.score * YARD, u()) : '-'; ss = 'best in the grid'; }
    else if (session.mode === 'ladder') { sn = `${session.step}/6`; ss = session.step < 6 ? `Carry ${y} yd` : 'Complete'; }
    else if (session.mode === 'shape') { sn = `${session.score}`; ss = `Hit a ${shape}`; }
    else if (session.mode === 'streak') { sn = `${session.streak}`; ss = `in a row at ${y} yd`; }
    else { sn = `${session.used}`; ss = 'balls hit'; }
    return { k: 'Range', n: left == null ? 'Unlimited' : `${left}`, s: left == null ? m.name : `${m.name}: balls left`, sn, ss };
  };
  app.rangeSession = () => session;
  app.endRangeSession = () => finish();

  // ---------- dispersion map ----------
  function drawMap(canvas, shots, focusClub) {
    const W = canvas.width, Hh = canvas.height, g = canvas.getContext('2d');
    const maxY = RANGE_YARDS * 0.9, halfX = 60;
    const sx = (x) => W / 2 + (x / halfX) * (W / 2) * 0.95, sy = (y) => Hh - 14 - (y / maxY) * (Hh - 28);
    g.fillStyle = '#183424'; g.fillRect(0, 0, W, Hh);
    // Mown stripes and distance lines every 50 yards.
    for (let y = 0; y < maxY; y += 25) { g.fillStyle = (y / 25) % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)'; g.fillRect(0, sy(y + 25), W, sy(y) - sy(y + 25)); }
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1; g.font = '11px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.6)';
    for (let y = 50; y < maxY; y += 50) { g.beginPath(); g.moveTo(0, sy(y)); g.lineTo(W, sy(y)); g.stroke(); g.fillText(String(y), 4, sy(y) - 3); }
    g.beginPath(); g.moveTo(sx(0), sy(0)); g.lineTo(sx(0), sy(maxY)); g.setLineDash([4, 6]); g.stroke(); g.setLineDash([]);
    for (const t of TARGETS) { g.fillStyle = 'rgba(160, 220, 140, 0.35)'; g.beginPath(); g.arc(sx(t.x / YARD), sy(t.yards), (t.r / YARD / halfX) * (W / 2) * 0.95, 0, Math.PI * 2); g.fill(); g.fillStyle = t.color; g.fillRect(sx(t.x / YARD) - 1, sy(t.yards) - 7, 2, 7); }
    const clubs = [...new Set(shots.map((s) => s.club))];
    const colorOf = (c) => CLUB_COLORS[clubs.indexOf(c) % CLUB_COLORS.length];
    const pts = (c) => shots.filter((s) => s.club === c).map((s) => ({ x: s.land.x / YARD, y: -s.land.z / YARD }));
    for (const c of clubs) {
      const e = dispersion(pts(c));
      if (e && (!focusClub || focusClub === c)) {
        g.save(); g.translate(sx(e.x), sy(e.y));
        // Canvas y runs down while yards run up, so the angle flips.
        g.rotate(-e.angle);
        g.scale((W / 2) * 0.95 / halfX, (Hh - 28) / maxY);
        g.beginPath(); g.ellipse(0, 0, e.a, e.b, 0, 0, Math.PI * 2); g.restore();
        g.strokeStyle = colorOf(c); g.lineWidth = 2; g.stroke();
      }
    }
    for (const s of shots) {
      if (focusClub && s.club !== focusClub) continue;
      g.fillStyle = colorOf(s.club); g.beginPath(); g.arc(sx(s.land.x / YARD), sy(-s.land.z / YARD), 3.2, 0, Math.PI * 2); g.fill();
      // The test lane's second club: a ring where the same swing would have landed.
      if (s.compare) { g.strokeStyle = TIER_INFO[s.compare.rarity] ? TIER_INFO[s.compare.rarity].color : '#fff'; g.lineWidth = 1.6; g.beginPath(); g.arc(sx(s.compare.land.x / YARD), sy(-s.compare.land.z / YARD), 4, 0, Math.PI * 2); g.stroke(); }
    }
    return clubs.map((c) => ({ club: c, color: colorOf(c) }));
  }

  function averagesTable(shots) {
    const av = clubAverages(shots).sort((a, b) => CLUB_SPECS.findIndex((c) => c.id === a.club) - CLUB_SPECS.findIndex((c) => c.id === b.club));
    if (!av.length) return h('p', { class: 'muted', text: 'No shots yet.' });
    return h('table', { class: 'avg' },
      h('thead', {}, h('tr', {}, ...['Club', 'Balls', 'Carry', 'Total', 'Offline', 'Pured'].map((t) => h('th', { text: t })))),
      h('tbody', {}, ...av.map((a) => h('tr', {},
        h('td', { text: shortOf(a.club) }), h('td', { text: String(a.n) }), h('td', { text: fmtDist(a.carry * YARD, u()) }), h('td', { text: fmtDist(a.total * YARD, u()) }),
        h('td', { text: `${fmtDist(a.absOffline * YARD, u())}` }), h('td', { text: `${a.pured}/${a.n}` })))));
  }

  let focus = null;
  function mapScreen() {
    screens.show('range-map', () => {
      const shots = session ? session.shots : [];
      const canvas = h('canvas', { class: 'dispmap', width: 340, height: 420, role: 'img', 'aria-label': `Where ${shots.length} shots landed, with the group ellipse per club` });
      const legend = drawMap(canvas, shots, focus);
      return sheet('range',
        h('h2', { class: 'h', text: 'Dispersion' }),
        canvas,
        h('div', { class: 'seg legend', role: 'group', 'aria-label': 'Club' },
          h('button', { type: 'button', 'aria-pressed': focus ? 'false' : 'true', onclick: () => { focus = null; mapScreen(); } }, 'All'),
          ...legend.map((l) => h('button', { type: 'button', 'aria-pressed': focus === l.club ? 'true' : 'false', onclick: () => { focus = l.club; mapScreen(); } }, h('i', { class: 'dot', style: { background: l.color } }), shortOf(l.club)))),
        h('p', { class: 'muted small', text: 'Each dot is where a ball landed. The ring holds about two thirds of the shots with that club.' }),
        averagesTable(shots),
        h('div', { class: 'grid2', style: { marginTop: '12px' } }, btn('Keep hitting', () => screens.hide(), 'btn primary'), btn('End session', () => finish())));
    });
  }
  app.rangeMap = mapScreen;

  // ---------- summary ----------
  function finish() {
    if (!session) return;
    const s = session;
    if (!lastResult) {
      const dk = dayKey(Date.now());
      const save = app.save();
      const res = sessionResult(s, { dayKey: dk, goldToday: (save.range || {}).goldDay || {} });
      lastResult = res;
      app.updateSave((x) => {
        let n = { ...x, range: recordSession(x.range, s, res, dk) };
        if (res.tokens) n = addTokens(n, res.tokens);
        return n;
      }, 'range');
      if (app.addXp) app.addXp(res.xp, `${MODES[s.mode].name}`);
      if (s.mode === 'target' && app.postScore) app.postScore('target', s.score);
      if (s.mode === 'longdrive' && s.score && app.postScore) app.postScore('longdrive', s.score);
    }
    const res = lastResult;
    screens.show('range-summary', () => {
      const canvas = h('canvas', { class: 'dispmap', width: 340, height: 300, role: 'img', 'aria-label': 'Where the session\'s shots landed' });
      drawMap(canvas, s.shots, null);
      return sheet('range',
        h('h2', { class: 'h', text: `${MODES[s.mode].name}: session summary` }),
        MEDALS[s.mode] ? h('p', { class: `medal m-${res.medal}`, text: `${MEDAL_NAMES[res.medal]}. Score ${s.score}${s.mode === 'longdrive' ? ' yd' : ''}.` }) : h('p', { text: `${s.used} balls hit.` }),
        h('p', { class: 'muted', text: `${res.xp} XP${res.tokens ? ', and a gear token for the gold' : ''}.` }),
        app.pendingLevelUp ? btn(`Level ${app.pendingLevelUp.to}! See what is new`, () => { const l = app.pendingLevelUp; app.pendingLevelUp = null; app.showLevelUp(l.from, l.to); }, 'btn primary') : null,
        canvas,
        averagesTable(s.shots),
        h('div', { class: 'grid2', style: { marginTop: '12px' } },
          btn('Again', () => { start(); }, 'btn primary'),
          btn('Range menu', () => { session = null; game.quit(); lobby(); })),
        h('div', { class: 'stack', style: { marginTop: '10px' } }, btn('Main menu', () => { session = null; game.quit(); screens.menu(); })));
    });
  }

  screens.register('range', lobby);
  app.openRange = lobby;
  // Leaving the round from the pause menu ends the session without a summary.
  game.on((type) => { if (type === 'quit') { session = null; } });
}
