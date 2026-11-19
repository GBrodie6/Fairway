// Controller navigation for menus, lists and the level editor's buttons: the d-pad (or the left
// stick) moves the focus to the nearest control in that direction, A presses it, B goes back
// (input.js), the right stick scrolls. A focused select cycles its options with left and right
// (and A), a slider steps with left and right. The focused control gets a clear ring while a
// controller is in use (html.padnav in styles.css).

// The next control from `from` in direction dir ('up', 'down', 'left', 'right'): the nearest
// whose centre lies that way, preferring ones in line (the sideways offset counts double).
// Pure, so it is unit tested. Rects are { x, y, w, h }.
export function pickNext(from, rects, dir) {
  const cx = from.x + from.w / 2, cy = from.y + from.h / 2;
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r === from) continue;
    const x = r.x + r.w / 2, y = r.y + r.h / 2, dx = x - cx, dy = y - cy;
    let along, side;
    if (dir === 'down') { along = dy; side = Math.abs(dx); if (r.y < from.y + from.h * 0.5) continue; }
    else if (dir === 'up') { along = -dy; side = Math.abs(dx); if (r.y + r.h > from.y + from.h * 0.5) continue; }
    else if (dir === 'right') { along = dx; side = Math.abs(dy); if (r.x < from.x + from.w * 0.5) continue; }
    else { along = -dx; side = Math.abs(dy); if (r.x + r.w > from.x + from.w * 0.5) continue; }
    if (along <= 0) continue;
    // In line with the current control (overlapping across the direction of travel): only the
    // distance counts. Otherwise the sideways offset counts double.
    const overlap = dir === 'up' || dir === 'down' ? Math.min(from.x + from.w, r.x + r.w) - Math.max(from.x, r.x) : Math.min(from.y + from.h, r.y + r.h) - Math.max(from.y, r.y);
    const score = overlap > 0 ? along : along + side * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), a[href], [tabindex="0"]';

export function focusables(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUSABLE)].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('.hidden, [aria-hidden="true"]');
  });
}

export function createPadNav() {
  const nav = {
    // Move the focus inside container. Returns the newly focused element (or null).
    move(container, dir) {
      const els = focusables(container);
      if (!els.length) return null;
      const cur = document.activeElement;
      const i0 = els.indexOf(cur);
      // A select or a slider takes left and right for its own value.
      if (i0 >= 0 && (dir === 'left' || dir === 'right') && nav.adjust(cur, dir === 'right' ? 1 : -1)) return cur;
      let next;
      if (i0 < 0) next = els[0];
      else {
        const rects = els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
        const j = pickNext(rects[i0], rects, dir);
        next = j >= 0 ? els[j] : null;
      }
      if (!next) return null;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return next;
    },
    // Left and right on a select (cycles) or a slider (steps). True when it took the input.
    adjust(el, dir) {
      if (!el) return false;
      if (el.tagName === 'SELECT') {
        const n = el.options.length;
        if (!n) return false;
        el.selectedIndex = (el.selectedIndex + dir + n) % n;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (el.tagName === 'INPUT' && el.type === 'range') {
        if (dir > 0) el.stepUp(); else el.stepDown();
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    },
    // A: press the focused control (a select cycles forward, a text field just keeps focus).
    activate(container) {
      const cur = document.activeElement;
      if (!cur || !container || !container.contains(cur)) { nav.move(container, 'down'); return null; }
      if (cur.tagName === 'SELECT') { nav.adjust(cur, 1); return cur; }
      if (cur.tagName === 'INPUT' && cur.type !== 'checkbox' && cur.type !== 'radio') return cur;
      cur.click();
      return cur;
    },
    // The right stick scrolls whatever scrolls in the container.
    scroll(container, dy) {
      if (!container || !dy) return;
      let el = document.activeElement && container.contains(document.activeElement) ? document.activeElement : container;
      while (el && el !== container.parentElement) {
        if (el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { el.scrollTop += dy; return; }
        el = el.parentElement;
      }
      container.scrollTop += dy;
    },
  };
  return nav;
}
