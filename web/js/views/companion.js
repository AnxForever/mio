/**
 * /companion — 陪伴设置
 *
 * 设计哲学：不是"配置面板"，是"你想要什么样的陪伴"。
 *
 * 架构：四层渐进
 *   1. 角色 — 谁在陪你（阿曜/司念/陆深…）
 *   2. 语气 — 怎么说话（sunshine/warm/bold）
 *   3. 节奏 — 关系速度（slow/moderate/fast/open/roleplay）
 *   4. 引擎 — 幕后技术（provider/model，可选展开）
 *
 * 每层都是对话式引导，不是冷冰冰的下拉框。
 * 即改即存，改完立刻在聊天里生效。
 */
import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';
import { ICONS } from '../utils/icons.js';

// ─── 角色卡数据 ───

const CHARACTERS = [
  { id: 'female', name: 'Mio', tag: '温柔姐姐', desc: '24岁·温柔但有主见·慢热', emoji: '🌸' },
  { id: 'male', name: 'Mio', tag: '沉稳男友', desc: '26岁·嘴硬心软·行动派', emoji: '🌿' },
  { id: 'a-yao', name: '阿曜', tag: '年下直球', desc: '23岁·音乐人·热烈藏不住', emoji: '☀️' },
  { id: 'si-nian', name: '司念', tag: '傲娇毒舌', desc: '25岁·插画师·嘴硬心软', emoji: '🐱' },
  { id: 'lu-shen', name: '陆深', tag: '爹系霸总', desc: '30岁·CEO·掌控但温柔', emoji: '🌙' },
];

const VOICES = [
  { id: 'sunshine', label: '温暖阳光', desc: '主动、撒娇、热烈', emoji: '☀️' },
  { id: 'warm', label: '温柔质感', desc: '内敛、慢热、克制', emoji: '🌸' },
  { id: 'bold', label: '大胆主张', desc: '直接、有脾气、刀子嘴', emoji: '⚡' },
];

const INTIMACIES = [
  { id: 'slow', label: '慢热陪伴', desc: '从朋友开始，自然生长', emoji: '🌱' },
  { id: 'moderate', label: '适龄恋爱', desc: '像正常恋爱一样的节奏', emoji: '💕' },
  { id: 'fast', label: '快速亲密', desc: '高甜、直接、不克制', emoji: '🔥' },
  { id: 'open', label: '完全开放', desc: '无保留，什么都可以', emoji: '🖤' },
  { id: 'roleplay', label: '角色扮演', desc: '沉浸式场景体验', emoji: '🎭' },
];

// ─── CompanionView ───

export class CompanionView extends BaseView {
  constructor(params) { super(params); }

  render() {
    this.el = el('div', { className: 'companion-view' });

    // Header
    const header = el('header', { className: 'companion-header' }, [
      el('button', { className: 'tap', onClick: () => navigate('/console'), 'aria-label': '返回' }, ICONS.back(20)),
      el('h1', { className: 'companion-title', textContent: '陪伴' }),
      el('p', { className: 'companion-subtitle', textContent: '选择你想要什么样的陪伴' }),
    ]);
    this.el.appendChild(header);

    // Preview card — shows the current character
    this.previewEl = el('div', { className: 'companion-preview' });
    this.el.appendChild(this.previewEl);

    // Sections
    const content = el('div', { className: 'companion-content' });
    content.appendChild(this.buildCharacterSection());
    content.appendChild(this.buildVoiceSection());
    content.appendChild(this.buildIntimacySection());
    content.appendChild(this.buildEngineSection());
    this.el.appendChild(content);

    return this.el;
  }

  async mount() {
    await this.loadConfig();
  }

  async loadConfig() {
    try {
      const data = await api.get('/admin/config');
      this.config = data;
    } catch {
      this.config = { activeMod: 'female', voice: 'warm', intimacy: 'moderate', provider: 'auto', model: '' };
    }
    this.updatePreview();
  }

  // ─── Preview ───

  updatePreview() {
    const char = CHARACTERS.find((c) => c.id === this.config.activeMod) || CHARACTERS[0];
    const voice = VOICES.find((v) => v.id === this.config.voice) || VOICES[0];
    const intimacy = INTIMACIES.find((i) => i.id === this.config.intimacy) || INTIMACIES[2];

    this.previewEl.innerHTML = '';
    this.previewEl.appendChild(el('div', { className: 'companion-preview-card' }, [
      el('div', { className: 'companion-preview-avatar', textContent: char.emoji }),
      el('div', { className: 'companion-preview-info' }, [
        el('div', { className: 'companion-preview-name', textContent: `${char.name} · ${char.tag}` }),
        el('div', { className: 'companion-preview-desc', textContent: char.desc }),
        el('div', { className: 'companion-preview-meta' }, [
          el('span', { textContent: `${voice.emoji} ${voice.label}` }),
          el('span', { textContent: `${intimacy.emoji} ${intimacy.label}` }),
        ]),
      ]),
    ]));
  }

  // ─── Section builders ───

  buildCharacterSection() {
    const active = this.config?.activeMod || 'female';
    const grid = el('div', { className: 'companion-char-grid' });
    CHARACTERS.forEach((char) => {
      const card = el('div', {
        className: `companion-char-card ${char.id === active ? 'companion-char-card--active' : ''}`,
        onClick: () => this.selectCharacter(char.id),
      }, [
        el('div', { className: 'companion-char-emoji', textContent: char.emoji }),
        el('div', { className: 'companion-char-name', textContent: char.name }),
        el('div', { className: 'companion-char-tag', textContent: char.tag }),
      ]);
      grid.appendChild(card);
    });
    return this.wrapSection('谁在陪你', '选择一个角色——每个角色的性格、说话方式、人生经历都不同', grid);
  }

  buildVoiceSection() {
    return this.wrapSection('她怎么说话', '语气决定了和你相处的风格',
      this.buildPills(VOICES, this.config?.voice || 'warm', 'voice'));
  }

  buildIntimacySection() {
    return this.wrapSection('你们的关系节奏', '慢热还是热烈——你来定',
      this.buildPills(INTIMACIES, this.config?.intimacy || 'moderate', 'intimacy'));
  }

  buildEngineSection() {
    // Minimal — technical details, collapsed by default
    const btn = el('button', {
      className: 'companion-engine-btn tap',
      textContent: '幕后 · 模型与 Provider',
      onClick: () => navigate('/settings'),
    });
    return this.wrapSection('幕后引擎', 'AI 模型和网络配置 → 到设置页面调整', btn);
  }

  // ─── Helpers ───

  wrapSection(title, subtitle, body) {
    const section = el('section', { className: 'companion-section' });
    section.appendChild(el('h2', { className: 'companion-section-title', textContent: title }));
    section.appendChild(el('p', { className: 'companion-section-sub', textContent: subtitle }));
    section.appendChild(body);
    return section;
  }

  buildPills(items, activeId, key) {
    const row = el('div', { className: 'companion-pills' });
    items.forEach((item) => {
      const pill = el('div', {
        className: `companion-pill ${item.id === activeId ? 'companion-pill--active' : ''}`,
        onClick: () => this.selectPill(key, item.id),
      }, [
        el('span', { className: 'companion-pill-emoji', textContent: item.emoji }),
        el('span', { className: 'companion-pill-label', textContent: item.label }),
        el('span', { className: 'companion-pill-desc', textContent: item.desc }),
      ]);
      row.appendChild(pill);
    });
    return row;
  }

  async selectCharacter(id) {
    try {
      await api.post(`/character/${id}/activate`);
      this.config.activeMod = id;
      this.updatePreview();
      this.refreshCharacterGrid();
      toast('角色已切换', 'success');
    } catch {
      toast('切换失败', 'error');
    }
  }

  async selectPill(key, id) {
    try {
      await api.patch('/admin/config', { [key]: id });
      this.config[key] = id;
      this.updatePreview();
      toast('已保存', 'success');
    } catch {
      toast('保存失败', 'error');
    }
  }

  refreshCharacterGrid() {
    const grid = this.el.querySelector('.companion-char-grid');
    if (!grid) return;
    const active = this.config.activeMod;
    grid.querySelectorAll('.companion-char-card').forEach((card) => {
      card.classList.toggle('companion-char-card--active',
        CHARACTERS.find((c) => c.id === active && c.name === card.querySelector('.companion-char-name')?.textContent));
    });
  }
}

// ─── Router integration ───

let instance = null;
export function renderCompanion(params) { instance = new CompanionView(params); return instance.render(); }
export function mountCompanion() { if (instance) instance.mount(); }
export function unmountCompanion() { if (instance) { instance.unmount(); instance = null; } }
