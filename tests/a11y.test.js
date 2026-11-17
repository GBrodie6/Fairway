// Accessibility checks on the design tokens and control sizes in the stylesheet.
// Text sits on translucent glass over a 3D scene, so contrast is checked against the worst
// case: the glass composited over pure white and over pure black.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`token ${name} missing`);
  return m[1].trim();
};
function parseColor(c) {
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]; }
  m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error(`cannot parse ${c}`);
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };

describe('contrast (WCAG 2.1)', () => {
  const panel = parseColor(token('panel'));
  for (const [scene, name] of [[[255, 255, 255, 1], 'white'], [[0, 0, 0, 1], 'black']]) {
    const bg = over(panel, scene);
    it(`body text on glass over a ${name} scene is at least 7:1`, () => {
      expect(ratio(over(parseColor(token('ink')), bg), bg)).toBeGreaterThanOrEqual(7);
    });
    it(`secondary text on glass over a ${name} scene is at least 4.5:1`, () => {
      expect(ratio(over(parseColor(token('ink-dim')), bg), bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('primary buttons are at least 7:1', () => {
    expect(ratio(parseColor(token('accent')), parseColor(token('accent-ink')))).toBeGreaterThanOrEqual(7);
  });
});

describe('tap targets', () => {
  const minHeight = (selector) => {
    const block = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    if (!block) throw new Error(`selector ${selector} missing`);
    const m = /min-height:\s*([^;]+);/.exec(block[2]) || /(?:^|;)\s*height:\s*([^;]+);/.exec(block[2]);
    const v = m[1].trim();
    return v === 'var(--tap)' ? parseFloat(token('tap')) : parseFloat(v);
  };
  for (const sel of ['.btn', '.btn.small', '.seg button', '.replaybar button', '.arrow', '.iconbtn']) {
    it(`${sel} is at least 44 px tall`, () => { expect(minHeight(sel)).toBeGreaterThanOrEqual(44); });
  }
});
