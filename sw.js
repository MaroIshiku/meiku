const CACHE_NAME = 'sharely-static-2026-06-25-m3';
const STATIC_ASSETS = [
  './', './index.html', './css/style.css', './js/app.js', './js/auth.js', './js/crypto.js', './js/qr.js', './js/store.js',
  './css/style.css?v=sharely-m3-20260625', './js/app.js?v=sharely-m3-20260625', './js/auth.js?v=sharely-m3-20260625', './js/crypto.js?v=sharely-m3-20260625', './js/qr.js?v=sharely-m3-20260625', './js/store.js?v=sharely-m3-20260625',
  './manifest.json', './assets/sharely-logo.png', './assets/icon-192.png', './assets/icon-512.png', './assets/favicon.png', './assets/pb.png', './assets/pp.png'
];
const NETWORK_ONLY = /(?:api\/data|api\/token|data\.json|save\.php)(?:\?|$)/;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (NETWORK_ONLY.test(url.pathname) || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
