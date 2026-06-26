import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { renderTabBar } from '../components/tab-bar.js';
import { STAGE_LABELS } from '../utils/constants.js';

export class AnalyticsView extends BaseView {
  constructor(params) {
    super(params);
  }

  render() {
    this.el = el('div', { className: 'analytics-view' });

    const header = el('header', { className: 'analytics-header' });
    const backBtn = el('button', {
      className: 'studio-back-btn',
      innerHTML: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
      onClick: () => navigate('/chat'),
    });
    header.appendChild(backBtn);
    header.appendChild(el('h1', { className: 'studio-header-title', textContent: '我们的数据' }));
    this.el.appendChild(header);

    const content = el('div', { className: 'analytics-content', id: 'analytics-content' });
    this.el.appendChild(content);
    this.el.appendChild(renderTabBar());

    return this.el;
  }

  mount() {
    const content = this.el.querySelector('#analytics-content');
    if (content) this.loadAnalytics(content);
  }

  async loadAnalytics(container) {
    container.innerHTML = '';

    /* 骨架 */
    container.appendChild(this.skeletonAnalytics());

    try {
      const data = await api.get('/analytics');
      container.innerHTML = '';

      if (!data) {
        container.appendChild(this.renderEmpty());
        return;
      }

      /* 情绪曲线 */
      if (data.emotion?.affectionCurve?.length > 0) {
        container.appendChild(this.renderEmotionCard(data.emotion));
      }

      /* 关系进度 */
      if (data.relationship) {
        container.appendChild(this.renderRelationshipCard(data.relationship));
      }

      /* 对话统计 */
      if (data.conversation) {
        container.appendChild(this.renderStatsCard(data.conversation));
      }

      /* 话题 */
      if (data.topics?.topics?.length > 0) {
        container.appendChild(this.renderTopicsCard(data.topics));
      }

    } catch {
      container.innerHTML = '';
      container.appendChild(this.renderEmpty());
    }
  }

  /* ═══ 情绪曲线卡片 ═══ */
  renderEmotionCard(emotion) {
    const card = el('div', { className: 'data-card' });
    card.appendChild(el('div', { className: 'data-card-title', textContent: '心情画布' }));

    const chartWrap = el('div', { className: 'emotion-chart-wrap' });
    const canvas = el('canvas');
    chartWrap.appendChild(canvas);
    card.appendChild(chartWrap);

    /* Mood 图例 */
    if (emotion.dominantMoods?.length > 0) {
      const legend = el('div', { className: 'mood-legend' });
      const colors = ['#ffb347', '#7ec8e3', '#ff9a76', '#a3b1c6', '#d4a5d4'];
      emotion.dominantMoods.slice(0, 5).forEach((m, i) => {
        legend.appendChild(el('div', { className: 'mood-legend-item' }, [
          el('span', { className: 'mood-legend-dot', style: { background: colors[i] } }),
          el('span', { textContent: `${this.MOOD_LABELS[m.mood] || m.mood} ${m.count}天` }),
        ]));
      });
      card.appendChild(legend);
    }

    /* 延迟绘制 */
    setTimeout(() => {
      if (canvas.isConnected) this.drawEmotionCurve(canvas, emotion.affectionCurve);
    }, 100);

    return card;
  }

  get MOOD_LABELS() {
    return {
      '开心': '😊开心', '高兴': '😊高兴', '兴奋': '✨兴奋',
      '温柔': '💕温柔', '平静': '😌平静', '难过': '😢难过',
      '生气': '😤生气', '害羞': '🥰害羞', '疲倦': '😴疲倦',
    };
  }

  drawEmotionCurve(canvas, curve) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = rect.width;
    const h = 200;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    if (!curve || curve.length < 2) return;

    const padding = { top: 20, right: 12, bottom: 30, left: 12 };
    const pw = w - padding.left - padding.right;
    const ph = h - padding.top - padding.bottom;

    /* 值范围 */
    const values = curve.map(d => d.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;

    /* 背景渐变 — 仅曲线下方 */
    const bgGrad = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
    bgGrad.addColorStop(0, 'rgba(255, 122, 149, 0.06)');
    bgGrad.addColorStop(1, 'rgba(255, 122, 149, 0)');

    /* 绘制填充区域 */
    ctx.beginPath();
    const firstX = padding.left;
    const firstY = padding.top + ph - ((values[0] - minV) / range) * ph;
    ctx.moveTo(firstX, padding.top + ph);
    ctx.lineTo(firstX, firstY);

    for (let i = 1; i < values.length; i++) {
      const x = padding.left + (i / (values.length - 1)) * pw;
      const y = padding.top + ph - ((values[i] - minV) / range) * ph;
      ctx.lineTo(x, y);
    }

    ctx.lineTo(padding.left + pw, padding.top + ph);
    ctx.closePath();
    ctx.fillStyle = bgGrad;
    ctx.fill();

    /* 曲线 */
    ctx.beginPath();
    ctx.moveTo(firstX, firstY);

    for (let i = 1; i < values.length; i++) {
      const x = padding.left + (i / (values.length - 1)) * pw;
      const y = padding.top + ph - ((values[i] - minV) / range) * ph;
      const prevX = padding.left + ((i - 1) / (values.length - 1)) * pw;
      const prevY = padding.top + ph - ((values[i - 1] - minV) / range) * ph;

      const cpx = (prevX + x) / 2;
      ctx.bezierCurveTo(cpx, prevY, cpx, y, x, y);
    }

    ctx.strokeStyle = '#ff7a95';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    /* emoji 标签 — 左侧 */
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#aeaeb2';
    ctx.fillText('😊', 2, padding.top + 14);
    ctx.fillText('😌', 2, h - padding.bottom);
  }

  /* ═══ 关系进度卡片 ═══ */
  renderRelationshipCard(rel) {
    const card = el('div', { className: 'data-card' });
    card.appendChild(el('div', { className: 'data-card-title', textContent: '关系进度' }));

    /* 阶段轨道 */
    const stages = ['acquaintance', 'familiar', 'ambiguous', 'intimate'];
    const currentIdx = stages.indexOf(Object.keys(STAGE_LABELS).find(
      k => STAGE_LABELS[k] === rel.currentStage
    ));

    const track = el('div', { className: 'stage-track' });
    stages.forEach((s, i) => {
      const cls = i < currentIdx ? 'reached' : i === currentIdx ? 'current' : '';
      track.appendChild(el('div', { className: `stage-node ${cls}` }, [
        el('div', { className: 'stage-dot' }),
        el('span', { className: 'stage-label', textContent: STAGE_LABELS[s] }),
      ]));
    });
    card.appendChild(track);

    /* 进度环 */
    const progress = rel.progress || 0;
    const ringWrap = el('div', { className: 'progress-ring-wrap', style: { position: 'relative' } });
    const ringCanvas = el('canvas');
    ringWrap.appendChild(ringCanvas);
    ringWrap.appendChild(el('div', { className: 'progress-center' }, [
      el('span', { textContent: `${progress}%` }),
      el('small', { textContent: '进度' }),
    ]));
    card.appendChild(ringWrap);

    setTimeout(() => {
      if (ringCanvas.isConnected) this.drawProgressRing(ringCanvas, progress / 100);
    }, 100);

    /* 里程碑 */
    if (rel.milestones?.length > 0) {
      const list = el('ul', { className: 'milestone-list' });
      rel.milestones.slice(0, 5).forEach(m => {
        list.appendChild(el('li', { className: 'milestone-item' }, [
          el('div', { className: 'milestone-icon', textContent: '💫' }),
          el('span', { className: 'milestone-text', textContent: m.description }),
        ]));
      });
      card.appendChild(list);
    }

    return card;
  }

  drawProgressRing(canvas, ratio) {
    const size = 120;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cx = size / 2, cy = size / 2, r = 44;
    const lineWidth = 6;

    /* 背景环 */
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#e4e4e6';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    /* 进度环 */
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.strokeStyle = '#ff7a95';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /* ═══ 对话统计卡片 ═══ */
  renderStatsCard(conv) {
    const card = el('div', { className: 'data-card' });
    card.appendChild(el('div', { className: 'data-card-title', textContent: '对话统计' }));

    const grid = el('div', { className: 'stat-grid' });
    grid.appendChild(this.statItem(conv.totalMessages, '消息数'));
    grid.appendChild(this.statItem(conv.daysActive, '活跃天数'));
    grid.appendChild(this.statItem(conv.totalSessions, '会话数'));
    grid.appendChild(this.statItem(conv.avgMessagesPerDay, '日均消息'));
    card.appendChild(grid);

    return card;
  }

  statItem(value, label) {
    return el('div', { className: 'stat-item' }, [
      el('div', { className: 'stat-value', textContent: String(value || 0) }),
      el('div', { className: 'stat-label', textContent: label }),
    ]);
  }

  /* ═══ 话题卡片 ═══ */
  renderTopicsCard(topics) {
    const card = el('div', { className: 'data-card' });
    card.appendChild(el('div', { className: 'data-card-title', textContent: '话题花园' }));

    const cloud = el('div', { className: 'topic-cloud' });
    const maxCount = topics.topics[0]?.count || 1;

    topics.topics.forEach(t => {
      const ratio = t.count / maxCount;
      let cls = 'cold';
      if (ratio > 0.8) cls = 'hot';
      else if (ratio > 0.6) cls = 'warm';
      else if (ratio > 0.4) cls = 'mild';
      else if (ratio > 0.2) cls = 'cool';

      cloud.appendChild(el('span', { className: `topic-tag ${cls}`, textContent: t.name }));
    });

    card.appendChild(cloud);
    return card;
  }

  /* ═══ 空态 ═══ */
  renderEmpty() {
    return el('div', { className: 'data-empty' }, [
      el('p', { textContent: '还没有数据' }),
      el('p', { textContent: '开始对话后这里会出现你们的回忆' }),
    ]);
  }

  skeletonAnalytics() {
    return el('div', {}, [
      ...[1, 2, 3].map(() => el('div', {
        className: 'data-card',
        style: { height: '180px', animation: 'shimmer 1.5s linear infinite' },
      })),
    ]);
  }
}

// Export compat
let analyticsViewInstance = null;

export function renderAnalytics(params) {
  analyticsViewInstance = new AnalyticsView(params);
  return analyticsViewInstance.render();
}

export function mountAnalytics() {
  if (analyticsViewInstance) analyticsViewInstance.mount();
}

export function unmountAnalytics() {
  if (analyticsViewInstance) {
    analyticsViewInstance.unmount();
    analyticsViewInstance = null;
  }
}
