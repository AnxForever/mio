/**
 * api.js — HTTP 客户端
 *
 * 薄封装: 统一 base URL, auth headers, 超时, 错误格式化。
 * 不做重试 (由调用方决定), 不做缓存 (在 store 层做)。
 */

import { Store } from './store.js';

const TIMEOUT_MS = 30000;

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function base() {
  return Store.get('serverUrl');
}

function headers(extra = {}) {
  const h = { ...extra };
  const token = Store.get('authToken');
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

async function request(method, path, body, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? TIMEOUT_MS);

  try {
    const res = await fetch(base() + path, {
      method,
      headers: headers(opts.headers ?? { 'Content-Type': 'application/json' }),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      let errBody;
      try { errBody = await res.json(); } catch { errBody = { error: res.statusText }; }
      throw new ApiError(errBody.error || errBody.message || '请求失败', res.status, errBody);
    }

    if (opts.raw) return res;

    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  } catch (err) {
    if (err.name === 'ApiError') throw err;
    if (err.name === 'AbortError') throw new ApiError('请求超时', 0, {});
    throw new ApiError(err.message || '网络错误', 0, {});
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get(path, opts) { return request('GET', path, null, opts); },
  post(path, body, opts) { return request('POST', path, body, opts); },
  patch(path, body, opts) { return request('PATCH', path, body, opts); },
  put(path, body, opts) { return request('PUT', path, body, opts); },
  del(path, opts) { return request('DELETE', path, null, opts); },

  /** SSE streaming — 返回 reader, 调用方自己读 */
  async stream(path, body, onToken, onDone, onError) {
    try {
      const res = await request('POST', path, body, { raw: true });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const d = JSON.parse(line.slice(6));
              if (d.chunk !== undefined) onToken?.(d.chunk);
              if (d.error) onError?.(d.error);
            } catch {}
          }
        }
      }
      onDone?.();
    } catch (err) {
      onError?.(err.message || '流式请求失败');
    }
  }
};
