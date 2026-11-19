// The Controls screen: every keyboard shortcut, the mouse, touch and a controller, in one list.
// The ? key opens it as an overlay from anywhere (and closes it again); Settings and the pause
// menu have a button for it.
import { h } from './dom.js';

export const SHORTCUTS = Object.freeze([
  { group: 'Swing', rows: [
    ['Drag down, then up through the line', 'Swing with the mouse or a finger: anywhere in the zone under the ball'],
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
    ['M', 'Hole map and rangefinder'],
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
    ['Left stick or d-pad left and right', 'Aim'],
    ['A', 'Hold for the backswing, release at the top, press again for impact'],
    ['LB and RB', 'Longer and shorter club'],
    ['LT and RT', 'Previous and next shot type'],
    ['Right stick', 'Move the ball contact dot (click it to centre); in menus it scrolls'],
    ['X', 'Map'],
    ['Y', 'Replay'],
    ['View (Back)', 'The club list'],
    ['Menu (Start)', 'Pause'],
    ['D-pad and A, B', 'Move through menus, choose, back'],
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
