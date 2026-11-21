// Fairway Next service worker. Generated at build time from src/sw/sw-template.js: the
// precache list is the exact set of files in this build, and STAMP is the asset manifest's
// generation stamp (the same ?v= the game adds to every asset URL).
//   app shell (HTML, JS, CSS, icons): precached on install, so the game starts offline
//   game assets (textures, models, HDRIs): cached the first time they are used, so a course
//     that has been played once can be played again offline
const VERSION = '009a9cf36efc';
const STAMP = '16cp2zo';
const SHELL = `fw-shell-${VERSION}`;
const ASSETS = 'fw-assets';
const PRECACHE = ["./","./assets/index-DIhEFyh5.js","./assets/index-mHa22S6v.css","./assets/three-DVczv1Xs.js","./assets/three-addons-D87aEL2b.js","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-180.png","./icons/icon-32.png"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('fw-shell-') && k !== SHELL) await caches.delete(k);
    // Drop game assets from an older asset build.
    const c = await caches.open(ASSETS);
    for (const req of await c.keys()) if (new URL(req.url).searchParams.get('v') !== STAMP) await c.delete(req);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first so a new build is picked up; the cached shell when offline.
    e.respondWith(fetch(req).catch(async () => (await caches.match('./index.html', { ignoreSearch: true })) || (await caches.match('./', { ignoreSearch: true })) || Response.error()));
    return;
  }
  if (url.pathname.includes('/assets/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) {
        const copy = res.clone();
        const name = /\.(js|css)$/.test(url.pathname) ? SHELL : ASSETS;
        caches.open(name).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    })());
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
