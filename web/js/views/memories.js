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
      const data = await api.get('/memories' + suffix);
      this.items = data?.items || [];
      this.searchResults = data?.searchResults || [];
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
    this.searchResults.slice(0, 5).forEach((result) => {
      group.appendChild(el('div', { className: 'memory-result' }, [
        el('div', { className: 'memory-result-title', textContent: result.title || result.source || '旧内容' }),
        el('div', { className: 'memory-result-snippet', textContent: result.snippet || result.text || result.content || '' }),
      ]));
    });
    this.searchResultsEl.appendChild(group);
  }

  renderItems() {
    this.listEl.innerHTML = '';
    this.listEl.appendChild(el('div', { className: 'memories-section-label', textContent: '已保存的记忆' }));

    if (!this.items.length) {
      this.listEl.appendChild(el('div', { className: 'memories-state', textContent: '还没有可审查的结构化记忆。继续聊天后，Mio 会把重要内容整理到这里。' }));
      return;
    }

    this.items.forEach((item) => {
      this.listEl.appendChild(this.memoryCard(item));
    });
  }

  memoryCard(item) {
    const card = el('article', { className: 'memory-card', dataset: { id: item.id } });
    const meta = el('div', { className: 'memory-meta' }, [
      el('span', { className: 'memory-type', textContent: TYPE_LABELS[item.type] || item.type }),
      el('span', { className: 'memory-status', textContent: item.status === 'confirmed' ? '已确认' : '待确认' }),
      item.topic ? el('span', { className: 'memory-topic', textContent: item.topic }) : null,
    ]);

    const content = el('div', { className: 'memory-content', textContent: item.content });
    const details = el('div', { className: 'memory-details', textContent: `${formatDate(item.lastSeen)} · 置信度 ${Math.round(item.confidence * 100)}% · ${item.source || '无来源'}` });

    const actions = el('div', { className: 'memory-actions' }, [
      el('button', { type: 'button', className: 'memory-action tap', textContent: '编辑', onClick: () => this.startEdit(card, item) }),
      el('button', { type: 'button', className: 'memory-action memory-action--danger tap', textContent: '删除', onClick: () => this.deleteItem(item.id) }),
    ]);

    card.appendChild(meta);
    card.appendChild(content);
    card.appendChild(details);
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
