/**
 * emotion-ball.js — Canvas 情绪球组件 (Worker 改造版)
 *
 * 优先使用 OffscreenCanvas + Web Worker 渲染，
 * 如果不支持，则回退到主线程渲染，以保证流式消息生成时的帧率。
 */

import { getMoodInfo } from '../utils/constants.js';

// 用于不支持 OffscreenCanvas 的降级代码
import { lerp, lerpColor } from '../utils/easing.js';

const SIZE = 80;

/** 将 #rrggbb 或 #rgb 转换为 [r, g, b] 数组 */
function _hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [174, 174, 178]; // fallback: mist-500
}

export class EmotionBall {
  constructor(canvas, { size = SIZE } = {}) {
    this.canvas = canvas;
    this.size = size;

    /* 当前状态 */
    this.mood = 'calm';
    this.affection = 0;
    this.stage = 'acquaintance';

    /* 用于记录颜色过渡状态，主要供 worker 同步使用 */
    this._toColor = '#aeaeb2';
    this._toAffection = 0;

    /* 尺寸 */
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.size * this._dpr;
    this.canvas.height = this.size * this._dpr;
    this.canvas.style.width = this.size + 'px';
    this.canvas.style.height = this.size + 'px';

    this._running = false;
    this._visible = true;

    /* Worker 初始化 */
    this.useWorker = 'OffscreenCanvas' in window && typeof this.canvas.transferControlToOffscreen === 'function';

    if (this.useWorker) {
      try {
        const offscreen = this.canvas.transferControlToOffscreen();
        // Vite 中的 worker 引入方式
        this.worker = new Worker(new URL('./emotion-worker.js', import.meta.url), { type: 'module' });
        this.worker.postMessage({
          type: 'INIT',
          payload: { canvas: offscreen, size: this.size, dpr: this._dpr }
        }, [offscreen]);
      } catch (e) {
        if (import.meta.env.DEV) console.warn('OffscreenCanvas 初始化失败，降级到主线程渲染', e);
        this.useWorker = false;
        this._initFallback();
      }
    } else {
      this._initFallback();
    }

    /* 可见性 */
    this._setupVisibility();
  }

  _initFallback() {
    this.half = this.size / 2;
    this._fromColor = '#aeaeb2';
    this._colorTransition = 1;
    this._fromAffection = 0;
    this._affectionTransition = 1;

    this._particles = [];
    for (let i = 0; i < 5; i++) {
      this._particles.push({
        x: Math.random() * this.size,
        y: Math.random() * this.size,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: 1.2 + Math.random() * 1.8,
        alpha: 0.3 + Math.random() * 0.5,
      });
    }
  }

  _setupVisibility() {
    this._intersectionObserver = new IntersectionObserver(([entry]) => {
      this._visible = entry.isIntersecting;
      if (this._visible && !this._running) this.start();
      else if (!this._visible && this._running) this.stop();
    });
    this._intersectionObserver.observe(this.canvas);

    /* Page Visibility */
    this._visHandler = () => {
      if (document.hidden && this._running) this.stop();
      else if (!document.hidden && this._visible && !this._running) this.start();
    };
    document.addEventListener('visibilitychange', this._visHandler);
  }

  /** 彻底销毁：停止动画、断开 observer、移除 listener、terminate worker */
  destroy() {
    this.stop();
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }
    if (this._visHandler) {
      document.removeEventListener('visibilitychange', this._visHandler);
      this._visHandler = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  setState(mood, affection = 0, stage = 'acquaintance') {
    const info = getMoodInfo(mood);
    this.mood = mood;
    this.stage = stage;

    const newFromColor = this._toColor;
    const newToColor = info.color;
    const newFromAffection = this._toAffection;
    const newToAffection = affection;

    this._toColor = newToColor;
    this._toAffection = newToAffection;

    if (this.useWorker && this.worker) {
      // 在主线程预计算 RGB 值，避免 worker 中重复实现 lerpColor/hexToRgb
      this.worker.postMessage({
        type: 'SET_STATE',
        payload: {
          fromColor: _hexToRgb(newFromColor),
          toColor: _hexToRgb(newToColor),
          fromAffection: newFromAffection,
          toAffection: newToAffection
        }
      });
    } else {
      this._fromColor = newFromColor;
      this._toColor = newToColor;
      this._colorTransition = 0;

      this._fromAffection = newFromAffection;
      this._toAffection = newToAffection;
      this._affectionTransition = 0;
    }
  }

  start() {
    if (this._running) return;
    this._running = true;

    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'START' });
    } else {
      this._startTime = performance.now();
      this._tick();
    }
  }

  stop() {
    this._running = false;
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'STOP' });
    } else {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    }
  }

  _tick() {
    if (!this._running) return;

    const now = performance.now();
    const elapsed = (now - this._startTime) / 1000;

    if (this._colorTransition < 1) {
      this._colorTransition = Math.min(1, this._colorTransition + 0.016 / 0.7);
    }
    if (this._affectionTransition < 1) {
      this._affectionTransition = Math.min(1, this._affectionTransition + 0.016 / 0.4);
    }

    this._draw(elapsed);

    for (const p of this._particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 5 || p.x > this.size - 5) p.vx *= -1;
      if (p.y < 5 || p.y > this.size - 5) p.vy *= -1;
      p.vx += (Math.random() - 0.5) * 0.02;
      p.vy += (Math.random() - 0.5) * 0.02;
      p.vx *= 0.995;
      p.vy *= 0.995;
    }

    this._raf = requestAnimationFrame(() => this._tick());
  }

  _draw(t) {
    const ctx = this.canvas.getContext('2d');
    const dpr = this._dpr;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const cx = this.half;
    const cy = this.half;
    const r = this.half - 4;

    const color = lerpColor(this._fromColor, this._toColor, this._colorTransition);

    const bgGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.3, r * 0.1, cx, cy, r);
    bgGrad.addColorStop(0, 'rgba(255,255,255,0.7)');
    bgGrad.addColorStop(0.4, color);
    bgGrad.addColorStop(1, lerpColor(color, '#d1d1d4', 0.3));

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    const affection = lerp(this._fromAffection, this._toAffection, this._affectionTransition);
    const glowAlpha = 0.05 + (affection / 100) * 0.25;
    const breathe = 1 + Math.sin(t * 1.57) * 0.04;

    const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.6 * breathe);
    glowGrad.addColorStop(0, 'rgba(255,122,149,0)');
    glowGrad.addColorStop(0.5, `rgba(255,122,149,${glowAlpha * 0.5})`);
    glowGrad.addColorStop(1, 'rgba(255,122,149,0)');

    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.6 * breathe, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();

    for (const p of this._particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${p.alpha})`;
      ctx.fill();
    }

    if (affection > 5) {
      const ringAlpha = (affection / 100) * 0.35;
      const ringR = r + 3 + (affection / 100) * 6;

      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,122,149,${ringAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (affection < 100) {
        const gap = ((100 - affection) / 100) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, -Math.PI / 2 - gap / 2, -Math.PI / 2 + gap / 2);
        ctx.strokeStyle = `rgba(255,122,149,${ringAlpha * 0.3})`;
        ctx.stroke();
      }
    }

    const innerGrad = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
    innerGrad.addColorStop(0, 'rgba(255,255,255,0.12)');
    innerGrad.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = innerGrad;
    ctx.fill();

    ctx.restore();
  }
}
