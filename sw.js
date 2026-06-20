// Offline shell. Bump CACHE when shipping breaking changes to force a full refresh.
const CACHE = 'cft-v2';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './logic.js', './storage.js',
  './manifest.webmanifest', './icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // sync POSTs / cross-origin -> network

  if (req.mode === 'navigate') { // network-first for HTML so deploys land
    e.respondWith(
      fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return r; })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  // stale-while-revalidate for assets
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((resp) => { const c = resp.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return resp; }).catch(() => cached);
      return cached || net;
    })
  );
});
