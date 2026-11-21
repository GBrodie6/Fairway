import { describe, it, expect } from 'vitest';
import { placeLabels, freeRect } from '../src/ui/courseMap.js';

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

  it('never puts a label over a button, and a hole hidden under the buttons is not on view', () => {
    const button = { x: 0, y: 0, w: 120, h: 60 };
    const out = placeLabels([
      { text: '1', candidates: [{ x: 30, y: 30 }, { x: 150, y: 30 }] },
      { text: '2', candidates: [{ x: 40, y: 20 }, { x: 60, y: 40 }] },
    ], { x: 0, y: 0, w: 300, h: 300 }, undefined, [button]);
    expect(out[0].box).toBeTruthy();
    expect(overlaps(out[0].box, button)).toBe(false);
    expect(out[1].box).toBe(null);
    expect(out[1].inView).toBe(false);
  });

  it('fits the map into the free space it is drawn biggest in', () => {
    const clear = (r, obs) => obs.every((o) => !overlaps(r, o));
    // Upright phone: buttons across the top and the bottom leave a band between them.
    const tall = [{ x: 8, y: 8, w: 344, h: 110 }, { x: 8, y: 540, w: 344, h: 92 }];
    const a = freeRect(360, 640, tall, 0.8);
    expect(clear(a, tall)).toBe(true);
    expect(a).toEqual({ x: 10, y: 118, w: 340, h: 422 });
    // A phone on its side, buttons in the four corners: a tall course gets the full-height
    // column between them, bigger than the band under the top buttons.
    const wide = [{ x: 8, y: 8, w: 260, h: 56 }, { x: 660, y: 8, w: 176, h: 118 }, { x: 8, y: 300, w: 300, h: 82 }, { x: 640, y: 324, w: 196, h: 58 }];
    const b = freeRect(844, 390, wide, 0.8);
    expect(clear(b, wide)).toBe(true);
    expect(b.h).toBe(370);
    expect(Math.min(b.w / 0.8, b.h)).toBeGreaterThan(300 - 126);
    // A wide course on the same screen gets a band across instead.
    const c = freeRect(844, 390, wide, 2);
    expect(clear(c, wide)).toBe(true);
    expect(c.w).toBeGreaterThan(b.w);
  });

  it('leaves a label out rather than overlap when no spot is free', () => {
    const out = placeLabels([{ text: 'a', candidates: [{ x: 50, y: 50 }] }, { text: 'b', candidates: [{ x: 52, y: 51 }] }], { x: 0, y: 0, w: 200, h: 200 });
    expect(out[0].box).toBeTruthy();
    expect(out[1].box).toBe(null);
  });
});
