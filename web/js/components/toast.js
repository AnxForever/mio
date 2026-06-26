/**
 * toast.js — Toast 通知组件
 *
 * 从顶部滑入, 自动消失。成功/错误/信息三种类型。
 */

import { el } from '../utils/dom.js';

let activeToast = null;
let dismissTimer = null;

export function toast(message, type = 'info', duration = 3000) {
  /* 先清除上一个 */
  if (activeToast) dismiss();

  const toastEl = el('div', {
    className: `toast toast-${type}`,
    textContent: message,
  });

  document.body.appendChild(toastEl);

  /* 强制回流后触发入场动画 */
  void toastEl.offsetWidth;
  toastEl.classList.add('show');

  activeToast = toastEl;

  if (duration > 0) {
    dismissTimer = setTimeout(dismiss, duration);
  }

  return toastEl;
}

export function dismiss() {
  if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
  if (!activeToast) return;

  activeToast.classList.remove('show');
  activeToast.classList.add('hide');

  const el = activeToast;
  el.addEventListener('transitionend', () => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, { once: true });

  activeToast = null;
}
