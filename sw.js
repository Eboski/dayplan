/* Offline shell. Bump CACHE when files change so phones pick up the update. */
const CACHE = 'dayplan-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './categories.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* network-first so edits show up, cache as the offline fallback */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
