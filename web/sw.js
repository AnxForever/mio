// ⚠️ 资产列表硬编码，修改/新增文件时需同步更新此处
// TODO: 后续可用 vite-plugin-pwa 的 workbox.generateSW 自动生成 precache manifest
const CACHE_NAME = 'mio-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/css/reset.css',
  '/css/tokens.css',
  '/css/utilities.css',
  '/css/chat.css',
  '/css/studio.css',
  '/css/analytics.css',
  '/css/settings.css',
  '/css/onboarding.css',
  '/css/auth.css',
  '/js/app.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/router.js',
  '/js/store.js',
  '/js/ws.js',
  '/js/utils/constants.js',
  '/js/utils/dom.js',
  '/js/utils/easing.js',
  '/js/utils/haptics.js',
  '/js/utils/time.js',
  '/js/components/bubble.js',
  '/js/components/emotion-ball.js',
  '/js/components/emotion-worker.js',
  '/js/components/tab-bar.js',
  '/js/components/toast.js',
  '/js/views/analytics.js',
  '/js/views/auth.js',
  '/js/views/BaseView.js',
  '/js/views/chat.js',
  '/js/views/onboarding.js',
  '/js/views/settings.js',
  '/js/views/studio.js'
];

// 安装时缓存静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 拦截请求
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 仅拦截同源的静态资源请求 (排除 API 和 WS)
  if (url.origin === location.origin && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/ws/')) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        // Cache First 策略
        if (response) {
          return response;
        }
        return fetch(event.request).then((networkResponse) => {
          // 动态缓存新请求到的资源
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          // 离线且没有缓存的情况，如果是 HTML 请求，可返回一个简单的离线提示页面
          if (event.request.headers.get('accept').includes('text/html')) {
            return new Response(`
              <!DOCTYPE html>
              <html lang="zh-CN">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <title>Mio - 离线</title>
                <style>
                  body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #fafafa; color: #86868b; margin: 0; }
                  h1 { color: #1d1d1f; }
                  .ball { width: 64px; height: 64px; background: #e4e4e6; border-radius: 50%; margin-bottom: 24px; }
                </style>
              </head>
              <body>
                <div class="ball"></div>
                <h1>似乎断网了</h1>
                <p>请检查网络连接后重试</p>
              </body>
              </html>
            `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
          }
        });
      })
    );
  }
});
