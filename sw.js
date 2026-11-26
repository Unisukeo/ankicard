// 電波がなくても開けるように、画面とカードを取っておく。
// 先にネットを見に行き、つながらないときだけ取っておいたものを使う（作り直しがすぐ反映されるように）。
const CACHE = 'ankicard-v16';
const SHELL = ['./', 'index.html', 'app.js', 'stats.js', 'typing.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'ankicard-se').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return; // GitHub の API などはそのまま通す
  e.respondWith(
    // cache: no-cache … GitHub Pages の10分のキャッシュを使わず、毎回新しいか確かめる（直したものがすぐ届く）
    fetch(e.request.url, { cache: 'no-cache' }).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
