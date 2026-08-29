/* Stock Market 1968 — service worker.
   Bump CACHE on each release so installed apps pick up the new build. */
const CACHE = 'sm68-v9';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !fonts) return;

  // the game itself: network first so updates land, cache so offline works
  if (req.mode === 'navigate'){
    e.respondWith(
      fetch(req)
        .then(r => {
          const cp = r.clone();
          caches.open(CACHE).then(c => c.put('./index.html', cp));
          return r;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // everything else (icons, fonts): cache first, refresh in the background
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(r => {
        if (r && r.ok){
          const cp = r.clone();
          caches.open(CACHE).then(c => c.put(req, cp));
        }
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
