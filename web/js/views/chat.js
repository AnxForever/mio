import { BaseView } from './BaseView.js';
import { el } from '../utils/dom.js';
import { Store } from '../store.js';
import { api } from '../api.js';
import { wsManager } from '../ws.js';
import { padToExpression, mascotSrc } from '../mascot.js';
import { haptic } from '../utils/haptics.js';
import { getMoodInfo, STAGE_LABELS } from '../utils/constants.js';
import { ICONS } from '../utils/icons.js';

export class ChatView extends BaseView {
  constructor(params) {
    super(params);
    this.chatMessages = null;
    this.emptyEl = null;
    this.typingEl = null;
    this.msgInput = null;
    this.sendBtn = null;
    this.voiceBtn = null;
    this.avatarImg = null;
    this.nameEl = null;
    this.statusDot = null;
    this.statusText = null;
    this.newMsgToast = null;
    this.recognition = null;

    this.streaming = false;
    this.streamBuffer = '';
    this.streamMsgEl = null;
    this._isUserScrolling = false;
    this._lastScrollTop = 0;

    // Bind handlers
    this.handleSend = this.handleSend.bind(this);
    this.handleKey = this.handleKey.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.fetchStatus = this.fetchStatus.bind(this);
    this.handleScroll = this.handleScroll.bind(this);
  }

  render() {
    this.el = el('div', { className: 'chat-view' });

    /* ═══ 顶栏 ═══ */
    const header = el('header', { className: 'chat-header' });

    /* 返回箭头 */
    this.backBtn = el('button', { className: 'chat-back tap', 'aria-label': '返回' });
    this.backBtn.appendChild(ICONS.back(22));
    header.appendChild(this.backBtn);

    /* 头像(mascot 图) */
    const avatar = el('div', { className: 'avatar', role: 'img', 'aria-label': 'Mio' });
    this.avatarImg = el('img', { alt: '', src: mascotSrc('gentle') });
    this.avatarImg.addEventListener('error', () => { this.avatarImg.style.visibility = 'hidden'; });
    avatar.appendChild(this.avatarImg);
    header.appendChild(avatar);

    /* 名字 / 状态 */
    const info = el('div', { className: 'chat-header-info' });
    this.nameEl = el('div', { className: 'chat-header-name', textContent: 'Mio' });
    const status = el('div', { className: 'chat-header-status', role: 'status' });
    this.statusDot = el('span', { className: 'status-dot' });
    this.statusText = el('span', { textContent: '连接中' });
    status.appendChild(this.statusDot);
    status.appendChild(this.statusText);
    info.appendChild(this.nameEl);
    info.appendChild(status);
    header.appendChild(info);

    this.el.appendChild(header);

    /* ═══ 消息区 ═══ */
    this.chatMessages = el('div', {
      className: 'chat-messages',
      'aria-live': 'polite',
      'aria-label': 'Conversation messages',
      role: 'log',
      style: { overflowAnchor: 'none' },
    });

    /* 空状态 */
    this.emptyEl = this.buildEmpty();
    this.chatMessages.appendChild(this.emptyEl);

    /* 打字指示器 */
    this.typingEl = this.buildTyping();
    this.chatMessages.appendChild(this.typingEl);

    this.el.appendChild(this.chatMessages);

    /* 新消息悬浮提示 */
    this.newMsgToast = el('div', {
      className: 'new-msg-toast tap',
      textContent: '新消息',
      role: 'button',
      tabindex: '0',
      'aria-label': 'Scroll to latest message',
      style: { display: 'none' },
    });
    this.el.appendChild(this.newMsgToast);

    /* ═══ 输入栏 ═══ */
    const inputArea = el('div', { className: 'chat-input-area' });

    this.voiceBtn = el('button', { className: 'voice-btn tap', 'aria-label': 'Voice input' });
    this.voiceBtn.appendChild(ICONS.mic(20));
    inputArea.appendChild(this.voiceBtn);

    const inputWrap = el('div', { className: 'chat-input-wrap' });
    this.msgInput = el('textarea', {
      rows: '1',
      placeholder: '说点什么…',
      enterkeyhint: 'send',
      'aria-label': 'Message input',
    });
    inputWrap.appendChild(this.msgInput);
    inputArea.appendChild(inputWrap);

    this.sendBtn = el('button', { className: 'send-btn tap', disabled: 'disabled', 'aria-label': 'Send message' });
    this.sendBtn.appendChild(ICONS.send(18));
    inputArea.appendChild(this.sendBtn);

    this.el.appendChild(inputArea);

    return this.el;
  }

  buildEmpty() {
    const wrap = el('div', { className: 'chat-empty' });
    const avatar = el('div', { className: 'avatar', 'aria-hidden': 'true' });
    const img = el('img', { alt: '', src: mascotSrc('gentle') });
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    avatar.appendChild(img);
    wrap.appendChild(avatar);
    wrap.appendChild(el('div', { className: 'chat-empty-title', textContent: '和 Mio 开始对话' }));
    wrap.appendChild(el('div', { className: 'chat-empty-sub', textContent: '说点什么吧，今天过得怎么样？' }));
    return wrap;
  }

  buildTyping() {
    const typing = el('div', { className: 'typing', 'aria-hidden': 'true' });
    for (let i = 0; i < 3; i++) typing.appendChild(el('div', { className: 'typing-dot' }));
    return typing;
  }

  /** 单条消息 → 气泡 DOM(新设计系统 class) */
  makeBubble(msg) {
    const isUser = msg.role === 'user';
    const isProactive = !isUser && (msg.proactive === true || msg.kind === 'proactive' || msg.role === 'proactive');
    const variant = isUser ? 'bubble--me' : isProactive ? 'bubble--proactive' : 'bubble--them';
    const node = el('div', { className: `bubble ${variant}${msg.isError ? ' error' : ''}` });
    node.textContent = msg.text;
    return node;
  }

  mount() {
    /* 事件绑定 */
    this.on(this.sendBtn, 'click', this.handleSend);
    this.on(this.msgInput, 'keydown', this.handleKey);
    this.on(this.msgInput, 'input', this.handleInput);
    this.on(this.chatMessages, 'scroll', this.handleScroll, { passive: true });
    this.on(this.backBtn, 'click', () => { haptic('light'); window.history.back(); });

    const scrollToNew = () => { this._isUserScrolling = false; this.scrollToBottom(); };
    this.on(this.newMsgToast, 'click', scrollToNew);
    this.on(this.newMsgToast, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollToNew(); }
    });

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
        if (this.recognition) { this.recognition.stop(); this.recognition = null; }
      });
    } else if (this.voiceBtn) {
      this.voiceBtn.style.display = 'none';
    }

    /* Store 订阅 */
    const unsubConnected = Store.on('connected', (v) => {
      this.toggleClassSafe(this.statusDot, 'online', !!v);
      if (v) { if (this.statusText.textContent === '连接中' || this.statusText.textContent === '离线') this.statusText.textContent = '在线'; }
      else this.statusText.textContent = '离线';
    });
    this._unsubscribes.push(unsubConnected);

    /* avatar 状态推送(WS) → mascot 表情(best-effort) */
    const unsubAvatar = Store.on('avatar', (state) => this.applyAvatarState(state));
    this._unsubscribes.push(unsubAvatar);

    /* 初始:状态 + 头像表情 */
    this.fetchStatus();
    this.updateAvatar();

    /* 载入已有消息 */
    const messages = Store.get('messages') || [];
    if (messages.length > 0) {
      this.removeEmpty();
      const frag = document.createDocumentFragment();
      for (const m of messages) frag.appendChild(this.makeBubble(m));
      this.chatMessages.insertBefore(frag, this.typingEl);
      this.scrollToBottom();
    }
  }

  unmount() {
    super.unmount();
    if (this.recognition) { this.recognition.stop(); this.recognition = null; }
  }

  /* ─── 头像表情(mascot) ─── */

  /** pad → 表情(取不到 pad 默认 gentle);best-effort,失败不崩 */
  async updateAvatar() {
    try {
      const state = await api.get('/avatar/state');
      this.applyAvatarState(state);
    } catch {
      this.setAvatarExpr('gentle');
    }
  }

  applyAvatarState(state) {
    let expr = 'gentle';
    try {
      const pad = state?.pad;
      if (pad && (pad.pleasure !== undefined || pad.arousal !== undefined)) {
        expr = padToExpression(pad);
      }
    } catch { expr = 'gentle'; }
    this.setAvatarExpr(expr);
  }

  setAvatarExpr(expr) {
    if (!this.avatarImg) return;
    const src = mascotSrc(expr);
    if (this.avatarImg.getAttribute('src') === src) return;
    /* 表情切换柔和 cross-fade(非硬切):淡出→换图→淡入。
       复用 components.css 的 `.avatar img { transition: opacity }`。 */
    const img = this.avatarImg;
    img.style.visibility = '';
    img.style.opacity = '0';
    img.addEventListener('load', () => { img.style.opacity = '1'; }, { once: true });
    img.src = src;
    /* 缓存命中时 load 可能不触发 → 下一帧兜底淡入 */
    this.requestAnimationFrame(() => { if (img.complete && img.naturalWidth) img.style.opacity = '1'; });
  }

  /* ─── 滚动 ─── */

  handleScroll() {
    const top = this.chatMessages.scrollTop;
    if (this._lastScrollTop - top > 20) this._isUserScrolling = true;
    if (this.chatMessages.scrollHeight - top - this.chatMessages.clientHeight < 30) {
      this._isUserScrolling = false;
      this.newMsgToast.style.display = 'none';
    }
    this._lastScrollTop = top;
  }

  scrollToBottom() {
    this.requestAnimationFrame(() => {
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      this.newMsgToast.style.display = 'none';
    });
  }

  removeEmpty() {
    if (this.emptyEl && this.emptyEl.parentNode) this.emptyEl.remove();
    this.emptyEl = null;
  }

  /* ─── 发送 / 流式 ─── */

  async handleSend() {
    if (this.streaming) return;
    const text = this.msgInput.value.trim();
    if (!text) return;

    haptic('light');
    this.streaming = true;
    this._isUserScrolling = false;
    this.newMsgToast.style.display = 'none';
    this.disableInput();

    this.removeEmpty();

    /* 用户消息 → DOM + Store */
    const timestamp = new Date().toISOString();
    const userMsg = { role: 'user', text, timestamp };
    const msgs = Store.get('messages') || [];
    this.chatMessages.insertBefore(this.makeBubble(userMsg), this.typingEl);
    Store.set('messages', [...msgs, userMsg]);

    this.msgInput.value = '';
    this.msgInput.style.height = 'auto';
    this.typingEl.classList.add('show');
    this.scrollToBottom();

    this.streamBuffer = '';
    this.streamMsgEl = null;

    const { onToken, onDone, onError } = this._buildStreamCallbacks(timestamp);
    await wsManager.sendChat(text, { onToken, onDone, onError });
  }

  /** 流式三回调:onToken / onDone / onError */
  _buildStreamCallbacks(timestamp) {
    let rafId = null;

    const onToken = (chunk) => {
      this.streamBuffer += chunk;
      if (!this.streamMsgEl) {
        this.typingEl.classList.remove('show');
        this.streamMsgEl = this.createStreamBubble();
        this.chatMessages.insertBefore(this.streamMsgEl, this.typingEl);
      }
      this.streamMsgEl.textContent = this.streamBuffer;

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
      this.updateAvatar();
    };

    const onError = (err) => {
      if (this.streamMsgEl) {
        this.streamMsgEl.textContent = err || '出了点问题，请再试一次。';
        this.streamMsgEl.classList.add('error');
      }
      this.finalizeStream(timestamp);
    };

    return { onToken, onDone, onError };
  }

  /** 流式气泡:them 气泡 + 打字光标 */
  createStreamBubble() {
    return el('div', { className: 'bubble bubble--them is-streaming', style: { overflowAnchor: 'none' } });
  }

  finalizeStream() {
    if (this.streamMsgEl) {
      this.streamMsgEl.classList.remove('is-streaming');
      const text = this.streamBuffer;
      const msgs = Store.get('messages') || [];
      Store.set('messages', [...msgs, { role: 'mio', text, timestamp: new Date().toISOString() }]);
    }
    this.streamMsgEl = null;
    this.streamBuffer = '';
    this.streaming = false;
    this.enableInput();
    if (!this._isUserScrolling) this.scrollToBottom();
  }

  /* ─── 输入框 ─── */

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

  /* ─── 状态 ─── */

  async fetchStatus() {
    try {
      const data = await api.get('/status');
      if (!data) return;

      const { config, emotion, relationship } = data;

      const mood = emotion?.myMood || 'calm';
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

      this.toggleClassSafe(this.statusDot, 'online', true);
    } catch {
      this.toggleClassSafe(this.statusDot, 'online', false);
      this.statusText.textContent = '离线';
    }
  }

  toggleClassSafe(node, cls, force) {
    if (node) node.classList.toggle(cls, force);
  }
}

/* 兼容 app.js 的 render/mount/unmount 接口 */
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
