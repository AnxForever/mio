import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';
import { ICONS } from '../utils/icons.js';
import { renderGenderPicker } from './gender.js';

export class SettingsView extends BaseView {
  constructor(params) {
    super(params);
  }

  render() {
    this.el = el('div', { className: 'settings-view' });

    /* ═══ 顶栏 ═══ */
    const header = el('header', { className: 'settings-header' });
    const backBtn = el('button', {
      className: 'settings-back tap',
      'aria-label': '返回聊天',
      onClick: () => navigate('/chat'),
    });
    backBtn.appendChild(ICONS.back());
    header.appendChild(backBtn);
    header.appendChild(el('h1', { className: 'settings-title title', textContent: '设置' }));
    this.el.appendChild(header);

    const content = el('div', { className: 'settings-content', id: 'settings-content' });
    this.el.appendChild(content);

    return this.el;
  }

  mount() {
    const content = this.el.querySelector('#settings-content');
    if (content) this.buildSettings(content);
  }

  buildSettings(container) {
    container.innerHTML = '';

    this.buildGenderSection(container);
    this.buildConnectionSection(container);
    this.buildNotifySection(container);
    this.buildDataSection(container);

    /* ═══ 关于 ═══ */
    container.appendChild(el('div', { className: 'about-section' }, [
      el('div', { className: 'about-name', textContent: 'Mio' }),
      el('div', { className: 'about-version', textContent: 'v0.7.0' }),
      el('div', { className: 'about-tagline', textContent: '用心陪伴 · 每一帧' }),
    ]));
  }

  /* ─── Mio 性别 ─── */

  buildGenderSection(container) {
    const { wrap, body } = this.makeSection('Mio');
    body.classList.add('gender-setting');

    const initial = Store.get('activeMod');
    const picker = renderGenderPicker({
      value: initial,
      onSelect: (mod) => this.applyGender(mod),
    });
    body.appendChild(picker);

    wrap.appendChild(el('div', {
      className: 'settings-hint',
      textContent: '选择 Mio 是她，还是他。关系会在相处中慢慢生长。',
    }));

    container.appendChild(wrap);

    /* 以服务端为准校正初始选中(离线则保留本地值) */
    this.loadGender(body, picker, initial);
  }

  async applyGender(mod) {
    try {
      await api.post('/mod', { name: mod });
      Store.set('activeMod', mod);
      toast(mod === 'boyfriend' ? '已切换为他' : '已切换为她', 'success');
    } catch {
      toast('切换失败', 'error');
    }
  }

  async loadGender(body, oldPicker, initial) {
    let gender;
    try {
      const data = await api.get('/status');
      gender = data?.config?.gender || data?.config?.activeMod;
    } catch {
      return; // 离线:保留本地初始值
    }
    if ((gender === 'girlfriend' || gender === 'boyfriend') && gender !== initial) {
      Store.set('activeMod', gender);
      const fresh = renderGenderPicker({
        value: gender,
        onSelect: (mod) => this.applyGender(mod),
      });
      if (oldPicker.parentNode === body) body.replaceChild(fresh, oldPicker);
    }
  }

  /* ─── 连接 ─── */

  buildConnectionSection(container) {
    const connected = Store.get('connected');
    const { wrap, body } = this.makeSection('连接');

    body.appendChild(this.row({
      label: '服务器',
      desc: Store.get('serverUrl'),
      value: el('span', { className: 'conn-status' }, [
        el('span', { className: 'conn-dot' + (connected ? ' online' : '') }),
        el('span', { className: 'conn-text', textContent: connected ? '已连接' : '离线' }),
      ]),
    }));

    body.appendChild(this.row({
      label: '访问令牌',
      desc: Store.get('authToken') ? '已设置' : '未设置',
      onClick: () => toast('令牌管理请在登录页操作', 'info'),
    }));

    container.appendChild(wrap);
  }

  /* ─── 通知 ─── */

  buildNotifySection(container) {
    const { wrap, body } = this.makeSection('通知');

    body.appendChild(this.row({
      label: '测试通知',
      desc: '发送一条测试消息',
      onClick: async () => {
        try {
          await api.post('/notify/test');
          toast('测试消息已发送', 'success');
        } catch {
          toast('发送失败', 'error');
        }
      },
    }));

    const placeholder = el('div', { className: 'cell channel-msg', textContent: '加载中…' });
    body.appendChild(placeholder);

    container.appendChild(wrap);
    this.loadChannels(body, placeholder);
  }

  async loadChannels(body, placeholder) {
    try {
      const data = await api.get('/notify/channels');
      placeholder.remove();

      if (!data?.channels?.length) {
        body.appendChild(el('div', { className: 'cell channel-msg', textContent: '暂无配置的通知渠道' }));
        return;
      }

      data.channels.forEach((ch) => {
        body.appendChild(el('div', { className: 'cell' }, [
          el('div', { className: 'cell-main' }, [
            el('div', { className: 'cell-label', textContent: ch.name || ch.type }),
          ]),
          el('span', {
            className: `channel-status ${ch.enabled ? 'on' : 'off'}`,
            textContent: ch.enabled ? '已启用' : '未启用',
          }),
        ]));
      });
    } catch {
      placeholder.textContent = '加载失败';
    }
  }

  /* ─── 数据 ─── */

  buildDataSection(container) {
    const { wrap, body } = this.makeSection('数据');

    body.appendChild(this.row({
      label: '导出记忆',
      desc: '下载完整记忆存档',
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
    }));

    body.appendChild(this.row({
      label: '创建备份',
      desc: '生成一份本地快照',
      onClick: async () => {
        try {
          await api.post('/admin/backup');
          toast('备份创建成功', 'success');
        } catch {
          toast('创建失败', 'error');
        }
      },
    }));

    container.appendChild(wrap);
  }

  /* ─── 构件 ─── */

  makeSection(title) {
    const wrap = el('div', { className: 'settings-section' });
    if (title) {
      wrap.appendChild(el('div', { className: 'settings-section-title label', textContent: title }));
    }
    const body = el('div', { className: 'settings-card' });
    wrap.appendChild(body);
    return { wrap, body };
  }

  row({ label, desc, value, onClick }) {
    const cell = el('div', {
      className: 'cell' + (onClick ? ' tap' : ''),
      ...(onClick ? { onClick } : {}),
    });

    cell.appendChild(el('div', { className: 'cell-main' }, [
      el('div', { className: 'cell-label', textContent: label }),
      desc ? el('div', { className: 'cell-desc', textContent: desc }) : null,
    ]));

    if (value) cell.appendChild(value);
    if (onClick) {
      cell.appendChild(el('span', { className: 'cell-arrow', 'aria-hidden': 'true', textContent: '›' }));
    }

    return cell;
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
