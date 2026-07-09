/**
 * empty-state.js — Shared empty/error state component
 *
 * Replaces inline `<div>角色卡读取失败</div>` blocks with a tasteful
 * icon + serif title + body line + optional CTA. View files can import
 * this and assemble via simple props.
 *
 *   renderEmpty({
 *     icon: ICONS.emptyBook,
 *     title: '记忆库还没有内容',
 *     desc: '开始对话后，Mio 会把值得记住的事沉淀到这里。',
 *     cta:  { label: '去聊天', onClick: () => navigate('/chat') },
 *     tone: 'warm',   // 'warm' | 'error' | 'mute'
 *   })
 */

import { el } from '../utils/dom.js';
import { ICONS } from '../utils/icons.js';

const TONE_CLASS = {
  warm:  'ui-empty--warm',
  error: 'ui-empty--error',
  mute:  'ui-empty--mute',
  brand: 'ui-empty--brand',
};

/**
 * @param {Object} opts
 * @param {Function} [opts.icon]      — SVG fn returning <svg>
 * @param {string}  [opts.title]      — headline (serif)
 * @param {string}  [opts.desc]       — supporting line
 * @param {Object}  [opts.cta]        — { label, onClick, kind: 'primary'|'secondary' }
 * @param {string}  [opts.tone='warm']— 'warm' | 'error' | 'mute' | 'brand'
 * @param {string}  [opts.size='md']  — 'sm' | 'md' | 'lg' controls vertical padding
 * @param {string}  [opts.className]  — extra class added to root
 */
export function renderEmpty(opts = {}) {
  const tone = TONE_CLASS[opts.tone] || TONE_CLASS.warm;
  const size = `ui-empty--${opts.size || 'md'}`;
  const classes = ['ui-empty', tone, size, opts.className].filter(Boolean);

  const iconFn = opts.icon || ICONS.moon;
  const iconWrap = el('div', { className: 'ui-empty-icon' });
  iconWrap.appendChild(iconFn(22));

  const parts = [
    iconWrap,
    opts.title ? el('p',  { className: 'ui-empty-title', textContent: opts.title }) : null,
    opts.desc  ? el('p',  { className: 'ui-empty-desc',  textContent: opts.desc  }) : null,
  ];

  if (opts.cta && opts.cta.label) {
    const ctaClass = `ui-empty-cta ui-empty-cta--${opts.cta.kind || 'primary'}`;
    const cta = el('button', {
      className: ctaClass,
      type: 'button',
      onClick: opts.cta.onClick,
      textContent: opts.cta.label,
    });
    parts.push(cta);
  }

  return el('div', { className: classes.join(' '), role: 'status' }, parts.filter(Boolean));
}

/**
 * Inline variant — for rows in lists or compact slots.
 * Single line + tiny accent; no padding chrome.
 */
export function renderInlineEmpty(label, tone = 'mute') {
  return el('span', {
    className: `ui-empty-inline ui-empty-inline--${tone}`,
    textContent: label,
  });
}
