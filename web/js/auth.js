/**
 * auth.js — 认证模块
 *
 * 启动时检查 token, 决定显示认证浮层还是主应用。
 */

import { Store } from './store.js';
import { api } from './api.js';

export async function checkAuth() {
  const token = Store.get('authToken');

  /* 无 token — 先试直连 (服务器可能未开启鉴权) */
  if (!token) {
    try {
      await api.get('/status');
      return true;
    } catch {
      return false;
    }
  }

  /* 有 token — 验证 */
  try {
    await api.get('/status');
    return true;
  } catch {
    Store.set('authToken', '');
    Store.persist('authToken');
    return false;
  }
}

export async function tryLogin(token) {
  Store.set('serverUrl', Store.get('serverUrl'));
  Store.set('authToken', token);
  Store.persist('authToken');

  try {
    await api.get('/status');
    return true;
  } catch {
    Store.set('authToken', '');
    Store.persist('authToken');
    throw new Error('连接失败，请检查令牌与服务器');
  }
}
