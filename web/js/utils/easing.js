/**
 * easing.js — 缓动函数集
 *
 * 精确到毫秒的 JS 缓动实现, 用于 requestAnimationFrame 动画。
 */

export const Easing = {
  easeOut:    t => 1 - Math.pow(1 - t, 3),
  easeIn:     t => t * t * t,
  easeInOut:  t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeSpring: t => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

/**
 * 插值工具
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerpColor(c1, c2, t) {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  const r = Math.round(lerp(r1, r2, t));
  const g = Math.round(lerp(g1, g2, t));
  const b = Math.round(lerp(b1, b2, t));
  return `rgb(${r},${g},${b})`;
}

/**
 * 执行一个基于 duration 的动画
 * @param {number} duration - ms
 * @param {function} easing - easing function
 * @param {function} onFrame - (t: 0..1) => void
 * @returns {Promise} resolves when done
 */
export function animate(duration, easing, onFrame) {
  return new Promise(resolve => {
    const start = performance.now();
    function tick(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      onFrame(easing(t));
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}
