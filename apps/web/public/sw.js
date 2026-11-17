/*
 * 离线壳缓存：iPhone「添加到主屏幕」后没有 Service Worker 就是一张白屏，
 * 这里把 index.html 与带 hash 的静态资源缓存下来，断网也能打开。
 *
 * 策略：
 * - 导航请求（打开页面）：网络优先，失败回落到缓存的 index.html —— 保证更新能拿到；
 * - 其它同源静态资源：缓存优先（文件名带 hash，内容不会变）；
 * - /api 与跨域请求一律不拦（同步枢纽、RSS 抓取都走真实的网络）。
 *
 * 改了这里的缓存策略请把 VERSION 加一，旧的 cache 会在 activate 时清掉。
 */
const VERSION = 'ddl-shell-v1';
const CACHE = `${VERSION}`;
const SHELL = ['/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        }),
    ),
  );
});
