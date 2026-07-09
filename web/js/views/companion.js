/**
 * /companion — 陪伴
 *
 * 设计体系：Japandi (日式侘寂 × 中文留白 × 温暖极简)
 * 主色：米纸 #F9F5F0 / 奶油 #F2EBE1
 * 强调：桃绯 #E89F95 / 樱粉 #E0A7B2
 * 点缀：哑金 #D2B48C / 鼠尾绿 #A8B5A0
 * 文字：墨棕 #3C2F29 / 灰褐 #6B5A52
 *
 * 不是配置面板——是 Mio 的茶室。
 * 不是参数选择——是你想要什么样的陪伴。
 */
import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { toast } from '../components/toast.js';
import { ICONS } from '../utils/icons.js';

// ─── 数据 ───

const CHARACTERS = [
  { id: 'female',   name: 'Mio',  tag: '温柔姐姐', desc: '24岁·有主见·慢热' },
  { id: 'male',     name: 'Mio',  tag: '沉稳男友', desc: '26岁·嘴硬心软·行动派' },
  { id: 'a-yao',    name: '阿曜', tag: '年下直球', desc: '23岁·独立音乐人' },
  { id: 'si-nian',  name: '司念', tag: '傲娇毒舌', desc: '25岁·插画师·嘴硬心软' },
  { id: 'lu-shen',  name: '陆深', tag: '爹系霸总', desc: '30岁·CEO·掌控温柔' },
  { id: 'linxia',   name: '林夏', tag: '成熟温柔', desc: '27岁·稳定可靠·照顾者' },
  { id: 'shenlan',  name: '沈岚', tag: '冷淡可靠', desc: '26岁·话少但关键时在' },
  { id: 'nanyue',   name: '南月', tag: '活泼敏感', desc: '22岁·情绪丰富·需要被懂' },
  { id: 'zhouhe',   name: '周和', tag: '稳重克制', desc: '29岁·医疗从业者·分寸感' },
];

const VOICES = [
  { id: 'sunshine', label: '温暖阳光', desc: '主动·撒娇·热烈' },
  { id: 'warm',     label: '温柔质感', desc: '内敛·慢热·克制' },
  { id: 'bold',     label: '大胆主张', desc: '直接·有脾气·刀子嘴' },
];

const INTIMACIES = [
  { id: 'slow',     label: '慢热陪伴', desc: '从朋友开始，自然生长' },
  { id: 'moderate', label: '适龄恋爱', desc: '像正常恋爱一样的节奏' },
  { id: 'fast',     label: '快速亲密', desc: '高甜·直接·不克制' },
  { id: 'open',     label: '完全开放', desc: '无保留·什么都可以聊' },
  { id: 'roleplay', label: '角色扮演', desc: '沉浸式场景体验' },
];


// ─── CompanionView ───

export class CompanionView extends BaseView {
  constructor(params) { super(params); }

  render() {
    this.el = el('div', { className: 'companion-view' });

    // Header — poetic, minimal
    this.el.appendChild(el('header', { className: 'companion-header' }, [
      el('button', { className: 'tap companion-back', onClick: () => navigate('/console'), 'aria-label': '返回' }, ICONS.back(20)),
      el('h1', { className: 'companion-title', textContent: '你想要什么样的陪伴' }),
      el('p', { className: 'companion-subtitle', textContent: '每个选择都在塑造她——你的 Mio' }),
    ]));

    // Content sections
    const content = el('div', { className: 'companion-content' });
    content.appendChild(this.buildCharacterSection());
    content.appendChild(this.buildVoiceSection());
    content.appendChild(this.buildIntimacySection());
    content.appendChild(this.buildEngineLink());
    this.el.appendChild(content);

    return this.el;
  }

  async mount() {
    try {
      const data = await api.get('/admin/config');
      this.config = data;
    } catch {
      this.config = { activeMod: 'female', voice: 'warm', intimacy: 'moderate' };
    }
  }

  // ─── 角色选择 ───

  buildCharacterSection() {
    const active = this.config?.activeMod || 'female';
    const grid = el('div', { className: 'companion-char-grid' });

    CHARACTERS.forEach((char) => {
      const isActive = char.id === active;
      const card = el('div', {
        className: `companion-char-card ${isActive ? 'active' : ''}`,
        onClick: () => this.selectCharacter(char.id),
      }, [
        el('div', { className: 'companion-char-avatar', textContent: char.name.charAt(0) }),
        el('div', { className: 'companion-char-meta' }, [
          el('div', { className: 'companion-char-name', textContent: char.name }),
          el('div', { className: 'companion-char-tag', textContent: char.tag }),
        ]),
        el('div', { className: 'companion-char-desc', textContent: char.desc }),
        isActive ? el('div', { className: 'companion-char-check', textContent: '当前' }) : null,
      ]);
      grid.appendChild(card);
    });

    return this.wrapSection('谁在陪你', grid);
  }

  // ─── 语气 ───

  buildVoiceSection() {
    return this.wrapSection('她怎么说话', this.buildPills(VOICES, this.config?.voice || 'warm', 'voice'));
  }

  // ─── 节奏 ───

  buildIntimacySection() {
    return this.wrapSection('你们的关系节奏', this.buildPills(INTIMACIES, this.config?.intimacy || 'moderate', 'intimacy'));
  }

  // ─── 引擎链接 ───

  buildEngineLink() {
    const btn = el('button', {
      className: 'companion-engine-btn tap',
      textContent: '模型与接入 · 技术配置',
      onClick: () => navigate('/settings'),
    });
    return this.wrapSection('幕后引擎', btn);
  }

  // ─── 组件 ───

  wrapSection(title, body) {
    const s = el('section', { className: 'companion-section' });
    s.appendChild(el('h2', { className: 'companion-section-title', textContent: title }));
    s.appendChild(body);
    return s;
  }

  buildPills(items, activeId, key) {
    const row = el('div', { className: 'companion-pills' });
    items.forEach((item) => {
      const isActive = item.id === activeId;
      const pill = el('div', {
        className: `companion-pill ${isActive ? 'active' : ''}`,
        onClick: () => this.selectPill(key, item.id),
      }, [
        el('div', { className: 'companion-pill-dot' }),
        el('div', { className: 'companion-pill-text' }, [
          el('div', { className: 'companion-pill-label', textContent: item.label }),
          el('div', { className: 'companion-pill-desc', textContent: item.desc }),
        ]),
      ]);
      row.appendChild(pill);
    });
    return row;
  }

  // ─── 操作 ───

  async selectCharacter(id) {
    try {
      await api.post(`/character/${id}/activate`);
      this.config.activeMod = id;
      this.refresh();
      toast('角色已切换', 'success');
    } catch { toast('切换失败', 'error'); }
  }

  async selectPill(key, id) {
    try {
      await api.patch('/admin/config', { [key]: id });
      this.config[key] = id;
      this.refresh();
    } catch { toast('保存失败', 'error'); }
  }

  refresh() {
    const content = this.el.querySelector('.companion-content');
    if (content) {
      content.innerHTML = '';
      content.appendChild(this.buildCharacterSection());
      content.appendChild(this.buildVoiceSection());
      content.appendChild(this.buildIntimacySection());
      content.appendChild(this.buildEngineLink());
    }
  }
}

// ─── 路由注册 ───

let instance = null;
export function renderCompanion(params) { instance = new CompanionView(params); return instance.render(); }
export function mountCompanion() { if (instance) instance.mount(); }
export function unmountCompanion() { if (instance) { instance.unmount(); instance = null; } }
