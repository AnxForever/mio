/**
 * Memory search scope helpers.
 *
 * External bridge sessions should not bleed transcript memories across groups
 * or contacts. Memory-bank facts remain global; transcript recall is scoped.
 */

export interface MemorySearchScope {
  sessionId?: string;
  crossChannel?: boolean;
}

export function transcriptVisibleInScope(candidateSessionId: string, scope?: MemorySearchScope): boolean {
  if (!scope?.sessionId || scope.crossChannel === true) return true;
  const current = scope.sessionId;
  if (candidateSessionId === current) return true;

  const currentChannel = channelScopePrefix(current);
  if (!currentChannel) return false;
  return candidateSessionId.startsWith(currentChannel);
}

export function channelScopePrefix(sessionId: string): string | null {
  if (sessionId.startsWith('onebot-private-')) return `${sessionId}`;
  if (sessionId.startsWith('openai-')) return `${sessionId}`;

  const groupMatch = /^(onebot-group-.+)-[^-]+-[a-f0-9]{8}$/i.exec(sessionId);
  if (groupMatch) return `${groupMatch[1]}-`;

  return null;
}
