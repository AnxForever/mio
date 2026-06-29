// Runtime-only service worker.
// Avoid hardcoded precache manifests so edited CSS/JS is not pinned behind
// stale query strings during local UI work.
const CACHE_NAME = 'mio-runtime-v1';

const API_PREFIXES = [
  '/health',
  '/status',
  '/avatar',
  '/voice',
  '/chat',
  '/mod',
  '/persona',
  '/onboarding',
  '/analytics',
  '/search',
  '/memories',
  '/proactive',
  '/notify',
  '/admin',
  '/character',
  '/characters',
];

function isApiRequest(url) {
  return url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/ws/')
    || API_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'));
}

function offlineHtml() {
  return new Response(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Mio - 离线</title>
      <style>
        body {
          display: grid;
          place-items: center;
          min-height: 100vh;
          margin: 0;
          background: #fbfbfc;
          color: #5f5f5f;
          font-family: -apple-system, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        main {
          width: min(100% - 32px, 360px);
          padding: 22px;
          border: 1px solid rgba(13, 13, 13, .1);
          border-radius: 8px;
          background: #fff;
        }
        h1 {
          margin: 0 0 6px;
          color: #0d0d0d;
          font-size: 20px;
        }
        p { margin: 0; font-size: 14px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <main>
        <h1>当前离线</h1>
        <p>请检查本地 Mio 服务或网络连接后刷新。</p>
      </main>
    </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('mio-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin || isApiRequest(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    try {
      const response = await fetch(request);
      if (response && response.status === 200 && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;

      if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
        return offlineHtml();
      }

      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
