// ═══════════════════════════════════════════════════════════════
// JIA Trainer Center — Service Worker
// Offline cache + background sync queue
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'jia-v2';
const CACHE_FILES = [
  './',
  './index.html',
  './jia-login.html',
  './jia-sales.html',
  './jia-instructor.html',
  './jia-course-web.html',
  './jia-booking.html',
  // CDN — cache แต่ไม่ block ถ้าหลุด
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
];

// ─── Install: cache ไฟล์หลัก ───
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_FILES).catch(err => {
        console.warn('SW: some files failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// ─── Activate: ลบ cache เก่า ───
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch: Network first, fallback to cache ───
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls → network only (ไม่ cache)
  if (url.hostname === 'script.google.com') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Clone response ก่อน cache
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        // Offline → ใช้ cache
        return caches.match(event.request).then(cached => {
          return cached || new Response('Offline — กรุณาเชื่อมต่ออินเทอร์เน็ต', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
  );
});
