// The Controls screen: every keyboard shortcut, the mouse, touch and a controller, in one list.
// The ? key opens it as an overlay from anywhere (and closes it again); Settings and the pause
// menu have a button for it.
import { h } from './dom.js';

export const SHORTCUTS = Object.freeze([
  { group: 'Swing', rows: [
    ['Press in the box, pull down, swipe up through the ring', 'Swing with the mouse or a finger in the box under the ball (Settings, Swing guide: Classic track brings back the old stick)'],
    ['Space', 'Hold for the backswing, release at the top, press again for impact'],
    ['A and D', 'Aim left and right (with Shift: fine)'],
    ['Left and right arrows', 'Aim left and right'],
    ['Mouse wheel', 'Fine aim'],
    ['R', 'Aim back at the target'],
  ] },
  { group: 'Club and shot', rows: [
    ['W and S, up and down arrows', 'Longer and shorter club'],
    ['B', 'The club list'],
    ['Q and E', 'Previous and next shot type'],
    ['1 to 4', 'Pick a shot type'],
    ['Shift and the arrows', 'Move the ball contact dot (spin and shape)'],
    ['Shift and R', 'Ball contact dot back to the middle'],
  ] },
  { group: 'Views and menus', rows: [
    ['Tab', 'Scorecard (Tab again to close)'],
    ['M', 'Hole map and rangefinder; M again for the course map, once more to close'],
    ['Course map: wheel, + and -', 'Zoom in and out (0 fits the whole course; drag to move)'],
    ['C', 'Camera: look around the hole (in a replay: the next angle)'],
    ['Z', 'Replay the last shot (Z again to end it)'],
    ['Esc', 'Pause, or back'],
    ['F', 'Fullscreen'],
    ['?', 'This list'],
  ] },
  { group: 'Level editor', rows: [
    ['Mouse wheel', 'Zoom the map'],
    ['Middle mouse, or Space and drag', 'Pan the map'],
    ['0', 'Fit the hole on the map'],
    ['Ctrl+Z, Ctrl+Y (or Ctrl+Shift+Z)', 'Undo and redo'],
    ['Delete or Backspace', 'Remove the selected piece'],
    ['1 to 8', 'Bunker, Water, Trees, Rough, Hills, Green size, Add bend, Decorate'],
  ] },
  { group: 'Controller', rows: [
    ['Left stick or d-pad left and right', 'Aim (the d-pad in fine steps)'],
    ['A', 'Hold for the backswing, release at the top, press again for impact'],
    ['LB and RB, d-pad up and down', 'Longer and shorter club'],
    ['LT and RT', 'Previous and next shot type'],
    ['Right stick', 'Move the ball contact dot (click it to centre)'],
    ['L3 (click the left stick)', 'Look around (the right stick looks while it is on)'],
    ['X', 'Map (in a replay: the next camera angle)'],
    ['Y', 'Replay'],
    ['View (Back)', 'The club list'],
    ['Menu (Start)', 'Pause'],
    ['B', 'Back'],
    ['D-pad or left stick, A, B', 'Menus: move, choose, back; left and right change a setting; the right stick scrolls'],
    ['In the level editor', 'Left stick moves the selected piece, LB and RB select, X deletes, Y undo, View redo, LT and RT zoom, right stick pans'],
  ] },
]);

export function installControls(app, ui) {
  const { screens } = ui;
  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const pad = () => !!(ui.input && ui.input.gamepad != null);
  screens.register('controls', () => screens.show('controls', () => sheet('wide controls',
    h('h2', { class: 'h', text: 'Controls and shortcuts' }),
    h('p', { class: 'muted small', text: `Shortcuts never fire while you type in a text field.${pad() ? ' A controller is connected.' : ''}` }),
    ...SHORTCUTS.map((g) => h('div', { class: 'keygroup' },
      h('h3', { class: 'h', text: g.group }),
      h('div', { class: 'keylist', role: 'list' }, ...g.rows.map(([k, what]) => h('div', { class: 'keyrow', role: 'listitem' }, h('kbd', { text: k }), h('span', { text: what })))))),
    h('div', { class: 'stack', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', type: 'button', onclick: () => screens.back() }, 'Back')))));
  // The ? overlay: open from anywhere, close again with ? (or Esc).
  app.toggleShortcuts = () => { if (ui.modal === 'controls') screens.back(); else screens.registry.controls(); };
}
