// ==========================================
// SEEMYDRIVER - PWA SERVICE WORKER
// ==========================================
const CACHE_NAME = 'seemydriver-v75';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.all(
                ASSETS_TO_CACHE.map(url => {
                    return cache.add(url).catch(err => {
                        console.warn('Failed to cache asset during install:', url, err);
                    });
                })
            );
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    var u; try { u = new URL(e.request.url); } catch (x) { return; }
    if (u.origin !== self.location.origin) return;
    if (u.pathname.indexOf('/js/') === 0 || u.pathname.slice(-3) === '.js') { /* always network-first, no stale fallback to HTML */ }

    e.respondWith(
        fetch(e.request)
            .then((response) => {
                return response;
            })
            .catch(() => {
                return caches.match(e.request).then((cachedResponse) => {
                    return cachedResponse || (e.request.mode === 'navigate' ? caches.match('/') : Response.error());
                });
            })
    );
});