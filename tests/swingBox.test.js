// The swing box (ui/swingBox.js): its width comes from the strike model, a press inside starts
// a swing and outside does not, the outline is inside, outside or cancel, and the box fits at
// every viewport the brief names. The swing math is untouched (tests/gesture.test.js and the
// other swing tests run unchanged).
import { describe, it, expect } from 'vitest';
import { BOX, straightDrift, boxHalfWidth, boxGeometry, inBox, liveBox, boxState, zoneRect } from '../src/ui/swingBox.js';
import { createSwingGesture, SWING_DEFAULTS, PHASE } from '../src/game/swingGesture.js';
import { strikeFactors, TUNING } from '../src/game/strike.js';

// The same synthetic full swing as the module: 900 ms back, 300 ms up through the line at d px.
function errorAt(d, travel) {
  const g = createSwingGesture({ travel });
  g.down(0, 0, 0);
  for (let i = 1; i <= 30; i++) g.move(0, (travel * i) / 30, i * 30);
  let st = g.state;
  for (let i = 1; i <= 12 && st.phase !== PHASE.DONE; i++) { const f = i / 12; st = g.move(d * f, travel - (travel + 12) * f, 900 + f * 300); }
  return strikeFactors(st.result, {}).error;
}

describe('swing box width', () => {
  it('is the drift where the strike model first allows a mishit', () => {
    for (const travel of [150, 170, 190, 220]) {
      const d = straightDrift(travel);
      expect(errorAt(d - 0.5, travel)).toBeLessThan(TUNING.FREE);
      expect(errorAt(d + 0.5, travel)).toBeGreaterThanOrEqual(TUNING.FREE);
      // Much wider than the gesture's own face dead zone, which is not used for the width.
      expect(d).toBeGreaterThan(SWING_DEFAULTS.faceDeadzone * travel * 3);
    }
    expect(straightDrift(170)).toBeCloseTo(16.8, 0);
    expect(straightDrift(190)).toBeCloseTo(18.6, 0);
  });
  it('is never narrower than a 44 px touch target, and wider for a long drag', () => {
    expect(boxHalfWidth(120)).toBe(BOX.minHalfWidth);
    expect(boxHalfWidth(190)).toBe(22);
    expect(boxHalfWidth(285)).toBeGreaterThan(22);
    expect(boxHalfWidth(285)).toBe(Math.round(straightDrift(285)));
  });
});

describe('swing box hit test', () => {
  const box = { x: 100, y: 400, w: 44, h: 220 };
  it('a press inside starts a swing', () => {
    for (const [x, y] of [[122, 426], [100, 400], [144, 620], [101, 619], [130, 500]]) expect(inBox(box, x, y)).toBe(true);
  });
  it('a press outside does not', () => {
    for (const [x, y] of [[99, 426], [145, 426], [122, 399], [122, 621], [0, 0], [NaN, 426], [122, Infinity]]) expect(inBox(box, x, y)).toBe(false);
    expect(inBox(null, 122, 426)).toBe(false);
  });
});

describe('swing box outline', () => {
  const rest = { x: 100, y: 400, w: 44, h: 220 };
  it('centres on the press point during a swing', () => {
    expect(liveBox(rest, 140)).toMatchObject({ x: 118, y: 400, w: 44, h: 220 });
  });
  it('inside is quiet, outside lights, past 1.5 box widths cancels', () => {
    const box = liveBox(rest, 122); // x 100 to 144
    expect(boxState(box, 122, 500).state).toBe('inside');
    expect(boxState(box, 144, 500).state).toBe('inside');
    expect(boxState(box, 145, 500)).toMatchObject({ state: 'outside', out: 1 });
    expect(boxState(box, 99, 500).state).toBe('outside');
    expect(boxState(box, 122, 621).state).toBe('outside');
    expect(boxState(box, 144 + 66, 500).state).toBe('outside'); // exactly 1.5 widths
    expect(boxState(box, 144 + 67, 500).state).toBe('cancel');
    expect(boxState(box, 100 - 67, 500).state).toBe('cancel');
    expect(boxState(box, 122, 620 + 67).state).toBe('cancel');
    expect(boxState(box, NaN, 500).state).toBe('inside');
  });
});

// The windows the brief names, with the bottom row where the HUD puts it (78 px buttons 10 px
// above the bottom on a phone; scaled from the bottom by the desktop HUD scale on a desktop).
const VIEWPORTS = [
  { W: 390, H: 844, phone: true }, { W: 844, H: 390, phone: true, corner: true }, { W: 360, H: 640, phone: true },
  { W: 1366, H: 768, hs: 1 }, { W: 1920, H: 1080, hs: 1.2 }, { W: 2560, H: 1440, hs: 1.6 },
];
describe('swing box geometry at every viewport', () => {
  for (const v of VIEWPORTS) {
    it(`${v.W}x${v.H}`, () => {
      const hs = v.hs || 1;
      const barTop = v.H - 10 - 78 * hs;
      // Landscape phones keep the club buttons in the right corner.
      const clubGroup = v.corner ? { left: v.W - 260, right: v.W - 12 } : { left: v.W / 2 - 110, right: v.W / 2 + 110 };
      const { zone, travel } = zoneRect({ W: v.W, H: v.H, barTop, barH: 78 * hs, clubGroup, deskMouse: !v.phone });
      const box = boxGeometry(zone, travel, { wide: !!zone.mouseWide });
      // Centred under the ball (the middle of the window), at least a touch target wide.
      expect(Math.abs(box.x + box.w / 2 - v.W / 2)).toBeLessThanOrEqual(1);
      expect(box.w).toBeGreaterThanOrEqual(44);
      // Big enough for a thumb and a full backswing under the start line.
      expect(box.h).toBeGreaterThanOrEqual(BOX.minHeight);
      expect(box.start + travel).toBeLessThanOrEqual(box.h);
      // Inside the window, under the top panels, and clear of the bottom row unless the club
      // buttons sit in a corner beside it.
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(v.W);
      expect(box.y).toBeGreaterThan(v.H * 0.3);
      expect(box.y + box.h).toBeLessThanOrEqual(v.H);
      if (!v.corner) expect(box.y + box.h).toBeLessThanOrEqual(barTop - 4);
      // The box's top is the area's top, so the ball keeps its place above the start line.
      expect(box.y).toBe(zone.y);
    });
  }
});
