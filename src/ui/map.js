// Top-down hole map with a rangefinder. The base image is drawn once per hole from the same
// terrain functions the physics uses, rotated so the tee is at the bottom and the green at
// the top. Overlays (ball, pin, aim line, landing ring, tapped point) are redrawn on demand.
import { SURFACES } from '../physics/surfaces.js';
import { headingTo, clamp } from '../core/math.js';
import { safeLinearGradient } from '../core/guards.js';
import { h, iconButton } from './dom.js';
import { fmtDist } from './format.js';

const COLORS = {
  [SURFACES.ROUGH]: [79, 122, 53], [SURFACES.DEEP_ROUGH]: [62, 98, 41], [SURFACES.FIRST_CUT]: [96, 143, 60],
  [SURFACES.FAIRWAY]: [112, 166, 68], [SURFACES.FRINGE]: [120, 175, 76], [SURFACES.GREEN]: [136, 194, 88],
  [SURFACES.TEE]: [120, 173, 74], [SURFACES.BUNKER]: [232, 216, 170], [SURFACES.DIRT]: [141, 118, 82],
  [SURFACES.PATH]: [168, 158, 138], [SURFACES.WETLAND]: [85, 112, 74], [SURFACES.WATER]: [58, 118, 172],
  [SURFACES.WASTE]: [201, 180, 138], [SURFACES.ROCK]: [138, 131, 120],
};
// Per-course tint of the rough so desert and links maps read like the courses.
const ROUGH_TINT = { desert: [176, 150, 104], links: [118, 132, 70], alpine: [84, 120, 62], tropical: [76, 128, 58], augusta: [70, 118, 52], standrews: [132, 136, 76] };

// Pure transform helpers (exported for tests): rotate world space so `heading` points up.
export function makeFrame(cx, cz, heading, scale, w, hgt) {
  const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
  return {
    toMap(x, z, out = {}) {
      const dx = x - cx, dz = z - cz;
      out.u = w / 2 + (dx * rx + dz * rz) * scale;
      out.v = hgt / 2 - (dx * fx + dz * fz) * scale;
      return out;
    },
    toWorld(u, v, out = {}) {
      const lat = (u - w / 2) / scale, along = (hgt / 2 - v) / scale;
      out.x = cx + lat * rx + along * fx;
      out.z = cz + lat * rz + along * fz;
      return out;
    },
  };
}

export function createHoleMap(parent, { getWorld, game, settings, onClose }) {
  const wrap = h('div', { class: 'mapwrap hidden', role: 'dialog', 'aria-label': 'Hole map. Tap to measure a distance.' });
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const readout = h('div', { class: 'glass chip', style: { position: 'absolute', left: '50%', bottom: 'calc(18px + var(--safe-b))', transform: 'translateX(-50%)', fontSize: '14px', padding: '9px 14px' }, 'aria-live': 'polite' });
  const aimHere = h('button', { class: 'btn small primary hidden', type: 'button', style: { position: 'absolute', left: '50%', bottom: 'calc(64px + var(--safe-b))', transform: 'translateX(-50%)' } }, 'Aim here');
  wrap.append(canvas, readout, aimHere, iconButton('close', 'Close map', () => map.close(), 'iconbtn glass close'));
  parent.appendChild(wrap);
  const ctx = canvas.getContext('2d');
  const map = { open: false, base: null, frame: null, key: '', tap: null, el: wrap };

  function buildBase() {
    const w = getWorld(), t = w.terrain, hole = t.hole;
    const tee = t.tee, pin = t.pin;
    const heading = headingTo(tee.x, tee.z, hole.green.x, hole.green.z);
    // Extent of the hole line in the rotated frame.
    const f0 = makeFrame(0, 0, heading, 1, 0, 0);
    let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
    const pts = [...hole.line, tee, pin];
    for (const p of pts) { const m = f0.toMap(p.x, p.z); minU = Math.min(minU, m.u); maxU = Math.max(maxU, m.u); minV = Math.min(minV, m.v); maxV = Math.max(maxV, m.v); }
    const padLat = 55, padAlong = 40;
    minU -= padLat; maxU += padLat; minV -= padAlong; maxV += padAlong;
    const spanU = maxU - minU, spanV = maxV - minV;
    const cxm = (minU + maxU) / 2, cvm = (minV + maxV) / 2;
    const c = f0.toWorld(cxm, cvm);
    // About one sample per meter, capped so a long par 5 stays fast to draw.
    const res = Math.max(1, spanV / 720);
    const bw = Math.max(8, Math.round(spanU / res)), bh = Math.max(8, Math.round(spanV / res));
    const frame = makeFrame(c.x, c.z, heading, 1 / res, bw, bh);
    const img = new ImageData(bw, bh);
    const d = img.data, n = {}, p = {};
    const rough = ROUGH_TINT[w.courseId];
    const L = [-0.45, 0.8, -0.4]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
    for (let v = 0; v < bh; v++) {
      for (let u = 0; u < bw; u++) {
        frame.toWorld(u + 0.5, v + 0.5, p);
        const i = (v * bw + u) * 4;
        if (!t.inBounds(p.x, p.z, 1)) { d[i] = 30; d[i + 1] = 44; d[i + 2] = 34; d[i + 3] = 255; continue; }
        const s = t.surfaceAt(p.x, p.z);
        let col = COLORS[s] || COLORS[SURFACES.ROUGH];
        if (rough && (s === SURFACES.ROUGH || s === SURFACES.DEEP_ROUGH)) col = s === SURFACES.DEEP_ROUGH ? rough.map((x) => x * 0.86) : rough;
        t.normalAt(p.x, p.z, n);
        let shade = s === SURFACES.WATER ? 1 : clamp(0.62 + 0.55 * (n.x * L[0] + n.y * L[1] + n.z * L[2]), 0.55, 1.25);
        const tree = t.treeDensityAt ? t.treeDensityAt(p.x, p.z) : 0;
        if (tree > 0.25 && s !== SURFACES.WATER && s !== SURFACES.GREEN && s !== SURFACES.FAIRWAY) shade *= 1 - clamp((tree - 0.25) * 0.9, 0, 0.42);
        const oob = t.isOutOfBounds(p.x, p.z) ? 0.6 : 1;
        d[i] = clamp(col[0] * shade * oob, 0, 255); d[i + 1] = clamp(col[1] * shade * oob, 0, 255); d[i + 2] = clamp(col[2] * shade * oob, 0, 255); d[i + 3] = 255;
      }
    }
    const base = document.createElement('canvas');
    base.width = bw; base.height = bh;
    base.getContext('2d').putImageData(img, 0, 0);
    map.base = base; map.frame = frame; map.res = res;
    map.key = `${w.course ? w.course.id : w.courseId}:${w.hole}`;
  }

  function size() {
    const vw = window.innerWidth * 0.92, vh = window.innerHeight * 0.82;
    const a = map.base.width / map.base.height;
    let cw = vh * a, ch = vh;
    if (cw > vw) { cw = vw; ch = vw / a; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.width = `${Math.round(cw)}px`; canvas.style.height = `${Math.round(ch)}px`;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    map.k = canvas.width / map.base.width; // canvas pixels per base pixel
  }

  const P = {};
  const toCanvas = (x, z) => { map.frame.toMap(x, z, P); return { u: P.u * map.k, v: P.v * map.k }; };

  map.draw = () => {
    if (!map.open || !map.base) return;
    const w = getWorld(), t = w.terrain, st = game.state, units = settings.units;
    const k = map.k, dpr = canvas.width / parseFloat(canvas.style.width || canvas.width);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(map.base, 0, 0, canvas.width, canvas.height);
    // Soft vignette at the top and bottom so labels stay readable.
    const g = safeLinearGradient(ctx, 0, 0, 0, canvas.height, [[0, 'rgba(0,0,0,0.25)'], [0.15, 'rgba(0,0,0,0)'], [0.85, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.25)']]);
    if (g) { ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    const ball = toCanvas(st.ball.x, st.ball.z), pin = toCanvas(t.pin.x, t.pin.z);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const label = (text, u, v) => {
      ctx.font = `600 ${Math.round(12.5 * dpr)}px system-ui, sans-serif`;
      const tw = ctx.measureText(text).width + 12 * dpr;
      ctx.fillStyle = 'rgba(12,20,16,0.72)';
      ctx.beginPath(); ctx.roundRect(u - tw / 2, v - 10 * dpr, tw, 20 * dpr, 9 * dpr); ctx.fill();
      ctx.fillStyle = '#f3f6ef'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, u, v + 0.5 * dpr);
    };
    // Aim line: ball to the predicted landing point, then on to the pin.
    const pr = st.prediction;
    if (pr && st.phase === 'aim' && !st.club.putter) {
      const land = pr.carryPoint || pr.end;
      const lp = toCanvas(land.x, land.z);
      ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 2.2 * dpr; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(ball.u, ball.v); ctx.lineTo(lp.u, lp.v); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([5 * dpr, 6 * dpr]);
      ctx.beginPath(); ctx.moveTo(lp.u, lp.v); ctx.lineTo(pin.u, pin.v); ctx.stroke(); ctx.setLineDash([]);
      const ov = w.overlays;
      const rr = ov && ov.ringSize ? ov.ringSize : { lat: 6, depth: 9 };
      ctx.save(); ctx.translate(lp.u, lp.v); ctx.rotate(st.aim - map.heading);
      ctx.strokeStyle = st.hazard ? '#e69f00' : '#ffffff'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.ellipse(0, 0, Math.max(3, rr.lat * k / map.res), Math.max(3, rr.depth * k / map.res), 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      const carry = Math.hypot(land.x - st.ball.x, land.z - st.ball.z);
      label(fmtDist(carry, units), (ball.u + lp.u) / 2, (ball.v + lp.v) / 2);
      label(fmtDist(Math.hypot(t.pin.x - land.x, t.pin.z - land.z), units), (lp.u + pin.u) / 2, (lp.v + pin.v) / 2);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2 * dpr; ctx.setLineDash([5 * dpr, 6 * dpr]);
      ctx.beginPath(); ctx.moveTo(ball.u, ball.v); ctx.lineTo(pin.u, pin.v); ctx.stroke(); ctx.setLineDash([]);
      label(fmtDist(st.distToPin, units), (ball.u + pin.u) / 2, (ball.v + pin.v) / 2);
    }
    // Other players' balls.
    const r = st.round;
    if (r && r.state) r.state.forEach((s, i) => {
      if (i === st.turn || s.holed) return;
      const q = toCanvas(s.x, s.z);
      ctx.fillStyle = r.players[i].ball || '#ddd'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.arc(q.u, q.v, 3.6 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    // Pin flag.
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath(); ctx.moveTo(pin.u, pin.v); ctx.lineTo(pin.u, pin.v - 16 * dpr); ctx.stroke();
    ctx.fillStyle = '#ffcf3f'; ctx.beginPath(); ctx.moveTo(pin.u, pin.v - 16 * dpr); ctx.lineTo(pin.u + 10 * dpr, pin.v - 12.5 * dpr); ctx.lineTo(pin.u, pin.v - 9 * dpr); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(pin.u, pin.v, 2.2 * dpr, 0, Math.PI * 2); ctx.fill();
    // Ball.
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(ball.u, ball.v, 4.6 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Rangefinder point.
    if (map.tap) {
      const q = toCanvas(map.tap.x, map.tap.z);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath(); ctx.moveTo(ball.u, ball.v); ctx.lineTo(q.u, q.v); ctx.stroke();
      ctx.beginPath(); ctx.arc(q.u, q.v, 7 * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q.u - 11 * dpr, q.v); ctx.lineTo(q.u + 11 * dpr, q.v); ctx.moveTo(q.u, q.v - 11 * dpr); ctx.lineTo(q.u, q.v + 11 * dpr); ctx.stroke();
    }
  };

  function updateReadout() {
    const t = getWorld().terrain, st = game.state, units = settings.units;
    if (map.tap) {
      const a = Math.hypot(map.tap.x - st.ball.x, map.tap.z - st.ball.z);
      const b = Math.hypot(t.pin.x - map.tap.x, t.pin.z - map.tap.z);
      const dh = t.heightAt(map.tap.x, map.tap.z) - t.heightAt(st.ball.x, st.ball.z);
      readout.textContent = `${fmtDist(a, units)} from ball, ${fmtDist(b, units)} to pin, ${dh >= 0 ? 'up' : 'down'} ${Math.abs(units === 'meters' ? dh : dh / 0.3048).toFixed(0)} ${units === 'meters' ? 'm' : 'ft'}`;
      aimHere.classList.toggle('hidden', st.phase !== 'aim');
    } else {
      readout.textContent = `${fmtDist(st.distToPin, units)} to the pin. Tap the map to measure.`;
      aimHere.classList.add('hidden');
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const r = canvas.getBoundingClientRect();
    const u = ((e.clientX - r.left) / r.width) * map.base.width, v = ((e.clientY - r.top) / r.height) * map.base.height;
    const p = map.frame.toWorld(u, v);
    if (!getWorld().terrain.inBounds(p.x, p.z, 1)) return;
    map.tap = p;
    updateReadout(); map.draw();
  });
  aimHere.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!map.tap) return;
    const st = game.state;
    game.setAim(headingTo(st.ball.x, st.ball.z, map.tap.x, map.tap.z));
    map.close();
  });
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) map.close(); });

  map.show = () => {
    const w = getWorld();
    if (!w.terrain) return;
    if (map.key !== `${w.course ? w.course.id : w.courseId}:${w.hole}` || !map.base) buildBase();
    map.heading = headingTo(w.terrain.tee.x, w.terrain.tee.z, w.terrain.hole.green.x, w.terrain.hole.green.z);
    map.tap = null;
    wrap.classList.remove('hidden');
    map.open = true;
    size(); updateReadout(); map.draw();
  };
  map.close = () => { if (!map.open) return; map.open = false; wrap.classList.add('hidden'); if (onClose) onClose(); };
  map.toggle = () => (map.open ? map.close() : map.show());
  map.invalidate = () => { map.key = ''; };
  window.addEventListener('resize', () => { if (map.open) { size(); map.draw(); } });
  return map;
}
