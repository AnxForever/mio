/**
 * auth.js — 认证视图
 *
 * 启动屏 + 认证浮层, 优雅的淡入动画。
 */

import { el } from '../utils/dom.js';
import { getAuthStatus, tryAccountLogin, tryBootstrapOwner, tryLogin } from '../auth.js';
import { Store } from '../store.js';
import { mascotSrc } from '../mascot.js';

export function renderAuth() {
  const container = el('div', { className: 'auth-overlay' });

  const panel = el('section', { className: 'auth-panel ui-panel', 'aria-label': 'Mio 控制台登录' });

  const avatar = el('div', { className: 'avatar auth-avatar' });
  const img = el('img', { alt: '', src: mascotSrc('gentle') });
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  avatar.appendChild(img);

  const title = el('h1', { className: 'auth-title', textContent: 'Mio 控制台' });
  const subtitle = el('p', { className: 'auth-subtitle', textContent: '正在检查登录方式…' });

  const form = el('div', { className: 'auth-form' });
  const usernameInput = el('input', {
    className: 'auth-input ui-field',
    type: 'text',
    placeholder: '用户名',
    autocomplete: 'username',
    'aria-label': '用户名',
  });
  const passwordInput = el('input', {
    className: 'auth-input ui-field',
    type: 'password',
    placeholder: '密码',
    autocomplete: 'current-password',
    'aria-label': '密码',
  });
  const setupInputWrap = el('div', { className: 'auth-setup-token' });
  const setupInput = el('input', {
    className: 'auth-input ui-field',
    type: 'password',
    placeholder: '本地 setup token',
    autocomplete: 'off',
    'aria-label': '本地 setup token',
  });
  setupInputWrap.appendChild(setupInput);
  const error = el('div', { className: 'auth-error', role: 'alert' });

  const btn = el('button', { className: 'auth-btn ui-button ui-button--primary', type: 'button', textContent: '登录' });

  form.appendChild(usernameInput);
  form.appendChild(passwordInput);
  form.appendChild(setupInputWrap);

  /* 服务器地址 — 高级选项, 默认折叠 */
  const advancedToggle = el('button', {
    className: 'auth-advanced-toggle',
    type: 'button',
    textContent: '服务器地址',
    onClick: () => {
      advanced.classList.toggle('open');
      advancedToggle.textContent = advanced.classList.contains('open') ? '收起服务器地址' : '服务器地址';
    },
  });

  const advanced = el('div', { className: 'auth-advanced' });
  const serverInput = el('input', {
    className: 'auth-input auth-input-server ui-field',
    type: 'text',
    placeholder: Store.get('serverUrl'),
    value: Store.get('serverUrl'),
    'aria-label': '服务器地址',
  });
  advanced.appendChild(serverInput);

  const legacyToggle = el('button', {
    className: 'auth-advanced-toggle',
    type: 'button',
    textContent: '本地访问令牌',
    onClick: () => {
      legacy.classList.toggle('open');
      legacyToggle.textContent = legacy.classList.contains('open') ? '收起本地访问令牌' : '本地访问令牌';
    },
  });
  const legacy = el('div', { className: 'auth-advanced' });
  const tokenInput = el('input', {
    className: 'auth-input ui-field',
    type: 'password',
    placeholder: 'MIO_AUTH_TOKEN',
    autocomplete: 'off',
    'aria-label': '访问令牌',
  });
  const tokenBtn = el('button', {
    className: 'auth-btn auth-btn--secondary ui-button',
    type: 'button',
    textContent: '使用令牌连接',
  });
  legacy.appendChild(tokenInput);
  legacy.appendChild(tokenBtn);

  panel.appendChild(el('div', { className: 'auth-brand' }, [
    avatar,
    el('div', { className: 'auth-copy' }, [
      title,
      subtitle,
    ]),
  ]));
  panel.appendChild(form);
  panel.appendChild(error);
  panel.appendChild(btn);
  panel.appendChild(legacyToggle);
  panel.appendChild(legacy);
  panel.appendChild(advancedToggle);
  panel.appendChild(advanced);
  container.appendChild(panel);

  let mode = 'login';
  let bootstrapRequiresSetupToken = false;

  function setBusy(button, busy, idleText) {
    button.classList.toggle('loading', busy);
    button.textContent = busy ? '' : idleText;
  }

  function fail(message, button = btn, idleText = btn.textContent || '登录') {
    button.classList.remove('loading');
    button.classList.add('shake');
    error.textContent = message;
    error.classList.add('show');
    button.textContent = idleText;
    setTimeout(() => button.classList.remove('shake'), 500);
  }

  function finish(button, text) {
    button.classList.remove('loading');
    button.classList.add('success');
    button.textContent = text;
  }

  /* ─── 事件 ─── */
  async function doAccountLogin() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const setupToken = setupInput.value.trim();
    const idleText = mode === 'bootstrap' ? '创建 Owner 账号' : '登录';
    if (!username || !password) {
      error.textContent = '请输入用户名和密码';
      error.classList.add('show');
      return;
    }
    if (mode === 'bootstrap' && bootstrapRequiresSetupToken && !setupToken) {
      error.textContent = '请输入本地 setup token';
      error.classList.add('show');
      return;
    }

    /* 更新服务器地址 */
    const server = serverInput.value.trim();
    if (server) Store.set('serverUrl', server);

    error.classList.remove('show');
    setBusy(btn, true, idleText);

    try {
      if (mode === 'bootstrap') {
        await tryBootstrapOwner(username, password, setupToken);
      } else {
        await tryAccountLogin(username, password);
      }
      finish(btn, '已连接');

      /* 短暂延迟让用户看到成功状态 */
      await new Promise(r => setTimeout(r, 600));

      window.dispatchEvent(new CustomEvent('mio:authenticated'));
    } catch (err) {
      fail(err.message || '登录失败', btn, idleText);
    }
  }

  async function doTokenLogin() {
    const token = tokenInput.value.trim();
    if (!token) {
      error.textContent = '请输入访问令牌';
      error.classList.add('show');
      return;
    }

    const server = serverInput.value.trim();
    if (server) Store.set('serverUrl', server);

    error.classList.remove('show');
    setBusy(tokenBtn, true, '使用令牌连接');

    try {
      await tryLogin(token);
      finish(tokenBtn, '已连接');
      await new Promise(r => setTimeout(r, 600));
      window.dispatchEvent(new CustomEvent('mio:authenticated'));
    } catch (err) {
      fail(err.message || '连接失败', tokenBtn, '使用令牌连接');
    }
  }

  btn.addEventListener('click', doAccountLogin);
  tokenBtn.addEventListener('click', doTokenLogin);
  [usernameInput, passwordInput, setupInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAccountLogin();
    });
  });
  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doTokenLogin();
  });

  getAuthStatus().then((status) => {
    mode = status?.usersConfigured ? 'login' : 'bootstrap';
    bootstrapRequiresSetupToken = status?.bootstrapRequiresSetupToken === true;
    setupInputWrap.classList.toggle('show', mode === 'bootstrap' && bootstrapRequiresSetupToken);
    if (mode === 'bootstrap') {
      title.textContent = '创建 Owner 账号';
      subtitle.textContent = bootstrapRequiresSetupToken
        ? '首次初始化需要本地 setup token，之后请使用账号登录。'
        : '首次初始化后，管理后台将使用账号会话登录。';
      btn.textContent = '创建 Owner 账号';
      passwordInput.autocomplete = 'new-password';
    } else {
      title.textContent = 'Mio 控制台登录';
      subtitle.textContent = '使用你的控制台账号进入管理后台。微信试用用户不需要登录这里。';
      btn.textContent = '登录';
      passwordInput.autocomplete = 'current-password';
    }
  }).catch(() => {
    subtitle.textContent = '无法读取登录状态，请检查服务器地址。';
  });

  /* 自动 focus */
  setTimeout(() => usernameInput.focus(), 400);

  return container;
}
