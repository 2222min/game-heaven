// 던전 서바이버즈 PWA — 네트워크 우선, 오프라인 캐시 폴백
const C = 'ds-v5';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(['./'])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const cl = r.clone();
      caches.open(C).then(c => c.put(e.request, cl)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./')))
  );
});
