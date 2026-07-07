// Service worker : cache l'app + l'index ; met en cache les skills à la demande.
const CACHE = 'sp-local-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'simu-bareme.js', 'simu.js', 'oracle.js', '2ddoc-spec.js', 'coffre.js', 'manifest.webmanifest',
               'icon.svg', 'data/fiches.json', 'data/themes.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Réseau d'abord (frais en ligne), repli sur le cache (hors-ligne).
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;          // laisse passer geo.api / lannuaire
  e.respondWith(
    fetch(e.request).then(res => {
      if (e.request.method === 'GET' && res.ok) {
        const cp = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
