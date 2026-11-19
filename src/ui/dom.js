// Tiny DOM helpers. Text always goes through textContent so player names cannot inject markup.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

// Static, trusted SVG icon markup (no user data ever goes in here).
const ICONS = {
  map: '<svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>',
  replay: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/><path d="m10 9 5 3-5 3Z"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  look: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  arrow: '<svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="13.5" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.35)" stroke-width="1"/><path d="M15 5 21 17h-4.2v8h-3.6v-8H9Z" fill="#f3f6ef"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  // HUD set (original line icons drawn for this game).
  lie: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.4"/><path d="M3 20c2-3.2 3-4.6 4-4.6S8.6 18 9.5 18 11 14 12 14s1.6 4 2.5 4 1.5-2.6 2.5-2.6 2 1.4 4 4.6"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="m12 13 4.5-5"/><circle cx="12" cy="13" r="1.4"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M7 21V3.5"/><path d="M7 4h10.5l-2.6 3.4 2.6 3.4H7"/><ellipse cx="9" cy="21" rx="4.5" ry="1.1"/></svg>',
  wind: '<svg viewBox="0 0 24 24"><path d="M12 3.5 17.5 15h-3.6v5.5h-3.8V15H6.5Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/></svg>',
  sunlow: '<svg viewBox="0 0 24 24"><path d="M6.5 16a5.5 5.5 0 0 1 11 0"/><path d="M2.5 19.5h19M12 5.5v2.4M4.6 9.3l1.7 1.5M19.4 9.3l-1.7 1.5"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M5.5 18.5l1.9-1.9M16.6 7.4l1.9-1.9"/><circle cx="12" cy="12" r="6.6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m14.5 5-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9.5 5 7 7-7 7"/></svg>',
  aim: '<svg viewBox="0 0 24 24"><path d="M12 21V6"/><path d="m7 10.5 5-5.5 5 5.5"/><circle cx="12" cy="21" r="1.3"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m5 8 7 6 7-6"/><path d="m5 13 7 6 7-6" opacity="0.5"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  shrink: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  keys: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h1M10 10h1M14 10h1M18 10h0M7 14h10"/></svg>',
};
export function icon(name) {
  const span = document.createElement('span');
  span.style.display = 'contents';
  span.innerHTML = ICONS[name] || '';
  return span.firstChild;
}
export function iconButton(name, label, onClick, cls = 'iconbtn glass') {
  const b = h('button', { class: cls, 'aria-label': label, title: label, type: 'button' });
  b.appendChild(icon(name));
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
}
