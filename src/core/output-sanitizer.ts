import type { TemporalTurnContext } from '../memory/temporal-state.js';

type TemporalKind = TemporalTurnContext['active'][number]['kind'];

/**
 * Narrow output guard for IM-style temporal presuppositions.
 *
 * This is not a style censor. It only rewrites questions that assume the user
 * is currently busy when the temporal layer has no active busy/away evidence.
 */
export function sanitizeTemporalPresuppositions(
  text: string,
  temporal: TemporalTurnContext | undefined,
): string {
  if (!temporal || hasActiveTemporalKind(temporal, ['busy', 'away'])) return text;

  let next = text;
  next = next.replace(/你(?:咋样|怎么样|呢)?[，,、\s]*忙完[了啦]?还是也?瘫着[呢吗嘛]*[？?]?/g, '你呢，也瘫着吗');
  next = next.replace(/你(?:呢|现在|这会儿)?[，,、\s]*(?:在)?忙(?:啥|什么)[呢呀啊嘛]*[？?]?/g, '你呢，现在咋样');
  next = next.replace(/你(?:呢|现在|这会儿)?[，,、\s]*忙完[了啦]?(?:吗|没|没有|呀|啊|呢|嘛)?[？?]?/g, '你呢，现在咋样');
  return cleanupSanitizedText(next);
}

export function sanitizeReopenedChatBlame(
  text: string,
  temporal: TemporalTurnContext | undefined,
): string {
  if (!temporal || !hasRecentlyReopenedAfterMioSpace(temporal)) return text;
  if (!/(不理我|不回我|真不回|刚说完不打扰|客气话|哼)/.test(text)) return text;

  let next = text;
  next = next.replace(/哟[，,、\s]*你这个有点过分[了啊呀嘛]*[，,、\s]*/g, '');
  next = next.replace(/我刚说完不打扰你[，,、\s]*你就真不回[了啊呀嘛]*[？?]?/g, '你回来啦');
  next = next.replace(/我说不打扰是客气话[啦呀啊]*[，,、\s]*你还真就不理我[了啊呀嘛]*[吧吗]?[？?]?/g, '你回来就行');
  next = next.replace(/你(?:就)?真不回[了啊呀嘛]*[？?]?/g, '你回来啦');
  next = next.replace(/你(?:就)?不理我[了啊呀嘛]*[吧吗]?[？?]?/g, '你回来就行');
  next = next.replace(/^\s*哼\s*$/g, '在呢');
  next = next.replace(/(^|\n)\s*哼\s*($|\n)/g, '$1');
  next = next.replace(/哼/g, '');
  return cleanupSanitizedText(next) || '你回来啦。刚好，我在。';
}

function hasActiveTemporalKind(ctx: TemporalTurnContext, kinds: TemporalKind[]): boolean {
  const wanted = new Set<TemporalKind>(kinds);
  return ctx.active.some((entry) => wanted.has(entry.kind));
}

function hasRecentlyReopenedAfterMioSpace(ctx: TemporalTurnContext): boolean {
  return ctx.resolvedRecent.some((entry) => (
    entry.kind === 'mio_promised_space' || entry.kind === 'user_requested_space'
  ) && entry.resolutionReason === 'user_reopened_chat');
}

function cleanupSanitizedText(text: string): string {
  return text
    .replace(/你呢，现在咋样[，,、\s]*你呢，现在咋样/g, '你呢，现在咋样')
    .replace(/你呢[，,、\s]*你呢/g, '你呢')
    .trim();
}
