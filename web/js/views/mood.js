/**
 * views/mood.js — 心情小屋
 *
 * 展示 Mio 当前情绪(大 mascot + 心情标签)、关系阶段进度、以及她的情感全谱。
 * 所有数据 best-effort 拉取,失败优雅降级为「温柔 + 初识」,绝不白屏。
 *
 * 复用:liveness.js(moodVM / relationshipVM)、mascot.js(mascotSrc / EXPRESSIONS)、
 *       components.css(.avatar / .progress / .tap)、tokens.css。
 * 导出 render/mount/unmount 三件套,接入 app.js 的 viewMap。
 */
import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { api } from '../api.js';
import { ICONS } from '../utils/icons.js';
import { navigate } from '../router.js';
import { haptic } from '../utils/haptics.js';
import { mascotSrc, EXPRESSIONS } from '../mascot.js';
import { moodVM, relationshipVM } from '../liveness.js';

/** 表情 → 情感全谱中文标签(与 EXPRESSIONS 顺序对应)。
 *  liveness.js 内有同款映射但未导出,这里独立维护 6 谱标签。 */
const EXPR_LABELS = {
  happy: '开心',
  gentle: '温柔',
  longing: '想你了',
  shy: '害羞',
  worried: '担心',
  surprised: '惊喜',
};

/** 表情 → 一句温柔的当前心情描述(longing 走"想你"专属文案)。 */
const EXPR_DESC = {
  happy: '她现在心情很好呢',
  gentle: '她正温柔地陪着你',
  longing: '她有点想你了 · 找她聊聊吧',
  shy: '她有点小害羞～',
  worried: '她好像有点担心',
  surprised: '她对什么感到惊喜呢',
};

const DEFAULT_EXPR = 'gentle';

export class MoodView extends BaseView {
  constructor(params) {
    super(params);
    this._mounted = false;
    this._currentExpr = DEFAULT_EXPR;
    this._heroLayers = [];   // 双层 cross-fade 图层
    this._heroFront = 0;     // 当前正面层下标
    this._specItems = new Map(); // expr → 全谱条目元素

    this.handleBack = this.handleBack.bind(this);
  }

  render() {
    this.el = el('div', { className: 'mood-view' });

    /* ═══ 顶栏 ═══ */
    const header = el('header', { className: 'mood-header' });
    this.backBtn = el('button', { className: 'mood-back tap', 'aria-label': '返回' });
    this.backBtn.appendChild(ICONS.back(22));
    header.appendChild(this.backBtn);
    header.appendChild(el('h1', { className: 'mood-title', textContent: '心情小屋' }));
    // 与返回键等宽的占位,让标题真正居中
    header.appendChild(el('span', { className: 'mood-header-spacer', 'aria-hidden': 'true' }));
    this.el.appendChild(header);

    /* ═══ 主体(可滚动) ═══ */
    const body = el('div', { className: 'mood-body' });

    /* 大 mascot — 双层 cross-fade */
    this.hero = el('div', { className: 'mood-hero', role: 'img', 'aria-label': 'Mio 现在的心情' });
    for (let i = 0; i < 2; i++) {
      const img = el('img', { className: 'mood-hero__img', alt: '' });
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      this.hero.appendChild(img);
      this._heroLayers.push(img);
    }
    // 初始正面层 = 默认温柔态,直接亮起(无 fade)
    this._heroLayers[0].src = mascotSrc(DEFAULT_EXPR);
    this._heroLayers[0].classList.add('is-front');
    body.appendChild(this.hero);

    /* 心情标签 + 副文本 */
    const moodText = el('div', { className: 'mood-text' });
    this.moodLabel = el('div', { className: 'mood-label', textContent: EXPR_LABELS[DEFAULT_EXPR] });
    this.moodSub = el('div', { className: 'mood-sub', textContent: EXPR_DESC[DEFAULT_EXPR] });
    moodText.appendChild(this.moodLabel);
    moodText.appendChild(this.moodSub);
    body.appendChild(moodText);

    /* 关系阶段进度 */
    body.appendChild(this.buildRelCard());

    /* 情感全谱 */
    body.appendChild(this.buildSpectrum());

    this.el.appendChild(body);

    /* 首屏用默认值渲染一次,避免数据到达前白屏 */
    this.applyExpr(DEFAULT_EXPR, { animate: false });
    this.applyRel(relationshipVM({}));

    return this.el;
  }

  buildRelCard() {
    this.relCard = el('section', { className: 'mood-rel', 'aria-label': '关系阶段' });

    const track = el('div', { className: 'mood-rel__track' });
    this.relStage = el('span', { className: 'mood-rel__stage' });
    this.relNext = el('span', { className: 'mood-rel__next' });

    this.relProgress = el('div', {
      className: 'progress',
      role: 'progressbar',
      'aria-label': '关系进度',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
    });
    this.relBar = el('i');
    this.relProgress.appendChild(this.relBar);

    track.appendChild(this.relStage);
    track.appendChild(this.relProgress);
    track.appendChild(this.relNext);
    this.relCard.appendChild(track);

    // 满级专属文案(默认隐藏,由 .is-max 控制显隐)
    this.relMax = el('div', { className: 'mood-rel__max', textContent: '已是最亲密的关系' });
    this.relCard.appendChild(this.relMax);

    this.relCount = el('div', { className: 'mood-rel__count' });
    this.relCard.appendChild(this.relCount);

    return this.relCard;
  }

  buildSpectrum() {
    const wrap = el('section', { className: 'mood-spectrum', 'aria-label': '她的情感全谱' });
    for (const expr of EXPRESSIONS) {
      const item = el('div', { className: 'mood-spec', dataset: { expr } });
      const avatar = el('div', { className: 'avatar', 'aria-hidden': 'true' });
      const img = el('img', { alt: '', src: mascotSrc(expr) });
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      avatar.appendChild(img);
      item.appendChild(avatar);
      item.appendChild(el('span', { className: 'mood-spec__label', textContent: EXPR_LABELS[expr] }));
      wrap.appendChild(item);
      this._specItems.set(expr, item);
    }
    return wrap;
  }

  mount() {
    this._mounted = true;
    this.on(this.backBtn, 'click', this.handleBack);
    this.loadMood();
    this.loadRelationship();
  }

  unmount() {
    this._mounted = false;
    super.unmount();
  }

  handleBack() {
    haptic('light');
    navigate('/messages');
  }

  /* ─── 数据(best-effort,失败优雅降级) ─── */

  async loadMood() {
    let expr = DEFAULT_EXPR;
    try {
      const state = await api.get('/avatar/state');
      expr = moodVM(state || {}).expr || DEFAULT_EXPR;
    } catch {
      expr = DEFAULT_EXPR;
    }
    if (!this._mounted) return;
    this.applyExpr(expr, { animate: true });
  }

  async loadRelationship() {
    let rel = null;
    try {
      const status = await api.get('/status');
      rel = status?.relationship ?? null;
    } catch { rel = null; }

    if (!rel) {
      try { rel = await api.get('/analytics/relationship'); }
      catch { rel = null; }
    }
    if (!this._mounted) return;
    this.applyRel(relationshipVM(rel || {}));
  }

  /* ─── 渲染应用 ─── */

  /** 切换大 mascot 表情:双层 cross-fade(opacity + 微 scale)。 */
  applyExpr(expr, { animate = true } = {}) {
    if (!EXPR_LABELS[expr]) expr = DEFAULT_EXPR;

    // 文案 + 全谱高亮始终反映目标表情(首屏 / 即便表情未变也要正确)
    this.moodLabel.textContent = EXPR_LABELS[expr];
    this.moodSub.textContent = EXPR_DESC[expr] || EXPR_DESC[DEFAULT_EXPR];
    this.hero?.setAttribute('aria-label', `Mio 现在的心情：${EXPR_LABELS[expr]}`);
    this.highlightSpectrum(expr);

    if (expr === this._currentExpr) return; // 图像已正确,无需切换
    this._currentExpr = expr;

    const front = this._heroLayers[this._heroFront];
    const back = this._heroLayers[1 - this._heroFront];
    if (!front || !back) return;

    if (!animate) {
      front.src = mascotSrc(expr);
      front.style.visibility = '';
      return;
    }

    // 双层 cross-fade:新图在背面层加载好后亮起,正面层淡出
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      back.onload = null;
      back.onerror = null;
      back.classList.add('is-front');
      front.classList.remove('is-front');
      this._heroFront = 1 - this._heroFront;
    };
    back.style.visibility = '';
    back.onload = reveal;
    back.onerror = () => { back.style.visibility = 'hidden'; reveal(); };
    back.src = mascotSrc(expr);
    if (back.complete && back.naturalWidth > 0) reveal(); // 命中缓存:立即切换
  }

  /** 全谱中当前表情高亮(其余暗淡)。 */
  highlightSpectrum(expr) {
    for (const [key, item] of this._specItems) {
      const isCur = key === expr;
      item.classList.toggle('is-current', isCur);
      if (isCur) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
  }

  /** 应用关系阶段视图模型到进度条。 */
  applyRel(vm) {
    const isMax = !vm.nextStage;
    this.relCard.classList.toggle('is-max', isMax);
    this.relStage.textContent = vm.label;
    this.relNext.textContent = vm.nextStage || '';
    this.relCount.textContent = `聊了 ${vm.count} 次`;

    const pct = isMax ? 100 : Math.round(Math.min(1, Math.max(0, vm.progress)) * 100);
    this.relBar.style.width = `${pct}%`;
    this.relProgress.setAttribute('aria-valuenow', String(pct));
  }
}

/* 兼容 app.js 的 render/mount/unmount 接口 */
let _i = null;

export function renderMood(p) {
  _i = new MoodView(p);
  return _i.render();
}

export function mountMood() {
  if (_i) _i.mount();
}

export function unmountMood() {
  if (_i) {
    _i.unmount();
    _i = null;
  }
}
