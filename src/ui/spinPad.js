// The shot panel: the ball-contact pad (a golf ball diagram with a draggable dot) and the shot
// type selector, from one small button beside the bottom row. The dot sits inside the usable
// range for the club in hand (a ring on the ball, larger for higher club tiers and some golfer
// perks); the labels say what each direction does in plain words, and the quick buttons set a
// draw, a fade, or straight. The aim fan and landing marker bend live while the dot moves, and
// the panel shows the expected curve and roll in yards. Nothing here changes the swing.
import { h, icon } from './dom.js';
import { clampOffset, padLabels, quickOffset, isNeutral } from '../game/spin.js';
import { fmtDist } from './format.js';
import { clamp } from '../core/math.js';

export function createShotPanel(root, { game, settings, haptic, onOpen }) {
  // The button: a tiny ball with the dot where the contact is, and the shot type under it.
  const mini = h('span', { class: 'spinmini', 'aria-hidden': 'true' }, h('i'));
  const typeL = h('span', { class: 'spintype' });
  const btn = h('button', { class: 'spinbtn glass', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Shot shape and type', title: 'Shot shape and type. Shift and the arrows move the dot, Q and E change the shot' }, mini, typeL);
  root.appendChild(btn);

  // The panel.
  const ball = h('div', { class: 'padball', role: 'slider', tabindex: '0', 'aria-label': 'Ball contact. Drag the dot: left and right curve the ball, up adds backspin, down takes spin off.' });
  const ringEl = h('div', { class: 'padrange' }), dot = h('div', { class: 'paddot' });
  ball.append(h('div', { class: 'padcross' }), ringEl, dot);
  const lab = { left: h('span', { class: 'padlab l' }), right: h('span', { class: 'padlab r' }), up: h('span', { class: 'padlab u' }), down: h('span', { class: 'padlab d' }) };
  const padWrap = h('div', { class: 'padwrap' }, lab.up, h('div', { class: 'padrow' }, lab.left, ball, lab.right), lab.down);
  const readout = h('div', { class: 'padread', 'aria-live': 'polite' });
  const qDraw = h('button', { class: 'btn small', type: 'button' }, 'Draw');
  const qStraight = h('button', { class: 'btn small', type: 'button' }, 'Straight');
  const qFade = h('button', { class: 'btn small', type: 'button' }, 'Fade');
  const types = h('div', { class: 'shottypes', role: 'radiogroup', 'aria-label': 'Shot type' });
  const done = h('button', { class: 'btn primary small', type: 'button' }, 'Done');
  const panel = h('div', { class: 'shotpanel glass hidden', role: 'dialog', 'aria-label': 'Shot shape and type' },
    h('div', { class: 'shotgrid' }, padWrap, h('div', { class: 'padside' }, readout)),
    h('div', { class: 'quick' }, qDraw, qStraight, qFade),
    types, h('div', { class: 'padfoot' }, done));
  root.appendChild(panel);

  const lefty = () => settings.handedness === 'left';
  const sp = { open: false, btn, panel };
  function place() {
    const s = game.spin(), R = game.spinRange();
    // The pad is drawn as the player sees the ball from behind: left is world left.
    dot.style.left = `${50 + s.x * 50}%`; dot.style.top = `${50 - s.y * 50}%`;
    ringEl.style.width = ringEl.style.height = `${R * 100}%`;
    mini.firstChild.style.left = `${50 + s.x * 50}%`; mini.firstChild.style.top = `${50 - s.y * 50}%`;
    btn.classList.toggle('shaped', !isNeutral(s));
    const L = padLabels(lefty());
    lab.left.textContent = L.left; lab.right.textContent = L.right; lab.up.textContent = L.up; lab.down.textContent = L.down;
    ball.setAttribute('aria-valuetext', describe(s));
  }
  function describe(s) {
    const L = padLabels(lefty());
    const parts = [];
    if (Math.abs(s.x) > 0.04) parts.push(`${s.x < 0 ? L.left : L.right} ${Math.round(Math.abs(s.x) * 100)} percent`);
    if (Math.abs(s.y) > 0.04) parts.push(`${s.y > 0 ? L.up : L.down} ${Math.round(Math.abs(s.y) * 100)} percent`);
    return parts.length ? parts.join(', ') : 'Neutral';
  }
  function readoutText() {
    const v = game.spinReadout();
    if (!v) return '';
    const u = settings.units;
    const side = Math.abs(v.curve) < 0.5 ? 'Straight' : `Curves ${fmtDist(Math.abs(v.curve), u)} ${v.curve < 0 ? 'left' : 'right'}`;
    return `${side}. Rolls about ${fmtDist(v.roll, u)}. Carry ${fmtDist(v.carry, u)}.`;
  }
  function buildTypes() {
    types.textContent = '';
    const list = game.shotTypes(), cur = game.state.shotType.id;
    for (const t of list) {
      const carry = game.shotCarry ? game.shotCarry(t.id) : null;
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': t.id === cur ? 'true' : 'false', class: `shottype${t.id === cur ? ' on' : ''}` },
        h('b', { text: t.name }), carry ? h('span', { text: fmtDist(carry, settings.units) }) : null);
      b.addEventListener('click', () => { game.setShotType(t.id); refresh(); });
      types.appendChild(b);
    }
    types.classList.toggle('hidden', list.length < 2);
  }
  function refresh() {
    place();
    readout.textContent = readoutText();
    typeL.textContent = game.state.shotType && game.state.shotType.id !== 'full' ? game.state.shotType.name : '';
    if (sp.open) buildTypes();
  }
  sp.refresh = refresh;

  // Drag the dot (pointer), or move it with the arrow keys.
  // The dot follows the finger at once; the prediction (fan and readout) catches up once a
  // frame, and the power guide when the finger lifts.
  let dragging = null, pending = null, raf = 0;
  const pointOf = (e) => {
    const r = ball.getBoundingClientRect();
    const x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1), y = clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1, 1);
    return clampOffset({ x, y }, game.spinRange());
  };
  const showDot = (c) => { dot.style.left = `${50 + c.x * 50}%`; dot.style.top = `${50 - c.y * 50}%`; };
  const flushLive = () => { raf = 0; if (pending) { const c = pending; pending = null; game.setSpin(c.x, c.y, { live: true }); refresh(); } };
  const setFromPoint = (e, final = false) => {
    const c = pointOf(e);
    showDot(c);
    if (final) { if (raf) cancelAnimationFrame(raf); raf = 0; pending = null; game.setSpin(c.x, c.y); refresh(); return; }
    pending = c;
    if (!raf) raf = requestAnimationFrame(flushLive);
  };
  ball.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); dragging = e.pointerId; try { ball.setPointerCapture(e.pointerId); } catch { /* fine */ } setFromPoint(e); if (haptic) haptic(5); });
  ball.addEventListener('pointermove', (e) => { if (dragging !== e.pointerId) return; e.preventDefault(); setFromPoint(e); });
  const up = (e) => { if (dragging === e.pointerId) { dragging = null; setFromPoint(e, true); } };
  ball.addEventListener('pointerup', up); ball.addEventListener('pointercancel', up);
  ball.addEventListener('keydown', (e) => {
    const s = game.spin(), k = 0.1;
    const m = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, k], ArrowDown: [0, -k] }[e.key];
    if (!m) return;
    e.preventDefault();
    const c = clampOffset({ x: s.x + m[0], y: s.y + m[1] }, game.spinRange());
    game.setSpin(c.x, c.y); refresh();
  });
  const quick = (kind) => { const q = quickOffset(kind, game.spinRange(), lefty()); game.setSpin(q.x, q.y); refresh(); if (haptic) haptic(8); };
  qDraw.addEventListener('click', () => quick('draw'));
  qFade.addEventListener('click', () => quick('fade'));
  qStraight.addEventListener('click', () => quick('straight'));

  sp.show = (on) => {
    sp.open = !!on;
    panel.classList.toggle('hidden', !sp.open);
    btn.setAttribute('aria-expanded', sp.open ? 'true' : 'false');
    if (sp.open) { refresh(); if (onOpen) onOpen(true); setTimeout(() => ball.focus({ preventScroll: true }), 0); } else if (onOpen) onOpen(false);
  };
  btn.addEventListener('click', () => sp.show(!sp.open));
  done.addEventListener('click', () => sp.show(false));
  // Label the quick buttons for the golfer's hand each time the panel opens.
  sp.relabel = () => { const L = padLabels(lefty()); qDraw.textContent = 'Draw'; qFade.textContent = 'Fade'; void L; };
  sp.setVisible = (on) => { btn.classList.toggle('hidden', !on); if (!on && sp.open) sp.show(false); };
  refresh();
  void icon;
  return sp;
}
