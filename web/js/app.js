/**
 * app.js — 应用入口
 *
 * 检查认证 → 构建响应式 App Shell (侧边栏+内容 / 底部导航) → 路由。
 */

import { Store } from './store.js';
import { initRouter, route, navigate } from './router.js';
import { checkAuth, logout } from './auth.js';
import { wsManager } from './ws.js';
import { el } from './utils/dom.js';
import { ICONS } from './utils/icons.js';
import { mascotSrc } from './mascot.js';
import { renderConsole,    mountConsole,    unmountConsole    } from './views/console.js';
import { renderChat,       mountChat,       unmountChat       } from './views/chat.js';
import { renderMessages,   mountMessages,   unmountMessages   } from './views/messages.js';
import { renderMemories,   mountMemories,   unmountMemories   } from './views/memories.js';
import { renderMood,       mountMood,       unmountMood       } from './views/mood.js';
import { renderStudio,     mountStudio,     unmountStudio     } from './views/studio.js';
import { renderChannels,   mountChannels,   unmountChannels   } from './views/channels.js';
import { renderExtensions, mountExtensions, unmountExtensions } from './views/extensions.js';
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

const NAV_GROUPS = [
  {
    label: '运行',
    items: [
      { route: '/console',  iconFn: ICONS.console,  label: '总览', mobile: true },
      { route: '/chat',     iconFn: ICONS.chat,     label: '聊天', mobile: true },
    ],
  },
  {
    label: '配置',
    items: [
      { route: '/studio',   iconFn: ICONS.studio,   label: '人格',  mobile: true },
      { route: '/channels', iconFn: ICONS.channels, label: '微信接入', mobile: true },
      { route: '/extensions', iconFn: ICONS.plugins, label: '扩展能力' },
    ],
  },
  {
    label: '观察',
    items: [
      { route: '/memories',  iconFn: ICONS.memory,    label: '记忆' },
      { route: '/analytics', iconFn: ICONS.analytics, label: '数据分析' },
      { route: '/settings',  iconFn: ICONS.settings,  label: '设置', mobile: true },
    ],
  },
];
const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

let mainEl = null;
let currentRoute = '/console';

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
    el('div', { className: 'app-sidebar-brand-sub', textContent: '智能体控制台' }),
  ]);
  brand.appendChild(brandAvatar);
  brand.appendChild(brandText);
  sidebar.appendChild(brand);

  for (const group of NAV_GROUPS) {
    sidebar.appendChild(el('div', { className: 'app-nav-group-label', textContent: group.label }));
    for (const item of group.items) {
      sidebar.appendChild(buildNavItem(item));
    }
  }

  const authUser = Store.get('authUser');
  const footerChildren = [
    el('div', { className: 'app-sidebar-version', textContent: 'v0.7' }),
    el('div', { className: 'app-sidebar-user', textContent: authUser ? `${authUser.username} · ${authUser.role}` : '本地控制台' }),
  ];
  if (Store.get('authToken')) {
    footerChildren.push(el('button', {
      className: 'app-sidebar-logout',
      type: 'button',
      onClick: async () => {
        await logout();
        wsManager.disconnect();
        window.dispatchEvent(new CustomEvent('mio:authenticated'));
      },
      textContent: '退出',
    }));
  }
  sidebar.appendChild(el('div', { className: 'app-sidebar-footer' }, footerChildren));
  shell.appendChild(sidebar);

  /* ─── 主内容区 ─── */
  mainEl = el('main', { className: 'app-main', id: 'app-main' });
  shell.appendChild(mainEl);

  /* ─── 底部导航 (Mobile) ─── */
  const bottomNav = el('nav', { className: 'app-bottom-nav', 'aria-label': 'Mobile navigation' });
  for (const item of NAV_ITEMS.filter((navItem) => navItem.mobile)) {
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
    dataset: { route },
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
  const activeRoute = routeKey.startsWith('/studio') ? '/studio' : routeKey;
  root.querySelectorAll('.app-nav-item').forEach(btn => {
    const isActive = btn.dataset.route === activeRoute;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

/* ═══════════════════════════════════════════════════
   视图管理
   ═══════════════════════════════════════════════════ */

let currentView = null;
const viewMap = {
  '/console':    { render: renderConsole,    mount: mountConsole,    unmount: unmountConsole },
  '/chat':       { render: renderChat,       mount: mountChat,       unmount: unmountChat },
  '/messages':   { render: renderMessages,   mount: mountMessages,   unmount: unmountMessages },
  '/memories':   { render: renderMemories,   mount: mountMemories,   unmount: unmountMemories },
  '/mood':       { render: renderMood,       mount: mountMood,       unmount: unmountMood },
  '/studio':     { render: renderStudio,     mount: mountStudio,     unmount: unmountStudio },
  '/channels':   { render: renderChannels,   mount: mountChannels,   unmount: unmountChannels },
  '/extensions': { render: renderExtensions, mount: mountExtensions, unmount: unmountExtensions },
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
route('/console',    () => switchView('/console'));
route('/chat',       () => switchView('/chat'));
route('/messages',   () => switchView('/messages'));
route('/memories',   () => switchView('/memories'));
route('/mood',       () => switchView('/mood'));
route('/studio',     () => switchView('/studio'));
route('/studio/:id', (p) => switchView('/studio', p));
route('/channels',   () => switchView('/channels'));
route('/extensions', () => switchView('/extensions'));
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

window.addEventListener('mio:authenticated', () => {
  boot();
});

boot();
