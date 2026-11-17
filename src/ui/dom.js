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
