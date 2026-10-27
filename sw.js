// ==========================================
// SEEMYDRIVER - PWA SERVICE WORKER
// ==========================================
const CACHE_NAME = 'seemydriver-v5';
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
                    console.log('Deleting old cache:', key);
                    return caches.delete(key);
                }
            }));
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;

    e.respondWith(
        fetch(e.request)
            .then((response) => {
                return response;
            })
            .catch(() => {
                return caches.match(e.request).then((cachedResponse) => {
                    return cachedResponse || caches.match('/');
                });
            })
    );
});