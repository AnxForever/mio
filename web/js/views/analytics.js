/**
 * analytics.js — 数据页 / "我们的数据"
 *
 * 卡片式可视化(零依赖,纯 DOM/CSS,无图表库):
 *   关系卡   — /status.relationship → relationshipVM(阶段 + 进度条 + 聊了 N 次)
 *   心情卡   — /analytics/emotion 主导情绪分布(色取 --mood-*),无历史时回落 /status 当前心情
 *   话题卡   — /analytics/topics 聊得最多(.cell 列表 + 计数)
 *   点滴卡   — /analytics/conversation 数字快照
 *
 * 每个接口 best-effort:失败 / 空数据 → 卡内占位,全失败 → 整页空态,绝不白屏。
 * 复用设计系统 token + 组件(.card / .cell / .progress / .tap),零新配色。
 */
import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { ICONS } from '../utils/icons.js';
import { getMoodInfo } from '../utils/constants.js';
import { relationshipVM } from '../liveness.js';

/** 心情 → 设计系统心情色 token(零新配色;未命中按序轮转,保证每条都有色) */
const MOOD_TOKENS = ['var(--mood-joy)', 'var(--mood-tender)', 'var(--mood-calm)', 'var(--mood-miss)'];

function moodToken(mood, i) {
  const m = (mood || '').toLowerCase();
  const has = (...keys) => keys.some((k) => m.includes(k));
  if (has('开心', '高兴', '兴奋', '喜', 'happy', 'excited', 'joy')) return 'var(--mood-joy)';
  if (has('温柔', '爱', '害羞', '心疼', '甜', 'tender', 'love', 'shy')) return 'var(--mood-tender)';
  if (has('平静', '日常', '放松', '困', '疲', 'calm', 'peace', 'tired', 'sleep')) return 'var(--mood-calm)';
  if (has('难过', '孤', '想', '念', '担心', '失落', 'sad', 'lonely', 'miss', 'worried')) return 'var(--mood-miss)';
  return MOOD_TOKENS[i % MOOD_TOKENS.length];
}

export class AnalyticsView extends BaseView {
  constructor(params) {
    super(params);
    this.backBtn = null;
    this.content = null;
  }

  render() {
    this.el = el('div', { className: 'analytics-view' });

    /* 顶栏 */
    const header = el('header', { className: 'ana-header' });
    this.backBtn = el('button', { className: 'ana-back tap', 'aria-label': '返回' });
    this.backBtn.appendChild(ICONS.back());
    header.appendChild(this.backBtn);
    header.appendChild(el('h1', { className: 'ana-title', textContent: '我们的数据' }));
    this.el.appendChild(header);

    /* 滚动内容 */
    this.content = el('div', { className: 'ana-content', role: 'region', 'aria-label': '数据概览' });
    this.el.appendChild(this.content);

    return this.el;
  }

  mount() {
    this.on(this.backBtn, 'click', () => navigate('/chat'));
    this.loadAnalytics();
  }

  /** 并行拉取,各接口独立 best-effort;视图卸载后中止渲染 */
  async loadAnalytics() {
    const container = this.content;
    if (!container) return;

    container.innerHTML = '';
    container.appendChild(this.buildSkeleton());

    const [statusR, emotionR, topicsR, convR] = await Promise.allSettled([
      api.get('/status'),
      api.get('/analytics/emotion'),
      api.get('/analytics/topics'),
      api.get('/analytics/conversation'),
    ]);

    /* 卸载守卫:await 期间用户可能已离开 */
    if (!container.isConnected) return;

    const status = statusR.status === 'fulfilled' ? statusR.value : null;
    const emotion = emotionR.status === 'fulfilled' ? emotionR.value : null;
    const topics = topicsR.status === 'fulfilled' ? topicsR.value : null;
    const conv = convR.status === 'fulfilled' ? convR.value : null;

    container.innerHTML = '';

    /* 全失败 → 整页空态 */
    if (!status && !emotion && !topics && !conv) {
      container.appendChild(this.buildEmptyState());
      return;
    }

    const rel = status && status.relationship ? relationshipVM(status.relationship) : null;
    const currentMood = (status && status.emotion && status.emotion.myMood) || null;

    container.appendChild(this.buildRelationshipCard(rel));
    container.appendChild(this.buildEmotionCard((emotion && emotion.dominantMoods) || [], currentMood));
    container.appendChild(this.buildTopicsCard((topics && topics.topics) || []));
    container.appendChild(this.buildStatsCard(conv));
  }

  /* ═══ 关系卡 ═══ */
  buildRelationshipCard(rel) {
    if (!rel) {
      return this.card('关系', this.placeholder('关系还在慢慢升温'));
    }

    const top = el('div', { className: 'ana-rel-top' }, [
      el('span', { className: 'ana-rel-stage', textContent: rel.label }),
      el('span', { className: 'ana-rel-count', textContent: `聊了 ${rel.count} 次` }),
    ]);

    const track = el('div', { className: 'progress' });
    track.appendChild(el('i', { style: { width: Math.round(rel.progress * 100) + '%' } }));

    const next = el('div', {
      className: 'ana-rel-next',
      textContent: rel.nextStage ? `下一阶段 · ${rel.nextStage}` : '已是最亲密的关系',
    });

    return this.card('关系', [top, track, next]);
  }

  /* ═══ 心情卡 ═══ */
  buildEmotionCard(dominantMoods, currentMood) {
    const moods = Array.isArray(dominantMoods) ? dominantMoods : [];
    const headMood = (moods[0] && moods[0].mood) || currentMood;

    if (!headMood && moods.length === 0) {
      return this.card('心情', this.placeholder('暂无心情记录'));
    }

    const body = [];

    if (headMood) {
      const info = getMoodInfo(headMood);
      body.push(el('div', { className: 'ana-mood-head' }, [
        el('span', { className: 'ana-mood-emoji', 'aria-hidden': 'true', textContent: info.emoji }),
        el('div', {}, [
          el('div', { className: 'ana-mood-label', textContent: info.label }),
          el('div', {
            className: 'ana-mood-sub',
            textContent: moods.length ? '最常出现的心情' : '此刻的心情',
          }),
        ]),
      ]));
    }

    if (moods.length) {
      const max = moods[0].count || 1;
      const dist = el('div', { className: 'ana-mood-dist' });
      moods.slice(0, 5).forEach((d, i) => {
        const info = getMoodInfo(d.mood);
        const pct = Math.max(4, Math.round(((d.count || 0) / max) * 100));
        const bar = el('div', { className: 'ana-bar' });
        bar.appendChild(el('i', { style: { width: pct + '%', background: moodToken(d.mood, i) } }));
        dist.appendChild(el('div', { className: 'ana-mood-row' }, [
          el('span', { className: 'ana-mood-row-name', textContent: info.label }),
          bar,
          el('span', { className: 'ana-mood-row-count', textContent: String(d.count || 0) }),
        ]));
      });
      body.push(dist);
    }

    return this.card('心情', body);
  }

  /* ═══ 话题卡 ═══ */
  buildTopicsCard(topics) {
    const list = Array.isArray(topics) ? topics : [];
    if (list.length === 0) {
      return this.card('聊得最多', this.placeholder('还没有聊出话题'));
    }

    const ul = el('div', { className: 'ana-list' });
    list.slice(0, 6).forEach((t) => {
      ul.appendChild(el('div', { className: 'cell ana-topic' }, [
        el('span', { className: 'ana-topic-name', textContent: t.name || '—' }),
        el('span', { className: 'ana-topic-count', textContent: String(t.count ?? '') }),
      ]));
    });

    return this.card('聊得最多', ul);
  }

  /* ═══ 点滴卡(数字快照) ═══ */
  buildStatsCard(conv) {
    if (!conv) {
      return this.card('点滴', this.placeholder('暂无统计'));
    }

    const items = [
      [conv.totalMessages, '消息'],
      [conv.daysActive, '相伴天数'],
      [conv.totalSessions, '会话'],
      [conv.avgMessagesPerDay, '日均消息'],
    ];

    const grid = el('div', { className: 'ana-stats' });
    items.forEach(([value, label]) => {
      grid.appendChild(el('div', { className: 'ana-stat' }, [
        el('div', { className: 'ana-stat-num', textContent: this.fmtNum(value) }),
        el('div', { className: 'ana-stat-label', textContent: label }),
      ]));
    });

    return this.card('点滴', grid);
  }

  fmtNum(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '0';
    return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
  }

  /* ═══ 通用 ═══ */
  card(title, body) {
    const c = el('div', { className: 'card' });
    c.appendChild(el('div', { className: 'ana-card-title', textContent: title }));
    const wrap = el('div', { className: 'ana-card-body' });
    const nodes = Array.isArray(body) ? body : [body];
    nodes.forEach((n) => { if (n) wrap.appendChild(n); });
    c.appendChild(wrap);
    return c;
  }

  placeholder(text) {
    return el('div', { className: 'ana-empty', textContent: text || '暂无数据' });
  }

  buildEmptyState() {
    return el('div', { className: 'ana-blank' }, [
      el('div', { className: 'ana-blank-title', textContent: '还没有足够的数据' }),
      el('div', { className: 'ana-blank-sub', textContent: '多和 Mio 聊聊,这里会慢慢热闹起来' }),
    ]);
  }

  buildSkeleton() {
    const wrap = el('div', { className: 'ana-skeleton', 'aria-hidden': 'true' });
    for (let i = 0; i < 4; i++) wrap.appendChild(el('div', { className: 'ana-skel-card' }));
    return wrap;
  }
}

/* 兼容 app.js 的 render/mount/unmount 接口 */
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
