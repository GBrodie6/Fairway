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
  // Reduced motion follows the setting or the operating system preference.
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  app.motionReduced = () => !!settings.reducedMotion || !!(mq && mq.matches);
  if (mq && mq.addEventListener) mq.addEventListener('change', () => ui.applySettings());
  const actions = {
    map: () => { if (game.state.round) ui.map.toggle(); },
    pause: () => { if (game.state.round && !ui.modal) ui.screens.pause(); },
    replay: () => { if (game.replay('follow')) ui.hud.toast('Replay', 'Half speed. Tap the course to return', 1600); },
    resetAim: () => {
      const st = game.state;
      if (st.target && st.phase === 'aim') game.setAim(headingTo(st.ball.x, st.ball.z, st.target.x, st.target.z));
      ui.input.setLook(false);
    },
    clubList: () => { if (game.state.phase === 'aim') ui.hud.toggleClubList(); },
    toggleLook: () => actions.lookHold(!(app.world && app.world.rig.mode === 'peek')),
    // Hold to look: the camera rises and pans over the hole toward the landing area, and comes
    // back to the ball when released.
    lookHold: (on) => {
      const w = app.world;
      if (!w || !w.rig) return;
      if (on && game.state.phase === 'aim') {
        const st = game.state, p = st.prediction;
        const land = p ? (p.carryPoint || p.end) : null;
        w.rig.set('peek', { x: st.ball.x, z: st.ball.z, aim: st.aim, landing: land ? { x: land.x, z: land.z } : null, pin: w.terrain ? { x: w.terrain.pin.x, z: w.terrain.pin.z } : null });
        ui.hud.setLook(true);
      } else if (w.rig.mode === 'peek') {
        game.returnToAddress();
        ui.hud.setLook(false);
      }
    },
    // The HUD's layout says where the ball goes on screen; the address camera frames it there.
    onLayout: ({ ballY, keep }) => { if (app.world && app.world.rig) { app.world.rig.ballScreenY = ballY; app.world.rig.hudKeep = keep; app.world.rig.lefty = settings.handedness === 'left'; } },
    // The drag crossed the start line and the shot is away: the club shows impact this frame.
    onSwing: (res) => { if (app.world && app.world.club) app.world.club.impact({ face: res.face, path: res.path }); },
    continue: () => game.continue(),
    escape: () => {
      if (ui.map.open) { ui.map.close(); return; }
      if (ui.hud.clubListOpen()) { ui.hud.closeClubList(); return; }
      if (game.state.phase === 'replay') { game.endReplay(); return; }
      if (ui.modal) { ui.screens.back(); return; }
      if (game.state.round) ui.screens.pause();
    },
    modalOpen: () => !!ui.modal || ui.map.open || (ui.hud && ui.hud.clubListOpen()),
  };
  ui.hud = createHud(root, { game, settings, haptic, actions, getWorld });
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

  // A tap on the course ends the replay; the replay bar picks camera angles.
  app.engine.renderer.domElement.addEventListener('pointerdown', () => { if (game.state.phase === 'replay') game.endReplay(); });

  // What the first-person club shows: the live drag while the player is at address.
  const clubCtx = { show: false, ball: { x: 0, y: 0, z: 0 }, heading: 0, clubId: 'I7', lefty: false, state: null };
  const clubSource = () => {
    const st = game.state, w = app.world;
    const v = st.round ? game.view() : null;
    clubCtx.show = !!(v && v.phase === 'aim' && v.human && w.rig.mode === 'address' && !ui.map.open && !ui.modal && w.ball && w.ball.group.visible !== false);
    if (w.ball) { const p = w.ball.position; clubCtx.ball.x = p.x; clubCtx.ball.y = p.y; clubCtx.ball.z = p.z; }
    clubCtx.heading = st.aim; clubCtx.clubId = st.club ? st.club.id : 'I7';
    clubCtx.lefty = settings.handedness === 'left';
    clubCtx.state = ui.hud.zone.live;
    return clubCtx;
  };
  ui.update = (dt) => {
    if (app.world && app.world.club && app.world.clubSource !== clubSource) app.world.clubSource = clubSource;
    ui.input.update(dt);
    ui.hud.update();
    if (ui.map.open) ui.map.draw();
  };
  ui.applySettings = () => {
    ui.hud.setLayout();
    if (app.world && app.world.rig) app.world.rig.lefty = settings.handedness === 'left';
    if (app.world && app.world.overlays) app.world.overlays.setPalette(settings.colorblind);
    if (app.world && app.world.rig) app.world.rig.reducedMotion = app.motionReduced();
    if (app.world && app.world.ball) app.world.ball.setSpinViz(!!settings.spinViz);
    if (app.audio) app.audio.applySettings(settings);
  };
  ui.iconButton = iconButton;
  ui.h = h;
  return ui;
}
