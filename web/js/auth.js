/**
 * auth.js — 认证模块
 *
 * 启动时检查 token, 决定显示认证浮层还是主应用。
 */

import { Store } from './store.js';
import { api } from './api.js';

const AUTH_PROBE_PATH = '/auth/me';

function isRateLimited(err) {
  return err && err.status === 429;
}

async function publicServerAvailable() {
  try {
    await api.get('/status');
    return true;
  } catch {
    return false;
  }
}

export async function getAuthStatus() {
  return api.get('/auth/status');
}

export async function checkAuth() {
  const token = Store.get('authToken');

  /* 无 token — 探测受保护接口。若服务器未启用鉴权，这里会通过。 */
  if (!token) {
    try {
      const data = await api.get(AUTH_PROBE_PATH);
      Store.set('authBypassed', true);
      Store.set('authUser', data?.auth?.user || null);
      return true;
    } catch (err) {
      if (isRateLimited(err) && await publicServerAvailable()) {
        Store.set('authBypassed', true);
        Store.set('authUser', null);
        return true;
      }
      Store.set('authBypassed', false);
      Store.set('authUser', null);
      return false;
    }
  }

  /* 有 token — 验证 */
  try {
    const data = await api.get(AUTH_PROBE_PATH);
    Store.set('authBypassed', false);
    Store.set('authUser', data?.auth?.user || null);
    return true;
  } catch (err) {
    if (isRateLimited(err)) {
      Store.set('authBypassed', false);
      return true;
    }
    Store.set('authToken', '');
    Store.persist('authToken');
    Store.set('authBypassed', false);
    Store.set('authUser', null);
    return false;
  }
}

export async function tryLogin(token) {
  Store.set('serverUrl', Store.get('serverUrl'));
  Store.set('authToken', token);
  Store.persist('authToken');

  try {
    const data = await api.get(AUTH_PROBE_PATH);
    Store.set('authBypassed', false);
    Store.set('authUser', data?.auth?.user || null);
    return true;
  } catch {
    Store.set('authToken', '');
    Store.persist('authToken');
    Store.set('authBypassed', false);
    Store.set('authUser', null);
    throw new Error('连接失败，请检查令牌与服务器');
  }
}

export async function tryAccountLogin(username, password) {
  const data = await api.post('/auth/login', { username, password });
  Store.set('authToken', data.token);
  Store.persist('authToken');
  Store.set('authBypassed', false);
  Store.set('authUser', data.user || null);
  return data;
}

export async function tryBootstrapOwner(username, password, setupToken) {
  const body = {
    username,
    password,
    ...(setupToken ? { setupToken } : {}),
  };
  const data = await api.post('/auth/bootstrap', body);
  Store.set('authToken', data.token);
  Store.persist('authToken');
  Store.set('authBypassed', false);
  Store.set('authUser', data.user || null);
  return data;
}

export async function logout() {
  try {
    await api.post('/auth/logout', {});
  } catch {}
  Store.set('authToken', '');
  Store.persist('authToken');
  Store.set('authUser', null);
  Store.set('authBypassed', false);
}
