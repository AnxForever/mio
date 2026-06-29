import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { api } from '../api.js';
import { ICONS } from '../utils/icons.js';
import { Store } from '../store.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';

const BUILTIN_PLUGINS = [
  ['ghost', 'Ghost silence', '控制低必要性回复和静默节奏', 'runtime'],
  ['affinity', 'Affinity', '维护 warmth / trust / tension 等关系轴', 'runtime'],
  ['pad', 'PAD emotion', 'Pleasure / Arousal / Dominance 情绪模型', 'runtime'],
  ['frustration', 'Frustration', '跟踪挫败、耐心和 attachment 倾向', 'runtime'],
];

const SKILL_ROWS = [
  ['persona', '人格编辑', '通过 Studio 编辑 soul、模式和角色。', '已接入'],
  ['memory', '记忆审查', '确认、忽略、编辑或删除长期记忆。', '已接入'],
  ['notify', '通知渠道', 'Telegram / Webhook / Discord / Slack / WeClaw 等通知。', '部分接入'],
  ['external-skills', '外部 Skill 库', '需要后端枚举、安装和启停 API。', '待接入'],
];

const MCP_ROWS = [
  ['filesystem', 'Filesystem', '把本地文件能力作为可审计 MCP server 接入。', '规划中'],
  ['browser', 'Browser automation', '把浏览器操作能力接到受控工具面。', '规划中'],
  ['search', 'Web search', '统一搜索、fetch、引用和审计日志。', '规划中'],
];

const TAB_META = {
  skills: ['技能', SKILL_ROWS.length],
  plugins: ['插件', BUILTIN_PLUGINS.length + 1],
  mcp: ['MCP', MCP_ROWS.length + 1],
};

function fallbackWorkspaceConfig() {
  return {
    skills: SKILL_ROWS.map(([id, name, description, state]) => ({
      id,
      name,
      description,
      source: id === 'external-skills' ? 'external' : 'builtin',
      enabled: !state.includes('待'),
      status: state.includes('待') ? 'planned' : state.includes('部分') ? 'partial' : 'ready',
    })),
    plugins: BUILTIN_PLUGINS.map(([id, name, description]) => ({
      id,
      name,
      description,
      builtin: true,
      enabled: true,
      config: {},
    })),
    mcp: MCP_ROWS.map(([id, name, description]) => ({
      id,
      name,
      description,
      enabled: false,
      tools: [],
      status: 'planned',
    })),
  };
}

function canReadProtected() {
  return !!Store.get('authToken') || Store.get('authBypassed') === true;
}

export class ExtensionsView extends BaseView {
  constructor(params) {
    super(params);
    this.activeTab = 'skills';
    this.body = null;
    this.tabs = null;
    this.overview = null;
    this.status = null;
    this.channels = null;
    this.workspaceConfig = null;
  }

  render() {
    this.el = el('div', { className: 'extensions-view admin-view' });
    const header = el('header', { className: 'admin-header' }, [
      el('div', { className: 'admin-heading' }, [
        el('div', { className: 'admin-kicker', textContent: '扩展' }),
        el('h1', { className: 'admin-title', textContent: '能力面板' }),
      ]),
      el('div', { className: 'admin-header-actions' }, [
        this.actionButton('回到控制台', '/console'),
      ]),
    ]);

    this.tabs = el('div', { className: 'admin-tabs extensions-tabs', role: 'tablist' }, [
      this.tabButton('skills'),
      this.tabButton('plugins'),
      this.tabButton('mcp'),
    ]);
    this.overview = el('section', { className: 'extensions-overview admin-panel' });
    this.body = el('div', { className: 'extensions-body' });
    this.renderOverview();

    this.el.appendChild(header);
    this.el.appendChild(el('div', { className: 'admin-content' }, [
      el('section', { className: 'admin-panel extensions-intro' }, [
        el('p', {
          className: 'extensions-intro-copy',
          textContent: '能力先按可用性分层：已接入的进入现有页面，未接入的只保留审查位置，不伪造启停。',
        }),
      ]),
      this.overview,
      this.tabs,
      this.body,
    ]));
    return this.el;
  }

  mount() {
    this.renderActiveTab();
    this.load();
  }

  async load() {
    const channelsRequest = canReadProtected()
      ? api.get('/notify/channels')
      : Promise.resolve(null);
    const workspaceRequest = canReadProtected()
      ? api.get('/admin/workspace-config')
      : Promise.resolve(null);
    const [statusR, channelsR, workspaceR] = await Promise.allSettled([
      api.get('/status'),
      channelsRequest,
      workspaceRequest,
    ]);
    this.status = statusR.status === 'fulfilled' ? statusR.value : null;
    this.channels = channelsR.status === 'fulfilled' ? channelsR.value : null;
    this.workspaceConfig = workspaceR.status === 'fulfilled' ? workspaceR.value?.config : null;
    this.renderOverview();
    this.renderActiveTab();
  }

  tabButton(id) {
    const [label, count] = TAB_META[id];
    return el('button', {
      className: `admin-tab${this.activeTab === id ? ' active' : ''}`,
      type: 'button',
      role: 'tab',
      dataset: { tab: id },
      'aria-selected': this.activeTab === id ? 'true' : 'false',
      onClick: () => {
        this.activeTab = id;
        this.renderActiveTab();
      },
    }, [
      el('span', { textContent: label }),
      el('span', { className: 'admin-tab-count', textContent: String(count) }),
    ]);
  }

  renderOverview() {
    if (!this.overview) return;
    this.overview.innerHTML = '';

    const config = this.config();
    const readySkills = config.skills.filter((skill) => skill.enabled && skill.status !== 'planned').length;
    const channelTotal = this.channels?.channels?.length ?? null;
    const channelEnabled = this.channels?.channels?.filter((c) => c.enabled).length ?? null;
    const notifyValue = channelTotal === null
      ? (canReadProtected() ? '读取中' : '需令牌')
      : `${channelEnabled}/${channelTotal}`;

    [
      ['Workflow', `${readySkills}/${config.skills.length}`, '已接入能力'],
      ['Runtime', String(config.plugins.filter((plugin) => plugin.enabled).length), '配置启用'],
      ['Notify', notifyValue, channelTotal === null ? '渠道状态' : '启用渠道'],
      ['MCP', String(config.mcp.filter((server) => server.enabled).length), '配置启用'],
    ].forEach(([label, value, hint]) => {
      this.overview.appendChild(el('div', { className: 'extensions-overview-item' }, [
        el('div', { className: 'extensions-overview-label', textContent: label }),
        el('div', { className: 'extensions-overview-value', textContent: value }),
        el('div', { className: 'extensions-overview-hint', textContent: hint }),
      ]));
    });
  }

  renderActiveTab() {
    if (!this.body) return;
    this.syncTabCounts();
    this.tabs?.querySelectorAll('.admin-tab').forEach((btn) => {
      const active = btn.dataset.tab === this.activeTab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    this.body.innerHTML = '';
    if (this.activeTab === 'skills') this.body.appendChild(this.skillsPanel());
    if (this.activeTab === 'plugins') this.body.appendChild(this.pluginsPanel());
    if (this.activeTab === 'mcp') this.body.appendChild(this.mcpPanel());
  }

  skillsPanel() {
    const rows = this.config().skills.map((skill) => {
      const detail = skill.id === 'notify' && this.channels
        ? `${this.channels.channels?.filter((c) => c.enabled).length ?? 0} 个渠道启用`
        : skill.id === 'notify' && !canReadProtected()
          ? '需要访问令牌'
        : this.skillStateLabel(skill);
      const tone = detail.includes('需要') ? 'muted' : this.skillTone(skill);
      return this.capabilityRow(
        skill.name,
        skill.description,
        detail,
        tone,
        this.iconFor(skill.id),
        this.configToggle('skills', skill.id, skill.enabled, skill.name),
      );
    });

    return this.panel('Skills', '用户工作流层能力。这里保存配置意图，运行时接入仍以具体后端实现为准。', rows);
  }

  pluginsPanel() {
    const rows = this.config().plugins.map((plugin) =>
      this.capabilityRow(
        plugin.name,
        plugin.description,
        plugin.enabled ? (plugin.builtin ? '内置运行时' : '配置启用') : '配置关闭',
        plugin.enabled ? 'ready' : 'muted',
        this.iconFor(plugin.id),
        this.configToggle('plugins', plugin.id, plugin.enabled, plugin.name),
      ),
    );

    return this.panel('Plugins', '运行时插件层能力。当前只持久化配置，实际装载仍由 registry 接管。', rows);
  }

  mcpPanel() {
    const rows = this.config().mcp.map((server) =>
      this.capabilityRow(
        server.name,
        server.description,
        this.mcpStateLabel(server),
        this.mcpTone(server),
        ICONS.plugins,
        this.configToggle('mcp', server.id, server.enabled, server.name),
      ),
    );

    return this.panel('MCP', '外部工具层能力。先保存 server 定义和授权意图，再接入连接测试与调用审计。', rows);
  }

  panel(title, desc, rows) {
    return el('section', { className: 'extensions-panel admin-panel' }, [
      el('div', { className: 'admin-section-head' }, [
        el('h2', { className: 'admin-section-title', textContent: title }),
        el('p', { className: 'admin-section-copy', textContent: desc }),
      ]),
      el('div', { className: 'extensions-list' }, rows),
    ]);
  }

  capabilityRow(name, desc, state, tone, iconFn = ICONS.plugins, action = null) {
    const icon = el('div', { className: `extensions-row-icon extensions-row-icon--${tone}` });
    icon.appendChild(iconFn(18));
    return el('div', { className: `extensions-row extensions-row--${tone}` }, [
      icon,
      el('div', { className: 'extensions-row-main' }, [
        el('div', { className: 'extensions-row-name', textContent: name }),
        el('div', { className: 'extensions-row-desc', textContent: desc }),
      ]),
      action
        ? el('div', { className: 'extensions-row-end' }, [this.statusBadge(state, tone), action])
        : this.statusBadge(state, tone),
    ]);
  }

  statusBadge(label, tone) {
    return el('span', { className: `admin-badge admin-badge--${tone}`, textContent: label });
  }

  iconFor(id) {
    const map = {
      persona: ICONS.studio,
      memory: ICONS.memory,
      notify: ICONS.settings,
      ghost: ICONS.chat,
      affinity: ICONS.analytics,
      pad: ICONS.studio,
      frustration: ICONS.settings,
    };
    return map[id] || ICONS.plugins;
  }

  config() {
    return this.workspaceConfig || fallbackWorkspaceConfig();
  }

  syncTabCounts() {
    const config = this.config();
    const counts = {
      skills: config.skills.length,
      plugins: config.plugins.length,
      mcp: config.mcp.length,
    };
    this.tabs?.querySelectorAll('.admin-tab').forEach((btn) => {
      const count = btn.querySelector('.admin-tab-count');
      if (count && counts[btn.dataset.tab] !== undefined) {
        count.textContent = String(counts[btn.dataset.tab]);
      }
    });
  }

  skillStateLabel(skill) {
    if (!skill.enabled) return skill.status === 'planned' ? '待接入' : '配置关闭';
    if (skill.status === 'partial') return '部分接入';
    if (skill.status === 'planned') return '已配置';
    return '已接入';
  }

  skillTone(skill) {
    if (!skill.enabled || skill.status === 'planned') return 'muted';
    return skill.status === 'partial' ? 'warning' : 'ready';
  }

  mcpStateLabel(server) {
    if (!server.enabled) return server.status === 'planned' ? '规划中' : '配置关闭';
    if (server.status === 'configured') return '已配置';
    return '配置启用';
  }

  mcpTone(server) {
    if (!server.enabled) return 'muted';
    return server.status === 'configured' ? 'ready' : 'warning';
  }

  configToggle(section, id, enabled, name) {
    if (!canReadProtected()) return null;
    const input = el('input', {
      type: 'checkbox',
      checked: enabled ? 'checked' : undefined,
      'aria-label': `${name} 配置开关`,
      onChange: (event) => this.saveConfigToggle(section, id, event.currentTarget.checked),
    });
    return el('label', { className: 'extensions-config-toggle' }, [
      input,
      el('span', { 'aria-hidden': 'true' }),
    ]);
  }

  async saveConfigToggle(section, id, enabled) {
    const config = JSON.parse(JSON.stringify(this.config()));
    const items = Array.isArray(config[section]) ? config[section] : [];
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    item.enabled = enabled;

    try {
      const data = await api.put('/admin/workspace-config', { [section]: items });
      this.workspaceConfig = data?.config || config;
      this.renderOverview();
      this.renderActiveTab();
      toast('配置已保存', 'success');
    } catch {
      toast('配置保存失败', 'error');
      this.renderActiveTab();
    }
  }

  actionButton(label, route) {
    return el('button', {
      className: 'admin-btn admin-btn--primary',
      type: 'button',
      onClick: () => navigate(route),
      textContent: label,
    });
  }
}

let extensionsViewInstance = null;

export function renderExtensions(params) {
  extensionsViewInstance = new ExtensionsView(params);
  return extensionsViewInstance.render();
}

export function mountExtensions() {
  extensionsViewInstance?.mount();
}

export function unmountExtensions() {
  if (extensionsViewInstance) {
    extensionsViewInstance.unmount();
    extensionsViewInstance = null;
  }
}
