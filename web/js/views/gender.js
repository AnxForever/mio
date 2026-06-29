/**
 * gender.js — Mio 性别选择器(纯组件,非路由 view)
 *
 * 用户只选择 Mio 的"性别"(她 / 他)。不预设任何恋爱标签 —
 * 关系靠日后相处自然演进。
 *
 * 性别 → 内部 mod 名映射(mod 名仅为后端实现,UI 永不显示):
 *     "她"  →  mod 'girlfriend'
 *     "他"  →  mod 'boyfriend'
 * 切换性别 = 调用方拿到 mod 名后 `api.post('/mod', { name })`。
 *
 * 用法(组件,自行 append,无 mount/unmount 生命周期):
 *     const picker = renderGenderPicker({
 *       value: 'girlfriend',          // 初始选中(可选)
 *       onSelect: (mod) => { ... },   // 'girlfriend' | 'boyfriend'
 *     });
 *     container.appendChild(picker);
 *
 * 扩展位:未来支持自定义角色形象时,在 GENDERS 配置里追加
 * `art`(图片 URL 或自定义 SVG 工厂),并在 buildArt() 中优先采用。
 */

import { el } from '../utils/dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 性别选项配置。
 * - pronoun:唯一对外文案(她 / 他)
 * - roman:  装饰性副标(SHE / HE)
 * - mod:    内部实现名(不展示)
 */
const GENDERS = [
  { mod: 'girlfriend', pronoun: '她', roman: 'SHE', variant: 'she' },
  { mod: 'boyfriend', pronoun: '他', roman: 'HE', variant: 'he' },
  // 扩展位:{ mod: 'custom-x', pronoun: '…', roman: '…', art: '/assets/…' }
];

const VALID = new Set(GENDERS.map((g) => g.mod));

/**
 * 极简线条头肩剪影占位。currentColor 继承自卡片(选中态转 --accent)。
 * 未来可替换为自定义角色立绘 —— 见文件头扩展位说明。
 */
function buildArt(variant) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', '64');
  svg.setAttribute('height', '64');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  // 头 + 肩为共用;发型线条区分她 / 他(仅作占位,不强化刻板印象)
  const paths = [
    'M32 31a11 11 0 1 0 0-22 11 11 0 0 0 0 22z', // 头
    'M14 55v-1a18 18 0 0 1 36 0v1', // 肩
  ];
  if (variant === 'he') {
    paths.push('M22 13c3-4 17-4 20 0'); // 短发线
  } else {
    paths.push('M21 15c-2 6-2 13 0 18', 'M43 15c2 6 2 13 0 18'); // 两侧长发线
  }

  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/**
 * 渲染性别选择器。
 * @param {{ value?: string, onSelect?: (mod: string) => void }} opts
 * @returns {HTMLElement} radiogroup 根节点
 */
export function renderGenderPicker({ value, onSelect } = {}) {
  let selected = VALID.has(value) ? value : null;

  const group = el('div', {
    className: 'gender-picker',
    role: 'radiogroup',
    'aria-label': 'Mio 的性别',
  });

  const cards = [];

  function setSelected(mod, { focus = false, emit = true } = {}) {
    if (!VALID.has(mod)) return;
    selected = mod;
    cards.forEach((c) => {
      const on = c.dataset.mod === mod;
      c.classList.toggle('is-selected', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
      if (on && focus) c.focus();
    });
    if (emit) onSelect?.(mod);
  }

  GENDERS.forEach((g, idx) => {
    const isOn = selected === g.mod;
    const card = el('div', {
      className: 'gender-card ui-panel tap' + (isOn ? ' is-selected' : ''),
      role: 'radio',
      tabindex: isOn || (!selected && idx === 0) ? '0' : '-1',
      'aria-checked': isOn ? 'true' : 'false',
      'aria-label': g.pronoun,
      dataset: { mod: g.mod },
    });

    const art = el('div', { className: 'gender-card-art' });
    art.appendChild(buildArt(g.variant));
    card.appendChild(art);
    card.appendChild(el('div', { className: 'gender-card-pronoun', textContent: g.pronoun }));
    card.appendChild(el('div', { className: 'gender-card-roman label', textContent: g.roman }));

    card.addEventListener('click', () => setSelected(g.mod));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setSelected(g.mod);
      } else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const next = GENDERS[(idx + dir + GENDERS.length) % GENDERS.length];
        setSelected(next.mod, { focus: true });
      }
    });

    cards.push(card);
    group.appendChild(card);
  });

  return group;
}
