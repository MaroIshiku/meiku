const CACHE_NAME = 'meiku-static-2026-08-21c';
const STATIC_ASSETS = [
  './',
  './index.html',
  './design-system/tokens.css',
  './css/meiku.css',
  './css/meiku.css?v=meiku-20260821c',
  './js/app.js',
  './js/auth.js',
  './js/crypto.js',
  './js/qr.js',
  './js/store.js',
  './js/app.js?v=meiku-20260821c',
  './js/auth.js?v=meiku-20260821c',
  './js/crypto.js?v=meiku-20260821c',
  './js/qr.js?v=meiku-20260821c',
  './js/store.js?v=meiku-20260821c',
  './manifest.json?v=meiku-20260821',
  './app.manifest.json',
  './build-info.json',
  './assets/icons/icon-64.png',
  './assets/icons/icon-128.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/favicon-32.png',
  './assets/icons/apple-touch-icon.png'
];
const NETWORK_ONLY = /(?:api\/data|api\/token|data\.json|save\.php)(?:\?|$)/;
const STATIC_REQUEST = /\.(?:html|css|js|json|png|svg|webmanifest)(?:\?|$)/;

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
  const isStatic = url.origin === self.location.origin && (url.pathname === '/' || STATIC_REQUEST.test(url.pathname));
  if (!isStatic || NETWORK_ONLY.test(url.pathname) || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    if (!response.ok) return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
