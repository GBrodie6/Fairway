// UI coordinator: owns the HUD, the hole map, input routing, and the screens, and turns
// game events into calm feedback (toasts, haptics, audio cues).
import './styles.css';
import { h, iconButton } from './dom.js';
import { createHud } from './hud.js';
import { createHoleMap } from './map.js';
import { createInput } from './input.js';
import { createScreens } from './screens.js';
import { fmtDist, fmtShort } from './format.js';
import { SURFACE_NAMES } from '../physics/surfaces.js';
import { saveSettings } from '../core/settings.js';
import { headingTo } from '../core/math.js';

export function createUI(app) {
  const root = document.getElementById('ui');
  const { game, settings } = app;
  const getWorld = () => app.world;
  const haptic = (pattern) => {
    if (!settings.haptics) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* not supported */ }
    if (ui.input) ui.input.rumble(Array.isArray(pattern) ? 0.6 : 0.35, Array.isArray(pattern) ? 90 : 40);
  };
  const ui = { root, modal: null };
  const actions = {
    map: () => { if (game.state.round) ui.map.toggle(); },
    pause: () => { if (game.state.round && !ui.modal) ui.screens.pause(); },
    replay: () => { if (game.replay('follow')) ui.hud.toast('Replay', 'Tap to return', 1400); },
    resetAim: () => {
      const st = game.state;
      if (st.target && st.phase === 'aim') game.setAim(headingTo(st.ball.x, st.ball.z, st.target.x, st.target.z));
      ui.input.setLook(false);
    },
    toggleLook: () => ui.input.setLook(!ui.input.look),
    continue: () => game.continue(),
    escape: () => {
      if (ui.map.open) { ui.map.close(); return; }
      if (game.state.phase === 'replay') { game.endReplay(); return; }
      if (ui.modal) { ui.screens.back(); return; }
      if (game.state.round) ui.screens.pause();
    },
    modalOpen: () => !!ui.modal || ui.map.open,
  };
  ui.hud = createHud(root, { game, settings, haptic, actions });
  ui.map = createHoleMap(root, { getWorld, game, settings });
  ui.input = createInput({ view: app.engine.renderer.domElement.parentElement || app.engine.renderer.domElement, game, getWorld, settings, hud: ui.hud, actions, haptic });
  ui.screens = createScreens(root, { app, game, settings, ui, save: () => saveSettings(settings) });

  // --- game events to feedback ---
  let lipped = false;
  game.on((type, d) => {
    const u = settings.units;
    switch (type) {
      case 'phase':
        if (d === 'summary') ui.screens.holeSummary(game.state.holeSummary);
        if (d === 'done') ui.screens.roundEnd(game.state.round);
        if (d === 'menu') ui.screens.menu();
        if (d === 'aim') ui.screens.maybeTutorial();
        if (d !== 'aim' && ui.map.open) ui.map.close();
        break;
      case 'hole':
        ui.map.invalidate();
        ui.hud.toast(`Hole ${d.number}`, `Par ${d.par}  ${fmtDist(d.yards * 0.9144, u)}`, 2600);
        break;
      case 'turn': {
        const r = game.state.round;
        if (r.players.length > 1) ui.hud.toast(`${r.players[d.player].name} to play`, d.human ? '' : 'Watching', 1500);
        break;
      }
      case 'swing':
        if (d.human) ui.hud.stick.feedback(d.swing.tempoLabel);
        break;
      case 'holed': haptic([20, 40, 30]); break;
      case 'lip': lipped = true; break;
      case 'splash': haptic(30); break;
      case 'shotEnd': {
        const s = d;
        const lip = lipped; lipped = false;
        if (s.outcome.holed) { ui.hud.toast(s.message, `${s.strokes} ${s.strokes === 1 ? 'stroke' : 'strokes'}`, 2600); break; }
        if (lip && s.outcome.putt) { ui.hud.toast('Lipped out', `${fmtShort(s.distToPin, u)} left`, 2400); break; }
        const sub = s.outcome.putt ? `${fmtShort(s.distToPin, u)} left` : `Carry ${fmtDist(s.outcome.carry, u)}  Total ${fmtDist(s.outcome.total, u)}  ${fmtDist(s.distToPin, u)} to pin`;
        ui.hud.toast(s.message || SURFACE_NAMES[s.outcome.lie], sub, 2600);
        break;
      }
      default: break;
    }
  });

  // The replay ends on any tap.
  root.addEventListener('pointerdown', () => { if (game.state.phase === 'replay') game.endReplay(); });
  app.engine.renderer.domElement.addEventListener('pointerdown', () => { if (game.state.phase === 'replay') game.endReplay(); });

  ui.update = (dt) => {
    ui.input.update(dt);
    ui.hud.update();
    if (ui.map.open) ui.map.draw();
  };
  ui.applySettings = () => {
    ui.hud.setLayout();
    if (app.world && app.world.overlays) app.world.overlays.setPalette(settings.colorblind);
    if (app.world && app.world.rig) app.world.rig.reducedMotion = !!settings.reducedMotion;
    if (app.world && app.world.ball) app.world.ball.setSpinViz(!!settings.spinViz);
    if (app.audio) app.audio.applySettings(settings);
  };
  ui.iconButton = iconButton;
  ui.h = h;
  return ui;
}
