/* Cache only the public offline screen and icons. Sessions, APIs, media and studio pages
   always use the network. Activation waits for existing windows to close. */
const CACHE = 'geez-public-offline-v1';
const PUBLIC_ASSETS = ['/offline.html', '/pwa/icon-192.png', '/pwa/icon-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PUBLIC_ASSETS)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('geez-public-offline-') && key !== CACHE).map((key) => caches.delete(key)),
  )));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  } else if (PUBLIC_ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});
