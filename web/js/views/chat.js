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
    this.attachBtn = null;
    this.ttsBtn = null;
    this.fileInput = null;
    this.attachmentPreview = null;
    this.avatarImg = null;
    this.nameEl = null;
    this.statusDot = null;
    this.statusText = null;
    this.newMsgToast = null;
    this.recognition = null;

    this.streaming = false;
    this.streamBuffer = '';
    this.streamMsgEl = null;
    this.pendingImage = null;
    this.ttsEnabled = localStorage.getItem('mio_tts_enabled') === '1';
    this.ttsAvailable = true;
    this.currentAudio = null;
    this._isUserScrolling = false;
    this._lastScrollTop = 0;

    // Bind handlers
    this.handleSend = this.handleSend.bind(this);
    this.handleKey = this.handleKey.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.fetchStatus = this.fetchStatus.bind(this);
    this.handleScroll = this.handleScroll.bind(this);
    this.handleAttach = this.handleAttach.bind(this);
    this.handleFileSelected = this.handleFileSelected.bind(this);
    this.toggleTts = this.toggleTts.bind(this);
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

    this.attachmentPreview = el('div', { className: 'attachment-preview', style: { display: 'none' } });
    this.el.appendChild(this.attachmentPreview);

    /* ═══ 输入栏 ═══ */
    const inputArea = el('div', { className: 'chat-input-area' });

    this.attachBtn = el('button', { className: 'attach-btn tap', 'aria-label': 'Attach image' });
    this.attachBtn.appendChild(ICONS.image(20));
    inputArea.appendChild(this.attachBtn);

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

    this.ttsBtn = el('button', {
      className: `tts-btn tap${this.ttsEnabled ? ' active' : ''}`,
      'aria-label': 'Read replies aloud',
      'aria-pressed': this.ttsEnabled ? 'true' : 'false',
    });
    this.ttsBtn.appendChild(ICONS.volume(20));
    inputArea.appendChild(this.ttsBtn);

    this.fileInput = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      style: { display: 'none' },
    });
    this.el.appendChild(this.fileInput);

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
    node.textContent = msg.imageName ? `${msg.text}\n[图片: ${msg.imageName}]` : msg.text;
    return node;
  }

  mount() {
    /* 事件绑定 */
    this.on(this.sendBtn, 'click', this.handleSend);
    this.on(this.msgInput, 'keydown', this.handleKey);
    this.on(this.msgInput, 'input', this.handleInput);
    this.on(this.chatMessages, 'scroll', this.handleScroll, { passive: true });
    this.on(this.backBtn, 'click', () => { haptic('light'); window.history.back(); });
    this.on(this.attachBtn, 'click', this.handleAttach);
    this.on(this.fileInput, 'change', this.handleFileSelected);
    this.on(this.ttsBtn, 'click', this.toggleTts);

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
    this.checkVoiceCapabilities();

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
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
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
    const text = this.msgInput.value.trim() || (this.pendingImage ? '看看这张图片' : '');
    if (!text) return;
    const image = this.pendingImage;

    haptic('light');
    this.streaming = true;
    this._isUserScrolling = false;
    this.newMsgToast.style.display = 'none';
    this.disableInput();

    this.removeEmpty();

    /* 用户消息 → DOM + Store */
    const timestamp = new Date().toISOString();
    const userMsg = { role: 'user', text, timestamp, imageName: image?.name };
    const msgs = Store.get('messages') || [];
    this.chatMessages.insertBefore(this.makeBubble(userMsg), this.typingEl);
    Store.set('messages', [...msgs, userMsg]);

    this.msgInput.value = '';
    this.pendingImage = null;
    this.renderAttachmentPreview();
    this.msgInput.style.height = 'auto';
    this.typingEl.classList.add('show');
    this.scrollToBottom();

    this.streamBuffer = '';
    this.streamMsgEl = null;

    const { onToken, onDone, onError } = this._buildStreamCallbacks(timestamp);
    await wsManager.sendChat(text, { imagePath: image?.imagePath, onToken, onDone, onError });
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
      if (text && this.ttsEnabled) this.speak(text);
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
    this.sendBtn.disabled = this.streaming || (!this.msgInput.value.trim() && !this.pendingImage);
  }

  disableInput() {
    this.msgInput.disabled = true;
    this.sendBtn.disabled = true;
    if (this.attachBtn) this.attachBtn.disabled = true;
  }

  enableInput() {
    this.msgInput.disabled = false;
    this.sendBtn.disabled = !this.msgInput.value.trim() && !this.pendingImage;
    if (this.attachBtn) this.attachBtn.disabled = false;
    this.msgInput.focus();
  }

  handleAttach() {
    if (this.streaming || !this.fileInput) return;
    this.fileInput.value = '';
    this.fileInput.click();
  }

  async handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      this.statusText.textContent = '不支持的图片格式';
      return;
    }
    if (file.size > 4_500_000) {
      this.statusText.textContent = '图片不能超过 4.5MB';
      return;
    }

    try {
      this.attachBtn.disabled = true;
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const uploaded = await api.post('/uploads/images', {
        filename: file.name,
        mimeType: file.type,
        data,
      });
      this.pendingImage = { imagePath: uploaded.imagePath, name: file.name };
      this.renderAttachmentPreview();
      this.handleInput();
      haptic('light');
    } catch (err) {
      this.statusText.textContent = err.message || '图片上传失败';
    } finally {
      this.attachBtn.disabled = false;
    }
  }

  renderAttachmentPreview() {
    if (!this.attachmentPreview) return;
    this.attachmentPreview.innerHTML = '';
    if (!this.pendingImage) {
      this.attachmentPreview.style.display = 'none';
      return;
    }
    this.attachmentPreview.style.display = '';
    const label = el('span', { className: 'attachment-preview-name', textContent: this.pendingImage.name });
    const clear = el('button', {
      className: 'attachment-preview-clear tap',
      'aria-label': 'Remove image',
      onClick: () => {
        this.pendingImage = null;
        this.renderAttachmentPreview();
        this.handleInput();
      },
    }, '×');
    this.attachmentPreview.appendChild(label);
    this.attachmentPreview.appendChild(clear);
  }

  toggleTts() {
    if (!this.ttsAvailable) {
      this.ttsEnabled = false;
      localStorage.setItem('mio_tts_enabled', '0');
      if (this.statusText) this.statusText.textContent = '当前环境未启用语音合成';
      return;
    }
    this.ttsEnabled = !this.ttsEnabled;
    localStorage.setItem('mio_tts_enabled', this.ttsEnabled ? '1' : '0');
    this.ttsBtn.classList.toggle('active', this.ttsEnabled);
    this.ttsBtn.setAttribute('aria-pressed', this.ttsEnabled ? 'true' : 'false');
    haptic('light');
  }

  async speak(text) {
    if (!this.ttsAvailable) return;
    try {
      const res = await api.post('/voice/synthesize', { text }, { raw: true, timeout: 60000 });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (this.currentAudio) this.currentAudio.pause();
      this.currentAudio = new Audio(url);
      this.currentAudio.onended = () => URL.revokeObjectURL(url);
      await this.currentAudio.play();
    } catch {
      this.ttsEnabled = false;
      localStorage.setItem('mio_tts_enabled', '0');
      this.ttsBtn.classList.remove('active');
      this.ttsBtn.setAttribute('aria-pressed', 'false');
    }
  }

  async checkVoiceCapabilities() {
    if (!this.ttsBtn) return;
    try {
      const cap = await api.get('/voice/capabilities');
      this.ttsAvailable = !!cap?.tts;
    } catch {
      this.ttsAvailable = false;
    }

    if (!this.ttsAvailable) {
      this.ttsEnabled = false;
      localStorage.setItem('mio_tts_enabled', '0');
      this.ttsBtn.classList.remove('active');
      this.ttsBtn.setAttribute('aria-pressed', 'false');
      this.ttsBtn.disabled = true;
      this.ttsBtn.title = '当前环境未启用语音合成';
    } else {
      this.ttsBtn.disabled = false;
      this.ttsBtn.title = '朗读回复';
    }
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
