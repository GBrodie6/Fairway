// The swing zone: a clear patch of the course view between the ball and the bottom row. Touch
// it, drag down for the backswing, push up through the start line to strike. A chevron marks
// where the drag starts. The swing stick is a slim rounded track docked to the screen edge on
// the side away from the club (right for a right-handed golfer): a soft gradient fill follows
// the backswing, a warm mark shows the power guide, a short tick marks the top of the
// backswing, the start marker pulses as the drag comes back to it, and a small ring is the
// tempo cue (it fills during the backswing and empties three times as fast on the way down, so
// it is empty at the line on a 3 to 1 swing). Little text; it never sits over the ball or club.
//
// It is a DOM view over the pure gesture logic in game/swingGesture.js, exactly like the old
// swing stick: same travel rule, same gesture, same three-press meter for keyboard and gamepad.
// Pointer events cover mouse, touch, and pen; coalesced samples are fed in order.
//
// Swing guide (Settings): Box, the default, or Classic track (everything above). The box
// (ui/swingBox.js for its geometry and states) is a soft translucent rectangle centred under
// the ball: a press inside it starts the swing (outside does not), a ring marks the start line
// where the press began (where the thumb crosses going back up for a straight shot), a soft fill
// shows the backswing depth and a small number the power. There is no line or track to follow.
// During a swing the box centres on the press point; if the thumb leaves it the outline lights
// up in the warning colour and pulses once (a short tick on a phone), and more than 1.5 box
// widths outside cancels the swing with no stroke. The ring also carries a quiet tempo cue: an
// arc that grows through the backswing and empties three times as fast on the way down.
import { createSwingGesture, createMeterSwing, PHASE, SWING_DEFAULTS } from '../game/swingGesture.js';
import { boxGeometry, inBox, liveBox, boxState } from './swingBox.js';
import { springStep } from '../game/swingMotion.js';
import { createMouseRefiner } from './mouseRefine.js';
import { liveFaceAndPath } from '../game/clubPath.js';
import { clamp } from '../core/math.js';
import { icon } from './dom.js';

export function createSwingZone(parent, { onSwing, onCancel, getIdeal, settings, haptic }) {
  const el = document.createElement('div');
  el.className = 'swingzone';
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', 'Swing. Drag down from the chevron to take the club back, then push up through the start line to strike. Or hold Space for the backswing, release it at the top, and press it again to strike.');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.tabIndex = 0;
  el.innerHTML = '<div class="startline"></div><div class="chev"></div>';
  el.querySelector('.chev').appendChild(icon('chevron'));
  parent.appendChild(el);
  const startline = el.querySelector('.startline');
  // The docked track (decorative: the zone itself is the slider for assistive tech).
  const track = document.createElement('div');
  track.className = 'swingtrack';
  track.setAttribute('aria-hidden', 'true');
  track.innerHTML = '<div class="tfill"></div><div class="tguide"></div><div class="ttop"></div><div class="tstart"></div><div class="ttempo"></div>';
  parent.appendChild(track);
  const fill = track.querySelector('.tfill'), ideal = track.querySelector('.tguide'), topTick = track.querySelector('.ttop'), tempoRing = track.querySelector('.ttempo');
  // The tempo cue's clock: when the backswing started, when it last went deeper, and the
  // ring's level when the downswing began.
  const tempo = { start: 0, top: 0, level: 0, phase: 'address' };
  const BACK_REF = 1000; // ms of backswing that fills the ring
  // The tempo grade after impact. It lives outside the zone, which hides once the ball is away.
  const fb = document.createElement('div');
  fb.className = 'tempo';
  fb.setAttribute('aria-live', 'polite');
  parent.appendChild(fb);
  // The swing box's drawing (the zone element itself stays the input area, so the gesture's
  // coordinates never move under a swing) and its power number.
  const vis = document.createElement('div');
  vis.className = 'swingbox off';
  vis.setAttribute('aria-hidden', 'true');
  vis.innerHTML = '<div class="bfill"></div><div class="bguide"></div><div class="bring"><i></i></div>';
  parent.appendChild(vis);
  const bfill = vis.querySelector('.bfill'), bguide = vis.querySelector('.bguide'), bring = vis.querySelector('.bring');
  const pct = document.createElement('div');
  pct.className = 'swingpct';
  pct.setAttribute('aria-hidden', 'true');
  parent.appendChild(pct);

  const zone = {
    el, enabled: true, travel: 170, gesture: null, meter: createMeterSwing(), pointerId: null, mode: null, lastResult: null,
    // Live state for the club view and the power tab: phase, depth, deepest point, face, path.
    live: { phase: 'address', depth: 0, top: 0, face: 0, path: 0 },
    box: { x: 0, y: 0, w: 0, h: 0 },
    // Mouse mode (a fine pointer): a wide zone under the ball and the track beside the press
    // point on a desktop-sized window; hover preview, grab cursors and a safe cancel when the
    // pointer leaves the window on any size. Touch is exactly as before.
    mouse: false, wide: false,
    // The swing box: the guide in use, the box at rest, the box during a swing (centred on the
    // press point), the press point and the outline state (client pixels).
    guide: 'box', rest: null, liveRect: null, press: null, hoverX: null, outline: 'inside',
  };
  zone.boxMode = () => zone.guide === 'box';
  const START = 26; // px from the top of the zone to the start line
  // The drag is mirrored for a left-handed golfer and for the left-handed layout: sideways
  // drift then means the same (open or closed) in the player's own terms.
  const swingHand = () => (settings.handedness === 'left' || settings.leftHandLayout ? 'left' : 'right');

  // Travel follows the old stick rule (a share of the screen height, scaled by the size
  // setting), capped so a full backswing fits between the start line and the bottom row.
  zone.layout = (box) => {
    // Never change the geometry under a swing in progress; the caller lays out again later.
    if (zone.mode) { zone.pendingBox = box; return; }
    const h = window.innerHeight || 640;
    const want = Math.round(clamp(h * 0.27, 96, 190) * clamp(settings.stickScale || 1, 0.7, 1.5));
    // With a mouse on a desktop the drag may run below the zone (the pointer is captured), so
    // the zone is only where the press may start and the travel keeps its full length.
    const travel = box.mouseWide ? want : Math.max(80, Math.min(want, Math.round(box.h - START - 14)));
    const hand = swingHand();
    const same = zone.gesture && travel === zone.travel && zone.hand === hand;
    zone.travel = travel;
    zone.hand = hand;
    zone.area = box;
    // Swing guide: the box (default) draws a box centred in the area; the classic track uses
    // the whole area (and on a desktop the wide mouse area) as before.
    zone.guide = settings.swingGuide === 'classic' ? 'classic' : 'box';
    const boxMode = zone.boxMode();
    el.classList.toggle('boxmode', boxMode);
    track.classList.toggle('off', boxMode);
    vis.classList.toggle('off', !boxMode);
    vis.classList.toggle('lefty', hand === 'left');
    if (boxMode) { zone.rest = boxGeometry(box, travel, { wide: !!box.mouseWide }); box = zone.rest; } else zone.rest = null;
    zone.box = box;
    zone.wide = !boxMode && !!box.mouseWide;
    el.classList.toggle('wide', zone.wide);
    el.setAttribute('aria-label', boxMode
      ? 'Swing. Press in the box and pull down to take the club back, then swipe up through the ring to strike. Or hold Space for the backswing, release it at the top, and press it again to strike.'
      : 'Swing. Drag down from the chevron to take the club back, then push up through the start line to strike. Or hold Space for the backswing, release it at the top, and press it again to strike.');
    Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    Object.assign(fb.style, { left: `${box.x + box.w / 2}px`, top: `${box.y + START + 18}px` });
    zone.placeTrack();
    placeVis();
    if (!same) zone.gesture = createSwingGesture({ travel: zone.travel, handedness: hand });
  };
  // Draw the box: at rest, or during a swing centred on the press point; the ring at the press
  // point (or the start line, following a hovering mouse).
  function placeVis() {
    if (!zone.boxMode() || !zone.rest) return;
    const r = zone.liveRect || zone.rest;
    Object.assign(vis.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    // A hovering mouse previews the ring under the cursor, kept inside the box.
    const rx = zone.press ? zone.press.x : zone.hoverX != null ? clamp(zone.hoverX, zone.rest.x + 15, zone.rest.x + zone.rest.w - 15) : r.x + r.w / 2;
    const ry = zone.press ? zone.press.y : r.y + START;
    Object.assign(bring.style, { left: `${Math.round(rx - r.x)}px`, top: `${Math.round(ry - r.y)}px` });
  }
  zone.placeVis = placeVis;
  // The ring's centre in client pixels (where a swing should start and end).
  zone.ringPoint = () => { const r = bring.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  // Dock the track to the screen edge away from the club: the club swings back to the left of
  // the ball for a right-handed golfer and to the right for a left-handed one. Called again by
  // the HUD once its buttons are in place.
  zone.placeTrack = () => {
    const box = zone.box;
    if (!box || !box.h || zone.boxMode()) return;
    // Mouse on a desktop: the track rests beside the ball, away from the club (right of the
    // ball for a right-handed golfer), and follows the press point during a swing.
    if (zone.wide) {
      const lefty = settings.handedness === 'left';
      const cx = box.x + box.w / 2, y = box.y + START;
      zone.trackAt(lefty ? cx - 86 : cx + 76, y);
      track.classList.toggle('lefty', lefty);
      return;
    }
    const vw = window.innerWidth || 390;
    // On an ultrawide desktop the HUD corners sit in from the far edges (ui/desktop.js, --ex).
    const ex = parseFloat(getComputedStyle(parent).getPropertyValue('--ex')) || 0;
    const edge = 12 + ex, lefty = settings.handedness === 'left';
    let left = lefty ? edge : vw - edge - 10;
    // Step inward past any control on that edge within the track's height (the look and aim
    // buttons sit on the right edge in landscape), so the track never covers a button.
    const y0 = box.y + START - 34, y1 = box.y + START + zone.travel + 6;
    const controls = [...parent.querySelectorAll('button, .tab')].filter((b) => b.offsetParent !== null && !el.contains(b) && !track.contains(b)).map((b) => b.getBoundingClientRect());
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const r of controls) {
        if (r.bottom < y0 || r.top > y1 || !r.width) continue;
        if (left + 16 > r.left && left - 6 < r.right) { left = lefty ? r.right + 8 : r.left - 18; moved = true; }
      }
      if (!moved) break;
    }
    Object.assign(track.style, { left: `${left}px`, top: `${box.y + START}px`, height: `${zone.travel}px` });
    track.classList.toggle('lefty', lefty);
  };

  // Put the track's start marker at (x, y) in the parent's coordinates (viewport pixels).
  zone.trackAt = (x, y) => {
    Object.assign(track.style, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px`, height: `${zone.travel}px` });
  };
  // A layout that arrived during a swing is applied once the swing is over.
  const flushLayout = () => { if (zone.pendingBox && !zone.mode) { const b = zone.pendingBox; zone.pendingBox = null; zone.layout(b); } };
  zone.startY = () => zone.box.y + START;

  // In mouse mode the track's fill follows the drag through the same exact spring the club
  // uses (game/swingMotion.js), stepped by real frame time, so a 60 Hz mouse on a 144 Hz screen
  // fills smoothly and a 1000 Hz mouse does not shimmer. The swing result never reads it.
  const fillSpring = { x: 0, v: 0, t: 0 };
  function fillDepth(d) {
    if (!zone.mouse || zone.mode !== 'pointer') { fillSpring.x = d; fillSpring.v = 0; fillSpring.t = performance.now(); return d; }
    const now = performance.now(), dt = clamp((now - (fillSpring.t || now)) / 1000, 0, 0.05);
    fillSpring.t = now;
    const r = springStep(fillSpring.x, fillSpring.v, d, 40, dt);
    fillSpring.x = r.x; fillSpring.v = r.v;
    return r.x;
  }
  function draw(depth) {
    const d = clamp(depth, 0, 1.1);
    const fd = Math.min(1, fillDepth(d));
    fill.style.height = `${fd * zone.travel}px`;
    const p = Math.round(clamp(d, 0, 1) * 100);
    el.setAttribute('aria-valuenow', String(p));
    if (zone.boxMode()) drawBox(fd);
    // The top tick and the start marker's pulse, from the live drag.
    const l = zone.live;
    const top = l.phase === 'down' ? l.top : l.phase === 'back' ? l.depth : 0;
    topTick.style.top = `${clamp(top, 0, 1) * zone.travel - 1}px`;
    track.classList.toggle('hastop', l.phase === 'down' || (l.phase === 'back' && l.depth > 0.05));
    const near = l.phase === 'down' ? clamp(1 - l.depth / Math.max(l.top, 1e-3), 0, 1) : 0;
    track.style.setProperty('--near', near.toFixed(3));
    startline.style.setProperty('--near', near.toFixed(3));
    track.classList.toggle('close', near > 0.7);
    el.classList.toggle('close', near > 0.7);
    vis.style.setProperty('--near', near.toFixed(3));
    vis.classList.toggle('close', near > 0.7);
  }
  // The box's fill (from the start line down to the thumb) and the power number beside the box
  // on the side away from the club, level with the thumb. The number shows the depth on the way
  // back and the power (the deepest point) on the way down.
  function drawBox(fd) {
    const r = zone.liveRect || zone.rest;
    if (!r) return;
    const l = zone.live;
    const startY = (zone.press ? zone.press.y : r.y + START) - r.y;
    const fillH = clamp(fd * zone.travel, 0, Math.max(0, r.h - startY - 3));
    Object.assign(bfill.style, { top: `${Math.round(startY)}px`, height: `${Math.round(fillH)}px` });
    // Only while a swing is under way (not on the frame that completes or cancels it).
    const swinging = !!zone.mode && (l.phase === 'back' || l.phase === 'down');
    pct.classList.toggle('on', swinging);
    if (!swinging) return;
    const power = l.phase === 'down' ? l.top : l.depth;
    pct.textContent = `${Math.round(clamp(power, 0, 1) * 100)}%`;
    const lefty = zone.hand === 'left';
    const y = clamp(r.y + startY + fillH - 10, r.y, r.y + r.h - 20);
    Object.assign(pct.style, { top: `${Math.round(y)}px`, left: lefty ? 'auto' : `${Math.round(r.x + r.w + 8)}px`, right: lefty ? `${Math.round((parent.clientWidth || window.innerWidth) - r.x + 8)}px` : 'auto' });
  }
  // The tempo ring, per frame: fills over the backswing, empties three times as fast after the
  // top, so a 3 to 1 swing reaches the line as it empties.
  function drawTempo(now) {
    const l = zone.live;
    if (l.phase === 'back') {
      if (tempo.phase !== 'back') { tempo.start = now; tempo.top = now; tempo.maxDepth = 0; }
      if (l.depth > (tempo.maxDepth || 0) + 0.004) { tempo.maxDepth = l.depth; tempo.top = now; }
      tempo.level = clamp((tempo.top - tempo.start) / BACK_REF, 0, 1);
    } else if (l.phase === 'down') {
      if (tempo.phase !== 'down') tempo.downFrom = tempo.level;
      const back = Math.max(1, tempo.top - tempo.start), down = now - tempo.top;
      tempo.level = (tempo.downFrom || 0) * clamp(1 - down / (back / 3), 0, 1);
    } else tempo.level = 0;
    tempo.phase = l.phase;
    tempoRing.style.setProperty('--tempo', tempo.level.toFixed(3));
    track.classList.toggle('tempo-on', l.phase === 'back' || l.phase === 'down');
    bring.style.setProperty('--tempo', tempo.level.toFixed(3));
    vis.classList.toggle('tempo-on', l.phase === 'back' || l.phase === 'down');
  }
  // The power guide: a warm mark on the track, or a small notch on the box's edge at the
  // suggested depth (never a line across the box).
  zone.setIdeal = (power) => {
    if (!Number.isFinite(power) || power <= 0) { ideal.style.display = 'none'; bguide.style.display = 'none'; return; }
    ideal.style.display = '';
    ideal.style.top = `${clamp(power, 0, 1) * zone.travel - 1.5}px`;
    const r = zone.liveRect || zone.rest;
    if (!r) { bguide.style.display = 'none'; return; }
    const startY = (zone.press ? zone.press.y : r.y + START) - r.y;
    const top = startY + clamp(power, 0, 1) * zone.travel;
    bguide.style.display = top < r.h - 2 ? '' : 'none';
    bguide.style.top = `${Math.round(top - 1.5)}px`;
  };
  zone.track = track;
  zone.setMouse = (on) => { zone.mouse = !!on; el.classList.toggle('mouse', zone.mouse); track.classList.toggle('mouse', zone.mouse); };
  zone.setEnabled = (on) => {
    zone.enabled = !!on;
    el.classList.toggle('disabled', !on);
    track.classList.toggle('disabled', !on);
    vis.classList.toggle('disabled', !on);
    if (!on && zone.mode) zone.cancel();
  };
  zone.feedback = (text) => {
    fb.textContent = text || '';
    fb.classList.toggle('on', !!text);
    clearTimeout(zone._fbT);
    if (text) zone._fbT = setTimeout(() => fb.classList.remove('on'), 1400);
  };
  const setLive = (phase, depth, top, face = 0, path = 0) => {
    const l = zone.live, was = l.phase;
    l.phase = phase; l.depth = depth; l.top = top; l.face = face; l.path = path;
    // The first-run tutorial follows the swing's phase (ui/screens.js).
    if (phase !== was && zone.onPhase) zone.onPhase(phase);
  };
  // The press point marker (mouse): the chevron and the start line follow the hover point and
  // stay where the press was until the swing ends.
  const setMark = (x, y) => { if (x == null) { el.style.removeProperty('--cx'); el.style.removeProperty('--cy'); return; } el.style.setProperty('--cx', `${Math.round(x)}px`); el.style.setProperty('--cy', `${Math.round(y)}px`); };
  // The box's outline: quiet inside, lit (and one pulse, and a short tick on a touch screen)
  // when the pointer leaves the box during a swing, quiet again when it comes back.
  const setOutline = (state, pointerType) => {
    if (state === zone.outline) return;
    zone.outline = state;
    const out = state === 'outside';
    vis.classList.toggle('outside', out);
    if (out) {
      vis.classList.remove('pulse');
      void vis.offsetWidth; // restart the one pulse
      vis.classList.add('pulse');
      if (haptic && pointerType !== 'mouse') haptic(10);
    }
  };
  const restAfterSwing = () => {
    el.classList.remove('hover'); setMark(null); if (zone.wide) zone.placeTrack();
    zone.press = null; zone.liveRect = null; zone.hoverX = null;
    setOutline('inside');
    vis.classList.remove('active', 'pulse', 'hover');
    pct.classList.remove('on');
    placeVis();
  };
  zone.cancel = () => {
    restAfterSwing();
    if (zone.gesture) zone.gesture.cancel();
    zone.meter.cancel();
    zone.mode = null; zone.pointerId = null;
    el.classList.remove('active'); track.classList.remove('active');
    setLive('address', 0, 0);
    draw(0);
    flushLayout();
  };

  function complete(result) {
    restAfterSwing();
    zone.lastResult = result;
    zone.mode = null;
    el.classList.remove('active'); track.classList.remove('active');
    draw(0);
    if (haptic) haptic(result.tempoGrade === 'perfect' ? [12, 30, 18] : 16);
    zone.feedback(result.tempoLabel);
    setLive('impact', 0, zone.live.top, result.face, result.path);
    onSwing(result);
    setLive('address', 0, 0);
    flushLayout();
  }
  function cancelled() {
    restAfterSwing();
    zone.mode = null;
    el.classList.remove('active'); track.classList.remove('active');
    setLive('address', 0, 0);
    draw(0);
    flushLayout();
    if (onCancel) onCancel();
  }
  function liveFromGesture(st) {
    const phase = st.phase === PHASE.BACK ? 'back' : st.phase === PHASE.DOWN ? 'down' : 'address';
    const fp = phase === 'down' ? liveFaceAndPath(st, { ...SWING_DEFAULTS, travel: zone.travel }, swingHand() === 'left') : { face: 0, path: 0 };
    setLive(phase, clamp(st.depth, 0, 1), st.maxDepth, fp.face, fp.path);
  }

  // --- pointer ---
  let refiner = null;
  const local = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  el.addEventListener('pointerdown', (e) => {
    if (!zone.enabled || zone.mode) return;
    // The box: a press inside starts the swing, a press outside does not (the zone element is
    // the box, so this is a guard for its rounded corners and for synthetic events).
    if (zone.boxMode() && !inBox(zone.rest, e.clientX, e.clientY)) return;
    if (zone.onPointerType) zone.onPointerType(e.pointerType);
    e.preventDefault();
    e.stopPropagation();
    zone.pointerId = e.pointerId;
    zone.pointerType = e.pointerType;
    if (e.pointerType === 'mouse') {
      // The swing starts where the button went down: the start line, the chevron and (on a
      // desktop) the track move there.
      const q = local(e);
      setMark(q.x, q.y);
      // The HUD fills the viewport, so client coordinates are the track's coordinates.
      if (zone.wide) zone.trackAt(settings.handedness === 'left' ? e.clientX - 46 : e.clientX + 36, e.clientY);
    }
    try { el.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    zone.mode = 'pointer';
    el.classList.add('active'); track.classList.add('active');
    if (zone.boxMode()) {
      // The box centres on the press point; the ring sits where the press began.
      zone.press = { x: e.clientX, y: e.clientY };
      zone.liveRect = liveBox(zone.rest, e.clientX);
      zone.outline = 'inside';
      vis.classList.add('active');
      placeVis();
    }
    if (zone.onStart) zone.onStart();
    const p = local(e);
    zone.gesture.down(p.x, p.y, e.timeStamp);
    // A mouse's samples go through the refiner (ui/mouseRefine.js) so the tempo reads the same
    // at any polling rate; touch samples go straight in, as before.
    refiner = e.pointerType === 'mouse' ? createMouseRefiner() : null;
    if (refiner) refiner.start(p.x, p.y, e.timeStamp);
    if (haptic) haptic(6);
    zone.feedback('');
  });
  el.addEventListener('pointermove', (e) => {
    // Hover (mouse, no button): preview the start point under the cursor.
    if (!zone.mode && e.pointerType === 'mouse' && zone.enabled) {
      const q = local(e); el.classList.add('hover'); setMark(q.x, q.y);
      if (zone.boxMode()) { zone.hoverX = e.clientX; vis.classList.add('hover'); placeVis(); }
      return;
    }
    if (zone.mode !== 'pointer' || e.pointerId !== zone.pointerId) return;
    e.preventDefault();
    // The pointer left the window during the swing: cancel safely, nothing is hit.
    if (e.pointerType === 'mouse' && outside(e)) { leaveCancel(); return; }
    // The box's outline, and the cancel when the pointer is far outside it.
    if (zone.boxMode() && zone.liveRect) {
      const s = boxState(zone.liveRect, e.clientX, e.clientY);
      if (s.state === 'cancel') { leaveCancel(); return; }
      setOutline(s.state, e.pointerType);
    }
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const samples = list && list.length ? list : [e];
    let st = zone.gesture.state;
    for (const s of samples) {
      const p = local(s);
      const pts = refiner ? refiner.push(p.x, p.y, s.timeStamp) : [{ x: p.x, y: p.y, t: s.timeStamp }];
      for (const q of pts) { st = zone.gesture.move(q.x, q.y, q.t); if (st.phase === PHASE.DONE || st.phase === PHASE.CANCELLED) break; }
      if (st.phase === PHASE.DONE || st.phase === PHASE.CANCELLED) break;
    }
    if (st.phase === PHASE.DONE) { try { el.releasePointerCapture(e.pointerId); } catch { /* fine */ } complete(st.result); return; }
    if (st.phase === PHASE.CANCELLED) { cancelled(); return; }
    if (st.phase === PHASE.BACK && haptic && st.depth >= 1 && !zone._buzzTop) { zone._buzzTop = true; haptic(8); }
    if (st.phase !== PHASE.BACK) zone._buzzTop = false;
    liveFromGesture(st);
    draw(st.depth);
  });
  const end = (e) => {
    if (zone.mode !== 'pointer' || e.pointerId !== zone.pointerId) return;
    const p = local(e);
    if (refiner && e.type !== 'pointercancel') { for (const q of refiner.flush()) { const st0 = zone.gesture.move(q.x, q.y, q.t); if (st0.phase === PHASE.DONE) { complete(st0.result); return; } } }
    const st = e.type === 'pointercancel' ? zone.gesture.cancel() : zone.gesture.up(p.x, p.y, e.timeStamp);
    if (st.phase === PHASE.DONE) complete(st.result); else cancelled();
  };
  el.addEventListener('pointerleave', (e) => {
    if (!zone.mode && e.pointerType === 'mouse') { el.classList.remove('hover'); setMark(null); zone.hoverX = null; vis.classList.remove('hover'); placeVis(); }
  });
  const outside = (e) => e.clientX < 0 || e.clientY < 0 || e.clientX >= (window.innerWidth || 1) || e.clientY >= (window.innerHeight || 1);
  function leaveCancel() {
    if (zone.mode !== 'pointer') return;
    const id = zone.pointerId;
    if (zone.gesture) zone.gesture.cancel();
    try { el.releasePointerCapture(id); } catch { /* fine */ }
    cancelled();
    zone.feedback('Swing cancelled');
  }
  zone.leaveCancel = leaveCancel;
  // The mouse left the page, the window lost focus or the tab was hidden: cancel a mouse swing.
  document.documentElement.addEventListener('mouseleave', () => { if (zone.pointerType === 'mouse') leaveCancel(); });
  window.addEventListener('blur', () => { if (zone.mode === 'pointer') leaveCancel(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && zone.mode === 'pointer') leaveCancel(); });
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', (e) => { if (zone.mode === 'pointer' && e.pointerId === zone.pointerId) end(e); });

  // --- three-press meter (keyboard Space, gamepad A) ---
  zone.meterPress = (t = performance.now()) => {
    if (!zone.enabled) return;
    if (zone.mode === 'pointer') return;
    const st = zone.meter.press(t);
    if (st.phase === PHASE.BACK) { zone.mode = 'meter'; el.classList.add('active'); track.classList.add('active'); zone.feedback(''); }
    else if (st.phase === PHASE.DONE) complete(st.result);
    else if (st.phase === PHASE.CANCELLED) cancelled();
  };
  // Space and a controller's A: hold for the backswing, release at the top, press again for
  // impact (the same meter, the second press on the release).
  zone.meterDown = (t = performance.now()) => {
    if (!zone.enabled || zone.mode === 'pointer') return;
    if (zone.mode === 'meter' && zone.meter.state.phase === PHASE.BACK) return;
    zone.meterPress(t);
  };
  zone.meterUp = (t = performance.now()) => {
    if (zone.mode === 'meter' && zone.meter.state.phase === PHASE.BACK) zone.meterPress(t);
  };
  el.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) zone.meterDown(e.timeStamp); } });
  el.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); zone.meterUp(e.timeStamp); } });

  // Called every frame: the meter animation and the power guide.
  zone.update = () => {
    if (zone.mode === 'meter') {
      const t = performance.now();
      const st = zone.meter.expire(t);
      if (st.phase === PHASE.DONE) { complete(st.result); return; }
      if (st.phase === PHASE.CANCELLED) { cancelled(); return; }
      const m = zone.meter.meter(t);
      if (st.phase === PHASE.BACK) setLive('back', clamp(m, 0, 1), clamp(m, 0, 1));
      else setLive('down', clamp(m, 0, 1), st.power, 0, 0);
      draw(m);
    }
    if (getIdeal) zone.setIdeal(getIdeal());
    drawTempo(performance.now());
    if (zone.mode === 'pointer') draw(zone.live.depth);
  };
  zone.relayout = () => { const a = zone.area || zone.box; if (a && a.h) zone.layout(a); };
  zone.flushLayout = flushLayout;
  zone.fbEl = fb;
  zone.onStart = null;
  zone.onPhase = null;
  zone.vis = vis;
  zone.pctEl = pct;
  draw(0);
  return zone;
}
