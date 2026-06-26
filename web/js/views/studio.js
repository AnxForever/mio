/**
 * studio.js — Persona Studio 视图
 *
 * Mod 管理: 列表、创建、编辑、切换、删除。
 */

import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { wsManager } from '../ws.js';
import { navigate } from '../router.js';
import { renderTabBar } from '../components/tab-bar.js';
import { EmotionBall } from '../components/emotion-ball.js';
import { toast } from '../components/toast.js';

const VALID_MODS = ['girlfriend', 'boyfriend'];
let _wizardState = null;

export function renderStudio(params = {}) {
  const view = el('div', { className: 'studio-view' });

  /* 顶栏 */
  const header = el('header', { className: 'studio-header' });
  const backBtn = el('button', {
    className: 'studio-back-btn',
    innerHTML: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
    onClick: () => navigate('/chat'),
  });
  const title = el('h1', { className: 'studio-header-title', textContent: params.id ? '编辑人格' : '人格工作室' });
  const newBtn = el('button', {
    className: 'studio-new-btn',
    textContent: '+',
    onClick: () => startNewMod(),
  });

  header.appendChild(backBtn);
  header.appendChild(title);
  header.appendChild(newBtn);
  view.appendChild(header);

  const content = el('div', { className: 'studio-content', id: 'studio-content' });
  view.appendChild(content);
  view.appendChild(renderTabBar());

  /* 异步加载 Mod 列表 */
  loadModList(content);

  return view;
}

export function mountStudio() {
  const content = document.getElementById('studio-content');
  if (content) loadModList(content);
}

export function unmountStudio() {}

/* ─── 加载 Mod 列表 ─── */
async function loadModList(container) {
  container.innerHTML = '';

  /* 先展示骨架 */
  container.appendChild(skeletonModList());

  try {
    const data = await api.get('/status');
    const mods = buildModList(data);

    container.innerHTML = '';
    container.appendChild(renderModGallery(mods, data));
  } catch {
    container.innerHTML = '';
    container.appendChild(el('div', {
      className: 'welcome',
      style: { padding: '60px 32px' },
    }, [
      el('p', { textContent: '加载失败，请检查连接', style: { color: 'var(--mist-500)' } }),
    ]));
  }
}

function buildModList(statusData) {
  const mods = [];

  /* 内置 boyfriend/girlfriend */
  for (const name of VALID_MODS) {
    mods.push({
      name,
      gender: name,
      style: getStyleForMod(name, statusData),
      active: statusData?.config?.activeMod === name,
    });
  }

  /* 自定义 Mod (从后端获取) */
  if (statusData?.mods) {
    for (const m of statusData.mods) {
      if (!VALID_MODS.includes(m.name)) {
        mods.push({ ...m, active: statusData.config?.activeMod === m.name });
      }
    }
  }

  return mods;
}

function getStyleForMod(name, data) {
  /* 尝试从 soul 内容推断风格 */
  if (name === 'boyfriend') return '默认男友';
  if (name === 'girlfriend') return '默认女友';
  return '自定义';
}

/* ─── Mod 画廊渲染 ─── */
function renderModGallery(mods, statusData) {
  const frag = document.createDocumentFragment();

  /* 当前活跃 */
  const activeMods = mods.filter(m => m.active);
  const inactiveMods = mods.filter(m => !m.active);

  if (activeMods.length > 0) {
    frag.appendChild(el('div', { className: 'mod-section' }, [
      el('div', { className: 'mod-section-title', textContent: '当前活跃' }),
      renderActiveDetail(activeMods[0], statusData),
    ]));
  }

  /* 其他人格 */
  if (inactiveMods.length > 0) {
    frag.appendChild(el('div', { className: 'mod-section' }, [
      el('div', { className: 'mod-section-title', textContent: '其他人格' }),
      el('div', { className: 'mod-cards' }, [
        ...inactiveMods.map(mod => renderModCard(mod)),
        renderNewCard(),
      ]),
    ]));
  } else {
    frag.appendChild(el('div', { className: 'mod-section' }, [
      el('div', { className: 'mod-section-title', textContent: '其他人格' }),
      el('div', { className: 'mod-cards' }, [renderNewCard()]),
    ]));
  }

  return frag;
}

function renderActiveDetail(mod, statusData) {
  const card = el('div', { className: 'mod-detail-card' });

  /* 头部 */
  const header = el('div', { className: 'mod-detail-header' });
  const avatarWrap = el('div', { className: 'mod-detail-avatar' });
  const ballCanvas = el('canvas', { width: '56', height: '56' });
  avatarWrap.appendChild(ballCanvas);
  header.appendChild(avatarWrap);

  const info = el('div', { className: 'mod-detail-info' });
  info.appendChild(el('div', { className: 'mod-detail-name', textContent: mod.name === 'girlfriend' ? '女友' : mod.name === 'boyfriend' ? '男友' : mod.name }));
  info.appendChild(el('div', { className: 'mod-detail-meta', textContent: `${mod.style} · ${mod.gender === 'boyfriend' ? '男友' : '女友'}` }));
  header.appendChild(info);
  card.appendChild(header);

  /* 延迟渲染情绪球 */
  setTimeout(() => {
    if (ballCanvas) {
      const ball = new EmotionBall(ballCanvas, { size: 56 });
      const mood = statusData?.emotion?.myMood || '平静';
      ball.setState(mood, statusData?.emotion?.affection || 0, statusData?.relationship?.stage || 'acquaintance');
      ball.start();
    }
  }, 100);

  /* BASE/DEEP 切换 */
  const mode = statusData?.personaMode || Store.get('personaMode') || 'base';
  const modeSwitch = el('div', { className: 'mode-switch' });
  modeSwitch.appendChild(el('span', { className: 'mode-switch-label', textContent: '陪伴模式' }));
  const chips = el('div', { className: 'mode-chips' });
  const baseChip = el('button', {
    className: `mode-chip${mode === 'base' ? ' selected' : ''}`,
    textContent: '日常',
    dataset: { mode: 'base' },
    onClick: () => switchMode('base', chips),
  });
  const deepChip = el('button', {
    className: `mode-chip${mode === 'deep' ? ' selected' : ''}`,
    textContent: '深度',
    dataset: { mode: 'deep' },
    onClick: () => switchMode('deep', chips),
  });
  chips.appendChild(baseChip);
  chips.appendChild(deepChip);
  modeSwitch.appendChild(chips);
  card.appendChild(modeSwitch);

  /* 好感度 */
  const aff = statusData?.emotion?.affection || 0;
  card.appendChild(el('div', { className: 'affection-bar' }, [
    el('div', { className: 'affection-bar-label' }, [
      el('span', { textContent: '好感度' }),
      el('span', { textContent: `${aff}` }),
    ]),
    el('div', { className: 'affection-bar-track' }, [
      el('div', { className: 'affection-bar-fill', style: { width: `${aff}%` } }),
    ]),
  ]));

  /* soul 预览 */
  card.appendChild(el('div', { className: 'soul-preview' }, [
    el('pre', { textContent: '加载中…' }),
  ]));

  /* 操作 */
  const actions = el('div', { className: 'mod-actions' });
  actions.appendChild(el('button', { className: 'btn-secondary', textContent: '编辑 soul', onClick: () => editSoul(mod.name) }));
  actions.appendChild(el('button', { className: 'btn-secondary', textContent: '切换模式', onClick: () => switchMode(mode === 'base' ? 'deep' : 'base', chips) }));
  card.appendChild(actions);

  /* 异步加载 soul 预览 */
  loadSoulPreview(mod.name, card.querySelector('.soul-preview pre'));

  return card;
}

function renderModCard(mod) {
  const isActive = mod.active;

  const card = el('div', {
    className: `mod-card${isActive ? ' active' : ''}`,
    onClick: async () => {
      if (isActive) return;
      try {
        await api.post('/mod', { name: mod.gender || mod.name });
        wsManager.switchMod(mod.gender || mod.name);
        toast('已切换人格', 'success');
        Store.set('activeMod', mod.name);
        loadModList(document.getElementById('studio-content'));
      } catch (e) {
        toast(e.message || '切换失败', 'error');
      }
    },
  });

  const avatar = el('div', { className: 'mod-card-avatar' });
  const ballCanvas = el('canvas', { width: '56', height: '56' });
  avatar.appendChild(ballCanvas);
  card.appendChild(avatar);

  card.appendChild(el('div', { className: 'mod-card-name', textContent: mod.name === 'girlfriend' ? '女友' : mod.name === 'boyfriend' ? '男友' : mod.name }));
  card.appendChild(el('div', { className: 'mod-card-style', textContent: mod.style }));

  /* 延迟渲染 */
  setTimeout(() => {
    if (ballCanvas) {
      const ball = new EmotionBall(ballCanvas, { size: 56 });
      ball.setState('平静', 0, 'acquaintance');
      ball.start();
    }
  }, 100);

  return card;
}

function renderNewCard() {
  return el('div', {
    className: 'mod-card mod-card-new',
    onClick: startNewMod,
  }, [
    el('div', { className: 'plus', textContent: '+' }),
    el('div', { className: 'label', textContent: '新建人格' }),
  ]);
}

/* ─── 新建 Mod 向导 ─── */
function startNewMod() {
  _wizardState = {
    step: 1,
    name: '',
    gender: 'girlfriend',
    style: '',
    age: '',
    occupation: '',
    traits: [],
  };

  renderWizard(1);
}

function renderWizard(step) {
  const container = document.getElementById('studio-content');
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
    case 1: renderWizardStep1(container); break;
    case 2: renderWizardStep2(container); break;
    case 3: renderWizardStep3(container); break;
  }
}

function renderWizardStep1(container) {
  const form = el('div', {});

  /* 名字 */
  form.appendChild(el('div', { className: 'form-group' }, [
    el('label', { className: 'form-label', textContent: '名字' }),
    el('input', {
      className: 'form-input',
      type: 'text',
      placeholder: '给你的 Ta 起个名字',
      value: _wizardState.name,
      onInput: (e) => { _wizardState.name = e.target.value.trim(); },
    }),
  ]));

  /* 性别 */
  form.appendChild(el('div', { className: 'form-group' }, [
    el('label', { className: 'form-label', textContent: '性别' }),
    el('div', { className: 'gender-select' }, [
      renderGenderCard('girlfriend', '🤍', '女友', _wizardState.gender),
      renderGenderCard('boyfriend', '💙', '男友', _wizardState.gender),
    ]),
  ]));

  /* 风格 */
  form.appendChild(el('div', { className: 'form-group' }, [
    el('label', { className: 'form-label', textContent: '风格' }),
    el('div', { className: 'style-chips' }, ['温柔', '冷酷', '活泼', '成熟'].map(s =>
      el('button', {
        className: `style-chip${_wizardState.style === s ? ' selected' : ''}`,
        textContent: s,
        onClick: (e) => selectStyle(s, e.target.parentElement),
      })
    )),
  ]));

  /* 年龄 + 职业 */
  const row = el('div', { className: 'form-group', style: { display: 'flex', gap: 'var(--space-3)' } });
  row.appendChild(el('input', {
    className: 'form-input',
    type: 'number',
    placeholder: '年龄',
    value: _wizardState.age,
    style: { width: '80px' },
    onInput: (e) => { _wizardState.age = e.target.value; },
  }));
  row.appendChild(el('input', {
    className: 'form-input',
    type: 'text',
    placeholder: '职业',
    value: _wizardState.occupation,
    onInput: (e) => { _wizardState.occupation = e.target.value.trim(); },
  }));
  form.appendChild(row);

  container.appendChild(form);

  /* 下一步 */
  container.appendChild(el('button', {
    className: 'wizard-next',
    textContent: '下一步 → 生成预览',
    disabled: !canProceed(1) ? 'disabled' : undefined,
    onClick: () => {
      if (canProceed(1)) {
        _wizardState.step = 2;
        renderWizard(2);
      }
    },
  }));
}

function renderGenderCard(gender, icon, label, selected) {
  return el('div', {
    className: `gender-card${selected === gender ? ' selected' : ''}`,
    onClick: (e) => {
      _wizardState.gender = gender;
      const cards = e.target.parentElement.querySelectorAll('.gender-card');
      cards.forEach(c => c.classList.toggle('selected', c.textContent.includes(label)));
      updateWizardNext();
    },
  }, [
    el('span', { className: 'gender-card-icon', textContent: icon }),
    el('span', { className: 'gender-card-label', textContent: label }),
  ]);
}

function selectStyle(style, parent) {
  _wizardState.style = style;
  parent.querySelectorAll('.style-chip').forEach(c => c.classList.remove('selected'));
  /* :contains() 不是标准 CSS — 用 textContent 遍历匹配 */
  for (const chip of parent.querySelectorAll('.style-chip')) {
    if (chip.textContent.trim() === style) {
      chip.classList.add('selected');
      break;
    }
  }
  updateWizardNext();
}

function updateWizardNext() {
  const btn = document.querySelector('.wizard-next');
  if (btn) btn.disabled = !canProceed(1);
}

function canProceed(step) {
  if (step === 1) return _wizardState.name && _wizardState.gender && _wizardState.style;
  return true;
}

/* ─── Step 2: AI 生成预览 ─── */
async function renderWizardStep2(container) {
  container.appendChild(el('div', { className: 'text-center py-8' }, [
    el('div', { className: 'w-mark', style: { margin: '0 auto var(--space-4)' } }, [
      el('canvas', { width: '56', height: '56' }),
    ]),
    el('p', { className: 'text-body text-muted', textContent: '正在生成人格…' }),
  ]));

  try {
    const result = await api.post('/persona/generate', {
      name: _wizardState.name,
      gender: _wizardState.gender,
      style: _wizardState.style,
      age: _wizardState.age ? parseInt(_wizardState.age) : undefined,
      occupation: _wizardState.occupation || undefined,
      traits: _wizardState.traits,
    });

    container.innerHTML = '';

    /* 预览 */
    container.appendChild(el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label', textContent: '生成预览' }),
      el('div', { className: 'soul-preview', style: { maxHeight: '280px' } }, [
        el('pre', { textContent: result.preview || result.soul?.slice(0, 400) || '生成成功' }),
      ]),
    ]));

    container.appendChild(el('p', {
      className: 'text-caption text-muted',
      textContent: `Token 估算: ~${result.tokenEstimate || '—'}`,
      style: { marginBottom: 'var(--space-5)' },
    }));

    /* 按钮 */
    const actions = el('div', { style: { display: 'flex', gap: 'var(--space-3)' } });
    actions.appendChild(el('button', {
      className: 'btn-secondary',
      style: { flex: 1, padding: 'var(--space-4)' },
      textContent: '重新生成',
      onClick: () => renderWizardStep2(container),
    }));
    actions.appendChild(el('button', {
      className: 'btn-primary',
      style: { flex: 1, padding: 'var(--space-4)' },
      textContent: '保存并激活',
      onClick: () => savePersona(result),
    }));
    container.appendChild(actions);

  } catch (err) {
    container.innerHTML = '';
    container.appendChild(el('p', {
      className: 'text-body text-muted text-center',
      textContent: `生成失败: ${err.message || '未知错误'}`,
      style: { padding: 'var(--space-8)' },
    }));
    container.appendChild(el('button', {
      className: 'btn-secondary',
      style: { width: '100%', padding: 'var(--space-4)' },
      textContent: '返回重试',
      onClick: () => renderWizard(1),
    }));
  }
}

/* ─── Step 3: 保存完成 ─── */
async function savePersona(generated) {
  const container = document.getElementById('studio-content');
  if (!container) return;

  container.innerHTML = '';
  container.appendChild(el('div', { className: 'text-center py-8' }, [
    el('p', { className: 'text-body text-muted', textContent: '正在保存…' }),
  ]));

  try {
    await api.post('/persona/save', {
      name: _wizardState.name,
      gender: _wizardState.gender,
      style: _wizardState.style,
      age: _wizardState.age ? parseInt(_wizardState.age) : undefined,
      occupation: _wizardState.occupation || undefined,
      traits: _wizardState.traits,
    });

    container.innerHTML = '';
    container.appendChild(el('div', {
      className: 'text-center',
      style: { padding: 'var(--space-16) var(--space-6)' },
    }, [
      el('div', { className: 'w-mark', style: { margin: '0 auto var(--space-5)', background: 'var(--success-soft)' } }, [
        el('span', { textContent: '✓', style: { fontSize: '32px', color: 'var(--success)' } }),
      ]),
      el('h2', { className: 'text-heading', textContent: '创建成功' }),
      el('p', { className: 'text-body text-muted', textContent: `${_wizardState.name} 已激活`, style: { marginTop: 'var(--space-2)' } }),
      el('button', {
        className: 'wizard-next',
        textContent: '开始对话',
        onClick: () => navigate('/chat'),
      }),
    ]));

    _wizardState = null;
    Store.set('activeMod', _wizardState?.name || Store.get('activeMod'));

  } catch (err) {
    toast(err.message || '保存失败', 'error');
    renderWizard(2);
  }
}

function renderWizardStep3(container) {
  /* 完成页 — 实际由 savePersona 处理 */
  renderWizardStep2(container);
}

/* ─── 辅助函数 ─── */
async function switchMode(mode, chipsParent) {
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

async function loadSoulPreview(modName, preEl) {
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

async function editSoul(modName) {
  const container = document.getElementById('studio-content');
  if (!container) return;

  let soulContent = '';
  try {
    const data = await api.get(`/mods/${modName}/soul`);
    soulContent = data?.soul || '';
  } catch {}

  container.innerHTML = '';

  container.appendChild(el('div', { className: 'form-group' }, [
    el('label', { className: 'form-label', textContent: `编辑 ${modName} 的 soul.md` }),
    el('textarea', {
      className: 'soul-editor',
      textContent: soulContent,
      onInput: (e) => { soulContent = e.target.value; },
    }),
  ]));

  const actions = el('div', { style: { display: 'flex', gap: 'var(--space-3)' } });
  actions.appendChild(el('button', {
    className: 'btn-secondary',
    style: { flex: 1, padding: 'var(--space-4)' },
    textContent: '取消',
    onClick: () => loadModList(container),
  }));
  actions.appendChild(el('button', {
    className: 'btn-primary',
    style: { flex: 1, padding: 'var(--space-4)' },
    textContent: '保存',
    onClick: async () => {
      try {
        await api.put(`/mods/${modName}/soul`, { soul: soulContent });
        toast('保存成功', 'success');
        loadModList(container);
      } catch {
        toast('保存失败', 'error');
      }
    },
  }));
  container.appendChild(actions);
}

function skeletonModList() {
  return el('div', { className: 'mod-section' }, [
    el('div', { className: 'mod-detail-card', style: { height: '240px' } }),
    el('div', { className: 'mod-cards' }, [
      ...[1, 2, 3].map(() => el('div', {
        className: 'mod-card',
        style: { height: '160px', background: 'var(--mist-100)', animation: 'shimmer 1.5s linear infinite' },
      })),
    ]),
  ]);
}
