/**
 * router.js — Hash 路由
 *
 * 极简: 监听 hashchange, 匹配路由 → 调对应的 render 函数。
 * 支持参数化路由 /:param。
 */

import { Store } from './store.js';

const routes = new Map();

export function route(pattern, handler) {
  routes.set(pattern, handler);
}

function match(rt, hash) {
  const rParts = rt.split('/');
  const hParts = hash.split('/');
  if (rParts.length !== hParts.length) return null;

  const params = {};
  for (let i = 0; i < rParts.length; i++) {
    if (rParts[i].startsWith(':')) {
      params[rParts[i].slice(1)] = hParts[i];
    } else if (rParts[i] !== hParts[i]) {
      return null;
    }
  }
  return params;
}

function resolve(hash) {
  const path = hash || '/chat';
  for (const [rt, handler] of routes) {
    const params = match(rt, path);
    if (params !== null) {
      handler(params);
      return;
    }
  }

  /* fallback — 如果所有路由都没匹配, 去聊天首屏 */
  const homeHandler = routes.get('/chat');
  if (homeHandler) homeHandler({});
}

export function navigate(hash) {
  window.location.hash = hash;
}

export function initRouter() {
  window.addEventListener('hashchange', () => {
    Store.set('route', window.location.hash.slice(1) || '/chat');
    resolve(Store.get('route'));
  });

  /* 首次加载 */
  const initial = window.location.hash.slice(1) || '/chat';
  Store.set('route', initial);
  resolve(initial);
}
