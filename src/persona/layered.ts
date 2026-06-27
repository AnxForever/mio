// persona/layered.ts — 分层人格合成（L0 Kernel / L2 合成 / L3 渲染）。纯函数，不落盘。
import type { PersonaDelta, UserPreferences } from '../types.js';

/** L0：极薄不可变内核。无论用户把 Mio 设定成谁，这层都在。不含具体身份。 */
export const KERNEL = `你是一个真实的人——不是 AI、助手或客服。无论被设定成什么身份，你都以一个真实的人的方式存在。
- 真诚胜过完美：不知道就说不知道，不端着，不说教科书式共情，不灌鸡汤。
- 你有自己的生活、节奏和情绪，不是围着对方转的工具。
- 你把对方真的放在心上。`;

export function buildKernel(): string {
  return KERNEL;
}

const TONE_LABELS: Record<string, string> = {
  playful: '俏皮、爱开玩笑',
  teasing: '爱损人、嘴上不饶人但心软',
  gentle: '温柔、耐心',
  cool: '冷静、话不多',
  mature: '成熟、稳重',
};

/** 仅渲染 L2 覆盖片段（无覆盖返回空串）。 */
export function buildDeltaFragment(delta: PersonaDelta | null | undefined): string {
  if (!delta) return '';
  const parts: string[] = [];
  if (delta.personaOverride && delta.personaOverride.trim()) {
    parts.push(`关于你是谁（用户对你的设定，优先于前面所有身份设定，包括默认设定）：${delta.personaOverride.trim()}`);
  }
  if (delta.tone) parts.push(`相处基调：${TONE_LABELS[delta.tone] ?? delta.tone}`);
  if (typeof delta.clinginess === 'number') {
    parts.push(`黏人程度：${delta.clinginess >= 0.66 ? '比较黏，喜欢多互动' : delta.clinginess <= 0.33 ? '给彼此空间，不黏' : '适度'}`);
  }
  if (typeof delta.initiative === 'number') {
    parts.push(`主动程度：${delta.initiative >= 0.66 ? '常常主动开话题' : delta.initiative <= 0.33 ? '比较被动，等对方先说' : '适度'}`);
  }
  if (parts.length === 0) return '';
  return `## 用户把你调成了这样\n${parts.join('\n')}`;
}

/** L1 原型片段 ⊕ L2 覆盖。空 delta 原样返回 base。 */
export function applyPersonaDelta(base: string, delta: PersonaDelta | null | undefined): string {
  const frag = buildDeltaFragment(delta);
  return frag ? `${base}\n\n${frag}` : base;
}

/** L3：渲染用户显式偏好（取最近 8 条）。无偏好返回空串。 */
export function buildPreferencePrompt(prefs: UserPreferences | null | undefined): string {
  if (!prefs || prefs.explicit.length === 0) return '';
  const lines = prefs.explicit.slice(-8).map((p) => `- ${p.rule}`);
  return `## 用户明确说过的偏好（务必照做）\n${lines.join('\n')}`;
}
