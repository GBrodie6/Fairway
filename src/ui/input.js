// Input routing outside the swing stick: drag on the course to aim (or to look around),
// keyboard, and gamepad. Every handler goes through the same game methods the buttons use,
// and every value is checked for finiteness before it reaches the game.
import { dragToAimDelta } from '../physics/aim.js';
import { clamp, smoothstep, DEG } from '../core/math.js';
import { createPadNav } from './padNav.js';

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
  // Standard mapping (any controller the browser reports as "standard": Xbox, PlayStation,
  // Switch Pro and most others). Every binding is listed on the Controls screen.
  //   in a round    left stick or d-pad left and right aim, d-pad up and down or LB and RB the
  //                 club, LT and RT the shot type, A hold for the backswing, release at the top,
  //                 press again for impact, right stick the ball contact dot (click it to
  //                 centre), L3 look around (the right stick looks while it is on), X map,
  //                 Y replay, View the club list, Menu pause, B back
  //   menus, lists  d-pad or left stick move, A choose, B back, right stick scroll; a focused
  //                 select or slider takes left and right
  //   level editor  as menus for its buttons; on the map the left stick moves the selected
  //                 piece, LB and RB select, X deletes, Y undo, View redo, LT and RT zoom, the
  //                 right stick pans
  const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const nav = createPadNav();
  const prevButtons = [];
  let lastScan = 0, repeat = { dir: null, next: 0 };
  input.padActive = false;
  const setPadMode = (on) => {
    if (input.padActive === on) return;
    input.padActive = on;
    document.documentElement.classList.toggle('padnav', on);
    if (hud.setPadMode) hud.setPadMode(on);
  };
  const connect = (index) => {
    if (!Number.isInteger(index)) return;
    const first = input.gamepad == null;
    input.gamepad = index;
    setPadMode(true);
    if (first) hud.toast('Controller connected', 'Hold A to swing. The button hints show while you use it', 2800);
  };
  window.addEventListener('gamepadconnected', (e) => connect(e.gamepad && e.gamepad.index));
  window.addEventListener('gamepaddisconnected', (e) => { if (!e.gamepad || e.gamepad.index === input.gamepad) { input.gamepad = null; setPadMode(false); } });
  // The mouse, a finger or the keyboard hide the hints until the controller is used again.
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => setPadMode(false), { passive: true, capture: true });
  input.rumble = (strength = 0.5, ms = 60) => {
    if (input.gamepad == null || !navigator.getGamepads) return;
    const gp = navigator.getGamepads()[input.gamepad];
    const act = gp && gp.vibrationActuator;
    if (act && act.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
  };
  // Held d-pad (or stick past halfway): a first move, then repeats after a pause. A repeat also
  // needs the button seen held on two more polls, so a quick tap on a very slow machine (a frame
  // longer than the pause) never counts as a hold.
  function repeated(held, pressedDir, now) {
    if (pressedDir) { repeat = { dir: pressedDir, next: now + 380, polls: 0 }; return pressedDir; }
    if (!held) { repeat.dir = null; return null; }
    if (repeat.dir !== held) { repeat = { dir: held, next: now + 380, polls: 0 }; return held; }
    repeat.polls = (repeat.polls || 0) + 1;
    if (now >= repeat.next && repeat.polls >= 2) { repeat.next = now + 120; return held; }
    return null;
  }
  input.update = (dt) => {
    if (!navigator.getGamepads) return;
    if (input.gamepad == null) {
      // A controller plugged in before the page opened shows up after its first button press,
      // and not every browser fires the event for it: look for one twice a second.
      const now = performance.now();
      if (now - lastScan < 500) return;
      lastScan = now;
      for (const p of navigator.getGamepads() || []) if (p && p.connected !== false) { connect(p.index); break; }
      if (input.gamepad == null) return;
    }
    const gp = navigator.getGamepads()[input.gamepad];
    if (!gp || !Number.isFinite(dt)) return;
    const ax = (i) => { const v = Number(gp.axes[i]) || 0; return Math.abs(v) < 0.16 ? 0 : clamp(v, -1, 1); };
    const down = [], presses = [], releases = [];
    for (let i = 0; i < gp.buttons.length; i++) {
      const b = gp.buttons[i], now = !!(b && (b.pressed || b.value > 0.5)), was = !!prevButtons[i];
      prevButtons[i] = now; down[i] = now; presses[i] = now && !was; releases[i] = !now && was;
    }
    if (presses.some(Boolean) || [0, 1, 2, 3].some((i) => Math.abs(ax(i)) > 0.5)) setPadMode(true);
    // The pad's own timestamp is when its state changed, which is closer to the press than the
    // frame that polled it.
    const t = gp.timestamp > 0 ? gp.timestamp : performance.now();
    const ph = game.state.phase;
    if (releases[PAD.A]) hud.stick.meterUp(t);
    if (presses[PAD.MENU]) actions.pause();
    if (presses[PAD.B]) actions.escape();
    const now = performance.now();
    const pressedDir = presses[PAD.UP] ? 'up' : presses[PAD.DOWN] ? 'down' : presses[PAD.LEFT] ? 'left' : presses[PAD.RIGHT] ? 'right' : null;
    const heldPad = down[PAD.UP] ? 'up' : down[PAD.DOWN] ? 'down' : down[PAD.LEFT] ? 'left' : down[PAD.RIGHT] ? 'right' : null;
    // Menus, the map, the club list, the shot panel and the level editor's buttons.
    const navRoot = actions.navRoot ? actions.navRoot() : null;
    const ed = navRoot && actions.editorPad ? actions.editorPad() : null;
    const editing = !!(ed && ed.active());
    if (hud.setPadBar) hud.setPadBar(input.padActive && navRoot ? (editing ? 'editor' : 'menu') : null);
    if (navRoot) {
      const lx = ax(0), ly = ax(1);
      const heldStick = editing ? null : Math.abs(ly) > 0.6 && Math.abs(ly) >= Math.abs(lx) ? (ly > 0 ? 'down' : 'up') : Math.abs(lx) > 0.6 ? (lx > 0 ? 'right' : 'left') : null;
      const dir = repeated(heldPad || heldStick, pressedDir, now);
      if (dir) nav.move(navRoot, dir);
      if (presses[PAD.A]) nav.activate(navRoot);
      if (presses[PAD.X] && actions.mapOpen && actions.mapOpen()) actions.escape();
      if (presses[PAD.VIEW] && hud.clubListOpen && hud.clubListOpen()) actions.escape();
      if (editing) ed.pad({ dt, lx, ly, rx: ax(2), ry: ax(3), presses, PAD });
      else { const ry = ax(3); if (ry) nav.scroll(navRoot, ry * 900 * dt); }
      return;
    }
    if (ph === 'intro' && presses[PAD.A]) game.skipIntro();
    if (ph === 'summary' && presses[PAD.A]) actions.continue();
    if (ph === 'replay') {
      if (presses[PAD.A] || presses[PAD.Y]) game.endReplay();
      else if (presses[PAD.X] && actions.replayAngle) actions.replayAngle();
    }
    const rx = ax(2), ry = ax(3);
    const lookOn = !!(getWorld().rig && getWorld().rig.mode === 'peek');
    if ((ph !== 'aim' || lookOn) && (rx || ry)) getWorld().rig.look(-rx * 1.8 * dt, ry * 1.2 * dt);
    if (ph !== 'aim') return;
    if (presses[PAD.A]) hud.stick.meterDown(t);
    if (presses[PAD.L3]) actions.toggleLook();
    if (presses[PAD.X]) actions.map();
    if (presses[PAD.VIEW]) actions.clubList();
    if (presses[PAD.Y]) actions.replay();
    if (presses[PAD.LB] || presses[PAD.UP]) game.selectClub(-1);
    if (presses[PAD.RB] || presses[PAD.DOWN]) game.selectClub(1);
    if (presses[PAD.LT]) cycleShot(-1);
    if (presses[PAD.RT]) cycleShot(1);
    // The d-pad aims in fine steps (held: repeats); the left stick aims faster the further it goes.
    const aimDir = repeated(heldPad === 'left' || heldPad === 'right' ? heldPad : null, pressedDir === 'left' || pressedDir === 'right' ? pressedDir : null, now);
    if (aimDir) game.nudgeAim((aimDir === 'left' ? -0.25 : 0.25) * DEG);
    const sx = ax(0);
    if (sx) game.nudgeAim(Math.sign(sx) * sx * sx * 22 * DEG * dt * (game.state.club.putter ? 0.35 : 1));
    // The right stick moves the ball contact dot (up adds backspin); R3 centres it.
    if (!lookOn && (rx || ry)) {
      const s = game.spin(), R = game.spinRange();
      if (R) game.setSpin(s.x + rx * R * 1.4 * dt, s.y - ry * R * 1.4 * dt);
    }
    if (presses[PAD.R3]) game.setSpin(0, 0);
  };
  input.setLook = (on) => { input.look = !!on; hud.setLook(input.look); if (!input.look) getWorld().rig.resetLook(); };
  return input;
}
