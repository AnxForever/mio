import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
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
  return '待确认';
}

export function memoryCardClass(item) {
  return ['memory-card', item.status === 'ignored' || item.enabled === false ? 'memory-card--ignored' : '']
    .filter(Boolean)
    .join(' ');
}

export function memoryReviewActions(item) {
  const actions = [];
  if (item.enabled === false) {
    actions.push({ kind: 'enable', label: '启用', patch: { enabled: true, reviewStatus: item.status === 'ignored' ? 'inferred' : item.status } });
    return actions;
  }
  actions.push({ kind: 'disable', label: '禁用', patch: { enabled: false } });
  if (item.status !== 'confirmed') {
    actions.push({ kind: 'confirm', label: '确认', patch: { reviewStatus: 'confirmed' } });
  }
  if (item.status !== 'ignored') {
    actions.push({ kind: 'ignore', label: '忽略', patch: { reviewStatus: 'ignored' } });
  }
  return actions;
}

export function memoryUsageLabel(usage) {
  if (!usage || usage.retrievedCount <= 0) return '';
  const parts = [];
  if (usage.injectedCount > 0) parts.push(`进过提示 ${usage.injectedCount} 次`);
  else parts.push(`检索到 ${usage.retrievedCount} 次`);
  if (usage.mentionedCount > 0) parts.push(`回复引用 ${usage.mentionedCount} 次`);
  else if (usage.injectedCount > 0) parts.push('未在回复中引用');
  const last = usage.lastMentionedAt || usage.lastInjectedAt || usage.lastRetrievedAt;
  if (last) parts.push(`最近 ${formatDate(last)}`);
  return parts.join(' · ');
}

export class MemoriesView extends BaseView {
  constructor(params) {
    super(params);
    this.listEl = null;
    this.searchInput = null;
    this.searchResultsEl = null;
    this.items = [];
    this.searchResults = [];
  }

  render() {
    this.el = el('div', { className: 'memories-view' });

    const header = el('header', { className: 'memories-header' }, [
      el('div', { className: 'memories-title-block' }, [
        el('h1', { className: 'memories-title', textContent: '记忆' }),
        el('p', { className: 'memories-subtitle', textContent: '查看、修正或删除 Mio 已保存的长期上下文。' }),
      ]),
      el('button', {
        className: 'memories-close tap',
        type: 'button',
        'aria-label': '返回聊天',
        onClick: () => navigate('/chat'),
      }, ICONS.back(20)),
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
      const suffix = query ? `?q=${encodeURIComponent(query)}&limit=50` : '?limit=100';
      const [data, transcriptData] = await Promise.all([
        api.get('/memories' + suffix),
        query
          ? api.get(`/search?q=${encodeURIComponent(query)}&limit=20`).catch(() => null)
          : Promise.resolve(null),
      ]);
      this.items = data?.items || [];
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
      this.listEl.appendChild(el('div', { className: 'memories-section-label', textContent: '已保存的记忆' }));
      this.listEl.appendChild(el('div', { className: 'memories-state', textContent: '还没有可审查的结构化记忆。继续聊天后，Mio 会把重要内容整理到这里。' }));
      return;
    }

    this.listEl.appendChild(this.memorySummary());
    this.listEl.appendChild(el('div', { className: 'memories-section-label', textContent: '已保存的记忆' }));

    this.items.forEach((item) => {
      this.listEl.appendChild(this.memoryCard(item));
    });
  }

  memorySummary() {
    const counts = this.items.reduce((acc, item) => {
      const status = item.status || 'inferred';
      acc.total += 1;
      if (item.enabled === false) {
        acc.disabled += 1;
        return acc;
      }
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, { total: 0, confirmed: 0, ignored: 0, inferred: 0, disabled: 0 });
    const pending = counts.inferred;

    return el('div', { className: 'memories-summary', 'aria-label': '记忆审查概览' }, [
      this.summaryItem('全部', counts.total),
      this.summaryItem('待确认', pending),
      this.summaryItem('已确认', counts.confirmed),
      this.summaryItem('已忽略', counts.ignored),
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
      el('span', { className: `memory-status memory-status--${item.enabled === false ? 'disabled' : item.status || 'inferred'}`, textContent: memoryStatusLabel(item.enabled === false ? 'disabled' : item.status) }),
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
      toast(patch.reviewStatus === 'ignored' ? '记忆已忽略' : '记忆已确认', 'success');
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
