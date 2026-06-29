import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RelationshipStage } from '../types.js';
import type { TurnRiskTag } from '../core/turn-router.js';
import { proactiveDecisionTracePath } from '../memory/paths.js';
import type { ProactiveMessageType } from './proactive.js';

export type ProactiveDecisionOutcome = 'sent' | 'skipped' | 'rejected';

export interface ProactiveDecisionTrace {
  id: string;
  timestamp: string;
  sessionId: string;
  userId?: string;
  type: ProactiveMessageType;
  stage?: RelationshipStage;
  outcome: ProactiveDecisionOutcome;
  phase: 'permission' | 'temporal' | 'smart_gate' | 'generation' | 'quality_gate' | 'dispatch';
  reasonCode: string;
  reason: string;
  messagePreview?: string;
  routeTags?: TurnRiskTag[];
}

export function appendProactiveDecisionTrace(
  input: Omit<ProactiveDecisionTrace, 'id' | 'timestamp' | 'sessionId'> & { sessionId?: string },
): ProactiveDecisionTrace {
  const timestamp = new Date().toISOString();
  const sessionId = input.sessionId || input.userId || 'global-proactive';
  const trace: ProactiveDecisionTrace = {
    ...input,
    id: `${timestamp}-${input.type}-${input.outcome}-${input.reasonCode}-${hashLite(sessionId)}`,
    timestamp,
    sessionId,
  };
  const path = proactiveDecisionTracePath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(trace)}\n`, 'utf-8');
  return trace;
}

export function readRecentProactiveDecisionTrace(limit = 100): ProactiveDecisionTrace[] {
  const path = proactiveDecisionTracePath();
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .slice(-Math.max(0, limit))
    .map((line) => JSON.parse(line) as ProactiveDecisionTrace);
}

function hashLite(text: string): string {
  let h = 0;
  for (const ch of text) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(16).slice(0, 8);
}
