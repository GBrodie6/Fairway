// The swing stick: a DOM view over the pure gesture logic in game/swingGesture.js.
// Pull the knob down for the backswing, push it up through the start line to strike.
// Pointer events cover mouse, touch, and pen. Coalesced samples are fed in order so a fast
// flick on a 120 Hz screen is graded on every sample the browser saw, not only the last one.
// Keyboard and gamepad use the three-press meter, which drives the same knob.
import { createSwingGesture, createMeterSwing, PHASE } from '../game/swingGesture.js';
import { clamp } from '../core/math.js';

const START = 30; // px from the top of the track to the start line

export function createSwingStick(parent, { onSwing, onCancel, getIdeal, settings, haptic }) {
  const el = document.createElement('div');
  el.className = 'stick glass';
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', 'Swing. Drag down to take the club back, then push up through the line to strike. Or press Space three times.');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.tabIndex = 0;
  el.innerHTML = '<div class="label">Swing</div><div class="track"><div class="fill"></div><div class="ideal"></div><div class="startline"></div><div class="knob"></div></div><div class="pct" aria-hidden="true"></div><div class="fb" aria-live="polite"></div>';
  parent.appendChild(el);
  const track = el.querySelector('.track'), knob = el.querySelector('.knob'), fill = el.querySelector('.fill');
  const ideal = el.querySelector('.ideal'), pct = el.querySelector('.pct'), fb = el.querySelector('.fb');

  const stick = { el, enabled: true, travel: 170, gesture: null, meter: createMeterSwing(), pointerId: null, mode: null, lastResult: null };

  // Travel scales with the screen so a thumb can reach full power on a small phone, and with
  // the stick size setting.
  function layout() {
    const h = window.innerHeight || 640;
    stick.travel = Math.round(clamp(h * 0.27, 96, 190) * clamp(settings.stickScale || 1, 0.7, 1.5));
    track.style.height = `${stick.travel + START + 26}px`;
    stick.gesture = createSwingGesture({ travel: stick.travel, handedness: settings.handedness });
  }
  layout();
  window.addEventListener('resize', layout);

  function draw(depth, drift = 0) {
    const d = clamp(depth, -0.15, 1.1);
    knob.style.transform = `translate(${clamp(drift, -0.4, 0.4) * stick.travel}px, ${d * stick.travel}px)`;
    fill.style.height = `${Math.max(0, d) * stick.travel}px`;
    const p = Math.round(clamp(d, 0, 1) * 100);
    pct.textContent = d > 0.01 ? `${p}%` : '';
    el.setAttribute('aria-valuenow', String(p));
  }
  stick.setIdeal = (power) => {
    if (!Number.isFinite(power) || power <= 0) { ideal.style.display = 'none'; return; }
    ideal.style.display = '';
    ideal.style.top = `${START + clamp(power, 0, 1) * stick.travel - 1.5}px`;
  };
  stick.setEnabled = (on) => {
    stick.enabled = !!on;
    el.classList.toggle('disabled', !on);
    if (!on) { stick.cancel(); }
  };
  stick.feedback = (text) => { fb.textContent = text || ''; };
  stick.cancel = () => {
    if (stick.gesture) stick.gesture.cancel();
    stick.meter.cancel();
    stick.mode = null; stick.pointerId = null;
    el.classList.remove('active');
    draw(0);
  };

  function complete(result) {
    stick.lastResult = result;
    stick.mode = null;
    el.classList.remove('active');
    draw(0);
    if (haptic) haptic(result.tempoGrade === 'perfect' ? [12, 30, 18] : 16);
    stick.feedback(result.tempoLabel + (result.auto ? '' : ''));
    onSwing(result);
  }
  function cancelled() {
    stick.mode = null;
    el.classList.remove('active');
    draw(0);
    if (onCancel) onCancel();
  }

  // --- pointer ---
  const local = (e) => { const r = track.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  el.addEventListener('pointerdown', (e) => {
    if (!stick.enabled || stick.mode) return;
    e.preventDefault();
    stick.pointerId = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    stick.mode = 'pointer';
    el.classList.add('active');
    const p = local(e);
    stick.gesture.down(p.x, p.y, e.timeStamp);
    if (haptic) haptic(6);
    stick.feedback('');
  });
  el.addEventListener('pointermove', (e) => {
    if (stick.mode !== 'pointer' || e.pointerId !== stick.pointerId) return;
    e.preventDefault();
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const samples = list && list.length ? list : [e];
    let st = stick.gesture.state;
    for (const s of samples) {
      const p = local(s);
      st = stick.gesture.move(p.x, p.y, s.timeStamp);
      if (st.phase === PHASE.DONE || st.phase === PHASE.CANCELLED) break;
    }
    if (st.phase === PHASE.DONE) { try { el.releasePointerCapture(e.pointerId); } catch { /* fine */ } complete(st.result); return; }
    if (st.phase === PHASE.CANCELLED) { cancelled(); return; }
    if (st.phase === PHASE.BACK && haptic && st.depth >= 1 && !stick._buzzTop) { stick._buzzTop = true; haptic(8); }
    if (st.phase !== PHASE.BACK) stick._buzzTop = false;
    draw(st.depth, st.drift);
  });
  const end = (e) => {
    if (stick.mode !== 'pointer' || e.pointerId !== stick.pointerId) return;
    const p = local(e);
    const st = e.type === 'pointercancel' ? stick.gesture.cancel() : stick.gesture.up(p.x, p.y, e.timeStamp);
    if (st.phase === PHASE.DONE) complete(st.result); else cancelled();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', (e) => { if (stick.mode === 'pointer' && e.pointerId === stick.pointerId) end(e); });

  // --- three-press meter (keyboard Space, gamepad A) ---
  stick.meterPress = (t = performance.now()) => {
    if (!stick.enabled) return;
    if (stick.mode === 'pointer') return;
    const st = stick.meter.press(t);
    if (st.phase === PHASE.BACK) { stick.mode = 'meter'; el.classList.add('active'); stick.feedback(''); }
    else if (st.phase === PHASE.DONE) complete(st.result);
    else if (st.phase === PHASE.CANCELLED) cancelled();
  };
  el.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) stick.meterPress(e.timeStamp); } });

  // Called every frame for the meter animation and the ideal marker.
  stick.update = () => {
    if (stick.mode === 'meter') {
      const t = performance.now();
      const st = stick.meter.expire(t);
      if (st.phase === PHASE.DONE) { complete(st.result); return; }
      if (st.phase === PHASE.CANCELLED) { cancelled(); return; }
      draw(stick.meter.meter(t));
    }
    if (getIdeal) stick.setIdeal(getIdeal());
  };
  stick.relayout = layout;
  draw(0);
  return stick;
}
