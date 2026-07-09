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
import { getMoodInfo, STAGE_LABELS } from '../utils/constants.js';
import { relationshipVM } from '../liveness.js';
import { renderEmpty } from '../components/empty-state.js';

/** 心情 → 设计系统心情色 token(零新配色;未命中按序轮转,保证每条都有色) */
const MOOD_TOKENS = ['var(--mood-joy)', 'var(--mood-tender)', 'var(--mood-calm)', 'var(--mood-miss)'];
const STAGE_FLOW = ['acquaintance', 'familiar', 'ambiguous', 'intimate'];

function moodToken(mood, i) {
  const m = (mood || '').toLowerCase();
  const has = (...keys) => keys.some((k) => m.includes(k));
  if (has('开心', '高兴', '兴奋', '喜', 'happy', 'excited', 'joy')) return 'var(--mood-joy)';
  if (has('温柔', '爱', '害羞', '心疼', '甜', 'tender', 'love', 'shy')) return 'var(--mood-tender)';
  if (has('平静', '日常', '放松', '困', '疲', 'calm', 'peace', 'tired', 'sleep')) return 'var(--mood-calm)';
  if (has('难过', '孤', '想', '念', '担心', '失落', 'sad', 'lonely', 'miss', 'worried')) return 'var(--mood-miss)';
  return MOOD_TOKENS[i % MOOD_TOKENS.length];
}

function compactCount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  if (typeof value !== 'number') return String(value);
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(1);
}

export class AnalyticsView extends BaseView {
  constructor(params) {
    super(params);
    this.backBtn = null;
    this.content = null;
    this.syncPill = null;
  }

  render() {
    this.el = el('div', { className: 'analytics-view' });

    /* 顶栏 */
    const header = el('header', { className: 'ana-header' });
    this.backBtn = el('button', { className: 'ana-back tap', 'aria-label': '返回控制台' });
    this.backBtn.appendChild(ICONS.back());
    header.appendChild(this.backBtn);
    header.appendChild(el('div', { className: 'ana-title-block' }, [
      el('h1', { className: 'ana-title', textContent: '数据与观察' }),
      el('div', { className: 'ana-subtitle', textContent: '关系、情绪、话题和会话统计' }),
    ]));
    this.syncPill = el('span', { className: 'ana-sync-pill', textContent: '读取中' });
    header.appendChild(this.syncPill);
    this.el.appendChild(header);

    /* 滚动内容 */
    this.content = el('div', { className: 'ana-content', role: 'region', 'aria-label': '数据概览' });
    this.el.appendChild(this.content);

    return this.el;
  }

  mount() {
    this.on(this.backBtn, 'click', () => navigate('/console'));
    this.loadAnalytics();
  }

  /** 并行拉取,各接口独立 best-effort;视图卸载后中止渲染 */
  async loadAnalytics() {
    const container = this.content;
    if (!container) return;

    container.innerHTML = '';
    container.appendChild(this.buildSkeleton());

    const [status, emotion, topics, conv] = await Promise.all([
      this.optionalGet('/status'),
      this.optionalGet('/analytics/emotion'),
      this.optionalGet('/analytics/topics'),
      this.optionalGet('/analytics/conversation'),
    ]);

    /* 卸载守卫:await 期间用户可能已离开 */
    if (!container.isConnected) return;

    container.innerHTML = '';

    /* 全失败 → 整页空态 */
    if (!status && !emotion && !topics && !conv) {
      if (this.syncPill) {
        this.syncPill.textContent = '不可用';
        this.syncPill.classList.remove('is-ready');
      }
      container.appendChild(this.buildEmptyState());
      return;
    }

    const rel = status && status.relationship ? relationshipVM(status.relationship) : null;
    const currentMood = (status && status.emotion && status.emotion.myMood) || null;
    const moodRows = (emotion && emotion.dominantMoods) || [];
    const topicRows = (topics && topics.topics) || [];
    const sourceCount = [status, emotion, topics, conv].filter(Boolean).length;

    if (this.syncPill) {
      this.syncPill.textContent = `${sourceCount}/4 已读取`;
      this.syncPill.classList.toggle('is-ready', sourceCount > 0);
    }

    container.appendChild(this.buildOverview({ rel, moods: moodRows, topics: topicRows, conv, currentMood }));

    const primaryGrid = el('div', { className: 'ana-grid ana-grid--primary' }, [
      this.buildRelationshipCard(rel),
      this.buildEmotionCard(moodRows, currentMood, (emotion && emotion.affectionCurve) || []),
    ]);
    const secondaryGrid = el('div', { className: 'ana-grid ana-grid--secondary' }, [
      this.buildTopicsCard(topicRows),
      this.buildStatsCard(conv),
    ]);

    container.appendChild(primaryGrid);
    container.appendChild(secondaryGrid);
  }

  async optionalGet(path) {
    try {
      return await api.get(path, { timeout: 6000 });
    } catch {
      return null;
    }
  }

  /* ═══ 关系卡 ═══ */
  buildRelationshipCard(rel) {
    if (!rel) {
      return this.card('关系阶段', this.placeholder('关系还在慢慢升温'), { className: 'ana-card--relationship' });
    }

    const pct = Math.round(rel.progress * 100);
    const top = el('div', { className: 'ana-rel-top' }, [
      el('div', {}, [
        el('span', { className: 'ana-rel-caption', textContent: '当前阶段' }),
        el('span', { className: 'ana-rel-stage', textContent: rel.label }),
      ]),
      el('span', { className: 'ana-rel-count', textContent: `${rel.count} 次互动` }),
    ]);

    const track = el('div', {
      className: 'progress ana-rel-progress',
      role: 'progressbar',
      'aria-label': '关系进度',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(pct),
    });
    track.appendChild(el('i', { style: { width: pct + '%' } }));

    const next = el('div', {
      className: 'ana-rel-next',
      textContent: rel.nextStage ? `下一阶段 ${rel.nextStage}` : '已是最亲密的关系',
    });

    return this.card('关系阶段', [top, track, this.buildStageRail(rel), next], { className: 'ana-card--relationship' });
  }

  /* ═══ 心情卡 ═══ */
  buildEmotionCard(dominantMoods, currentMood, affectionCurve = []) {
    const moods = Array.isArray(dominantMoods) ? dominantMoods : [];
    const headMood = (moods[0] && moods[0].mood) || currentMood;

    if (!headMood && moods.length === 0) {
      return this.card('心情分布', this.placeholder('暂无心情记录'), { className: 'ana-card--emotion' });
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
            textContent: moods.length ? '近段时间最常出现' : '此刻的心情',
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

    const curve = this.buildAffectionCurve(affectionCurve);
    if (curve) body.push(curve);

    return this.card('心情分布', body, { className: 'ana-card--emotion' });
  }

  /* ═══ 话题卡 ═══ */
  buildTopicsCard(topics) {
    const list = Array.isArray(topics) ? topics : [];
    if (list.length === 0) {
      return this.card('高频话题', this.placeholder('还没有聊出话题'), { className: 'ana-card--topics' });
    }

    const max = Math.max(1, ...list.map((t) => Number(t.count) || 0));
    const ul = el('div', { className: 'ana-list' });
    list.slice(0, 6).forEach((t, i) => {
      const pct = Math.max(6, Math.round(((Number(t.count) || 0) / max) * 100));
      ul.appendChild(el('div', { className: 'ana-topic' }, [
        el('span', { className: 'ana-topic-rank', textContent: String(i + 1).padStart(2, '0') }),
        el('div', { className: 'ana-topic-main' }, [
          el('div', { className: 'ana-topic-line' }, [
            el('span', { className: 'ana-topic-name', textContent: t.name || '—' }),
            el('span', { className: 'ana-topic-count', textContent: String(t.count ?? '') }),
          ]),
          el('div', { className: 'ana-topic-bar', 'aria-hidden': 'true' }, [
            el('i', { style: { width: pct + '%' } }),
          ]),
          el('div', { className: 'ana-topic-date', textContent: this.dateLabel(t.lastDiscussed) }),
        ]),
      ]));
    });

    return this.card('高频话题', ul, { className: 'ana-card--topics' });
  }

  /* ═══ 点滴卡(数字快照) ═══ */
  buildStatsCard(conv) {
    if (!conv) {
      return this.card('会话点滴', this.placeholder('暂无统计'), { className: 'ana-card--stats' });
    }

    const items = [
      [conv.totalMessages, '消息', `${compactCount(conv.totalTurns)} 轮对话`],
      [conv.daysActive, '活跃天数', this.dateLabel(conv.lastInteraction)],
      [conv.totalSessions, '会话', 'transcripts'],
      [conv.avgMessagesPerDay, '日均消息', '平均值'],
    ];

    const grid = el('div', { className: 'ana-stats' });
    items.forEach(([value, label, hint]) => {
      grid.appendChild(el('div', { className: 'ana-stat' }, [
        el('div', { className: 'ana-stat-num', textContent: this.fmtNum(value) }),
        el('div', { className: 'ana-stat-label', textContent: label }),
        el('div', { className: 'ana-stat-hint', textContent: hint }),
      ]));
    });

    const timeline = el('div', { className: 'ana-timeband' }, [
      this.timeItem('首次', conv.firstInteraction),
      this.timeItem('最近', conv.lastInteraction),
    ]);

    return this.card('会话点滴', [grid, timeline], { className: 'ana-card--stats' });
  }

  fmtNum(value) {
    return compactCount(value);
  }

  /* ═══ 通用 ═══ */
  card(title, body, options = {}) {
    const c = el('section', { className: `card ana-card ${options.className || ''}`.trim() });
    const head = el('div', { className: 'ana-card-head' }, [
      el('div', { className: 'ana-card-title', textContent: title }),
    ]);
    if (options.meta) head.appendChild(el('span', { className: 'ana-card-meta', textContent: options.meta }));
    c.appendChild(head);
    const wrap = el('div', { className: 'ana-card-body' });
    const nodes = Array.isArray(body) ? body : [body];
    nodes.forEach((n) => { if (n) wrap.appendChild(n); });
    c.appendChild(wrap);
    return c;
  }

  placeholder(text) {
    return el('div', { className: 'ana-empty', textContent: text || '暂无数据' });
  }

  buildOverview({ rel, moods, topics, conv, currentMood }) {
    const mood = (moods[0] && moods[0].mood) || currentMood;
    const moodInfo = getMoodInfo(mood);
    const topTopic = topics[0] && topics[0].name ? topics[0].name : '暂无话题';
    const summary = [
      ['关系', rel ? rel.label : '—', rel ? `${rel.count} 次互动` : '暂无状态'],
      ['心情', mood ? moodInfo.label : '—', moods.length ? '来自情绪历史' : '当前状态'],
      ['话题', String(topics.length || 0), topTopic],
      ['消息', this.fmtNum(conv && conv.totalMessages), conv ? `${this.fmtNum(conv.daysActive)} 天活跃` : '暂无统计'],
    ];

    return el('section', { className: 'ana-overview card' }, [
      el('div', { className: 'ana-overview-copy' }, [
        el('div', { className: 'ana-overview-kicker', textContent: 'Observation' }),
        el('h2', { className: 'ana-overview-title', textContent: '运行观察' }),
        el('p', { className: 'ana-overview-text', textContent: '从真实记录汇总关系、心情、话题和会话密度。' }),
      ]),
      el('div', { className: 'ana-overview-metrics' }, summary.map(([label, value, hint]) =>
        el('div', { className: 'ana-overview-metric' }, [
          el('span', { className: 'ana-overview-label', textContent: label }),
          el('strong', { className: 'ana-overview-value', textContent: value }),
          el('span', { className: 'ana-overview-hint', textContent: hint }),
        ]),
      )),
    ]);
  }

  buildStageRail(rel) {
    const current = Math.max(0, STAGE_FLOW.indexOf(rel.stage));
    return el('div', { className: 'ana-stage-rail', 'aria-label': '关系阶段路径' },
      STAGE_FLOW.map((stage, index) => {
        const state = index < current ? 'is-complete' : index === current ? 'is-current' : 'is-pending';
        return el('span', { className: `ana-stage-step ${state}` }, [
          el('i', { 'aria-hidden': 'true' }),
          el('span', { textContent: STAGE_LABELS[stage] || stage }),
        ]);
      }));
  }

  buildAffectionCurve(curve) {
    const values = Array.isArray(curve)
      ? curve.slice(-14).filter((point) => Number.isFinite(Number(point.value)))
      : [];
    if (values.length < 2) return null;

    return el('div', { className: 'ana-spark-wrap' }, [
      el('div', { className: 'ana-spark-head' }, [
        el('span', { textContent: '亲密度趋势' }),
        el('strong', { textContent: `${Math.round(Number(values[values.length - 1].value))}/100` }),
      ]),
      el('div', { className: 'ana-spark', 'aria-label': '亲密度趋势' },
        values.map((point) => {
          const value = Math.max(0, Math.min(100, Math.round(Number(point.value))));
          return el('span', {
            title: `${point.date || ''} ${value}/100`.trim(),
            style: { height: `${Math.max(8, value)}%` },
          });
        })),
    ]);
  }

  timeItem(label, value) {
    return el('div', { className: 'ana-timeitem' }, [
      el('span', { textContent: label }),
      el('strong', { textContent: this.dateLabel(value, { absolute: true }) }),
    ]);
  }

  dateLabel(value, opts = {}) {
    if (!value) return '未记录';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未记录';
    if (opts.absolute) {
      return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    }
    const diff = Date.now() - date.getTime();
    if (diff >= 0 && diff < 86400000) return '今天';
    const days = Math.floor(diff / 86400000);
    if (days > 0 && days < 7) return `${days} 天前`;
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  }

  buildEmptyState() {
    return renderEmpty({
      icon: ICONS.emptyBook,
      title: '还没有可读取的数据',
      desc: '接口恢复后，这里会显示关系、情绪、话题和会话统计。',
      cta: { label: '刷新', onClick: () => this.load?.() },
      tone: 'mute',
      size: 'lg',
      className: 'ana-blank',
    });
  }

  buildSkeleton() {
    const wrap = el('div', { className: 'ana-skeleton', role: 'status' });
    wrap.appendChild(el('div', { className: 'ana-skeleton-label', textContent: '正在整理数据…' }));
    wrap.appendChild(el('div', { className: 'ana-skel-card ana-skel-card--wide' }));
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
