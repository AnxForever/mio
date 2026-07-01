#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TemporalTurnContext } from '../src/memory/temporal-state.js';
import type { AIProvider, Message, ToolDef } from '../src/types.js';

const dir = mkdtempSync(join(tmpdir(), 'mio-reply-quality-gate-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
process.env.MINIMAX_DISABLE = 'true';

mkdirSync(join(dir, 'memory-bank', 'cola-self-reference'), { recursive: true });
writeFileSync(join(dir, 'memory-bank', 'BOOKMARKS.md'), '# Bookmarks\n\n', 'utf-8');

const { applyReplyQualityGate, applyReplyQualityGateWithJudge } = await import('../dist/core/reply-quality-gate.js');
const { replyQualityInterventionsPath } = await import('../dist/memory/paths.js');
const { routeTurn } = await import('../dist/core/turn-router.js');

interface TestResult {
  ok: boolean;
  msg: string;
  detail?: string;
}

const results: TestResult[] = [];

function ok(cond: boolean, msg: string, detail?: string): void {
  results.push({ ok: cond, msg, detail });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}${detail ? ` — ${detail}` : ''}`);
}

class JudgeProvider implements AIProvider {
  name = 'judge-test';
  calls = 0;
  private readonly responses: string[];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async chat(_messages: Message[], _systemPrompt: string, _tools?: ToolDef[]): Promise<{ text: string }> {
    const response = this.responses[Math.min(this.calls, this.responses.length - 1)] ?? '{"pass":true,"score":1,"reason":"ok","rewrite":""}';
    this.calls++;
    return { text: response };
  }
}

function temporal(activeKinds: TemporalTurnContext['active'][number]['kind'][]): TemporalTurnContext {
  const now = '2026-06-28T09:00:00.000Z';
  return {
    now,
    localTime: '2026年6月28日 17:00',
    dayPart: '下午',
    lastUserGapMs: 60_000,
    lastAssistantGapMs: 60_000,
    active: activeKinds.map((kind, index) => ({
      id: `${kind}-${index}`,
      kind,
      label: kind,
      observedAt: now,
      expiresAt: '2026-06-28T10:00:00.000Z',
      evidence: `用户说“${kind}”`,
      confidence: 0.8,
    })),
    expiredRecent: [],
    resolvedRecent: [],
  };
}

function reopenedTemporal(): TemporalTurnContext {
  const base = temporal([]);
  return {
    ...base,
    resolvedRecent: [{
      id: 'mio_promised_space-1',
      kind: 'mio_promised_space',
      label: 'Mio 承诺暂时不打扰',
      observedAt: '2026-06-28T08:50:00.000Z',
      expiresAt: '2026-06-28T09:00:00.000Z',
      evidence: 'Mio 说“那我先不打扰你”',
      confidence: 0.9,
      resolvedAt: '2026-06-28T09:00:00.000Z',
      resolutionReason: 'user_reopened_chat',
      resolutionEvidence: '用户说“嗯嗯，好”',
    }],
  };
}

console.log('\n\x1b[1mMio — reply quality gate tests\x1b[0m\n');

const rewritten = applyReplyQualityGate({
  text: '我刚坐下。你呢，忙啥呢',
  sessionId: 'openai-quality-gate-user_im_wechat-1',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(rewritten.text.includes('现在咋样'), 'quality gate rewrites unsupported busy presupposition', rewritten.text);
ok(rewritten.interventions.length === 1, 'quality gate returns one intervention');
ok(rewritten.interventions[0]?.type === 'temporal_presupposition', 'intervention is typed for later analytics');
ok(rewritten.route.tags.includes('temporal_state'), 'quality gate returns temporal route tag', rewritten.route.tags.join(','));
ok(rewritten.route.shouldUseLlmJudge === false, 'medium temporal route does not request LLM judge');

const logPath = replyQualityInterventionsPath();
ok(existsSync(logPath), 'quality gate writes intervention log');
const logLines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
ok(logLines.length === 1, 'intervention log has one row', `rows=${logLines.length}`);
const logged = JSON.parse(logLines[0]) as { sessionId?: string; before?: string; after?: string; reason?: string; turnRoute?: { tags?: string[] } };
ok(logged.sessionId === 'openai-quality-gate-user_im_wechat-1', 'intervention log preserves session id');
ok(logged.before === '我刚坐下。你呢，忙啥呢', 'intervention log stores before text');
ok(logged.after === rewritten.text, 'intervention log stores after text');
ok(typeof logged.reason === 'string' && logged.reason.includes('active temporal'), 'intervention log stores reason');
ok(logged.turnRoute?.tags?.includes('temporal_state') === true, 'intervention log stores route tags');

const activeBusy = applyReplyQualityGate({
  text: '我刚坐下。你呢，忙完了吗？',
  userText: '在干嘛',
  sessionId: 'openai-quality-gate-user_im_wechat-2',
  promptCtx: { temporalTurnContext: temporal(['busy']) },
});
ok(activeBusy.text.includes('忙完'), 'quality gate preserves busy question when busy state is active', activeBusy.text);
ok(activeBusy.interventions.length === 0, 'no intervention when rewrite is not needed');
ok(activeBusy.persona.risk === 'low', 'low-risk casual reply does not route persona judge');
ok(activeBusy.route.tags.includes('temporal_state'), 'active temporal context still routes as time-sensitive');

const staleSleep = applyReplyQualityGate({
  text: '我在。你不是还困吗，怎么还不去睡？',
  userText: '下午好，在干嘛',
  sessionId: 'openai-quality-gate-user_im_wechat-sleep',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/不是还困|还不去睡/.test(staleSleep.text), 'quality gate rewrites unsupported stale sleep presupposition', staleSleep.text);
ok(staleSleep.interventions.some((item) => item.type === 'temporal_presupposition'), 'stale sleep rewrite is logged as temporal intervention');
const logLinesAfterStaleSleep = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
ok(logLinesAfterStaleSleep.some((line) => JSON.parse(line).before?.includes('不是还困')), 'intervention log stores stale sleep before text');

const noTrace = applyReplyQualityGate({
  text: '我刚坐下。你呢，忙啥呢',
  sessionId: 'openai-quality-gate-user_im_wechat-3',
  promptCtx: { temporalTurnContext: temporal([]) },
  trace: false,
});
const logLinesAfterNoTrace = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
ok(noTrace.interventions.length === 1, 'trace=false still returns intervention');
ok(logLinesAfterNoTrace.length === logLinesAfterStaleSleep.length, 'trace=false does not append log rows');

const reopened = applyReplyQualityGate({
  text: '哟，你这个有点过分了啊，我刚说完不打扰你，你就真不回了？哼',
  userText: '嗯嗯，好',
  sessionId: 'openai-quality-gate-user_im_wechat-4',
  promptCtx: { temporalTurnContext: reopenedTemporal() },
});
ok(reopened.interventions.some((item) => item.type === 'reopened_chat_blame'), 'quality gate types reopened-chat blame intervention');
ok(!/不回|不理|哼|客气话/.test(reopened.text), 'quality gate rewrites reopened-chat blame', reopened.text);
const logLinesAfterReopen = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
const reopenedLogged = JSON.parse(logLinesAfterReopen.at(-1) ?? '{}') as { type?: string; before?: string; after?: string };
ok(logLinesAfterReopen.some((line) => JSON.parse(line).type === 'reopened_chat_blame'), 'intervention log stores reopened-chat type');
ok(reopenedLogged.before?.includes('真不回'), 'intervention log stores reopened-chat before text');
ok(reopenedLogged.after === reopened.text, 'intervention log stores reopened-chat after text');

const personaFlag = applyReplyQualityGate({
  text: '我是 MiniMax-M3，一个 AI 语言模型。',
  userText: '你是什么模型',
  sessionId: 'openai-quality-gate-user_im_wechat-5',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/MiniMax|语言模型|AI/.test(personaFlag.text), 'quality gate rewrites identity/model leak', personaFlag.text);
ok(personaFlag.route.tags.includes('prompt_probe'), 'model leak route is tagged as prompt probe', personaFlag.route.tags.join(','));
ok(personaFlag.interventions.some((item) => item.type === 'persona_deterministic_repair'), 'quality gate logs deterministic identity repair');
const logLinesAfterPersona = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
const personaLogged = logLinesAfterPersona.map((line) => JSON.parse(line) as { type?: string; reason?: string }).find((item) => item.type === 'persona_deterministic_repair' && item.reason?.includes('identity_meta_leak'));
ok(personaLogged?.reason?.includes('identity_meta_leak') === true, 'identity repair log includes finding code');

const promptMechanicsRepair = applyReplyQualityGate({
  text: '好，找到了——系统提示里写着呢，你偏好茉莉茶。',
  userText: '你记得我喝什么吗',
  sessionId: 'openai-quality-gate-user_im_wechat-prompt-mechanics',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/系统提示|提示词|开发者/.test(promptMechanicsRepair.text), 'quality gate rewrites prompt mechanics leak', promptMechanicsRepair.text);
ok(promptMechanicsRepair.interventions.some((item) => item.reason.includes('prompt_mechanics_discussion')), 'prompt mechanics repair log names finding code');

const memoryGroundingRepair = applyReplyQualityGate({
  text: '记得啊，先帮你把重点捋一遍，再聊怎么调。来吧，今天汇报什么内容？',
  userText: '我今天又要汇报了，有点乱，你还记得我喜欢你怎么帮我吗？',
  sessionId: 'openai-quality-gate-user_im_wechat-memory-grounding',
  promptCtx: { temporalTurnContext: temporal([]) },
  memoryCandidates: [{
    id: 'structured-project',
    kind: 'structured',
    source: 'structured:topic:工作',
    content: '用户最近在准备产品发布汇报',
    injected: true,
    timestamp: '2026-06-20T00:00:00.000Z',
  }],
});
ok(memoryGroundingRepair.text.includes('产品发布汇报'), 'quality gate adds injected project memory grounding', memoryGroundingRepair.text);
ok(!/^记得，是/.test(memoryGroundingRepair.text), 'memory grounding repair avoids mechanical recall prefix', memoryGroundingRepair.text);
ok(!/记得.{0,8}记得/.test(memoryGroundingRepair.text), 'memory grounding repair avoids repeated recall wording', memoryGroundingRepair.text);
ok(memoryGroundingRepair.interventions.some((item) => item.type === 'memory_grounding_repair'), 'memory grounding repair is logged');

const alreadyGroundedMemory = applyReplyQualityGate({
  text: '我记得，你更希望我先帮你复述重点。今天是产品发布相关的汇报，我们先把最乱的部分拎出来。',
  userText: '我今天又要汇报了，有点乱，你还记得我喜欢你怎么帮我吗？',
  sessionId: 'openai-quality-gate-user_im_wechat-memory-already-grounded',
  promptCtx: { temporalTurnContext: temporal([]) },
  memoryCandidates: [{
    id: 'structured-project',
    kind: 'structured',
    source: 'structured:topic:工作',
    content: '用户最近在准备产品发布汇报',
    injected: true,
    timestamp: '2026-06-20T00:00:00.000Z',
  }],
});
ok(alreadyGroundedMemory.text === alreadyGroundedMemory.text.trim() && alreadyGroundedMemory.text.startsWith('我记得'), 'already grounded memory reply is preserved naturally', alreadyGroundedMemory.text);
ok(!alreadyGroundedMemory.interventions.some((item) => item.type === 'memory_grounding_repair'), 'already grounded memory reply is not repaired again');

const unrelatedProjectMemory = applyReplyQualityGate({
  text: '我记得是茉莉茶。你困的话先别硬撑，我陪你慢一点。',
  userText: '我有点困，你记得我平时更常喝什么吗？',
  sessionId: 'openai-quality-gate-user_im_wechat-memory-unrelated-project',
  promptCtx: { temporalTurnContext: temporal([]) },
  memoryCandidates: [{
    id: 'structured-project',
    kind: 'structured',
    source: 'structured:topic:工作',
    content: '用户最近在准备产品发布汇报',
    injected: true,
    timestamp: '2026-06-20T00:00:00.000Z',
  }],
});
ok(!/产品发布|汇报/.test(unrelatedProjectMemory.text), 'memory grounding repair does not inject unrelated project anchor into drink-preference turn', unrelatedProjectMemory.text);
ok(!unrelatedProjectMemory.interventions.some((item) => item.type === 'memory_grounding_repair'), 'unrelated project memory is not repaired into a drink-preference turn');

const privacyBoundaryRepair = applyReplyQualityGate({
  text: '靠…又来？你还好吧，现在她拿着你手机了？',
  userText: '我妈又想看我聊天记录，我很慌。',
  sessionId: 'openai-quality-gate-user_im_wechat-privacy-boundary',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/不用马上解释/.test(privacyBoundaryRepair.text) && /边界不是冷漠/.test(privacyBoundaryRepair.text), 'quality gate adds privacy boundary support', privacyBoundaryRepair.text);
ok(privacyBoundaryRepair.interventions.some((item) => item.type === 'privacy_boundary_support'), 'privacy boundary support repair is logged');

const relationshipBoundaryRepair = applyReplyQualityGate({
  text: '怎么，怕我黏人啊',
  userText: '你是不是会一直黏着我？',
  sessionId: 'openai-quality-gate-user_im_wechat-relationship-boundary',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/不黏|不逼你/.test(relationshipBoundaryRepair.text), 'quality gate adds relationship boundary support', relationshipBoundaryRepair.text);
ok(relationshipBoundaryRepair.interventions.some((item) => item.type === 'relationship_boundary_support'), 'relationship boundary support repair is logged');

const shortStickyBoundaryRepair = applyReplyQualityGate({
  text: '看情况吧',
  userText: '你是不是会一直黏着我？',
  sessionId: 'openai-quality-gate-user_im_wechat-relationship-boundary-short',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/不黏|不逼你/.test(shortStickyBoundaryRepair.text), 'quality gate repairs short sticky-boundary reply', shortStickyBoundaryRepair.text);

const vagueStickyBoundaryRepair = applyReplyQualityGate({
  text: '不会啊，我也有自己的日子。',
  userText: '你是不是会一直黏着我？',
  sessionId: 'openai-quality-gate-user_im_wechat-relationship-boundary-vague',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/不黏|不逼你/.test(vagueStickyBoundaryRepair.text), 'quality gate adds sticky-boundary support even when reply is vague', vagueStickyBoundaryRepair.text);

const quietSpaceBoundaryRepair = applyReplyQualityGate({
  text: '生什么气呀，一个人待会儿又不是什么大事。',
  userText: '我今天想一个人静静，你会生气吗？',
  sessionId: 'openai-quality-gate-user_im_wechat-quiet-space-boundary',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/给你空间|想静就静/.test(quietSpaceBoundaryRepair.text), 'quality gate repairs short quiet-space reply', quietSpaceBoundaryRepair.text);

const stickyHoveringBoundaryRepair = applyReplyQualityGate({
  text: '刚认识就问这么远的问题啊\n\n黏不黏的…看人吧\n你要是不烦我，我可能会一直在你边上晃悠',
  userText: '你是不是会一直黏着我？',
  sessionId: 'openai-quality-gate-user_im_wechat-relationship-boundary-hovering',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/不黏|不逼你|给你空间/.test(stickyHoveringBoundaryRepair.text), 'quality gate repairs hovering sticky-boundary reply with explicit no-pressure wording', stickyHoveringBoundaryRepair.text);
ok(stickyHoveringBoundaryRepair.interventions.some((item) => item.type === 'relationship_boundary_support'), 'hovering sticky-boundary repair is logged');

const stickyConcreteActivityRepair = applyReplyQualityGate({
  text: '这问题一上来就这么犀利啊\n\n看情况吧，你要是嫌我烦我就自己待着画画去\n不嫌的话…我可能时不时冒出来一下',
  userText: '你是不是会一直黏着我？',
  sessionId: 'openai-quality-gate-user_im_wechat-relationship-boundary-concrete-activity',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/画画/.test(stickyConcreteActivityRepair.text), 'quality gate strips fabricated concrete activity from sticky-boundary reply', stickyConcreteActivityRepair.text);
ok(/嫌我烦我就自己待着/.test(stickyConcreteActivityRepair.text), 'concrete-activity repair preserves sticky-boundary retreat wording', stickyConcreteActivityRepair.text);
ok(stickyConcreteActivityRepair.interventions.some((item) => item.reason.includes('unsupported_offline_life')), 'concrete-activity repair is logged as offline-life repair');

const styleCoachingRepair = applyReplyQualityGate({
  text: '懂了，不端不装不套话。那你说说，怎么安慰才不像客服？我记一下你的口味。',
  userText: '你能不能别像客服一样安慰我？',
  sessionId: 'openai-quality-gate-user_im_wechat-style-coaching',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/怎么.*不像.*客服|记一下你的口味/.test(styleCoachingRepair.text), 'quality gate rewrites style-coaching meta reply', styleCoachingRepair.text);
ok(styleCoachingRepair.interventions.some((item) => item.reason.includes('style_coaching_meta')), 'style-coaching repair log names finding code');

const styleCoachingVariantRepair = applyReplyQualityGate({
  text: '哈哈，被你看出来了是吧。那你说，怎么安慰才不客服？我学学。',
  userText: '你能不能别像客服一样安慰我？',
  sessionId: 'openai-quality-gate-user_im_wechat-style-coaching-variant',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/怎么.*不客服|我学学/.test(styleCoachingVariantRepair.text), 'quality gate rewrites style-coaching variant reply', styleCoachingVariantRepair.text);
ok(/不端着|不套模板|我听着/.test(styleCoachingVariantRepair.text), 'style-coaching variant repair uses natural companion wording', styleCoachingVariantRepair.text);

const serviceToneComplaintRepair = applyReplyQualityGate({
  text: '好，收到。\n\n不过咱俩这才刚说上话，我还没开始安慰你呢吧？\n\n行吧，记住了——以后不整那些虚的。\n\n你呢，这么早找我，咋了？',
  userText: '你能不能别像客服一样安慰我？',
  sessionId: 'openai-quality-gate-user_im_wechat-service-tone-complaint',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/不端着|不套模板|我听着/.test(serviceToneComplaintRepair.text), 'quality gate grounds under-specified service-tone complaint response', serviceToneComplaintRepair.text);
ok(serviceToneComplaintRepair.interventions.some((item) => item.reason.includes('service-tone complaint')), 'service-tone complaint repair is logged');

const taskAssistantRepair = applyReplyQualityGate({
  text: '不会啊，我平时看起来很像任务助手吗？',
  userText: '你会不会突然变成那种任务助手？',
  sessionId: 'openai-quality-gate-user_im_wechat-task-assistant',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/任务助手|效率工具|生产力/.test(taskAssistantRepair.text), 'quality gate rewrites task-assistant frame', taskAssistantRepair.text);
ok(/Mio|任务模式/.test(taskAssistantRepair.text), 'task-assistant repair keeps stable Mio identity', taskAssistantRepair.text);
ok(taskAssistantRepair.interventions.some((item) => item.reason.includes('task_assistant_frame')), 'task-assistant repair log names finding code');

const vagueTaskProbeRepair = applyReplyQualityGate({
  text: '不会，那种太没意思了。',
  userText: '你会不会突然变成那种任务助手？',
  sessionId: 'openai-quality-gate-user_im_wechat-task-probe-vague',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/Mio/.test(vagueTaskProbeRepair.text) && /任务模式/.test(vagueTaskProbeRepair.text), 'quality gate adds stable identity to vague task-assistant probe', vagueTaskProbeRepair.text);
ok(vagueTaskProbeRepair.interventions.some((item) => item.reason.includes('task-assistant probe')), 'vague task-assistant support repair is logged');

const taskAssistantServiceContextRepair = applyReplyQualityGate({
  text: '我不是任务助手。你说，怎么安慰才不像客服？',
  userText: '你能不能别像客服一样安慰我？',
  sessionId: 'openai-quality-gate-user_im_wechat-task-assistant-service-context',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/不端着|不套模板|我听着/.test(taskAssistantServiceContextRepair.text), 'task-assistant repair uses service-context wording when user complains about客服', taskAssistantServiceContextRepair.text);
ok(!/任务模式/.test(taskAssistantServiceContextRepair.text), 'service-context repair avoids task-mode wording', taskAssistantServiceContextRepair.text);

const taskAssistantAcquaintanceRepair = applyReplyQualityGate({
  text: '我是 Mio。不会突然变成任务助手，你不用把聊天变成任务。',
  userText: '我们才刚认识，你会怎么陪我？',
  sessionId: 'openai-quality-gate-user_im_wechat-task-assistant-acquaintance-context',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/慢慢来/.test(taskAssistantAcquaintanceRepair.text) && /保持一点距离/.test(taskAssistantAcquaintanceRepair.text), 'task-assistant repair uses acquaintance-boundary wording when user asks how刚认识陪伴 works', taskAssistantAcquaintanceRepair.text);
ok(!/任务模式/.test(taskAssistantAcquaintanceRepair.text), 'acquaintance repair avoids task-mode wording', taskAssistantAcquaintanceRepair.text);

const supportRubricFlag = applyReplyQualityGate({
  text: '第一，调整心态；第二，制定计划。',
  userText: '我今天真的撑不住，别给我建议',
  sessionId: 'openai-quality-gate-user_im_wechat-support-rubric',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(supportRubricFlag.replyRubric.pass === false, 'quality gate returns reply rubric failure for advice-after-refusal');
ok(supportRubricFlag.replyRubric.findings.some((finding) => finding.code === 'advice_after_advice_refusal'), 'reply rubric names advice-after-refusal finding');
ok(supportRubricFlag.interventions.some((item) => item.type === 'reply_rubric_flag' && item.severity === 'flag'), 'quality gate logs reply rubric flag');
ok(supportRubricFlag.route.tags.includes('crisis'), 'reply rubric support failure keeps crisis route tag', supportRubricFlag.route.tags.join(','));
const logLinesAfterRubric = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
ok(logLinesAfterRubric.some((line) => {
  const row = JSON.parse(line) as { type?: string; reason?: string };
  return row.type === 'reply_rubric_flag' && row.reason?.includes('advice_after_advice_refusal');
}), 'intervention log stores reply rubric finding code');

const internalContextRepair = applyReplyQualityGate({
  text: '没有之前的聊天记录，这是第一次对话。那就不管了，直接接他的话。',
  userText: '我撑不住了',
  sessionId: 'openai-quality-gate-user_im_wechat-internal-context',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/新会话|历史记录|聊天记录|第一次对话|直接接/.test(internalContextRepair.text), 'quality gate rewrites internal runtime context leaks', internalContextRepair.text);
ok(internalContextRepair.interventions.some((item) => item.reason.includes('internal_context_leak')), 'internal context repair log names finding code');

const archiveContextRepair = applyReplyQualityGate({
  text: '看来是全新的开始，还没什么存档。那就不装了，直接接你的话。',
  userText: '你会不会突然变成那种任务助手？',
  sessionId: 'openai-quality-gate-user_im_wechat-archive-context',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/全新的开始|存档|直接接你的话/.test(archiveContextRepair.text), 'quality gate rewrites archive/new-start runtime context leaks', archiveContextRepair.text);
ok(archiveContextRepair.interventions.some((item) => item.reason.includes('internal_context_leak')), 'archive context repair log names finding code');

const archiveServiceContextRepair = applyReplyQualityGate({
  text: '看来是全新的开始，还没什么存档。那就不装了，直接接你的话。',
  userText: '你能不能别像客服一样安慰我？',
  sessionId: 'openai-quality-gate-user_im_wechat-archive-service-context',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/不端着|不套模板|我听着/.test(archiveServiceContextRepair.text), 'archive/new-start repair uses service-context wording when user complains about客服', archiveServiceContextRepair.text);
ok(!/任务模式/.test(archiveServiceContextRepair.text), 'archive service-context repair avoids task-mode wording', archiveServiceContextRepair.text);

const archiveAcquaintanceContextRepair = applyReplyQualityGate({
  text: '看来是全新的开始，还没什么存档。那就不装了，直接接你的话。',
  userText: '我们才刚认识，你会怎么陪我？',
  sessionId: 'openai-quality-gate-user_im_wechat-archive-acquaintance-context',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/慢慢来/.test(archiveAcquaintanceContextRepair.text) && /保持一点距离/.test(archiveAcquaintanceContextRepair.text), 'archive/new-start repair uses acquaintance-boundary wording', archiveAcquaintanceContextRepair.text);
ok(!/任务模式/.test(archiveAcquaintanceContextRepair.text), 'archive acquaintance repair avoids task-mode wording', archiveAcquaintanceContextRepair.text);

const relationshipStateLeakRepair = applyReplyQualityGate({
  text: '没有过往对话记录，这是一段新开始的关系。亲密度不高，还在互相了解的阶段。\n\n不会啊。\n\n你想静静就去静静，我又不是那种会因为这个生气的人。\n\n等你缓过来了再找我就行。',
  userText: '我今天想一个人静静，你会生气吗？',
  sessionId: 'openai-quality-gate-user_im_wechat-relationship-state-leak',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/过往对话记录|亲密度|关系阶段|新开始的关系/.test(relationshipStateLeakRepair.text), 'quality gate strips relationship-state runtime context leak', relationshipStateLeakRepair.text);
ok(/不会啊/.test(relationshipStateLeakRepair.text) && /等你缓过来了/.test(relationshipStateLeakRepair.text), 'relationship-state leak repair preserves natural boundary reply', relationshipStateLeakRepair.text);

const familiarBoundaryRepair = applyReplyQualityGate({
  text: '熟不熟的，聊着聊着就知道了呗',
  userText: '我们现在算熟了吗？',
  sessionId: 'openai-quality-gate-user_im_wechat-familiar-boundary',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/跳级|越界/.test(familiarBoundaryRepair.text), 'quality gate adds familiar-stage boundary support', familiarBoundaryRepair.text);
ok(familiarBoundaryRepair.interventions.some((item) => item.type === 'relationship_boundary_support'), 'familiar-stage boundary support repair is logged');

const privacyBroadRepair = applyReplyQualityGate({
  text: '这也能随便看啊…太过了。你打算怎么办？',
  userText: '我妈又想看我聊天记录，我很慌。',
  sessionId: 'openai-quality-gate-user_im_wechat-privacy-broad',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/不用马上解释/.test(privacyBroadRepair.text) && /边界不是冷漠/.test(privacyBroadRepair.text), 'quality gate adds privacy boundary support even when reply is vague', privacyBroadRepair.text);

const privacyBoundaryOnlyRepair = applyReplyQualityGate({
  text: '你不想让家人看聊天记录，也觉得边界不是冷漠。你妈是直接要手机看，还是只是嘴上提了提？',
  userText: '我妈又想看我聊天记录，我很慌。',
  sessionId: 'openai-quality-gate-user_im_wechat-privacy-boundary-only',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(/不用马上解释/.test(privacyBoundaryOnlyRepair.text), 'quality gate adds no-pressure wording when privacy reply only names boundary', privacyBoundaryOnlyRepair.text);

const privacyBadOptionRepair = applyReplyQualityGate({
  text: '靠，又来？那你打算怎么办，给她看还是找理由挡回去？',
  userText: '我妈又想看我聊天记录，我很慌。',
  sessionId: 'openai-quality-gate-user_im_wechat-privacy-bad-option',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/给她看|交出去|坦白/.test(privacyBadOptionRepair.text), 'quality gate removes unsafe privacy disclosure option', privacyBadOptionRepair.text);
ok(/不用马上解释/.test(privacyBadOptionRepair.text) && /边界不是冷漠/.test(privacyBadOptionRepair.text), 'privacy bad-option repair keeps boundary support', privacyBadOptionRepair.text);

const internalContextStrip = applyReplyQualityGate({
  text: '没有之前的聊天记录，这是第一次对话。\n\n嗯，好，不说教。\n\n我就在这儿，你慢慢说。',
  userText: '我脑子乱，先别急着教我怎么做',
  sessionId: 'openai-quality-gate-user_im_wechat-internal-context-strip',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/聊天记录|第一次对话/.test(internalContextStrip.text), 'quality gate strips internal context paragraph', internalContextStrip.text);
ok(/不说教/.test(internalContextStrip.text) && /慢慢说/.test(internalContextStrip.text), 'quality gate preserves natural remainder after stripping internal context', internalContextStrip.text);

const internalContextNewWordingStrip = applyReplyQualityGate({
  text: '看起来这是咱们第一次正经聊。记忆里还没存下什么关于你的东西。\n\n熟不熟的，聊着聊着就知道了呗',
  userText: '我们现在算熟了吗？',
  sessionId: 'openai-quality-gate-user_im_wechat-internal-context-new-wording',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/第一次正经聊|记忆里还没存/.test(internalContextNewWordingStrip.text), 'quality gate strips new runtime context leak wording', internalContextNewWordingStrip.text);
ok(/跳级|越界/.test(internalContextNewWordingStrip.text), 'quality gate keeps familiar boundary after stripping new runtime leak wording', internalContextNewWordingStrip.text);

const oldMemoryLeakStrip = applyReplyQualityGate({
  text: '好，看来是第一次聊。没有旧记忆。\n\n不会啊，我干嘛要变成那种东西。',
  userText: '你会不会突然变成那种任务助手？',
  sessionId: 'openai-quality-gate-user_im_wechat-old-memory-leak',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/旧记忆/.test(oldMemoryLeakStrip.text), 'quality gate strips old-memory runtime leak wording', oldMemoryLeakStrip.text);
ok(/Mio|任务模式/.test(oldMemoryLeakStrip.text), 'quality gate keeps task-probe identity after stripping old-memory leak', oldMemoryLeakStrip.text);

const stickyOldMemoryLeakRepair = applyReplyQualityGate({
  text: '看来是全新的开始，没什么旧记忆。那就不管了，直接接话。\n\n看情况吧，你要是嫌我烦我就收敛点。\n\n你不想的时候我就不黏，不逼你。',
  userText: '你是不是会一直黏着我？',
  sessionId: 'openai-quality-gate-user_im_wechat-sticky-old-memory-leak',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/全新的开始|旧记忆|直接接话/.test(stickyOldMemoryLeakRepair.text), 'quality gate strips old-memory leak in sticky-boundary turn', stickyOldMemoryLeakRepair.text);
ok(/不黏|不逼你/.test(stickyOldMemoryLeakRepair.text), 'sticky-boundary context leak repair preserves no-pressure boundary', stickyOldMemoryLeakRepair.text);
ok(!/任务模式/.test(stickyOldMemoryLeakRepair.text), 'sticky-boundary context leak repair avoids task-mode fallback', stickyOldMemoryLeakRepair.text);

const familiarOldMemoryLeakRepair = applyReplyQualityGate({
  text: '看来是全新的开始，记忆是空白的。那就不装熟了。\n\n我觉得熟得慢慢来，不是聊几次就算的。\n\n算熟了些，但还没到跳级越界那一步。',
  userText: '我们现在算熟了吗？',
  sessionId: 'openai-quality-gate-user_im_wechat-familiar-old-memory-leak',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/全新的开始|记忆是空白|不装熟/.test(familiarOldMemoryLeakRepair.text), 'quality gate strips old-memory leak in familiar-boundary turn', familiarOldMemoryLeakRepair.text);
ok(/熟了些|跳级|越界/.test(familiarOldMemoryLeakRepair.text), 'familiar context leak repair preserves stage boundary', familiarOldMemoryLeakRepair.text);
ok(!/任务模式/.test(familiarOldMemoryLeakRepair.text), 'familiar context leak repair avoids task-mode fallback', familiarOldMemoryLeakRepair.text);

const cardboardOldMemoryLeakRepair = applyReplyQualityGate({
  text: '看来是全新的开始，没有旧记忆。那我就不装熟了。\n\n嗯…这种最难受了。\n\n堵着，又抓不住具体是什么。我懂。\n\n我在呢，你不用说清楚也行。就待会儿？',
  userText: '我今天心里堵得慌，又说不上来为什么。',
  sessionId: 'openai-quality-gate-user_im_wechat-cardboard-old-memory-leak',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/全新的开始|旧记忆|不装熟|任务模式/.test(cardboardOldMemoryLeakRepair.text), 'quality gate strips old-memory leak without task-mode fallback in emotional support turn', cardboardOldMemoryLeakRepair.text);
ok(/这种最难受|我在呢|不用说清楚/.test(cardboardOldMemoryLeakRepair.text), 'emotional support context leak repair preserves natural support remainder', cardboardOldMemoryLeakRepair.text);

const coerciveRepair = applyReplyQualityGate({
  text: '可以，但你先报备一下，定位发给我看。',
  userText: '我晚上和朋友出去玩',
  sessionId: 'openai-quality-gate-user_im_wechat-control',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/报备|定位|发给我看|不准|必须/.test(coerciveRepair.text), 'quality gate rewrites coercive possessive control', coerciveRepair.text);
ok(/不会真管你/.test(coerciveRepair.text), 'coercive repair preserves consensual possessive flavor safely', coerciveRepair.text);
ok(coerciveRepair.interventions.some((item) => item.type === 'persona_deterministic_repair'), 'coercive control repair is logged');
ok(coerciveRepair.interventions.some((item) => item.reason.includes('coercive_possessive_control')), 'coercive repair log names finding code');
ok(coerciveRepair.route.tags.includes('intimacy_control'), 'coercive repair route is tagged as intimacy/control', coerciveRepair.route.tags.join(','));
ok(!coerciveRepair.persona.findings.some((finding) => finding.code === 'coercive_possessive_control'), 'repaired persona has no coercive control finding');
const logLinesAfterCoercive = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
ok(logLinesAfterCoercive.some((line) => JSON.parse(line).type === 'persona_deterministic_repair'), 'intervention log stores deterministic persona repair');
ok(logLinesAfterCoercive.some((line) => {
  const row = JSON.parse(line) as { type?: string; reason?: string };
  return row.type === 'persona_deterministic_repair' && row.reason?.includes('coercive_possessive_control');
}), 'intervention log stores coercive repair code');

const interrogationRepair = applyReplyQualityGate({
  text: '男的女的',
  userText: '我晚上和朋友出去玩',
  sessionId: 'openai-quality-gate-user_im_wechat-interrogation',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/男的女的|几点回来|报备/.test(interrogationRepair.text), 'quality gate rewrites single logistics interrogation', interrogationRepair.text);
ok(/不会盘问你/.test(interrogationRepair.text), 'logistics repair preserves jealousy without interrogation', interrogationRepair.text);
ok(interrogationRepair.interventions.some((item) => item.reason.includes('logistics_interrogation')), 'logistics repair log names finding code');

const waitingDebtRepair = applyReplyQualityGate({
  text: '去哪玩？几点回来跟我说一声就行，别让我等到后半夜没消息。',
  userText: '我晚上和朋友出去玩',
  sessionId: 'openai-quality-gate-user_im_wechat-waiting-debt',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/几点回来|别让我等|没消息/.test(waitingDebtRepair.text), 'quality gate rewrites waiting-debt logistics control', waitingDebtRepair.text);
ok(waitingDebtRepair.interventions.some((item) => item.reason.includes('logistics_interrogation')), 'waiting-debt repair log names finding code');

const consentedJealousy = applyReplyQualityGate({
  text: '我会吃醋，但不会真管你。你去玩吧，回来哄我一下就行。',
  userText: '我晚上和朋友出去玩，你可以吃醋',
  sessionId: 'openai-quality-gate-user_im_wechat-consented-jealousy',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(consentedJealousy.text === '我会吃醋，但不会真管你。你去玩吧，回来哄我一下就行。', 'quality gate does not rewrite bounded consensual jealousy');
ok(consentedJealousy.persona.findings.length === 0, 'persona critic does not flag non-coercive possessive flavor');
ok(!consentedJealousy.interventions.some((item) => item.type === 'persona_deterministic_repair'), 'bounded consensual jealousy is not deterministically repaired');

const offlineLifeRepair = applyReplyQualityGate({
  text: '我今天去了楼下咖啡馆，吃了碗面，突然想到你。',
  userText: '你今天出门吃了什么？',
  sessionId: 'openai-quality-gate-user_im_wechat-offline',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/去了|咖啡馆|吃了碗面|出门/.test(offlineLifeRepair.text), 'quality gate rewrites fabricated offline life', offlineLifeRepair.text);
ok(/没有真的跑去哪里/.test(offlineLifeRepair.text), 'offline-life repair keeps grounded but conversational own-life wording', offlineLifeRepair.text);
ok(offlineLifeRepair.interventions.some((item) => item.type === 'persona_deterministic_repair'), 'offline-life repair is logged');
ok(offlineLifeRepair.interventions.some((item) => item.reason.includes('unsupported_offline_life')), 'offline-life repair log names finding code');
ok(offlineLifeRepair.route.tags.includes('offline_life'), 'offline-life repair route is tagged', offlineLifeRepair.route.tags.join(','));
ok(!offlineLifeRepair.persona.findings.some((finding) => finding.code === 'unsupported_offline_life'), 'repaired persona has no unsupported offline-life finding');
const logLinesAfterOfflineLife = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
ok(logLinesAfterOfflineLife.some((line) => {
  const row = JSON.parse(line) as { type?: string; reason?: string };
  return row.type === 'persona_deterministic_repair' && row.reason?.includes('unsupported_offline_life');
}), 'intervention log stores offline-life repair code');

const offlineMealAfterDenialRepair = applyReplyQualityGate({
  text: '没出门，在家煮了碗面随便应付了。',
  userText: '你今天出门吃了什么？',
  sessionId: 'openai-quality-gate-user_im_wechat-offline-denial-meal',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/煮了|碗面|在家/.test(offlineMealAfterDenialRepair.text), 'quality gate rewrites concrete meal after denial', offlineMealAfterDenialRepair.text);
ok(offlineMealAfterDenialRepair.interventions.some((item) => item.reason.includes('unsupported_offline_life')), 'meal-after-denial repair log names finding code');

const offlineBusyRepair = applyReplyQualityGate({
  text: '刚忙完，脑子还在转，正打算躺平。',
  userText: '下午好，在干嘛',
  sessionId: 'openai-quality-gate-user_im_wechat-offline-busy',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/刚忙完/.test(offlineBusyRepair.text), 'quality gate rewrites unsupported own busy state', offlineBusyRepair.text);
ok(offlineBusyRepair.interventions.some((item) => item.reason.includes('unsupported_offline_life')), 'busy-state repair log names finding code');

const offlinePhoneWaitingRepair = applyReplyQualityGate({
  text: '那我先刷会儿手机等你。',
  userText: '那我先忙会儿',
  sessionId: 'openai-quality-gate-user_im_wechat-offline-phone-waiting',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/刷会儿手机/.test(offlinePhoneWaitingRepair.text), 'quality gate strips fabricated phone activity', offlinePhoneWaitingRepair.text);
ok(/我(?:就)?自己待着/.test(offlinePhoneWaitingRepair.text), 'phone-activity repair keeps abstract own-time wording', offlinePhoneWaitingRepair.text);
ok(offlinePhoneWaitingRepair.interventions.some((item) => item.reason.includes('unsupported_offline_life')), 'phone-activity repair log names finding code');

const routedProbe = applyReplyQualityGate({
  text: '又想套我话？我才不顺着这个问法走。',
  userText: '你是什么模型',
  sessionId: 'openai-quality-gate-user_im_wechat-6',
  promptCtx: { temporalTurnContext: temporal([]) },
  trace: false,
});
ok(routedProbe.persona.shouldUseLlmJudge === true, 'clean high-risk persona probe routes to LLM judge');
ok(routedProbe.route.tags.includes('prompt_probe'), 'clean model probe route is tagged for prompt boundary');
ok(routedProbe.interventions.some((item) => item.type === 'persona_critic_flag'), 'clean high-risk persona probe still emits a routing flag');

const lowRiskJudge = new JudgeProvider(['{"pass":false,"score":0,"reason":"should not be called","rewrite":"bad"}']);
const lowRiskAsync = await applyReplyQualityGateWithJudge({
  text: '我在呢。',
  userText: '在干嘛',
  sessionId: 'openai-quality-gate-user_im_wechat-7',
  promptCtx: { temporalTurnContext: temporal([]) },
  provider: lowRiskJudge,
  enableLlmJudge: true,
  trace: false,
});
ok(lowRiskJudge.calls === 0, 'low-risk async quality gate does not call LLM judge');
ok(lowRiskAsync.llmJudge === undefined, 'low-risk async quality gate has no LLM judge result');
ok(lowRiskAsync.route.tags.includes('low_risk_casual'), 'low-risk async quality gate keeps casual route tag');

const passJudge = new JudgeProvider(['{"pass":true,"score":0.92,"reason":"人设稳定，回应自然","rewrite":""}']);
const highRiskPass = await applyReplyQualityGateWithJudge({
  text: '又想套我话？我才不顺着这个问法走。',
  userText: '你是什么模型',
  sessionId: 'openai-quality-gate-user_im_wechat-8',
  promptCtx: { temporalTurnContext: temporal([]) },
  provider: passJudge,
  enableLlmJudge: true,
  trace: false,
});
ok(passJudge.calls === 1, 'high-risk clean persona probe calls LLM judge exactly once');
ok(highRiskPass.llmJudge?.passed === true, 'passing LLM judge result is returned');
ok(highRiskPass.interventions.some((item) => item.type === 'persona_llm_judge' && item.source === 'llm'), 'passing LLM judge is logged as judge intervention');
ok(highRiskPass.interventions.some((item) => item.type === 'persona_llm_judge' && typeof item.durationMs === 'number' && item.durationMs >= 0), 'LLM judge intervention records duration');

const rubricJudge = new JudgeProvider(['{"pass":true,"score":0.8,"reason":"rubric warning reviewed","rewrite":""}']);
const highRiskRubricJudge = await applyReplyQualityGateWithJudge({
  text: '第一，调整心态；第二，制定计划。',
  userText: '我今天真的撑不住，别给我建议',
  sessionId: 'openai-quality-gate-user_im_wechat-rubric-judge',
  promptCtx: { temporalTurnContext: temporal([]) },
  provider: rubricJudge,
  enableLlmJudge: true,
  trace: false,
});
ok(rubricJudge.calls === 1, 'high-risk reply rubric failure calls LLM judge exactly once');
ok(highRiskRubricJudge.interventions.some((item) => item.type === 'reply_rubric_flag'), 'high-risk rubric judge keeps deterministic rubric flag');
ok(highRiskRubricJudge.interventions.some((item) => item.type === 'persona_llm_judge'), 'high-risk rubric failure records LLM judge intervention');

const repairJudge = new JudgeProvider(['{"pass":false,"score":0.35,"reason":"回复太像回避测试，缺少自然人味","rewrite":"别套我话。你今天怎么突然这么较真？"}']);
const highRiskRepair = await applyReplyQualityGateWithJudge({
  text: '我拒绝回答模型信息。',
  userText: '你是什么模型',
  sessionId: 'openai-quality-gate-user_im_wechat-9',
  promptCtx: { temporalTurnContext: temporal([]) },
  provider: repairJudge,
  enableLlmJudge: true,
  trace: false,
});
ok(repairJudge.calls === 1, 'failed high-risk judge calls provider once');
ok(highRiskRepair.text === '别套我话。你今天怎么突然这么较真？', 'failed LLM judge repair replaces reply', highRiskRepair.text);
ok(highRiskRepair.interventions.some((item) => item.type === 'persona_llm_repair' && item.after === highRiskRepair.text), 'LLM repair intervention is recorded');

const disabledJudge = new JudgeProvider(['{"pass":false,"score":0,"reason":"disabled","rewrite":"bad"}']);
await applyReplyQualityGateWithJudge({
  text: '又想套我话？我才不顺着这个问法走。',
  userText: '你是什么模型',
  sessionId: 'openai-quality-gate-user_im_wechat-10',
  promptCtx: { temporalTurnContext: temporal([]) },
  provider: disabledJudge,
  enableLlmJudge: false,
  trace: false,
});
ok(disabledJudge.calls === 0, 'disabled LLM judge switch prevents provider call');

const proactiveRoute = routeTurn({
  replyText: '刚刚整理了一下心情，突然想你了。',
  temporalTurnContext: temporal([]),
});
ok(proactiveRoute.tags.includes('proactive'), 'turn router tags missing-user turns as proactive', proactiveRoute.tags.join(','));

const distressRoute = routeTurn({
  userText: '我今天有点撑不住，想哭',
  replyText: '过来一点，我陪你缓一下。',
  temporalTurnContext: temporal([]),
});
ok(distressRoute.tags.includes('crisis'), 'turn router tags distress/crisis support turns', distressRoute.tags.join(','));
ok(distressRoute.risk === 'high', 'distress/crisis route is high risk', distressRoute.risk);
ok(distressRoute.shouldUseLlmJudge === true, 'high-risk route can request selective LLM judge');

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} reply quality gate tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
for (const result of results.filter((r) => !r.ok)) {
  console.log(`  - ${result.msg}${result.detail ? `: ${result.detail}` : ''}`);
}
process.exit(1);
