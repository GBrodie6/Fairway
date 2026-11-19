// The level creator and the community hole browser.
//
//   Create     templates (six), a random hole, a blank one, your drafts, and Browse
//   Editor     a top-down map: drag the tee, the pin and the bend handles; big buttons place a
//              bunker, water, trees, rough or a hill beside the fairway (then drag to move,
//              pinch to resize, the bin deletes); Green size cycles; Decorate adds trees and
//              rough; undo and redo; par from the distance; plain problems under the map
//   Test play  plays the hole from the tee and comes back; publishing needs one finished
//              test of the hole as it is now
//   Browse     New, Top and Mine, with a drawn thumbnail, name, author, par, distance, likes and
//              plays; Play, Like, Report, Share (#level=id) and Play random; your best and the
//              best score per hole
// Drafts live on this device; a publish made offline waits for the connection.
import { h } from './dom.js';
import { fmtDist } from './format.js';
import {
  TEMPLATES, blankLevel, randomLevel, autoDecorate, parseLevel, levelPar, levelLength, levelProblems,
  nameProblem, levelCourse, levelKey, along, LEVEL_CAPS, LEVEL_LIMITS, LEVEL_AREA, cleanName,
} from '../game/level.js';
import { courseById, registerCourse } from '../course/courses.js';
import { listLevels, getLevel, publishLevel, deleteLevel, likeLevel, reportLevel, playedLevel, submitLevelScore, levelBest, LEVEL_TEXT } from '../net/levels.js';
import { isGameAccount } from '../net/account.js';
import { clamp } from '../core/math.js';

const DRAFTS_KEY = 'fairway-next.levelDrafts';
const COLORS = {
  parkland: { rough: '#3f6b33', fairway: '#6fa64e', green: '#8fd06a' }, links: { rough: '#7b7f45', fairway: '#9fae62', green: '#b3c77a' },
  desert: { rough: '#b8946a', fairway: '#7fa452', green: '#94c869' }, alpine: { rough: '#3b6038', fairway: '#69a04c', green: '#8cc866' },
  tropical: { rough: '#3e7234', fairway: '#72ae52', green: '#93d36e' },
};
const storage = () => { try { return localStorage; } catch { return null; } };

const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- drawing
/** The view that fits a level: world meters to canvas pixels (z up the screen). */
export function fitView(lv, w, h, pad = 26) {
  const xs = [lv.tee[0], lv.pin[0], ...lv.bend.map((p) => p[0])], zs = [lv.tee[1], lv.pin[1], ...lv.bend.map((p) => p[1])];
  for (const k of ['bunkers', 'water', 'rough', 'hills']) for (const c of lv[k]) { xs.push(c[0] - c[2], c[0] + c[2]); zs.push(c[1] - c[2], c[1] + c[2]); }
  const mx = Math.max(24, (Math.max(...zs) - Math.min(...zs)) * 0.08);
  const minX = Math.min(...xs) - mx - 16, maxX = Math.max(...xs) + mx + 16, minZ = Math.min(...zs) - mx, maxZ = Math.max(...zs) + mx;
  const s = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
  const ox = w / 2 - ((minX + maxX) / 2) * s, oz = h / 2 - ((minZ + maxZ) / 2) * s;
  return { s, toPx: (x, z) => [ox + x * s, oz + z * s], toWorld: (px, py) => [(px - ox) / s, (py - oz) / s] };
}
export function drawLevel(ctx, lv, w, h, { view = fitView(lv, w, h), selected = null, handles = false } = {}) {
  const col = COLORS[lv.theme] || COLORS.parkland, s = view.s, P = (p) => view.toPx(p[0], p[1]);
  ctx.save();
  ctx.fillStyle = col.rough; ctx.fillRect(0, 0, w, h);
  // Rough patches and hills under everything.
  // Rough patches: darker grass with a dashed edge, so they read against the rough colour.
  for (const r of lv.rough) { const [x, y] = P(r); ctx.fillStyle = 'rgba(18, 40, 14, 0.6)'; ctx.beginPath(); ctx.arc(x, y, r[2] * s, 0, 7); ctx.fill(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(200, 230, 170, 0.5)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
  for (const hl of lv.hills) { const [x, y] = P(hl); for (let k = 3; k >= 1; k--) { ctx.strokeStyle = hl[3] >= 0 ? `rgba(255,255,255,${0.12 * k})` : `rgba(0,0,0,${0.14 * k})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, (hl[2] * s * k) / 3, 0, 7); ctx.stroke(); } }
  // The fairway along the route.
  const route = [lv.tee, ...lv.bend, lv.pin].map(P);
  ctx.strokeStyle = col.fairway; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(6, 38 * s);
  ctx.beginPath(); route.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  for (const wv of lv.water) { const [x, y] = P(wv); ctx.fillStyle = '#3d86c6'; ctx.beginPath(); ctx.arc(x, y, wv[2] * s, 0, 7); ctx.fill(); }
  for (const b of lv.bunkers) { const [x, y] = P(b); ctx.fillStyle = '#ead9a6'; ctx.beginPath(); ctx.arc(x, y, b[2] * s, 0, 7); ctx.fill(); }
  const [gx, gy] = P(lv.pin);
  ctx.fillStyle = col.green; ctx.beginPath(); ctx.arc(gx, gy, Math.max(4, lv.green * s), 0, 7); ctx.fill();
  for (const t of lv.trees) { const [x, y] = P(t); ctx.fillStyle = '#1f3d1c'; ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, 4 * s), 0, 7); ctx.fill(); }
  const [tx, ty] = P(lv.tee);
  ctx.fillStyle = '#d6e7b8'; ctx.fillRect(tx - Math.max(4, 5 * s), ty - Math.max(3, 4 * s), Math.max(8, 10 * s), Math.max(6, 8 * s));
  // The flag.
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 16); ctx.stroke();
  ctx.fillStyle = '#e8452f'; ctx.beginPath(); ctx.moveTo(gx, gy - 16); ctx.lineTo(gx + 10, gy - 12); ctx.lineTo(gx, gy - 8); ctx.fill();
  if (handles) {
    const ring = (x, y, r, c, on) => { ctx.lineWidth = on ? 3 : 2; ctx.strokeStyle = on ? '#ffd166' : c; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); };
    ring(tx, ty, 14, '#ffffff', selected && selected.kind === 'tee');
    ring(gx, gy, 16, '#ffffff', selected && selected.kind === 'pin');
    lv.bend.forEach((b, i) => { const [x, y] = P(b); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x + 10, y); ctx.lineTo(x, y + 10); ctx.lineTo(x - 10, y); ctx.fill(); if (selected && selected.kind === 'bend' && selected.i === i) ring(x, y, 15, '#fff', true); });
    if (selected && selected.list) { const c = lv[selected.list][selected.i]; if (c) { const [x, y] = P(c); ring(x, y, Math.max(12, (c[2] || 5) * s + 4), '#fff', true); } }
  }
  ctx.restore();
}
function thumbCanvas(lv, w = 96, hh = 128) {
  const c = h('canvas', { class: 'lvthumb', width: String(w * 2), height: String(hh * 2), 'aria-hidden': 'true' });
  c.style.width = `${w}px`; c.style.height = `${hh}px`;
  const ctx = c.getContext('2d');
  if (ctx) { ctx.scale(2, 2); drawLevel(ctx, lv, w, hh); }
  return c;
}

export function installLevels(app, ui) {
  const { screens } = ui;
  const game = app.game;
  const sheet = (cls, ...kids) => h('div', { class: `sheet glass ${cls || ''}` }, ...kids);
  const btn = (label, onclick, cls = 'btn', extra = {}) => h('button', { class: cls, type: 'button', onclick, ...extra }, label);
  const client = () => (app.cloud ? app.cloud.client : null);
  const status = h('p', { class: 'muted small lvstatus', role: 'status', 'aria-live': 'polite' });
  const say = (t) => { status.textContent = t || ''; };
  const units = () => app.settings.units;

  // ---------- drafts on this device ----------
  const readDrafts = () => { try { const d = JSON.parse((storage() && storage().getItem(DRAFTS_KEY)) || '[]'); return Array.isArray(d) ? d.filter((x) => x && x.id && parseLevel(x.level).ok).slice(0, 20) : []; } catch { return []; } };
  const writeDrafts = (list) => { try { storage() && storage().setItem(DRAFTS_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* full */ } };
  const saveDraft = (d) => { const list = readDrafts().filter((x) => x.id !== d.id); writeDrafts([{ ...d, savedAt: Date.now() }, ...list]); };

  // ---------- the editor's state ----------
  const ed = { draft: null, lv: null, undo: [], redo: [], selected: null, tested: {}, view: null, publishing: false, zoom: 1, pan: { x: 0, y: 0 } };
  const commit = (next, keepRedo = false) => {
    const p = parseLevel(next);
    if (!p.ok) return;
    ed.undo.push(ed.lv); if (ed.undo.length > 60) ed.undo.shift();
    if (!keepRedo) ed.redo = [];
    ed.lv = p.level;
    ed.draft = { ...ed.draft, level: ed.lv };
    saveDraft(ed.draft);
    refresh();
  };
  function openEditor(level, draft = null) {
    ed.lv = parseLevel(level).level;
    ed.draft = draft || { id: `d${Date.now().toString(36)}`, level: ed.lv, tested: null, publishedId: null };
    ed.tested = draft && draft.tested ? { [draft.tested]: true } : {};
    ed.undo = []; ed.redo = []; ed.selected = null; ed.view = null; ed.zoom = 1; ed.pan = { x: 0, y: 0 };
    saveDraft(ed.draft);
    editorScreen();
  }
  app.openLevelEditor = openEditor;
  // Read-only view for the QA tools: where things are on the canvas. They act through taps.
  app.levelEditor = {
    level: () => ed.lv && JSON.parse(JSON.stringify(ed.lv)),
    selected: () => ed.selected,
    draft: () => ed.draft && { id: ed.draft.id, publishedId: ed.draft.publishedId || null, pendingPublish: !!ed.draft.pendingPublish },
    toScreen: (x, z) => { if (!ed.view) return null; const r = canvas.getBoundingClientRect(), [px, py] = ed.view.toPx(x, z); return { x: r.left + px, y: r.top + py }; },
  };

  // ---------- Create ----------
  screens.register('create', () => screens.show('create', () => {
    const drafts = readDrafts();
    return sheet('wide create',
      h('h2', { class: 'h', text: 'Create a hole' }),
      h('p', { class: 'muted small', text: 'Start from a template, then drag the tee, the pin and the bends. Test play it once and publish it for everyone.' }),
      h('div', { class: 'lvtemplates' }, ...TEMPLATES.map((t) => h('button', { type: 'button', class: 'lvtemplate', onclick: () => openEditor(t.make()) }, thumbCanvas(t.make(), 72, 96), h('b', { text: t.name })))),
      h('div', { class: 'grid2', style: { marginTop: '8px' } }, btn('Random hole', () => openEditor(randomLevel((Date.now() ^ 0x5bd1) >>> 0))), btn('Blank', () => openEditor(blankLevel()))),
      drafts.length ? h('h3', { class: 'h small', text: 'Your drafts' }) : null,
      drafts.length ? h('div', { class: 'list' }, ...drafts.slice(0, 6).map((d) => h('div', { class: 'item' }, h('span', { text: `${d.level.name}${d.publishedId ? ' (published)' : d.pendingPublish ? ' (waiting to publish)' : ''}` }), h('div', { class: 'row' }, btn('Open', () => openEditor(d.level, d), 'btn small'), btn('Delete', () => { writeDrafts(readDrafts().filter((x) => x.id !== d.id)); screens.registry.create(); }, 'btn small'))))) : null,
      h('div', { class: 'grid2', style: { marginTop: '12px' } }, btn('Back', () => screens.back()), btn('Browse holes', () => screens.registry.levels(), 'btn primary')));
  }));

  // ---------- Editor ----------
  const canvas = h('canvas', { class: 'lvcanvas', tabindex: '0', 'aria-label': 'The hole from above. Drag the tee, the pin, the bend handles and anything you placed. Number keys place pieces, Delete removes the selected one.' });
  const parLabel = h('b', { class: 'lvpar' });
  function refresh() {
    if (!ed.lv) return;
    parLabel.textContent = `Par ${levelPar(ed.lv)}, ${fmtDist(levelLength(ed.lv), units())}`;
    const probs = levelProblems(ed.lv);
    const np = nameProblem(ed.lv.name);
    const key = levelKey(ed.lv);
    say(probs.length ? probs[0] : np ? np : ed.tested[key] ? (ed.draft.publishedId ? 'Published. Changes need a new test before you publish again.' : 'Tested. Ready to publish.') : 'Test play the hole once to publish it.');
    if (pubBtn) pubBtn.disabled = !!probs.length || !!np || !ed.tested[key] || ed.publishing;
    if (testBtn) testBtn.disabled = !!probs.length;
    if (undoBtn) undoBtn.disabled = !ed.undo.length;
    if (redoBtn) redoBtn.disabled = !ed.redo.length;
    if (binBtn) binBtn.disabled = !ed.selected || ed.selected.kind === 'tee' || ed.selected.kind === 'pin';
    draw();
  }
  function draw() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(100, Math.round(r.width || 320)), hh = Math.max(100, Math.round(r.height || 360));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== w * dpr || canvas.height !== hh * dpr) { canvas.width = w * dpr; canvas.height = hh * dpr; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!ed.view || !drag) ed.view = zoomView(fitView(ed.lv, w, hh), w, hh);
    drawLevel(ctx, ed.lv, w, hh, { view: ed.view, selected: ed.selected, handles: true });
  }
  // Hit test: the pin, the tee, the bends, then placed things (topmost first).
  // Zoom and pan (desktop: the wheel, the middle button or Space and drag; 0 fits again): the
  // fitted view scaled about the canvas centre and moved by the pan, in canvas pixels.
  function zoomView(base, w, hh) {
    const z = ed.zoom, cx = w / 2, cy = hh / 2, px0 = ed.pan.x, py0 = ed.pan.y;
    if (z === 1 && !px0 && !py0) return base;
    return {
      s: base.s * z,
      toPx: (x, zz) => { const [a, b] = base.toPx(x, zz); return [cx + (a - cx) * z + px0, cy + (b - cy) * z + py0]; },
      toWorld: (a, b) => base.toWorld(cx + (a - cx - px0) / z, cy + (b - cy - py0) / z),
    };
  }
  const resetView = () => { ed.zoom = 1; ed.pan = { x: 0, y: 0 }; ed.view = null; draw(); };
  canvas.addEventListener('wheel', (e) => {
    if (!Number.isFinite(e.deltaY)) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const z0 = ed.zoom, z1 = clamp(z0 * Math.exp(-clamp(e.deltaY, -240, 240) * 0.0015), 1, 6);
    if (z1 === z0) return;
    // Keep the point under the cursor still.
    const cx = r.width / 2, cy = r.height / 2;
    ed.pan = z1 === 1 ? { x: 0, y: 0 } : { x: mx - cx - (mx - cx - ed.pan.x) * (z1 / z0), y: my - cy - (my - cy - ed.pan.y) * (z1 / z0) };
    ed.zoom = z1; ed.view = null; draw();
  }, { passive: false });
  let panning = null, spaceHeld = false;
  // Hit test: the selected piece first (so a pinch or a nudge keeps it), then the pin, the tee,
  // the bends, then placed things (the nearest one under the finger).
  const RADIUS = { bunkers: LEVEL_LIMITS.bunker, water: LEVEL_LIMITS.water, rough: LEVEL_LIMITS.rough, hills: LEVEL_LIMITS.hill };
  function hit(px, py) {
    const v = ed.view, lv = ed.lv, dist = (p) => { const [x, y] = v.toPx(p[0], p[1]); return Math.hypot(px - x, py - y); };
    const itemR = (c) => Math.max(18, (c[2] || 4) * v.s + 6);
    const sel = ed.selected;
    if (sel && sel.kind === 'item' && lv[sel.list][sel.i] && dist(lv[sel.list][sel.i]) < itemR(lv[sel.list][sel.i])) return sel;
    if (sel && sel.kind === 'bend' && lv.bend[sel.i] && dist(lv.bend[sel.i]) < 22) return sel;
    if (dist(lv.pin) < 26) return { kind: 'pin' };
    if (dist(lv.tee) < 24) return { kind: 'tee' };
    for (let i = 0; i < lv.bend.length; i++) if (dist(lv.bend[i]) < 22) return { kind: 'bend', i };
    let best = null, bestD = Infinity;
    for (const list of ['trees', 'bunkers', 'water', 'hills', 'rough']) for (let i = 0; i < lv[list].length; i++) { const c = lv[list][i], d = dist(c) / itemR(c); if (d < 1 && d < bestD) { bestD = d; best = { kind: 'item', list, i }; } }
    return best;
  }
  const resizable = (t) => !!(t && t.kind === 'item' && RADIUS[t.list]);
  // One finger drags what it lands on (an empty spot does nothing; a tap there clears the
  // selection). Two fingers resize the selected bunker, pond, rough patch or hill, wherever
  // they are on the map.
  let drag = null; const pointers = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
    // Pan: the middle button, or the left button with Space held.
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && spaceHeld))) { panning = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.classList.add('panning'); return; }
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    pointers.set(e.pointerId, { x: px, y: py });
    if (pointers.size === 2) {
      const t = drag && resizable(drag.target) ? drag.target : resizable(ed.selected) ? ed.selected : null;
      if (!t) return;
      const startLv = drag ? drag.start : ed.lv;
      if (drag && drag.target !== t) ed.lv = startLv;
      const [a, b] = [...pointers.values()];
      drag = { target: t, start: startLv, moved: !!(drag && drag.moved && drag.target === t), pinch: { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, r0: ed.lv[t.list][t.i][2] } };
      ed.selected = t;
      refresh();
      return;
    }
    if (pointers.size > 2) return;
    const target = hit(px, py);
    if (target) ed.selected = target;
    drag = { target, start: ed.lv, moved: false, pinch: null };
    refresh();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (panning && e.pointerId === panning.id) { ed.pan = { x: ed.pan.x + e.clientX - panning.x, y: ed.pan.y + e.clientY - panning.y }; panning.x = e.clientX; panning.y = e.clientY; ed.view = null; draw(); return; }
    // Hovering with a mouse: a move cursor over anything that can be dragged.
    if (e.pointerType === 'mouse' && !pointers.size && ed.view) { const r = canvas.getBoundingClientRect(); canvas.classList.toggle('over', !!hit(e.clientX - r.left, e.clientY - r.top)); }
    if (!drag || !drag.target || !pointers.has(e.pointerId)) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    pointers.set(e.pointerId, { x: px, y: py });
    const lv = JSON.parse(JSON.stringify(ed.lv)), t = drag.target;
    if (drag.pinch) {
      // After a pinch the last finger lifting does not move the piece.
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const lim = RADIUS[t.list];
      lv[t.list][t.i][2] = clamp(drag.pinch.r0 * (Math.hypot(a.x - b.x, a.y - b.y) / drag.pinch.d0), lim[0], lim[1]);
    } else {
      const [x, z] = ed.view.toWorld(px, py);
      const p = [clamp(x, LEVEL_AREA.minX, LEVEL_AREA.maxX), clamp(z, LEVEL_AREA.minZ, LEVEL_AREA.maxZ)];
      if (t.kind === 'pin') lv.pin = p; else if (t.kind === 'tee') lv.tee = p; else if (t.kind === 'bend') lv.bend[t.i] = p;
      else { lv[t.list][t.i][0] = p[0]; lv[t.list][t.i][1] = p[1]; }
    }
    const parsed = parseLevel(lv);
    if (parsed.ok) { drag.moved = true; ed.lv = parsed.level; refresh(); }
  });
  const up = (e) => {
    if (panning && e.pointerId === panning.id) { panning = null; canvas.classList.remove('panning'); return; }
    pointers.delete(e.pointerId);
    if (!drag || pointers.size) return;
    const d = drag; drag = null;
    if (d.moved) { const now = ed.lv; ed.lv = d.start; commit(now); return; }
    if (!d.target) ed.selected = null;
    refresh();
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

  // Placing: a big button puts one beside the fairway at the next free spot, selected.
  let placeN = 0;
  function place(list) {
    const lv = JSON.parse(JSON.stringify(ed.lv));
    const hazards = lv.bunkers.length + lv.water.length + lv.rough.length + lv.hills.length;
    if (list !== 'trees' && hazards >= LEVEL_CAPS.hazards) { say(`At most ${LEVEL_CAPS.hazards} bunkers, ponds, rough patches and hills.`); return; }
    placeN++;
    const t = [0.42, 0.62, 0.3, 0.75, 0.52, 0.85][placeN % 6], side = placeN % 2 ? 1 : -1;
    const p = along(lv, t), q = along(lv, Math.min(1, t + 0.02));
    const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    const off = { bunkers: 24, water: 40, rough: 30, hills: 34, trees: 46 }[list];
    const c = [p[0] + nx * off * side, p[1] + nz * off * side];
    if (list === 'trees') {
      if (lv.trees.length + 6 > LEVEL_CAPS.trees) { say(`At most ${LEVEL_CAPS.trees} trees.`); return; }
      for (let k = 0; k < 6; k++) lv.trees.push([c[0] + Math.cos(k * 1.1) * (4 + k * 2), c[1] + Math.sin(k * 1.1) * (4 + k * 2)]);
      ed.selected = { kind: 'item', list: 'trees', i: lv.trees.length - 1 };
    } else {
      const r = { bunkers: 5, water: 14, rough: 12, hills: 20 }[list];
      lv[list].push(list === 'hills' ? [...c, r, 3] : [...c, r]);
      ed.selected = { kind: 'item', list, i: lv[list].length - 1 };
    }
    commit(lv);
  }
  const TOOL_KEY = { Bunker: 1, Water: 2, Trees: 3, Rough: 4, Hills: 5, 'Green size': 6, 'Add bend': 7, Decorate: 8 };
  const big = (label, onclick) => h('button', { type: 'button', class: 'btn lvtool', onclick, title: `${label} (${TOOL_KEY[label]})` }, label);
  let undoBtn, redoBtn, binBtn, testBtn, pubBtn;
  function editorScreen() {
    screens.show('editor', () => {
      const name = h('input', { type: 'text', id: 'lv-name', value: ed.lv.name, maxlength: String(LEVEL_CAPS.name), 'aria-label': 'Hole name', onchange: (e) => { commit({ ...ed.lv, name: cleanName(e.target.value) || ed.lv.name }); } });
      undoBtn = btn('Undo', () => { if (!ed.undo.length) return; ed.redo.push(ed.lv); ed.lv = ed.undo.pop(); ed.draft = { ...ed.draft, level: ed.lv }; saveDraft(ed.draft); ed.selected = null; refresh(); }, 'btn small');
      redoBtn = btn('Redo', () => { if (!ed.redo.length) return; ed.undo.push(ed.lv); ed.lv = ed.redo.pop(); ed.draft = { ...ed.draft, level: ed.lv }; saveDraft(ed.draft); refresh(); }, 'btn small');
      binBtn = btn('Delete', () => {
        const s = ed.selected; if (!s) return;
        const lv = JSON.parse(JSON.stringify(ed.lv));
        if (s.kind === 'bend') lv.bend.splice(s.i, 1); else if (s.kind === 'item') lv[s.list].splice(s.i, 1); else return;
        ed.selected = null; commit(lv);
      }, 'btn small', { 'aria-label': 'Delete the selected piece' });
      undoBtn.title = 'Undo (Ctrl+Z)'; redoBtn.title = 'Redo (Ctrl+Y)'; binBtn.title = 'Delete the selected piece (Delete)';
      testBtn = btn('Test play', () => testPlay(), 'btn');
      pubBtn = btn('Publish', () => publish(), 'btn primary');
      const greenSizes = [10, 13, 17];
      const view = sheet('editor',
        h('div', { class: 'lvtop' }, name, parLabel),
        canvas,
        status,
        h('div', { class: 'lvtools' },
          big('Bunker', () => place('bunkers')), big('Water', () => place('water')), big('Trees', () => place('trees')),
          big('Rough', () => place('rough')), big('Hills', () => place('hills')),
          big('Green size', () => { const i = greenSizes.findIndex((g) => g >= ed.lv.green - 0.5); commit({ ...ed.lv, green: greenSizes[(i + 1) % greenSizes.length] }); }),
          big('Add bend', () => { if (ed.lv.bend.length >= LEVEL_CAPS.bends) { say('Two bends at most.'); return; } const p = along(ed.lv, ed.lv.bend.length ? 0.78 : 0.5); commit({ ...ed.lv, bend: [...ed.lv.bend, [p[0] + 12, p[1]]].sort((a, b) => b[1] - a[1]) }); }),
          big('Decorate', () => commit(autoDecorate(ed.lv, (Date.now() >>> 0) & 0xffff)))),
        h('div', { class: 'lvactions' }, undoBtn, redoBtn, binBtn),
        h('div', { class: 'grid2' }, btn('Back', () => { screens.registry.create(); }), testBtn),
        h('div', { class: 'stack', style: { marginTop: '6px' } }, pubBtn));
      requestAnimationFrame(refresh);
      return view;
    });
    // The canvas is in the page now: draw it and set the status at once. With a mouse and a
    // keyboard the map takes the focus (not the name box), so the editor's keys work at once.
    refresh();
    if (typeof matchMedia === 'function' && !matchMedia('(pointer: coarse)').matches) canvas.focus({ preventScroll: true });
  }
  window.addEventListener('resize', () => { if (ui.modal === 'editor') { ed.view = null; draw(); } });
  // Editor shortcuts (listed on the Controls screen). Never while typing the hole's name.
  const PALETTE_KEYS = ['Bunker', 'Water', 'Trees', 'Rough', 'Hills', 'Green size', 'Add bend', 'Decorate'];
  const clickTool = (label) => { const b = [...document.querySelectorAll('.sheet.editor .lvtool')].find((x) => x.textContent.trim() === label); if (b && !b.disabled) b.click(); };
  window.addEventListener('keydown', (e) => {
    if (ui.modal !== 'editor') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); (e.shiftKey ? redoBtn : undoBtn).click(); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); redoBtn.click(); return; }
    if (mod || e.altKey) return;
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); binBtn.click(); return; }
    if (e.code === 'Space') { e.preventDefault(); spaceHeld = true; canvas.classList.add('panready'); return; }
    if (e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); resetView(); return; }
    const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
    if (m) { e.preventDefault(); clickTool(PALETTE_KEYS[Number(m[1]) - 1]); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceHeld = false; canvas.classList.remove('panready'); } });
  window.addEventListener('blur', () => { spaceHeld = false; canvas.classList.remove('panready'); });

  // ---------- playing a hole (test or published) ----------
  async function playHole(lv, { test = false, id = null } = {}) {
    const c = registerCourse(levelCourse(lv, courseById(lv.theme)));
    const key = levelKey(lv);
    const s = app.save();
    app.levelPlay = { courseId: c.id, test, id, key, lv, end: (r) => endPlay(r) };
    screens.hide();
    if (id && client() && client().user) playedLevel(client(), id).catch(() => {});
    await game.startRound({ courseId: c.id, mode: 'stroke', holes: [0], tod: 'morning', seed: (Date.now() >>> 0) || 1, players: [{ id: 'p1', name: (s.account && s.account.displayName) || s.player.name || 'You', kind: 'human', handed: app.settings.handedness, ball: s.player.ball || '#ffffff' }] });
  }
  async function endPlay(r) {
    const lp = app.levelPlay; app.levelPlay = null;
    // The finished hole is in the scores and the log (the per-hole state is cleared by then).
    const strokes = r.scores && r.scores[0] ? r.scores[0][0] : null, log = r.logs && r.logs[0] ? r.logs[0][0] : null;
    const finished = Number.isFinite(strokes) && !!log && !log.pickedUp;
    let best = null;
    if (lp.test) { if (finished) { ed.tested[lp.key] = true; ed.draft = { ...ed.draft, tested: lp.key }; saveDraft(ed.draft); } }
    else if (lp.id && finished && client() && client().user) { await submitLevelScore(client(), lp.id, strokes, app.save().account ? app.save().account.displayName : 'Golfer').catch(() => {}); }
    if (!lp.test && lp.id && client()) best = (await levelBest(client(), lp.id).catch(() => ({}))).data || null;
    screens.show('levelend', () => sheet('',
      h('h2', { class: 'h center', text: finished ? `Holed in ${strokes}` : 'Picked up' }),
      h('p', { class: 'muted center', text: `${lp.lv.name}, par ${levelPar(lp.lv)}.` }),
      lp.test ? h('p', { class: 'center', text: finished ? 'Test passed. You can publish this hole now.' : 'Hole it out to pass the test.' }) : null,
      best ? h('p', { class: 'center small', text: `${best.best ? `Best: ${best.best.value} by ${best.best.name}.` : 'No scores yet.'}${best.mine != null ? ` Your best: ${best.mine}.` : ''}` }) : null,
      h('div', { class: 'stack', style: { marginTop: '12px' } }, lp.test ? btn('Back to the editor', () => { game.quit(); editorScreen(); }, 'btn primary') : btn('Back to the holes', () => { game.quit(); screens.registry.levels(); }, 'btn primary'))));
  }
  function testPlay() {
    const probs = levelProblems(ed.lv);
    if (probs.length) { say(probs[0]); return; }
    playHole(ed.lv, { test: true });
  }
  app.playLevel = playHole;
  // Quitting a test from the pause menu goes back to the editor.
  game.on((type) => {
    if (type !== 'quit' || !app.levelPlay) return;
    const lp = app.levelPlay; app.levelPlay = null;
    if (lp.test) setTimeout(() => editorScreen(), 0);
  });

  // ---------- publishing ----------
  async function publish() {
    const key = levelKey(ed.lv);
    if (!ed.tested[key]) { say('Test play the hole once to publish it.'); return; }
    const np = nameProblem(ed.lv.name);
    if (np) { say(np); return; }
    const c = client();
    if (!c || !c.configured) { say('Publishing needs cloud sync, which is off in this build.'); return; }
    if (!c.user || !isGameAccount(c.user)) { say(LEVEL_TEXT.signin); if (screens.registry.account) setTimeout(() => screens.registry.account(), 900); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { ed.draft = { ...ed.draft, pendingPublish: true }; saveDraft(ed.draft); say(LEVEL_TEXT.offline); return; }
    ed.publishing = true; refresh(); say('Publishing...');
    const author = (app.save().account && app.save().account.displayName) || c.user.username || 'Golfer';
    const r = await publishLevel(c, ed.lv, author);
    ed.publishing = false;
    if (r.error === 'offline') { ed.draft = { ...ed.draft, pendingPublish: true }; saveDraft(ed.draft); refresh(); say(LEVEL_TEXT.offline); return; }
    if (r.error) { refresh(); say(LEVEL_TEXT[r.error] || LEVEL_TEXT.failed); return; }
    ed.draft = { ...ed.draft, publishedId: r.data.id, pendingPublish: false };
    saveDraft(ed.draft);
    refresh();
    say(`Published "${r.data.name}". Find it under New.`);
    if (ui.hud) ui.hud.toast('Hole published', r.data.name, 2200);
  }
  // A publish made offline goes out when the connection is back.
  async function flushPending() {
    const c = client();
    if (!c || !c.user || !isGameAccount(c.user)) return;
    for (const d of readDrafts().filter((x) => x.pendingPublish && !x.publishedId)) {
      const r = await publishLevel(c, d.level, (app.save().account && app.save().account.displayName) || 'Golfer');
      if (!r.error) saveDraft({ ...d, pendingPublish: false, publishedId: r.data.id });
    }
  }
  window.addEventListener('online', () => flushPending().catch(() => {}));
  setTimeout(() => flushPending().catch(() => {}), 4000);

  // ---------- Browse ----------
  let tab = 'new', cache = [];
  const bstatus = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
  function card(item) {
    const c = client(), mine = c && c.user && item.userId === c.user.id;
    const facts = () => `Par ${item.par}, ${fmtDist(levelLength(item.level), units())}. ${count(item.likes, 'like')}, ${count(item.plays, 'play')}.`;
    const factLine = h('span', { class: 'small', text: facts() });
    const like = btn(`Like (${item.likes})`, async () => { const r = await likeLevel(c, item.id); if (r.error) { bstatus.textContent = r.error === 'signin' ? LEVEL_TEXT.signin : 'That did not work. Please try again.'; return; } item.likes = Math.max(0, item.likes + (r.data ? 1 : -1)); like.textContent = `${r.data ? 'Liked' : 'Like'} (${item.likes})`; like.setAttribute('aria-pressed', r.data ? 'true' : 'false'); factLine.textContent = facts(); }, 'btn small');
    return h('div', { class: 'lvcard' }, thumbCanvas(item.level, 84, 112),
      h('div', { class: 'stack tight lvmeta' },
        h('b', { text: item.name }),
        h('span', { class: 'small muted', text: `by ${item.author}` }),
        factLine,
        h('div', { class: 'row wrap' },
          btn('Play', () => playHole(item.level, { id: item.id }), 'btn small primary'),
          like,
          btn('Share', () => share(item), 'btn small'),
          mine ? btn('Delete', async () => { const r = await deleteLevel(c, item.id); bstatus.textContent = r.error ? 'That did not work. Please try again.' : 'Deleted.'; if (!r.error) levelsScreen(); }, 'btn small') : btn('Report', () => reportFlow(item), 'btn small'))));
  }
  async function share(item) {
    const url = `${location.origin}${location.pathname}#level=${item.id}`;
    try { if (navigator.share) { await navigator.share({ title: item.name, url }); return; } } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(url); bstatus.textContent = 'Link copied.'; } catch { bstatus.textContent = url; }
  }
  function reportFlow(item) {
    screens.show('report', () => sheet('',
      h('h2', { class: 'h', text: 'Report this hole' }),
      h('p', { class: 'muted small', text: 'A hole is hidden for everyone after five reports.' }),
      h('div', { class: 'stack' }, ...['Offensive name', 'Impossible to play', 'Something else'].map((reason) => btn(reason, async () => { const r = await reportLevel(client(), item.id, reason); screens.back(); bstatus.textContent = r && r.error ? (r.error === 'signin' ? LEVEL_TEXT.signin : 'That did not work.') : 'Thanks. The hole was reported.'; })), btn('Back', () => screens.back()))));
  }
  function levelsScreen() {
    screens.show('levels', () => {
      const list = h('div', { class: 'lvlist' }, h('p', { class: 'muted', text: client() && client().configured ? 'Loading...' : 'Community holes need cloud sync, which is off in this build.' }));
      const tabs = h('div', { class: 'seg', role: 'tablist' }, ...[['new', 'New'], ['top', 'Top'], ['mine', 'Mine']].map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-pressed': tab === id ? 'true' : 'false', onclick: () => { tab = id; levelsScreen(); } }, label)));
      if (client() && client().configured) {
        listLevels(client(), tab).then((r) => {
          list.textContent = '';
          if (r.error) { list.appendChild(h('p', { class: 'muted', text: r.error === 'session-expired' ? 'Sign in to see your holes.' : 'The holes could not be loaded. Please try again.' })); return; }
          cache = r.data;
          if (!cache.length) { list.appendChild(h('p', { class: 'muted', text: tab === 'mine' ? 'You have not published a hole yet.' : 'No holes yet. Be the first.' })); return; }
          for (const item of cache) list.appendChild(card(item));
        });
      }
      return sheet('wide levels',
        h('h2', { class: 'h', text: 'Community holes' }),
        tabs,
        h('div', { class: 'grid2' }, btn('Play random', () => { if (cache.length) { const it = cache[Math.floor(Math.random() * cache.length)]; playHole(it.level, { id: it.id }); } else bstatus.textContent = 'Nothing to play yet.'; }), btn('Create a hole', () => screens.registry.create())),
        bstatus, list,
        h('div', { class: 'stack', style: { marginTop: '10px' } }, btn('Back', () => screens.back())));
    });
  }
  screens.register('levels', levelsScreen);

  // A shared link (#level=id) opens the hole.
  app.openLevelLink = async (id) => {
    const c = client();
    if (!c || !c.configured) return;
    const r = await getLevel(c, id);
    if (r.error) { if (ui.hud) ui.hud.toast('Hole not found', 'It may have been removed', 2400); return; }
    const item = r.data;
    screens.show('levelpreview', () => sheet('',
      h('h2', { class: 'h', text: item.name }),
      h('div', { class: 'center' }, thumbCanvas(item.level, 150, 200)),
      h('p', { class: 'center small', text: `By ${item.author}. Par ${item.par}, ${fmtDist(levelLength(item.level), units())}. ${count(item.likes, 'like')}, ${count(item.plays, 'play')}.` }),
      h('div', { class: 'grid2' }, btn('Back', () => screens.menu()), btn('Play', () => playHole(item.level, { id: item.id }), 'btn primary'))));
  };
}
