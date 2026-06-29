import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { mascotSrc } from '../mascot.js';
import { renderGenderPicker } from './gender.js';

const UI_TO_BACKEND_MOD = { girlfriend: 'female', boyfriend: 'male' };

function toBackendMod(mod) {
  return UI_TO_BACKEND_MOD[mod] || mod;
}

export class OnboardingView extends BaseView {
  constructor(params) {
    super(params);
    this.step = 1;
    this.answers = {};
    this.progressText = null;
    this.progressBar = null;
  }

  render() {
    this.el = el('div', { className: 'onboarding-view', id: 'onboarding-view' });

    const shell = el('section', { className: 'onboarding-panel ui-panel', 'aria-label': 'Mio 初始设置' });

    const top = el('div', { className: 'onboarding-top' });
    const avatar = el('div', { className: 'avatar', style: { width: '96px', height: '96px' } });
    const img = el('img', { alt: 'Mio', src: mascotSrc('gentle') });
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    avatar.appendChild(img);
    top.appendChild(el('div', { className: 'onboarding-brand' }, [
      avatar,
      el('div', {}, [
        el('div', { className: 'onboarding-brand-title', textContent: 'Mio' }),
        el('div', { className: 'onboarding-brand-sub', textContent: '初始设置' }),
      ]),
    ]));

    this.progressText = el('span', { className: 'onboarding-progress-text' });
    this.progressBar = el('i');
    top.appendChild(el('div', { className: 'onboarding-progress', 'aria-label': '设置进度' }, [
      this.progressText,
      el('span', { className: 'onboarding-progress-track', 'aria-hidden': 'true' }, [this.progressBar]),
    ]));
    shell.appendChild(top);

    /* 内容 */
    const content = el('div', { id: 'onboarding-content', className: 'onboarding-content' });
    shell.appendChild(content);
    this.el.appendChild(shell);

    return this.el;
  }

  mount() {
    this.step = 1;
    this.answers = {};
    this.renderStep(1);
  }

  unmount() {
    super.unmount();
  }

  renderStep(n) {
    const content = this.el.querySelector('#onboarding-content');
    if (!content) return;

    content.innerHTML = '';
    this.updateProgress(n);

    switch (n) {
      case 1: this.renderStep1(content); break;
      case 2: this.renderStep2(content); break;
      case 3: this.renderStep3(content); break;
      case 4: this.renderStep4(content); break;
      case 5: this.renderStep5(content); break;
      case 6: this.renderStep6(content); break;
      case 7: this.renderStep7(content); break;
    }
  }

  renderStep1(content) {
    /* "嘿。" */
    content.appendChild(el('h2', { className: 'onboarding-question', textContent: '嘿。' }));
    content.appendChild(el('button', {
      className: 'onboarding-next ui-button ui-button--primary',
      type: 'button',
      textContent: '你好',
      onClick: () => { this.step = 2; this.renderStep(2); },
    }));
  }

  renderStep2(content) {
    /* "我叫 Mio。你怎么称呼？" */
    content.appendChild(el('h2', {
      className: 'onboarding-question',
      textContent: '我叫 Mio。\n你怎么称呼？',
    }));

    const input = el('input', {
      className: 'onboarding-input ui-field',
      type: 'text',
      placeholder: '输入你的名字',
      onInput: (e) => {
        nextBtn.disabled = !e.target.value.trim();
      },
    });

    content.appendChild(input);

    const nextBtn = el('button', {
      className: 'onboarding-next ui-button ui-button--primary',
      type: 'button',
      textContent: '继续',
      disabled: 'disabled',
      onClick: () => {
        this.answers.name = input.value.trim();
        this.submitOnboarding(this.step, this.answers.name);
        this.step = 3;
        this.renderStep(3);
      },
    });
    content.appendChild(nextBtn);

    setTimeout(() => input.focus(), 400);
  }

  renderStep3(content) {
    /* 选择 Mio 的性别 —— 只选"她 / 他",不预设任何恋爱标签 */
    content.appendChild(el('h2', {
      className: 'onboarding-question',
      textContent: 'Mio 会是\n她，还是他？',
    }));

    content.appendChild(renderGenderPicker({
      value: this.answers.gender,
      onSelect: (mod) => {
        this.answers.gender = mod;
        nextBtn.disabled = false;
      },
    }));

    const nextBtn = el('button', {
      className: 'onboarding-next ui-button ui-button--primary',
      type: 'button',
      textContent: '继续',
      disabled: this.answers.gender ? undefined : 'disabled',
      onClick: () => {
        this.applyGender(this.answers.gender);
        this.submitOnboarding(this.step, toBackendMod(this.answers.gender));
        this.step = 4;
        this.renderStep(4);
      },
    });
    content.appendChild(nextBtn);
  }

  renderStep4(content) {
    /* "你希望我是什么性格？" */
    content.appendChild(el('h2', {
      className: 'onboarding-question',
      textContent: '你希望我\n是什么性格？',
    }));

    const choices = el('div', { className: 'onboarding-choices' });
    ['温柔', '冷酷', '活泼', '成熟'].forEach(style => {
      choices.appendChild(el('button', {
        className: 'onboarding-choice ui-button ui-button--secondary',
        type: 'button',
        textContent: style,
        onClick: (e) => {
          e.target.classList.toggle('selected');
          this.answers.style = Array.from(choices.querySelectorAll('.selected')).map(c => c.textContent).join('、');
          nextBtn.disabled = !choices.querySelector('.selected');
        },
      }));
    });
    content.appendChild(choices);

    const nextBtn = el('button', {
      className: 'onboarding-next ui-button ui-button--primary',
      type: 'button',
      textContent: '继续',
      disabled: 'disabled',
      onClick: () => {
        this.submitOnboarding(this.step, this.answers.style);
        this.step = 5;
        this.renderStep(5);
      },
    });
    content.appendChild(nextBtn);
  }

  renderStep5(content) {
    content.appendChild(el('h2', {
      className: 'onboarding-question',
      textContent: '可以把重要的事\n长期记住吗？',
    }));

    const choices = this.binaryChoices({
      yes: '可以',
      no: '先不要',
      onSelect: (value) => {
        this.answers.memoryConsent = value;
        nextBtn.disabled = false;
      },
    });
    content.appendChild(choices);

    const nextBtn = el('button', {
      className: 'onboarding-next ui-button ui-button--primary',
      type: 'button',
      textContent: '继续',
      disabled: 'disabled',
      onClick: () => {
        this.submitOnboarding(this.step, String(this.answers.memoryConsent));
        this.step = 6;
        this.renderStep(6);
      },
    });
    content.appendChild(nextBtn);
  }

  renderStep6(content) {
    content.appendChild(el('h2', {
      className: 'onboarding-question',
      textContent: '要不要允许我\n偶尔主动问候？',
    }));

    const choices = this.binaryChoices({
      yes: '允许',
      no: '不要主动',
      onSelect: (value) => {
        this.answers.proactiveOptIn = value;
        nextBtn.disabled = false;
      },
    });
    content.appendChild(choices);

    const nextBtn = el('button', {
      className: 'onboarding-next ui-button ui-button--primary',
      type: 'button',
      textContent: '继续',
      disabled: 'disabled',
      onClick: () => {
        this.submitOnboarding(this.step, String(this.answers.proactiveOptIn));
        this.step = 7;
        this.renderStep(7);
      },
    });
    content.appendChild(nextBtn);
  }

  renderStep7(content) {
    /* 完成 */
    content.appendChild(el('div', { className: 'onboarding-done' }, [
      el('div', { className: 'onboarding-done-check', textContent: '✓' }),
      el('h2', { textContent: '好的。' }),
      el('p', { textContent: '你之后也可以在设置里改。' }),
      el('button', {
        className: 'onboarding-next ui-button ui-button--primary',
        type: 'button',
        textContent: '开始对话',
        onClick: () => {
          this.submitOnboarding(7, 'done');
          navigate('/chat');
        },
      }),
    ]));
  }

  binaryChoices({ yes, no, onSelect }) {
    const choices = el('div', { className: 'onboarding-choices onboarding-choices--binary' });
    [
      ['true', yes],
      ['false', no],
    ].forEach(([value, label]) => {
      choices.appendChild(el('button', {
        className: 'onboarding-choice ui-button ui-button--secondary',
        type: 'button',
        textContent: label,
        onClick: (e) => {
          choices.querySelectorAll('.onboarding-choice').forEach((node) => node.classList.remove('selected'));
          e.currentTarget.classList.add('selected');
          onSelect(value === 'true');
        },
      }));
    });
    return choices;
  }

  updateProgress(step) {
    const pct = Math.max(0, Math.min(100, Math.round((step / 7) * 100)));
    if (this.progressText) this.progressText.textContent = `步骤 ${step} / 7`;
    if (this.progressBar) this.progressBar.style.width = `${pct}%`;
  }

  async submitOnboarding(stepNum, value) {
    try {
      await api.post('/onboarding/next', { step: stepNum, value });
    } catch (err) {
      // 引导流程容忍网络错误，但不静默 — 开发时可在 console 看到
      if (import.meta.env?.DEV) console.warn('[onboarding] submit failed:', err.message);
    }
  }

  /** 设置 Mio 性别 = 切换内部 mod(她→girlfriend / 他→boyfriend)。best-effort。 */
  async applyGender(mod) {
    if (mod !== 'girlfriend' && mod !== 'boyfriend') return;
    try {
      await api.post('/mod', { name: toBackendMod(mod) });
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('[onboarding] set gender failed:', err.message);
    }
  }
}

// Export compat
let onboardingViewInstance = null;

export function renderOnboarding(params) {
  onboardingViewInstance = new OnboardingView(params);
  return onboardingViewInstance.render();
}

export function mountOnboarding() {
  if (onboardingViewInstance) onboardingViewInstance.mount();
}

export function unmountOnboarding() {
  if (onboardingViewInstance) {
    onboardingViewInstance.unmount();
    onboardingViewInstance = null;
  }
}
