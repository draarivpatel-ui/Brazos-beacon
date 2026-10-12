// Brazos Beacon service worker: keeps the app itself (page, scripts, styles, map library) available offline.
// Network first, so a fresh deploy always wins when online; the cache is only the fallback.
// Live agency data (NOAA, NWS, FEMA) is never cached here: the page keeps its own clearly labelled last-check snapshot.
var CACHE = 'beacon-shell-v15';
var SHELL = ['./', 'index.html', 'style.css', 'logic.js', 'i18n.js', 'demo.js', 'app.js', 'vendor/qrcode.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'vendor/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { mode: /^https?:/.test(u) ? 'cors' : 'same-origin' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isShell(url) {
  return url.origin === self.location.origin || url.href.indexOf('https://unpkg.com/leaflet@1.9.4/') === 0;
}

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || !isShell(url)) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req.mode === 'navigate' ? 'index.html' : req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
      return hit || caches.match(req, { ignoreSearch: true }).then(function (h) { return h || Response.error(); });
    });
  }));
});
