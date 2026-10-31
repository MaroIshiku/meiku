// Bump CACHE_NAME with every release that changes static assets.
const CACHE_NAME = 'meiku-static-v0.4.1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './design-system/tokens.css',
  './design-system/base.css',
  './design-system/components.css',
  './design-system/theme-controller.js',
  './css/meiku.css',
  './js/app.js',
  './js/auth.js',
  './js/boot.js',
  './js/cards.js',
  './js/crypto.js',
  './js/dom.js',
  './js/icons.js',
  './js/profile.js',
  './js/qr.js',
  './js/settings.js',
  './js/store.js',
  './manifest.json',
  './app.manifest.json',
  './assets/icons/icon-64.png',
  './assets/icons/icon-128.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/favicon-32.png',
  './assets/icons/apple-touch-icon.png'
];
const NETWORK_ONLY = /(?:api\/data|api\/token|build-info\.json)(?:\?|$)/;
const STATIC_REQUEST = /\.(?:html|css|js|json|png|svg|webmanifest)(?:\?|$)/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
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
