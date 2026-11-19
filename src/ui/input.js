// Input routing outside the swing stick: drag on the course to aim (or to look around),
// keyboard, and gamepad. Every handler goes through the same game methods the buttons use,
// and every value is checked for finiteness before it reaches the game.
import { dragToAimDelta } from '../physics/aim.js';
import { clamp, smoothstep, DEG } from '../core/math.js';

export function createInput({ view, game, getWorld, settings, hud, actions, haptic }) {
  const input = { look: false, dragging: false, gamepad: null };

  // --- drag on the course ---
  // Slow drags are fine adjustments: the gain falls to a fifth below about 0.05 px/ms.
  let drag = null;
  view.addEventListener('pointerdown', (e) => {
    const ph = game.state.phase;
    if (ph !== 'aim' && !(input.look && ph !== 'menu')) { if (ph === 'intro') game.skipIntro(); return; }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    // Touching the course to aim puts the shot card away and brings the fan back.
    if (hud.hideShotCard) hud.hideShotCard();
    try { view.setPointerCapture(e.pointerId); } catch { /* fine */ }
    input.dragging = true;
  });
  view.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(1, e.timeStamp - drag.t);
    drag.x = e.clientX; drag.y = e.clientY; drag.t = e.timeStamp;
    if (![dx, dy, dt].every(Number.isFinite)) return;
    const w = view.clientWidth || window.innerWidth;
    if (input.look) { getWorld().rig.look((-dx / w) * 3.2, (dy / w) * 2.2); return; }
    const speed = Math.abs(dx) / dt;
    const gain = 0.2 + 0.8 * smoothstep(0.05, 0.6, speed);
    const putter = game.state.club.putter;
    const d = dragToAimDelta(dx, w, { sensitivity: settings.aimSensitivity, sweepDeg: putter ? 24 : 70 }) * gain;
    if (d) game.nudgeAim(d);
  });
  const endDrag = (e) => { if (drag && e.pointerId === drag.id) { drag = null; input.dragging = false; } };
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);
  // Mouse wheel: fine aim on desktop.
  view.addEventListener('wheel', (e) => { if (game.state.phase === 'aim' && Number.isFinite(e.deltaY)) { e.preventDefault(); game.nudgeAim(clamp(e.deltaY, -60, 60) * 0.004 * DEG * 10); } }, { passive: false });

  // --- keyboard ---
  // Every shortcut is listed on the Controls screen (? opens it). None fires while typing in a
  // text field. Space swings like the drag: hold for the backswing, release at the top, press
  // again for impact.
  const typing = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  const plain = (e) => !e.ctrlKey && !e.metaKey && !e.altKey;
  const spinStep = (dx, dy) => {
    const s = game.spin(), R = game.spinRange();
    if (!R) return;
    const k = Math.max(0.05, R / 5);
    game.setSpin(s.x + dx * k, s.y + dy * k);
  };
  const cycleShot = (dir) => {
    const types = game.shotTypes();
    if (!types.length) return;
    const i = Math.max(0, types.findIndex((t) => t.id === game.state.shotType.id));
    game.setShotType(types[(i + dir + types.length) % types.length].id);
  };
  input.keys = { held: new Set() };
  window.addEventListener('keydown', (e) => {
    if (typing(e.target)) return;
    const ph = game.state.phase;
    const k = e.code;
    if (k === 'Escape') { e.preventDefault(); actions.escape(); return; }
    // F: fullscreen, anywhere (menus too), never with a modifier (Ctrl+F is the browser's find).
    if (k === 'KeyF' && plain(e) && actions.fullscreen) { e.preventDefault(); actions.fullscreen(); return; }
    // ?: the shortcuts overlay, anywhere.
    if ((e.key === '?' || (k === 'Slash' && e.shiftKey)) && !e.ctrlKey && !e.metaKey && actions.shortcuts) { e.preventDefault(); actions.shortcuts(); return; }
    // Tab closes the scorecard it opened.
    if (k === 'Tab' && plain(e) && !e.shiftKey && actions.scorecardOpen && actions.scorecardOpen()) { e.preventDefault(); actions.scorecard(); return; }
    // M closes the map it opened.
    if (k === 'KeyM' && plain(e) && actions.mapOpen && actions.mapOpen()) { e.preventDefault(); actions.map(); return; }
    if (actions.modalOpen()) return;
    if (k === 'Tab' && plain(e) && !e.shiftKey && game.state.round && ph !== 'menu') { e.preventDefault(); actions.scorecard(); return; }
    if (ph === 'intro' && (k === 'Space' || k === 'Enter')) { e.preventDefault(); game.skipIntro(); return; }
    if (ph === 'summary' && (k === 'Enter' || k === 'Space')) { e.preventDefault(); actions.continue(); return; }
    if (ph === 'replay') {
      if (k === 'Space' || k === 'Enter' || k === 'KeyZ') { e.preventDefault(); game.endReplay(); return; }
      if (k === 'KeyC' && actions.replayAngle) { e.preventDefault(); actions.replayAngle(); return; }
      return;
    }
    if (ph !== 'aim') return;
    if (!plain(e) && !(e.shiftKey && !e.ctrlKey && !e.metaKey)) return;
    const fine = e.shiftKey ? 0.1 : 0.5;
    switch (k) {
      case 'KeyA': e.preventDefault(); game.nudgeAim(-fine * DEG); break;
      case 'KeyD': e.preventDefault(); game.nudgeAim(fine * DEG); break;
      // Arrows: left and right aim, up and down change club; with Shift they move the spin dot.
      case 'ArrowLeft': e.preventDefault(); if (e.shiftKey) spinStep(-1, 0); else game.nudgeAim(-0.5 * DEG); break;
      case 'ArrowRight': e.preventDefault(); if (e.shiftKey) spinStep(1, 0); else game.nudgeAim(0.5 * DEG); break;
      case 'ArrowUp': e.preventDefault(); if (e.shiftKey) spinStep(0, 1); else game.selectClub(-1); break;
      case 'ArrowDown': e.preventDefault(); if (e.shiftKey) spinStep(0, -1); else game.selectClub(1); break;
      case 'KeyW': e.preventDefault(); game.selectClub(-1); break;
      case 'KeyS': e.preventDefault(); game.selectClub(1); break;
      case 'KeyQ': e.preventDefault(); cycleShot(-1); break;
      case 'KeyE': e.preventDefault(); cycleShot(1); break;
      case 'KeyR': e.preventDefault(); if (e.shiftKey) game.setSpin(0, 0); else actions.resetAim(); break;
      case 'Space': e.preventDefault(); if (!e.repeat) { input.keys.held.add('Space'); hud.stick.meterDown(e.timeStamp); } break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': {
        const types = game.shotTypes(); const t = types[Number(k.slice(5)) - 1]; if (t) game.setShotType(t.id); break;
      }
      case 'KeyM': actions.map(); break;
      case 'KeyB': actions.clubList(); break;
      case 'KeyZ': actions.replay(); break;
      case 'KeyC': case 'KeyL': actions.toggleLook(); break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && input.keys.held.has('Space')) { input.keys.held.delete('Space'); if (!typing(e.target)) { e.preventDefault(); hud.stick.meterUp(e.timeStamp); } }
  });

  // --- gamepad ---
  // Standard mapping: A meter, B back, X map, Y replay, LB/RB club, LT/RT shot type, Select
  // club list, d-pad and left stick aim, right stick look, Start pause.
  const prevButtons = [];
  const pressed = (gp, i) => { const b = gp.buttons[i]; const now = !!(b && (b.pressed || b.value > 0.5)); const was = !!prevButtons[i]; prevButtons[i] = now; return now && !was; };
  window.addEventListener('gamepadconnected', (e) => { input.gamepad = e.gamepad.index; hud.toast('Controller connected', 'A to swing, sticks to aim and look', 2600); });
  window.addEventListener('gamepaddisconnected', () => { input.gamepad = null; });
  input.rumble = (strength = 0.5, ms = 60) => {
    if (input.gamepad == null || !navigator.getGamepads) return;
    const gp = navigator.getGamepads()[input.gamepad];
    const act = gp && gp.vibrationActuator;
    if (act && act.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
  };
  input.update = (dt) => {
    if (input.gamepad == null || !navigator.getGamepads) return;
    const gp = navigator.getGamepads()[input.gamepad];
    if (!gp) return;
    const ph = game.state.phase;
    const ax = (i) => { const v = gp.axes[i] || 0; return Math.abs(v) < 0.16 ? 0 : v; };
    const presses = [];
    for (let i = 0; i < gp.buttons.length; i++) presses[i] = pressed(gp, i);
    if (presses[9]) actions.pause();
    if (presses[1]) actions.escape();
    if (actions.modalOpen()) return;
    if (ph === 'intro' && presses[0]) game.skipIntro();
    if (ph === 'summary' && presses[0]) actions.continue();
    if (ph === 'replay' && (presses[0] || presses[3])) game.endReplay();
    const lx = ax(2), ly = ax(3);
    if (lx || ly) getWorld().rig.look(-lx * 1.8 * dt, ly * 1.2 * dt);
    if (ph !== 'aim') return;
    // The pad's own timestamp is when the button changed, which is closer to the press than
    // the frame that polled it.
    if (presses[0]) hud.stick.meterPress(gp.timestamp > 0 ? gp.timestamp : performance.now());
    if (presses[2]) actions.map();
    if (presses[8]) actions.clubList();
    if (presses[3]) actions.replay();
    if (presses[4]) game.selectClub(-1);
    if (presses[5]) game.selectClub(1);
    if (presses[6] || presses[7]) {
      const types = game.shotTypes();
      const i = types.findIndex((t) => t.id === game.state.shotType.id);
      if (types.length) game.setShotType(types[(i + (presses[7] ? 1 : types.length - 1)) % types.length].id);
    }
    if (presses[14]) game.nudgeAim(-0.25 * DEG);
    if (presses[15]) game.nudgeAim(0.25 * DEG);
    const sx = ax(0);
    if (sx) game.nudgeAim(Math.sign(sx) * sx * sx * 22 * DEG * dt * (game.state.club.putter ? 0.35 : 1));
  };
  input.setLook = (on) => { input.look = !!on; hud.setLook(input.look); if (!input.look) getWorld().rig.resetLook(); };
  return input;
}
