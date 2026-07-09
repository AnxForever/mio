import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { Store } from '../store.js';
import { ICONS } from '../utils/icons.js';
import { relationshipVM } from '../liveness.js';
import { toast } from '../components/toast.js';
import { renderEmpty } from '../components/empty-state.js';

function valueOrDash(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function providerLabel(status) {
  const provider = status?.provider?.label || status?.config?.provider || 'Provider';
  const model = status?.provider?.model || status?.config?.model || '';
  return model ? `${provider} · ${model}` : provider;
}

function canReadProtected() {
  return !!Store.get('authToken') || Store.get('authBypassed') === true;
}

function notifyLabel(notify) {
  if (!canReadProtected()) return ['受保护', '需要访问令牌'];
  if (!notify) return ['未知', '读取失败'];
  return notify.enabled ? ['已启用', `${notify.channels?.length ?? 0} 个渠道`] : ['未启用', `${notify.channels?.length ?? 0} 个渠道`];
}

function connectionLabel() {
  return Store.get('connected') ? '实时通道已连接' : 'HTTP 可用';
}

function energyLabel(value) {
  if (value === 'high') return '充沛';
  if (value === 'low') return '低落';
  return '平稳';
}

export function characterDisplayName(character) {
  return character?.config?.name || character?.id || '未命名';
}

export function characterMetaLine(character) {
  const config = character?.config || {};
  return [
    config.gender === 'female' ? '女' : config.gender === 'male' ? '男' : config.gender,
    config.age ? `${config.age}岁` : '',
    config.occupation,
  ].filter(Boolean).join(' · ');
}

export function characterTags(character, limit = 5) {
  const config = character?.config || {};
  return [
    ...(Array.isArray(config.traits) ? config.traits : []),
    ...(Array.isArray(config.interests) ? config.interests : []),
  ].filter(Boolean).slice(0, limit);
}

export function resolveActiveCharacterId(status, characters = []) {
  const activeMod = status?.config?.activeMod || Store.get('activeMod') || '';
  const active = characters.find((item) => item.id === activeMod || item.active);
  return active?.id || activeMod;
}

export class ConsoleView extends BaseView {
  constructor(params) {
    super(params);
    this.content = null;
    this.statusPill = null;
  }

  render() {
    this.el = el('div', { className: 'console-view admin-view' });

    const header = el('header', { className: 'admin-header' }, [
      el('div', { className: 'admin-heading' }, [
        el('div', { className: 'admin-kicker', textContent: '控制台' }),
        el('h1', { className: 'admin-title', textContent: 'Mio 控制台' }),
      ]),
    ]);

    this.statusPill = el('span', { className: 'admin-status-pill', textContent: '连接中' });
    header.appendChild(el('div', { className: 'admin-header-actions' }, [
      this.statusPill,
      this.actionButton('打开聊天', '/chat', 'primary'),
    ]));

    this.content = el('div', { className: 'admin-content' });
    this.el.appendChild(header);
    this.el.appendChild(this.content);
    return this.el;
  }

  mount() {
    this.renderLoading();
    this.load();
  }

  renderLoading() {
    if (!this.content) return;
    this.content.innerHTML = '';
    this.content.appendChild(el('div', { className: 'admin-skeleton' }, [
      el('div'),
      el('div'),
      el('div'),
    ]));
  }

  async load() {
    const notifyRequest = canReadProtected()
      ? api.get('/notify/channels')
      : Promise.resolve(null);
    const charactersRequest = canReadProtected()
      ? api.get('/characters')
      : Promise.resolve(null);
    const [statusR, notifyR, charactersR] = await Promise.allSettled([
      api.get('/status'),
      notifyRequest,
      charactersRequest,
    ]);

    if (!this.content || !this.content.isConnected) return;

    const status = statusR.status === 'fulfilled' ? statusR.value : null;
    const notify = notifyR.status === 'fulfilled' ? notifyR.value : null;
    const characters = charactersR.status === 'fulfilled' ? (charactersR.value?.data || []) : [];
    const connected = !!status;
    Store.set('connected', connected);

    if (this.statusPill) {
      this.statusPill.textContent = connected ? '本地运行中' : '离线';
      this.statusPill.classList.toggle('is-online', connected);
    }

    this.content.innerHTML = '';
    this.content.appendChild(this.hero(status, notify));
    this.content.appendChild(this.characterShelf(status, characters));
    this.content.appendChild(this.controlGrid(status, notify));
  }

  hero(status, notify) {
    const rel = status?.relationship ? relationshipVM(status.relationship) : null;
    const activeMod = status?.config?.activeMod || status?.config?.gender || '—';
    const [notifyValue] = notifyLabel(notify);
    return el('section', { className: 'console-hero admin-panel' }, [
      el('div', { className: 'console-hero-main' }, [
        el('h2', { className: 'admin-section-title', textContent: '现在的 Mio' }),
        this.emotionalCore(status),
      ]),
      el('div', { className: 'console-hero-side' }, [
        this.statusLine('模型', providerLabel(status)),
        this.statusLine('人格', valueOrDash(activeMod)),
        this.statusLine('关系', rel ? `${rel.label} · ${rel.count}` : '—'),
        this.statusLine('通知', notifyValue),
      ]),
    ]);
  }

  emotionalCore(status) {
    const emotion = status?.emotion ?? {};
    const affection = clampPercent(emotion.affection ?? 0);
    return el('div', { className: 'console-core-strip', 'aria-label': 'Mio 情绪状态' }, [
      this.coreSignal('心情', valueOrDash(emotion.myMood || '平静')),
      this.coreSignal('精力', energyLabel(emotion.energy)),
      this.coreSignal('亲密度', `${affection}/100`, affection),
    ]);
  }

  coreSignal(label, value, percent = null) {
    const children = [
      el('span', { className: 'console-core-label', textContent: label }),
      el('strong', { className: 'console-core-value', textContent: value }),
    ];
    if (percent !== null) {
      children.push(el('span', { className: 'console-core-meter', 'aria-hidden': 'true' }, [
        el('i', { style: { width: `${clampPercent(percent)}%` } }),
      ]));
    }
    return el('div', { className: 'console-core-item' }, children);
  }

  characterShelf(status, characters) {
    const activeId = resolveActiveCharacterId(status, characters);
    const head = el('div', { className: 'admin-section-head console-character-head' }, [
      el('h2', { className: 'admin-section-title', textContent: '人格卡片' }),
      el('button', {
        className: 'admin-btn admin-btn--secondary',
        type: 'button',
        onClick: () => navigate('/studio'),
      }, [
        ICONS.studio(16),
        el('span', { textContent: '进入 Studio' }),
      ]),
    ]);

    if (!characters.length) {
      const hasAuth = canReadProtected();
      const empty = renderEmpty({
        icon: hasAuth ? ICONS.unplugged : ICONS.sparkle,
        title: hasAuth ? '还没找到角色卡' : '需要访问令牌',
        desc: hasAuth
          ? '后端读了但没拿到角色 — 检查 /character 接口，或在 Studio 里创建一张。'
          : '把这个控制台当成主人的私人面板去接入；当前 token 无权读取。',
        cta: hasAuth
          ? { label: '进入 Studio', onClick: () => navigate('/studio') }
          : { label: '去 Studio 配置', kind: 'secondary', onClick: () => navigate('/studio') },
        tone: hasAuth ? 'error' : 'mute',
        size: 'sm',
        className: 'console-character-empty',
      });
      return el('section', { className: 'admin-section console-character-section' }, [
        head,
        empty,
      ]);
    }

    return el('section', { className: 'admin-section console-character-section', 'aria-label': '人格卡片' }, [
      head,
      el('div', { className: 'console-character-grid' }, characters.map((character) =>
        this.characterCard(character, activeId),
      )),
    ]);
  }

  characterCard(character, activeId) {
    const active = character.id === activeId || character.active;
    const config = character.config || {};
    const tags = characterTags(character, 6);
    const source = config.source?.quality === 'reviewed' ? '已审核' : config.source?.quality === 'draft' ? '草案' : '';

    const card = el('article', { className: `console-character-card admin-panel${active ? ' is-active' : ''}` });
    card.appendChild(el('div', { className: 'console-character-top' }, [
      el('div', { className: 'console-character-avatar', 'aria-hidden': 'true', textContent: characterDisplayName(character).slice(0, 1) }),
      el('div', { className: 'console-character-title' }, [
        el('div', { className: 'console-character-name', textContent: characterDisplayName(character) }),
        el('div', { className: 'console-character-meta', textContent: characterMetaLine(character) || character.id }),
      ]),
      el('span', { className: `admin-badge ${active ? 'admin-badge--ready' : 'admin-badge--neutral'}`, textContent: active ? '使用中' : (source || '可用') }),
    ]));

    if (config.style) {
      card.appendChild(el('p', { className: 'console-character-style', textContent: config.style }));
    }

    if (tags.length) {
      card.appendChild(el('div', { className: 'console-character-tags' }, tags.map((tag) =>
        el('span', { className: 'console-character-tag', textContent: tag }),
      )));
    }

    const actions = el('div', { className: 'console-character-actions' });
    actions.appendChild(el('button', {
      className: `admin-btn ${active ? 'admin-btn--secondary' : 'admin-btn--primary'}`,
      type: 'button',
      disabled: active ? 'disabled' : undefined,
      onClick: () => this.activateCharacter(character.id),
    }, [
      el('span', { textContent: active ? '已启用' : '启用' }),
    ]));
    actions.appendChild(el('button', {
      className: 'admin-btn admin-btn--secondary',
      type: 'button',
      onClick: () => navigate(`/studio/${encodeURIComponent(character.id)}`),
    }, [
      el('span', { textContent: '编辑' }),
    ]));
    card.appendChild(actions);
    return card;
  }

  async activateCharacter(id) {
    try {
      const result = await api.post(`/character/${encodeURIComponent(id)}/activate`);
      Store.set('activeMod', result?.data?.activeMod || id);
      toast('角色已启用', 'success');
      this.load();
    } catch (err) {
      toast(err.message || '启用失败', 'error');
    }
  }

  controlGrid(status, notify) {
    const items = [
      {
        title: '实时聊天',
        desc: '直接测试人格、记忆和流式回复。',
        route: '/chat',
        icon: ICONS.chat,
        meta: connectionLabel(),
      },
      {
        title: '人格与角色',
        desc: '编辑 soul、模式、角色边界和表达风格。',
        route: '/studio',
        icon: ICONS.studio,
        meta: `当前 ${valueOrDash(status?.config?.activeMod || status?.config?.gender)}`,
      },
      {
        title: '微信 / 渠道接入',
        desc: '配置 ClawBot、OpenAI-compatible 客户端和 OneBot。',
        route: '/channels',
        icon: ICONS.channels,
        meta: 'ClawBot 主路径',
      },
      {
        title: '记忆',
        desc: '审查、确认和清理长期记忆。',
        route: '/memories',
        icon: ICONS.memory,
        meta: `${status?.embedding?.indexEntries ?? 0} 条索引`,
      },
      {
        title: '运行配置',
        desc: '通知、备份、导出和主动消息。',
        route: '/settings',
        icon: ICONS.settings,
        meta: canReadProtected() ? (notify?.enabled ? '通知已配置' : '通知未启用') : '需令牌',
      },
      {
        title: '技能 / 插件 / MCP',
        desc: '管理技能、插件和 MCP server 配置意图。',
        route: '/extensions',
        icon: ICONS.plugins,
        meta: '能力面板',
      },
      {
        title: '数据与观察',
        desc: '关系、情绪、话题和会话趋势。',
        route: '/analytics',
        icon: ICONS.analytics,
        meta: '分析',
      },
    ];

    return el('section', { className: 'admin-section' }, [
      el('div', { className: 'admin-section-head' }, [
        el('h2', { className: 'admin-section-title', textContent: '工作区' }),
      ]),
      el('div', { className: 'admin-control-grid' }, items.map((item) => this.controlCard(item))),
    ]);
  }

  controlCard(item) {
    const iconWrap = el('div', { className: 'admin-control-icon' });
    iconWrap.appendChild(item.icon(18));
    return el('button', {
      className: 'admin-control-card admin-panel',
      type: 'button',
      'aria-label': `${item.title}: ${item.desc}`,
      onClick: () => navigate(item.route),
    }, [
      el('div', { className: 'admin-control-top' }, [
        iconWrap,
        el('span', { className: 'admin-control-meta', textContent: item.meta }),
      ]),
      el('div', { className: 'admin-control-title', textContent: item.title }),
      el('div', { className: 'admin-control-desc', textContent: item.desc }),
    ]);
  }

  statusLine(label, value) {
    return el('div', { className: 'console-status-line' }, [
      el('span', { textContent: label }),
      el('strong', { textContent: value }),
    ]);
  }

  actionButton(label, route, tone) {
    return el('button', {
      className: `admin-btn admin-btn--${tone}`,
      type: 'button',
      onClick: () => navigate(route),
      textContent: label,
    });
  }
}

let consoleViewInstance = null;

export function renderConsole(params) {
  consoleViewInstance = new ConsoleView(params);
  return consoleViewInstance.render();
}

export function mountConsole() {
  consoleViewInstance?.mount();
}

export function unmountConsole() {
  if (consoleViewInstance) {
    consoleViewInstance.unmount();
    consoleViewInstance = null;
  }
}
