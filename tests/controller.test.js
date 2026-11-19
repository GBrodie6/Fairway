// Controller support: the d-pad's focus moves in menus (src/ui/padNav.js), and the Controls
// screen lists every controller binding input.js handles.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pickNext } from '../src/ui/padNav.js';
import { SHORTCUTS } from '../src/ui/controlsUi.js';

const R = (x, y, w = 100, h = 40) => ({ x, y, w, h });

describe('d-pad focus movement', () => {
  // A menu: a title field, a two-column grid of buttons, and a wide button under it.
  const field = R(0, 0, 220, 40), a = R(0, 60), b = R(120, 60), c = R(0, 110), d = R(120, 110), wide = R(0, 170, 220, 44);
  const rects = [field, a, b, c, d, wide];
  it('down and up follow the column', () => {
    expect(pickNext(a, rects, 'down')).toBe(3);
    expect(pickNext(b, rects, 'down')).toBe(4);
    expect(pickNext(c, rects, 'down')).toBe(5);
    expect(pickNext(d, rects, 'up')).toBe(2);
    expect(pickNext(a, rects, 'up')).toBe(0);
  });
  it('left and right stay in the row', () => {
    expect(pickNext(a, rects, 'right')).toBe(2);
    expect(pickNext(d, rects, 'left')).toBe(3);
  });
  it('nothing beyond the edge', () => {
    expect(pickNext(b, rects, 'right')).toBe(-1);
    expect(pickNext(wide, rects, 'down')).toBe(-1);
    expect(pickNext(field, rects, 'up')).toBe(-1);
  });
  it('prefers a control in line over a nearer one off to the side', () => {
    const from = R(200, 0, 100, 40), inLine = R(210, 200, 80, 40), side = R(0, 90, 100, 40);
    expect(pickNext(from, [from, side, inLine], 'down')).toBe(2);
  });
});

describe('controller bindings', () => {
  const src = readFileSync(new URL('../src/ui/input.js', import.meta.url), 'utf8');
  const pad = SHORTCUTS.find((g) => g.group === 'Controller').rows.map((r) => r.join(' ')).join('\n');
  it('every binding the brief asks for is handled and listed', () => {
    for (const [what, code] of [['aim', 'game.nudgeAim'], ['club', 'game.selectClub'], ['shot type', 'cycleShot'], ['spin dot', 'game.setSpin'], ['swing press', 'hud.stick.meterDown'], ['swing release', 'hud.stick.meterUp'], ['menus', 'nav.move'], ['choose', 'nav.activate'], ['editor', 'ed.pad']]) {
      expect(src.includes(code), what).toBe(true);
    }
    for (const word of ['Aim', 'club', 'shot type', 'ball contact dot', 'backswing', 'Menus', 'level editor', 'Look around']) expect(pad.toLowerCase()).toContain(word.toLowerCase());
  });
});
