/* عامل الخدمة — يخزّن التطبيق ليشتغل بدون إنترنت */
const CACHE = 'masareefi-v7';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/store.js',
  './js/sms.js',
  './js/stats.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  // لا نستبق الانتظار — ننتظر ضغطة «حدّث الآن» من المستخدم
});

// المستخدم ضغط «حدّث الآن» → نفعّل النسخة الجديدة فوراً
self.addEventListener('message', (ev) => {
  if (ev.data && ev.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* الملفات المحلية: من الكاش أولاً — الخطوط: كاش مع تحديث عند التوفر */
self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET') return;

  if (url.origin === location.origin) {
    ev.respondWith(
      caches.match(ev.request).then((hit) => hit || fetch(ev.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(ev.request, copy));
        return res;
      }))
    );
  } else if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    ev.respondWith(
      caches.match(ev.request).then((hit) => {
        const network = fetch(ev.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(ev.request, copy));
          return res;
        }).catch(() => hit);
        return hit || network;
      })
    );
  }
});
