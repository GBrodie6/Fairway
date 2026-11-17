// The in-round HUD. Calm and sparse: hole card, distance to the pin, wind, the club, and the
// swing stick. Everything is read from game.view() each frame and only touched when it changes.
import { h, iconButton, icon } from './dom.js';
import { fmtDist, fmtShort, fmtElev, fmtBreak, fmtToPar, fmtMph } from './format.js';
import { createSwingStick } from './swingStick.js';
import { DEG, clamp } from '../core/math.js';

export function createHud(root, { game, settings, haptic, actions }) {
  const el = h('div', { class: 'hud off', 'aria-hidden': 'true' });
  root.appendChild(el);
  const cache = new Map();
  const set = (node, key, value, prop = 'textContent') => {
    const k = key + prop;
    if (cache.get(k) === value) return;
    cache.set(k, value);
    if (prop === 'textContent') node.textContent = value; else node.style[prop] = value;
  };

  // --- top ---
  const holeN = h('div', { class: 'n' }), holeS = h('div', { class: 's' }), holeK = h('div', { class: 'k', text: 'Hole' });
  const score = h('div', { class: 'scorepill glass' });
  const holecard = h('div', {}, h('div', { class: 'holecard glass', role: 'group', 'aria-label': 'Hole' }, holeK, holeN, holeS), score);
  const windArrow = icon('arrow');
  const windV = h('div', { class: 'v' }), windU = h('div', { class: 'u' });
  const wind = h('div', { class: 'wind glass', role: 'img' }, windArrow, h('div', {}, windV, windU));
  const mapBtn = iconButton('map', 'Hole map and rangefinder', () => actions.map());
  const menuBtn = iconButton('menu', 'Pause menu', () => actions.pause());
  el.appendChild(h('div', { class: 'hud-top' }, holecard, h('div', { class: 'topright' }, wind, mapBtn, menuBtn)));
  const pinD = h('div', { class: 'd' }), pinE = h('div', { class: 'e' });
  const pin = h('div', { class: 'pin glass', 'aria-live': 'off' }, pinD, pinE);
  el.appendChild(pin);
  const hazard = h('div', { class: 'hazard chip glass warn hidden', role: 'status' });
  el.appendChild(hazard);
  const toast = h('div', { class: 'toast glass', role: 'status', 'aria-live': 'polite' });
  el.appendChild(toast);

  // --- bottom: controls and stick ---
  const clubName = h('div', { class: 'name' }), clubSub = h('div', { class: 'sub' });
  const prev = h('button', { class: 'arrow', type: 'button', 'aria-label': 'Longer club', onclick: () => game.selectClub(-1) }, '‹');
  const next = h('button', { class: 'arrow', type: 'button', 'aria-label': 'Shorter club', onclick: () => game.selectClub(1) }, '›');
  const clubcard = h('div', { class: 'clubcard glass' }, prev, h('div', { class: 'mid' }, clubName, clubSub), next);
  // Swipe on the club card changes club too.
  let swipeX = null;
  clubcard.addEventListener('pointerdown', (e) => { swipeX = e.clientX; });
  clubcard.addEventListener('pointerup', (e) => { if (swipeX != null && Math.abs(e.clientX - swipeX) > 34) game.selectClub(e.clientX < swipeX ? 1 : -1); swipeX = null; });
  const seg = h('div', { class: 'seg glass', role: 'group', 'aria-label': 'Shot type' });
  const nudge = (deg) => () => { game.nudgeAim(deg * DEG); if (haptic) haptic(4); };
  const holdRepeat = (btn, fn) => {
    let timer = null, rep = null;
    const stop = () => { clearTimeout(timer); clearInterval(rep); timer = rep = null; };
    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); fn(); timer = setTimeout(() => { rep = setInterval(fn, 70); }, 320); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
    btn.addEventListener('click', (e) => { if (e.detail === 0) fn(); }); // keyboard activation
  };
  const aimL = h('button', { class: 'arrow', type: 'button', 'aria-label': 'Aim left a little' }, '◂');
  const aimR = h('button', { class: 'arrow', type: 'button', 'aria-label': 'Aim right a little' }, '▸');
  holdRepeat(aimL, nudge(-0.25)); holdRepeat(aimR, nudge(0.25));
  const aimLabel = h('span', { text: 'Aim' });
  const resetBtn = iconButton('reset', 'Aim back at the target', () => actions.resetAim(), 'arrow');
  const lookBtn = iconButton('look', 'Free look. Drag to look around', () => actions.toggleLook(), 'arrow');
  const aimrow = h('div', { class: 'aimrow glass' }, aimL, aimLabel, aimR, resetBtn, lookBtn);
  const puttinfo = h('div', { class: 'puttinfo glass hidden', 'aria-live': 'polite' });
  const controls = h('div', { class: 'controls' }, puttinfo, h('div', { class: 'row' }, seg), clubcard, aimrow);
  const replayBtn = iconButton('replay', 'Replay the last shot', () => actions.replay());
  const stickCol = h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' } }, replayBtn);
  const bottom = h('div', { class: 'bottom' }, controls, stickCol);
  el.appendChild(bottom);
  const stick = createSwingStick(stickCol, {
    settings, haptic,
    getIdeal: () => (game.state.phase === 'aim' ? game.suggestedPower() : 0),
    onSwing: (res) => { if (!game.swing(res)) stick.feedback(''); },
  });
  const skip = h('button', { class: 'btn small glass intro-skip hidden', type: 'button', onclick: () => game.skipIntro() }, 'Skip flyover');
  root.appendChild(skip);

  let toastTimer = 0;
  const hud = { el, stick, toastEl: toast };
  hud.toast = (text, sub = '', ms = 2200) => {
    toast.textContent = text;
    if (sub) toast.appendChild(h('small', { text: sub }));
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), ms);
  };
  hud.setVisible = (on) => { el.classList.toggle('off', !on); el.setAttribute('aria-hidden', on ? 'false' : 'true'); };
  hud.setLayout = () => { root.classList.toggle('lefty', !!settings.leftHandLayout); stick.relayout(); };
  hud.setLook = (on) => lookBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  hud.setLayout();

  let segKey = '';
  function buildSeg(types, current) {
    const key = types.map((t) => t.id).join(',') + ':' + current;
    if (key === segKey) return;
    segKey = key;
    seg.textContent = '';
    for (const t of types) seg.appendChild(h('button', { type: 'button', 'aria-pressed': t.id === current ? 'true' : 'false', onclick: () => game.setShotType(t.id) }, t.name));
    seg.classList.toggle('hidden', types.length === 0);
  }

  hud.update = () => {
    stick.update();
    const v = game.view();
    if (!v) return;
    const u = settings.units;
    set(holeN, 'hn', `${v.hole}`);
    set(holeK, 'hk', v.holes > 1 ? `Hole ${v.holeOf} of ${v.holes}` : 'Hole');
    set(holeS, 'hs', `Par ${v.par}  ${fmtDist(v.yards * 0.9144, u)}`);
    const scoreText = v.mode === 'stroke' || v.mode === 'daily' || v.mode === 'range' ? `${v.playerCount > 1 ? v.player.name + '  ' : ''}Stroke ${v.strokes + (['aim', 'ai', 'flight', 'settle'].includes(v.phase) ? 1 : 0)}  ${fmtToPar(v.toPar)}` : v.standingsText;
    set(score, 'sc', scoreText);
    // Wind: the arrow shows where the wind blows relative to the aim (up is downwind).
    set(windArrow, 'wa', `rotate(${(v.wind.relAngle / DEG).toFixed(0)}deg)`, 'transform');
    set(windV, 'wv', fmtMph(v.wind.speedMph, u));
    const along = v.wind.along, label = Math.abs(along) < 1 && Math.abs(v.wind.cross) < 1 ? 'calm' : Math.abs(along) >= Math.abs(v.wind.cross) ? (along > 0 ? 'helping' : 'into') : v.wind.cross > 0 ? 'left to right' : 'right to left';
    set(windU, 'wu', label);
    wind.setAttribute('aria-label', `Wind ${fmtMph(v.wind.speedMph, u)}, ${label}`);
    const onGreen = !!v.club.putter;
    set(pinD, 'pd', onGreen || v.distToPin < 18 ? fmtShort(v.distToPin, u) : fmtDist(v.distToPin, u));
    set(pinE, 'pe', `to pin  ${fmtElev(v.elevation, u)}`);
    const aiming = v.phase === 'aim';
    // Club card and shot types.
    set(clubName, 'cn', v.club.name);
    const lie = v.lieName;
    set(clubSub, 'cs', onGreen ? `${lie}` : `${fmtDist(v.carry, u)} carry  ${lie}`);
    buildSeg(aiming && v.human ? game.shotTypes() : [], v.shotType.id);
    for (const b of [prev, next, aimL, aimR]) b.disabled = !aiming;
    replayBtn.disabled = !v.canReplay;
    // Hazard warning on the predicted landing.
    const hz = aiming && v.hazard ? `Careful: ${v.hazard}` : '';
    set(hazard, 'hz', hz);
    hazard.classList.toggle('hidden', !hz);
    // Putt read: break, elevation, pace.
    if (onGreen && v.putt && aiming) {
      const p = v.putt;
      const txt = `Read  ${fmtBreak(p.breakM, u)}  ${fmtElev(p.elevation, u)}`;
      set(puttinfo, 'pi', txt);
      puttinfo.classList.remove('hidden');
    } else puttinfo.classList.add('hidden');
    stick.setEnabled(aiming && v.human);
    aimrow.classList.toggle('hidden', !aiming);
    controls.style.visibility = v.human ? 'visible' : 'hidden';
    skip.classList.toggle('hidden', v.phase !== 'intro');
    const showHud = v.phase !== 'intro' && v.phase !== 'loading' && v.phase !== 'summary' && v.phase !== 'done';
    hud.setVisible(showHud);
    pin.style.visibility = v.phase === 'flight' || v.phase === 'replay' ? 'hidden' : 'visible';
  };
  hud.power = () => clamp(stick.lastResult ? stick.lastResult.power : 0, 0, 1);
  return hud;
}
