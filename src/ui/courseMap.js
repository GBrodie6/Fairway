// The full-course map: every hole of a course drawn flat from the course routing (where each
// hole sits, course/routing.js) and each hole's own definition (fairway, green, tees, bunkers,
// water), north up, with the hole numbers, the clubhouse, the current hole highlighted, and in
// a round the ball and the line to the pin. Drag or pinch to move and zoom, the mouse wheel
// zooms, + and - zoom, 0 fits the course. In pick mode (Quick Play) a tap on a hole chooses
// the starting hole. Hole numbers are placed so no two labels overlap at any size or zoom.
import { courseById } from '../course/courses.js';
import { getHole, greenRadiusAt, pinOf } from '../course/layout.js';
import { courseRouting, holeFrame, toWorld } from '../course/routing.js';
import { clamp } from '../core/math.js';
import { h, iconButton } from './dom.js';
import { fmtDist } from './format.js';

const COL = {
  ground: '#24382a', rough: '#3d5f34', fairway: '#73ad48', green: '#9fdc6c', tee: '#86c25a', sand: '#e7d7a8', water: '#3f7fb4',
  dim: 0.42, label: '#f3f6ef', labelBg: 'rgba(10,18,14,0.84)', current: '#ffd166', pick: '#7fd6ff',
};
const ROUGH = { desert: '#8a7653', links: '#66733f', standrews: '#6f7442', augusta: '#356a2f', alpine: '#3c6233', tropical: '#3f6a34' };
const GROUND = { desert: '#5b4a33', links: '#3c4a2c', standrews: '#424a2e', alpine: '#24382a', tropical: '#22402a', augusta: '#1f3a24' };

// Each hole's map shapes, in world meters (routing coordinates).
function holeShapes(course, routing, i) {
  const hole = getHole(course, i), f = holeFrame(routing, i), W = (x, z) => toWorld(f, x, z);
  const line = hole.line, n = line.length;
  const edge = (wAt, from = 0, to = n - 1) => {
    const L = [], R = [];
    for (let k = from; k <= to; k += 2) {
      const q = line[k], a = line[Math.max(0, k - 1)], b = line[Math.min(n - 1, k + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1, nx = -dz / d, nz = dx / d, w = wAt(k);
      L.push(W(q.x - nx * w, q.z - nz * w)); R.push(W(q.x + nx * w, q.z + nz * w));
    }
    return L.concat(R.reverse());
  };
  const rough = edge((k) => Math.max(hole.half[k], 9) + hole.roughBand);
  let fairway = null;
  if (hole.hasFairway) {
    let a = n, b = -1;
    for (let k = 0; k < n; k++) if (hole.half[k] > 0.5) { a = Math.min(a, k); b = Math.max(b, k); }
    if (b > a) fairway = edge((k) => hole.half[k], a, b);
  }
  const g = hole.green, green = [];
  for (let k = 0; k < 24; k++) { const t = (k / 24) * Math.PI * 2, r = greenRadiusAt(g, g.x + Math.cos(t) * 30, g.z + Math.sin(t) * 30); green.push(W(g.x + Math.cos(t) * r, g.z + Math.sin(t) * r)); }
  const tees = hole.tees.map((t) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => W(t.x + t.tx * (t.l / 2) * a - t.tz * (t.w / 2) * b, t.z + t.tz * (t.l / 2) * a + t.tx * (t.w / 2) * b)));
  const bunkers = hole.bunkers.flatMap((b) => b.blobs.map((c) => ({ ...W(c.x, c.z), r: c.r })));
  const ponds = hole.water.filter((w) => w.type === 'pond').flatMap((w) => w.blobs.map((c) => ({ ...W(c.x, c.z), r: c.r })));
  const streams = hole.water.filter((w) => w.type === 'stream').map((w) => ({ pts: w.pts.map((p) => W(p.x, p.z)), half: w.half }));
  const pin = pinOf(hole);
  return {
    index: i, number: i + 1, par: hole.par, yards: hole.yards, rough, fairway, green, tees, bunkers, ponds, streams,
    tee: W(hole.tees[0].x, hole.tees[0].z), greenCenter: W(g.x, g.z), pin: W(pin.x, pin.z),
    line: line.filter((_, k) => k % 5 === 0 || k === n - 1).map((q) => W(q.x, q.z)), corridor: routing.holes[i].corridor,
  };
}

const segDist = (px, pz, a, b) => {
  const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1e-9;
  const u = clamp(((px - a.x) * vx + (pz - a.z) * vz) / l2, 0, 1);
  return Math.hypot(px - a.x - vx * u, pz - a.z - vz * u);
};

const boxesOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const insideBox = (p, b) => p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h;

// Place one label per hole (and the clubhouse) in screen space with no overlaps: each hole tries
// spots behind its tee, beside it, then along its line, and takes the first that is free.
// obstacles: boxes no label may cover (the map's own buttons and text). Exported for tests:
// boxes are { x, y, w, h }.
export function placeLabels(items, bounds, size = { w: 26, h: 22 }, obstacles = []) {
  const placed = [];
  const hit = (r) => placed.some((p) => boxesOverlap(r, p)) || obstacles.some((o) => boxesOverlap(r, o))
    || r.x < bounds.x || r.y < bounds.y || r.x + r.w > bounds.x + bounds.w || r.y + r.h > bounds.y + bounds.h;
  // A spot is on view when it is on screen and not under one of the map's buttons.
  const onView = (c) => insideBox(c, bounds) && !obstacles.some((o) => insideBox(c, o));
  const out = [];
  for (const it of items) {
    const w = it.w || size.w, hh = it.h || size.h;
    let chosen = null;
    for (const c of it.candidates) {
      const r = { x: c.x - w / 2, y: c.y - hh / 2, w, h: hh };
      if (!hit(r)) { chosen = r; break; }
    }
    // A hole at the edge of the screen or beside a button (zoomed in): its spots on view, moved
    // just far enough for the label to fit inside the edge, and if that covers a button, set
    // just clear of it (below, above, left or right).
    const inside = (x, y) => ({ x: Math.min(Math.max(x, bounds.x), bounds.x + bounds.w - w), y: Math.min(Math.max(y, bounds.y), bounds.y + bounds.h - hh), w, h: hh });
    if (!chosen) for (const c of it.candidates) {
      if (!onView(c)) continue;
      const base = inside(c.x - w / 2, c.y - hh / 2), tries = [base];
      for (const o of obstacles) if (boxesOverlap(base, o)) tries.push(inside(base.x, o.y + o.h), inside(base.x, o.y - hh), inside(o.x - w, base.y), inside(o.x + o.w, base.y));
      chosen = tries.find((r) => !hit(r)) || null;
      if (chosen) break;
    }
    // Nowhere free near the hole: the label is left out (the hole is still drawn); at the
    // map's fitted zoom every course places all of its labels. inView: some spot it could take
    // is on view (a hole off screen or under the buttons when zoomed in has no label to place).
    const inView = it.candidates.some(onView);
    if (chosen) { placed.push(chosen); out.push({ ...it, box: chosen, inView }); } else out.push({ ...it, box: null, inView });
  }
  return out;
}

// The largest part of a W x H screen, clear of the obstacles, to fit a map of the given aspect
// (width over height) into: every rectangle whose sides lie on the screen margin or an
// obstacle's edge, the one the map is drawn biggest in (then the larger). On a phone held
// upright that is the band between the buttons along the top and the bottom; on a short, wide
// screen it can be the full-height column between buttons in the corners. Exported for tests.
export function freeRect(W, H, obstacles, aspect = 1, margin = 10) {
  const xs = [margin, W - margin], ys = [margin, H - margin];
  for (const o of obstacles) { xs.push(o.x, o.x + o.w); ys.push(o.y, o.y + o.h); }
  const X = [...new Set(xs.filter((v) => v >= margin && v <= W - margin))].sort((a, b) => a - b);
  const Y = [...new Set(ys.filter((v) => v >= margin && v <= H - margin))].sort((a, b) => a - b);
  let best = null, bestS = -1, bestA = -1;
  for (let i = 0; i < X.length; i++) for (let j = i + 1; j < X.length; j++) {
    const w = X[j] - X[i];
    if (w < 80) continue;
    for (let k = 0; k < Y.length; k++) for (let l = k + 1; l < Y.length; l++) {
      const r = { x: X[i], y: Y[k], w, h: Y[l] - Y[k] };
      if (r.h < 80 || obstacles.some((o) => boxesOverlap(r, o))) continue;
      const sc = Math.min(r.w / aspect, r.h), area = r.w * r.h;
      if (sc > bestS + 1e-6 || (sc > bestS - 1e-6 && area > bestA)) { best = r; bestS = sc; bestA = area; }
    }
  }
  return best || { x: margin, y: margin, w: Math.max(80, W - margin * 2), h: Math.max(80, H - margin * 2) };
}

export function createCourseMap(parent, { settings, onClose, onPick, onHoleMap } = {}) {
  const wrap = h('div', { class: 'coursemap hidden', role: 'dialog', 'aria-label': 'Course map' });
  const canvas = h('canvas', { class: 'cmcanvas', 'aria-hidden': 'true' });
  const title = h('div', { class: 'cmtitle glass chip' });
  const seg = h('div', { class: 'seg glass cmseg', role: 'group', 'aria-label': 'Map' });
  const holeBtn = h('button', { type: 'button', 'aria-pressed': 'false', onclick: (e) => { e.stopPropagation(); if (onHoleMap) onHoleMap(); } }, 'Hole');
  const courseBtn = h('button', { type: 'button', 'aria-pressed': 'true' }, 'Course');
  seg.append(holeBtn, courseBtn);
  const zoomIn = iconButton('plus', 'Zoom in (+)', () => zoomBy(1.5), 'iconbtn glass cmzin');
  const zoomOut = iconButton('minus', 'Zoom out (-)', () => zoomBy(1 / 1.5), 'iconbtn glass cmzout');
  const fitBtn = h('button', { class: 'btn small glass cmfit', type: 'button', onclick: (e) => { e.stopPropagation(); fit(); draw(); } }, 'Fit');
  const info = h('div', { class: 'cminfo glass chip', 'aria-live': 'polite' });
  const startBtn = h('button', { class: 'btn primary cmstart hidden', type: 'button', onclick: (e) => { e.stopPropagation(); const pick = state.onPick || onPick; if (state.pick && state.selected != null && pick) { const n = state.selected + 1; cm.close(); pick(n); } } }, 'Start here');
  const closeBtn = iconButton('close', 'Close map (M or Esc)', () => cm.close(), 'iconbtn glass close');
  // The start button sits above the details, in one column, so wrapped text never covers it.
  const bottom = h('div', { class: 'cmbottom' }, startBtn, info);
  wrap.append(canvas, title, seg, zoomIn, zoomOut, fitBtn, bottom, closeBtn);
  parent.appendChild(wrap);
  const ctx = canvas.getContext('2d');
  const state = { course: null, routing: null, shapes: [], current: null, ball: null, pick: false, selected: null, view: { s: 1, ox: 0, oy: 0 }, labels: [], W: 0, H: 0, dpr: 1 };
  const cm = { open: false, el: wrap, state };

  // --- view: screen = (world - origin) * s, north (-Z) up ---
  const toScreen = (x, z) => ({ x: (x - state.view.ox) * state.view.s, y: (z - state.view.oy) * state.view.s });
  const toWorldPt = (sx, sy) => ({ x: sx / state.view.s + state.view.ox, z: sy / state.view.s + state.view.oy });
  // The map's own buttons and text, as boxes on the canvas with a 6 px margin: no label goes
  // under them, and the fitted map keeps clear of them.
  const controlBoxes = () => {
    const wr = wrap.getBoundingClientRect(), out = [];
    for (const el of [title, seg, zoomIn, zoomOut, fitBtn, closeBtn, info, startBtn]) {
      if (el.classList.contains('hidden')) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out.push({ x: r.left - wr.left - 6, y: r.top - wr.top - 6, w: r.width + 12, h: r.height + 12 });
    }
    return out;
  };
  // The part of the canvas the fitted map uses: the free rectangle it is drawn biggest in.
  const usable = () => {
    const b = state.routing ? state.routing.bounds : null;
    return freeRect(state.W, state.H, controlBoxes(), b ? (b.maxX - b.minX) / Math.max(1, b.maxZ - b.minZ) : 1);
  };
  function fit() {
    const b = state.routing.bounds, u = usable();
    const s = Math.min(u.w / (b.maxX - b.minX), u.h / (b.maxZ - b.minZ));
    state.view.s = s;
    state.view.ox = (b.minX + b.maxX) / 2 - (u.x + u.w / 2) / s;
    state.view.oy = (b.minZ + b.maxZ) / 2 - (u.y + u.h / 2) / s;
    state.fitScale = s;
  }
  function zoomAt(k, sx, sy) {
    const before = toWorldPt(sx, sy);
    state.view.s = clamp(state.view.s * k, state.fitScale * 0.6, state.fitScale * 14);
    state.view.ox = before.x - sx / state.view.s; state.view.oy = before.z - sy / state.view.s;
    draw();
  }
  function zoomBy(k) { zoomAt(k, state.W / 2, state.H / 2); }

  function size() {
    const r = wrap.getBoundingClientRect();
    state.W = Math.max(200, Math.round(r.width)); state.H = Math.max(200, Math.round(r.height));
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.width = `${state.W}px`; canvas.style.height = `${state.H}px`;
    canvas.width = Math.round(state.W * state.dpr); canvas.height = Math.round(state.H * state.dpr);
  }

  // --- drawing ---
  function poly(pts) { const p = new Path2D(); pts.forEach((q, i) => { const s = toScreen(q.x, q.z); if (i) p.lineTo(s.x, s.y); else p.moveTo(s.x, s.y); }); p.closePath(); return p; }
  function draw() {
    if (!cm.open) return;
    const { dpr, W, H, view } = state, id = state.course.look || state.course.id;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GROUND[id] || COL.ground; ctx.fillRect(0, 0, W, H);
    const s = view.s;
    for (const sh of state.shapes) {
      const cur = sh.index === state.current, sel = sh.index === state.selected;
      ctx.globalAlpha = state.current == null || cur || sel ? 1 : COL.dim + 0.3;
      ctx.fillStyle = ROUGH[id] || COL.rough; ctx.fill(poly(sh.rough));
      if (sh.fairway) { ctx.fillStyle = COL.fairway; ctx.fill(poly(sh.fairway)); }
      ctx.strokeStyle = COL.water; ctx.lineCap = 'round';
      for (const st of sh.streams) { ctx.lineWidth = Math.max(1, st.half * 2 * s); ctx.beginPath(); st.pts.forEach((p, i) => { const q = toScreen(p.x, p.z); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); }
      ctx.fillStyle = COL.water;
      for (const c of sh.ponds) { const q = toScreen(c.x, c.z); ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1, c.r * s), 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = COL.green; ctx.fill(poly(sh.green));
      ctx.fillStyle = COL.tee; for (const t of sh.tees) ctx.fill(poly(t));
      ctx.fillStyle = COL.sand;
      for (const c of sh.bunkers) { const q = toScreen(c.x, c.z); ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.8, c.r * s), 0, Math.PI * 2); ctx.fill(); }
      if (cur || sel) { ctx.strokeStyle = sel ? COL.pick : COL.current; ctx.lineWidth = 2.5; ctx.stroke(poly(sh.rough)); }
    }
    ctx.globalAlpha = 1;
    // The walk from each green to the next tee, faintly.
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]);
    for (let i = 1; i < state.shapes.length; i++) { const a = toScreen(state.shapes[i - 1].greenCenter.x, state.shapes[i - 1].greenCenter.z), b = toScreen(state.shapes[i].tee.x, state.shapes[i].tee.z); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.setLineDash([]);
    // Flags on every green.
    for (const sh of state.shapes) {
      const p = toScreen(sh.pin.x, sh.pin.z);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 9); ctx.stroke();
      ctx.fillStyle = sh.index === state.current ? COL.current : '#e04a3a'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x + 6, p.y - 7); ctx.lineTo(p.x, p.y - 5); ctx.fill();
    }
    // The ball and the line to the pin (in a round).
    if (state.ball && state.current != null) {
      const b = toScreen(state.ball.x, state.ball.z), sh = state.shapes[state.current], p = toScreen((state.pinW || sh.pin).x, (state.pinW || sh.pin).z);
      ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // The clubhouse.
    const ch = toScreen(state.routing.clubhouse.x, state.routing.clubhouse.z);
    ctx.fillStyle = '#e8b36a'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(ch.x - 7, ch.y + 6); ctx.lineTo(ch.x - 7, ch.y - 1); ctx.lineTo(ch.x, ch.y - 8); ctx.lineTo(ch.x + 7, ch.y - 1); ctx.lineTo(ch.x + 7, ch.y + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    drawLabels(ch);
  }

  function drawLabels(ch) {
    const items = [];
    const fontPx = state.W >= 1600 ? 15 : 13;
    const bw = Math.round(fontPx * 1.9), bh = Math.round(fontPx * 1.65);
    // The clubhouse label first, then the current or picked hole, then the rest in order.
    items.push({ kind: 'club', text: 'Clubhouse', w: Math.round(fontPx * 6.2), h: bh, candidates: [{ x: ch.x, y: ch.y + 18 }, { x: ch.x, y: ch.y - 22 }, { x: ch.x + 50, y: ch.y }, { x: ch.x - 50, y: ch.y }] });
    const order = state.shapes.map((sh) => sh.index).sort((a, b) => (b === state.current || b === state.selected) - (a === state.current || a === state.selected) || a - b);
    for (const i of order) {
      const sh = state.shapes[i], t = toScreen(sh.tee.x, sh.tee.z), n1 = toScreen(sh.line[1].x, sh.line[1].z);
      const dx = t.x - n1.x, dy = t.y - n1.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const cands = [];
      for (const r of [16, 26, 38]) for (const a of [0, 0.7, -0.7, 1.5, -1.5]) { const c = Math.cos(a), s2 = Math.sin(a); cands.push({ x: t.x + (ux * c - uy * s2) * r, y: t.y + (uy * c + ux * s2) * r }); }
      for (const q of sh.line) { const p = toScreen(q.x, q.z); cands.push({ x: p.x, y: p.y }); }
      items.push({ kind: 'hole', index: i, text: String(sh.number), w: bw, h: bh, candidates: cands });
    }
    // Labels may go anywhere on screen that the buttons leave free.
    state.labels = placeLabels(items, { x: 10, y: 10, w: state.W - 20, h: state.H - 20 }, undefined, controlBoxes());
    ctx.font = `700 ${fontPx}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const l of state.labels) {
      if (!l.box) continue;
      const b = l.box, hi = l.index === state.current ? COL.current : l.index === state.selected ? COL.pick : null;
      ctx.fillStyle = hi || COL.labelBg; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(9, b.h / 2)); ctx.fill();
      ctx.fillStyle = hi ? '#10181a' : COL.label;
      ctx.fillText(l.text, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
    }
  }

  function updateInfo() {
    const units = settings ? settings.units : 'yards', r = state.routing;
    title.textContent = `${state.course.name}, par ${state.shapes.reduce((a, s) => a + s.par, 0)}`;
    if (state.pick) {
      const sel = state.selected != null ? state.shapes[state.selected] : null;
      info.textContent = sel ? `Hole ${sel.number}: par ${sel.par}, ${units === 'meters' ? `${Math.round(sel.yards * 0.9144)} m` : `${sel.yards} yards`}. Tap Start here, or another hole.` : 'Tap a hole to start your round there.';
      startBtn.classList.toggle('hidden', sel == null);
      startBtn.textContent = sel ? `Start on hole ${sel.number}` : 'Start here';
    } else if (state.current != null) {
      const sh = state.shapes[state.current];
      info.textContent = `Hole ${sh.number}, par ${sh.par}${state.ballDist != null ? `: ${fmtDist(state.ballDist, units)} to the pin` : ''}. ${r.source === 'OpenStreetMap' ? 'Routing after the real course.' : ''}`;
      startBtn.classList.add('hidden');
    } else {
      info.textContent = r.source === 'OpenStreetMap' ? 'Routing after the real course (OpenStreetMap).' : 'Drag to move, pinch or scroll to zoom.';
      startBtn.classList.add('hidden');
    }
  }

  // --- input: drag, pinch, wheel, tap ---
  const pointers = new Map();
  let gesture = null;
  canvas.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    gesture = { start: performance.now(), moved: 0, view: { ...state.view }, pts: [...pointers.values()].map((p) => ({ ...p })) };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const pts = [...pointers.values()], g = gesture;
    if (pts.length === 1 && g.pts.length === 1) {
      const dx = pts[0].x - g.pts[0].x, dy = pts[0].y - g.pts[0].y;
      g.moved = Math.max(g.moved, Math.hypot(dx, dy));
      state.view.ox = g.view.ox - dx / state.view.s; state.view.oy = g.view.oy - dy / state.view.s;
      draw();
    } else if (pts.length >= 2 && g.pts.length >= 2) {
      // Pinch: the two fingers' midpoint stays on the same spot of the course.
      const d0 = Math.hypot(g.pts[0].x - g.pts[1].x, g.pts[0].y - g.pts[1].y) || 1, d1 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const m0 = { x: (g.pts[0].x + g.pts[1].x) / 2, y: (g.pts[0].y + g.pts[1].y) / 2 }, m1 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const s = clamp(g.view.s * (d1 / d0), state.fitScale * 0.6, state.fitScale * 14);
      const wx = m0.x / g.view.s + g.view.ox, wz = m0.y / g.view.s + g.view.oy;
      state.view.s = s; state.view.ox = wx - m1.x / s; state.view.oy = wz - m1.y / s;
      g.moved = 99;
      draw();
    } else if (pts.length >= 2) {
      gesture = { start: g.start, moved: 99, view: { ...state.view }, pts: pts.map((p) => ({ ...p })) };
    }
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    if (g && pointers.size === 0 && g.moved < 8 && g.pts.length === 1) tap(e.offsetX, e.offsetY);
    gesture = pointers.size ? { start: performance.now(), moved: 99, view: { ...state.view }, pts: [...pointers.values()].map((p) => ({ ...p })) } : null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); zoomAt(Math.exp(-e.deltaY * 0.0016), e.offsetX, e.offsetY); }, { passive: false });
  // The hole under a point: its label, or within its corridor.
  function holeAt(sx, sy) {
    for (const l of state.labels) if (l.box && l.kind === 'hole' && sx >= l.box.x && sx <= l.box.x + l.box.w && sy >= l.box.y && sy <= l.box.y + l.box.h) return l.index;
    const p = toWorldPt(sx, sy);
    let best = null, bd = Infinity;
    for (const sh of state.shapes) {
      let d = Infinity;
      for (let k = 0; k < sh.line.length - 1; k++) d = Math.min(d, segDist(p.x, p.z, sh.line[k], sh.line[k + 1]));
      if (d < sh.corridor && d < bd) { bd = d; best = sh.index; }
    }
    return best;
  }
  function tap(sx, sy) {
    const i = holeAt(sx, sy);
    if (state.pick) { if (i != null) { state.selected = i; updateInfo(); draw(); } return; }
    if (i != null) { state.selected = i === state.current ? null : i; const sh = state.shapes[i]; info.textContent = `Hole ${sh.number}: par ${sh.par}, ${settings && settings.units === 'meters' ? `${Math.round(sh.yards * 0.9144)} m` : `${sh.yards} yards`}.`; draw(); }
  }
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) cm.close(); });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') { zoomBy(1.5); e.preventDefault(); } else if (e.key === '-' || e.key === '_') { zoomBy(1 / 1.5); e.preventDefault(); } else if (e.key === '0') { fit(); draw(); e.preventDefault(); }
  });

  // --- open and close ---
  // opts: courseId; current (hole index in play, or null); ball and pin in that hole's frame;
  // pick (Quick Play: choose the starting hole) with startHole (1 to 18) preselected.
  cm.show = (opts = {}) => {
    const course = courseById(opts.courseId);
    const routing = courseRouting(course);
    if (!routing) return false;
    if (state.routing !== routing) { state.routing = routing; state.course = course; state.shapes = routing.holes.map((_, i) => holeShapes(course, routing, i)); }
    state.course = course;
    state.current = opts.current != null ? opts.current : null;
    state.pick = !!opts.pick;
    state.onPick = opts.onPick || null;
    state.selected = state.pick && opts.startHole ? opts.startHole - 1 : null;
    const f = state.current != null ? holeFrame(routing, state.current) : null;
    state.ball = f && opts.ball ? toWorld(f, opts.ball.x, opts.ball.z) : null;
    state.pinW = f && opts.pin ? toWorld(f, opts.pin.x, opts.pin.z) : null;
    state.ballDist = opts.ball && opts.pin ? Math.hypot(opts.ball.x - opts.pin.x, opts.ball.z - opts.pin.z) : null;
    seg.classList.toggle('hidden', !onHoleMap || state.current == null);
    wrap.classList.remove('hidden');
    cm.open = true;
    size(); updateInfo(); fit(); draw();
    wrap.tabIndex = -1; try { wrap.focus({ preventScroll: true }); } catch { /* fine */ }
    return true;
  };
  cm.close = () => { if (!cm.open) return; cm.open = false; wrap.classList.add('hidden'); pointers.clear(); gesture = null; if (onClose) onClose(); };
  cm.redraw = () => { if (cm.open) { size(); draw(); } };
  // QA: every label box and every on-screen control box, in CSS pixels.
  cm.boxes = () => ({
    labels: state.labels.map((l) => ({ kind: l.kind, text: l.text, box: l.box, inView: l.inView })),
    controls: [title, seg, zoomIn, zoomOut, fitBtn, info, startBtn, closeBtn].filter((el) => !el.classList.contains('hidden')).map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className, x: r.x, y: r.y, w: r.width, h: r.height }; }),
    usable: usable(), size: { w: state.W, h: state.H },
  });
  window.addEventListener('resize', () => { if (cm.open) { size(); fit(); draw(); } });
  return cm;
}
