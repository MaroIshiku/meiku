// Meiku service worker: offline copy of the app shell.
//
// Every module, script and stylesheet URL carries the release version
// (?v=ASSET_VERSION, set by scripts/stamp-version.mjs), so one release always
// loads one consistent set of files:
// - versioned URLs are immutable: cache-first, then network;
// - everything else (the page itself, manifest, icons): network-first, cache as offline fallback;
// - token API and build information: network only.
const ASSET_VERSION = '0.4.3';
const CACHE_NAME = 'meiku-static-v0.4.3';
const v = path => `${path}?v=${ASSET_VERSION}`;
const STATIC_ASSETS = [
  './',
  './index.html',
  v('./css/meiku.css'),
  v('./design-system/components.css'),
  './design-system/base.css',
  './design-system/tokens.css',
  v('./design-system/theme-controller.js'),
  ...['app', 'auth', 'boot', 'cards', 'crypto', 'dom', 'icons', 'profile', 'qr', 'settings', 'store'].map(name => v(`./js/${name}.js`)),
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
const STATIC_REQUEST = /\.(?:html|css|js|json|png|svg|webmanifest)$/;

self.addEventListener('install', event => {
  // Best effort: one failing asset must not keep an outdated worker in charge.
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => Promise.all(STATIC_ASSETS.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (NETWORK_ONLY.test(url.pathname)) return;
  const isStatic = url.pathname.endsWith('/') || STATIC_REQUEST.test(url.pathname);
  if (!isStatic) return;

  if (url.searchParams.get('v') === ASSET_VERSION) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetchAndStore(event.request)));
    return;
  }
  event.respondWith(fetchAndStore(event.request).catch(() => caches.match(event.request)));
});

function fetchAndStore(request) {
  return fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  });
}
