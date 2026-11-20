import { describe, it, expect } from 'vitest';
import { placeLabels } from '../src/ui/courseMap.js';

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('course map labels', () => {
  it('never overlap each other and stay inside the map area', () => {
    const bounds = { x: 0, y: 100, w: 360, h: 420 };
    // Eighteen holes whose first choices all collide (every tee at nearly the same spot).
    const items = Array.from({ length: 18 }, (_, i) => ({ kind: 'hole', index: i, text: String(i + 1), candidates: [{ x: 180, y: 300 }, { x: 180 + (i % 6) * 30, y: 140 + Math.floor(i / 6) * 30 }, { x: 40 + i * 15, y: 480 }] }));
    const out = placeLabels(items, bounds);
    const boxes = out.filter((l) => l.box).map((l) => l.box);
    expect(boxes.length).toBe(18);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      expect(b.x >= bounds.x && b.y >= bounds.y && b.x + b.w <= bounds.x + bounds.w && b.y + b.h <= bounds.y + bounds.h).toBe(true);
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(b, boxes[j])).toBe(false);
    }
  });

  it('a hole at the edge of the screen gets its label moved inside the edge', () => {
    const out = placeLabels([{ text: '15', candidates: [{ x: 3, y: 100 }, { x: -40, y: 100 }] }], { x: 0, y: 0, w: 200, h: 200 });
    expect(out[0].box).toBeTruthy();
    expect(out[0].box.x).toBe(0);
    expect(out[0].inView).toBe(true);
  });

  it('leaves a label out rather than overlap when no spot is free', () => {
    const out = placeLabels([{ text: 'a', candidates: [{ x: 50, y: 50 }] }, { text: 'b', candidates: [{ x: 52, y: 51 }] }], { x: 0, y: 0, w: 200, h: 200 });
    expect(out[0].box).toBeTruthy();
    expect(out[1].box).toBe(null);
  });
});
