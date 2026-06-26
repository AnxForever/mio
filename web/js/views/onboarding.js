/**
 * onboarding.js — 新手引导视图
 *
 * 5 步线性引导, 与后端 /onboarding 端点对齐。
 * 每步模拟对话节奏, 情绪球微反应。
 */

import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { EmotionBall } from '../components/emotion-ball.js';

let ball = null;
let step = 1;
let answers = {};

export function renderOnboarding() {
  const view = el('div', { className: 'onboarding-view', id: 'onboarding-view' });

  /* 情绪球 */
  const ballWrap = el('div', { className: 'onboarding-ball' });
  const ballCanvas = el('canvas', { width: '96', height: '96' });
  ballWrap.appendChild(ballCanvas);
  view.appendChild(ballWrap);

  /* 内容 */
  const content = el('div', { id: 'onboarding-content' });
  view.appendChild(content);

  return view;
}

export function mountOnboarding() {
  const ballCanvas = document.querySelector('.onboarding-ball canvas');
  if (ballCanvas) {
    ball = new EmotionBall(ballCanvas, { size: 96 });
    ball.setState('平静', 0, 'acquaintance');
    ball.start();
  }

  step = 1;
  answers = {};
  renderStep(1);
}

export function unmountOnboarding() {
  if (ball) { ball.stop(); ball = null; }
}

function renderStep(n) {
  const content = document.getElementById('onboarding-content');
  if (!content) return;

  content.innerHTML = '';

  switch (n) {
    case 1: renderStep1(content); break;
    case 2: renderStep2(content); break;
    case 3: renderStep3(content); break;
    case 4: renderStep4(content); break;
    case 5: renderStep5(content); break;
  }
}

function renderStep1(content) {
  /* "嘿。" */
  if (ball) ball.setState('calm', 5, 'acquaintance');

  content.appendChild(el('h2', { className: 'onboarding-question', textContent: '嘿。' }));
  content.appendChild(el('button', {
    className: 'onboarding-next',
    textContent: '你好',
    onClick: () => { step = 2; renderStep(2); },
  }));
}

function renderStep2(content) {
  /* "我叫 Mio。你怎么称呼？" */
  if (ball) ball.setState('calm', 10, 'acquaintance');

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
      answers.name = input.value.trim();
      submitOnboarding(step, answers.name);
      step = 3;
      renderStep(3);
    },
  });
  content.appendChild(nextBtn);

  setTimeout(() => input.focus(), 400);
}

function renderStep3(content) {
  /* "你想让我做你的什么？" */
  if (ball) ball.setState('shy', 15, 'acquaintance');

  content.appendChild(el('h2', {
    className: 'onboarding-question',
    textContent: '你想让我\n做你的什么？',
  }));

  const choices = el('div', { className: 'onboarding-choices' });
  ['女友', '男友'].forEach(label => {
    const gender = label === '男友' ? 'boyfriend' : 'girlfriend';
    choices.appendChild(el('button', {
      className: 'onboarding-choice',
      textContent: `${label === '女友' ? '🤍' : '💙'} ${label}`,
      onClick: (e) => {
        choices.querySelectorAll('.onboarding-choice').forEach(c => c.classList.remove('selected'));
        e.target.classList.add('selected');
        answers.gender = gender;
        nextBtn.disabled = false;
      },
    }));
  });
  content.appendChild(choices);

  const nextBtn = el('button', {
    className: 'onboarding-next',
    textContent: '→',
    disabled: 'disabled',
    onClick: () => {
      submitOnboarding(step, answers.gender);
      step = 4;
      renderStep(4);
    },
  });
  content.appendChild(nextBtn);
}

function renderStep4(content) {
  /* "你希望我是什么性格？" */
  if (ball) ball.setState('shy', 20, 'acquaintance');

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
        answers.style = Array.from(choices.querySelectorAll('.selected')).map(c => c.textContent).join('、');
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
      submitOnboarding(step, answers.style);
      step = 5;
      renderStep(5);
    },
  });
  content.appendChild(nextBtn);
}

function renderStep5(content) {
  /* 完成 */
  if (ball) ball.setState('warmth', 30, 'familiar');

  content.appendChild(el('div', { className: 'onboarding-done' }, [
    el('div', { className: 'onboarding-done-check', textContent: '✓' }),
    el('h2', { textContent: '好的。' }),
    el('p', { textContent: '我准备好了。' }),
    el('button', {
      className: 'onboarding-next',
      textContent: '开始对话',
      onClick: () => {
        submitOnboarding(5, 'done');
        navigate('/chat');
      },
    }),
  ]));
}

async function submitOnboarding(stepNum, value) {
  try {
    await api.post('/onboarding/next', { step: stepNum, value });
  } catch {
    /* 引导流程可以容忍网络错误 */
  }
}
