// Community holes: the level format, a strict loader, templates, auto-decorate, par from
// distance, the checks before publishing, and the synthetic course a level plays on. Pure, so
// it is tested directly (tests/level.test.js, with a fuzz test of the loader).
//
// A level is one hole in a frame where the tee starts at (0, 0) and the hole runs toward -z,
// in meters. The game builds it with the same hole builder and terrain builder as the built-in
// holes (course/layout.js generateHole with the level as its source), so physics and renderer
// agree exactly as they do everywhere else.
//
// Compact JSON, version 1:
//   { v: 1, name, theme, seed, tee: [x, z], pin: [x, z], bend: [[x, z], ...] (0 to 2),
//     green: radius, bunkers: [[x, z, r]], water: [[x, z, r]], rough: [[x, z, r]],
//     hills: [[x, z, r, h]], trees: [[x, z]] }
import { createRng, hashString } from '../core/rng.js';
import { clamp, YARD } from '../core/math.js';
import { isProfane } from './names.js';

export const LEVEL_VERSION = 1;
export const LEVEL_THEMES = ['parkland', 'links', 'desert', 'alpine', 'tropical'];
export const LEVEL_AREA = Object.freeze({ minX: -170, maxX: 170, minZ: -640, maxZ: 60 });
export const LEVEL_CAPS = Object.freeze({ hazards: 40, trees: 400, bends: 2, bytes: 20000, name: 24 });
export const LEVEL_LIMITS = Object.freeze({ green: [8, 20], bunker: [2, 9], water: [5, 40], rough: [4, 30], hill: [6, 40], hillH: [-4, 6], minLength: 70, maxLength: 600 });
const KEYS = ['v', 'name', 'theme', 'seed', 'tee', 'pin', 'bend', 'green', 'bunkers', 'water', 'rough', 'hills', 'trees'];
const HAZARD_LISTS = ['bunkers', 'water', 'rough', 'hills'];

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r1 = (v) => Math.round(v * 10) / 10;
const cx = (v) => r1(clamp(num(v), LEVEL_AREA.minX, LEVEL_AREA.maxX));
const cz = (v) => r1(clamp(num(v), LEVEL_AREA.minZ, LEVEL_AREA.maxZ));
const pt = (p) => (Array.isArray(p) && p.length >= 2 ? [cx(p[0]), cz(p[1])] : null);
const circles = (list, [lo, hi], extra) => (Array.isArray(list) ? list : []).map((c) => {
  if (!Array.isArray(c) || c.length < 3) return null;
  const out = [cx(c[0]), cz(c[1]), r1(clamp(num(c[2], lo), lo, hi))];
  if (extra) out.push(r1(clamp(num(c[3], 1), extra[0], extra[1])));
  return out;
}).filter(Boolean);

export function cleanName(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, LEVEL_CAPS.name);
}

/**
 * Load a level from anything (an object or JSON text). Never throws. Returns { ok, level } or
 * { ok: false, error } in plain words. Unknown fields are refused; coordinates are clamped to
 * the editor's area; lists past their caps are cut.
 */
export function parseLevel(raw) {
  try {
    let o = raw;
    if (typeof raw === 'string') {
      if (raw.length > LEVEL_CAPS.bytes) return { ok: false, error: 'That hole is too big.' };
      o = JSON.parse(raw);
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'That is not a hole.' };
    for (const k of Object.keys(o)) if (!KEYS.includes(k)) return { ok: false, error: `Unknown field "${String(k).slice(0, 20)}".` };
    if (o.v !== LEVEL_VERSION) return { ok: false, error: 'That hole is from another version.' };
    const tee = pt(o.tee), pin = pt(o.pin);
    if (!tee || !pin) return { ok: false, error: 'The hole needs a tee and a pin.' };
    const lv = {
      v: LEVEL_VERSION,
      name: cleanName(o.name) || 'Untitled hole',
      theme: LEVEL_THEMES.includes(o.theme) ? o.theme : 'parkland',
      seed: Math.floor(Math.abs(num(o.seed, 1))) % 2147483647 || 1,
      tee, pin,
      bend: (Array.isArray(o.bend) ? o.bend : []).map(pt).filter(Boolean).slice(0, LEVEL_CAPS.bends),
      green: r1(clamp(num(o.green, 13), ...LEVEL_LIMITS.green)),
      bunkers: circles(o.bunkers, LEVEL_LIMITS.bunker),
      water: circles(o.water, LEVEL_LIMITS.water),
      rough: circles(o.rough, LEVEL_LIMITS.rough),
      hills: circles(o.hills, LEVEL_LIMITS.hill, LEVEL_LIMITS.hillH),
      trees: (Array.isArray(o.trees) ? o.trees : []).map(pt).filter(Boolean).slice(0, LEVEL_CAPS.trees),
    };
    // Hazards share one cap, kept in list order.
    let left = LEVEL_CAPS.hazards;
    for (const k of HAZARD_LISTS) { lv[k] = lv[k].slice(0, Math.max(0, left)); left -= lv[k].length; }
    return { ok: true, level: lv };
  } catch {
    return { ok: false, error: 'That hole could not be read.' };
  }
}

export const serializeLevel = (lv) => JSON.stringify(lv);
export const levelBytes = (lv) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(serializeLevel(lv)).length : serializeLevel(lv).length);
export const levelKey = (lv) => (hashString(serializeLevel(lv)) >>> 0).toString(36);

// The route from the tee through the bend handles to the pin, and its length in meters.
export const levelRoute = (lv) => [lv.tee, ...lv.bend, lv.pin];
export function levelLength(lv) {
  const r = levelRoute(lv);
  let d = 0;
  for (let i = 1; i < r.length; i++) d += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
  return d;
}
export const levelYards = (lv) => Math.round(levelLength(lv) / YARD);
// Par from the playing distance: up to 250 yards a par 3, up to 470 a par 4, then a par 5.
export function levelPar(lv) {
  const y = levelYards(lv);
  return y <= 250 ? 3 : y <= 470 ? 4 : 5;
}

// --- checks before a test play and before publishing, in plain words ---
const inCircle = (p, c, pad = 0) => Math.hypot(p[0] - c[0], p[1] - c[1]) < c[2] + pad;
export function levelProblems(lv) {
  const out = [];
  const len = levelLength(lv);
  if (len < LEVEL_LIMITS.minLength) out.push('The hole is too short: move the pin further from the tee.');
  if (len > LEVEL_LIMITS.maxLength) out.push('The hole is too long: bring the pin closer to the tee.');
  if (lv.water.some((w) => inCircle(lv.pin, w, lv.green * 0.6))) out.push('The pin is in the water.');
  if (lv.water.some((w) => inCircle(lv.tee, w, 8))) out.push('The tee is in the water.');
  if (lv.bunkers.some((b) => inCircle(lv.pin, b, lv.green * 0.5))) out.push('A bunker covers the green.');
  if (lv.bunkers.some((b) => inCircle(lv.tee, b, 6))) out.push('A bunker covers the tee.');
  if (lv.hills.some((h) => inCircle(lv.pin, h, lv.green * 0.4) && Math.abs(h[3]) > 2)) out.push('A steep hill sits on the green.');
  if (levelBytes(lv) > LEVEL_CAPS.bytes) out.push('The hole is too detailed to share: remove some trees.');
  return out;
}
export function nameProblem(name) {
  const n = cleanName(name);
  if (n.length < 3) return 'Give the hole a name of at least 3 characters.';
  if (/(https?|www\.|\.com|\.net)/i.test(n)) return 'Links are not allowed in names.';
  if (isProfane(n)) return 'Please choose a different name.';
  return null;
}

// --- templates, random, blank ---
const base = (name, theme, seed, extra) => parseLevel({ v: 1, name, theme, seed, tee: [0, 0], green: 13, bend: [], bunkers: [], water: [], rough: [], hills: [], trees: [], ...extra }).level;
export const TEMPLATES = Object.freeze([
  { id: 'par3water', name: 'Short par 3 over water', make: () => base('Island Carry', 'parkland', 11, { pin: [4, -142], green: 12, water: [[2, -96, 18], [-14, -110, 11]], bunkers: [[17, -150, 4]] }) },
  { id: 'dogleg4', name: 'Dogleg par 4', make: () => base('Corner Bend', 'parkland', 23, { pin: [-92, -350], bend: [[0, -230]], bunkers: [[22, -232, 5], [-82, -318, 4]], water: [[-34, -262, 12]] }) },
  { id: 'long5', name: 'Long par 5', make: () => base('Long Haul', 'parkland', 37, { pin: [36, -500], bend: [[-10, -200], [40, -380]], bunkers: [[-26, -212, 5], [56, -390, 5], [20, -476, 4]], water: [[70, -300, 16]] }) },
  { id: 'links', name: 'Links', make: () => base('Sea Breeze', 'links', 41, { pin: [18, -360], bend: [[-8, -220]], bunkers: [[6, -232, 2.6], [-18, -246, 2.6], [30, -340, 2.6], [4, -372, 2.4]], hills: [[-30, -150, 18, 2], [36, -280, 16, 2.5]] }) },
  { id: 'desert', name: 'Desert', make: () => base('Mesa Run', 'desert', 53, { pin: [-28, -330], bend: [[10, -190]], bunkers: [[30, -200, 6], [-48, -322, 5]], water: [[-6, -290, 10]] }) },
  { id: 'alpine', name: 'Alpine', make: () => base('Snowline', 'alpine', 67, { pin: [6, -168], green: 14, hills: [[0, -60, 30, -3], [-30, -120, 22, 4]], bunkers: [[22, -170, 4]], water: [[-26, -140, 9]] }) },
]);
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];

export function blankLevel() { return base('My hole', 'parkland', 7, { pin: [0, -300] }); }

/** A random, playable hole: a par 3, 4 or 5 with a bend or two and a few hazards. */
export function randomLevel(seed = Date.now() >>> 0) {
  const r = createRng(seed >>> 0);
  const par = r.pick([3, 4, 4, 5]);
  const len = par === 3 ? r.range(120, 200) : par === 4 ? r.range(300, 400) : r.range(450, 540);
  const theme = r.pick(LEVEL_THEMES);
  const bend = [];
  const side = r.sign();
  if (par >= 4) bend.push([side * r.range(0, 40), -len * r.range(0.5, 0.62)]);
  if (par === 5) bend.push([-side * r.range(0, 40), -len * 0.8]);
  const pin = [side * r.range(-50, 50) * (par === 3 ? 0.3 : 1), -len];
  const lv = base(r.pick(['Hidden Valley', 'Windy Ridge', 'Quiet Corner', 'Long Shadow', 'Pine Hollow', 'Dune Top', 'Red Rock', 'Lake View']), theme, r.int(1, 1e6), { pin, bend });
  const nB = r.int(2, 5);
  for (let i = 0; i < nB; i++) { const t = r.range(0.35, 0.95), p = along(lv, t); lv.bunkers.push([r1(p[0] + r.sign() * r.range(18, 30)), r1(p[1]), r1(r.range(3, 6))]); }
  if (r.chance(0.6)) { const p = along(lv, r.range(0.4, 0.7)); lv.water.push([r1(p[0] + r.sign() * r.range(30, 45)), r1(p[1]), r1(r.range(10, 18))]); }
  return autoDecorate(parseLevel(lv).level, r.int(1, 1e6));
}

// A point a share t of the way along the route.
export function along(lv, t) {
  const route = levelRoute(lv), total = levelLength(lv) || 1;
  let want = clamp(t, 0, 1) * total;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (want <= d || i === route.length - 1) { const f = d > 0 ? clamp(want / d, 0, 1) : 0; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
    want -= d;
  }
  return route[route.length - 1];
}

/**
 * Auto-decorate: lines of trees on both sides of the fairway and rough patches at the edges,
 * clear of the tee, the green and the water, inside the caps.
 */
export function autoDecorate(level, seed = 1) {
  const lv = { ...level, trees: [...level.trees], rough: [...level.rough] };
  const r = createRng(seed >>> 0);
  const total = levelLength(lv);
  const route = levelRoute(lv);
  const clearOf = (p) => !lv.water.some((w) => inCircle(p, w, 6)) && Math.hypot(p[0] - lv.pin[0], p[1] - lv.pin[1]) > lv.green + 14 && Math.hypot(p[0] - lv.tee[0], p[1] - lv.tee[1]) > 16;
  for (let s = 25; s < total - 10 && lv.trees.length < Math.min(LEVEL_CAPS.trees, level.trees.length + 140); s += r.range(7, 12)) {
    const p = along(lv, s / total), q = along(lv, Math.min(1, (s + 2) / total));
    const tx = q[0] - p[0], tz = q[1] - p[1], l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
    for (const side of [-1, 1]) {
      const off = r.range(34, 52) + (lv.theme === 'links' ? 10 : 0);
      const tp = [cx(p[0] + nx * off * side), cz(p[1] + nz * off * side)];
      if (clearOf(tp) && r.chance(lv.theme === 'links' ? 0.35 : lv.theme === 'desert' ? 0.4 : 0.85)) lv.trees.push(tp);
    }
  }
  const hazards = () => HAZARD_LISTS.reduce((t, k) => t + lv[k].length, 0);
  for (let s = 60; s < total - 40 && hazards() < LEVEL_CAPS.hazards; s += r.range(70, 110)) {
    const p = along(lv, s / total);
    const side = r.sign();
    const q = along(lv, Math.min(1, (s + 2) / total)), tx = q[0] - p[0], tz = q[1] - p[1], l = Math.hypot(tx, tz) || 1;
    const rp = [cx(p[0] + (-tz / l) * side * 26), cz(p[1] + (tx / l) * side * 26), r1(r.range(8, 13))];
    if (clearOf(rp)) lv.rough.push(rp);
  }
  void route;
  return parseLevel(lv).level;
}

// --- the course a level plays on ---
// A synthetic course: the template theme's look and wind, one hole with the level's par, and
// the level itself, which the hole builder reads (course/layout.js).
export function levelCourse(lv, baseCourse) {
  const key = levelKey(lv);
  return {
    ...baseCourse, id: `lvl:${key}`, look: baseCourse.id, name: lv.name, level: lv, flagship: false, real: false,
    pars: [levelPar(lv)], yards: null, holes: null, conditions: null,
    blurb: 'A community hole.',
  };
}
