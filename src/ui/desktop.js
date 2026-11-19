// Desktop sizing. Phones keep their layouts exactly: everything here only applies when the
// window is a desktop-sized landscape view (at least DESK_MIN_W by DESK_MIN_H CSS pixels).
//
//   hud    the in-round HUD groups (tabs, the hole and score panel, the bottom row, the look
//          button, the spin button and panel, toasts) scale up with the window height, times the
//          Screen size setting (Small, Normal, Large). Each group scales from its own corner, so
//          the HUD's pixel layout code keeps working on the scaled boxes.
//   menu   the menu cards (sheets) zoom the same way, capped a little lower; their widths are
//          already capped (560 and 760 px), so they never stretch across a wide screen.
//   ex     on an ultrawide screen the HUD corners come in from the far edges to a 1.9 to 1 frame
//          around the centre, so they stay near the action.
// Browser zoom changes the CSS viewport: zooming in makes everything larger (and below the
// desktop size the phone landscape layout takes over); zooming out does not make the HUD
// smaller than it is at 1080p, so nothing becomes tiny. The Screen size setting is the way to
// make it smaller.
export const DESK_MIN_W = 1180;
export const DESK_MIN_H = 640;
export const SCREEN_SIZES = Object.freeze({ small: 0.85, normal: 1, large: 1.2 });
export const FRAME_RATIO = 1.9;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function deskScale(w, h, size = 'normal') {
  const W = Number.isFinite(w) ? w : 0, H = Number.isFinite(h) ? h : 0;
  const desk = W >= DESK_MIN_W && H >= DESK_MIN_H && W >= H;
  if (!desk) return { desk: false, hud: 1, menu: 1, ex: 0 };
  const f = SCREEN_SIZES[size] || 1;
  const base = clamp(H / 900, 1, 1.6);
  return {
    desk: true,
    hud: +(base * f).toFixed(3),
    menu: +(clamp(H / 900, 1, 1.45) * f).toFixed(3),
    ex: Math.max(0, Math.round((W - H * FRAME_RATIO) / 2)),
  };
}

// Apply to the UI root: the desk class and the CSS variables the stylesheet reads.
export function applyDesktop(root, settings) {
  const s = deskScale(window.innerWidth, window.innerHeight, settings && settings.screenSize);
  root.classList.toggle('desk', s.desk);
  root.style.setProperty('--hs', String(s.hud));
  root.style.setProperty('--ms', String(s.menu));
  root.style.setProperty('--ex', `${s.ex}px`);
  // The menu zoom also applies to screens appended outside the root's own rules.
  document.documentElement.classList.toggle('desk', s.desk);
  document.documentElement.style.setProperty('--ms', String(s.menu));
  return s;
}

// Fullscreen, where the browser allows it (not on iPhone Safari).
export const fullscreenAvailable = () => typeof document !== 'undefined' && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
export const isFullscreen = () => typeof document !== 'undefined' && !!(document.fullscreenElement || document.webkitFullscreenElement);
export async function toggleFullscreen() {
  try {
    if (isFullscreen()) { await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen()); return false; }
    const el = document.documentElement;
    await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
    return true;
  } catch { return isFullscreen(); }
}
