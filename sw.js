/* ===== 小小图书馆 Service Worker ===== */

const CACHE_STATIC = 'library-v1-static';
const CACHE_API = 'library-v1-api';
const CACHE_FONTS = 'library-v1-fonts';

const STATIC_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/utils.js',
  './js/db.js',
  './js/api.js',
  './js/scanner.js',
  './js/app.js',
  './js/vendor/html5-qrcode.min.js',
  './manifest.json'
];

/* 安装：预缓存静态资源 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return Promise.allSettled(
        STATIC_FILES.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

/* 激活：清理旧缓存 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key =>
          key !== CACHE_STATIC && key !== CACHE_API && key !== CACHE_FONTS
        ).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

/* 请求拦截 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 跳过非 GET 请求
  if (event.request.method !== 'GET') return;

  // Google Fonts: Stale While Revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_FONTS).then(cache => {
        return cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // Open Library API: Network First
  if (url.hostname === 'openlibrary.org' || url.hostname === 'covers.openlibrary.org') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const cloned = response.clone();
          caches.open(CACHE_API).then(cache => cache.put(event.request, cloned));
        }
        return response;
      }).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // 静态资源: Cache First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // 后台更新缓存
        fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CACHE_STATIC).then(cache => cache.put(event.request, response));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic') {
          const cloned = response.clone();
          caches.open(CACHE_STATIC).then(cache => cache.put(event.request, cloned));
        }
        return response;
      });
    })
  );
});
