// The in-round HUD, phone portrait first.
//   top left    three tabs flush to the edge: lie (live power during a swing), distance to the
//               pin with the elevation adjustment, wind relative to the shot with the time of day
//   top right   hole, par and yardage beside the score box, a position badge, the map button
//   right side  hold to look around the course
//   bottom      settings, previous club, the club button (letter and carry), next club, aim reset
//   center      the swing zone between the ball and the bottom row (nothing else goes there)
// Landscape moves the same pieces to the edges. Everything is read from game.view() each frame
// and a node is only touched when its value changes.
import { h, iconButton, icon } from './dom.js';
import { fmtDist, fmtShort, fmtBreak, fmtToPar, fmtMph, ordinal } from './format.js';
import { createSwingZone } from './swingZone.js';
import { createShotPanel } from './spinPad.js';
import { DEG, clamp, YARD } from '../core/math.js';
import { STRIKE_NAMES } from '../game/strike.js';

const TOD_ICON = { dawn: 'sunlow', morning: 'sun', midday: 'sun', golden: 'sunlow', dusk: 'sunlow', night: 'moon' };

// Elevation adjustment in brackets, in the unit of the main number: yards (or meters) for full
// shots, inches (or centimeters) on the green. Uphill plays longer, so it reads "+".
export function fmtAdjust(elevM, units, putt) {
  if (!Number.isFinite(elevM)) return '';
  if (putt) {
    const v = units === 'meters' ? Math.round(elevM * 100) : Math.round(elevM / 0.0254);
    return v === 0 ? '(level)' : `(${v > 0 ? '+' : '-'}${Math.abs(v)} ${units === 'meters' ? 'cm' : 'in'})`;
  }
  const v = units === 'meters' ? Math.round(elevM) : Math.round(elevM / YARD);
  return v === 0 ? '(level)' : `(${v > 0 ? '+' : '-'}${Math.abs(v)})`;
}

// Position badge text: a rank among players in stroke play, the match state, or how many holes
// are done ("Thru 3") for a solo round.
export function positionText(v, round) {
  if (!round) return '';
  const totals = v.totals || [];
  const thru = v.thru ?? 0;
  if (v.mode === 'match' || v.mode === 'skins' || v.mode === 'ctp') return v.standingsText || '';
  if (totals.length > 1) {
    const me = totals[v.turn] ? totals[v.turn].toPar : 0;
    const better = totals.filter((t) => t.toPar < me).length, same = totals.filter((t) => t.toPar === me).length;
    return `${same > 1 ? 'T' : ''}${ordinal(better + 1)}  Thru ${thru}`;
  }
  return thru ? `Thru ${thru}` : 'Hole 1 of ' + (v.holes || 1);
}

export function createHud(root, { game, settings, haptic, actions, getWorld }) {
  const el = h('div', { class: 'hud off', 'aria-hidden': 'true' });
  root.appendChild(el);
  const cache = new Map();
  const set = (node, key, value, prop = 'textContent') => {
    const k = key + prop;
    if (cache.get(k) === value) return;
    cache.set(k, value);
    if (prop === 'textContent') node.textContent = value; else node.style[prop] = value;
  };
  const swapIcon = (holder, key, name) => {
    if (cache.get(key) === name) return;
    cache.set(key, name);
    holder.textContent = '';
    holder.appendChild(icon(name));
  };

  // --- top left: three tabs ---
  const lieIco = h('span', { class: 'ico' }, icon('lie')), lieV = h('span', { class: 'v' });
  const tabLie = h('div', { class: 'tab', role: 'status', 'aria-label': 'Lie' }, lieIco, lieV);
  const distV = h('span', { class: 'v' }), distA = h('span', { class: 'adj' });
  const tabDist = h('div', { class: 'tab', 'aria-label': 'Distance to the pin' }, h('span', { class: 'ico' }, icon('flag')), distV, distA);
  const windArrow = h('span', { class: 'ico warrow' }, icon('wind'));
  const windV = h('span', { class: 'v' }), todIco = h('span', { class: 'tod' });
  const tabWind = h('div', { class: 'tab', role: 'img' }, windArrow, windV, todIco);
  const hazard = h('div', { class: 'chip glass warn hidden', role: 'status' });
  const puttinfo = h('div', { class: 'chip glass hidden', 'aria-live': 'polite' });
  const streakChip = h('div', { class: 'chip glass streak hidden', role: 'status', 'aria-live': 'polite' });
  const tabs = h('div', { class: 'tabs' }, tabLie, tabDist, tabWind, hazard, puttinfo, streakChip);
  el.appendChild(tabs);

  // --- top right: hole and score, position, map ---
  const holeN = h('div', { class: 'n' }), holeK = h('div', { class: 'k', text: 'Hole' }), holeS = h('div', { class: 's' });
  const scoreN = h('div', { class: 'n' }), scoreS = h('div', { class: 's' });
  const holebox = h('div', { class: 'holebox glass', role: 'group', 'aria-label': 'Hole' }, holeK, holeN, holeS);
  const scorebox = h('div', { class: 'scorebox glass', role: 'group', 'aria-label': 'Score' }, scoreN, scoreS);
  const badge = h('div', { class: 'posbadge glass' });
  const mapBtn = iconButton('map', 'Hole map and rangefinder', () => actions.map(), 'roundbtn glass');
  mapBtn.title = 'Hole map and rangefinder (M)';
  const replayBtn = iconButton('replay', 'Replay the last shot', () => actions.replay(), 'roundbtn glass');
  replayBtn.title = 'Replay the last shot (Z)';
  // Fullscreen (desktop only; the phone layout has no room and phones go fullscreen on their own).
  const fsBtn = iconButton('expand', 'Fullscreen (F)', () => actions.fullscreen && actions.fullscreen(), 'roundbtn glass fsbtn');
  const syncFs = () => { const on = !!(document.fullscreenElement || document.webkitFullscreenElement); fsBtn.textContent = ''; fsBtn.appendChild(icon(on ? 'shrink' : 'expand')); fsBtn.setAttribute('aria-label', on ? 'Leave fullscreen (F)' : 'Fullscreen (F)'); fsBtn.title = fsBtn.getAttribute('aria-label'); fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) fsBtn.classList.add('nofs');
  const tr = h('div', { class: 'topright' }, h('div', { class: 'trrow' }, holebox, scorebox), badge, mapBtn, replayBtn, fsBtn);
  el.appendChild(tr);

  // --- right side: hold to look around ---
  const lookBtn = iconButton('look', 'Look around. Hold to pan over the course', () => {}, 'roundbtn glass lookbtn');
  lookBtn.title = 'Look around: hold (C toggles)';
  let lookHeld = false;
  const lookEnd = () => { if (lookHeld) { lookHeld = false; actions.lookHold(false); } };
  lookBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { lookBtn.setPointerCapture(e.pointerId); } catch { /* fine */ } lookHeld = true; actions.lookHold(true); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) lookBtn.addEventListener(ev, lookEnd);
  lookBtn.addEventListener('keydown', (e) => { if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); e.stopPropagation(); actions.lookHold(!lookHeld); lookHeld = !lookHeld; } });
  el.appendChild(lookBtn);

  // --- bottom row ---
  const settingsBtn = iconButton('gear', 'Settings and pause', () => actions.pause(), 'roundbtn glass b-settings');
  settingsBtn.title = 'Settings and pause (Esc)';
  const arrowL = h('button', { class: 'arrow glass', type: 'button' }, icon('left'));
  const arrowR = h('button', { class: 'arrow glass', type: 'button' }, icon('right'));
  const clubL = h('span', { class: 'cl' }), clubC = h('span', { class: 'cc' });
  const clubBtn = h('button', { class: 'clubbtn', type: 'button', 'aria-haspopup': 'dialog', title: 'Choose a club (B). W and S change it' }, clubL, clubC);
  const resetBtn = iconButton('aim', 'Aim back at the target', () => actions.resetAim(), 'roundbtn glass b-reset');
  resetBtn.title = 'Aim back at the target (R)';
  const clubgroup = h('div', { class: 'clubgroup' }, arrowL, clubBtn, arrowR);
  const bottombar = h('div', { class: 'bottombar' }, settingsBtn, clubgroup, resetBtn);
  el.appendChild(bottombar);
  // The shot panel: the ball-contact dot and the shot type, from a small button beside the
  // bottom row (ui/spinPad.js). While it is open the swing zone rests.
  let panelOpen = false;
  const shotPanel = createShotPanel(el, { game, settings, haptic, onOpen: (on) => { panelOpen = on; if (on && !clubList.classList.contains('hidden')) toggleClubList(false); } });

  // The arrows are mirrored with the layout: the outer arrow on the settings side is always
  // "longer club", so a left-handed layout reads as a true mirror image.
  const longer = () => game.selectClub(-1), shorter = () => game.selectClub(1);
  arrowL.addEventListener('click', () => (settings.leftHandLayout ? shorter() : longer()));
  arrowR.addEventListener('click', () => (settings.leftHandLayout ? longer() : shorter()));
  // Swipe across the club button changes club; a tap opens the club list.
  let swipeX = null, swiped = false;
  clubBtn.addEventListener('pointerdown', (e) => { swipeX = e.clientX; swiped = false; });
  clubBtn.addEventListener('pointerup', (e) => { if (swipeX != null && Math.abs(e.clientX - swipeX) > 30) { swiped = true; game.selectClub(e.clientX < swipeX ? 1 : -1); } swipeX = null; });
  clubBtn.addEventListener('click', () => { if (swiped) { swiped = false; return; } toggleClubList(); });

  // --- club list: every club the lie allows with its carry, plus the shot type ---
  const clubList = h('div', { class: 'clublist glass hidden', role: 'dialog', 'aria-label': 'Choose a club' });
  el.appendChild(clubList);
  function toggleClubList(force) {
    const open = force ?? clubList.classList.contains('hidden');
    if (open && game.state.phase !== 'aim') return;
    clubList.classList.toggle('hidden', !open);
    if (open) buildClubList();
  }
  function buildClubList() {
    clubList.textContent = '';
    const u = settings.units;
    const grid = h('div', { class: 'cgrid' });
    for (const c of game.clubChoices()) {
      grid.appendChild(h('button', { type: 'button', class: `citem t-${(actions.tierFor && actions.tierFor(c.id)) || 'common'}`, 'aria-pressed': c.id === game.state.club.id ? 'true' : 'false', onclick: () => { game.setClub(c.id); toggleClubList(false); } },
        h('b', { text: c.short }), h('span', { text: c.putter ? 'Putt' : fmtDist(game.clubCarry(c), u) }),
        actions.rangeAverage && actions.rangeAverage(c.id) ? h('small', { class: 'ravg', text: `range ${fmtDist(actions.rangeAverage(c.id), u)}` }) : null));
    }
    clubList.appendChild(grid);
    // The shot types this club can play from this lie, each with its carry (scrolls sideways).
    const types = game.shotTypes();
    if (types.length > 1) {
      const row = h('div', { class: 'shottypes', role: 'radiogroup', 'aria-label': 'Shot type' });
      for (const t of types) {
        const on = t.id === game.state.shotType.id, carry = game.shotCarry ? game.shotCarry(t.id) : 0;
        row.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: `shottype${on ? ' on' : ''}`, onclick: () => { game.setShotType(t.id); buildClubList(); } }, h('b', { text: t.name }), carry ? h('span', { text: fmtDist(carry, u) }) : null));
      }
      clubList.appendChild(row);
    }
  }
  hud_closeListOnOutside();
  function hud_closeListOnOutside() {
    root.addEventListener('pointerdown', (e) => { if (!clubList.classList.contains('hidden') && !clubList.contains(e.target) && !clubBtn.contains(e.target)) toggleClubList(false); }, true);
  }

  // --- swing zone ---
  const zone = createSwingZone(el, {
    settings, haptic,
    getIdeal: () => (game.state.phase === 'aim' && settings.powerGuide !== false ? game.suggestedPower() : 0),
    onSwing: (res) => { if (!game.swing(res)) zone.feedback(''); else if (actions.onSwing) actions.onSwing(res); },
  });

  const toast = h('div', { class: 'toast glass', role: 'status', 'aria-live': 'polite' });
  el.appendChild(toast);
  // Replay controls: camera angle and done. The replay runs at half speed.
  const ANGLES = [['follow', 'Follow'], ['landing', 'Landing'], ['side', 'Side'], ['high', 'High']];
  const replaybar = h('div', { class: 'replaybar glass hidden', role: 'group', 'aria-label': 'Replay camera' });
  const angleBtns = ANGLES.map(([id, name]) => h('button', { type: 'button', 'data-angle': id, onclick: () => game.replay(id) }, name));
  replaybar.append(...angleBtns, h('button', { type: 'button', class: 'done', onclick: () => game.endReplay() }, 'Done'));
  el.appendChild(replaybar);
  const skip = h('button', { class: 'btn small glass intro-skip hidden', type: 'button', onclick: () => game.skipIntro() }, 'Skip flyover');
  root.appendChild(skip);

  // The shot card: after a full shot, how it was struck, how far, how far offline, and in plain
  // words what caused a miss. A Mulligan button when one is available.
  const shotcard = h('div', { class: 'shotcard glass hidden', role: 'status', 'aria-live': 'polite' });
  el.appendChild(shotcard);
  let cardTimer = 0;

  let toastTimer = 0;
  const hud = { el, stick: zone, zone, toastEl: toast, layoutBox: null, shotPanel };
  hud.strikeLabel = (tempoLabel, strike) => {
    zone.feedback(tempoLabel);
    if (strike && zone.fbEl) {
      const chip = h('span', { class: `sk sk-${strike.kind}`, text: STRIKE_NAMES[strike.kind] });
      zone.fbEl.append(' ', chip);
    }
  };
  zone.onStart = () => hud.hideShotCard();
  hud.hideShotCard = () => { shotcard.classList.add('hidden'); clearTimeout(cardTimer); if (actions.holdFan) actions.holdFan(false); };
  hud.shotCard = (s) => {
    const u = settings.units, o = s.outcome, st = o.strike || { kind: 'good' };
    const off = Math.abs(o.offline || 0);
    const offTxt = off < 0.9 ? 'on line' : `${fmtDist(off, u)} ${o.offline > 0 ? 'right' : 'left'}`;
    shotcard.textContent = '';
    shotcard.className = 'shotcard glass';
    const row1 = h('div', { class: 'row1' }, h('span', { class: `sk sk-${st.kind}`, text: STRIKE_NAMES[st.kind] || 'Good' }), h('b', { text: s.message || '' }));
    shotcard.append(row1, h('div', { class: 'nums' }, h('span', {}, h('small', { text: 'Carry' }), h('b', { text: fmtDist(o.carry, u) })), h('span', {}, h('small', { text: 'Total' }), h('b', { text: fmtDist(o.total, u) })), h('span', {}, h('small', { text: 'Offline' }), h('b', { text: offTxt }))));
    if (s.range) {
      // Launch monitor numbers on the range.
      const r = s.range;
      shotcard.append(h('div', { class: 'nums lm' }, h('span', {}, h('small', { text: 'Ball speed' }), h('b', { text: fmtMph(r.ballSpeed, u) })), h('span', {}, h('small', { text: 'Launch' }), h('b', { text: `${r.launch.toFixed(1)}°` })), h('span', {}, h('small', { text: 'Spin' }), h('b', { text: `${Math.round(r.spin / 10) * 10}` })), h('span', {}, h('small', { text: 'Apex' }), h('b', { text: fmtShort(r.apex, u) }))));
    }
    if (st.cause && st.kind !== 'pured' && st.kind !== 'good') shotcard.append(h('div', { class: 'why', text: st.cause }));
    if (s.drill && s.drill.message && s.drill.mode !== 'free') shotcard.append(h('div', { class: `why drill${s.drill.points ? ' good' : ''}`, text: s.drill.message }));
    if (s.commentary) shotcard.append(h('div', { class: 'why comm', text: s.commentary }));
    const mull = s.range ? 0 : app_mulligans();
    if (mull > 0 && st.kind !== 'pured' && !(game.state.round && game.state.round.mulliganUsed)) {
      // In the header line, so the card stays short (clear of the fan and the bottom row).
      const b = h('button', { class: 'btn small mull', type: 'button', 'aria-label': `Mulligan, ${mull} left`, onclick: () => { if (game.canMulligan()) game.mulligan(); } }, `Mulligan ${mull}`);
      row1.append(b);
      // Only once the ball has stopped and the next shot is being set up.
      const tick = () => { b.disabled = !game.canMulligan(); };
      tick(); b._t = setInterval(tick, 250); setTimeout(() => clearInterval(b._t), 9000);
    }
    placeCard();
    shotcard.classList.remove('hidden');
    if (actions.holdFan) actions.holdFan(true);
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => hud.hideShotCard(), s.range ? 6500 : st.kind === 'pured' || st.kind === 'good' ? 3200 : 7000);
  };
  const app_mulligans = () => (actions.mulligans ? actions.mulligans() : 0);
  // Under the tabs and under any chip showing beneath them.
  function placeCard() {
    let bottom = tabWind.getBoundingClientRect().bottom;
    for (const c of [hazard, puttinfo, streakChip]) if (!c.classList.contains('hidden')) bottom = Math.max(bottom, c.getBoundingClientRect().bottom);
    shotcard.style.top = `${Math.round(bottom + 6)}px`;
  }
  hud.setStreak = (text) => { streakChip.textContent = text || ''; streakChip.classList.toggle('hidden', !text); };
  // A short burst of color for a birdie or better (skipped with reduced motion by the caller).
  hud.confetti = (size = 'small') => {
    const n = size === 'big' ? 46 : 26;
    const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    const cols = ['#c2e58a', '#ffd166', '#6fb6ff', '#ff8a6a', '#c08bff', '#ffffff'];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3, d = 90 + Math.random() * (size === 'big' ? 190 : 120);
      box.appendChild(h('i', { style: { background: cols[i % cols.length], '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 60}px`, '--r': `${Math.random() * 720 - 360}deg`, animationDelay: `${Math.random() * 120}ms` } }));
    }
    el.appendChild(box);
    setTimeout(() => box.remove(), 1700);
  };
  // A broadcast lower third in the same dock as the shot card (so it never overlaps the HUD).
  hud.lowerThird = (title, sub, line, ms = 3200) => {
    shotcard.textContent = '';
    shotcard.className = 'shotcard glass lt';
    shotcard.append(...[h('b', { class: 'ltt', text: title }), h('span', { class: 'lts', text: sub }), line ? h('span', { class: 'ltl', text: line }) : null].filter(Boolean));
    placeCard();
    shotcard.classList.remove('hidden');
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => hud.hideShotCard(), ms);
  };
  // Replay controls: angle, speed, done.
  hud.replayControls = (items) => {
    shotcard.textContent = '';
    shotcard.className = 'shotcard glass rp';
    shotcard.append(h('b', { class: 'ltt', text: 'Replay' }), h('div', { class: 'rpbtns' }, ...items.map(([label, fn]) => h('button', { class: 'btn small', type: 'button', onclick: fn }, label))));
    placeCard();
    shotcard.classList.remove('hidden');
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => hud.hideShotCard(), 12000);
  };
  hud.note = (title, text, ms = 2200) => {
    shotcard.textContent = '';
    shotcard.className = 'shotcard glass';
    shotcard.append(h('div', { class: 'row1' }, h('b', { text: title })));
    if (text) shotcard.append(h('div', { class: 'why', text }));
    placeCard();
    shotcard.classList.remove('hidden');
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => hud.hideShotCard(), ms);
  };
  shotcard.addEventListener('pointerdown', (e) => { if (e.target.tagName !== 'BUTTON') hud.hideShotCard(); });
  hud.toast = (text, sub = '', ms = 2200) => {
    toast.textContent = text;
    if (sub) toast.appendChild(h('small', { text: sub }));
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), ms);
  };
  hud.setVisible = (on) => { el.classList.toggle('off', !on); el.setAttribute('aria-hidden', on ? 'false' : 'true'); };

  // Layout: the swing zone sits under the ball, above the bottom row, centered on the ball. The
  // ball's place on screen follows from it (the address camera frames the ball there).
  hud.layout = () => {
    root.classList.toggle('lefty', !!settings.leftHandLayout);
    arrowL.setAttribute('aria-label', settings.leftHandLayout ? 'Shorter club' : 'Longer club');
    arrowR.setAttribute('aria-label', settings.leftHandLayout ? 'Longer club' : 'Shorter club');
    arrowL.title = settings.leftHandLayout ? 'Shorter club (S)' : 'Longer club (W)';
    arrowR.title = settings.leftHandLayout ? 'Longer club (W)' : 'Shorter club (S)';
    const W = window.innerWidth || 800, H = window.innerHeight || 600;
    const bb = bottombar.getBoundingClientRect();
    // The top of the bottom row as drawn: on a desktop its buttons are scaled from the bottom
    // edge, so they reach above the row's own box (on a phone this is the row's top).
    const kidTops = [...bottombar.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top);
    const barTop = kidTops.length ? Math.min(...kidTops) : bb.height ? bb.top : H - 90;
    const landscape = W > H;
    const want = Math.round(clamp(H * 0.27, 96, 190) * clamp(settings.stickScale || 1, 0.7, 1.5));
    // Zone height: the start line, full travel, and a margin above the bottom row; in portrait
    // at most half of the space under the top panels.
    const zoneH = Math.round(clamp(want + 46, 130, landscape ? H * 0.46 : H < 700 ? H * 0.31 : H * 0.36));
    const zoneW = Math.round(clamp(W * (landscape ? 0.2 : 0.42), 150, 220));
    const x = Math.round(W / 2 - zoneW / 2);
    // When the club buttons keep to a corner (landscape phones), the zone may come down beside
    // them; when they are centered under it, it stays above the bottom row.
    const cg = clubgroup.getBoundingClientRect();
    const clear = cg.width > 0 && (cg.right < x - 8 || cg.left > x + zoneW + 8);
    const y = clear ? Math.min(barTop - 4 - zoneH + bb.height * 0.85, H - zoneH - 6) : barTop - 10 - zoneH;
    let box = { x, y: Math.round(y), w: zoneW, h: zoneH };
    // A mouse on a desktop: a wide zone just under the ball where a press may start a swing
    // anywhere; the ball stays where it was (the same top edge), the drag may run below it, and
    // the zone ends where a full backswing would still fit in the window.
    if (zone.mouse && root.classList.contains('desk')) {
      const mw = Math.round(clamp(W * 0.32, 360, 640));
      const mh = Math.round(clamp(H - 12 - want - box.y, 64, Math.max(64, zoneH)));
      box = { x: Math.round(W / 2 - mw / 2), y: box.y, w: mw, h: mh, mouseWide: true };
    }
    zone.layout(box);
    // The ball sits just above the start line.
    hud.ballY = box.y - (landscape ? 18 : 30);
    hud.layoutBox = box;
    // The look button goes under the top column on its side, with room kept for the replay
    // button (right) or the hazard and putt chips (left), which come and go.
    const trR = tr.getBoundingClientRect(), tbR = tabs.getBoundingClientRect();
    const rightBottom = trR.bottom + (replayBtn.classList.contains('hidden') ? 54 : 0);
    const leftBottom = tabTop(tbR) + 80;
    const top = Math.max(settings.leftHandLayout ? leftBottom : rightBottom, landscape ? 0 : H * 0.36) + 10;
    lookBtn.style.top = `${Math.round(Math.min(top, barTop - 10 - (lookBtn.getBoundingClientRect().height || 56)))}px`;
    // The HUD corner on the player's side (tabs for a right-hander, the top-right panel for a
    // left-hander): the camera keeps the club's swing clear of it.
    const cr = settings.handedness === 'left' ? tr.getBoundingClientRect() : tabWind.getBoundingClientRect();
    const keep = settings.handedness === 'left' ? { x: (cr.left - 6) / W, y: (Math.max(cr.bottom, mapBtn.getBoundingClientRect().bottom) + 6) / H } : { x: (Math.max(cr.right, tabDist.getBoundingClientRect().right) + 6) / W, y: (cr.bottom + 6) / H };
    if (actions.onLayout) actions.onLayout({ ballY: hud.ballY / H, zone: box, keep });
    // The swing track docks last, clear of the buttons placed above.
    zone.placeTrack();
  };
  // Bottom of the three tabs (the chips under them are not counted).
  function tabTop(tbR) { const r = tabWind.getBoundingClientRect(); return r.height ? r.bottom : tbR.bottom; }
  hud.setLayout = () => hud.layout();
  // Mouse or touch: a fine primary pointer starts in mouse mode; the pointer actually used
  // switches it (a touch laptop moves between the two). Phones never see a mouse.
  const mq = (q) => (typeof matchMedia === 'function' ? matchMedia(q).matches : false);
  let mouseMode = mq('(pointer: fine)') && !mq('(pointer: coarse)');
  const setMouseMode = (on) => {
    if (on === zone.mouse) return;
    if (zone.mode) return; // never mid-swing
    mouseMode = on;
    zone.setMouse(on);
    root.classList.toggle('mousemode', on);
    hud.layout();
  };
  zone.setMouse(mouseMode);
  root.classList.toggle('mousemode', mouseMode);
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !zone.mouse) setMouseMode(true); }, { passive: true });
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && zone.mouse) setMouseMode(false); else if (e.pointerType === 'mouse' && !zone.mouse) setMouseMode(true); }, { passive: true, capture: true });
  hud.mouseMode = () => zone.mouse;
  hud.setLook = (on) => lookBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  window.addEventListener('resize', () => requestAnimationFrame(hud.layout));
  requestAnimationFrame(hud.layout);
  // Panels change size as their text fills in (and with the replay button): lay out again.
  if (typeof ResizeObserver === 'function') {
    let pending = false;
    const ro = new ResizeObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; hud.layout(); }); });
    for (const n of [tr, tabs, bottombar]) ro.observe(n);
  }

  hud.update = () => {
    zone.update();
    const v = game.view();
    // No round (the menus after quitting one): the HUD goes away instead of staying on the last hole.
    if (!v) { hud.setVisible(false); return; }
    const u = settings.units;
    const aiming = v.phase === 'aim';
    const putt = !!v.club.putter;
    // Tab 1: lie, or the live power while swinging.
    const live = zone.live, swinging = aiming && (live.phase === 'back' || live.phase === 'down');
    if (swinging) {
      swapIcon(lieIco, 'lieico', 'power');
      set(lieV, 'lv', `${Math.round(clamp(live.phase === 'back' ? live.depth : live.top, 0, 1) * 100)}%`);
      tabLie.classList.add('power');
    } else {
      swapIcon(lieIco, 'lieico', 'lie');
      set(lieV, 'lv', v.lieName);
      tabLie.classList.remove('power');
    }
    // Tab 2: distance with the elevation adjustment.
    set(distV, 'dv', putt || v.distToPin < 18 ? fmtShort(v.distToPin, u) : fmtDist(v.distToPin, u));
    set(distA, 'da', fmtAdjust(v.elevation, u, putt || v.distToPin < 18));
    // Tab 3: wind, arrow relative to the shot (up is helping), and the time of day.
    set(windArrow, 'wa', `rotate(${(v.wind.relAngle / DEG).toFixed(0)}deg)`, 'transform');
    set(windV, 'wv', fmtMph(v.wind.speedMph, u));
    const w = getWorld && getWorld();
    swapIcon(todIco, 'tod', TOD_ICON[(w && w.todId) || 'midday'] || 'sun');
    const along = v.wind.along, label = Math.abs(along) < 1 && Math.abs(v.wind.cross) < 1 ? 'calm' : Math.abs(along) >= Math.abs(v.wind.cross) ? (along > 0 ? 'helping' : 'into') : v.wind.cross > 0 ? 'left to right' : 'right to left';
    tabWind.setAttribute('aria-label', `Wind ${fmtMph(v.wind.speedMph, u)}, ${label}`);
    // Top right.
    const rh = v.range && actions.rangeHud ? actions.rangeHud() : null;
    if (rh) {
      set(holeK, 'hk', rh.k); set(holeN, 'hn', rh.n); set(holeS, 'hs', rh.s); set(scoreN, 'sn', rh.sn); set(scoreS, 'ss', rh.ss);
    } else {
      set(holeK, 'hk', 'Hole');
      set(holeN, 'hn', `${v.hole}`);
      set(holeS, 'hs', `Par ${v.par}  ${fmtDist(v.yards * YARD, u)}`);
      set(scoreN, 'sn', fmtToPar(v.toPar));
      const shotNo = v.strokes + (['aim', 'ai', 'flight', 'settle'].includes(v.phase) ? 1 : 0);
      set(scoreS, 'ss', `${ordinal(Math.max(1, shotNo))} shot`);
    }
    const pos = v.range ? '' : (actions.boardBadge && actions.boardBadge()) || positionText(v, game.state.round);
    set(badge, 'bd', v.playerCount > 1 ? `${v.player.name}  ${pos}` : pos);
    badge.classList.toggle('hidden', !pos);
    replayBtn.classList.toggle('hidden', !v.canReplay);
    // Hazard on the predicted landing, and the putt read.
    const hz = aiming && v.hazard ? `Careful: ${v.hazard}` : '';
    set(hazard, 'hz', hz);
    hazard.classList.toggle('hidden', !hz);
    if (putt && v.putt && aiming) { set(puttinfo, 'pi', `Break ${fmtBreak(v.putt.breakM, u)}`); puttinfo.classList.remove('hidden'); } else puttinfo.classList.add('hidden');
    // Club button.
    set(clubL, 'cl', v.club.short);
    const tier = (actions.tierFor && actions.tierFor(v.club.id)) || 'common';
    if (clubBtn.dataset.tier !== tier) clubBtn.dataset.tier = tier;
    set(clubC, 'cc', putt ? fmtShort(v.distToPin, u) : fmtDist(v.carry, u));
    clubBtn.setAttribute('aria-label', `${v.club.name}${putt ? '' : `, carry ${fmtDist(v.carry, u)}`}. Tap for the club list, swipe to change`);
    for (const b of [arrowL, arrowR, clubBtn, resetBtn]) b.disabled = !aiming;
    if (!aiming && !clubList.classList.contains('hidden')) toggleClubList(false);
    zone.setEnabled(aiming && v.human && !panelOpen);
    // The shot panel's button: full shots by a person, at address.
    shotPanel.setVisible(aiming && v.human && !putt && !(w && w.rig && w.rig.mode === 'peek'));
    const spinKey = `${v.spin ? `${v.spin.x.toFixed(3)},${v.spin.y.toFixed(3)}` : ''}|${v.club.id}|${v.shotType.id}|${panelOpen ? v.aim.toFixed(4) : ''}|${v.predicted ? v.predicted.carry.toFixed(1) : ''}`;
    if (cache.get('spinKey') !== spinKey) { cache.set('spinKey', spinKey); shotPanel.refresh(); }
    const replaying = v.phase === 'replay';
    replaybar.classList.toggle('hidden', !replaying);
    if (replaying) for (const b of angleBtns) b.setAttribute('aria-pressed', b.dataset.angle === v.replayAngle ? 'true' : 'false');
    const showControls = v.human && !replaying;
    bottombar.style.visibility = showControls ? 'visible' : 'hidden';
    const peeking = !!(w && w.rig && w.rig.mode === 'peek');
    zone.el.style.visibility = aiming && v.human && !peeking ? 'visible' : 'hidden';
    zone.track.style.visibility = zone.el.style.visibility;
    lookBtn.style.visibility = aiming && v.human ? 'visible' : 'hidden';
    skip.classList.toggle('hidden', v.phase !== 'intro');
    // Not in the menus after a round is quit (phase menu): the HUD would sit behind them.
    const showHud = v.phase !== 'intro' && v.phase !== 'loading' && v.phase !== 'summary' && v.phase !== 'done' && v.phase !== 'menu';
    hud.setVisible(showHud);
    tabs.style.visibility = replaying ? 'hidden' : 'visible';
  };
  hud.power = () => clamp(zone.lastResult ? zone.lastResult.power : 0, 0, 1);
  hud.closeClubList = () => toggleClubList(false);
  hud.toggleClubList = () => toggleClubList();
  hud.clubListOpen = () => !clubList.classList.contains('hidden');
  return hud;
}
