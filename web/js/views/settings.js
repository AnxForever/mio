import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { renderTabBar } from '../components/tab-bar.js';
import { toast } from '../components/toast.js';

export class SettingsView extends BaseView {
  constructor(params) {
    super(params);
  }

  render() {
    this.el = el('div', { className: 'settings-view' });

    const header = el('header', { className: 'analytics-header' });
    const backBtn = el('button', {
      className: 'studio-back-btn',
      innerHTML: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
      onClick: () => navigate('/chat'),
    });
    header.appendChild(backBtn);
    header.appendChild(el('h1', { className: 'studio-header-title', textContent: '设置' }));
    this.el.appendChild(header);

    const content = el('div', { className: 'settings-content', id: 'settings-content' });
    this.el.appendChild(content);
    this.el.appendChild(renderTabBar());

    return this.el;
  }

  mount() {
    const content = this.el.querySelector('#settings-content');
    if (content) this.buildSettings(content);
  }

  buildSettings(container) {
    container.innerHTML = '';

    /* ═══ 连接 ═══ */
    const connected = Store.get('connected');
    container.appendChild(el('div', { className: 'settings-group' }, [
      el('div', { className: 'settings-group-header', textContent: '连接' }),
      this.settingsRow({
        icon: '🔗',
        label: '服务器',
        desc: Store.get('serverUrl'),
        value: el('div', { className: 'connection-status' }, [
          el('span', { className: `connection-dot${connected ? ' online' : ' off'}` }),
          el('span', { textContent: connected ? '已连接' : '离线', style: { fontSize: 'var(--text-caption)' } }),
        ]),
      }),
      this.settingsRow({
        icon: '🔑',
        label: '访问令牌',
        desc: '已设置' + (Store.get('authToken') ? '' : '?'),
        onClick: () => toast('令牌管理请在登录页操作', 'info'),
      }),
    ]));

    /* ═══ 通知 ═══ */
    const notifyGroup = el('div', { className: 'settings-group' });
    notifyGroup.appendChild(el('div', { className: 'settings-group-header', textContent: '通知' }));
    notifyGroup.appendChild(this.settingsRow({
      icon: '🔔',
      label: '测试通知',
      onClick: async () => {
        try {
          await api.post('/notify/test');
          toast('测试消息已发送', 'success');
        } catch {
          toast('发送失败', 'error');
        }
      },
    }));

    /* 渠道状态 — 异步加载 */
    const channelList = el('div', { className: 'channel-list', id: 'channel-list' });
    channelList.appendChild(el('p', { className: 'text-caption text-muted', textContent: '加载中…' }));
    notifyGroup.appendChild(channelList);
    container.appendChild(notifyGroup);

    this.loadChannels(channelList);

    /* ═══ 数据 ═══ */
    container.appendChild(el('div', { className: 'settings-group' }, [
      el('div', { className: 'settings-group-header', textContent: '数据' }),
      this.settingsRow({
        icon: '📤',
        label: '导出记忆',
        onClick: async () => {
          try {
            const res = await api.get('/admin/export', { raw: true });
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mio-export-${new Date().toISOString().slice(0, 10)}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            toast('导出成功', 'success');
          } catch {
            toast('导出失败', 'error');
          }
        },
      }),
      this.settingsRow({
        icon: '💾',
        label: '创建备份',
        onClick: async () => {
          try {
            await api.post('/admin/backup');
            toast('备份创建成功', 'success');
          } catch {
            toast('创建失败', 'error');
          }
        },
      }),
    ]));

    /* ═══ 关于 ═══ */
    container.appendChild(el('div', { className: 'about-section' }, [
      el('div', { className: 'about-name', textContent: 'Mio' }),
      el('div', { className: 'about-version', textContent: 'v0.7.0' }),
      el('div', { className: 'about-tagline', textContent: '用心陪伴 · 每一帧' }),
    ]));
  }

  settingsRow({ icon, label, desc, value, onClick }) {
    const props = {};
    if (onClick) props.onClick = onClick;

    return el('div', { className: 'settings-row', ...props }, [
      icon ? el('div', { className: 'settings-row-icon', style: { background: 'var(--mist-100)' }, textContent: icon }) : null,
      el('div', { className: 'settings-row-info' }, [
        el('div', { className: 'settings-row-label', textContent: label }),
        desc ? el('div', { className: 'settings-row-desc', textContent: desc }) : null,
      ]),
      value || null,
      el('span', { className: 'settings-row-arrow', textContent: '›' }),
    ]);
  }

  async loadChannels(container) {
    try {
      const data = await api.get('/notify/channels');
      container.innerHTML = '';

      if (!data?.channels?.length) {
        container.appendChild(el('p', {
          className: 'text-caption text-muted',
          textContent: '暂无配置的通知渠道',
          style: { padding: 'var(--space-3) 0' },
        }));
        return;
      }

      data.channels.forEach(ch => {
        container.appendChild(el('div', { className: 'channel-item' }, [
          el('span', { className: 'channel-name', textContent: ch.name || ch.type }),
          el('span', { className: `channel-status ${ch.enabled ? 'on' : 'off'}`, textContent: ch.enabled ? '已启用' : '未启用' }),
        ]));
      });
    } catch {
      container.innerHTML = '';
      container.appendChild(el('p', {
        className: 'text-caption text-muted',
        textContent: '加载失败',
      }));
    }
  }
}

// Export compat
let settingsViewInstance = null;

export function renderSettings(params) {
  settingsViewInstance = new SettingsView(params);
  return settingsViewInstance.render();
}

export function mountSettings() {
  if (settingsViewInstance) settingsViewInstance.mount();
}

export function unmountSettings() {
  if (settingsViewInstance) {
    settingsViewInstance.unmount();
    settingsViewInstance = null;
  }
}
