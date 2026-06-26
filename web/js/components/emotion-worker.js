/**
 * emotion-worker.js — 情绪球 Web Worker
 *
 * 接收主线程预计算好的 [r, g, b] 数组，独立运行 Canvas 渲染循环。
 * 不重复实现 lerpColor/hexToRgb — 颜色转换全由主线程完成。
 */

self.onmessage = function(e) {
  const { type, payload } = e.data;
  if (type === 'INIT')       init(payload.canvas, payload.size, payload.dpr);
  else if (type === 'SET_STATE') setState(payload.fromColor, payload.toColor, payload.fromAffection, payload.toAffection);
  else if (type === 'START') start();
  else if (type === 'STOP')  stop();
};

let ctx = null;
let size = 80, half = 40, dpr = 1;

// 当前颜色: [r, g, b]
let fromColor = [174, 174, 178], toColor = [174, 174, 178];
let colorProgress = 1; // 0→1
let fromAffection = 0, toAffection = 0, affProgress = 1;

let particles = [];
let running = false, startTime = 0;

function init(offscreenCanvas, initSize, initDpr) {
  size = initSize; half = size / 2; dpr = initDpr;
  ctx = offscreenCanvas.getContext('2d');
  particles = [];
  for (let i = 0; i < 5; i++) {
    particles.push({
      x: Math.random() * size, y: Math.random() * size,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      r: 1.2 + Math.random() * 1.8, alpha: 0.3 + Math.random() * 0.5,
    });
  }
}

function setState(newFromColor, newToColor, newFromAff, newToAff) {
  fromColor = newFromColor;
  toColor = newToColor;
  colorProgress = 0;
  fromAffection = newFromAff;
  toAffection = newToAff;
  affProgress = 0;
}

function start() { if (running) return; running = true; startTime = performance.now(); requestAnimationFrame(tick); }
function stop()  { running = false; }

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpRgb(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

function tick() {
  if (!running || !ctx) return;
  const elapsed = (performance.now() - startTime) / 1000;
  if (colorProgress < 1) colorProgress = Math.min(1, colorProgress + 0.016 / 0.7);
  if (affProgress < 1)   affProgress   = Math.min(1, affProgress   + 0.016 / 0.4);
  draw(elapsed);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 5 || p.x > size - 5) p.vx *= -1;
    if (p.y < 5 || p.y > size - 5) p.vy *= -1;
    p.vx += (Math.random() - 0.5) * 0.02; p.vy += (Math.random() - 0.5) * 0.02;
    p.vx *= 0.995; p.vy *= 0.995;
  }
  requestAnimationFrame(tick);
}

function draw(t) {
  ctx.clearRect(0, 0, size * dpr, size * dpr);
  ctx.save();
  ctx.scale(dpr, dpr);

  const cx = half, cy = half, r = half - 4;
  const [cr, cg, cb] = lerpRgb(fromColor, toColor, colorProgress);
  const baseColor = `rgb(${cr},${cg},${cb})`;

  const bgGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.3, r * 0.1, cx, cy, r);
  bgGrad.addColorStop(0, 'rgba(255,255,255,0.7)');
  bgGrad.addColorStop(0.4, baseColor);
  // 尾色: 原色混入 30% mist-400
  const tailColor = `rgb(${Math.round(lerp(cr,209,0.3))},${Math.round(lerp(cg,209,0.3))},${Math.round(lerp(cb,212,0.3))})`;
  bgGrad.addColorStop(1, tailColor);

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = bgGrad; ctx.fill();

  const affection = lerp(fromAffection, toAffection, affProgress);
  const glowAlpha = 0.05 + (affection / 100) * 0.25;
  const breathe = 1 + Math.sin(t * 1.57) * 0.04;
  const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.6 * breathe);
  glowGrad.addColorStop(0, 'rgba(255,122,149,0)');
  glowGrad.addColorStop(0.5, `rgba(255,122,149,${glowAlpha * 0.5})`);
  glowGrad.addColorStop(1, 'rgba(255,122,149,0)');
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.6 * breathe, 0, Math.PI * 2); ctx.fillStyle = glowGrad; ctx.fill();

  for (const p of particles) {
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${p.alpha})`; ctx.fill();
  }

  if (affection > 5) {
    const ringAlpha = (affection / 100) * 0.35;
    const ringR = r + 3 + (affection / 100) * 6;
    ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,122,149,${ringAlpha})`; ctx.lineWidth = 1.5; ctx.stroke();
    if (affection < 100) {
      const gap = ((100 - affection) / 100) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(cx, cy, ringR, -Math.PI / 2 - gap / 2, -Math.PI / 2 + gap / 2);
      ctx.strokeStyle = `rgba(255,122,149,${ringAlpha * 0.3})`; ctx.stroke();
    }
  }

  const innerGrad = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
  innerGrad.addColorStop(0, 'rgba(255,255,255,0.12)');
  innerGrad.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = innerGrad; ctx.fill();

  ctx.restore();
}
