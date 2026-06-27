import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { mascotSrc } from '../mascot.js';
import { renderGenderPicker } from './gender.js';

export class OnboardingView extends BaseView {
  constructor(params) {
    super(params);
    this.step = 1;
    this.answers = {};
  }

  render() {
    this.el = el('div', { className: 'onboarding-view', id: 'onboarding-view' });

    /* 线条猫头像 */
    const ballWrap = el('div', { className: 'onboarding-ball' });
    const avatar = el('div', { className: 'avatar', style: { width: '96px', height: '96px' } });
    const img = el('img', { alt: 'Mio', src: mascotSrc('gentle') });
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    avatar.appendChild(img);
    ballWrap.appendChild(avatar);
    this.el.appendChild(ballWrap);

    /* 内容 */
    const content = el('div', { id: 'onboarding-content' });
    this.el.appendChild(content);

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

    switch (n) {
      case 1: this.renderStep1(content); break;
      case 2: this.renderStep2(content); break;
      case 3: this.renderStep3(content); break;
      case 4: this.renderStep4(content); break;
      case 5: this.renderStep5(content); break;
    }
  }

  renderStep1(content) {
    /* "嘿。" */
    content.appendChild(el('h2', { className: 'onboarding-question', textContent: '嘿。' }));
    content.appendChild(el('button', {
      className: 'onboarding-next',
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
      className: 'onboarding-input',
      type: 'text',
      placeholder: '输入你的名字',
      onInput: (e) => {
        nextBtn.disabled = !e.target.value.trim();
      },
    });

    content.appendChild(input);

    const nextBtn = el('button', {
      className: 'onboarding-next',
      textContent: '→',
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
      className: 'onboarding-next',
      textContent: '→',
      disabled: this.answers.gender ? undefined : 'disabled',
      onClick: () => {
        this.applyGender(this.answers.gender);
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
        className: 'onboarding-choice',
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
      className: 'onboarding-next',
      textContent: '→',
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
    /* 完成 */
    content.appendChild(el('div', { className: 'onboarding-done' }, [
      el('div', { className: 'onboarding-done-check', textContent: '✓' }),
      el('h2', { textContent: '好的。' }),
      el('p', { textContent: '我准备好了。' }),
      el('button', {
        className: 'onboarding-next',
        textContent: '开始对话',
        onClick: () => {
          this.submitOnboarding(5, 'done');
          navigate('/chat');
        },
      }),
    ]));
  }

  async submitOnboarding(stepNum, value) {
    try {
      await api.post('/onboarding/next', { step: stepNum, value });
    } catch (err) {
      // 引导流程容忍网络错误，但不静默 — 开发时可在 console 看到
      if (import.meta.env.DEV) console.warn('[onboarding] submit failed:', err.message);
    }
  }

  /** 设置 Mio 性别 = 切换内部 mod(她→girlfriend / 他→boyfriend)。best-effort。 */
  async applyGender(mod) {
    if (mod !== 'girlfriend' && mod !== 'boyfriend') return;
    try {
      await api.post('/mod', { name: mod });
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[onboarding] set gender failed:', err.message);
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
