/**
 * tab-bar.js — 底部导航栏组件
 */

import { el } from '../utils/dom.js';
import { navigate } from '../router.js';
import { Store } from '../store.js';

const TABS = [
  { id: '/chat',      icon: '💬', label: '聊天' },
  { id: '/studio',    icon: '🎭', label: '人格' },
  { id: '/analytics', icon: '📊', label: '数据' },
  { id: '/settings',  icon: '⚙️', label: '设置' },
];

export function renderTabBar() {
  const currentRoute = Store.get('route');
  const routeKey = currentRoute.startsWith('/studio') ? '/studio' : currentRoute;

  const nav = el('nav', { className: 'tab-bar' });

  for (const tab of TABS) {
    const isActive = routeKey === tab.id;

    const btn = el('button', {
      className: `tab-item${isActive ? ' active' : ''}`,
      dataset: { route: tab.id },
      onClick: () => navigate(tab.id),
    }, [
      el('span', { className: 'tab-icon', textContent: tab.icon }),
      el('span', { className: 'tab-label', textContent: tab.label }),
    ]);

    nav.appendChild(btn);
  }

  return nav;
}
