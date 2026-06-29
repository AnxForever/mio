/**
 * views/messages.js — 消息列表(首屏)
 *
 * 白色极简 + 线条萌宠 + 情感联动。三个入口:
 *  ① Mio 对话   — mascot 头像 + 末条消息预览 + 时间      → /chat
 *  ② 心情小屋   — 当前心情(moodVM().label)              → /mood
 *  ③ 这周的我们 — 关系阶段 + 互动次数(relationshipVM)    → /chat
 *
 * mount 时并发 best-effort 拉 /avatar/state + /status;失败用占位文案,绝不白屏。
 * 复用 design tokens + components(.cell / .avatar / .tap),零新魔法值/配色。
 */
import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { mascotSrc } from '../mascot.js';
import { moodVM, relationshipVM } from '../liveness.js';
import { haptic } from '../utils/haptics.js';
import { ICONS } from '../utils/icons.js';

const MIO_PREVIEW_FALLBACK = '在身边，随时找我';
const WEEK_FALLBACK = '刚刚认识';

/** 时间戳 → 简短时间标签(今天 HH:MM / 昨天 / M月D日 / YYYY/M/D)。无效返回 ''。 */
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');

  if (d.toDateString() === now.toDateString()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export class MessagesView extends BaseView {
  constructor(params) {
    super(params);
    this.mascotImg = null;
    this.mioSub = null;
    this.mioTime = null;
    this.moodSub = null;
    this.weekSub = null;
    this.cellMio = null;
    this.cellMood = null;
    this.cellWeek = null;

    this.handleMessages = this.handleMessages.bind(this);
    this.handleAvatar = this.handleAvatar.bind(this);
  }

  render() {
    this.el = el('div', { className: 'messages-view' });

    /* ═══ 顶栏 ═══ */
    const header = el('header', { className: 'messages-header' });
    const backBtn = el('button', { className: 'messages-back tap', type: 'button', 'aria-label': '返回控制台' });
    backBtn.appendChild(ICONS.back(20));
    header.appendChild(backBtn);
    header.appendChild(el('h1', { className: 'messages-title', textContent: '消息概览' }));

    this.el.appendChild(header);

    /* ═══ 列表(.cell + .cell 自带 .5px 发丝线) ═══ */
    const list = el('div', { className: 'messages-list' });

    /* ① Mio 对话 */
    const mio = this.buildCell({
      avatar: this.buildMascotAvatar(),
      title: 'Mio',
      sub: this.lastMessageText(),
      withTime: true,
    });
    this.cellMio = mio.cell;
    this.mioSub = mio.subEl;
    this.mioTime = mio.timeEl;
    this.mioTime.textContent = this.lastMessageTime();
    list.appendChild(mio.cell);

    /* ② 心情小屋 */
    const mood = this.buildCell({
      avatar: this.buildIconAvatar(ICONS.studio(20)),
      title: '心情小屋',
      sub: moodVM({}).label,
    });
    this.cellMood = mood.cell;
    this.moodSub = mood.subEl;
    list.appendChild(mood.cell);

    /* ③ 这周的我们 */
    const week = this.buildCell({
      avatar: this.buildIconAvatar(ICONS.analytics(20)),
      title: '这周的我们',
      sub: WEEK_FALLBACK,
    });
    this.cellWeek = week.cell;
    this.weekSub = week.subEl;
    list.appendChild(week.cell);

    this.el.appendChild(list);
    return this.el;
  }

  /** 单个列表项 → { cell, subEl, timeEl }(复用 components 的 .cell / .tap) */
  buildCell({ avatar, title, sub, withTime = false }) {
    const cell = el('div', { className: 'cell tap', role: 'button', tabindex: '0' });
    cell.appendChild(avatar);

    const body = el('div', { className: 'cell-body' });
    const titleRow = el('div', { className: 'cell-title-row' });
    titleRow.appendChild(el('div', { className: 'cell-title', textContent: title }));

    let timeEl = null;
    if (withTime) {
      timeEl = el('time', { className: 'cell-time' });
      titleRow.appendChild(timeEl);
    }

    const subEl = el('div', { className: 'cell-sub', textContent: sub });
    body.appendChild(titleRow);
    body.appendChild(subEl);
    cell.appendChild(body);

    return { cell, subEl, timeEl };
  }

  /** Mio 头像(线条萌宠,PAD → 表情;默认 gentle) */
  buildMascotAvatar() {
    const wrap = el('div', { className: 'avatar messages-avatar', 'aria-hidden': 'true' });
    this.mascotImg = el('img', { alt: '', src: mascotSrc('gentle') });
    this.mascotImg.addEventListener('error', () => { this.mascotImg.style.visibility = 'hidden'; });
    wrap.appendChild(this.mascotImg);
    return wrap;
  }

  /** 线条图标头像(②③ 用,圆形 --surface 底 + 线条图标) */
  buildIconAvatar(iconNode) {
    const wrap = el('div', { className: 'avatar messages-avatar messages-avatar--icon', 'aria-hidden': 'true' });
    wrap.appendChild(iconNode);
    return wrap;
  }

  /* ─── Store 派生文案 ─── */

  lastMessageText() {
    const msgs = Store.get('messages') || [];
    const last = msgs[msgs.length - 1];
    const text = last && typeof last.text === 'string' ? last.text.trim() : '';
    return text || MIO_PREVIEW_FALLBACK;
  }

  lastMessageTime() {
    const msgs = Store.get('messages') || [];
    const last = msgs[msgs.length - 1];
    return last ? formatTime(last.timestamp) : '';
  }

  mount() {
    /* 点击 / 键盘导航(cell 为 role=button + tabindex) */
    this.bindCell(this.cellMio, '/chat');
    this.bindCell(this.cellMood, '/mood');
    this.bindCell(this.cellWeek, '/chat');

    this.on(this.el.querySelector('.messages-back'), 'click', () => this.go('/console'));

    /* 实时联动:消息预览 + 头像表情 */
    this._unsubscribes.push(Store.on('messages', this.handleMessages));
    this._unsubscribes.push(Store.on('avatar', this.handleAvatar));

    /* 并发 best-effort 拉取(失败各自回落占位) */
    this.loadAvatar();
    this.loadStatus();
  }

  unmount() {
    super.unmount();
  }

  /** 绑定一个 cell 的点击 + 键盘激活 → navigate(path) */
  bindCell(cell, path) {
    if (!cell) return;
    this.on(cell, 'click', () => this.go(path));
    this.on(cell, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.go(path); }
    });
  }

  go(path) {
    haptic('light');
    navigate(path);
  }

  /* ─── Store 订阅回调 ─── */

  handleMessages() {
    if (this.mioSub) this.mioSub.textContent = this.lastMessageText();
    if (this.mioTime) this.mioTime.textContent = this.lastMessageTime();
  }

  handleAvatar(state) {
    this.applyAvatar(state);
  }

  /* ─── best-effort 拉取 ─── */

  async loadAvatar() {
    try {
      const state = await api.get('/avatar/state');
      this.applyAvatar(state);
    } catch {
      this.setMascot('gentle');
      if (this.moodSub) this.moodSub.textContent = moodVM({}).label;
    }
  }

  async loadStatus() {
    try {
      const data = await api.get('/status');
      const vm = relationshipVM(data?.relationship || {});
      if (this.weekSub) this.weekSub.textContent = `${vm.label} · 聊了 ${vm.count} 次`;
    } catch {
      if (this.weekSub) this.weekSub.textContent = WEEK_FALLBACK;
    }
  }

  /** avatarState → mascot 表情 + 心情标签(无 pad 回落 gentle / 温柔) */
  applyAvatar(state) {
    const vm = moodVM(state || {});
    this.setMascot(vm.expr);
    if (this.moodSub) this.moodSub.textContent = vm.label;
  }

  setMascot(expr) {
    if (!this.mascotImg) return;
    const src = mascotSrc(expr);
    if (this.mascotImg.getAttribute('src') !== src) {
      this.mascotImg.style.visibility = '';
      this.mascotImg.src = src;
    }
  }
}

/* 兼容 app.js 的 render/mount/unmount 接口 */
let _i = null;

export function renderMessages(p) {
  _i = new MessagesView(p);
  return _i.render();
}

export function mountMessages() {
  if (_i) _i.mount();
}

export function unmountMessages() {
  if (_i) {
    _i.unmount();
    _i = null;
  }
}
