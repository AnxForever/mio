/**
 * chat.js — 聊天视图
 *
 * 核心视图 — 用户 90% 时间待的地方。
 * iMessage 气泡、流式渲染、Canvas 情绪球、语音输入。
 */

import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { wsManager } from '../ws.js';
import { EmotionBall } from '../components/emotion-ball.js';
import { createTypingIndicator, renderMessages, appendMessage } from '../components/bubble.js';
import { renderTabBar } from '../components/tab-bar.js';
import { haptic } from '../utils/haptics.js';
import { getMoodInfo, STAGE_LABELS } from '../utils/constants.js';

let emotionBall = null;
let chatMessages = null;
let typingEl = null;
let msgInput = null;
let sendBtn = null;
let personaCb = null;
let statusDot = null;
let statusText = null;
let unsubscribers = [];

export function renderChat() {
  const view = el('div', { className: 'chat-view' });

  /* ═══ 顶栏 ═══ */
  const header = el('header', { className: 'chat-header' });

  const ballCanvas = el('canvas', { className: 'emotion-ball', width: '40', height: '40' });
  header.appendChild(ballCanvas);

  const info = el('div', { className: 'chat-header-info' });
  const name = el('div', { className: 'chat-header-name', textContent: Store.get('activeMod') === 'boyfriend' ? 'Mio' : 'Mio' });
  const status = el('div', { className: 'chat-header-status' });
  statusDot = el('span', { className: 'dot off' });
  statusText = el('span', { textContent: '连接中…' });
  status.appendChild(statusDot);
  status.appendChild(statusText);
  info.appendChild(name);
  info.appendChild(status);
  header.appendChild(info);

  /* 人格切换 */
  const toggle = el('label', { className: 'persona-toggle' });
  personaCb = el('input', { type: 'checkbox' });
  const gfLabel = el('span', { className: 'pt-label', textContent: '女友', dataset: { mod: 'girlfriend' } });
  const bfLabel = el('span', { className: 'pt-label', textContent: '男友', dataset: { mod: 'boyfriend' } });
  toggle.appendChild(personaCb);
  toggle.appendChild(gfLabel);
  toggle.appendChild(bfLabel);
  header.appendChild(toggle);

  view.appendChild(header);

  /* ═══ 聊天区 ═══ */
  chatMessages = el('div', { className: 'chat-messages' });

  /* 欢迎语 */
  const welcome = el('div', { className: 'welcome' });
  const wMark = el('div', { className: 'w-mark' });
  const wBall = el('canvas', { width: '72', height: '72' });
  wMark.appendChild(wBall);
  welcome.appendChild(wMark);
  welcome.appendChild(el('h2', { textContent: 'Mio' }));
  welcome.appendChild(el('p', { textContent: '你的情感陪伴伙伴\n说点什么，开始这段对话吧' }));
  chatMessages.appendChild(welcome);

  /* 打字指示器 */
  typingEl = createTypingIndicator();
  chatMessages.appendChild(typingEl);

  view.appendChild(chatMessages);

  /* ═══ 输入区 ═══ */
  const inputArea = el('div', { className: 'chat-input-area' });

  /* 语音按钮 */
  const voiceBtn = el('button', { className: 'voice-btn' });
  const voiceIcon = el('svg', {
    className: 'voice-icon',
    viewBox: '0 0 24 24',
    innerHTML: '<path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>',
  });
  voiceBtn.appendChild(voiceIcon);
  inputArea.appendChild(voiceBtn);

  const inputWrap = el('div', { className: 'chat-input-wrap' });
  msgInput = el('textarea', {
    rows: '1',
    placeholder: '说点什么…',
    enterkeyhint: 'send',
  });
  inputWrap.appendChild(msgInput);
  inputArea.appendChild(inputWrap);

  sendBtn = el('button', { className: 'send-btn', disabled: 'disabled' }, [
    el('span', { className: 'send-arrow' }),
  ]);
  inputArea.appendChild(sendBtn);

  view.appendChild(inputArea);

  /* ═══ 底部导航 ═══ */
  view.appendChild(renderTabBar());

  return view;
}

export function mountChat() {
  /* Canvas 情绪球 */
  const ballCanvas = document.querySelector('.chat-header .emotion-ball');
  if (ballCanvas) {
    emotionBall = new EmotionBall(ballCanvas, { size: 40 });
    emotionBall.start();

    /* 初始状态 */
    const mood = Store.get('emotion')?.myMood || 'calm';
    const affection = Store.get('affection') || 0;
    const stage = Store.get('stage') || 'acquaintance';
    emotionBall.setState(mood, affection, stage);
  }

  /* 欢迎页的情绪球 */
  const wBall = document.querySelector('.welcome .w-mark canvas');
  if (wBall) {
    const wEmotionBall = new EmotionBall(wBall, { size: 72 });
    const mood = Store.get('emotion')?.myMood || 'calm';
    wEmotionBall.setState(mood, Store.get('affection') || 0);
    wEmotionBall.start();
  }

  /* ─── 事件绑定 ─── */
  sendBtn.addEventListener('click', handleSend);
  msgInput.addEventListener('keydown', handleKey);
  msgInput.addEventListener('input', handleInput);

  /* 语音按钮 */
  const voiceBtn = document.querySelector('.voice-btn');
  if (voiceBtn && window.webkitSpeechRecognition) {
    let recognition = null;
    voiceBtn.addEventListener('pointerdown', () => {
      haptic('light');
      voiceBtn.classList.add('recording');
      recognition = new window.webkitSpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onresult = (ev) => {
        const text = ev.results[0][0].transcript;
        msgInput.value = text;
        handleInput();
        haptic('light');
      };
      recognition.onend = () => voiceBtn.classList.remove('recording');
      recognition.onerror = () => voiceBtn.classList.remove('recording');
      recognition.start();
    });
    voiceBtn.addEventListener('pointerup', () => {
      if (recognition) { recognition.stop(); recognition = null; }
    });
  } else if (voiceBtn) {
    voiceBtn.style.display = 'none';
  }

  personaCb.addEventListener('change', handlePersonaSwitch);

  /* ─── Store 订阅 ─── */
  unsubscribers.push(Store.on('connected', (v) => {
    toggleClassSafe(statusDot, 'offline', !v);
    toggleClassSafe(statusDot, 'online', v);
    if (v) statusText.textContent = '在线';
    else statusText.textContent = '离线';
  }));

  unsubscribers.push(Store.on('affection', (v) => {
    if (emotionBall) emotionBall.setState(emotionBall.mood, v, emotionBall.stage);
  }));

  unsubscribers.push(Store.on('personaMode', (v) => {
    toggleClassSafe(statusDot, 'deep', v === 'deep');
  }));

  /* 初始加载状态 */
  fetchStatus();
}

export function unmountChat() {
  if (emotionBall) { emotionBall.stop(); emotionBall = null; }
  for (const unsub of unsubscribers) unsub();
  unsubscribers = [];
}

/* ─── Handlers ─── */

let streaming = false;
let streamBuffer = '';
let streamMsgEl = null;

async function handleSend() {
  if (streaming) return;

  const text = msgInput.value.trim();
  if (!text) return;

  haptic('light');
  streaming = true;
  disableInput();

  /* 移除欢迎语 */
  const welcome = chatMessages.querySelector('.welcome');
  if (welcome) welcome.remove();

  /* 添加用户消息 */
  const timestamp = new Date().toISOString();
  const userMsg = { role: 'user', text, timestamp };
  const prevMsg = Store.get('messages').slice(-1)[0];
  appendMessage(chatMessages, userMsg, prevMsg);

  Store.set('messages', [...Store.get('messages'), userMsg]);

  msgInput.value = '';
  msgInput.style.height = 'auto';

  /* 显示打字 */
  typingEl.classList.add('show');
  chatMessages.scrollTop = chatMessages.scrollHeight;

  /* 流式缓冲区 */
  streamBuffer = '';
  streamMsgEl = null;

  const onToken = (chunk) => {
    streamBuffer += chunk;
    if (!streamMsgEl) {
      typingEl.classList.remove('show');
      streamMsgEl = createStreamBubble();
      chatMessages.appendChild(streamMsgEl);
    }
    streamMsgEl.querySelector('.msg-bubble').textContent = streamBuffer;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  const onDone = () => {
    finalizeStream(timestamp);
    haptic('medium');
    fetchStatus();
  };

  const onError = (err) => {
    if (streamMsgEl) {
      streamMsgEl.querySelector('.msg-bubble').textContent = err || '出错了，请重试';
      streamMsgEl.classList.add('error');
    }
    finalizeStream(timestamp);
  };

  await wsManager.sendChat(text, { onToken, onDone, onError });
}

function createStreamBubble() {
  const div = el('div', { className: 'msg mio' });
  const bubble = el('div', { className: 'msg-bubble' });
  div.appendChild(bubble);
  return div;
}

function finalizeStream(userTimestamp) {
  if (streamMsgEl) {
    const time = el('div', { className: 'msg-time', textContent: new Date().toTimeString().slice(0, 5) });
    streamMsgEl.appendChild(time);

    const text = streamBuffer;
    Store.set('messages', [...Store.get('messages'), {
      role: 'mio',
      text,
      timestamp: new Date().toISOString(),
    }]);
  }

  streamMsgEl = null;
  streamBuffer = '';
  streaming = false;
  enableInput();
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function handleInput() {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
  sendBtn.disabled = streaming || !msgInput.value.trim();
}

function disableInput() {
  msgInput.disabled = true;
  sendBtn.disabled = true;
}

function enableInput() {
  msgInput.disabled = false;
  sendBtn.disabled = !msgInput.value.trim();
  msgInput.focus();
}

async function handlePersonaSwitch() {
  const mod = personaCb.checked ? 'boyfriend' : 'girlfriend';
  try {
    await api.post('/mod', { name: mod });
    wsManager.switchMod(mod);
    fetchStatus();
  } catch {}
}

async function fetchStatus() {
  try {
    const data = await api.get('/status');
    if (!data) return;

    const { config, emotion, relationship } = data;
    document.querySelector('.chat-header-name').textContent = config?.name || 'Mio';

    const mood = emotion?.myMood || '平静';
    const info = getMoodInfo(mood);
    const stage = STAGE_LABELS[relationship?.stage] || '';
    statusText.textContent = stage ? `${stage} · ${info.label}` : info.label;

    Store.patch({
      activeMod: config?.activeMod || 'girlfriend',
      emotion,
      relationship,
      affection: emotion?.affection || 0,
      stage: relationship?.stage || 'acquaintance',
    });

    if (emotionBall) {
      emotionBall.setState(mood, emotion?.affection || 0, relationship?.stage || 'acquaintance');
    }

    personaCb.checked = (config?.gender || config?.activeMod) === 'boyfriend';
    toggleClassSafe(statusDot, 'off', false);
    toggleClassSafe(statusDot, 'online', true);
  } catch {
    toggleClassSafe(statusDot, 'off', true);
    toggleClassSafe(statusDot, 'online', false);
    statusText.textContent = '离线';
  }
}

function toggleClassSafe(el, cls, force) {
  if (el) el.classList.toggle(cls, force);
}
