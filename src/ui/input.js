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
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    const ph = game.state.phase;
    const k = e.code;
    if (k === 'Escape') { e.preventDefault(); actions.escape(); return; }
    // F: fullscreen, anywhere (menus too), never with a modifier (Ctrl+F is the browser's find).
    if (k === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey && actions.fullscreen) { e.preventDefault(); actions.fullscreen(); return; }
    if (actions.modalOpen()) return;
    if (ph === 'intro' && (k === 'Space' || k === 'Enter')) { e.preventDefault(); game.skipIntro(); return; }
    if (ph === 'summary' && (k === 'Enter' || k === 'Space')) { e.preventDefault(); actions.continue(); return; }
    if (ph === 'replay' && (k === 'Space' || k === 'Enter' || k === 'KeyR')) { e.preventDefault(); game.endReplay(); return; }
    if (ph !== 'aim') return;
    const step = e.shiftKey ? 0.1 : e.altKey ? 2 : 0.5;
    switch (k) {
      case 'ArrowLeft': case 'KeyA': e.preventDefault(); game.nudgeAim(-step * DEG); break;
      case 'ArrowRight': case 'KeyD': e.preventDefault(); game.nudgeAim(step * DEG); break;
      case 'ArrowUp': case 'KeyW': e.preventDefault(); game.selectClub(-1); break;
      case 'ArrowDown': case 'KeyS': e.preventDefault(); game.selectClub(1); break;
      case 'Space': e.preventDefault(); if (!e.repeat) hud.stick.meterPress(e.timeStamp); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': {
        const types = game.shotTypes(); const t = types[Number(k.slice(5)) - 1]; if (t) game.setShotType(t.id); break;
      }
      case 'KeyM': actions.map(); break;
      case 'KeyB': actions.clubList(); break;
      case 'KeyR': actions.replay(); break;
      case 'KeyL': actions.toggleLook(); break;
      case 'KeyC': actions.resetAim(); break;
      default: break;
    }
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
