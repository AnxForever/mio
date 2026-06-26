import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { wsManager } from '../ws.js';
import { EmotionBall } from '../components/emotion-ball.js';
import { createTypingIndicator, renderMessages, appendMessage, cleanupVirtualObserver } from '../components/bubble.js';
import { renderTabBar } from '../components/tab-bar.js';
import { haptic } from '../utils/haptics.js';
import { getMoodInfo, STAGE_LABELS } from '../utils/constants.js';

export class ChatView extends BaseView {
  constructor(params) {
    super(params);
    this.emotionBall = null;
    this.wEmotionBall = null;
    this.chatMessages = null;
    this.typingEl = null;
    this.msgInput = null;
    this.sendBtn = null;
    this.personaCb = null;
    this.statusDot = null;
    this.statusText = null;
    this.voiceBtn = null;
    this.recognition = null;

    this.streaming = false;
    this.streamBuffer = '';
    this.streamMsgEl = null;
    this._isUserScrolling = false;
    this._lastScrollTop = 0;

    // Bind methods to this
    this.handleSend = this.handleSend.bind(this);
    this.handleKey = this.handleKey.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.handlePersonaSwitch = this.handlePersonaSwitch.bind(this);
    this.fetchStatus = this.fetchStatus.bind(this);
    this.handleScroll = this.handleScroll.bind(this);
  }

  render() {
    this.el = el('div', { className: 'chat-view' });

    /* ═══ 顶栏 ═══ */
    const header = el('header', { className: 'chat-header' });

    const ballCanvas = el('canvas', { className: 'emotion-ball', width: '40', height: '40', role: 'img', 'aria-label': 'Mio情绪球' });
    header.appendChild(ballCanvas);

    const info = el('div', { className: 'chat-header-info' });
    const name = el('div', { className: 'chat-header-name', textContent: Store.get('activeMod') === 'boyfriend' ? 'Mio' : 'Mio' });
    const status = el('div', { className: 'chat-header-status', role: 'status' });
    this.statusDot = el('span', { className: 'dot off' });
    this.statusText = el('span', { textContent: '连接中…' });
    status.appendChild(this.statusDot);
    status.appendChild(this.statusText);
    info.appendChild(name);
    info.appendChild(status);
    header.appendChild(info);

    /* 人格切换 */
    const toggle = el('label', { className: 'persona-toggle', 'aria-label': '切换人格模式' });
    this.personaCb = el('input', { type: 'checkbox', 'aria-label': '切换为男友模式' });
    const gfLabel = el('span', { className: 'pt-label', textContent: '女友', dataset: { mod: 'girlfriend' } });
    const bfLabel = el('span', { className: 'pt-label', textContent: '男友', dataset: { mod: 'boyfriend' } });
    toggle.appendChild(this.personaCb);
    toggle.appendChild(gfLabel);
    toggle.appendChild(bfLabel);
    header.appendChild(toggle);

    this.el.appendChild(header);

    /* ═══ 聊天区 ═══ */
    this.chatMessages = el('div', {
      className: 'chat-messages',
      'aria-live': 'polite',
      'aria-label': '聊天消息',
      role: 'log',
      style: { overflowAnchor: 'none' }
    });

    /* 欢迎语 */
    const welcome = el('div', { className: 'welcome' });
    const wMark = el('div', { className: 'w-mark' });
    const wBall = el('canvas', { width: '72', height: '72' });
    wMark.appendChild(wBall);
    welcome.appendChild(wMark);
    welcome.appendChild(el('h2', { textContent: 'Mio' }));
    welcome.appendChild(el('p', { textContent: '你的情感陪伴伙伴\n说点什么，开始这段对话吧' }));
    this.chatMessages.appendChild(welcome);

    /* 打字指示器 */
    this.typingEl = createTypingIndicator();
    this.chatMessages.appendChild(this.typingEl);

    /* 新消息悬浮提示 */
    this.newMsgToast = el('div', {
      className: 'new-msg-toast',
      textContent: '↓ 新消息',
      role: 'button',
      tabindex: '0',
      'aria-label': '滚动到最新消息',
      style: { display: 'none' }
    });
    const scrollToNew = () => {
      this._isUserScrolling = false;
      this.scrollToBottom();
    };
    this.on(this.newMsgToast, 'click', scrollToNew);
    this.on(this.newMsgToast, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollToNew(); }
    });
    this.el.appendChild(this.newMsgToast);

    this.el.appendChild(this.chatMessages);

    /* ═══ 输入区 ═══ */
    const inputArea = el('div', { className: 'chat-input-area' });

    /* 语音按钮 */
    this.voiceBtn = el('button', { className: 'voice-btn', 'aria-label': '语音输入' });
    const voiceIcon = el('svg', {
      className: 'voice-icon',
      viewBox: '0 0 24 24',
      innerHTML: '<path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>',
    });
    this.voiceBtn.appendChild(voiceIcon);
    inputArea.appendChild(this.voiceBtn);

    const inputWrap = el('div', { className: 'chat-input-wrap' });
    this.msgInput = el('textarea', {
      rows: '1',
      placeholder: '说点什么…',
      enterkeyhint: 'send',
      'aria-label': '消息输入框',
    });
    inputWrap.appendChild(this.msgInput);
    inputArea.appendChild(inputWrap);

    this.sendBtn = el('button', { className: 'send-btn', disabled: 'disabled', 'aria-label': '发送消息' }, [
      el('span', { className: 'send-arrow' }),
    ]);
    inputArea.appendChild(this.sendBtn);

    this.el.appendChild(inputArea);

    /* ═══ 底部导航 ═══ */
    this.el.appendChild(renderTabBar());

    return this.el;
  }

  mount() {
    /* Canvas 情绪球 */
    const ballCanvas = this.el.querySelector('.chat-header .emotion-ball');
    if (ballCanvas) {
      this.emotionBall = new EmotionBall(ballCanvas, { size: 40 });
      this.emotionBall.start();

      /* 初始状态 */
      const mood = Store.get('emotion')?.myMood || 'calm';
      const affection = Store.get('affection') || 0;
      const stage = Store.get('stage') || 'acquaintance';
      this.emotionBall.setState(mood, affection, stage);
    }

    /* 欢迎页的绪球 */
    const wBall = this.el.querySelector('.welcome .w-mark canvas');
    if (wBall) {
      this.wEmotionBall = new EmotionBall(wBall, { size: 72 });
      const mood = Store.get('emotion')?.myMood || 'calm';
      this.wEmotionBall.setState(mood, Store.get('affection') || 0);
      this.wEmotionBall.start();
    }

    /* ─── 事件绑定 ─── */
    this.on(this.sendBtn, 'click', this.handleSend);
    this.on(this.msgInput, 'keydown', this.handleKey);
    this.on(this.msgInput, 'input', this.handleInput);
    this.on(this.chatMessages, 'scroll', this.handleScroll, { passive: true });

    /* 语音按钮 */
    if (this.voiceBtn && window.webkitSpeechRecognition) {
      this.on(this.voiceBtn, 'pointerdown', () => {
        haptic('light');
        this.voiceBtn.classList.add('recording');
        this.recognition = new window.webkitSpeechRecognition();
        this.recognition.lang = 'zh-CN';
        this.recognition.interimResults = false;
        this.recognition.continuous = false;
        this.recognition.onresult = (ev) => {
          const text = ev.results[0][0].transcript;
          this.msgInput.value = text;
          this.handleInput();
          haptic('light');
        };
        this.recognition.onend = () => this.voiceBtn.classList.remove('recording');
        this.recognition.onerror = () => this.voiceBtn.classList.remove('recording');
        this.recognition.start();
      });
      this.on(this.voiceBtn, 'pointerup', () => {
        if (this.recognition) {
          this.recognition.stop();
          this.recognition = null;
        }
      });
    } else if (this.voiceBtn) {
      this.voiceBtn.style.display = 'none';
    }

    this.on(this.personaCb, 'change', this.handlePersonaSwitch);

    /* ─── Store 订阅 ─── */
    this.subscribe(Store, () => {});

    const unsubConnected = Store.on('connected', (v) => {
      this.toggleClassSafe(this.statusDot, 'offline', !v);
      this.toggleClassSafe(this.statusDot, 'online', v);
      if (v) this.statusText.textContent = '在线';
      else this.statusText.textContent = '离线';
    });
    this._unsubscribes.push(unsubConnected);

    const unsubAffection = Store.on('affection', (v) => {
      if (this.emotionBall) this.emotionBall.setState(this.emotionBall.mood, v, this.emotionBall.stage);
    });
    this._unsubscribes.push(unsubAffection);

    const unsubPersonaMode = Store.on('personaMode', (v) => {
      this.toggleClassSafe(this.statusDot, 'deep', v === 'deep');
    });
    this._unsubscribes.push(unsubPersonaMode);

    /* 初始加载状态 */
    this.fetchStatus();

    // Load existing messages
    const messages = Store.get('messages') || [];
    if (messages.length > 0) {
      const welcome = this.chatMessages.querySelector('.welcome');
      if (welcome) welcome.remove();
      renderMessages(this.chatMessages, messages);
    }
  }

  unmount() {
    super.unmount();
    if (this.emotionBall) {
      this.emotionBall.destroy();
      this.emotionBall = null;
    }
    if (this.wEmotionBall) {
      this.wEmotionBall.destroy();
      this.wEmotionBall = null;
    }
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
    cleanupVirtualObserver();
  }

  /* ─── Handlers ─── */

  handleScroll() {
    const currentScrollTop = this.chatMessages.scrollTop;
    // 如果用户向上滚动超过 20px，认为用户正在翻阅历史
    if (this._lastScrollTop - currentScrollTop > 20) {
      this._isUserScrolling = true;
    }
    // 如果滚动到底部（误差内），取消正在滚动状态，隐藏悬浮提示
    if (this.chatMessages.scrollHeight - currentScrollTop - this.chatMessages.clientHeight < 30) {
      this._isUserScrolling = false;
      this.newMsgToast.style.display = 'none';
    }
    this._lastScrollTop = currentScrollTop;
  }

  scrollToBottom() {
    this.requestAnimationFrame(() => {
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      this.newMsgToast.style.display = 'none';
    });
  }

  async handleSend() {
    if (this.streaming) return;
    const text = this.msgInput.value.trim();
    if (!text) return;

    haptic('light');
    this.streaming = true;
    this._isUserScrolling = false;
    this.newMsgToast.style.display = 'none';
    this.disableInput();

    // 移除欢迎语
    const welcome = this.chatMessages.querySelector('.welcome');
    if (welcome) welcome.remove();

    // 添加用户消息到 Store + DOM
    const timestamp = new Date().toISOString();
    const userMsg = { role: 'user', text, timestamp };
    const msgs = Store.get('messages') || [];
    const prevMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    appendMessage(this.chatMessages, userMsg, prevMsg);
    Store.set('messages', [...msgs, userMsg]);

    this.msgInput.value = '';
    this.msgInput.style.height = 'auto';
    this.typingEl.classList.add('show');
    this.scrollToBottom();

    // 初始化流式缓冲区
    this.streamBuffer = '';
    this.streamMsgEl = null;

    const { onToken, onDone, onError } = this._buildStreamCallbacks(timestamp);
    await wsManager.sendChat(text, { onToken, onDone, onError });
  }

  /** 构建流式渲染的三个回调：onToken, onDone, onError */
  _buildStreamCallbacks(timestamp) {
    let rafId = null;

    const onToken = (chunk) => {
      this.streamBuffer += chunk;
      if (!this.streamMsgEl) {
        this.typingEl.classList.remove('show');
        this.streamMsgEl = this.createStreamBubble();
        this.chatMessages.appendChild(this.streamMsgEl);
      }
      this.streamMsgEl.querySelector('.msg-bubble').textContent = this.streamBuffer;

      if (!rafId) {
        rafId = this.requestAnimationFrame(() => {
          if (!this._isUserScrolling) {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
          } else {
            this.newMsgToast.style.display = 'block';
          }
          rafId = null;
        });
      }
    };

    const onDone = () => {
      this.finalizeStream(timestamp);
      haptic('medium');
      this.fetchStatus();
    };

    const onError = (err) => {
      if (this.streamMsgEl) {
        this.streamMsgEl.querySelector('.msg-bubble').textContent = err || '出错了，请重试';
        this.streamMsgEl.classList.add('error');
      }
      this.finalizeStream(timestamp);
    };

    return { onToken, onDone, onError };
  }

  createStreamBubble() {
    const div = el('div', { className: 'msg mio', style: { overflowAnchor: 'none' } });
    const bubble = el('div', { className: 'msg-bubble' });
    div.appendChild(bubble);
    return div;
  }

  finalizeStream(userTimestamp) {
    if (this.streamMsgEl) {
      const time = el('div', { className: 'msg-time', textContent: new Date().toTimeString().slice(0, 5) });
      this.streamMsgEl.appendChild(time);

      const text = this.streamBuffer;
      const msgs = Store.get('messages') || [];
      Store.set('messages', [...msgs, {
        role: 'mio',
        text,
        timestamp: new Date().toISOString(),
      }]);
    }

    this.streamMsgEl = null;
    this.streamBuffer = '';
    this.streaming = false;
    this.enableInput();
    if (!this._isUserScrolling) {
      this.scrollToBottom();
    }
  }

  handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }

  handleInput() {
    this.msgInput.style.height = 'auto';
    this.msgInput.style.height = Math.min(this.msgInput.scrollHeight, 120) + 'px';
    this.sendBtn.disabled = this.streaming || !this.msgInput.value.trim();
  }

  disableInput() {
    this.msgInput.disabled = true;
    this.sendBtn.disabled = true;
  }

  enableInput() {
    this.msgInput.disabled = false;
    this.sendBtn.disabled = !this.msgInput.value.trim();
    this.msgInput.focus();
  }

  async handlePersonaSwitch() {
    const mod = this.personaCb.checked ? 'boyfriend' : 'girlfriend';
    const prevChecked = this.personaCb.checked;
    try {
      await api.post('/mod', { name: mod });
      wsManager.switchMod(mod);
      this.fetchStatus();
    } catch {
      // 回滚 checkbox 状态
      this.personaCb.checked = !prevChecked;
      this.statusText.textContent = '切换失败';
    }
  }

  async fetchStatus() {
    try {
      const data = await api.get('/status');
      if (!data) return;

      const { config, emotion, relationship } = data;
      const nameEl = this.el.querySelector('.chat-header-name');
      if (nameEl) nameEl.textContent = config?.name || 'Mio';

      const mood = emotion?.myMood || '平静';
      const info = getMoodInfo(mood);
      const stage = STAGE_LABELS[relationship?.stage] || '';
      this.statusText.textContent = stage ? `${stage} · ${info.label}` : info.label;

      Store.patch({
        activeMod: config?.activeMod || 'girlfriend',
        emotion,
        relationship,
        affection: emotion?.affection || 0,
        stage: relationship?.stage || 'acquaintance',
      });

      if (this.emotionBall) {
        this.emotionBall.setState(mood, emotion?.affection || 0, relationship?.stage || 'acquaintance');
      }

      this.personaCb.checked = (config?.gender || config?.activeMod) === 'boyfriend';
      this.toggleClassSafe(this.statusDot, 'off', false);
      this.toggleClassSafe(this.statusDot, 'online', true);
    } catch {
      this.toggleClassSafe(this.statusDot, 'off', true);
      this.toggleClassSafe(this.statusDot, 'online', false);
      this.statusText.textContent = '离线';
    }
  }

  toggleClassSafe(el, cls, force) {
    if (el) el.classList.toggle(cls, force);
  }
}

// 导出为了兼容 app.js 中原来的接口，实际上应该修改 app.js 中的引入方式
let chatViewInstance = null;

export function renderChat(params) {
  chatViewInstance = new ChatView(params);
  return chatViewInstance.render();
}

export function mountChat() {
  if (chatViewInstance) chatViewInstance.mount();
}

export function unmountChat() {
  if (chatViewInstance) {
    chatViewInstance.unmount();
    chatViewInstance = null;
  }
}
