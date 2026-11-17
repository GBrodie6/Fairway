// Drive the real app through real input events (mouse through Playwright, touch through the
// Chrome DevTools protocol). The QA bot and the stage tools use this. Nothing here calls game
// methods to take a shot: the bot only reads state and moves a pointer like a person would.

export async function waitPhase(page, phases, timeout = 180000) {
  const list = Array.isArray(phases) ? phases : [phases];
  await page.waitForFunction((l) => window.__fw && l.includes(window.__fw.phase()), list, { timeout, polling: 100 });
  return page.evaluate(() => window.__fw.phase());
}

export async function rectOf(page, selector) {
  return page.evaluate((s) => window.__fw.rect(s), selector);
}

// One pointer that is either the mouse or a finger, driven through the Chrome DevTools Input
// domain (the same path Playwright uses). Every event carries an explicit timestamp from a
// planned schedule. Headless software rendering can block the page's main thread for hundreds
// of milliseconds per frame, and without explicit timestamps the browser would stamp each
// event when it got around to it, which turns an 0.8 s backswing into several seconds.
export async function createPointer(page, { touch = false } = {}) {
  const cdp = await page.context().newCDPSession(page);
  let clock = 0; // ms since epoch of the last event sent
  let down = false;
  const stamp = (at) => { clock = Math.max(clock + 1, at ?? Date.now()); return clock / 1000; };
  const mouse = (type, x, y, at) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: down ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse', timestamp: stamp(at) });
  const finger = (type, x, y, at) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }], timestamp: stamp(at) });
  return {
    touch,
    async down(x, y, at) { if (touch) { down = true; await finger('touchStart', x, y, at); } else { await mouse('mouseMoved', x, y, at); down = true; await mouse('mousePressed', x, y, at); } },
    async move(x, y, at) { if (touch) await finger('touchMove', x, y, at); else await mouse('mouseMoved', x, y, at); },
    async up(x, y, at) { if (touch) await finger('touchEnd', x, y, at); else await mouse('mouseReleased', x, y, at); down = false; },
    async tap(x, y) { const t = Date.now(); await this.down(x, y, t); await this.up(x, y, t + 60); },
    // Play a planned path: [{ x, y, t }] with t in ms from the start. Events are sent in
    // order with their planned timestamps; the call does not wait in real time.
    async path(points) {
      const t0 = Date.now();
      await this.down(points[0].x, points[0].y, t0 + points[0].t);
      for (let i = 1; i < points.length - 1; i++) await this.move(points[i].x, points[i].y, t0 + points[i].t);
      const last = points[points.length - 1];
      await this.move(last.x, last.y, t0 + last.t - 1);
      await this.up(last.x, last.y, t0 + last.t);
    },
  };
}

// A swing on the stick: pull down to `power` over backMs, then push up through the start line
// over downMs, drifting `drift` (fraction of travel) sideways at impact.
export async function swing(page, pointer, { power = 0.7, backMs = 780, downMs = 260, drift = 0 } = {}) {
  const info = await page.evaluate(() => {
    const st = window.__fw.ui.hud.stick;
    const r = st.el.querySelector('.track').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + 30, travel: st.travel };
  });
  const depth = Math.max(0.05, Math.min(1, power)) * info.travel;
  const pts = [{ x: info.x, y: info.y, t: 0 }];
  const steps = 16;
  for (let i = 1; i <= steps; i++) pts.push({ x: info.x, y: info.y + depth * (i / steps), t: (backMs * i) / steps });
  const upSteps = 8;
  for (let i = 1; i <= upSteps; i++) { const f = i / upSteps; pts.push({ x: info.x + drift * info.travel * f, y: info.y + depth - (depth + 18) * f, t: backMs + (downMs * i) / upSteps }); }
  await pointer.path(pts);
  return { travel: info.travel, depthPx: depth };
}

// Drag horizontally on the course view to turn the aim.
export async function dragAim(page, pointer, dxPx, { ms = 500, y = 0.42, x = 0.5 } = {}) {
  const vp = page.viewportSize();
  const x0 = vp.width * x, y0 = vp.height * y;
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push({ x: x0 + (dxPx * i) / 12, y: y0, t: (ms * i) / 12 });
  await pointer.path(pts);
}

export async function clickSel(page, pointer, selector) {
  const r = await rectOf(page, selector);
  if (!r) return false;
  await pointer.tap(r.x + r.w / 2, r.y + r.h / 2);
  return true;
}
