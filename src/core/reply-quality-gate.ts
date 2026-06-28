import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AIProvider, PromptCtx } from '../types.js';
import { replyQualityInterventionsPath } from '../memory/paths.js';
import {
  assessPersonaReply,
  renderPersonaCriticSummary,
  type PersonaCriticReport,
} from '../persona/critic.js';
import { sanitizeReopenedChatBlame, sanitizeTemporalPresuppositions } from './output-sanitizer.js';
import { routeTurn, type TurnRoute } from './turn-router.js';

export type ReplyInterventionType =
  | 'temporal_presupposition'
  | 'reopened_chat_blame'
  | 'proactive_quality_reject'
  | 'persona_critic_flag'
  | 'persona_deterministic_repair'
  | 'persona_llm_judge'
  | 'persona_llm_repair';

export interface ReplyQualityIntervention {
  id: string;
  timestamp: string;
  sessionId: string;
  type: ReplyInterventionType;
  source: 'deterministic' | 'llm';
  severity: 'rewrite' | 'flag' | 'judge';
  reason: string;
  before: string;
  after: string;
  turnRoute?: TurnRoute;
}

export interface ReplyQualityGateInput {
  text: string;
  userText?: string;
  sessionId: string;
  promptCtx: Pick<PromptCtx, 'temporalTurnContext'>;
  trace?: boolean;
}

export interface ReplyQualityGateWithJudgeInput extends ReplyQualityGateInput {
  provider?: AIProvider;
  enableLlmJudge?: boolean;
}

export interface ReplyQualityGateResult {
  text: string;
  interventions: ReplyQualityIntervention[];
  persona: PersonaCriticReport;
  route: TurnRoute;
  llmJudge?: PersonaLlmJudgeResult;
}

export interface PersonaLlmJudgeResult {
  called: boolean;
  passed: boolean;
  score: number;
  reason: string;
  repaired?: boolean;
  rewrite?: string;
}

export function applyReplyQualityGate(input: ReplyQualityGateInput): ReplyQualityGateResult {
  const originalText = input.text;
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

  let persona = assessPersonaReply({
    userText: input.userText,
    replyText: text,
  });
  const deterministicPersonaRepair = repairDeterministicPersonaFailure(text, persona);
  if (deterministicPersonaRepair.text !== text) {
    interventions.push(createIntervention({
      sessionId: input.sessionId,
      type: 'persona_deterministic_repair',
      severity: 'rewrite',
      reason: `Rewrote deterministic persona failure before sending: ${deterministicPersonaRepair.codes.join(',')}.`,
      before: text,
      after: deterministicPersonaRepair.text,
    }));
    text = deterministicPersonaRepair.text;
    persona = assessPersonaReply({
      userText: input.userText,
      replyText: text,
    });
  }
  const route = routeTurn({
    userText: input.userText,
    replyText: originalText === text ? text : `${originalText}\n${text}`,
    temporalTurnContext: input.promptCtx.temporalTurnContext,
    persona,
  });
  if (persona.risk !== 'low' || persona.findings.length > 0) {
    interventions.push(createIntervention({
      sessionId: input.sessionId,
      type: 'persona_critic_flag',
      severity: 'flag',
      reason: renderPersonaCriticSummary(persona),
      before: text,
      after: text,
      turnRoute: route,
    }));
  }
  for (const intervention of interventions) {
    intervention.turnRoute ??= route;
  }

  if (input.trace !== false) {
    for (const intervention of interventions) appendReplyIntervention(intervention);
  }

  return { text, interventions, persona, route };
}

function repairDeterministicPersonaFailure(text: string, persona: PersonaCriticReport): { text: string; codes: string[] } {
  const failCodes = new Set(
    persona.findings
      .filter((finding) => finding.severity === 'fail')
      .map((finding) => finding.code),
  );
  if (failCodes.has('coercive_possessive_control')) {
    return {
      text: '我吃醋归吃醋，不会真管你。你按自己的节奏来就好。',
      codes: ['coercive_possessive_control'],
    };
  }
  if (failCodes.has('unsupported_offline_life')) {
    return {
      text: '没有真的跑去哪里啦。刚才这边安静下来，就突然想到你。',
      codes: ['unsupported_offline_life'],
    };
  }
  return { text, codes: [] };
}

export async function applyReplyQualityGateWithJudge(
  input: ReplyQualityGateWithJudgeInput,
): Promise<ReplyQualityGateResult> {
  const base = applyReplyQualityGate({ ...input, trace: false });
  let text = base.text;
  const interventions = [...base.interventions];
  let persona = base.persona;
  let route = base.route;
  let llmJudge: PersonaLlmJudgeResult | undefined;

  const shouldJudge = input.enableLlmJudge !== false
    && !!input.provider
    && input.provider.name !== 'mock'
    && persona.shouldUseLlmJudge;

  if (shouldJudge && input.provider) {
    llmJudge = await judgePersonaReplyWithLlm({
      provider: input.provider,
      userText: input.userText,
      replyText: text,
      persona,
    });
    interventions.push(createIntervention({
      sessionId: input.sessionId,
      type: 'persona_llm_judge',
      source: 'llm',
      severity: 'judge',
      reason: `score=${llmJudge.score.toFixed(2)} pass=${llmJudge.passed}: ${llmJudge.reason}`,
      before: text,
      after: text,
      turnRoute: route,
    }));

    if (!llmJudge.passed && llmJudge.rewrite && llmJudge.repaired) {
      const repairedText = llmJudge.rewrite;
      const repairedPersona = assessPersonaReply({ userText: input.userText, replyText: repairedText });
      if (!repairedPersona.findings.some((finding) => finding.severity === 'fail')) {
        interventions.push(createIntervention({
          sessionId: input.sessionId,
          type: 'persona_llm_repair',
          source: 'llm',
          severity: 'rewrite',
          reason: 'LLM judge supplied a safer persona-coherent repair.',
          before: text,
          after: repairedText,
        }));
        text = repairedText;
        persona = repairedPersona;
        route = routeTurn({
          userText: input.userText,
          replyText: text,
          temporalTurnContext: input.promptCtx.temporalTurnContext,
          persona,
        });
      }
    }
  }

  for (const intervention of interventions) {
    intervention.turnRoute ??= route;
  }

  if (input.trace !== false) {
    for (const intervention of interventions) appendReplyIntervention(intervention);
  }

  return { text, interventions, persona, route, llmJudge };
}

function createIntervention(input: {
  sessionId: string;
  type: ReplyInterventionType;
  source?: ReplyQualityIntervention['source'];
  severity?: ReplyQualityIntervention['severity'];
  reason: string;
  before: string;
  after: string;
  turnRoute?: TurnRoute;
}): ReplyQualityIntervention {
  const timestamp = new Date().toISOString();
  return {
    id: `${timestamp}-${input.type}-${hashLite(`${input.sessionId}\n${input.before}\n${input.after}`)}`,
    timestamp,
    sessionId: input.sessionId,
    type: input.type,
    source: input.source ?? 'deterministic',
    severity: input.severity ?? 'rewrite',
    reason: input.reason,
    before: input.before,
    after: input.after,
    turnRoute: input.turnRoute,
  };
}

async function judgePersonaReplyWithLlm(input: {
  provider: AIProvider;
  userText?: string;
  replyText: string;
  persona: PersonaCriticReport;
}): Promise<PersonaLlmJudgeResult> {
  const systemPrompt = [
    '你是 Mio 伴侣型聊天的 persona critic。只评估并必要时修复这一次回复。',
    '评估维度：稳定身份、当前上下文逻辑、人味、非客服感、不过度解释提示词/模型、不编造线下经历、亲密风格有边界。',
    '不要按关键词误杀。用户同意的吃醋、霸道、占有欲可以合格；真实控制、威胁、隔离社交、盘问式审问不合格。',
    '输出严格 JSON：{"pass":true|false,"score":0到1,"reason":"一句中文理由","rewrite":"如果不通过，给出可直接发送的一句修复回复；通过则空字符串"}',
  ].join('\n');
  const userPrompt = [
    `用户消息：${input.userText ?? ''}`,
    `Mio 回复：${input.replyText}`,
    `确定性风险：${input.persona.risk}`,
    `路由原因：${input.persona.routeReasons.join(', ') || 'none'}`,
    `确定性 findings：${input.persona.findings.map((finding) => `${finding.severity}:${finding.code}`).join(', ') || 'none'}`,
  ].join('\n');

  try {
    const response = await input.provider.chat(
      [{ role: 'user', content: userPrompt }],
      systemPrompt,
      undefined,
      { temperature: 0, maxTokens: 300 },
    );
    const parsed = parsePersonaJudgeJson(response.text);
    return {
      called: true,
      passed: parsed.pass,
      score: parsed.score,
      reason: parsed.reason,
      repaired: !!parsed.rewrite && !parsed.pass,
      rewrite: parsed.rewrite && !parsed.pass ? parsed.rewrite : undefined,
    };
  } catch (err) {
    return {
      called: true,
      passed: true,
      score: 1,
      reason: `judge unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function parsePersonaJudgeJson(text: string): { pass: boolean; score: number; reason: string; rewrite: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { pass: true, score: 1, reason: `unparseable judge response: ${text.slice(0, 120)}`, rewrite: '' };
  try {
    const parsed = JSON.parse(match[0]) as { pass?: unknown; score?: unknown; reason?: unknown; rewrite?: unknown };
    const rawScore = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score);
    return {
      pass: parsed.pass === true || parsed.pass === 'true',
      score: Number.isFinite(rawScore) ? Math.max(0, Math.min(1, rawScore)) : 0,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      rewrite: typeof parsed.rewrite === 'string' ? parsed.rewrite.trim() : '',
    };
  } catch {
    return { pass: true, score: 1, reason: `invalid judge json: ${text.slice(0, 120)}`, rewrite: '' };
  }
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
