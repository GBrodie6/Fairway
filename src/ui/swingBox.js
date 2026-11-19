// The swing box (Settings, Swing guide: Box, the default): where a swing may start and how far
// the thumb may drift. Pure functions, unit tested in tests/swingBox.test.js; ui/swingZone.js
// draws the box and feeds the same pointer samples to the unchanged swing gesture.
//
//   width     the box's half-width is the sideways drift at which the strike model first allows
//             a mishit for an otherwise perfect full swing (straightDrift), worked out from the
//             real gesture and strike model rather than a copy of their numbers, and never less
//             than half a 44 px touch target. Inside the box is straight; past its edge the
//             drift starts to cost (a heel or toe, an open or closed face). The gesture's own
//             face dead zone (SWING_DEFAULTS.faceDeadzone, 2.5 percent of the drag length, about
//             4 to 5 px) is far narrower than a thumb, so it is not used for the width.
//   height    the start line sits BOX.start below the top, with a full backswing under it.
//   press     a press inside the box starts a swing; a press outside does not.
//   outline   during a swing the box centres on the press point. Inside it the outline is
//             quiet; outside it lights up; more than BOX.cancelWidths box widths outside cancels
//             the swing with no stroke taken.
import { createSwingGesture, PHASE } from '../game/swingGesture.js';
import { strikeFactors, TUNING } from '../game/strike.js';

export const BOX = Object.freeze({
  start: 26, // px from the top of the box to the start line (the same as the classic zone)
  below: 18, // px of room under a full backswing
  minHalfWidth: 22, // half of the smallest comfortable touch target (44 px)
  minHeight: 56, // the least a thumb needs around the start line
  cancelWidths: 1.5, // this many box widths outside the box cancels the swing
});

// The drift (px, sideways from the press point) at which a full swing with a perfect 3 to 1
// tempo first carries a mishit chance on the Standard setting with the hardest club to strike
// (the driver, common tier): the strike model's free threshold (strike.js TUNING.FREE).
const DRIFT_CACHE = new Map();
function swingWithDrift(d, travel) {
  const g = createSwingGesture({ travel });
  g.down(0, 0, 0);
  // 900 ms down to a full backswing, then 300 ms up through the start line at d px sideways.
  for (let i = 1; i <= 30; i++) g.move(0, (travel * i) / 30, i * 30);
  let st = g.state;
  for (let i = 1; i <= 12 && st.phase !== PHASE.DONE; i++) {
    const f = i / 12;
    st = g.move(d * f, travel - (travel + 12) * f, 900 + f * 300);
  }
  return st.phase === PHASE.DONE ? st.result : null;
}
export function straightDrift(travel) {
  const T = Math.round(Number.isFinite(travel) && travel > 0 ? travel : 170);
  if (DRIFT_CACHE.has(T)) return DRIFT_CACHE.get(T);
  const errorAt = (d) => { const r = swingWithDrift(d, T); return r ? strikeFactors(r, {}).error : Infinity; };
  let lo = 0, hi = T;
  for (let k = 0; k < 32; k++) { const m = (lo + hi) / 2; if (errorAt(m) < TUNING.FREE) lo = m; else hi = m; }
  DRIFT_CACHE.set(T, lo);
  return lo;
}
export const boxHalfWidth = (travel) => Math.max(BOX.minHalfWidth, Math.round(straightDrift(travel)));

// The box at rest. zone: the HUD's swing area { x, y, w, h } (on a phone the space between the
// ball and the bottom row; on a desktop with a mouse the wide area under the ball), travel: the
// drag for full power. The box is centred in the area (under the ball) with its top on the
// area's top, so the ball keeps its place just above the start line. On a phone it stays inside
// the area (which ends above the bottom row); on a desktop it is as tall as a full backswing.
export function boxGeometry(zone, travel, { wide = false } = {}) {
  const hw = boxHalfWidth(travel);
  const cx = zone.x + zone.w / 2;
  const full = BOX.start + travel + BOX.below;
  const h = Math.max(BOX.minHeight, wide ? full : Math.min(zone.h, full));
  return { x: Math.round(cx - hw), y: Math.round(zone.y), w: hw * 2, h: Math.round(h), start: BOX.start, halfWidth: hw };
}

// A press inside the box starts a swing.
export const inBox = (box, x, y) => Number.isFinite(x) && Number.isFinite(y) && !!box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;

// During a swing the box centres on the press point (horizontally), so inside the box means
// within the straight drift of where the swing began.
export const liveBox = (rest, pressX) => ({ ...rest, x: Math.round(pressX - rest.w / 2) });

// The outline: 'inside', 'outside' (lit), or 'cancel' (more than cancelWidths box widths
// outside, measured from the nearest edge along either axis).
export function boxState(box, x, y) {
  if (!box || !Number.isFinite(x) || !Number.isFinite(y)) return { state: 'inside', out: 0 };
  const dx = Math.max(box.x - x, 0, x - (box.x + box.w));
  const dy = Math.max(box.y - y, 0, y - (box.y + box.h));
  const out = Math.max(dx, dy);
  if (out <= 0) return { state: 'inside', out: 0 };
  return { state: out > BOX.cancelWidths * box.w ? 'cancel' : 'outside', out };
}

// The HUD's swing area for a window (the same rules as ui/hud.js layout, pure so the box can be
// checked at every size without a browser). barTop: the top of the bottom button row as drawn;
// clubGroup: its { left, right } when known (landscape phones keep the club buttons in a
// corner); deskMouse: a desktop-sized window with a mouse.
export function zoneRect({ W, H, barTop, barH = 78, clubGroup = null, stickScale = 1, deskMouse = false }) {
  const cl = (v, a, b) => Math.min(b, Math.max(a, v));
  const landscape = W > H;
  const want = Math.round(cl(H * 0.27, 96, 190) * cl(stickScale || 1, 0.7, 1.5));
  const zoneH = Math.round(cl(want + 46, 130, landscape ? H * 0.46 : H < 700 ? H * 0.31 : H * 0.36));
  const zoneW = Math.round(cl(W * (landscape ? 0.2 : 0.42), 150, 220));
  const x = Math.round(W / 2 - zoneW / 2);
  const clear = !!clubGroup && clubGroup.right - clubGroup.left > 0 && (clubGroup.right < x - 8 || clubGroup.left > x + zoneW + 8);
  const y = clear ? Math.min(barTop - 4 - zoneH + barH * 0.85, H - zoneH - 6) : barTop - 10 - zoneH;
  let box = { x, y: Math.round(y), w: zoneW, h: zoneH };
  if (deskMouse) {
    const mw = Math.round(cl(W * 0.32, 360, 640));
    const mh = Math.round(cl(H - 12 - want - box.y, 64, Math.max(64, zoneH)));
    box = { x: Math.round(W / 2 - mw / 2), y: box.y, w: mw, h: mh, mouseWide: true };
  }
  const travel = box.mouseWide ? want : Math.max(80, Math.min(want, Math.round(box.h - BOX.start - 14)));
  return { zone: box, travel, want };
}
