import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { wsManager } from '../ws.js';
import { navigate } from '../router.js';
import { renderGenderPicker } from './gender.js';
import { mascotSrc } from '../mascot.js';
import { toast } from '../components/toast.js';
import { ICONS } from '../utils/icons.js';

const BUILTIN_MODS = ['female', 'male'];
const UI_TO_BACKEND_GENDER = { girlfriend: 'female', boyfriend: 'male', female: 'female', male: 'male' };
const BACKEND_TO_UI_GENDER = { female: 'girlfriend', male: 'boyfriend', girlfriend: 'girlfriend', boyfriend: 'boyfriend' };

/* 内部 mod 名 → 用户可见称呼(UI 永不显示 girlfriend/boyfriend) */
const PRONOUN = { female: '她', male: '他', girlfriend: '她', boyfriend: '他' };
const displayName = (name) => PRONOUN[name] || name;
const toBackendGender = (gender) => UI_TO_BACKEND_GENDER[gender] || gender;
const toUiGender = (gender) => BACKEND_TO_UI_GENDER[gender] || gender;

function formatCharacterTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/* 圆形头像 — 复用 components.css 的 .avatar + 线条猫立绘。
   资源缺失时隐藏 img,露出 .avatar 的 --surface 圆底兜底(best-effort 降级)。 */
function modAvatar(extraClass = '', expr = 'gentle') {
  const wrap = el('div', { className: `avatar ${extraClass}`.trim(), 'aria-hidden': 'true' });
  wrap.appendChild(el('img', {
    alt: '',
    src: mascotSrc(expr),
    onError: (e) => { e.target.style.display = 'none'; },
  }));
  return wrap;
}

export class StudioView extends BaseView {
  constructor(params) {
    super(params);
    this._wizardState = null;
  }

  render() {
    this.el = el('div', { className: 'studio-view' });

    /* 顶栏 */
    const header = el('header', { className: 'studio-header' });
    const backBtn = el('button', {
      className: 'studio-back-btn tap',
      'aria-label': '返回聊天',
      onClick: () => navigate('/chat'),
    });
    backBtn.appendChild(ICONS.back(18));
    const title = el('h1', { className: 'studio-header-title title', textContent: this.params.id ? '编辑人格' : '人格工作室' });
    const newBtn = el('button', {
      className: 'studio-new-btn tap',
      'aria-label': '新建人格',
      textContent: '+',
      onClick: () => this.startNewMod(),
    });

    header.appendChild(backBtn);
    header.appendChild(title);
    header.appendChild(newBtn);
    this.el.appendChild(header);

    const content = el('div', { className: 'studio-content', id: 'studio-content' });
    this.el.appendChild(content);

    return this.el;
  }

  mount() {
    const content = this.el.querySelector('#studio-content');
    if (content) this.loadModList(content);
  }

  /* unmount 由 BaseView 统一处理(无 Canvas 资源需额外清理) */

  /* ─── 加载 Mod 列表 ─── */
  async loadModList(container) {
    container.innerHTML = '';

    /* 先展示骨架 */
    container.appendChild(this.skeletonModList());

    try {
      const [data, characterData] = await Promise.all([
        api.get('/status'),
        api.get('/characters').catch(() => null),
      ]);
      const mods = this.buildModList(data);

      container.innerHTML = '';
      container.appendChild(this.renderModGallery(mods, data, characterData?.data || []));
    } catch {
      container.innerHTML = '';
      container.appendChild(el('div', { className: 'studio-state' }, [
        el('p', { className: 'studio-state-text', textContent: '加载失败，请检查连接' }),
      ]));
    }
  }

  buildModList(statusData) {
    const mods = [];

    /* 内置 male/female */
    for (const name of BUILTIN_MODS) {
      mods.push({
        name,
        gender: name,
        style: this.getStyleForMod(name, statusData),
        active: statusData?.config?.activeMod === name,
      });
    }

    /* 自定义 Mod (从后端获取) */
    if (statusData?.mods) {
      for (const m of statusData.mods) {
        if (!BUILTIN_MODS.includes(m.name)) {
          mods.push({ ...m, active: statusData.config?.activeMod === m.name });
        }
      }
    }

    return mods;
  }

  getStyleForMod(name, data) {
    /* 尝试从 soul 内容推断风格 */
    if (name === 'male') return '默认 · 他';
    if (name === 'female') return '默认 · 她';
    return '自定义';
  }

  /* ─── Mod 画廊渲染 ─── */
  renderModGallery(mods, statusData, characters = []) {
    const frag = document.createDocumentFragment();

    /* 当前活跃 */
    const activeMods = mods.filter(m => m.active);
    const inactiveMods = mods.filter(m => !m.active);

    if (activeMods.length > 0) {
      frag.appendChild(el('div', { className: 'mod-section' }, [
        el('div', { className: 'mod-section-title label', textContent: '当前活跃' }),
        this.renderActiveDetail(activeMods[0], statusData),
      ]));
    }

    /* 其他人格 */
    if (inactiveMods.length > 0) {
      frag.appendChild(el('div', { className: 'mod-section' }, [
        el('div', { className: 'mod-section-title label', textContent: '其他人格' }),
        el('div', { className: 'mod-cards' }, [
          ...inactiveMods.map(mod => this.renderModCard(mod)),
          this.renderNewCard(),
        ]),
      ]));
    } else {
      frag.appendChild(el('div', { className: 'mod-section' }, [
        el('div', { className: 'mod-section-title label', textContent: '其他人格' }),
        el('div', { className: 'mod-cards' }, [this.renderNewCard()]),
      ]));
    }

    frag.appendChild(this.renderCharacterSection(characters, statusData));

    return frag;
  }

  renderActiveDetail(mod, statusData) {
    const card = el('div', { className: 'mod-detail-card' });

    /* 头部 */
    const header = el('div', { className: 'mod-detail-header' });
    header.appendChild(modAvatar('mod-detail-avatar'));

    const info = el('div', { className: 'mod-detail-info' });
    info.appendChild(el('div', { className: 'mod-detail-name', textContent: displayName(mod.name) }));
    info.appendChild(el('div', { className: 'mod-detail-meta', textContent: mod.style }));
    header.appendChild(info);
    card.appendChild(header);

    /* 日常 / 深度 切换 */
    const mode = statusData?.personaMode || Store.get('personaMode') || 'base';
    const modeSwitch = el('div', { className: 'mode-switch' });
    modeSwitch.appendChild(el('span', { className: 'mode-switch-label', textContent: '陪伴模式' }));
    const chips = el('div', { className: 'mode-chips' });
    const baseChip = el('button', {
      className: `mode-chip${mode === 'base' ? ' selected' : ''}`,
      textContent: '日常',
      dataset: { mode: 'base' },
      onClick: () => this.switchMode('base', chips),
    });
    const deepChip = el('button', {
      className: `mode-chip${mode === 'deep' ? ' selected' : ''}`,
      textContent: '深度',
      dataset: { mode: 'deep' },
      onClick: () => this.switchMode('deep', chips),
    });
    chips.appendChild(baseChip);
    chips.appendChild(deepChip);
    modeSwitch.appendChild(chips);
    card.appendChild(modeSwitch);

    /* 好感度 — 复用 .progress 组件 */
    const aff = statusData?.emotion?.affection || 0;
    card.appendChild(el('div', { className: 'affection-bar' }, [
      el('div', { className: 'affection-bar-label' }, [
        el('span', { textContent: '好感度' }),
        el('span', { textContent: `${aff}` }),
      ]),
      el('div', { className: 'progress' }, [
        el('i', { style: { width: `${aff}%` } }),
      ]),
    ]));

    /* soul 预览 */
    card.appendChild(el('div', { className: 'soul-preview' }, [
      el('pre', { textContent: '加载中…' }),
    ]));

    /* 操作 */
    const actions = el('div', { className: 'mod-actions' });
    actions.appendChild(el('button', { className: 'btn-secondary', textContent: '编辑 soul', onClick: () => this.editSoul(mod.name) }));
    actions.appendChild(el('button', { className: 'btn-secondary', textContent: '切换模式', onClick: () => this.switchMode(mode === 'base' ? 'deep' : 'base', chips) }));
    card.appendChild(actions);

    /* 异步加载 soul 预览 */
    this.loadSoulPreview(mod.name, card.querySelector('.soul-preview pre'));

    return card;
  }

  renderModCard(mod) {
    const isActive = mod.active;

    const card = el('div', {
      className: `mod-card${isActive ? ' active' : ''}`,
      onClick: async () => {
        if (isActive) return;
        try {
          await api.post('/mod', { name: mod.name });
          wsManager.switchMod(mod.name);
          toast('已切换人格', 'success');
          Store.set('activeMod', mod.name);
          const container = this.el.querySelector('#studio-content');
          if (container) this.loadModList(container);
        } catch (e) {
          toast(e.message || '切换失败', 'error');
        }
      },
    });

    card.appendChild(modAvatar('mod-card-avatar'));
    card.appendChild(el('div', { className: 'mod-card-name', textContent: displayName(mod.name) }));
    card.appendChild(el('div', { className: 'mod-card-style', textContent: mod.style }));

    return card;
  }

  renderNewCard() {
    return el('div', {
      className: 'mod-card mod-card-new',
      onClick: () => this.startNewMod(),
    }, [
      el('div', { className: 'plus', textContent: '+' }),
      el('div', { className: 'mod-card-new-label', textContent: '新建人格' }),
    ]);
  }

  renderCharacterSection(characters, statusData) {
    const activeMod = statusData?.config?.activeMod;
    const section = el('div', { className: 'mod-section character-section' }, [
      el('div', { className: 'mod-section-title label', textContent: '角色生命' }),
    ]);

    if (!characters.length) {
      section.appendChild(el('div', { className: 'studio-state studio-state--compact' }, [
        el('p', { className: 'studio-state-text', textContent: '还没有可管理的角色。' }),
      ]));
      return section;
    }

    const list = el('div', { className: 'character-list' });
    characters.forEach((character) => {
      list.appendChild(this.renderCharacterCard(character, activeMod));
    });
    section.appendChild(list);
    return section;
  }

  renderCharacterCard(character, activeMod) {
    const cfg = character.config || {};
    const active = character.id === activeMod || character.active;
    const body = el('div', { className: `character-card${active ? ' active' : ''}` });

    body.appendChild(el('div', { className: 'character-card-main' }, [
      modAvatar('character-avatar', active ? 'happy' : 'gentle'),
      el('div', { className: 'character-info' }, [
        el('div', { className: 'character-name', textContent: cfg.name || displayName(character.id) }),
        el('div', { className: 'character-meta', textContent: [displayName(cfg.gender || character.id), cfg.occupation, cfg.style].filter(Boolean).join(' · ') }),
      ]),
      active ? el('span', { className: 'character-badge', textContent: '使用中' }) : null,
    ]));

    const actions = el('div', { className: 'character-actions' }, [
      el('button', {
        className: 'btn-secondary',
        type: 'button',
        textContent: '生活',
        onClick: () => this.toggleCharacterLife(character.id, body),
      }),
    ]);

    if (!active) {
      actions.appendChild(el('button', {
        className: 'btn-primary',
        type: 'button',
        textContent: '激活',
        onClick: () => this.activateCharacter(character.id),
      }));
    }

    if (character.isCustom && !active) {
      actions.appendChild(el('button', {
        className: 'btn-secondary character-danger',
        type: 'button',
        textContent: '删除',
        onClick: () => this.deleteCharacter(character.id),
      }));
    }

    body.appendChild(actions);
    return body;
  }

  async activateCharacter(id) {
    try {
      const result = await api.post(`/character/${encodeURIComponent(id)}/activate`);
      const activeMod = result?.data?.activeMod || id;
      Store.set('activeMod', activeMod);
      wsManager.switchMod(activeMod);
      toast('角色已激活', 'success');
      const container = this.el.querySelector('#studio-content');
      if (container) this.loadModList(container);
    } catch (err) {
      toast(err.message || '激活失败', 'error');
    }
  }

  async deleteCharacter(id) {
    try {
      await api.del(`/character/${encodeURIComponent(id)}`);
      toast('角色已删除', 'success');
      const container = this.el.querySelector('#studio-content');
      if (container) this.loadModList(container);
    } catch (err) {
      toast(err.message || '删除失败', 'error');
    }
  }

  async toggleCharacterLife(id, card) {
    const existing = card.querySelector('.character-life');
    if (existing) {
      existing.remove();
      return;
    }

    const panel = el('div', { className: 'character-life' }, [
      el('div', { className: 'character-life-state', textContent: '读取中…' }),
    ]);
    card.appendChild(panel);

    try {
      const data = await api.get(`/character/${encodeURIComponent(id)}/life`);
      const events = data?.data?.events || [];
      const stats = data?.data?.stats || {};
      panel.innerHTML = '';
      panel.appendChild(el('div', {
        className: 'character-life-summary',
        textContent: `事件 ${stats.total || events.length || 0} · 重要 ${stats.important || 0}`,
      }));
      if (!events.length) {
        panel.appendChild(el('div', { className: 'character-life-state', textContent: '还没有生活事件。' }));
        return;
      }
      events.slice(0, 5).forEach((event) => {
        panel.appendChild(el('div', { className: 'character-life-event' }, [
          el('div', { className: 'character-life-time', textContent: formatCharacterTime(event.timestamp) }),
          el('div', { className: 'character-life-text', textContent: event.description || event.content || '生活事件' }),
        ]));
      });
    } catch {
      panel.innerHTML = '';
      panel.appendChild(el('div', { className: 'character-life-state', textContent: '生活事件读取失败。' }));
    }
  }

  /* ─── 新建 Mod 向导 ─── */
  startNewMod() {
    this._wizardState = {
      step: 1,
      name: '',
      gender: 'female',
      style: '',
      age: '',
      occupation: '',
      traits: [],
    };

    this.renderWizard(1);
  }

  renderWizard(step) {
    const container = this.el.querySelector('#studio-content');
    if (!container) return;

    container.innerHTML = '';

    /* 步骤指示器 */
    container.appendChild(el('div', { className: 'step-indicator' }, [1, 2, 3].map(i => {
      const done = i < step;
      const current = i === step;
      const cls = `step-dot${done ? ' done' : ''}${current ? ' current' : ''}`;
      const frag = document.createDocumentFragment();
      frag.appendChild(el('div', { className: cls }));
      if (i < 3) frag.appendChild(el('div', { className: `step-line${done ? ' done' : ''}` }));
      return frag;
    })));

    switch (step) {
      case 1: this.renderWizardStep1(container); break;
      case 2: this.renderWizardStep2(container); break;
      case 3: this.renderWizardStep3(container); break;
    }
  }

  renderWizardStep1(container) {
    const form = el('div', {});

    /* 名字 */
    form.appendChild(el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label', textContent: '名字' }),
      el('input', {
        className: 'form-input',
        type: 'text',
        placeholder: '给你的 Ta 起个名字',
        value: this._wizardState.name,
        onInput: (e) => {
          this._wizardState.name = e.target.value.trim();
          this.updateWizardNext();
        },
      }),
    ]));

    /* 性别 — 复用全局 renderGenderPicker(UI 只出现「她 / 他」) */
    form.appendChild(el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label', textContent: '性别' }),
      renderGenderPicker({
        value: toUiGender(this._wizardState.gender),
        onSelect: (mod) => {
          this._wizardState.gender = toBackendGender(mod);
          this.updateWizardNext();
        },
      }),
    ]));

    /* 风格 */
    form.appendChild(el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label', textContent: '风格' }),
      el('div', { className: 'style-chips' }, ['温柔', '冷酷', '活泼', '成熟'].map(s =>
        el('button', {
          className: `style-chip${this._wizardState.style === s ? ' selected' : ''}`,
          textContent: s,
          onClick: (e) => this.selectStyle(s, e.target.parentElement),
        })
      )),
    ]));

    /* 年龄 + 职业 */
    const row = el('div', { className: 'form-group', style: { display: 'flex', gap: 'var(--s3)' } });
    row.appendChild(el('input', {
      className: 'form-input',
      type: 'number',
      placeholder: '年龄',
      value: this._wizardState.age,
      style: { width: '80px' },
      onInput: (e) => { this._wizardState.age = e.target.value; },
    }));
    row.appendChild(el('input', {
      className: 'form-input',
      type: 'text',
      placeholder: '职业',
      value: this._wizardState.occupation,
      onInput: (e) => { this._wizardState.occupation = e.target.value.trim(); },
    }));
    form.appendChild(row);

    container.appendChild(form);

    /* 下一步 */
    container.appendChild(el('button', {
      className: 'wizard-next',
      textContent: '下一步 → 生成预览',
      disabled: !this.canProceed(1) ? 'disabled' : undefined,
      onClick: () => {
        if (this.canProceed(1)) {
          this._wizardState.step = 2;
          this.renderWizard(2);
        }
      },
    }));
  }

  selectStyle(style, parent) {
    this._wizardState.style = style;
    parent.querySelectorAll('.style-chip').forEach(c => c.classList.remove('selected'));
    /* :contains() 不是标准 CSS — 用 textContent 遍历匹配 */
    for (const chip of parent.querySelectorAll('.style-chip')) {
      if (chip.textContent.trim() === style) {
        chip.classList.add('selected');
        break;
      }
    }
    this.updateWizardNext();
  }

  updateWizardNext() {
    const btn = this.el.querySelector('.wizard-next');
    if (btn) btn.disabled = !this.canProceed(1);
  }

  canProceed(step) {
    if (step === 1) return this._wizardState.name && this._wizardState.gender && this._wizardState.style;
    return true;
  }

  /* ─── Step 2: AI 生成预览 ─── */
  async renderWizardStep2(container) {
    container.appendChild(el('div', { className: 'studio-state' }, [
      modAvatar('studio-mascot'),
      el('p', { className: 'studio-state-text', textContent: '正在生成人格…' }),
    ]));

    try {
      const result = await api.post('/persona/generate', {
        name: this._wizardState.name,
        gender: toBackendGender(this._wizardState.gender),
        style: this._wizardState.style,
        age: this._wizardState.age ? parseInt(this._wizardState.age) : undefined,
        occupation: this._wizardState.occupation || undefined,
        traits: this._wizardState.traits,
      });

      container.innerHTML = '';

      /* 预览 */
      container.appendChild(el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '生成预览' }),
        el('div', { className: 'soul-preview' }, [
          el('pre', { textContent: result.preview || result.soul?.slice(0, 400) || '生成成功' }),
        ]),
      ]));

      container.appendChild(el('p', {
        className: 'wizard-hint',
        textContent: `Token 估算: ~${result.tokenEstimate || '—'}`,
      }));

      /* 按钮 */
      container.appendChild(el('div', { className: 'wizard-actions' }, [
        el('button', {
          className: 'btn-secondary',
          textContent: '重新生成',
          onClick: () => this.renderWizardStep2(container),
        }),
        el('button', {
          className: 'btn-primary',
          textContent: '保存并激活',
          onClick: () => this.savePersona(result),
        }),
      ]));

    } catch (err) {
      container.innerHTML = '';
      container.appendChild(el('div', { className: 'studio-state' }, [
        el('p', { className: 'studio-state-text', textContent: `生成失败: ${err.message || '未知错误'}` }),
      ]));
      container.appendChild(el('button', {
        className: 'btn-secondary w-full',
        textContent: '返回重试',
        onClick: () => this.renderWizard(1),
      }));
    }
  }

  /* ─── Step 3: 保存完成 ─── */
  async savePersona(generated) {
    const container = this.el.querySelector('#studio-content');
    if (!container) return;

    const name = this._wizardState?.name || '';

    container.innerHTML = '';
    container.appendChild(el('div', { className: 'studio-state' }, [
      el('p', { className: 'studio-state-text', textContent: '正在保存…' }),
    ]));

    try {
      await api.post('/persona/save', {
        name: this._wizardState.name,
        gender: toBackendGender(this._wizardState.gender),
        style: this._wizardState.style,
        age: this._wizardState.age ? parseInt(this._wizardState.age) : undefined,
        occupation: this._wizardState.occupation || undefined,
        traits: this._wizardState.traits,
      });

      container.innerHTML = '';
      container.appendChild(el('div', { className: 'studio-done' }, [
        modAvatar('studio-mascot', 'happy'),
        el('h2', { className: 'studio-done-title title', textContent: '创建成功' }),
        el('p', { className: 'studio-done-sub', textContent: `${name} 已激活` }),
        el('button', {
          className: 'wizard-next',
          textContent: '开始对话',
          onClick: () => navigate('/chat'),
        }),
      ]));

      Store.set('activeMod', name || Store.get('activeMod'));
      this._wizardState = null;

    } catch (err) {
      toast(err.message || '保存失败', 'error');
      this.renderWizard(2);
    }
  }

  renderWizardStep3(container) {
    /* 完成页 — 实际由 savePersona 处理 */
    this.renderWizardStep2(container);
  }

  /* ─── 辅助函数 ─── */
  async switchMode(mode, chipsParent) {
    try {
      await api.post('/persona/mode', { mode });
      Store.set('personaMode', mode);
      if (chipsParent) {
        chipsParent.querySelectorAll('.mode-chip').forEach(c => {
          c.classList.toggle('selected', c.dataset.mode === mode);
        });
      }
      toast(mode === 'deep' ? '已切换至深度陪伴模式' : '已切换至日常模式', 'success');
    } catch (e) {
      toast(e.message || '切换失败', 'error');
    }
  }

  async loadSoulPreview(modName, preEl) {
    try {
      const data = await api.get(`/mods/${modName}/soul`);
      if (data && data.soul) {
        preEl.textContent = data.soul.slice(0, 500);
      } else {
        preEl.textContent = '(暂无 soul.md)';
      }
    } catch {
      /* 后端可能还没有 /mods/:name/soul 端点 */
      preEl.textContent = '(查看完整 soul.md 需要后端支持)';
    }
  }

  async editSoul(modName) {
    const container = this.el.querySelector('#studio-content');
    if (!container) return;

    let soulContent = '';
    try {
      const data = await api.get(`/mods/${modName}/soul`);
      soulContent = data?.soul || '';
    } catch {}

    container.innerHTML = '';

    container.appendChild(el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label', textContent: `编辑 ${displayName(modName)} 的 soul.md` }),
      el('textarea', {
        className: 'soul-editor',
        textContent: soulContent,
        onInput: (e) => { soulContent = e.target.value; },
      }),
    ]));

    container.appendChild(el('div', { className: 'wizard-actions' }, [
      el('button', {
        className: 'btn-secondary',
        textContent: '取消',
        onClick: () => this.loadModList(container),
      }),
      el('button', {
        className: 'btn-primary',
        textContent: '保存',
        onClick: async () => {
          try {
            await api.put(`/mods/${modName}/soul`, { soul: soulContent });
            toast('保存成功', 'success');
            this.loadModList(container);
          } catch {
            toast('保存失败', 'error');
          }
        },
      }),
    ]));
  }

  skeletonModList() {
    return el('div', { className: 'mod-section' }, [
      el('div', { className: 'mod-detail-card studio-skeleton', style: { height: '240px' } }),
      el('div', { className: 'mod-cards' }, [
        ...[1, 2, 3].map(() => el('div', {
          className: 'mod-card studio-skeleton',
          style: { height: '160px' },
        })),
      ]),
    ]);
  }
}

// Export compat
let studioViewInstance = null;

export function renderStudio(params) {
  studioViewInstance = new StudioView(params);
  return studioViewInstance.render();
}

export function mountStudio() {
  if (studioViewInstance) studioViewInstance.mount();
}

export function unmountStudio() {
  if (studioViewInstance) {
    studioViewInstance.unmount();
    studioViewInstance = null;
  }
}
