import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { api } from '../api.js';
import { Store } from '../store.js';
import { ICONS } from '../utils/icons.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';

function canReadProtected() {
  return !!Store.get('authToken') || Store.get('authBypassed') === true;
}

function formatTime(value) {
  if (!value) return '从未';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusLabel(status) {
  const map = {
    wait: '等待扫码',
    scaned: '已扫码',
    confirmed: '已连接',
    expired: '已过期',
    scaned_but_redirect: '切换节点',
    need_verifycode: '需要验证码',
    verify_code_blocked: '验证码受限',
    binded_redirect: '已绑定',
    error: '异常',
  };
  return map[status] || '待连接';
}

function accountShort(accountId = '') {
  if (!accountId) return 'unknown';
  if (accountId.length <= 18) return accountId;
  return `${accountId.slice(0, 8)}...${accountId.slice(-6)}`;
}

function accessModeLabel(mode) {
  return mode === 'allowlist' ? '白名单' : '开放试用';
}

export function companionGateLabel(gate) {
  if (!gate || gate.missing) return '未运行';
  if (gate.error) return '记录异常';
  return gate.ok === true ? '通过' : '未通过';
}

export function companionGateTone(gate) {
  if (!gate || gate.missing) return 'admin-badge--neutral';
  if (gate.ok === true) return 'admin-badge--success';
  return 'admin-badge--warning';
}

export function companionGateSummary(gate) {
  if (!gate || gate.missing) return '还没有微信重启前质量门记录。';
  if (gate.error) return `质量门记录读取失败：${gate.error}`;
  const totals = gate.totals || {};
  const promptAudit = gate.promptAudit || {};
  const replyRubric = gate.replyRubric || {};
  return [
    gate.mode ? `模式 ${gate.mode}` : '',
    Array.isArray(gate.providers) && gate.providers.length ? `模型 ${gate.providers.join(', ')}` : '',
    `回放 ${totals.passed || 0}/${totals.total || 0}`,
    `失败 ${totals.failed || 0}`,
    `prompt errors ${promptAudit.errors || 0}`,
    `rubric failed ${replyRubric.failed || 0}`,
  ].filter(Boolean).join(' · ');
}

function eventLabel(type) {
  const map = {
    'login-started': '二维码生成',
    'account-connected': '账号连接',
    'account-removed': '账号删除',
    'runtime-started': '监听启动',
    'runtime-stopped': '监听停止',
    'runtime-error': '运行异常',
    'polling-error': '轮询异常',
    'settings-updated': '策略更新',
    inbound: '收到消息',
    outbound: '发送回复',
    blocked: '白名单拦截',
    'quota-exceeded': '额度耗尽',
    'unsupported-message': '暂不支持',
  };
  return map[type] || type || '事件';
}

function eventTone(type) {
  if (type === 'blocked' || type === 'quota-exceeded' || type === 'runtime-error' || type === 'polling-error') return 'is-warning';
  if (type === 'account-connected' || type === 'inbound' || type === 'outbound') return 'is-success';
  return 'is-neutral';
}

function parseAllowlist(raw) {
  const seen = new Set();
  String(raw || '').split(/[\n,，\s]+/).forEach((item) => {
    const value = item.trim();
    if (value) seen.add(value);
  });
  return [...seen];
}

export class ChannelsView extends BaseView {
  constructor(params) {
    super(params);
    this.body = null;
    this.statusPill = null;
    this.wechat = null;
    this.loading = false;
    this.polling = false;
    this.pollTimer = null;
    this.verifyInput = null;
  }

  render() {
    this.el = el('div', { className: 'channels-view admin-view' });

    const header = el('header', { className: 'admin-header' }, [
      el('div', { className: 'admin-heading' }, [
        el('div', { className: 'admin-kicker', textContent: '微信接入' }),
        el('h1', { className: 'admin-title', textContent: '微信连接控制台' }),
      ]),
    ]);

    this.statusPill = el('span', { className: 'admin-status-pill', textContent: '检查中' });
    header.appendChild(el('div', { className: 'admin-header-actions' }, [
      this.statusPill,
      this.headerButton('刷新状态', () => this.load()),
    ]));

    this.body = el('div', { className: 'admin-content' });
    this.el.appendChild(header);
    this.el.appendChild(this.body);
    this.renderContent();
    return this.el;
  }

  mount() {
    this.load();
  }

  unmount() {
    this.stopPolling();
  }

  async load() {
    if (!canReadProtected()) {
      this.wechat = null;
      this.updateHeaderStatus(false, '需要令牌');
      this.renderContent();
      return;
    }

    this.loading = true;
    this.renderContent();
    try {
      this.wechat = await api.get('/admin/wechat-native/status');
      const running = this.wechat?.runtime?.running === true;
      const hasAccount = (this.wechat?.accounts || []).length > 0;
      this.updateHeaderStatus(running, running ? '微信在线' : hasAccount ? '已连接' : '待扫码');
    } catch (err) {
      this.wechat = null;
      this.updateHeaderStatus(false, '连接失败');
      toast(err.message || '微信状态读取失败', 'error');
    } finally {
      this.loading = false;
      this.renderContent();
    }
  }

  updateHeaderStatus(online, text) {
    if (!this.statusPill) return;
    this.statusPill.textContent = text;
    this.statusPill.classList.toggle('is-online', online);
  }

  renderContent() {
    if (!this.body) return;
    this.body.innerHTML = '';

    if (!canReadProtected()) {
      this.body.appendChild(this.lockedPanel());
      return;
    }

    this.body.appendChild(this.connectionHero());
    this.body.appendChild(this.companionGatePanel());
    this.body.appendChild(this.trialControlPanel());
    this.body.appendChild(this.accountPanel());
    this.body.appendChild(this.eventPanel());
    this.body.appendChild(this.operationPanel());
    this.body.appendChild(this.isolationPanel());
  }

  lockedPanel() {
    return el('section', { className: 'channels-connect admin-panel' }, [
      el('div', { className: 'channels-connect-copy' }, [
        el('div', { className: 'admin-kicker', textContent: '需要访问令牌' }),
        el('h2', { className: 'channels-scan-title', textContent: '微信连接控制台需要登录' }),
        el('p', {
          className: 'channels-scan-copy',
          textContent: '这里会生成微信连接二维码并保存 iLink bot 登录态，所以必须先通过 Mio 管理令牌进入。',
        }),
      ]),
      el('button', {
        className: 'admin-btn admin-btn--primary',
        type: 'button',
        onClick: () => navigate('/auth'),
        textContent: '去登录',
      }),
    ]);
  }

  connectionHero() {
    const login = this.wechat?.login || {};
    const accounts = this.wechat?.accounts || [];
    const runningCount = this.wechat?.runtime?.runningCount || 0;
    const settings = this.wechat?.settings || {};
    const qrcodeUrl = login.active ? (login.qrImageDataUrl || login.qrcodeUrl) : '';
    const connected = runningCount > 0;

    const qrBox = qrcodeUrl
      ? el('div', { className: 'channels-qr-frame channels-qr-frame--image' }, [
        el('img', {
          src: qrcodeUrl,
          alt: '微信连接二维码',
          onError: (event) => {
            event.currentTarget.replaceWith(el('div', {
              className: 'channels-qr-placeholder',
              textContent: '二维码加载失败，请重新生成',
            }));
          },
        }),
      ])
      : el('div', { className: 'channels-qr-frame' }, [
        el('div', { className: 'channels-qr-placeholder' }, [
          el('strong', { textContent: connected ? '微信已在线' : '等待生成二维码' }),
          el('span', {
            textContent: connected
              ? '已保存的微信 bot 正在监听消息。需要换号时再重新生成二维码。'
              : '点击右侧按钮生成微信连接二维码，用微信扫码确认。',
          }),
        ]),
      ]);

    const verifyRow = login.needsVerifyCode
      ? el('div', { className: 'channels-verify-row' }, [
        this.verifyInput = el('input', {
          className: 'channels-field',
          type: 'text',
          inputMode: 'numeric',
          placeholder: '输入手机上显示的数字',
          'aria-label': '微信验证码',
        }),
        el('button', {
          className: 'admin-btn admin-btn--primary',
          type: 'button',
          onClick: () => this.pollLogin(this.verifyInput?.value || ''),
          textContent: '提交验证码',
        }),
      ])
      : null;

    return el('section', { className: 'channels-native-hero admin-panel' }, [
      el('div', { className: 'channels-native-main' }, [
        el('div', { className: 'admin-kicker', textContent: 'Native iLink' }),
        el('h2', { className: 'channels-hero-title', textContent: 'Mio 直接连接微信 bot，不再暴露配置给试用者' }),
        el('p', {
          className: 'channels-hero-copy',
          textContent: '扫码后 Mio 保存微信 iLink bot 身份，后台长轮询收消息，并把每个微信联系人路由到独立会话。试用者只需要在微信里发消息。',
        }),
        el('div', { className: 'channels-native-stats' }, [
          this.stat('运行账号', `${runningCount}/${accounts.length}`),
          this.stat('试用模式', accessModeLabel(settings.accessMode)),
          this.stat('每日额度', settings.dailyLimitPerUser ? `${settings.dailyLimitPerUser}/人` : '不限'),
        ]),
        el('div', { className: 'channels-hero-actions' }, [
          el('button', {
            className: 'admin-btn admin-btn--primary',
            type: 'button',
            disabled: this.loading ? 'disabled' : undefined,
            onClick: () => this.startLogin(true),
            textContent: login.active ? '刷新二维码' : '生成连接二维码',
          }),
          el('button', {
            className: 'admin-btn admin-btn--secondary',
            type: 'button',
            onClick: () => this.runtimeAction('restart'),
            textContent: '重启微信连接',
          }),
          el('button', {
            className: 'admin-btn admin-btn--secondary',
            type: 'button',
            onClick: () => this.runtimeAction(connected ? 'stop' : 'start'),
            textContent: connected ? '停止监听' : '启动监听',
          }),
          el('button', {
            className: 'admin-btn admin-btn--secondary',
            type: 'button',
            onClick: () => navigate('/chat'),
            textContent: '网页先测一下',
          }),
        ]),
      ]),
      el('div', { className: 'channels-connect-card' }, [
        el('div', { className: 'channels-connect-head' }, [
          el('span', {
            className: `channels-live-dot ${connected ? 'is-on' : ''}`,
            'aria-hidden': 'true',
          }),
          el('strong', { textContent: login.active ? statusLabel(login.status) : connected ? '监听中' : '未连接' }),
        ]),
        qrBox,
        el('p', {
          className: 'channels-connect-note',
          textContent: login.message || (connected ? '收到微信消息后会自动进入 Mio turn loop。' : '生成二维码后，打开微信扫一扫完成连接。'),
        }),
        verifyRow,
      ].filter(Boolean)),
    ]);
  }

  stat(label, value) {
    return el('div', { className: 'channels-stat' }, [
      el('span', { textContent: label }),
      el('strong', { textContent: value }),
    ]);
  }

  companionGatePanel() {
    const gate = this.wechat?.companionGate;
    const providerRows = (gate?.providerReports || []).slice(0, 4).map((item) =>
      el('div', { className: 'channels-matrix-row' }, [
        el('strong', { textContent: `${item.ok ? '通过' : '未过'} ${item.provider}${item.model ? `/${item.model}` : ''}` }),
        el('code', { textContent: item.summaryPath || '无 summary' }),
        el('span', { textContent: `失败 ${item.failed || 0} · prompt ${item.promptAuditErrors || 0} · rubric ${item.replyRubricFailed || 0}` }),
      ]),
    );

    return el('section', { className: 'admin-section' }, [
      el('div', { className: 'admin-section-head' }, [
        el('div', {}, [
          el('h2', { className: 'admin-section-title', textContent: '重启前质量门' }),
          el('p', {
            className: 'admin-section-copy',
            textContent: companionGateSummary(gate),
          }),
        ]),
        el('span', {
          className: `admin-badge ${companionGateTone(gate)}`,
          textContent: companionGateLabel(gate),
        }),
      ]),
      el('div', { className: 'channels-matrix admin-panel' }, [
        el('div', { className: 'channels-matrix-row' }, [
          el('strong', { textContent: '报告' }),
          el('code', { textContent: gate?.reportPath || '未生成' }),
          el('span', { textContent: gate?.generatedAt ? `生成 ${formatTime(gate.generatedAt)}` : '等待下一次 wechat:preflight' }),
        ]),
        ...providerRows,
      ]),
    ]);
  }

  accountPanel() {
    const accounts = this.wechat?.accounts || [];

    return el('section', { className: 'admin-section' }, [
      el('div', { className: 'admin-section-head' }, [
        el('h2', { className: 'admin-section-title', textContent: '已连接账号' }),
        el('p', {
          className: 'admin-section-copy',
          textContent: '每次扫码会保存一个 iLink bot 身份。多个账号可以同时在线，Mio 会按账号和微信联系人分开会话。',
        }),
      ]),
      accounts.length
        ? el('div', { className: 'channels-account-list admin-panel' }, accounts.map((account) => this.accountRow(account)))
        : el('div', { className: 'channels-empty admin-panel' }, [
          el('strong', { textContent: '还没有微信账号连接' }),
          el('span', { textContent: '生成二维码并扫码确认后，这里会出现 bot 身份和运行状态。' }),
        ]),
    ]);
  }

  accountRow(account) {
    const running = account.running === true;
    return el('div', { className: 'channels-account-row' }, [
      el('div', { className: 'channels-account-main' }, [
        el('div', { className: 'channels-account-title' }, [
          el('span', { className: `channels-live-dot ${running ? 'is-on' : ''}`, 'aria-hidden': 'true' }),
          el('strong', { textContent: accountShort(account.accountId) }),
        ]),
        el('span', {
          className: 'channels-account-meta',
          textContent: account.userId ? `扫码用户 ${accountShort(account.userId)}` : '未记录扫码用户',
        }),
      ]),
      el('div', { className: 'channels-account-metrics' }, [
        this.miniMetric('保存', formatTime(account.savedAt)),
        this.miniMetric('收消息', formatTime(account.lastInboundAt)),
        this.miniMetric('发消息', formatTime(account.lastOutboundAt)),
      ]),
      el('div', { className: 'channels-account-actions' }, [
        el('span', {
          className: `admin-badge ${account.needsRelogin ? 'admin-badge--warning' : running ? 'admin-badge--success' : 'admin-badge--neutral'}`,
          textContent: account.needsRelogin ? '需重新扫码' : running ? '运行中' : '已停止',
        }),
        el('button', {
          className: 'admin-icon-btn',
          type: 'button',
          title: '删除账号',
          onClick: () => this.deleteAccount(account.accountId),
        }, ICONS.trash ? [ICONS.trash(16)] : [document.createTextNode('删')]),
      ]),
      account.lastError
        ? el('p', { className: 'channels-account-error', textContent: account.lastError })
        : null,
    ].filter(Boolean));
  }

  miniMetric(label, value) {
    return el('div', { className: 'channels-mini-metric' }, [
      el('span', { textContent: label }),
      el('strong', { textContent: value }),
    ]);
  }

  trialControlPanel() {
    const settings = this.wechat?.settings || {};
    const allowedUsers = settings.allowedUsers || [];
    const accessSelect = el('select', {
      className: 'channels-field',
      'aria-label': '试用模式',
    }, [
      el('option', { value: 'open', textContent: '开放试用' }),
      el('option', { value: 'allowlist', textContent: '白名单内测' }),
    ]);
    accessSelect.value = settings.accessMode || 'open';

    const limitInput = el('input', {
      className: 'channels-field',
      type: 'number',
      min: '0',
      max: '500',
      step: '1',
      value: String(settings.dailyLimitPerUser || 0),
      'aria-label': '每日额度',
    });

    const usersArea = el('textarea', {
      className: 'channels-field channels-field--area',
      placeholder: '每行一个微信联系人 ID',
      'aria-label': '白名单用户',
    });
    usersArea.value = allowedUsers.join('\n');

    return el('section', { className: 'admin-section' }, [
      el('div', { className: 'admin-section-head' }, [
        el('div', {}, [
          el('h2', { className: 'admin-section-title', textContent: '试用策略' }),
          el('p', {
            className: 'admin-section-copy',
            textContent: '开放试用适合邀请朋友直接在微信里体验；白名单模式适合小范围内测。额度按微信联系人独立计算。',
          }),
        ]),
      ]),
      el('div', { className: 'channels-trial-grid admin-panel' }, [
        this.fieldBlock('模式', '试用者是否需要进入白名单', accessSelect),
        this.fieldBlock('每日额度', '0 表示不限，建议公开试用时设置上限', limitInput),
        this.fieldBlock('白名单', '最近事件里出现的联系人可以一键加入', usersArea, true),
        el('div', { className: 'channels-trial-actions' }, [
          el('button', {
            className: 'admin-btn admin-btn--primary',
            type: 'button',
            onClick: () => this.saveWechatSettings({
              accessMode: accessSelect.value,
              dailyLimitPerUser: Number.parseInt(limitInput.value, 10) || 0,
              allowedUsers: parseAllowlist(usersArea.value),
            }),
            textContent: '保存试用策略',
          }),
        ]),
      ]),
    ]);
  }

  fieldBlock(label, hint, control, wide = false) {
    return el('label', { className: `channels-field-row ${wide ? 'channels-field-row--wide' : ''}` }, [
      el('span', { className: 'channels-field-label', textContent: label }),
      control,
      el('span', { className: 'channels-field-hint', textContent: hint }),
    ]);
  }

  eventPanel() {
    const events = this.wechat?.recentEvents || [];
    const settings = this.wechat?.settings || {};
    const allowed = new Set(settings.allowedUsers || []);

    return el('section', { className: 'admin-section' }, [
      el('div', { className: 'admin-section-head' }, [
        el('div', {}, [
          el('h2', { className: 'admin-section-title', textContent: '最近事件' }),
          el('p', {
            className: 'admin-section-copy',
            textContent: '用于确认二维码、监听状态、联系人隔离和试用拦截是否按预期工作。',
          }),
        ]),
        el('button', {
          className: 'admin-btn admin-btn--secondary',
          type: 'button',
          onClick: () => this.load(),
          textContent: '刷新',
        }),
      ]),
      events.length
        ? el('div', { className: 'channels-event-list admin-panel' }, events.map((event) => this.eventRow(event, allowed)))
        : el('div', { className: 'channels-empty admin-panel' }, [
          el('strong', { textContent: '还没有微信事件' }),
          el('span', { textContent: '生成二维码、扫码、收发消息或调整策略后，这里会出现审计记录。' }),
        ]),
    ]);
  }

  eventRow(event, allowed) {
    const canAdd = event.userId && !allowed.has(event.userId);
    return el('div', { className: `channels-event-row ${eventTone(event.type)}` }, [
      el('div', { className: 'channels-event-main' }, [
        el('div', { className: 'channels-event-title' }, [
          el('span', { className: 'channels-event-type', textContent: eventLabel(event.type) }),
          el('time', { textContent: formatTime(event.timestamp) }),
        ]),
        el('div', { className: 'channels-event-meta', textContent: [
          event.userId ? `联系人 ${accountShort(event.userId)}` : '',
          event.accountId ? `账号 ${accountShort(event.accountId)}` : '',
          event.sessionId ? `会话 ${accountShort(event.sessionId)}` : '',
        ].filter(Boolean).join(' · ') || '系统事件' }),
        event.detail ? el('div', { className: 'channels-event-detail', textContent: event.detail }) : null,
      ].filter(Boolean)),
      canAdd
        ? el('button', {
          className: 'admin-btn admin-btn--secondary channels-event-action',
          type: 'button',
          onClick: () => this.addUserToAllowlist(event.userId),
          textContent: '加入白名单',
        })
        : null,
    ].filter(Boolean));
  }

  operationPanel() {
    const steps = [
      ['扫码连接', '在这里生成二维码，用微信确认授权。'],
      ['后台监听', 'Mio 使用 getUpdates 长轮询，不需要公网 webhook。'],
      ['微信聊天', '用户在微信里发消息，Mio 生成回复并 sendMessage 发回。'],
      ['持续运营', 'systemd / Docker 常驻运行，账号 token 和记忆保存在 data/。'],
    ];

    return el('section', { className: 'admin-section' }, [
      el('div', { className: 'admin-section-head' }, [
        el('h2', { className: 'admin-section-title', textContent: '产品路径' }),
        el('p', {
          className: 'admin-section-copy',
          textContent: '这条路径不要求试用者配置模型地址、令牌或 provider；微信就是用户入口。',
        }),
      ]),
      el('div', { className: 'channels-flow' }, steps.map(([title, desc], index) =>
        el('div', { className: 'channels-step admin-panel' }, [
          el('span', { className: 'channels-step-index', textContent: String(index + 1).padStart(2, '0') }),
          el('strong', { textContent: title }),
          el('p', { textContent: desc }),
        ]),
      )),
    ]);
  }

  isolationPanel() {
    const rows = [
      ['会话 ID', 'wechat-native-<account>-<contact>', '账号 + 联系人隔离'],
      ['对话记录', 'data/transcripts/<sessionId>.jsonl', '按微信联系人分开'],
      ['偏好/人格增量', 'data/users/<sessionId>/', '每个联系人单独保存'],
      ['情绪上下文', 'neutral context', '不继承管理端主人状态'],
      ['当前能力', '文本 / 语音转文字', '媒体和群聊策略下一阶段补齐'],
    ];

    return el('section', { className: 'admin-section' }, [
      el('div', { className: 'admin-section-head' }, [
        el('h2', { className: 'admin-section-title', textContent: '隔离与边界' }),
        el('p', {
          className: 'admin-section-copy',
          textContent: '先把最关键的多人试用安全边界做实，再逐步补媒体、白名单、额度和审计。',
        }),
      ]),
      el('div', { className: 'channels-matrix admin-panel' }, rows.map(([area, storage, state]) =>
        el('div', { className: 'channels-matrix-row' }, [
          el('strong', { textContent: area }),
          el('code', { textContent: storage }),
          el('span', { textContent: state }),
        ]),
      )),
    ]);
  }

  async startLogin(force = false) {
    try {
      const data = await api.post('/admin/wechat-native/login/start', { force });
      this.wechat = {
        ...(this.wechat || {}),
        login: data.login,
      };
      toast('微信二维码已生成', 'success');
      this.renderContent();
      this.startPolling();
    } catch (err) {
      toast(err.message || '二维码生成失败', 'error');
    }
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    this.pollLoginLoop();
  }

  stopPolling() {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollLoginLoop() {
    if (!this.polling) return;
    const sessionKey = this.wechat?.login?.sessionKey;
    if (!sessionKey) {
      this.stopPolling();
      return;
    }

    await this.pollLogin();

    if (this.wechat?.login?.active) {
      this.pollTimer = setTimeout(() => this.pollLoginLoop(), 800);
    } else {
      this.stopPolling();
    }
  }

  async pollLogin(verifyCode = '') {
    const sessionKey = this.wechat?.login?.sessionKey;
    if (!sessionKey) return;
    try {
      const data = await api.post('/admin/wechat-native/login/poll', {
        sessionKey,
        ...(verifyCode.trim() ? { verifyCode: verifyCode.trim() } : {}),
      }, { timeout: 35000 });
      this.wechat = data.status || {
        ...(this.wechat || {}),
        login: data.login,
      };
      if (data.connected) {
        toast('微信已连接', 'success');
      }
      this.renderContent();
    } catch (err) {
      toast(err.message || '微信连接状态读取失败', 'error');
      this.stopPolling();
      await this.load();
    }
  }

  async runtimeAction(action) {
    try {
      const data = await api.post(`/admin/wechat-native/runtime/${action}`, {});
      this.wechat = data.status || this.wechat;
      toast(action === 'stop' ? '微信连接已停止' : '微信连接已启动', 'success');
      this.renderContent();
    } catch (err) {
      toast(err.message || '操作失败', 'error');
    }
  }

  async saveWechatSettings(patch) {
    try {
      const data = await api.put('/admin/wechat-native/settings', patch);
      this.wechat = data.status || this.wechat;
      toast('微信试用策略已保存', 'success');
      this.renderContent();
    } catch (err) {
      toast(err.message || '试用策略保存失败', 'error');
    }
  }

  async addUserToAllowlist(userId) {
    const settings = this.wechat?.settings || {};
    const users = new Set(settings.allowedUsers || []);
    users.add(userId);
    await this.saveWechatSettings({ allowedUsers: [...users] });
  }

  async deleteAccount(accountId) {
    const ok = window.confirm('删除这个微信连接？删除后需要重新扫码。');
    if (!ok) return;
    try {
      const data = await api.del(`/admin/wechat-native/accounts/${encodeURIComponent(accountId)}`);
      this.wechat = data.status || this.wechat;
      toast('微信连接已删除', 'success');
      this.renderContent();
    } catch (err) {
      toast(err.message || '删除失败', 'error');
    }
  }

  headerButton(label, onClick) {
    return el('button', {
      className: 'admin-btn admin-btn--secondary',
      type: 'button',
      onClick,
      textContent: label,
    });
  }
}

let channelsViewInstance = null;

export function renderChannels(params) {
  channelsViewInstance = new ChannelsView(params);
  return channelsViewInstance.render();
}

export function mountChannels() {
  channelsViewInstance?.mount();
}

export function unmountChannels() {
  if (channelsViewInstance) {
    channelsViewInstance.unmount();
    channelsViewInstance = null;
  }
}
