/**
 * constants.js — 常量映射
 *
 * 情绪、关系阶段、颜色等语义映射。所有中文到一个地方管。
 */

export const STAGE_LABELS = {
  acquaintance: '初识',
  familiar: '熟悉',
  ambiguous: '暧昧',
  intimate: '亲密',
};

/**
 * 情绪 → { emoji, label, color }
 * color 用于 Canvas 情绪球底色插值。
 */
export const MOOD_MAP = {
  '开心': { emoji: '😊', label: '开心', color: '#ffb347' },
  'happy':   { emoji: '😊', label: '开心', color: '#ffb347' },
  '兴奋':    { emoji: '✨', label: '兴奋', color: '#ffb347' },
  'excited': { emoji: '✨', label: '兴奋', color: '#ffb347' },
  '温柔':    { emoji: '💕', label: '温柔', color: '#ff9a76' },
  'tender':  { emoji: '💕', label: '温柔', color: '#ff9a76' },
  '爱':      { emoji: '💕', label: '温柔', color: '#ff9a76' },
  'love':    { emoji: '💕', label: '温柔', color: '#ff9a76' },
  '平静':    { emoji: '😌', label: '平静', color: '#7ec8e3' },
  'calm':    { emoji: '😌', label: '平静', color: '#7ec8e3' },
  'peaceful':{ emoji: '😌', label: '平静', color: '#7ec8e3' },
  '难过':    { emoji: '😢', label: '难过', color: '#a3b1c6' },
  'sad':     { emoji: '😢', label: '难过', color: '#a3b1c6' },
  '孤独':    { emoji: '😢', label: '孤独', color: '#a3b1c6' },
  'lonely':  { emoji: '😢', label: '孤独', color: '#a3b1c6' },
  '生气':    { emoji: '😤', label: '生气', color: '#ff6b6b' },
  'angry':   { emoji: '😤', label: '生气', color: '#ff6b6b' },
  '烦躁':    { emoji: '😤', label: '烦躁', color: '#ff6b6b' },
  'annoyed': { emoji: '😤', label: '烦躁', color: '#ff6b6b' },
  '害羞':    { emoji: '🥰', label: '害羞', color: '#d4a5d4' },
  'shy':     { emoji: '🥰', label: '害羞', color: '#d4a5d4' },
  '尴尬':    { emoji: '🥰', label: '害羞', color: '#d4a5d4' },
  'embarrassed': { emoji: '🥰', label: '害羞', color: '#d4a5d4' },
  '疲倦':    { emoji: '😴', label: '疲倦', color: '#aeaeb2' },
  'tired':   { emoji: '😴', label: '疲倦', color: '#aeaeb2' },
  'sleepy':  { emoji: '😴', label: '疲倦', color: '#aeaeb2' },
};

export function getMoodInfo(mood) {
  const key = (mood || '').trim();
  /* 精确匹配 */
  if (MOOD_MAP[key]) return MOOD_MAP[key];
  /* 子串匹配 */
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(MOOD_MAP)) {
    if (k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) {
      return v;
    }
  }
  return { emoji: '😊', label: key || '平静', color: '#aeaeb2' };
}

/**
 * 关系阶段 → 气泡颜色梯度
 * 初识: 灰, 熟悉: 暖灰, 暧昧: 浅樱, 亲密: 樱
 */
export const STAGE_BUBBLE_COLORS = {
  acquaintance: { mio: '#e9e9ed', user: '#e9e9ed' },
  familiar:     { mio: '#e9e9ed', user: '#ffe8ec' },
  ambiguous:    { mio: '#e9e9ed', user: '#ffd0dc' },
  intimate:     { mio: '#e9e9ed', user: '#ffb8c8' },
};
