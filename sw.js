/* ============================================================
   FOUR EYES COFFEE — sw.js
   UPDATE CACHE_VERSION on every deploy alongside APP_VERSION.
   ============================================================ */

const CACHE_VERSION = 'fec-20260407-v20';
const CACHE_ASSETS  = 'fec-assets-' + CACHE_VERSION;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('fec-') && k !== CACHE_ASSETS)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c =>
        c.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION })
      ))
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (e.request.mode === 'navigate') {
    // HTML: network-first so updates land immediately
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(res => {
          caches.open(CACHE_ASSETS).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // JS/CSS/assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE_ASSETS).then(c => c.put(e.request, res.clone()));
      return res;
    }))
  );
});
