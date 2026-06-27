/**
 * app.js — 应用入口
 *
 * 检查认证 → 构建响应式 App Shell (侧边栏+内容 / 底部导航) → 路由。
 */

import { Store } from './store.js';
import { initRouter, route, navigate } from './router.js';
import { checkAuth } from './auth.js';
import { wsManager } from './ws.js';
import { el } from './utils/dom.js';
import { ICONS } from './utils/icons.js';
import { mascotSrc } from './mascot.js';
import { renderChat,       mountChat,       unmountChat       } from './views/chat.js';
import { renderMessages,   mountMessages,   unmountMessages   } from './views/messages.js';
import { renderMood,       mountMood,       unmountMood       } from './views/mood.js';
import { renderStudio,     mountStudio,     unmountStudio     } from './views/studio.js';
import { renderAnalytics,  mountAnalytics,  unmountAnalytics  } from './views/analytics.js';
import { renderSettings,   mountSettings,   unmountSettings   } from './views/settings.js';
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

/* ═══════════════════════════════════════════════════
   App Shell
   ═══════════════════════════════════════════════════ */

const NAV_ITEMS = [
  { route: '/messages',  iconFn: ICONS.chat,      label: 'Messages' },
  { route: '/studio',    iconFn: ICONS.studio,    label: 'Persona' },
  { route: '/analytics', iconFn: ICONS.analytics, label: 'Signals' },
  { route: '/settings',  iconFn: ICONS.settings,  label: 'Settings' },
];

let mainEl = null;
let currentRoute = '/chat';

function buildShell() {
  root.innerHTML = '';
  const shell = el('div', { className: 'app-shell' });

  /* ─── 侧边栏 (Desktop) ─── */
  const sidebar = el('nav', { className: 'app-sidebar', 'aria-label': 'Main navigation' });

  const brand = el('div', { className: 'app-sidebar-brand' });
  const brandAvatar = el('div', { className: 'avatar', style: { width: '36px', height: '36px' } });
  const brandImg = el('img', { alt: '', src: mascotSrc('gentle') });
  brandImg.addEventListener('error', () => { brandImg.style.visibility = 'hidden'; });
  brandAvatar.appendChild(brandImg);
  const brandText = el('div', {}, [
    el('div', { className: 'app-sidebar-brand-text', textContent: 'Mio' }),
    el('div', { className: 'app-sidebar-brand-sub', textContent: 'Agent console' }),
  ]);
  brand.appendChild(brandAvatar);
  brand.appendChild(brandText);
  sidebar.appendChild(brand);

  for (const item of NAV_ITEMS) {
    sidebar.appendChild(buildNavItem(item));
  }

  sidebar.appendChild(el('div', { className: 'app-sidebar-footer', textContent: 'v0.7' }));
  shell.appendChild(sidebar);

  /* ─── 主内容区 ─── */
  mainEl = el('main', { className: 'app-main', id: 'app-main' });
  shell.appendChild(mainEl);

  /* ─── 底部导航 (Mobile) ─── */
  const bottomNav = el('nav', { className: 'app-bottom-nav', 'aria-label': 'Mobile navigation' });
  for (const item of NAV_ITEMS) {
    bottomNav.appendChild(buildNavItem(item));
  }
  shell.appendChild(bottomNav);

  root.appendChild(shell);
}

function buildNavItem({ route, iconFn, label }) {
  const iconEl = el('span', { className: 'app-nav-icon' });
  iconEl.appendChild(iconFn(20));
  return el('button', {
    className: `app-nav-item`,
    'aria-label': label,
    'aria-current': null,
    onClick: (e) => {
      e.preventDefault();
      navigate(route);
    },
  }, [
    iconEl,
    el('span', { className: 'app-nav-label', textContent: label }),
  ]);
}

function updateNavHighlight(routeKey) {
  currentRoute = routeKey;
  root.querySelectorAll('.app-nav-item').forEach(btn => {
    const isActive = btn.querySelector('.app-nav-label')?.textContent ===
      NAV_ITEMS.find(n => routeKey.startsWith('/studio') ? n.route === '/studio' : n.route === routeKey)?.label;
    btn.classList.toggle('active', isActive);
  });
}

/* ═══════════════════════════════════════════════════
   视图管理
   ═══════════════════════════════════════════════════ */

let currentView = null;
const viewMap = {
  '/chat':       { render: renderChat,       mount: mountChat,       unmount: unmountChat },
  '/messages':   { render: renderMessages,   mount: mountMessages,   unmount: unmountMessages },
  '/mood':       { render: renderMood,       mount: mountMood,       unmount: unmountMood },
  '/studio':     { render: renderStudio,     mount: mountStudio,     unmount: unmountStudio },
  '/analytics':  { render: renderAnalytics,  mount: mountAnalytics,  unmount: unmountAnalytics },
  '/settings':   { render: renderSettings,   mount: mountSettings,   unmount: unmountSettings },
  '/onboarding': { render: renderOnboarding, mount: mountOnboarding, unmount: unmountOnboarding },
};

function switchView(viewName, params) {
  if (currentView && currentView.unmount) currentView.unmount();

  const routeKey = viewName.startsWith('/studio') ? '/studio' : viewName;
  const view = viewMap[routeKey];
  if (!view) return;

  mainEl.innerHTML = '';
  mainEl.appendChild(view.render(params));
  currentView = view;
  if (view.mount) view.mount();

  updateNavHighlight(routeKey);
  Store.set('route', routeKey);
}

/* ─── 路由注册 ─── */
route('/chat',       () => switchView('/chat'));
route('/messages',   () => switchView('/messages'));
route('/mood',       () => switchView('/mood'));
route('/studio',     () => switchView('/studio'));
route('/studio/:id', (p) => switchView('/studio', p));
route('/analytics',  () => switchView('/analytics'));
route('/settings',   () => switchView('/settings'));
route('/onboarding', () => switchView('/onboarding'));

/* ═══════════════════════════════════════════════════
   启动
   ═══════════════════════════════════════════════════ */

async function boot() {
  const authed = await checkAuth();

  if (!authed) {
    root.innerHTML = '';
    root.appendChild(renderAuth());
    return;
  }

  buildShell();
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
