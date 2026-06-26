/**
 * emotion-ball.js — Canvas 情绪球组件
 *
 * 四层渲染:
 *   L1 — 底色渐变 (根据 mood 动态插值, 700ms 过渡)
 *   L2 — 光晕呼吸 (4s 循环, 随好感度增强)
 *   L3 — 粒子漂移 (3-6 个微光点, 布朗运动)
 *   L4 — 好感度光环 (静止, 仅在有感情连接时显示)
 *
 * 性能: 离屏 Canvas 80×80, 仅在页面可见时运行动画循环。
 */

import { getMoodInfo } from '../utils/constants.js';
import { lerp, lerpColor } from '../utils/easing.js';

const SIZE = 80;
const HALF = SIZE / 2;

export class EmotionBall {
  constructor(canvas, { size = SIZE } = {}) {
    this.canvas = canvas;
    this.size = size;
    this.half = size / 2;

    /* 当前状态 */
    this.mood = 'calm';
    this.affection = 0;
    this.stage = 'acquaintance';

    /* 动画插值: 从旧值过渡到新值 */
    this._fromColor = '#aeaeb2';
    this._toColor = '#aeaeb2';
    this._colorTransition = 0;  /* 0..1, 0=from, 1=to */
    this._fromAffection = 0;
    this._toAffection = 0;
    this._affectionTransition = 1;

    /* 粒子 */
    this._particles = this._initParticles(5);

    /* 动画状态 */
    this._running = false;
    this._raf = null;
    this._startTime = performance.now();

    /* 尺寸 */
    this._setSize();

    /* 可见性 */
    this._visible = true;
    this._setupVisibility();
  }

  _initParticles(count) {
    const particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * this.size,
        y: Math.random() * this.size,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: 1.2 + Math.random() * 1.8,
        alpha: 0.3 + Math.random() * 0.5,
      });
    }
    return particles;
  }

  _setSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.canvas.style.width = this.size + 'px';
    this.canvas.style.height = this.size + 'px';
    this._dpr = dpr;
  }

  _setupVisibility() {
    const obs = new IntersectionObserver(([entry]) => {
      this._visible = entry.isIntersecting;
      if (this._visible && !this._running) this.start();
      else if (!this._visible && this._running) this.stop();
    });
    obs.observe(this.canvas);

    /* Page Visibility */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this._running) this.stop();
      else if (!document.hidden && this._visible && !this._running) this.start();
    });
  }

  /** 设置情绪状态, 触发过渡动画 */
  setState(mood, affection = 0, stage = 'acquaintance') {
    const info = getMoodInfo(mood);
    this.mood = mood;
    this.stage = stage;

    this._fromColor = this._toColor;
    this._toColor = info.color;
    this._colorTransition = 0;

    this._fromAffection = this._toAffection;
    this._toAffection = affection;
    this._affectionTransition = 0;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._startTime = performance.now();
    this._tick();
  }

  stop() {
    this._running = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  _tick() {
    if (!this._running) return;

    const now = performance.now();
    const elapsed = (now - this._startTime) / 1000;

    /* 颜色过渡: 700ms */
    if (this._colorTransition < 1) {
      this._colorTransition = Math.min(1, this._colorTransition + 0.016 / 0.7);
    }
    /* 好感度过渡: 400ms */
    if (this._affectionTransition < 1) {
      this._affectionTransition = Math.min(1, this._affectionTransition + 0.016 / 0.4);
    }

    this._draw(elapsed);

    /* 更新粒子 */
    for (const p of this._particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 5 || p.x > this.size - 5) p.vx *= -1;
      if (p.y < 5 || p.y > this.size - 5) p.vy *= -1;
      /* 微随机扰动 */
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
    ctx.save();
    ctx.scale(dpr, dpr);

    const cx = this.half;
    const cy = this.half;
    const r = this.half - 4;

    /* ─── L1: 底色 ─── */
    const color = lerpColor(this._fromColor, this._toColor, this._colorTransition);

    const bgGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.3, r * 0.1, cx, cy, r);
    bgGrad.addColorStop(0, 'rgba(255,255,255,0.7)');
    bgGrad.addColorStop(0.4, color);
    bgGrad.addColorStop(1, lerpColor(color, '#d1d1d4', 0.3));

    /* 圆形基底 — 微柔边缘 */
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    /* ─── L2: 光晕呼吸 ─── */
    const affection = lerp(this._fromAffection, this._toAffection, this._affectionTransition);
    const glowAlpha = 0.05 + (affection / 100) * 0.25;
    const breathe = 1 + Math.sin(t * 1.57) * 0.04; /* 4s 周期 */

    const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.6 * breathe);
    glowGrad.addColorStop(0, 'rgba(255,122,149,0)');
    glowGrad.addColorStop(0.5, `rgba(255,122,149,${glowAlpha * 0.5})`);
    glowGrad.addColorStop(1, 'rgba(255,122,149,0)');

    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.6 * breathe, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();

    /* ─── L3: 粒子 ─── */
    for (const p of this._particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${p.alpha})`;
      ctx.fill();
    }

    /* ─── L4: 好感度光环 ─── */
    if (affection > 5) {
      const ringAlpha = (affection / 100) * 0.35;
      const ringR = r + 3 + (affection / 100) * 6;

      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,122,149,${ringAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      /* 光环缺口 — 未完成的好感度 */
      if (affection < 100) {
        const gap = ((100 - affection) / 100) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, -Math.PI / 2 - gap / 2, -Math.PI / 2 + gap / 2);
        ctx.strokeStyle = `rgba(255,122,149,${ringAlpha * 0.3})`;
        ctx.stroke();
      }
    }

    /* 内阴影 — 立体感 */
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
