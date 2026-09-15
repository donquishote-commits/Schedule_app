const CACHE_NAME = 'schedule-app-v58';
const ASSETS = [
  './',
  './index.html',
  './students.html',
  './attendance.html',
  './reports.html',
  './manifest.json',
  './assets/style.css',
  './assets/app.js',
  './assets/students.js',
  './assets/attendance.js',
  './assets/reports.js',
  './assets/vendor/xlsx.full.min.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-180.png',
];

// cache.addAll() is all-or-nothing: if even one asset fails to fetch
// (a flaky mobile connection on the ~860KB xlsx library, say), the whole
// install silently fails and the browser keeps running whatever service
// worker last installed successfully — forever, no matter how many times
// the page is refreshed or the app reinstalled, since a new one never
// takes over. Caching each asset individually and tolerating failures
// means install always succeeds; anything that didn't get cached here
// just falls through to the network on first use via the fetch handler.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((url) => cache.add(url).catch((e) => console.error('SW: failed to cache', url, e))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for the app shell, falling back to network and caching
// whatever comes back so the app keeps working offline after first visit.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
