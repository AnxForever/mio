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
 * 极简线条猫脸,与 assets/mascot 同笔触。currentColor 继承自卡片(选中态转 --accent)。
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

  // 猫脸 + 耳朵 + 胡须为共用;眼睛与细节区分她 / 他(不强化刻板印象)
  const paths = [
    'M32 54c11 0 19-7 19-17 0-10-8-17-19-17s-19 7-19 17c0 10 8 17 19 17z', // 脸
    'M18 26l-4-13 12 6',   // 左耳
    'M46 26l4-13-12 6',    // 右耳
    'M32 41v1.5',                          // 鼻梁
    'M32 42.5c-1.5 2-3.5 2-5 .8',          // 嘴左
    'M32 42.5c1.5 2 3.5 2 5 .8',           // 嘴右
    'M12 37h8', 'M13 42l7-1.5',            // 左胡须
    'M52 37h-8', 'M51 42l-7-1.5',          // 右胡须
  ];
  if (variant === 'he') {
    paths.push(
      'M25 35h.1', 'M39 35h.1',            // 圆点眼
      'M30 15c1-3 3-5 4-5',                // 头顶呆毛
    );
  } else {
    paths.push(
      'M22.5 34c1.5 2 4.5 2 6 0',          // 左笑眼
      'M35.5 34c1.5 2 4.5 2 6 0',          // 右笑眼
    );
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
