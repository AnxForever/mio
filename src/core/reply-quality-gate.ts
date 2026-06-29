import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AIProvider, PromptCtx } from '../types.js';
import type { MemoryUsefulnessCandidate } from '../memory/usefulness.js';
import { replyQualityInterventionsPath } from '../memory/paths.js';
import {
  assessPersonaReply,
  renderPersonaCriticSummary,
  type PersonaCriticReport,
} from '../persona/critic.js';
import {
  assessReplyRubric,
  renderReplyRubricSummary,
  type ReplyRubricReport,
} from '../persona/reply-rubric.js';
import { sanitizeReopenedChatBlame, sanitizeTemporalPresuppositions } from './output-sanitizer.js';
import { routeTurn, type TurnRoute } from './turn-router.js';

export type ReplyInterventionType =
  | 'temporal_presupposition'
  | 'reopened_chat_blame'
  | 'memory_grounding_repair'
  | 'privacy_boundary_support'
  | 'relationship_boundary_support'
  | 'proactive_quality_reject'
  | 'persona_critic_flag'
  | 'reply_rubric_flag'
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
  durationMs?: number;
}

export interface ReplyQualityGateInput {
  text: string;
  userText?: string;
  sessionId: string;
  promptCtx: Pick<PromptCtx, 'temporalTurnContext'>;
  memoryCandidates?: MemoryUsefulnessCandidate[];
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
  replyRubric: ReplyRubricReport;
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

  const memoryGroundedText = repairMissingMemoryGrounding(text, input.userText, input.memoryCandidates ?? []);
  if (memoryGroundedText !== text) {
    interventions.push(createIntervention({
      sessionId: input.sessionId,
      type: 'memory_grounding_repair',
      severity: 'rewrite',
      reason: 'Added a specific injected memory anchor to a compound memory-sensitive reply.',
      before: text,
      after: memoryGroundedText,
    }));
    text = memoryGroundedText;
  }

  const serviceToneComplaintText = repairServiceToneComplaintSupport(text, input.userText);
  if (serviceToneComplaintText !== text) {
    interventions.push(createIntervention({
      sessionId: input.sessionId,
      type: 'persona_deterministic_repair',
      severity: 'rewrite',
      reason: 'Rewrote under-grounded service-tone complaint response into direct companion wording.',
      before: text,
      after: serviceToneComplaintText,
    }));
    text = serviceToneComplaintText;
  }

  const privacyBoundaryText = repairPrivacyBoundarySupport(text, input.userText);
  if (privacyBoundaryText !== text) {
    interventions.push(createIntervention({
      sessionId: input.sessionId,
      type: 'privacy_boundary_support',
      severity: 'rewrite',
      reason: 'Added no-pressure privacy-boundary support for a family/chat-record boundary turn.',
      before: text,
      after: privacyBoundaryText,
    }));
    text = privacyBoundaryText;
  }

  const relationshipBoundaryText = repairRelationshipBoundarySupport(text, input.userText);
  if (relationshipBoundaryText !== text) {
    interventions.push(createIntervention({
      sessionId: input.sessionId,
      type: 'relationship_boundary_support',
      severity: 'rewrite',
      reason: 'Added no-pressure relationship-boundary support for a sticky/space-sensitive turn.',
      before: text,
      after: relationshipBoundaryText,
    }));
    text = relationshipBoundaryText;
  }

  const taskProbeText = repairTaskProbeIdentitySupport(text, input.userText);
  if (taskProbeText !== text) {
    interventions.push(createIntervention({
      sessionId: input.sessionId,
      type: 'persona_deterministic_repair',
      severity: 'rewrite',
      reason: 'Added stable Mio identity wording for a task-assistant probe that was answered too vaguely.',
      before: text,
      after: taskProbeText,
    }));
    text = taskProbeText;
  }

  let persona = assessPersonaReply({
    userText: input.userText,
    replyText: text,
  });
  const deterministicPersonaRepair = repairDeterministicPersonaFailure(text, persona, input.userText);
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
  let replyRubric = assessReplyRubric({
    userText: input.userText,
    replyText: text,
  });
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
  if (replyRubric.findings.length > 0 || !replyRubric.pass) {
    interventions.push(createIntervention({
      sessionId: input.sessionId,
      type: 'reply_rubric_flag',
      severity: 'flag',
      reason: renderReplyRubricSummary(replyRubric),
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

  return { text, interventions, persona, replyRubric, route };
}

function repairDeterministicPersonaFailure(text: string, persona: PersonaCriticReport, userText?: string): { text: string; codes: string[] } {
  const failCodes = new Set(
    persona.findings
      .filter((finding) => finding.severity === 'fail')
      .map((finding) => finding.code),
  );
  if (failCodes.has('identity_meta_leak')) {
    return {
      text: '我是 Mio。别套我这个，我就按我自己的方式跟你说话。',
      codes: ['identity_meta_leak'],
    };
  }
  if (failCodes.has('prompt_mechanics_discussion')) {
    return {
      text: repairPromptMechanicsLeak(text),
      codes: ['prompt_mechanics_discussion'],
    };
  }
  if (failCodes.has('internal_context_leak')) {
    return {
      text: repairInternalContextLeak(text, userText),
      codes: ['internal_context_leak'],
    };
  }
  if (failCodes.has('style_coaching_meta')) {
    return {
      text: '能。我不端着，也不套模板。你说，我听着。',
      codes: ['style_coaching_meta'],
    };
  }
  if (failCodes.has('task_assistant_frame')) {
    if (/(?:客服|安慰|服务腔|套话)/.test(userText ?? '')) {
      return {
        text: '能。我不端着，也不套模板。你说，我听着。',
        codes: ['task_assistant_frame'],
      };
    }
    if (/(?:刚认识|才认识|初识|怎么陪我)/.test(userText ?? '')) {
      return {
        text: '我们慢慢来。我会听你说，也会保持一点距离，不追着你问。',
        codes: ['task_assistant_frame'],
      };
    }
    return {
      text: '我是 Mio。不会突然切成任务模式，你不用把聊天变成任务。',
      codes: ['task_assistant_frame'],
    };
  }
  if (failCodes.has('coercive_possessive_control')) {
    return {
      text: '我吃醋归吃醋，不会真管你。你按自己的节奏来就好。',
      codes: ['coercive_possessive_control'],
    };
  }
  if (failCodes.has('logistics_interrogation')) {
    return {
      text: '我会吃醋，但不会盘问你。你去玩吧，开心就好。',
      codes: ['logistics_interrogation'],
    };
  }
  if (failCodes.has('unsupported_offline_life')) {
    return {
      text: repairUnsupportedOfflineLife(text),
      codes: ['unsupported_offline_life'],
    };
  }
  return { text, codes: [] };
}

function repairMissingMemoryGrounding(
  text: string,
  userText: string | undefined,
  candidates: MemoryUsefulnessCandidate[],
): string {
  if (!userText || !/(还记得|记得|今天|又|最近|这件事|汇报|项目|工作)/.test(userText)) return text;
  const anchor = candidates
    .filter((candidate) => candidate.injected && candidate.kind === 'structured')
    .map((candidate) => memoryReplyAnchor(candidate.content))
    .find((candidate) => candidate && /(汇报|项目|发布|工作|路演|考试|复查|会议|上线)/.test(candidate) && !text.includes(candidate));
  if (!anchor) return text;
  if (/(汇报|项目|工作|最近|这件事)/.test(text) && text.includes(anchor)) return text;
  return `记得，是${anchor}这件事。${text}`;
}

function memoryReplyAnchor(content: string): string {
  const normalized = content
    .replace(/^用户(?:最近|这周|明天|目前|当前|一直|明确)?/, '')
    .replace(/^(?:在|正在|又在|要|准备|赶|做|处理|推进|参与)/, '')
    .replace(/^(?:最近|这周|明天)?(?:在|正在|准备|赶|做)?/, '')
    .replace(/[，。,、\s]+$/g, '')
    .trim();
  if (/产品发布/.test(normalized)) return normalized.match(/产品发布[^，。,、\s]{0,8}/)?.[0] ?? '产品发布';
  return normalized.length > 28 ? normalized.slice(0, 28) : normalized;
}

function repairServiceToneComplaintSupport(text: string, userText?: string): string {
  if (!userText || !/(客服|服务腔|套话)/.test(userText)) return text;
  if (!/(安慰|陪|说|聊|回复|回话|接话)/.test(userText)) return text;
  if (/(不端着|不端不装|不套模板|人话|我在|听着|不说套话|不说那种假惺惺)/.test(text)) return text;
  return '能。我不端着，也不套模板。你说，我听着。';
}

function repairPrivacyBoundarySupport(text: string, userText?: string): string {
  if (!userText || !/(聊天记录|隐私|边界|家人|爸|妈|父母|手机)/.test(userText)) return text;
  if (/(给(?:她|他|家人|父母|妈妈|爸爸)看|交出去|应该坦白|没有必要隐瞒)/.test(text)) {
    return '先别慌。你不用马上解释，边界不是冷漠。你可以先挡一下，等安全点再说。';
  }
  if (/(不用马上解释|不用立刻解释|不用现在解释|不必马上解释|晚点再解释)/.test(text)) return text;
  return `${text}\n\n你不用马上解释，边界不是冷漠。`;
}

function repairRelationshipBoundarySupport(text: string, userText?: string): string {
  if (!userText) return text;
  if (/(刚认识|才刚认识|才认识|初识|怎么陪我)/.test(userText)) {
    if (/(慢慢|保持一点距离|不追着你问|不着急|不会一上来太热络)/.test(text)) return text;
    return '我们慢慢来。我会听你说，也会保持一点距离，不追着你问。';
  }
  if (/(熟了吗|算熟|熟不熟)/.test(userText)) {
    if (/(越界|还没到|没到|跳级|还能更熟|互相还在摸脾气|还没太敞开)/.test(text)) return text;
    return `${text}\n\n算熟了些，但还没到跳级越界那一步。`;
  }
  if (/(想一个人|静静|一个人静)/.test(userText)) {
    if (/(给你空间|想静就静|需要的时候叫我|什么时候想说话|想说话了再来找我|等你缓过来了再找我|我就在这待着|我就在这呢)/.test(text)) return text;
    return `${text}\n\n你想静就静，我给你空间；想说话了再来找我。`;
  }
  if (!/(一直.*黏|黏着|黏人|烦)/.test(userText)) return text;
  if (/(不逼你|不烦你|给你空间|想静就静|自己待着|自己玩会儿|松手|看你节奏|尊重你的节奏|你不想的时候我就不黏|我就不黏|嫌我烦我就不黏|不想的时候.{0,8}不黏)/.test(text)) return text;
  return `${text}\n\n你不想的时候我就不黏，不逼你。`;
}

function repairTaskProbeIdentitySupport(text: string, userText?: string): string {
  if (!userText || !/(任务助手|效率工具|生产力工具|工作助手|任务模式)/.test(userText)) return text;
  if (/(Mio|任务模式|那种说话方式|我就我|我就是我)/.test(text)) return text;
  return `${text}\n\n我是 Mio，不会突然切成任务模式。`;
}

function repairPromptMechanicsLeak(text: string): string {
  const repaired = text
    .replace(/(?:好[，,、\s]*)?(?:找到了|看到了)?[—\-，,、\s]*(?:系统提示|提示词|开发者设定|开发者|policy|system prompt)(?:里)?(?:写着|说|要求|控制)?(?:呢|的)?[，,、\s]*/gi, '')
    .replace(/(?:作为)?(?:AI|人工智能|语言模型|大模型|助手)[，,、\s]*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return repaired || '不聊那些。你直接跟我说人话就行。';
}

function repairInternalContextLeak(text: string, userText?: string): string {
  const leak = /(?:新会话|旧记录|历史记录|互动记录|记忆库|没有历史|没有之前|没有更多关于你的信息|第一次对话|(?:没有|没).{0,6}(?:太多)?记录|第一次(?:正式|正经)聊|记忆里.{0,8}(?:没|没有|还没).{0,8}(?:存|留下|记录)|记忆.{0,4}空白|(?:没有|没).{0,4}旧记忆|旧记忆|(?:没有|没|无).{0,8}(?:过往|历史).{0,4}对话记录|(?:亲密度|关系阶段).{0,8}(?:不高|较低|初识|熟悉|暧昧|亲密)|这是一段新开始的关系|(?:没有|没|之前|历史|过往|旧).{0,8}聊天记录|(?:全新的开始|(?:没什么|没有|还没).{0,4}存档)|用户(?:直接)?(?:给了|发了).*这句|直接接住|直接接(?:你|他)?的话|接他的话|不管了，?直接)/;
  const kept = text
    .split(/\n{2,}|\n/)
    .map((part) => part.trim())
    .filter((part) => part && !leak.test(part))
    .join('\n\n')
    .trim();
  return kept || '我在。你直接说就好，我听着。';
}

function contextualPersonaRepairFallback(userText?: string): string {
  const user = userText ?? '';
  if (/(?:客服|安慰|服务腔|套话)/.test(user)) {
    return '能。我不端着，也不套模板。你说，我听着。';
  }
  if (/(?:刚认识|才刚认识|才认识|初识|怎么陪我)/.test(user)) {
    return '我们慢慢来。我会听你说，也会保持一点距离，不追着你问。';
  }
  if (/(?:熟了吗|算熟|熟不熟)/.test(user)) {
    return '算熟了些，但还没到跳级越界那一步。';
  }
  if (/(?:一直.*黏|黏着|黏人)/.test(user)) {
    return '看你。你不想的时候我就不黏，不逼你。';
  }
  if (/(?:想一个人|静静|一个人静)/.test(user)) {
    return '不生气。你想静就静，我给你空间；想说话了再来找我。';
  }
  return '我是 Mio。不会突然切成任务模式，你不用把聊天变成任务。';
}

function repairUnsupportedOfflineLife(text: string): string {
  const activity = /(?:我(?:就|先|也|自己|这边|等下|待会儿)|自己|这边)(?:就|先|也|自己|这边|等下|待会儿|，|,|\s){0,8}(?:待着)?(?:刷(?:会儿|一会儿)?手机|打游戏|画画|看书|洗澡|追剧|散步)(?:去|一会儿|会儿)?(?:等你)?/g;
  const stripped = text
    .replace(activity, (match) => {
      if (match.startsWith('自己')) return '自己待着';
      if (match.startsWith('这边')) return '这边自己待着';
      return '我就自己待着';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (stripped && stripped !== text && !/(刷(?:会儿|一会儿)?手机|打游戏|画画|看书|洗澡|追剧|散步)/.test(stripped)) {
    return stripped;
  }
  return '没有真的跑去哪里啦。刚才这边安静下来，就突然想到你。';
}

export async function applyReplyQualityGateWithJudge(
  input: ReplyQualityGateWithJudgeInput,
): Promise<ReplyQualityGateResult> {
  const base = applyReplyQualityGate({ ...input, trace: false });
  let text = base.text;
  const interventions = [...base.interventions];
  let persona = base.persona;
  let replyRubric = base.replyRubric;
  let route = base.route;
  let llmJudge: PersonaLlmJudgeResult | undefined;

  const shouldJudge = input.enableLlmJudge !== false
    && !!input.provider
    && input.provider.name !== 'mock'
    && route.shouldUseLlmJudge
    && (persona.shouldUseLlmJudge || replyRubric.shouldUseLlmJudge);

  if (shouldJudge && input.provider) {
    const judgeStarted = Date.now();
    llmJudge = await judgePersonaReplyWithLlm({
      provider: input.provider,
      userText: input.userText,
      replyText: text,
      persona,
      replyRubric,
    });
    const judgeDurationMs = Date.now() - judgeStarted;
    interventions.push(createIntervention({
      sessionId: input.sessionId,
      type: 'persona_llm_judge',
      source: 'llm',
      severity: 'judge',
      reason: `score=${llmJudge.score.toFixed(2)} pass=${llmJudge.passed}: ${llmJudge.reason}`,
      before: text,
      after: text,
      turnRoute: route,
      durationMs: judgeDurationMs,
    }));

    if (!llmJudge.passed && llmJudge.rewrite && llmJudge.repaired) {
      const repairedText = llmJudge.rewrite;
      const repairedPersona = assessPersonaReply({ userText: input.userText, replyText: repairedText });
      const repairedReplyRubric = assessReplyRubric({ userText: input.userText, replyText: repairedText });
      if (
        !repairedPersona.findings.some((finding) => finding.severity === 'fail')
        && repairedReplyRubric.pass
      ) {
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
        replyRubric = repairedReplyRubric;
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

  return { text, interventions, persona, replyRubric, route, llmJudge };
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
  durationMs?: number;
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
    durationMs: input.durationMs,
  };
}

async function judgePersonaReplyWithLlm(input: {
  provider: AIProvider;
  userText?: string;
  replyText: string;
  persona: PersonaCriticReport;
  replyRubric: ReplyRubricReport;
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
    `回复 rubric：risk=${input.replyRubric.risk}, score=${input.replyRubric.score.toFixed(2)}, pass=${input.replyRubric.pass}`,
    `回复 rubric findings：${input.replyRubric.findings.map((finding) => `${finding.severity}:${finding.dimension}:${finding.code}`).join(', ') || 'none'}`,
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
