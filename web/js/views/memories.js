import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';
import { ICONS } from '../utils/icons.js';

const TYPE_LABELS = {
  fact: '事实',
  preference: '偏好',
  event: '事件',
  decision: '决定',
  intention: '意图',
  emotion: '情绪',
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 清理来源文本:去掉内部 <time=...> 标记与前导分隔符(日期已单独展示),只留可读来源。 */
function formatSource(source) {
  if (!source) return '无来源';
  const cleaned = source
    .replace(/<time=[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·\-]+/, '')
    .trim();
  return cleaned || '无来源';
}

export function memoryStatusLabel(status) {
  if (status === 'disabled') return '已禁用';
  if (status === 'confirmed') return '已确认';
  if (status === 'ignored') return '已忽略';
  if (status === 'wrong') return '已标错';
  return '待确认';
}

export function memoryCardClass(item) {
  return ['memory-card', item.status === 'ignored' || item.status === 'wrong' || item.enabled === false ? 'memory-card--ignored' : '']
    .filter(Boolean)
    .join(' ');
}

export function memoryReviewActions(item) {
  const actions = [];
  if (item.enabled === false) {
    const reviewStatus = item.status === 'ignored' || item.status === 'wrong' ? 'inferred' : item.status;
    actions.push({ kind: 'enable', label: '启用', patch: { enabled: true, reviewStatus } });
    return actions;
  }
  actions.push({ kind: 'disable', label: '禁用', patch: { enabled: false } });
  if (item.status !== 'ignored' && item.status !== 'wrong') {
    actions.push(item.pinned
      ? { kind: 'unpin', label: '取消固定', patch: { pinned: false } }
      : { kind: 'pin', label: '固定', patch: { pinned: true } });
  }
  if (item.status !== 'confirmed') {
    actions.push({ kind: 'confirm', label: '确认', patch: { reviewStatus: 'confirmed' } });
  }
  if (item.status !== 'ignored') {
    actions.push({ kind: 'ignore', label: '忽略', patch: { reviewStatus: 'ignored' } });
  }
  if (item.status !== 'wrong') {
    actions.push({ kind: 'wrong', label: '标错', patch: { reviewStatus: 'wrong' } });
  }
  return actions;
}

export function memoryUsageLabel(usage) {
  if (!usage || usage.retrievedCount <= 0) return '';
  const parts = [];
  if (usage.retrievedInLatestReply) {
    if (usage.mentionedInLatestReply) parts.push('最近回复引用');
    else if (usage.injectedInLatestReply) parts.push('最近进过提示');
    else parts.push('最近检索未用');
  }
  if (usage.injectedCount > 0) parts.push(`进过提示 ${usage.injectedCount} 次`);
  else parts.push(`检索到 ${usage.retrievedCount} 次`);
  if (usage.mentionedCount > 0) parts.push(`回复引用 ${usage.mentionedCount} 次`);
  else if (usage.injectedCount > 0) parts.push('未在回复中引用');
  const last = usage.lastMentionedAt || usage.lastInjectedAt || usage.lastRetrievedAt;
  if (last) parts.push(`最近 ${formatDate(last)}`);
  return parts.join(' · ');
}

export function temporalStatusLabel(status) {
  if (status === 'current') return '当前有效';
  if (status === 'recently_resolved') return '已解决';
  if (status === 'recently_expired') return '已过期';
  return '历史状态';
}

export function temporalResolutionLabel(reason) {
  if (reason === 'user_reopened_chat') return '用户已重新打开聊天';
  if (reason === 'explicit_user_resolution') return '用户明确表示已解决';
  if (reason === 'expired') return '自然过期';
  return '';
}

export function temporalStateCounts(temporalState) {
  return {
    current: temporalState?.current?.length || 0,
    recentlyResolved: temporalState?.recentlyResolved?.length || 0,
    recentlyExpired: temporalState?.recentlyExpired?.length || 0,
  };
}

export function structuredStateCounts(structuredState) {
  return {
    pinned: structuredState?.counts?.pinned ?? structuredState?.pinned?.length ?? 0,
    currentFacts: structuredState?.counts?.currentFacts ?? structuredState?.currentFacts?.length ?? 0,
    multiDayArcs: structuredState?.counts?.multiDayArcs ?? structuredState?.multiDayArcs?.length ?? 0,
    recentEvents: structuredState?.counts?.recentEvents ?? structuredState?.recentEvents?.length ?? 0,
    recentEmotions: structuredState?.counts?.recentEmotions ?? structuredState?.recentEmotions?.length ?? 0,
    superseded: structuredState?.counts?.superseded ?? structuredState?.superseded?.length ?? 0,
  };
}

export function structuredStateSummary(structuredState) {
  const counts = structuredStateCounts(structuredState);
  const total = counts.pinned + counts.currentFacts + counts.multiDayArcs + counts.recentEvents + counts.recentEmotions + counts.superseded;
  if (total <= 0) return '';
  return `固定 ${counts.pinned} · 当前事实 ${counts.currentFacts} · 多日线索 ${counts.multiDayArcs} · 近期事件 ${counts.recentEvents} · 近期情绪 ${counts.recentEmotions} · 已取代 ${counts.superseded}`;
}

export function structuredStateSectionLabel(kind) {
  if (kind === 'pinned') return '固定';
  if (kind === 'currentFacts') return '当前事实';
  if (kind === 'multiDayArcs') return '多日线索';
  if (kind === 'recentEvents') return '近期事件';
  if (kind === 'recentEmotions') return '近期情绪';
  if (kind === 'superseded') return '已取代';
  return kind || '状态';
}

export function structuredStateEntityActions(item) {
  if (!item?.id) return [];
  return memoryReviewActions(item);
}

export function proactiveDecisionOutcomeLabel(outcome) {
  if (outcome === 'sent') return '已发送';
  if (outcome === 'skipped') return '已跳过';
  if (outcome === 'rejected') return '已拒绝';
  return outcome || '未知';
}

export function proactiveDecisionPhaseLabel(phase) {
  if (phase === 'permission') return '阶段权限';
  if (phase === 'temporal') return '时间/边界';
  if (phase === 'smart_gate') return '智能调度';
  if (phase === 'generation') return '生成决策';
  if (phase === 'quality_gate') return '质量门';
  if (phase === 'dispatch') return '投递';
  return phase || '决策';
}

export function proactiveDecisionSummary(proactiveDecisions) {
  const decisions = proactiveDecisions?.decisions || [];
  if (decisions.length <= 0) return '';
  const counts = proactiveDecisions?.counts || {};
  return `发送 ${counts.sent || 0} · 跳过 ${counts.skipped || 0} · 拒绝 ${counts.rejected || 0}`;
}

export function memoryDebugCounts(debugTrace) {
  return {
    retrieved: debugTrace?.memory?.retrievedCount || 0,
    injected: debugTrace?.memory?.injectedCount || 0,
    mentioned: debugTrace?.memory?.mentionedCount || 0,
    interventions: debugTrace?.interventions?.length || 0,
  };
}

export function memoryDebugSummary(debugTrace) {
  const counts = memoryDebugCounts(debugTrace);
  if (counts.retrieved <= 0 && counts.interventions <= 0) return '';
  const parts = [];
  if (counts.retrieved > 0) parts.push(`检索 ${counts.retrieved}`);
  if (counts.injected > 0) parts.push(`进提示 ${counts.injected}`);
  if (counts.mentioned > 0) parts.push(`回复引用 ${counts.mentioned}`);
  if (counts.interventions > 0) parts.push(`干预 ${counts.interventions}`);
  return parts.join(' · ');
}

export function buildDebugCandidateRequest(debugTrace, sessionId, note = '') {
  if (!memoryDebugSummary(debugTrace)) return null;
  const resolvedSessionId = sessionId || debugTrace?.sessionId || debugTrace?.memory?.sessionId;
  return {
    ...(resolvedSessionId ? { sessionId: resolvedSessionId } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  };
}

export function buildRegressionPromotionRequest(exportResult, note = '') {
  const candidate = exportResult?.candidate;
  const candidatesPath = exportResult?.candidatesPath;
  if (!candidate?.id || !candidatesPath) return null;
  return {
    candidatesPath,
    ids: [candidate.id],
    reviewer: 'memory-ui',
    ...(note.trim() ? { note: note.trim() } : {}),
  };
}

const REGRESSION_TAXONOMY_LABELS = {
  temporal_drift: '时间状态',
  current_fact_conflict: '当前事实',
  bad_proactive_or_reopened_chat_blame: '等待/冷落',
  proactive_curiosity_hook: '主动钩子',
  identity_or_model_leak: '身份泄露',
  internal_context_leak: '内部状态',
  unsupported_offline_life: '虚构生活',
  coercive_or_interrogative_possessiveness: '控制/盘问',
  service_or_checklist_tone: '客服腔',
  persona_coherence: '人格一致',
  persona_judge_repair: '人格修复',
  reply_logic_or_human_likeness: '逻辑/人味',
};

export function regressionTaxonomyLabel(taxonomy) {
  return REGRESSION_TAXONOMY_LABELS[taxonomy] || taxonomy || '未分类';
}

export function regressionLibrarySummary(library) {
  const total = library?.total || 0;
  if (total <= 0) return '';
  const enabledTotal = typeof library?.enabledTotal === 'number' ? library.enabledTotal : total;
  const latest = library?.candidates?.[0];
  const latestLabel = latest ? regressionTaxonomyLabel(latest.taxonomy) : '';
  const base = `永久回归 ${enabledTotal}/${total}`;
  return latestLabel ? `${base} · 最近 ${latestLabel}` : base;
}

export function regressionCandidateActions(candidate) {
  if (candidate?.enabled === false) {
    return [{ kind: 'enable', label: '启用', patch: { enabled: true } }];
  }
  return [{ kind: 'disable', label: '禁用', patch: { enabled: false } }];
}

export class MemoriesView extends BaseView {
  constructor(params) {
    super(params);
    this.listEl = null;
    this.searchInput = null;
    this.searchResultsEl = null;
    this.items = [];
    this.searchResults = [];
    this.temporalState = null;
    this.structuredState = null;
    this.proactiveDecisions = null;
    this.debugTrace = null;
    this.regressionLibrary = null;
  }

  render() {
    this.el = el('div', { className: 'memories-view' });

    const header = el('header', { className: 'memories-header' }, [
      el('button', {
        className: 'memories-close tap',
        type: 'button',
        'aria-label': '返回控制台',
        onClick: () => navigate('/console'),
      }, ICONS.back(20)),
      el('div', { className: 'memories-title-block' }, [
        el('h1', { className: 'memories-title', textContent: '记忆' }),
        el('p', { className: 'memories-subtitle', textContent: '查看、修正或删除 Mio 已保存的长期上下文。' }),
      ]),
    ]);

    const search = el('form', { className: 'memories-search' }, [
      el('span', { className: 'memories-search-icon' }, ICONS.search(18)),
    ]);
    this.searchInput = el('input', {
      type: 'search',
      name: 'memory-search',
      placeholder: '搜索旧对话或记忆',
      'aria-label': '搜索旧对话或记忆',
    });
    const searchBtn = el('button', { type: 'submit', textContent: '搜索' });
    search.appendChild(this.searchInput);
    search.appendChild(searchBtn);

    this.listEl = el('div', { className: 'memories-list' });
    this.searchResultsEl = el('div', { className: 'memories-search-results' });

    this.el.appendChild(header);
    this.el.appendChild(search);
    this.el.appendChild(this.searchResultsEl);
    this.el.appendChild(this.listEl);

    this.on(search, 'submit', (event) => {
      event.preventDefault();
      this.load(this.searchInput.value.trim());
    });

    return this.el;
  }

  mount() {
    this.load();
  }

  async load(query = '') {
    this.renderLoading();
    try {
      const params = new URLSearchParams({ limit: query ? '50' : '100' });
      if (query) params.set('q', query);
      const sessionId = Store.get('sessionId');
      if (sessionId) params.set('sessionId', sessionId);
      const suffix = `?${params.toString()}`;
      const [data, transcriptData, regressionData] = await Promise.all([
        api.get('/memories' + suffix),
        query
          ? api.get(`/search?q=${encodeURIComponent(query)}&limit=20`).catch(() => null)
          : Promise.resolve(null),
        api.get('/memories/regression-candidates?limit=5').catch(() => null),
      ]);
      this.items = data?.items || [];
      this.temporalState = data?.temporalState || null;
      this.structuredState = data?.structuredState || null;
      this.proactiveDecisions = data?.proactiveDecisions || null;
      this.debugTrace = data?.debugTrace || null;
      this.regressionLibrary = regressionData || null;
      const memoryResults = (data?.searchResults || []).map((item) => ({
        ...item,
        resultKind: 'memory',
      }));
      const transcriptResults = (transcriptData?.results || []).map((item) => ({
        title: item.sessionId ? `旧对话 · ${formatDate(item.timestamp) || item.sessionId}` : '旧对话',
        snippet: item.snippet || item.content || '',
        source: item.sessionId,
        resultKind: 'transcript',
      }));
      this.searchResults = [...memoryResults, ...transcriptResults];
      this.renderSearchResults(query);
      this.renderItems();
    } catch {
      this.renderError();
    }
  }

  renderLoading() {
    this.searchResultsEl.innerHTML = '';
    this.listEl.innerHTML = '';
    this.listEl.appendChild(el('div', { className: 'memories-state', textContent: '正在读取记忆…' }));
  }

  renderError() {
    this.searchResultsEl.innerHTML = '';
    this.listEl.innerHTML = '';
    this.listEl.appendChild(el('div', { className: 'memories-state', textContent: '记忆读取失败。' }));
  }

  renderSearchResults(query) {
    this.searchResultsEl.innerHTML = '';
    if (!query) return;

    const title = el('div', { className: 'memories-section-label', textContent: '搜索结果' });
    this.searchResultsEl.appendChild(title);

    if (!this.searchResults.length) {
      this.searchResultsEl.appendChild(el('div', { className: 'memories-state memories-state--compact', textContent: '没有匹配的旧内容。' }));
      return;
    }

    const group = el('div', { className: 'memories-result-card' });
    this.searchResults.slice(0, 10).forEach((result) => {
      group.appendChild(el('div', { className: 'memory-result' }, [
        el('div', { className: 'memory-result-title', textContent: result.title || result.source || (result.resultKind === 'transcript' ? '旧对话' : '旧内容') }),
        el('div', { className: 'memory-result-snippet', textContent: result.snippet || result.text || result.content || '' }),
      ]));
    });
    this.searchResultsEl.appendChild(group);
  }

  renderItems() {
    this.listEl.innerHTML = '';

    if (!this.items.length) {
      this.listEl.appendChild(this.temporalStatePanel());
      const structuredPanel = this.structuredStatePanel();
      if (structuredPanel) this.listEl.appendChild(structuredPanel);
      const proactivePanel = this.proactiveDecisionPanel();
      if (proactivePanel) this.listEl.appendChild(proactivePanel);
      const debugPanel = this.debugTracePanel();
      if (debugPanel) this.listEl.appendChild(debugPanel);
      const regressionPanel = this.regressionLibraryPanel();
      if (regressionPanel) this.listEl.appendChild(regressionPanel);
      this.listEl.appendChild(el('div', { className: 'memories-section-label', textContent: '已保存的记忆' }));
      this.listEl.appendChild(el('div', { className: 'memories-state', textContent: '还没有可审查的结构化记忆。继续聊天后，Mio 会把重要内容整理到这里。' }));
      return;
    }

    this.listEl.appendChild(this.temporalStatePanel());
    const structuredPanel = this.structuredStatePanel();
    if (structuredPanel) this.listEl.appendChild(structuredPanel);
    const proactivePanel = this.proactiveDecisionPanel();
    if (proactivePanel) this.listEl.appendChild(proactivePanel);
    const debugPanel = this.debugTracePanel();
    if (debugPanel) this.listEl.appendChild(debugPanel);
    const regressionPanel = this.regressionLibraryPanel();
    if (regressionPanel) this.listEl.appendChild(regressionPanel);
    this.listEl.appendChild(this.memorySummary());
    this.listEl.appendChild(el('div', { className: 'memories-section-label', textContent: '已保存的记忆' }));

    this.items.forEach((item) => {
      this.listEl.appendChild(this.memoryCard(item));
    });
  }

  temporalStatePanel() {
    const counts = temporalStateCounts(this.temporalState);
    const rows = [
      ...(this.temporalState?.current || []),
      ...(this.temporalState?.recentlyResolved || []),
      ...(this.temporalState?.recentlyExpired || []),
    ];
    const body = rows.length > 0
      ? rows.slice(0, 8).map((item) => this.temporalStateRow(item))
      : [el('div', { className: 'memory-temporal-empty', textContent: '当前没有可见的短期状态。' })];

    return el('section', { className: 'memory-temporal', 'aria-label': '短期状态' }, [
      el('div', { className: 'memory-temporal-head' }, [
        el('div', { className: 'memories-section-label', textContent: '短期状态' }),
        el('div', { className: 'memory-temporal-counts', textContent: `当前 ${counts.current} · 已解决 ${counts.recentlyResolved} · 已过期 ${counts.recentlyExpired}` }),
      ]),
      ...body,
    ]);
  }

  structuredStatePanel() {
    const summary = structuredStateSummary(this.structuredState);
    if (!summary) return null;
    const rows = [
      ...this.structuredStateRows('pinned', this.structuredState?.pinned || []),
      ...this.structuredStateRows('currentFacts', this.structuredState?.currentFacts || []),
      ...this.structuredArcRows(this.structuredState?.multiDayArcs || []),
      ...this.structuredStateRows('recentEvents', this.structuredState?.recentEvents || []),
      ...this.structuredStateRows('recentEmotions', this.structuredState?.recentEmotions || []),
      ...this.structuredStateRows('superseded', this.structuredState?.superseded || []),
    ];

    return el('section', { className: 'memory-temporal', 'aria-label': '状态模型' }, [
      el('div', { className: 'memory-temporal-head' }, [
        el('div', { className: 'memories-section-label', textContent: '状态模型' }),
        el('div', { className: 'memory-temporal-counts', textContent: summary }),
      ]),
      el('div', { className: 'memories-result-card memories-result-card--compact' }, rows.slice(0, 12)),
    ]);
  }

  structuredStateRows(kind, items) {
    const label = structuredStateSectionLabel(kind);
    return items.slice(0, 4).map((item) => {
      const source = item.provenance?.excerpt || item.source || '';
      const status = item.invalidatedAt ? '已取代' : item.pinned ? '固定' : memoryStatusLabel(item.enabled === false ? 'disabled' : item.status);
      const actions = (item.invalidatedAt ? [] : structuredStateEntityActions(item)).map((action) => el('button', {
        type: 'button',
        className: `memory-action memory-action--${action.kind} tap`,
        textContent: action.label,
        onClick: () => this.reviewItem(item.id, action.patch),
      }));
      const details = [
        source ? formatSource(source) : '',
        item.supersededBy ? `已由「${item.supersededBy}」取代` : '',
        item.invalidatedAt ? `取代时间 ${formatDate(item.invalidatedAt)}` : '',
      ].filter(Boolean).join(' · ');
      return el('div', { className: 'memory-result' }, [
        el('div', { className: 'memory-result-title', textContent: `${label} · ${TYPE_LABELS[item.type] || item.type} · ${status} · ${formatDate(item.lastSeen)}` }),
        el('div', { className: 'memory-result-snippet', textContent: item.content || '' }),
        details ? el('div', { className: 'memory-details', textContent: details }) : null,
        actions.length > 0 ? el('div', { className: 'memory-actions memory-actions--compact' }, actions) : null,
      ]);
    });
  }

  structuredArcRows(arcs) {
    return arcs.slice(0, 4).map((arc) => {
      const dateRange = [formatDate(arc.dateRange?.start), formatDate(arc.dateRange?.end)].filter(Boolean).join(' 至 ');
      const detail = [`${arc.entityCount || arc.entities?.length || 0} 条`, dateRange].filter(Boolean).join(' · ');
      const evidence = arc.entities?.[0]?.provenance?.excerpt || arc.entities?.[0]?.source || '';
      return el('div', { className: 'memory-result' }, [
        el('div', { className: 'memory-result-title', textContent: `${structuredStateSectionLabel('multiDayArcs')} · ${arc.topic || '未命名'} · ${detail}` }),
        el('div', { className: 'memory-result-snippet', textContent: arc.summary || arc.entities?.map((item) => item.content).join('；') || '' }),
        evidence ? el('div', { className: 'memory-details', textContent: formatSource(evidence) }) : null,
      ]);
    });
  }

  proactiveDecisionPanel() {
    const summary = proactiveDecisionSummary(this.proactiveDecisions);
    if (!summary) return null;
    const rows = (this.proactiveDecisions?.decisions || []).slice(0, 8).map((item) => {
      const title = `${proactiveDecisionOutcomeLabel(item.outcome)} · ${proactiveDecisionPhaseLabel(item.phase)} · ${item.type || ''} · ${formatDate(item.timestamp)}`;
      const details = [
        item.reasonCode,
        item.stage,
        item.routeTags?.join(', '),
      ].filter(Boolean).join(' · ');
      return el('div', { className: 'memory-result' }, [
        el('div', { className: 'memory-result-title', textContent: title }),
        el('div', { className: 'memory-result-snippet', textContent: item.messagePreview || item.reason || '' }),
        details ? el('div', { className: 'memory-details', textContent: details }) : null,
      ]);
    });

    return el('section', { className: 'memory-temporal', 'aria-label': '主动消息决策' }, [
      el('div', { className: 'memory-temporal-head' }, [
        el('div', { className: 'memories-section-label', textContent: '主动消息决策' }),
        el('div', { className: 'memory-temporal-counts', textContent: summary }),
      ]),
      el('div', { className: 'memories-result-card memories-result-card--compact' }, rows),
    ]);
  }

  debugTracePanel() {
    const summary = memoryDebugSummary(this.debugTrace);
    if (!summary) return null;
    const memory = this.debugTrace?.memory;
    const used = memory?.used || [];
    const unused = memory?.unused || [];
    const interventions = this.debugTrace?.interventions || [];
    const rows = [
      ...(memory ? [el('div', { className: 'memory-result' }, [
        el('div', { className: 'memory-result-title', textContent: '最近一轮' }),
        el('div', { className: 'memory-result-snippet', textContent: `${trimForDebug(memory.userText)} → ${trimForDebug(memory.replyText)}` }),
      ])] : []),
      ...used.slice(0, 4).map((item) => el('div', { className: 'memory-result' }, [
        el('div', { className: 'memory-result-title', textContent: `使用 · ${item.source || item.kind}` }),
        el('div', { className: 'memory-result-snippet', textContent: item.provenance?.excerpt || item.content }),
      ])),
      ...unused.slice(0, 4).map((item) => el('div', { className: 'memory-result' }, [
        el('div', { className: 'memory-result-title', textContent: `检索未用 · ${item.source || item.kind}` }),
        el('div', { className: 'memory-result-snippet', textContent: item.provenance?.excerpt || item.content }),
      ])),
      ...interventions.slice(0, 4).map((item) => el('div', { className: 'memory-result' }, [
        el('div', { className: 'memory-result-title', textContent: `输出干预 · ${item.type || item.severity || ''}` }),
        el('div', { className: 'memory-result-snippet', textContent: item.reason || `${trimForDebug(item.before)} → ${trimForDebug(item.after)}` }),
      ])),
    ];
    const exportButton = el('button', {
      type: 'button',
      className: 'memory-action memory-action--debug tap',
      textContent: '生成回归候选',
      onClick: () => this.exportDebugTraceCandidate(),
    });

    return el('section', { className: 'memory-temporal', 'aria-label': '最近回复依据' }, [
      el('div', { className: 'memory-temporal-head' }, [
        el('div', { className: 'memories-section-label', textContent: '最近回复依据' }),
        el('div', { className: 'memory-debug-head-actions' }, [
          el('div', { className: 'memory-temporal-counts', textContent: summary }),
          exportButton,
        ]),
      ]),
      el('div', { className: 'memories-result-card' }, rows),
    ]);
  }

  regressionLibraryPanel() {
    const summary = regressionLibrarySummary(this.regressionLibrary);
    if (!summary) return null;
    const candidates = this.regressionLibrary?.candidates || [];
    const rows = candidates.slice(0, 5).map((item) => {
      const status = item.enabled === false ? '已禁用' : '启用中';
      const actions = regressionCandidateActions(item).map((action) => el('button', {
        type: 'button',
        className: `memory-action memory-action--${action.kind} tap`,
        textContent: action.label,
        onClick: () => this.patchRegressionCandidate(item.id, action.patch),
      }));
      return el('div', { className: `memory-result ${item.enabled === false ? 'memory-result--disabled' : ''}` }, [
        el('div', { className: 'memory-result-title', textContent: `${regressionTaxonomyLabel(item.taxonomy)} · ${status} · ${formatDate(item.reviewedAt || item.observedAt)}` }),
        el('div', { className: 'memory-result-snippet', textContent: item.note || item.reason || item.excerpt || item.id }),
        el('div', { className: 'memory-details', textContent: `${item.id} · ${item.routeTags?.join(', ') || '无 route tag'} · checks ${item.checkCount || 0}` }),
        el('div', { className: 'memory-actions memory-actions--compact' }, actions),
      ]);
    });

    return el('section', { className: 'memory-temporal', 'aria-label': '永久回归库' }, [
      el('div', { className: 'memory-temporal-head' }, [
        el('div', { className: 'memories-section-label', textContent: '永久回归库' }),
        el('div', { className: 'memory-temporal-counts', textContent: summary }),
      ]),
      el('div', { className: 'memories-result-card memories-result-card--compact' }, rows),
    ]);
  }

  async patchRegressionCandidate(id, patch) {
    try {
      await api.patch(`/memories/regression-candidates/${encodeURIComponent(id)}`, {
        ...patch,
        reviewer: 'memory-ui',
      });
      toast(patch.enabled === false ? '回归用例已禁用' : '回归用例已启用', 'success');
      await this.load(this.searchInput.value.trim());
    } catch (err) {
      const message = err?.status === 403 ? '需要所有者权限' : '回归用例更新失败';
      toast(message, 'error');
    }
  }

  temporalStateRow(item) {
    const resolution = temporalResolutionLabel(item.resolutionReason);
    const detailParts = [
      temporalStatusLabel(item.status),
      formatDate(item.observedAt),
      `置信度 ${Math.round((item.confidence || 0) * 100)}%`,
      resolution,
    ].filter(Boolean);
    return el('div', { className: `memory-temporal-row memory-temporal-row--${item.status}` }, [
      el('div', { className: 'memory-temporal-meta' }, [
        el('span', { className: 'memory-type', textContent: item.label || item.kind }),
        el('span', { className: `memory-status memory-status--temporal-${item.status}`, textContent: temporalStatusLabel(item.status) }),
      ]),
      el('div', { className: 'memory-temporal-evidence', textContent: item.evidence || '' }),
      el('div', { className: 'memory-details', textContent: detailParts.join(' · ') }),
    ]);
  }

  memorySummary() {
    const counts = this.items.reduce((acc, item) => {
      const status = item.status || 'inferred';
      acc.total += 1;
      if (item.pinned && item.enabled !== false && status !== 'ignored' && status !== 'wrong') acc.pinned += 1;
      acc[status] = (acc[status] || 0) + 1;
      if (item.enabled === false && status !== 'ignored' && status !== 'wrong') {
        acc.disabled += 1;
      }
      return acc;
    }, { total: 0, confirmed: 0, ignored: 0, wrong: 0, inferred: 0, disabled: 0, pinned: 0 });
    const pending = counts.inferred;

    return el('div', { className: 'memories-summary', 'aria-label': '记忆审查概览' }, [
      this.summaryItem('全部', counts.total),
      this.summaryItem('待确认', pending),
      this.summaryItem('已确认', counts.confirmed),
      this.summaryItem('已固定', counts.pinned),
      this.summaryItem('已忽略', counts.ignored),
      this.summaryItem('已标错', counts.wrong),
      this.summaryItem('已禁用', counts.disabled),
    ]);
  }

  summaryItem(label, value) {
    return el('div', { className: 'memories-summary-item' }, [
      el('span', { className: 'memories-summary-value', textContent: String(value) }),
      el('span', { className: 'memories-summary-label', textContent: label }),
    ]);
  }

  memoryCard(item) {
    const card = el('article', { className: memoryCardClass(item), dataset: { id: item.id } });
    const meta = el('div', { className: 'memory-meta' }, [
      el('span', { className: 'memory-type', textContent: TYPE_LABELS[item.type] || item.type }),
      el('span', { className: `memory-status memory-status--${displayMemoryStatus(item)}`, textContent: memoryStatusLabel(displayMemoryStatus(item)) }),
      item.pinned ? el('span', { className: 'memory-topic', textContent: '固定' }) : null,
      item.topic ? el('span', { className: 'memory-topic', textContent: item.topic }) : null,
    ]);

    const content = el('div', { className: 'memory-content', textContent: item.content });
    const source = item.provenance?.excerpt || item.source;
    const details = el('div', { className: 'memory-details', textContent: `${formatDate(item.lastSeen)} · 置信度 ${Math.round(item.confidence * 100)}% · ${formatSource(source)}` });
    const usageLabel = memoryUsageLabel(item.usage);
    const usage = usageLabel ? el('div', { className: 'memory-details memory-usage', textContent: usageLabel }) : null;

    const reviewButtons = memoryReviewActions(item).map((action) => el('button', {
      type: 'button',
      className: `memory-action memory-action--${action.kind} tap`,
      textContent: action.label,
      onClick: () => this.reviewItem(item.id, action.patch),
    }));

    const actions = el('div', { className: 'memory-actions' }, [
      ...reviewButtons,
      el('button', { type: 'button', className: 'memory-action tap', textContent: '编辑', onClick: () => this.startEdit(card, item) }),
      el('button', { type: 'button', className: 'memory-action memory-action--danger tap', textContent: '删除', onClick: () => this.deleteItem(item.id) }),
    ]);

    card.appendChild(meta);
    card.appendChild(content);
    card.appendChild(details);
    if (usage) card.appendChild(usage);
    card.appendChild(actions);
    return card;
  }

  startEdit(card, item) {
    card.innerHTML = '';
    const textarea = el('textarea', { className: 'memory-edit-text', rows: '3' });
    textarea.value = item.content;

    const typeSelect = el('select', { className: 'memory-edit-type', name: 'memory-type', 'aria-label': '记忆类型' });
    Object.entries(TYPE_LABELS).forEach(([value, label]) => {
      const option = el('option', { value, textContent: label });
      if (value === item.type) option.selected = true;
      typeSelect.appendChild(option);
    });

    const actions = el('div', { className: 'memory-actions' }, [
      el('button', { type: 'button', className: 'memory-action tap', textContent: '取消', onClick: () => this.renderItems() }),
      el('button', {
        type: 'button',
        className: 'memory-action memory-action--primary tap',
        textContent: '保存',
        onClick: () => this.saveItem(item.id, {
          content: textarea.value.trim(),
          type: typeSelect.value,
        }),
      }),
    ]);

    card.appendChild(typeSelect);
    card.appendChild(textarea);
    card.appendChild(actions);
    textarea.focus();
  }

  async saveItem(id, patch) {
    if (!patch.content) {
      toast('记忆内容不能为空', 'error');
      return;
    }
    try {
      await api.patch(`/memories/${id}`, patch);
      toast('记忆已更新', 'success');
      await this.load(this.searchInput.value.trim());
    } catch {
      toast('保存失败', 'error');
    }
  }

  async reviewItem(id, patch) {
    try {
      await api.patch(`/memories/${id}`, patch);
      toast(memoryActionToast(patch), 'success');
      await this.load(this.searchInput.value.trim());
    } catch {
      toast('操作失败', 'error');
    }
  }

  async deleteItem(id) {
    if (!window.confirm('删除这条记忆？这个操作会从结构化记忆中移除它。')) return;
    try {
      await api.del(`/memories/${id}`);
      toast('记忆已删除', 'success');
      await this.load(this.searchInput.value.trim());
    } catch {
      toast('删除失败', 'error');
    }
  }

  async exportDebugTraceCandidate() {
    const defaultNote = '最近这句回复看起来不自然';
    const note = typeof window.prompt === 'function'
      ? window.prompt('给这个回归候选写一句备注', defaultNote)
      : defaultNote;
    if (note === null) return;

    const request = buildDebugCandidateRequest(this.debugTrace, Store.get('sessionId'), note || '');
    if (!request) {
      toast('没有可导出的最近回复依据', 'error');
      return;
    }

    try {
      const result = await api.post('/memories/debug-trace/regression-candidate', request);
      const reportPath = result?.reportPath ? ` · ${result.reportPath}` : '';
      toast(`回归候选已生成${reportPath}`, 'success', 6000);
      await this.maybePromoteDebugTraceCandidate(result, note || '');
    } catch (err) {
      const message = err?.status === 403 ? '需要所有者权限' : '生成回归候选失败';
      toast(message, 'error');
    }
  }

  async maybePromoteDebugTraceCandidate(exportResult, note) {
    if (typeof window.confirm !== 'function') return;
    if (!window.confirm('加入永久回归库？以后自动测试会回放这个问题。')) return;
    const request = buildRegressionPromotionRequest(exportResult, note);
    if (!request) {
      toast('候选信息不完整，无法加入回归库', 'error');
      return;
    }

    try {
      const result = await api.post('/memories/debug-trace/regression-candidate/promote', request);
      toast(`已加入永久回归库 · 共 ${result?.total ?? 0} 条`, 'success', 5000);
      await this.load(this.searchInput.value.trim());
    } catch (err) {
      const message = err?.status === 403 ? '需要所有者权限' : '加入回归库失败';
      toast(message, 'error');
    }
  }
}

function memoryActionToast(patch) {
  if (patch.pinned === true) return '记忆已固定';
  if (patch.pinned === false) return '已取消固定';
  if (patch.enabled === false) return '记忆已禁用';
  if (patch.enabled === true) return '记忆已启用';
  if (patch.reviewStatus === 'ignored') return '记忆已忽略';
  if (patch.reviewStatus === 'wrong') return '记忆已标错';
  return '记忆已确认';
}

function displayMemoryStatus(item) {
  const status = item.status || 'inferred';
  if (status === 'ignored' || status === 'wrong') return status;
  return item.enabled === false ? 'disabled' : status;
}

function trimForDebug(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

let memoriesViewInstance = null;

export function renderMemories(params) {
  memoriesViewInstance = new MemoriesView(params);
  return memoriesViewInstance.render();
}

export function mountMemories() {
  if (memoriesViewInstance) memoriesViewInstance.mount();
}

export function unmountMemories() {
  if (memoriesViewInstance) {
    memoriesViewInstance.unmount();
    memoriesViewInstance = null;
  }
}
