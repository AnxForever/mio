/**
 * auth.js — 认证视图
 *
 * 启动屏 + 认证浮层, 优雅的淡入动画。
 */

import { el } from '../utils/dom.js';
import { tryLogin } from '../auth.js';
import { Store } from '../store.js';
import { wsManager } from '../ws.js';
import { initRouter } from '../router.js';

export function renderAuth() {
  const container = el('div', { className: 'auth-overlay' });

  /* 情绪球 — 未连接状态: 静止, 无光晕 */
  const ball = el('canvas', { className: 'auth-ball', width: '120', height: '120' });
  drawAuthBall(ball);

  const title = el('h1', { className: 'auth-title', textContent: 'Mio' });
  const subtitle = el('p', { className: 'auth-subtitle', textContent: '你的情感陪伴伙伴' });

  const inputWrap = el('div', { className: 'auth-input-wrap' });
  const input = el('input', {
    className: 'auth-input',
    type: 'password',
    placeholder: '访问令牌',
    autocomplete: 'off',
  });
  const error = el('div', { className: 'auth-error' });

  const btn = el('button', { className: 'auth-btn', textContent: '连接' });

  /* 服务器地址 — 高级选项, 默认折叠 */
  const advancedToggle = el('button', {
    className: 'auth-advanced-toggle',
    textContent: '高级设置',
    onClick: () => {
      advanced.classList.toggle('open');
      advancedToggle.textContent = advanced.classList.contains('open') ? '收起' : '高级设置';
    },
  });

  const advanced = el('div', { className: 'auth-advanced' });
  const serverInput = el('input', {
    className: 'auth-input auth-input-server',
    type: 'text',
    placeholder: Store.get('serverUrl'),
    value: Store.get('serverUrl'),
  });
  advanced.appendChild(serverInput);

  inputWrap.appendChild(input);
  container.appendChild(ball);
  container.appendChild(title);
  container.appendChild(subtitle);
  container.appendChild(inputWrap);
  container.appendChild(error);
  container.appendChild(btn);
  container.appendChild(advancedToggle);
  container.appendChild(advanced);

  /* ─── 事件 ─── */
  async function doLogin() {
    const token = input.value.trim();
    if (!token) {
      error.textContent = '请输入访问令牌';
      error.classList.add('show');
      return;
    }

    /* 更新服务器地址 */
    const server = serverInput.value.trim();
    if (server) Store.set('serverUrl', server);

    error.classList.remove('show');
    btn.classList.add('loading');
    btn.textContent = '';

    try {
      await tryLogin(token);
      btn.classList.remove('loading');
      btn.classList.add('success');
      btn.textContent = '✓';

      /* 短暂延迟让用户看到成功状态 */
      await new Promise(r => setTimeout(r, 600));

      wsManager.connect();
      initRouter();
    } catch (err) {
      btn.classList.remove('loading');
      btn.classList.add('shake');
      error.textContent = err.message;
      error.classList.add('show');
      btn.textContent = '连接';

      setTimeout(() => btn.classList.remove('shake'), 500);
    }
  }

  btn.addEventListener('click', doLogin);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  /* 自动 focus */
  setTimeout(() => input.focus(), 400);

  return container;
}

function drawAuthBall(canvas) {
  const ctx = canvas.getContext('2d');
  const cx = 60, cy = 60, r = 36;

  /* 灰色渐变 — 未连接 */
  const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
  grad.addColorStop(0, '#f0f0f2');
  grad.addColorStop(1, '#e4e4e6');

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  /* 柔边 */
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.02)';
  ctx.fill();
}
