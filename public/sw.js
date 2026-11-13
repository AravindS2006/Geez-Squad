/* Cache the public offline screen and icons, plus the versioned pose assets (vision bundle,
   WASM, models). Sessions, APIs, media and studio pages always use the network. Activation
   waits for existing windows to close. */
const CACHE = 'geez-public-offline-v1';
const PUBLIC_ASSETS = ['/offline.html', '/pwa/icon-192.png', '/pwa/icon-512.png'];
// Must equal POSE_ASSET_BASE in src/lib/pose-assets.ts (build-checked by prepare-assets).
const POSE_ASSET_BASE = '/pose-assets/mp0.10.35-27563efb7a';
// The URL prefix is content-addressed, so a cached response never goes stale. A new asset
// version gets a new cache name and the old one is deleted on activate.
const POSE_CACHE = `geez-pose-assets-${POSE_ASSET_BASE.split('/').pop()}`;
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PUBLIC_ASSETS)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith('geez-public-offline-') && key !== CACHE) ||
                (key.startsWith('geez-pose-assets-') && key !== POSE_CACHE),
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
async function poseAsset(request) {
  const cache = await caches.open(POSE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Only complete same-origin responses; a partial (206) or failed response is not cached.
  if (response.status === 200 && response.type === 'basic')
    await cache.put(request, response.clone()).catch(() => {});
  return response;
}
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  } else if (PUBLIC_ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  } else if (
    url.pathname.startsWith(`${POSE_ASSET_BASE}/`) &&
    !url.search &&
    !event.request.headers.has('range')
  ) {
    event.respondWith(poseAsset(event.request));
  }
});
