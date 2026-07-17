/* ==========================================================
   Service Worker — MASTER MUSIC PWA
   Cachea el "app shell" para que el reproductor abra offline
   y se pueda instalar en celular y PC.
   Sube el número de CACHE cuando cambies archivos del shell.
   ========================================================== */
const CACHE = 'mastermusic-v17';

// Archivos locales que forman la app. Las pistas de música del
// usuario NO se cachean aquí: viven en IndexedDB (ver js/db.js).
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/lyrics.js',
  './js/spotify.js',
  './js/app.js',
  './js/visualizer.js',
  './js/seven.js',
  './js/cinema.js',
  './js/colors.js',
  './js/vendor/jsmediatags.min.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll falla si un solo recurso falla; cacheamos uno a uno
      // para ser tolerantes (p.ej. si falta algún asset opcional).
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca interceptamos llamadas a APIs externas (Spotify, LRClib):
  // siempre van a la red para datos en vivo.
  const isApi = /spotify\.com|lrclib\.net|scdn\.co/.test(url.hostname);
  if (isApi) return;

  // App shell propio -> network-first (siempre lo último cuando hay red,
  // y caché como respaldo cuando estás offline).
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Recursos externos (fuentes Google, CDNs) -> stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
