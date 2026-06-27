/**
 * ws.js — WebSocket 管理器
 *
 * 自动重连, 心跳保活, 消息路由, 优雅降级到 SSE/HTTP。
 * WS 流式回调通过注册机制传递, 因为 WS 消息是全局到达的。
 */

import { Store } from './store.js';
import { api } from './api.js';

const RECONNECT_DELAYS = [1000, 2000, 5000, 15000, 30000];
let ws = null;
let reconnectIdx = 0;
let reconnectTimer = null;
let heartbeatTimer = null;
let alive = true;

/* WS 流式回调 — 由 sendChat 在发送前注册, onMessage 中调用, done/error 后自动清除 */
let _streamCallbacks = null;

function url() {
  const server = Store.get('serverUrl');
  const wsBase = server.replace(/^http/, 'ws');
  const token = Store.get('authToken');
  return token ? `${wsBase}/ws?token=${encodeURIComponent(token)}` : `${wsBase}/ws`;
}

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = RECONNECT_DELAYS[Math.min(reconnectIdx, RECONNECT_DELAYS.length - 1)];
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectIdx++;
    connect();
  }, delay);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch {}
  }, 30000);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function onOpen() {
  reconnectIdx = 0;
  Store.set('connected', true);
  startHeartbeat();
}

function onMessage(ev) {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }

  switch (msg.type) {
    case 'hello':
      break;

    case 'token':
      /* 流式 token — 通过回调传给 chat.js */
      if (_streamCallbacks?.onToken) {
        _streamCallbacks.onToken(msg.chunk);
      }
      Store.set('streaming', true);
      break;

    case 'done':
      Store.set('streaming', false);
      if (msg.sessionId) {
        Store.set('sessionId', msg.sessionId);
        Store.persist('sessionId');
      }
      /* 通知流式完成 */
      if (_streamCallbacks?.onDone) {
        _streamCallbacks.onDone();
        _streamCallbacks = null;
      }
      break;

    case 'error':
      Store.set('streaming', false);
      if (_streamCallbacks?.onError) {
        _streamCallbacks.onError(msg.error || '未知错误');
        _streamCallbacks = null;
      }
      break;

    case 'mod_switched':
      Store.set('activeMod', msg.activeMod);
      break;

    case 'emotion_changed':
    case 'avatar_state':
      if (msg.state) Store.set('avatar', msg.state);
      break;

    case 'ping':
      send({ type: 'pong', t: msg.t });
      break;

    case 'pong':
      alive = true;
      break;
  }
}

function onClose() {
  ws = null;
  Store.set('connected', false);
  stopHeartbeat();
  scheduleReconnect();
}

function connect() {
  if (ws) return;

  try {
    ws = new WebSocket(url());
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = onOpen;
  ws.onmessage = onMessage;
  ws.onclose = onClose;
  ws.onerror = () => {};
}

export const wsManager = {
  connect,

  disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    stopHeartbeat();
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
    Store.set('connected', false);
  },

  send(payload) {
    return send(payload);
  },

  isOpen() {
    return ws && ws.readyState === WebSocket.OPEN;
  },

  /**
   * 发送聊天消息 — 优先 WS, 降级 SSE, 再降级 HTTP POST。
   * WS 路径通过注册回调到模块全局变量 _streamCallbacks,
   * onMessage 收到 token/done/error 时自动调用并清理。
   */
  async sendChat(text, { imagePath, onToken, onDone, onError } = {}) {
    if (this.isOpen() && !imagePath) {
      /* 注册流式回调 → onMessage 会调用它们 */
      _streamCallbacks = { onToken, onDone, onError };
      send({ type: 'chat', text, sessionId: Store.get('sessionId') || undefined });
      return;
    }

    /* SSE fallback */
    try {
      await api.stream('/chat/stream', {
        text,
        sessionId: Store.get('sessionId') || undefined,
        imagePath,
      }, onToken, onDone, onError);
    } catch {
      /* HTTP POST fallback */
      try {
        const data = await api.post('/chat', {
          text,
          sessionId: Store.get('sessionId') || undefined,
          imagePath,
        });
        if (data && data.text) {
          onToken?.(data.text);
          if (data.sessionId) {
            Store.set('sessionId', data.sessionId);
            Store.persist('sessionId');
          }
          onDone?.();
        }
      } catch (err) {
        onError?.(err.message || '发送失败');
      }
    }
  },

  switchMod(name) {
    if (this.isOpen()) {
      send({ type: 'switch_mod', name });
    }
  },
};
