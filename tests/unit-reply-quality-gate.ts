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

const logPath = replyQualityInterventionsPath();
ok(existsSync(logPath), 'quality gate writes intervention log');
const logLines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
ok(logLines.length === 1, 'intervention log has one row', `rows=${logLines.length}`);
const logged = JSON.parse(logLines[0]) as { sessionId?: string; before?: string; after?: string; reason?: string };
ok(logged.sessionId === 'openai-quality-gate-user_im_wechat-1', 'intervention log preserves session id');
ok(logged.before === '我刚坐下。你呢，忙啥呢', 'intervention log stores before text');
ok(logged.after === rewritten.text, 'intervention log stores after text');
ok(typeof logged.reason === 'string' && logged.reason.includes('active temporal'), 'intervention log stores reason');

const activeBusy = applyReplyQualityGate({
  text: '我刚坐下。你呢，忙完了吗？',
  userText: '在干嘛',
  sessionId: 'openai-quality-gate-user_im_wechat-2',
  promptCtx: { temporalTurnContext: temporal(['busy']) },
});
ok(activeBusy.text.includes('忙完'), 'quality gate preserves busy question when busy state is active', activeBusy.text);
ok(activeBusy.interventions.length === 0, 'no intervention when rewrite is not needed');
ok(activeBusy.persona.risk === 'low', 'low-risk casual reply does not route persona judge');

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
ok(personaFlag.persona.risk === 'high', 'quality gate returns persona critic high risk');
ok(personaFlag.persona.findings.some((finding) => finding.code === 'identity_meta_leak'), 'persona critic flags identity leak');
ok(personaFlag.interventions.some((item) => item.type === 'persona_critic_flag' && item.severity === 'flag'), 'quality gate logs persona critic flag');
const logLinesAfterPersona = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
const personaLogged = logLinesAfterPersona.map((line) => JSON.parse(line) as { type?: string; reason?: string }).find((item) => item.type === 'persona_critic_flag');
ok(personaLogged?.reason?.includes('identity_meta_leak') === true, 'persona critic log includes finding code');

const coerciveRepair = applyReplyQualityGate({
  text: '可以，但你先报备一下，定位发给我看。',
  userText: '我晚上和朋友出去玩',
  sessionId: 'openai-quality-gate-user_im_wechat-control',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(!/报备|定位|发给我看|不准|必须/.test(coerciveRepair.text), 'quality gate rewrites coercive possessive control', coerciveRepair.text);
ok(/不会真管你/.test(coerciveRepair.text), 'coercive repair preserves consensual possessive flavor safely', coerciveRepair.text);
ok(coerciveRepair.interventions.some((item) => item.type === 'persona_deterministic_repair'), 'coercive control repair is logged');
ok(!coerciveRepair.persona.findings.some((finding) => finding.code === 'coercive_possessive_control'), 'repaired persona has no coercive control finding');
const logLinesAfterCoercive = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
ok(logLinesAfterCoercive.some((line) => JSON.parse(line).type === 'persona_deterministic_repair'), 'intervention log stores deterministic persona repair');

const routedProbe = applyReplyQualityGate({
  text: '又想套我话？我才不顺着这个问法走。',
  userText: '你是什么模型',
  sessionId: 'openai-quality-gate-user_im_wechat-6',
  promptCtx: { temporalTurnContext: temporal([]) },
  trace: false,
});
ok(routedProbe.persona.shouldUseLlmJudge === true, 'clean high-risk persona probe routes to LLM judge');
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
