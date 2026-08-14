// Tiny Conquerors service worker - offline-capable, but never stale.
// Bump VERSION on every deploy; old caches are purged on activate.
const VERSION = 'tq-v58';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch from the network and refresh the cache with whatever comes back.
function fresh(req) {
  return fetch(req).then(res => {
    if (res.ok && new URL(req.url).origin === location.origin) {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
    }
    return res;
  });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // The page itself is network-first. Cache-first served the OLD build on the
  // first launch after a deploy and the new one only on the launch after that
  // - which on a phone that is resumed rather than reopened is never. The
  // cache is still the fallback, so the game still starts with no signal.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      Promise.race([
        fresh(e.request).catch(() => null),
        // Long enough for a slow phone connection, short enough that a dead
        // one opens the game instead of hanging on a white screen. The fetch
        // that lost the race still lands in the cache for next time.
        new Promise(r => setTimeout(() => r(null), 4000))
      ]).then(res => res || caches.match('./index.html').then(hit => hit || fetch(e.request)))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit || fresh(e.request).catch(() => caches.match('./index.html'))
    )
  );
});
