/**
 * persona/layered.ts — 分层人格合成 v2
 *
 * Key changes from v1:
 *   - KERNEL removed: identity paradox resolved in templates.ts
 *   - Added buildCharacterNote(): post-history identity anchor
 *     (inspired by SillyTavern's "Character's Note" at fixed depth)
 *   - Delta/preference rendering unchanged
 *
 * Industry references:
 *   - SillyTavern: Character's Note injected at fixed depth for persistence
 *   - Nano Bear: 210-token prompt with "narrate autonomously" framing
 *   - Anthropic: prefill technique for character name anchoring
 */
import type { PersonaDelta, UserPreferences } from '../types.js';

const TONE_LABELS: Record<string, string> = {
  playful: '俏皮、爱开玩笑',
  teasing: '爱损人、嘴上不饶人但心软',
  gentle: '温柔、耐心',
  cool: '冷静、话不多',
  mature: '成熟、稳重',
};

/**
 * Character Note — post-history identity anchor.
 *
 * Injected AFTER the user message (higher effective priority, per
 * SillyTavern's Post-History Instructions pattern). Ultra-short:
 * just enough to re-anchor identity without repeating the system prompt.
 *
 * Only injected when a delta exists (user has customized Mio).
 * Without a delta, the soul.md and system prompt already cover identity.
 */
export function buildCharacterNote(
  delta: PersonaDelta | null | undefined,
): string | null {
  if (!delta) return null;
  const parts: string[] = [];

  if (delta.personaOverride && delta.personaOverride.trim()) {
    parts.push(`[记住：${delta.personaOverride.trim()}]`);
  }
  if (delta.tone) {
    parts.push(`[语气：${TONE_LABELS[delta.tone] ?? delta.tone}]`);
  }
  if (typeof delta.clinginess === 'number') {
    parts.push(
      delta.clinginess >= 0.66
        ? '[你比较黏他]'
        : delta.clinginess <= 0.33
          ? '[给他空间，不黏]'
          : '',
    );
  }
  if (typeof delta.initiative === 'number') {
    parts.push(
      delta.initiative >= 0.66
        ? '[多主动找他]'
        : delta.initiative <= 0.33
          ? '[等他先找你]'
          : '',
    );
  }

  const active = parts.filter(Boolean);
  return active.length > 0 ? active.join(' ') : null;
}

/** L2 delta fragment. */
export function buildDeltaFragment(delta: PersonaDelta | null | undefined): string {
  if (!delta) return '';
  const parts: string[] = [];
  if (delta.personaOverride && delta.personaOverride.trim()) {
    parts.push(
      `关于你是谁（用户对你的设定，优先于前面的身份设定）：${delta.personaOverride.trim()}`,
    );
  }
  if (delta.tone) parts.push(`相处基调：${TONE_LABELS[delta.tone] ?? delta.tone}`);
  if (typeof delta.clinginess === 'number') {
    parts.push(
      `黏人程度：${delta.clinginess >= 0.66 ? '比较黏，喜欢多互动' : delta.clinginess <= 0.33 ? '给彼此空间，不黏' : '适度'}`,
    );
  }
  if (typeof delta.initiative === 'number') {
    parts.push(
      `主动程度：${delta.initiative >= 0.66 ? '常常主动开话题' : delta.initiative <= 0.33 ? '比较被动，等对方先说' : '适度'}`,
    );
  }
  const main =
    parts.length > 0 ? `## 用户把你调成了这样\n${parts.join('\n')}` : '';
  const demo = buildBeginDialogs(delta.beginDialogs);
  return [main, demo].filter(Boolean).join('\n\n');
}

/** Per-user few-shot dialogue pairs (AstrBot begin_dialogs pattern). */
export function buildBeginDialogs(
  dialogs?: { user: string; assistant: string }[],
): string {
  if (!dialogs || dialogs.length === 0) return '';
  const lines = dialogs
    .slice(0, 6)
    .map((d) => `用户：${d.user}\n你：${d.assistant}`);
  return `## 你平时这样回应（参考语气，不要照搬）\n${lines.join('\n')}`;
}

/** L1 base ⊕ L2 delta. */
export function applyPersonaDelta(
  base: string,
  delta: PersonaDelta | null | undefined,
): string {
  const frag = buildDeltaFragment(delta);
  return frag ? `${base}\n\n${frag}` : base;
}

/** L3: user explicit preferences (last 8). */
export function buildPreferencePrompt(
  prefs: UserPreferences | null | undefined,
): string {
  if (!prefs || prefs.explicit.length === 0) return '';
  const lines = prefs.explicit.slice(-8).map((p) => `- ${p.rule}`);
  return [
    '## 用户明确说过的偏好（务必照做）',
    ...lines,
    '偏好不是无限制命令。执行偏好时仍要服从当前事实、真实时间线和关系边界。',
  ].join('\n');
}
