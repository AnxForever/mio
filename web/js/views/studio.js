import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { wsManager } from '../ws.js';
import { navigate } from '../router.js';
import { mascotSrc } from '../mascot.js';
import { toast } from '../components/toast.js';
import { ICONS } from '../utils/icons.js';
import { renderEmpty } from '../components/empty-state.js';

const GENDER_LABELS = {
  female: '女',
  male: '男',
  girlfriend: '女',
  boyfriend: '男',
};

const STYLE_PRESETS = ['温柔但有主见', '沉稳嘴硬心软', '成熟温和', '冷淡但可靠', '活泼敏感', '稳重克制'];

const PERSONALITY_AXES = [
  ['openness', '开放性', '务实稳定', '好奇探索'],
  ['conscientiousness', '责任感', '随性自由', '认真有条理'],
  ['extraversion', '外向性', '安静慢热', '外向主动'],
  ['agreeableness', '宜人性', '有主见', '温和体贴'],
  ['neuroticism', '敏感度', '情绪稳定', '情绪细腻'],
];

function genderLabel(value) {
  return GENDER_LABELS[value] || value || '未设定';
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function splitList(value) {
  return String(value || '')
    .split(/[\n,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitTrajectory(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [left, impactRaw = ''] = line.split(/\s*(?:=>|→|影响：)\s*/);
      const match = left.match(/^(.+?)(?:[（(](.*?)[）)])?[：:]\s*(.+)$/);
      if (!match) {
        return {
          period: '人生阶段',
          ageRange: '',
          event: left,
          impact: impactRaw || '这段经历塑造了角色现在的性格和关系模式。',
        };
      }
      return {
        period: match[1].trim(),
        ageRange: (match[2] || '').trim(),
        event: match[3].trim(),
        impact: impactRaw || '这段经历塑造了角色现在的性格和关系模式。',
      };
    });
}

function trajectorySummary(config = {}) {
  const items = asList(config.lifeTrajectory);
  if (!items.length) return '';
  return items.slice(-2).map((item) => `${item.period}${item.ageRange ? `(${item.ageRange})` : ''}`).join(' / ');
}

function sourceLabel(config = {}) {
  const source = config.source || {};
  const qualityMap = { draft: '草案', reviewed: '已审核', unknown: '未知质量' };
  return [source.label, qualityMap[source.quality]].filter(Boolean).join(' · ');
}

function joinList(value) {
  return asList(value).join('，');
}

function characterName(character) {
  return character?.config?.name || character?.id || '未命名角色';
}

function characterMeta(config = {}) {
  return [
    genderLabel(config.gender),
    config.age ? `${config.age}岁` : '',
    config.occupation,
  ].filter(Boolean).join(' · ');
}

function formatCharacterTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function modAvatar(extraClass = '', expr = 'gentle') {
  const wrap = el('div', { className: `avatar ${extraClass}`.trim(), 'aria-hidden': 'true' });
  wrap.appendChild(el('img', {
    alt: '',
    src: mascotSrc(expr),
    onError: (event) => { event.target.style.display = 'none'; },
  }));
  return wrap;
}

function defaultWizardState() {
  return {
    step: 1,
    name: '',
    gender: 'female',
    age: '24',
    occupation: '',
    style: '',
    traitsText: '',
    interestsText: '',
    valuesText: '',
    quirksText: '',
    lifeGoalsText: '',
    lifeTrajectoryText: '',
    currentLife: '',
    relationshipProfile: '',
    scenario: '',
    firstMessage: '',
    alternateGreetingsText: '',
    exampleDialoguesText: '',
    speakingStyle: '',
    backstory: '',
    personality: {
      openness: 0.6,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.7,
      neuroticism: 0.3,
    },
  };
}

export class StudioView extends BaseView {
  constructor(params) {
    super(params);
    this._wizardState = null;
  }

  render() {
    this.el = el('div', { className: 'studio-view' });

    const header = el('header', { className: 'studio-header' });
    const backBtn = el('button', {
      className: 'studio-back-btn tap',
      'aria-label': '返回控制台',
      onClick: () => navigate('/console'),
    });
    backBtn.appendChild(ICONS.back(18));
    header.appendChild(backBtn);
    header.appendChild(el('h1', { className: 'studio-header-title title', textContent: this.params.id ? '编辑角色' : '角色库' }));
    this.el.appendChild(header);

    const content = el('div', { className: 'studio-content', id: 'studio-content' });
    this.el.appendChild(content);

    return this.el;
  }

  mount() {
    const content = this.el.querySelector('#studio-content');
    if (content) this.loadCharacterLibrary(content);
  }

  async loadCharacterLibrary(container) {
    container.innerHTML = '';
    container.appendChild(this.skeletonModList());

    try {
      const [statusData, characterData] = await Promise.all([
        api.get('/status'),
        api.get('/characters').catch(() => null),
      ]);

      container.innerHTML = '';
      container.appendChild(this.renderCharacterLibrary(statusData, characterData?.data || []));
    } catch {
      container.innerHTML = '';
      container.appendChild(renderEmpty({
        icon: ICONS.unplugged,
        title: '角色库加载失败',
        desc: '后端没有响应，可能是 token 过期或服务断开。检查状态后再试。',
        cta: { label: '重试', onClick: () => this.load?.() },
        tone: 'error',
        size: 'md',
        className: 'studio-state',
      }));
    }
  }

  renderCharacterLibrary(statusData, characters) {
    const frag = document.createDocumentFragment();
    const activeId = statusData?.config?.activeMod || Store.get('activeMod') || '';
    const activeCharacter = characters.find((item) => item.id === activeId || item.active) || characters[0] || null;

    frag.appendChild(this.renderActiveDetail(activeCharacter, statusData, activeId));

    const section = el('section', { className: 'mod-section character-library', 'aria-label': '角色卡' });
    section.appendChild(this.renderLibraryHead(characters.length));

    if (!characters.length) {
      section.appendChild(el('div', { className: 'studio-state studio-state--compact' }, [
        el('p', { className: 'studio-state-text', textContent: '还没有角色卡。先创建一个角色。' }),
      ]));
      frag.appendChild(section);
      return frag;
    }

    const grid = el('div', { className: 'character-grid' });
    for (const character of characters) {
      grid.appendChild(this.renderCharacterCard(character, activeId));
    }
    section.appendChild(grid);
    frag.appendChild(section);
    return frag;
  }

  renderLibraryHead(count) {
    const head = el('div', { className: 'mod-section-head role-library-head' });
    const title = el('div', { className: 'role-library-title' }, [
      el('div', { className: 'mod-section-title label', textContent: '角色卡' }),
      el('div', { className: 'role-library-count', textContent: `${count} 个可用角色` }),
    ]);
    const action = el('button', {
      className: 'mod-section-action btn-primary role-create-btn',
      type: 'button',
      onClick: () => this.startNewMod(),
    });
    action.appendChild(ICONS.plus(16));
    action.appendChild(el('span', { textContent: '创建角色' }));
    head.appendChild(title);
    head.appendChild(action);
    return head;
  }

  renderActiveDetail(character, statusData, activeId) {
    const config = character?.config || {};
    const id = character?.id || activeId;
    const card = el('section', { className: 'mod-detail-card role-active-card', 'aria-label': '当前角色' });

    const header = el('div', { className: 'mod-detail-header role-active-header' });
    header.appendChild(modAvatar('mod-detail-avatar', 'happy'));

    const info = el('div', { className: 'mod-detail-info' }, [
      el('div', { className: 'role-eyebrow', textContent: '当前角色' }),
      el('div', { className: 'mod-detail-name', textContent: characterName(character) }),
      el('div', { className: 'mod-detail-meta', textContent: characterMeta(config) || id || '未激活' }),
    ]);
    header.appendChild(info);
    header.appendChild(el('span', { className: 'mod-detail-status', textContent: id ? '使用中' : '未选择' }));
    card.appendChild(header);

    if (config.style) {
      card.appendChild(el('p', { className: 'role-active-style', textContent: config.style }));
    }

    const source = sourceLabel(config);
    if (source) {
      card.appendChild(el('div', { className: 'character-source role-active-source', textContent: source }));
    }

    const tagRow = el('div', { className: 'role-card-tags role-active-tags' });
    const tags = [...asList(config.traits).slice(0, 5), ...asList(config.interests).slice(0, 3)];
    for (const tag of tags) tagRow.appendChild(el('span', { className: 'character-chip', textContent: tag }));
    if (tags.length) card.appendChild(tagRow);

    if (config.currentLife || trajectorySummary(config)) {
      card.appendChild(el('div', { className: 'role-active-trajectory' }, [
        el('div', { className: 'role-active-trajectory-title', textContent: '人生轨迹' }),
        el('p', { textContent: config.currentLife || trajectorySummary(config) }),
      ]));
    }

    if (config.firstMessage) {
      card.appendChild(el('div', { className: 'role-active-trajectory' }, [
        el('div', { className: 'role-active-trajectory-title', textContent: '开场消息' }),
        el('p', { textContent: config.firstMessage }),
      ]));
    }

    card.appendChild(this.renderModeSwitch(statusData));
    card.appendChild(this.renderAffinity(statusData));

    const actions = el('div', { className: 'mod-actions role-active-actions' });
    actions.appendChild(el('button', {
      className: 'btn-primary',
      type: 'button',
      textContent: '开始聊天',
      onClick: () => navigate('/chat'),
    }));
    if (id) {
      actions.appendChild(el('button', {
        className: 'btn-secondary',
        type: 'button',
        textContent: '编辑 soul',
        onClick: () => this.editSoul(id),
      }));
    }
    card.appendChild(actions);

    return card;
  }

  renderModeSwitch(statusData) {
    const mode = statusData?.personaMode || Store.get('personaMode') || 'base';
    const modeSwitch = el('div', { className: 'mode-switch' });
    modeSwitch.appendChild(el('span', { className: 'mode-switch-label', textContent: '陪伴模式' }));

    const chips = el('div', { className: 'mode-chips' });
    for (const item of [
      ['base', '日常'],
      ['deep', '深度'],
    ]) {
      chips.appendChild(el('button', {
        className: `mode-chip${mode === item[0] ? ' selected' : ''}`,
        textContent: item[1],
        dataset: { mode: item[0] },
        type: 'button',
        onClick: () => this.switchMode(item[0], chips),
      }));
    }

    modeSwitch.appendChild(chips);
    return modeSwitch;
  }

  renderAffinity(statusData) {
    const aff = Math.max(0, Math.min(100, Number(statusData?.emotion?.affection || 0)));
    return el('div', { className: 'affection-bar' }, [
      el('div', { className: 'affection-bar-label' }, [
        el('span', { textContent: '关系热度' }),
        el('span', { className: 'affection-score', textContent: `${aff}/100` }),
      ]),
      el('div', { className: 'progress' }, [
        el('i', { style: { width: `${aff}%` } }),
      ]),
    ]);
  }

  renderCharacterCard(character, activeId) {
    const config = character.config || {};
    const active = character.id === activeId || character.active;
    const card = el('article', { className: `character-card${active ? ' active' : ''}` });

    card.appendChild(el('div', { className: 'character-card-main' }, [
      modAvatar('character-avatar', active ? 'happy' : 'gentle'),
      el('div', { className: 'character-info' }, [
        el('div', { className: 'character-name', textContent: characterName(character) }),
        el('div', { className: 'character-meta', textContent: characterMeta(config) }),
      ]),
      active ? el('span', { className: 'character-badge', textContent: '使用中' }) : null,
    ]));

    const source = sourceLabel(config);
    if (source) {
      card.appendChild(el('div', { className: 'character-source', textContent: source }));
    }

    if (config.style) {
      card.appendChild(el('p', { className: 'character-style', textContent: config.style }));
    }

    const tags = el('div', { className: 'role-card-tags' });
    for (const tag of asList(config.traits).slice(0, 4)) {
      tags.appendChild(el('span', { className: 'character-chip', textContent: tag }));
    }
    for (const tag of asList(config.interests).slice(0, 3)) {
      tags.appendChild(el('span', { className: 'character-chip character-chip--muted', textContent: tag }));
    }
    if (tags.childNodes.length) card.appendChild(tags);

    const detail = [];
    if (trajectorySummary(config)) detail.push(['人生轨迹', trajectorySummary(config)]);
    if (config.currentLife) detail.push(['现状', config.currentLife]);
    if (config.scenario) detail.push(['场景', config.scenario]);
    if (config.firstMessage) detail.push(['开场', config.firstMessage]);
    if (config.speakingStyle) detail.push(['说话方式', config.speakingStyle]);
    if (config.relationshipProfile) detail.push(['关系模式', config.relationshipProfile]);
    if (asList(config.values).length) detail.push(['在意', joinList(config.values.slice(0, 3))]);
    if (asList(config.quirks).length) detail.push(['习惯', joinList(config.quirks.slice(0, 2))]);

    if (detail.length) {
      card.appendChild(el('dl', { className: 'character-facts' }, detail.flatMap(([label, value]) => [
        el('dt', { textContent: label }),
        el('dd', { textContent: value }),
      ])));
    }

    const actions = el('div', { className: 'character-actions' });
    if (!active) {
      actions.appendChild(el('button', {
        className: 'btn-primary',
        type: 'button',
        textContent: '激活',
        onClick: () => this.activateCharacter(character.id),
      }));
    }
    actions.appendChild(el('button', {
      className: 'btn-secondary',
      type: 'button',
      textContent: '生活',
      onClick: () => this.toggleCharacterLife(character.id, card),
    }));
    actions.appendChild(el('button', {
      className: 'btn-secondary',
      type: 'button',
      textContent: '编辑',
      onClick: () => this.editSoul(character.id),
    }));
    if (character.isCustom && !active) {
      const deleteBtn = el('button', {
        className: 'btn-secondary character-danger',
        type: 'button',
        'aria-label': `删除 ${characterName(character)}`,
        onClick: () => this.deleteCharacter(character.id),
      });
      deleteBtn.appendChild(ICONS.trash(16));
      actions.appendChild(deleteBtn);
    }
    card.appendChild(actions);
    return card;
  }

  async activateCharacter(id) {
    try {
      const result = await api.post(`/character/${encodeURIComponent(id)}/activate`);
      const activeMod = result?.data?.activeMod || id;
      Store.set('activeMod', activeMod);
      wsManager.switchMod(activeMod);
      toast('角色已激活', 'success');
      const container = this.el.querySelector('#studio-content');
      if (container) this.loadCharacterLibrary(container);
    } catch (err) {
      toast(err.message || '激活失败', 'error');
    }
  }

  async deleteCharacter(id) {
    try {
      await api.del(`/character/${encodeURIComponent(id)}`);
      toast('角色已删除', 'success');
      const container = this.el.querySelector('#studio-content');
      if (container) this.loadCharacterLibrary(container);
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
      for (const event of events.slice(0, 5)) {
        panel.appendChild(el('div', { className: 'character-life-event' }, [
          el('div', { className: 'character-life-time', textContent: formatCharacterTime(event.timestamp) }),
          el('div', { className: 'character-life-text', textContent: event.description || event.content || '生活事件' }),
        ]));
      }
    } catch {
      panel.innerHTML = '';
      panel.appendChild(el('div', { className: 'character-life-state', textContent: '生活事件读取失败。' }));
    }
  }

  startNewMod() {
    this._wizardState = defaultWizardState();
    this.renderWizard(1);
  }

  renderWizard(step) {
    const container = this.el.querySelector('#studio-content');
    if (!container) return;

    this._wizardState.step = step;
    container.innerHTML = '';
    container.appendChild(this.renderStepIndicator(step));

    if (step === 1) this.renderWizardStep1(container);
    if (step === 2) this.renderWizardStep2(container);
    if (step === 3) this.renderWizardStep3(container);
    container.scrollTop = 0;
  }

  renderStepIndicator(step) {
    return el('div', { className: 'step-indicator', 'aria-label': '创建角色步骤' }, [1, 2, 3].map((index) => {
      const done = index < step;
      const current = index === step;
      const frag = document.createDocumentFragment();
      frag.appendChild(el('div', { className: `step-dot${done ? ' done' : ''}${current ? ' current' : ''}` }));
      if (index < 3) frag.appendChild(el('div', { className: `step-line${done ? ' done' : ''}` }));
      return frag;
    }));
  }

  renderWizardStep1(container) {
    container.appendChild(el('div', { className: 'wizard-panel' }, [
      el('div', { className: 'wizard-panel-head' }, [
        el('h2', { className: 'wizard-title title', textContent: '基础身份' }),
        el('p', { className: 'wizard-subtitle', textContent: '先确定这个角色是谁、从事什么、给人的第一感觉。' }),
      ]),
      this.renderTextInput('名字', '例如：林夏', this._wizardState.name, (value) => { this._wizardState.name = value.trim(); }),
      this.renderGenderSelect(),
      this.renderIdentityRow(),
      this.renderStylePicker(),
    ]));

    container.appendChild(this.renderWizardNav({
      nextText: '下一步',
      nextDisabled: !this.canProceed(1),
      onNext: () => this.renderWizard(2),
      onCancel: () => this.loadCharacterLibrary(container),
    }));
  }

  renderGenderSelect() {
    const select = el('select', {
      className: 'form-input',
      onChange: (event) => { this._wizardState.gender = event.target.value; },
    }, [
      el('option', { value: 'female', textContent: '女' }),
      el('option', { value: 'male', textContent: '男' }),
    ]);
    select.addEventListener('change', () => this.updateWizardNext());
    select.value = this._wizardState.gender;
    return el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label', textContent: '性别' }),
      select,
    ]);
  }

  renderIdentityRow() {
    return el('div', { className: 'form-row' }, [
      this.renderTextInput('年龄', '24', this._wizardState.age, (value) => { this._wizardState.age = value.trim(); }, { type: 'number', min: '12', max: '120' }),
      this.renderTextInput('职业', '自由插画师', this._wizardState.occupation, (value) => { this._wizardState.occupation = value.trim(); }),
    ]);
  }

  renderStylePicker() {
    const input = this.renderTextInput('风格定位', '温柔但有主见', this._wizardState.style, (value) => { this._wizardState.style = value.trim(); });
    const chips = el('div', { className: 'style-chips role-style-chips' }, STYLE_PRESETS.map((style) =>
      el('button', {
        className: `style-chip${this._wizardState.style === style ? ' selected' : ''}`,
        type: 'button',
        textContent: style,
        onClick: () => {
          this._wizardState.style = style;
          this.renderWizard(1);
        },
      })
    ));
    input.appendChild(chips);
    return input;
  }

  renderWizardStep2(container) {
    container.appendChild(el('div', { className: 'wizard-panel' }, [
      el('div', { className: 'wizard-panel-head' }, [
        el('h2', { className: 'wizard-title title', textContent: '性格与喜好' }),
        el('p', { className: 'wizard-subtitle', textContent: '这些字段会写入角色卡，直接影响 soul 和之后的聊天质感。' }),
      ]),
      this.renderTextarea('性格标签', '温柔，慢热，有边界感', this._wizardState.traitsText, (value) => { this._wizardState.traitsText = value; }),
      this.renderTextarea('兴趣喜好', '插画，散步，独立音乐', this._wizardState.interestsText, (value) => { this._wizardState.interestsText = value; }),
      this.renderTextarea('重视的东西', '真诚，长期陪伴，互相尊重', this._wizardState.valuesText, (value) => { this._wizardState.valuesText = value; }),
      this.renderTextarea('小习惯', '紧张时会沉默几秒，喜欢记录天气', this._wizardState.quirksText, (value) => { this._wizardState.quirksText = value; }),
      this.renderTextarea('人生目标', '做一本自己的画册，建立稳定关系', this._wizardState.lifeGoalsText, (value) => { this._wizardState.lifeGoalsText = value; }),
      this.renderTextarea('人生轨迹', '童年（6-12）：在少表达的家庭里长大 => 变得敏感、会观察气氛\n现在（24）：独自做自由职业 => 渴望稳定但不窒息的陪伴', this._wizardState.lifeTrajectoryText, (value) => { this._wizardState.lifeTrajectoryText = value; }, 5),
      this.renderTextarea('当前生活', '现在住在哪里，日常如何运转，现实压力是什么，最隐秘的愿望是什么。', this._wizardState.currentLife, (value) => { this._wizardState.currentLife = value; }, 4),
      this.renderTextarea('亲密关系模式', '如何靠近、害怕什么、冲突时会怎样、什么会真正打动 Ta。', this._wizardState.relationshipProfile, (value) => { this._wizardState.relationshipProfile = value; }, 4),
      this.renderTextarea('对话场景', '你们已经认识一段时间。Ta 通常在工作间隙回消息，有自己的生活，不会围着用户转。', this._wizardState.scenario, (value) => { this._wizardState.scenario = value; }, 4),
      this.renderTextarea('开场消息', '刚忙完，手都快不是自己的了。\n\n你呢，今天怎么样？', this._wizardState.firstMessage, (value) => { this._wizardState.firstMessage = value; }, 4),
      this.renderTextarea('备用开场', '一行一条。用于不同入口或不同心情。', this._wizardState.alternateGreetingsText, (value) => { this._wizardState.alternateGreetingsText = value; }, 4),
      this.renderTextarea('示例对话', '<START>\n{{user}}: 今天好累\n{{char}}: 嗯，听出来了。是身体累，还是心里被什么压着？', this._wizardState.exampleDialoguesText, (value) => { this._wizardState.exampleDialoguesText = value; }, 6),
      this.renderTextarea('说话方式', '自然轻柔，回应具体，不像客服总结', this._wizardState.speakingStyle, (value) => { this._wizardState.speakingStyle = value; }, 3),
      this.renderTextarea('背景故事', '1-3 段简短设定，让角色有自己的生活。', this._wizardState.backstory, (value) => { this._wizardState.backstory = value; }, 5),
      this.renderPersonalityPanel(),
    ]));

    container.appendChild(this.renderWizardNav({
      backText: '上一步',
      nextText: '预览角色卡',
      onBack: () => this.renderWizard(1),
      onNext: () => this.renderWizard(3),
    }));
  }

  renderPersonalityPanel() {
    const panel = el('div', { className: 'personality-panel' });
    panel.appendChild(el('div', { className: 'form-label', textContent: '人格倾向' }));
    for (const [key, label, low, high] of PERSONALITY_AXES) {
      const value = Number(this._wizardState.personality[key] ?? 0.5);
      const row = el('div', { className: 'personality-row' }, [
        el('div', { className: 'personality-row-head' }, [
          el('span', { textContent: label }),
          el('span', { textContent: value.toFixed(2) }),
        ]),
        el('input', {
          className: 'personality-slider',
          type: 'range',
          min: '0',
          max: '1',
          step: '0.01',
          value: String(value),
          onInput: (event) => { this._wizardState.personality[key] = Number(event.target.value); },
        }),
        el('div', { className: 'personality-scale' }, [
          el('span', { textContent: low }),
          el('span', { textContent: high }),
        ]),
      ]);
      panel.appendChild(row);
    }
    return panel;
  }

  renderWizardStep3(container) {
    const payload = this.buildCharacterPayload();
    container.appendChild(el('div', { className: 'wizard-panel' }, [
      el('div', { className: 'wizard-panel-head' }, [
        el('h2', { className: 'wizard-title title', textContent: '保存前预览' }),
        el('p', { className: 'wizard-subtitle', textContent: '确认后会创建角色文件、生成 seed memory，并立即激活。' }),
      ]),
      this.renderPreviewCard(payload),
    ]));

    container.appendChild(this.renderWizardNav({
      backText: '上一步',
      nextText: '保存并激活',
      onBack: () => this.renderWizard(2),
      onNext: () => this.saveCharacter(payload),
    }));
  }

  renderPreviewCard(payload) {
    const card = el('article', { className: 'character-card role-preview-card active' });
    card.appendChild(el('div', { className: 'character-card-main' }, [
      modAvatar('character-avatar', 'happy'),
      el('div', { className: 'character-info' }, [
        el('div', { className: 'character-name', textContent: payload.name }),
        el('div', { className: 'character-meta', textContent: characterMeta(payload) }),
      ]),
      el('span', { className: 'character-badge', textContent: '预览' }),
    ]));
    card.appendChild(el('p', { className: 'character-style', textContent: payload.style }));

    const tags = el('div', { className: 'role-card-tags' });
    for (const tag of [...payload.traits.slice(0, 5), ...payload.interests.slice(0, 4)]) {
      tags.appendChild(el('span', { className: 'character-chip', textContent: tag }));
    }
    if (tags.childNodes.length) card.appendChild(tags);

    card.appendChild(el('dl', { className: 'character-facts' }, [
      el('dt', { textContent: '人生轨迹' }),
      el('dd', { textContent: payload.lifeTrajectory.length ? payload.lifeTrajectory.map((item) => item.period).join(' / ') : '还没有结构化轨迹。' }),
      el('dt', { textContent: '当前生活' }),
      el('dd', { textContent: payload.currentLife || '还没有当前生活设定。' }),
      el('dt', { textContent: '说话方式' }),
      el('dd', { textContent: payload.speakingStyle || '自然聊天，不端着。' }),
      el('dt', { textContent: '关系模式' }),
      el('dd', { textContent: payload.relationshipProfile || '还没有亲密关系模式。' }),
      el('dt', { textContent: '对话场景' }),
      el('dd', { textContent: payload.scenario || '还没有对话场景。' }),
      el('dt', { textContent: '开场' }),
      el('dd', { textContent: payload.firstMessage || '还没有开场消息。' }),
      el('dt', { textContent: '背景' }),
      el('dd', { textContent: payload.backstory || '这个角色还没有详细背景。' }),
    ]));
    return card;
  }

  renderWizardNav({ backText = '', nextText, nextDisabled = false, onBack, onNext, onCancel }) {
    const actions = el('div', { className: 'wizard-actions role-wizard-actions' });
    actions.appendChild(el('button', {
      className: 'btn-secondary',
      type: 'button',
      textContent: backText || '取消',
      onClick: onBack || onCancel,
    }));
    actions.appendChild(el('button', {
      className: 'btn-primary',
      type: 'button',
      textContent: nextText,
      disabled: nextDisabled ? 'disabled' : undefined,
      dataset: { wizardNext: 'true' },
      onClick: (event) => {
        if (!event.currentTarget.disabled) onNext?.();
      },
    }));
    return actions;
  }

  renderTextInput(label, placeholder, value, onInput, attrs = {}) {
    return el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label', textContent: label }),
      el('input', {
        className: 'form-input',
        type: attrs.type || 'text',
        placeholder,
        value,
        min: attrs.min,
        max: attrs.max,
        onInput: (event) => {
          onInput(event.target.value);
          this.updateWizardNext();
        },
      }),
    ]);
  }

  renderTextarea(label, placeholder, value, onInput, rows = 2) {
    return el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label', textContent: label }),
      el('textarea', {
        className: 'form-input form-textarea',
        placeholder,
        rows: String(rows),
        textContent: value,
        onInput: (event) => onInput(event.target.value),
      }),
    ]);
  }

  canProceed(step) {
    if (step !== 1) return true;
    const age = Number.parseInt(this._wizardState.age, 10);
    return Boolean(
      this._wizardState.name.trim()
      && this._wizardState.gender
      && Number.isFinite(age)
      && age >= 12
      && age <= 120
      && this._wizardState.occupation.trim()
      && this._wizardState.style.trim()
    );
  }

  updateWizardNext() {
    const btn = this.el?.querySelector('[data-wizard-next="true"]');
    if (!btn || this._wizardState?.step !== 1) return;
    btn.disabled = !this.canProceed(1);
  }

  buildCharacterPayload() {
    const state = this._wizardState || defaultWizardState();
    const age = Number.parseInt(state.age, 10);
    return {
      name: state.name.trim(),
      gender: state.gender,
      age: Number.isFinite(age) ? age : 24,
      occupation: state.occupation.trim(),
      style: state.style.trim(),
      personality: { ...state.personality },
      traits: splitList(state.traitsText),
      lifeTrajectory: splitTrajectory(state.lifeTrajectoryText),
      currentLife: state.currentLife.trim(),
      relationshipProfile: state.relationshipProfile.trim(),
      scenario: state.scenario.trim(),
      firstMessage: state.firstMessage.trim(),
      alternateGreetings: splitList(state.alternateGreetingsText),
      exampleDialogues: state.exampleDialoguesText
        .split(/(?=<START>)/)
        .map((item) => item.trim())
        .filter(Boolean),
      interests: splitList(state.interestsText),
      values: splitList(state.valuesText),
      quirks: splitList(state.quirksText),
      lifeGoals: splitList(state.lifeGoalsText),
      speakingStyle: state.speakingStyle.trim(),
      backstory: state.backstory.trim(),
    };
  }

  async saveCharacter(payload) {
    const container = this.el.querySelector('#studio-content');
    if (!container) return;

    container.innerHTML = '';
    container.appendChild(el('div', { className: 'studio-state' }, [
      el('p', { className: 'studio-state-text', textContent: '正在保存角色卡…' }),
    ]));

    try {
      const created = await api.post('/character/create', payload);
      const id = created?.data?.id;
      if (!id) throw new Error('角色创建成功，但没有返回 ID');
      await api.post(`/character/${encodeURIComponent(id)}/activate`);
      Store.set('activeMod', id);
      wsManager.switchMod(id);

      container.innerHTML = '';
      container.appendChild(el('div', { className: 'studio-done' }, [
        modAvatar('studio-mascot', 'happy'),
        el('h2', { className: 'studio-done-title title', textContent: '角色已创建' }),
        el('p', { className: 'studio-done-sub', textContent: `${payload.name} 已激活` }),
        el('button', {
          className: 'wizard-next',
          type: 'button',
          textContent: '开始对话',
          onClick: () => navigate('/chat'),
        }),
      ]));

      this._wizardState = null;
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      this.renderWizard(3);
    }
  }

  async switchMode(mode, chipsParent) {
    try {
      await api.post('/persona/mode', { mode });
      Store.set('personaMode', mode);
      if (chipsParent) {
        chipsParent.querySelectorAll('.mode-chip').forEach((chip) => {
          chip.classList.toggle('selected', chip.dataset.mode === mode);
        });
      }
      toast(mode === 'deep' ? '已切换至深度陪伴模式' : '已切换至日常模式', 'success');
    } catch (err) {
      toast(err.message || '切换失败', 'error');
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
    container.appendChild(el('div', { className: 'form-group soul-editor-wrap' }, [
      el('label', { className: 'form-label', textContent: `编辑 ${modName} 的 soul.md` }),
      el('textarea', {
        className: 'soul-editor',
        textContent: soulContent,
        onInput: (event) => { soulContent = event.target.value; },
      }),
    ]));

    container.appendChild(el('div', { className: 'wizard-actions' }, [
      el('button', {
        className: 'btn-secondary',
        type: 'button',
        textContent: '取消',
        onClick: () => this.loadCharacterLibrary(container),
      }),
      el('button', {
        className: 'btn-primary',
        type: 'button',
        textContent: '保存',
        onClick: async () => {
          try {
            await api.put(`/mods/${modName}/soul`, { soul: soulContent });
            toast('保存成功', 'success');
            this.loadCharacterLibrary(container);
          } catch {
            toast('保存失败', 'error');
          }
        },
      }),
    ]));
  }

  skeletonModList() {
    return el('div', { className: 'mod-section' }, [
      el('div', { className: 'mod-detail-card studio-skeleton', style: { height: '220px' } }),
      el('div', { className: 'character-grid' }, [
        ...[1, 2, 3, 4].map(() => el('div', {
          className: 'character-card studio-skeleton',
          style: { height: '220px' },
        })),
      ]),
    ]);
  }
}

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
