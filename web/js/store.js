/**
 * store.js — 发布-订阅状态管理
 *
 * 单一全局状态树, 每个视图只订阅它关心的 key。
 * 聊天消息用追加而非全量替换, 避免不必要的重绘。
 */

const STORAGE_PREFIX = 'mio_';

function loadPersisted(key, fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch { /* quota exceeded, silent */ }
}

const _state = {
  connected: false,
  serverUrl: window.location.origin || 'http://127.0.0.1:3000',
  authToken: loadPersisted('auth_token', ''),

  activeMod: 'girlfriend',
  personaMode: 'base',
  mods: [],

  emotion: null,
  relationship: null,
  avatar: null,
  affection: 0,
  stage: 'acquaintance',

  sessionId: loadPersisted('session', ''),
  messages: [],
  streaming: false,
  streamTokenCount: 0,

  analytics: null,

  route: window.location.hash.slice(1) || '/chat',
  toast: null,
};

const _listeners = new Map();

export const Store = {
  get(key) {
    return _state[key];
  },

  set(key, value) {
    const prev = _state[key];
    if (prev === value) return;
    _state[key] = value;
    _notify(key, value, prev);
  },

  patch(obj) {
    for (const [k, v] of Object.entries(obj)) {
      const prev = _state[k];
      if (prev === v) continue;
      _state[k] = v;
      _notify(k, v, prev);
    }
  },

  on(key, fn) {
    if (!_listeners.has(key)) _listeners.set(key, new Set());
    _listeners.get(key).add(fn);
    return () => _listeners.get(key)?.delete(fn);
  },

  _notify(key, value, prev) {
    _listeners.get(key)?.forEach(fn => { try { fn(value, prev); } catch {} });
    _listeners.get('*')?.forEach(fn => { try { fn(key, value, prev); } catch {} });
  },

  persistentKeys: ['authToken', 'sessionId'],

  persist(key) {
    persist(key, _state[key]);
  }
};

/* 自动持久化标记的 key */
Store.on('authToken', v => persist('auth_token', v));
Store.on('sessionId', v => persist('session', v));
