import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';
import { ICONS } from '../utils/icons.js';
import { renderGenderPicker } from './gender.js';

const UI_TO_BACKEND_MOD = { girlfriend: 'female', boyfriend: 'male' };
const BACKEND_TO_UI_MOD = { female: 'girlfriend', male: 'boyfriend', girlfriend: 'girlfriend', boyfriend: 'boyfriend' };

function toBackendMod(mod) {
  return UI_TO_BACKEND_MOD[mod] || mod;
}

function toUiMod(mod) {
  return BACKEND_TO_UI_MOD[mod] || mod;
}

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
      'aria-label': '返回控制台',
      onClick: () => navigate('/console'),
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
    this.buildModelSection(container);
    this.buildAccountSection(container);
    this.buildWorkspaceSection(container);
    this.buildMemorySection(container);
    this.buildProactiveSection(container);
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

  /* ─── 模型 ─── */

  buildModelSection(container) {
    const { wrap, body } = this.makeSection('模型');

    const providerSelect = el('select', {
      className: 'settings-select settings-select--wide',
      name: 'provider',
      'aria-label': '模型服务',
    });
    const modelSelect = el('select', {
      className: 'settings-select settings-select--wide',
      name: 'model',
      'aria-label': '模型',
    });
    const status = el('span', { className: 'settings-model-status', textContent: '加载中' });
    const save = el('button', {
      className: 'settings-apply-btn',
      type: 'button',
      onClick: () => this.saveModelConfig(providerSelect.value, modelSelect.value),
      textContent: '应用',
    });

    body.appendChild(this.row({
      label: '模型服务',
      desc: '选择本地已配置密钥的模型服务',
      value: providerSelect,
    }));
    body.appendChild(this.row({
      label: '模型',
      desc: '切换后下一轮对话立即生效',
      value: modelSelect,
    }));
    body.appendChild(this.row({
      label: '当前生效',
      desc: '后端实际解析后的 provider 和 model',
      value: status,
    }));
    body.appendChild(el('div', { className: 'settings-model-actions' }, [save]));

    const hint = el('div', {
      className: 'settings-hint',
      textContent: '不会显示或保存 API key；这里只选择运行时使用哪个已配置 provider。',
    });
    wrap.appendChild(hint);
    container.appendChild(wrap);

    this.loadModelConfig(providerSelect, modelSelect, status, hint);
  }

  async loadModelConfig(providerSelect, modelSelect, status, hint) {
    try {
      const data = await api.get('/admin/model-config');
      this.modelConfig = data;
      this.populateProviderSelect(providerSelect, data.providers || [], data.current?.provider || 'auto');
      this.populateModelSelect(modelSelect, providerSelect.value, data.current?.model || data.current?.resolvedModel || '');
      this.updateModelStatus(status, data.current);
      this.updateModelHint(hint, data.current);
      this.on(providerSelect, 'change', () => {
        this.populateModelSelect(modelSelect, providerSelect.value, '');
      });
    } catch {
      status.textContent = '读取失败';
      hint.textContent = '模型配置读取失败，请检查服务是否已登录。';
    }
  }

  populateProviderSelect(select, providers, current) {
    select.innerHTML = '';
    for (const provider of providers) {
      const disabled = provider.configured ? undefined : 'disabled';
      const suffix = provider.configured ? '' : ` · 缺少 ${provider.apiKeyEnv || 'key'}`;
      select.appendChild(el('option', {
        value: provider.name,
        textContent: `${provider.label}${suffix}`,
        disabled,
      }));
    }
    select.value = current;
    if (select.value !== current) select.value = 'auto';
  }

  populateModelSelect(select, providerName, currentModel) {
    const provider = (this.modelConfig?.providers || []).find((item) => item.name === providerName);
    select.innerHTML = '';
    if (!provider || provider.name === 'auto') {
      select.appendChild(el('option', { value: '', textContent: '自动使用 provider 默认模型' }));
      select.disabled = true;
      return;
    }

    select.disabled = false;
    for (const model of provider.models || []) {
      select.appendChild(el('option', {
        value: model.id,
        textContent: model.label ? `${model.label} · ${model.id}` : model.id,
      }));
    }
    const desired = currentModel || provider.defaultModel || provider.models?.[0]?.id || '';
    select.value = desired;
    if (select.value !== desired && provider.models?.[0]) {
      select.value = provider.models[0].id;
    }
  }

  updateModelStatus(status, current) {
    if (!current) {
      status.textContent = '未知';
      status.className = 'settings-model-status';
      return;
    }
    status.textContent = `${current.resolvedLabel || current.resolvedProvider} · ${current.resolvedModel || current.model || '默认'}`;
    status.className = `settings-model-status ${current.available ? 'is-ready' : 'is-mock'}`;
  }

  updateModelHint(hint, current) {
    if (!current) return;
    const parts = [];
    if (!current.available) parts.push(current.reason || '当前没有可用真实模型，将使用 MockProvider。');
    if (current.restartEnvOverrides?.provider || current.restartEnvOverrides?.model) {
      parts.push('注意：.env 中的 MIO_PROVIDER / COLA_MODEL 会在下次重启时作为启动默认值。');
    }
    hint.textContent = parts.length
      ? parts.join(' ')
      : '保存后下一轮聊天、微信消息和 OpenAI-compatible 调用都会使用这个模型配置。';
  }

  async saveModelConfig(provider, model) {
    try {
      const data = await api.put('/admin/model-config', {
        provider,
        ...(model ? { model } : {}),
      });
      this.modelConfig = {
        ...(this.modelConfig || {}),
        current: data.current,
      };
      toast('模型配置已应用', 'success');
      const content = this.el.querySelector('#settings-content');
      if (content) this.buildSettings(content);
    } catch (err) {
      toast(err.message || '模型配置保存失败', 'error');
    }
  }

  /* ─── 账户 ─── */

  buildAccountSection(container) {
    const { wrap, body } = this.makeSection('账户');
    const current = Store.get('authUser');
    const legacy = !current && Store.get('authToken');

    const usersValue = el('span', { className: 'settings-model-status', textContent: '加载中' });
    body.appendChild(this.row({
      label: '当前账号',
      desc: current ? `${current.username} · ${current.role}` : legacy ? '本地访问令牌 · owner' : '未启用账号系统',
      value: current || legacy ? el('span', { className: 'settings-model-status is-ready', textContent: current?.role || 'owner' }) : null,
    }));
    body.appendChild(this.row({
      label: '控制台账号',
      desc: '每个管理员使用自己的账号会话，不再共享一个后台令牌',
      value: usersValue,
    }));

    const form = el('div', { className: 'settings-account-form' });
    const username = el('input', {
      className: 'settings-input',
      type: 'text',
      placeholder: '用户名',
      autocomplete: 'off',
      'aria-label': '新账号用户名',
    });
    const password = el('input', {
      className: 'settings-input',
      type: 'password',
      placeholder: '至少 8 位密码',
      autocomplete: 'new-password',
      'aria-label': '新账号密码',
    });
    const role = el('select', {
      className: 'settings-select',
      'aria-label': '新账号角色',
    }, [
      el('option', { value: 'admin', textContent: 'Admin' }),
      el('option', { value: 'viewer', textContent: 'Viewer' }),
    ]);
    const create = el('button', {
      className: 'settings-apply-btn',
      type: 'button',
      onClick: () => this.createConsoleUser(username.value, password.value, role.value),
      textContent: '创建账号',
    });
    form.appendChild(username);
    form.appendChild(password);
    form.appendChild(role);
    form.appendChild(create);
    body.appendChild(form);

    wrap.appendChild(el('div', {
      className: 'settings-hint',
      textContent: '微信试用者不会进入这里；他们用微信联系人身份隔离。这里管理的是产品控制台账号。',
    }));
    container.appendChild(wrap);
    this.loadAccountSection(usersValue, form);
  }

  async loadAccountSection(usersValue, form) {
    try {
      const me = await api.get('/auth/me');
      const auth = me?.auth || {};
      const usersData = await api.get('/admin/users');
      const users = usersData?.users || [];
      usersValue.textContent = `${users.length} 个账号`;
      usersValue.className = 'settings-model-status is-ready';
      const owner = auth.kind === 'legacy' || auth.role === 'owner';
      form.hidden = !owner;
    } catch {
      usersValue.textContent = '读取失败';
      usersValue.className = 'settings-model-status is-mock';
      form.hidden = true;
    }
  }

  async createConsoleUser(username, password, role) {
    const name = String(username || '').trim();
    if (!name || !password) {
      toast('请输入用户名和密码', 'error');
      return;
    }
    try {
      await api.post('/admin/users', { username: name, password, role });
      toast('控制台账号已创建', 'success');
      const content = this.el.querySelector('#settings-content');
      if (content) this.buildSettings(content);
    } catch (err) {
      toast(err.message || '账号创建失败', 'error');
    }
  }

  /* ─── 记忆 ─── */

  buildWorkspaceSection(container) {
    const { wrap, body } = this.makeSection('工作台');

    body.appendChild(this.row({
      label: '人格工作室',
      desc: '编辑 soul、切换模式、管理角色',
      onClick: () => navigate('/studio'),
    }));

    body.appendChild(this.row({
      label: '渠道接入',
      desc: '配置 ClawBot、OpenAI 客户端和 OneBot',
      onClick: () => navigate('/channels'),
    }));

    body.appendChild(this.row({
      label: '消息概览',
      desc: '查看最近聊天、心情入口和当前关系',
      onClick: () => navigate('/messages'),
    }));

    body.appendChild(this.row({
      label: '心情状态',
      desc: '查看 Mio 当前的情绪和关系进度',
      onClick: () => navigate('/mood'),
    }));

    container.appendChild(wrap);
  }

  buildMemorySection(container) {
    const { wrap, body } = this.makeSection('记忆');

    body.appendChild(this.row({
      label: '查看和修正记忆',
      desc: '检查 Mio 记住了什么，删除不该保留的内容',
      onClick: () => navigate('/memories'),
    }));

    wrap.appendChild(el('div', {
      className: 'settings-hint',
      textContent: '长期记忆只有在你能审查和修改时才值得信任。',
    }));

    container.appendChild(wrap);
  }

  /* ─── 主动关心 ─── */

  buildProactiveSection(container) {
    const { wrap, body } = this.makeSection('主动关心');
    const enabledToggle = this.toggleControl(false, async (checked) => {
      await this.saveProactivePreference({ enabled: checked });
    });

    body.appendChild(this.row({
      label: '允许低压力问候',
      desc: '关闭后 Mio 不会主动发起消息',
      value: enabledToggle,
    }));

    const intervalSelect = this.selectControl([
      ['120', '至少 2 小时'],
      ['360', '至少 6 小时'],
      ['720', '至少 12 小时'],
      ['1440', '至少 1 天'],
    ], async (value) => {
      await this.saveProactivePreference({ minIntervalMinutes: Number(value) });
    });

    body.appendChild(this.row({
      label: '最短间隔',
      desc: '限制主动消息频率',
      value: intervalSelect,
    }));

    const quietToggle = this.toggleControl(false, async (checked) => {
      await this.saveProactivePreference({ quietHours: { enabled: checked } });
    });

    body.appendChild(this.row({
      label: '安静时段',
      desc: '开启后 Mio 在该时段不会主动发消息',
      value: quietToggle,
    }));

    const hourOptions = Array.from({ length: 24 }, (_, hour) => [String(hour), `${String(hour).padStart(2, '0')}:00`]);
    const quietStartSelect = this.selectControl(hourOptions, async (value) => {
      await this.saveProactivePreference({ quietHours: { startHour: Number(value) } });
    });
    const quietEndSelect = this.selectControl(hourOptions, async (value) => {
      await this.saveProactivePreference({ quietHours: { endHour: Number(value) } });
    });

    body.appendChild(this.row({
      label: '安静开始',
      desc: '默认 23:00',
      value: quietStartSelect,
    }));

    body.appendChild(this.row({
      label: '安静结束',
      desc: '默认 08:00，结束小时不包含在内',
      value: quietEndSelect,
    }));

    wrap.appendChild(el('div', {
      className: 'settings-hint',
      textContent: '主动消息应该是可关闭、可预测、不过度打扰的。',
    }));

    container.appendChild(wrap);
    this.loadProactivePreferences(enabledToggle, intervalSelect, quietToggle, quietStartSelect, quietEndSelect);
  }

  async loadProactivePreferences(toggle, intervalSelect, quietToggle, quietStartSelect, quietEndSelect) {
    try {
      const data = await api.get('/proactive/preferences');
      const prefs = data?.preferences || {};
      const input = toggle.querySelector('input');
      if (input) input.checked = !!prefs.enabled;
      if (prefs.minIntervalMinutes) intervalSelect.value = String(prefs.minIntervalMinutes);
      const quietInput = quietToggle?.querySelector('input');
      if (quietInput) quietInput.checked = !!prefs.quietHours?.enabled;
      if (Number.isInteger(prefs.quietHours?.startHour)) quietStartSelect.value = String(prefs.quietHours.startHour);
      if (Number.isInteger(prefs.quietHours?.endHour)) quietEndSelect.value = String(prefs.quietHours.endHour);
    } catch {
      toast('主动关心设置读取失败', 'error');
    }
  }

  async saveProactivePreference(patch) {
    try {
      await api.post('/proactive/preferences', patch);
      toast('设置已更新', 'success');
    } catch {
      toast('保存失败', 'error');
      this.buildSettings(this.el.querySelector('#settings-content'));
    }
  }

  /* ─── Mio 性别 ─── */

  buildGenderSection(container) {
    const { wrap, body } = this.makeSection('Mio');
    body.classList.add('gender-setting');

    const initial = toUiMod(Store.get('activeMod'));
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
    const backendMod = toBackendMod(mod);
    try {
      const data = await api.post('/mod', { name: backendMod });
      Store.set('activeMod', toUiMod(data?.activeMod || backendMod));
      toast(mod === 'boyfriend' ? '已切换为他' : '已切换为她', 'success');
    } catch {
      toast('切换失败', 'error');
    }
  }

  async loadGender(body, oldPicker, initial) {
    let gender;
    try {
      const data = await api.get('/status');
      gender = toUiMod(data?.config?.activeMod || data?.config?.gender);
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
    const { wrap, body } = this.makeSection('隐私与数据');

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
      label: '删除单条记忆',
      desc: '打开记忆审查页，移除不该保留的内容',
      onClick: () => navigate('/memories'),
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

  toggleControl(initial, onChange) {
    const input = el('input', { type: 'checkbox', name: 'proactive-enabled' });
    input.checked = !!initial;
    const track = el('span', { className: 'settings-switch-track' });
    const wrap = el('label', { className: 'settings-switch' }, [input, track]);
    this.on(input, 'change', () => onChange(input.checked));
    return wrap;
  }

  selectControl(options, onChange) {
    const select = el('select', { className: 'settings-select', name: 'proactive-interval' });
    options.forEach(([value, label]) => {
      select.appendChild(el('option', { value, textContent: label }));
    });
    this.on(select, 'change', () => onChange(select.value));
    return select;
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
