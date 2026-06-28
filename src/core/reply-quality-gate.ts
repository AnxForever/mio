import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PromptCtx } from '../types.js';
import { replyQualityInterventionsPath } from '../memory/paths.js';
import { sanitizeReopenedChatBlame, sanitizeTemporalPresuppositions } from './output-sanitizer.js';

export type ReplyInterventionType = 'temporal_presupposition' | 'reopened_chat_blame';

export interface ReplyQualityIntervention {
  id: string;
  timestamp: string;
  sessionId: string;
  type: ReplyInterventionType;
  source: 'deterministic';
  severity: 'rewrite';
  reason: string;
  before: string;
  after: string;
}

export interface ReplyQualityGateInput {
  text: string;
  sessionId: string;
  promptCtx: Pick<PromptCtx, 'temporalTurnContext'>;
  trace?: boolean;
}

export interface ReplyQualityGateResult {
  text: string;
  interventions: ReplyQualityIntervention[];
}

export function applyReplyQualityGate(input: ReplyQualityGateInput): ReplyQualityGateResult {
  let text = input.text;
  const interventions: ReplyQualityIntervention[] = [];

  const temporalText = sanitizeTemporalPresuppositions(text, input.promptCtx.temporalTurnContext);
  if (temporalText !== text) {
    const intervention = createIntervention({
      sessionId: input.sessionId,
      type: 'temporal_presupposition',
      reason: 'Rewrote unsupported busy/away presupposition because no active temporal busy/away state exists.',
      before: text,
      after: temporalText,
    });
    interventions.push(intervention);
    text = temporalText;
  }

  const reopenedText = sanitizeReopenedChatBlame(text, input.promptCtx.temporalTurnContext);
  if (reopenedText !== text) {
    const intervention = createIntervention({
      sessionId: input.sessionId,
      type: 'reopened_chat_blame',
      reason: 'Rewrote blameful reopened-chat complaint after Mio had promised not to interrupt.',
      before: text,
      after: reopenedText,
    });
    interventions.push(intervention);
    text = reopenedText;
  }

  if (input.trace !== false) {
    for (const intervention of interventions) appendReplyIntervention(intervention);
  }

  return { text, interventions };
}

function createIntervention(input: {
  sessionId: string;
  type: ReplyInterventionType;
  reason: string;
  before: string;
  after: string;
}): ReplyQualityIntervention {
  const timestamp = new Date().toISOString();
  return {
    id: `${timestamp}-${input.type}-${hashLite(`${input.sessionId}\n${input.before}\n${input.after}`)}`,
    timestamp,
    sessionId: input.sessionId,
    type: input.type,
    source: 'deterministic',
    severity: 'rewrite',
    reason: input.reason,
    before: input.before,
    after: input.after,
  };
}

export function appendReplyIntervention(intervention: ReplyQualityIntervention): void {
  const path = replyQualityInterventionsPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(intervention)}\n`, 'utf-8');
}

function hashLite(text: string): string {
  let h = 0;
  for (const ch of text) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(16).slice(0, 8);
}
