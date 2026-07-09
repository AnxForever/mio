/**
 * mascot.js — Mio 的线条猫表情系统。
 * PAD 情感状态 → 表情名;久未互动优先触发想念。
 */
export const EXPRESSIONS = ['happy', 'gentle', 'longing', 'shy', 'worried', 'surprised'];

/** PAD(+opts) → 表情名。daysSince(久未互动)与 shy 优先于 PAD。 */
export function padToExpression(pad, opts = {}) {
  if ((opts.daysSince ?? 0) >= 2) return 'longing';
  if (opts.shy) return 'shy';
  const p = pad.pleasure ?? 0;
  const a = pad.arousal ?? 0;
  if (p < -0.2) return 'worried';
  if (p > 0.5 && a > 0.5) return 'happy';
  if (a > 0.8) return 'surprised';
  return 'gentle';
}

/** 表情名 → 图片 URL(前端 served 路径)。 */
export function mascotSrc(expr) {
  /* vite.config.js: publicDir = 'assets' → web/assets/* served at /*  */
  return `/mascot/${expr}.png`;
}
