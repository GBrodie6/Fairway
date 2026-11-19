// The Controls screen lists every shortcut the game handles (src/ui/controlsUi.js).
import { describe, it, expect } from 'vitest';
import { SHORTCUTS } from '../src/ui/controlsUi.js';

describe('the Controls list', () => {
  const all = SHORTCUTS.flatMap((g) => g.rows.map(([k, what]) => `${g.group}: ${k} = ${what}`)).join('\n');
  it('names every keyboard shortcut', () => {
    for (const k of ['A and D', 'W and S', 'up and down arrows', 'Left and right arrows', 'Q and E', 'Shift and the arrows', 'R', 'Space', 'Tab', 'M', 'C', 'Esc', 'F', 'Z', '?', 'B', 'Mouse wheel']) expect(all).toContain(k);
  });
  it('names the level editor keys and mouse', () => {
    const ed = SHORTCUTS.find((g) => g.group === 'Level editor').rows.map((r) => r.join(' ')).join('\n');
    for (const k of ['Mouse wheel', 'Middle mouse', 'Space and drag', 'Ctrl+Z', 'Ctrl+Y', 'Delete', '1 to 8', '0']) expect(ed).toContain(k);
  });
  it('names the controller', () => {
    const pad = SHORTCUTS.find((g) => g.group === 'Controller').rows.map((r) => r.join(' ')).join('\n');
    for (const k of ['Left stick', 'A', 'LB and RB', 'LT and RT', 'Right stick', 'D-pad']) expect(pad).toContain(k);
  });
  it('has no em dashes', () => { expect(all.includes('\u2014')).toBe(false); });
});
