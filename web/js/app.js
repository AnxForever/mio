/**
 * app.js — 应用入口
 *
 * 检查认证 → 渲染页面 → 初始化路由 → 连接 WebSocket。
 */

import { Store } from './store.js';
import { initRouter, route } from './router.js';
import { checkAuth } from './auth.js';
import { wsManager } from './ws.js';
import { renderChat, mountChat, unmountChat } from './views/chat.js';
import { renderStudio, mountStudio, unmountStudio } from './views/studio.js';
import { renderAnalytics, mountAnalytics, unmountAnalytics } from './views/analytics.js';
import { renderSettings, mountSettings, unmountSettings } from './views/settings.js';
import { renderOnboarding, mountOnboarding, unmountOnboarding } from './views/onboarding.js';
import { renderAuth } from './views/auth.js';

const root = document.getElementById('app-root');

/* ─── 键盘高度适配 ─── */
function setAppHeight() {
  const h = window.visualViewport ? window.visualViewport.height + 'px' : '100vh';
  document.documentElement.style.setProperty('--app-h', h);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setAppHeight);
  window.visualViewport.addEventListener('scroll', setAppHeight);
}
setAppHeight();

/* ─── 视图挂载/卸载管理 ─── */
let currentView = null;
const viewMap = {
  '/chat':       { render: renderChat,       mount: mountChat,       unmount: unmountChat },
  '/studio':     { render: renderStudio,     mount: mountStudio,     unmount: unmountStudio },
  '/analytics':  { render: renderAnalytics,  mount: mountAnalytics,  unmount: unmountAnalytics },
  '/settings':   { render: renderSettings,   mount: mountSettings,   unmount: unmountSettings },
  '/onboarding': { render: renderOnboarding, mount: mountOnboarding, unmount: unmountOnboarding },
};

function switchView(viewName, params) {
  if (currentView && currentView.unmount) {
    currentView.unmount();
  }

  const routeKey = viewName.startsWith('/studio') ? '/studio' : viewName;
  const view = viewMap[routeKey];

  if (!view) {
    root.innerHTML = '';
    return;
  }

  root.innerHTML = '';
  root.appendChild(view.render(params));
  currentView = view;
  if (view.mount) view.mount();
}

/* ─── 路由注册 ─── */
route('/chat', () => switchView('/chat'));
route('/studio', () => switchView('/studio'));
route('/studio/:id', (p) => switchView('/studio', p));
route('/analytics', () => switchView('/analytics'));
route('/settings', () => switchView('/settings'));
route('/onboarding', () => switchView('/onboarding'));

/* ─── 启动 ─── */
async function boot() {
  const authed = await checkAuth();

  if (!authed) {
    root.innerHTML = '';
    root.appendChild(renderAuth());
    return;
  }

  wsManager.connect();

  /* 检查是否需要新手引导 */
  try {
    const { api } = await import('./api.js');
    const onboarding = await api.get('/onboarding/status');
    if (onboarding && onboarding.needsOnboarding && !onboarding.done) {
      window.location.hash = '#/onboarding';
    }
  } catch {}

  initRouter();
}

boot();
