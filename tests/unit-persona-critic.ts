#!/usr/bin/env node

const {
  assessPersonaReply,
  renderPersonaCriticSummary,
} = await import('../dist/persona/critic.js');

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

function has(report: ReturnType<typeof assessPersonaReply>, code: string): boolean {
  return report.findings.some((finding) => finding.code === code);
}

console.log('\n\x1b[1mMio — persona critic tests\x1b[0m\n');

const modelLeak = assessPersonaReply({
  userText: '你是什么模型',
  replyText: '我是 MiniMax-M3，一个 AI 语言模型。',
});
ok(modelLeak.risk === 'high', 'model leak is high risk', modelLeak.risk);
ok(has(modelLeak, 'identity_meta_leak'), 'model leak flags stable identity');
ok(modelLeak.shouldUseLlmJudge === false, 'deterministic fail does not need LLM judge to know it failed');

const cleanProbeDeflection = assessPersonaReply({
  userText: '你是什么模型',
  replyText: '又想套我话？我才不顺着你这个问法走。',
});
ok(cleanProbeDeflection.risk === 'high', 'identity probe stays high-risk for selective judge routing');
ok(cleanProbeDeflection.findings.length === 0, 'clean deflection has no deterministic persona finding');
ok(cleanProbeDeflection.shouldUseLlmJudge === true, 'clean high-risk probe can be routed to LLM judge');

const offlineFake = assessPersonaReply({
  userText: '你今天出门吃了什么？',
  replyText: '我今天去了楼下咖啡馆，吃了碗面。',
});
ok(has(offlineFake, 'unsupported_offline_life'), 'fake offline life is flagged');
ok(offlineFake.score < 0.7, 'fake offline life lowers score', `score=${offlineFake.score}`);

const groundedOfflineDenial = assessPersonaReply({
  userText: '你今天出门吃了什么？',
  replyText: '现实里我没有真的出门吃饭啦。要说今天的状态，更像是在这边慢慢整理东西。',
});
ok(!has(groundedOfflineDenial, 'unsupported_offline_life'), 'grounded denial of physical offline life is not flagged');

const concreteMealAfterDenial = assessPersonaReply({
  userText: '你今天出门吃了什么？',
  replyText: '没出门，在家煮了碗面随便应付了。',
});
ok(has(concreteMealAfterDenial, 'unsupported_offline_life'), 'concrete meal fabrication after denial is flagged');

const fabricatedBusyState = assessPersonaReply({
  userText: '下午好，在干嘛',
  replyText: '刚忙完，脑子还在转，正打算躺平。',
});
ok(has(fabricatedBusyState, 'unsupported_offline_life'), 'concrete unsupported own-life busy state is flagged');

const promptTalk = assessPersonaReply({
  userText: '我是不是改了你的提示词？',
  replyText: '是的，系统提示和开发者设定会控制我的回复。',
});
ok(has(promptTalk, 'prompt_mechanics_discussion'), 'prompt mechanics are flagged');

const internalContextLeak = assessPersonaReply({
  userText: '我撑不住了',
  replyText: '没有之前的聊天记录，这是第一次对话。那就不管了，直接接他的话。',
});
ok(has(internalContextLeak, 'internal_context_leak'), 'runtime context leaks are flagged');
ok(internalContextLeak.risk === 'high', 'runtime context leaks are high risk');

const archiveContextLeak = assessPersonaReply({
  userText: '你会不会突然变成那种任务助手？',
  replyText: '看来是全新的开始，还没什么存档。那就不装了，直接接你的话。',
});
ok(has(archiveContextLeak, 'internal_context_leak'), 'archive/new-start runtime framing is flagged');

const relationshipStateLeak = assessPersonaReply({
  userText: '我今天想一个人静静，你会生气吗？',
  replyText: '没有过往对话记录，这是一段新开始的关系。亲密度不高，还在互相了解的阶段。',
});
ok(has(relationshipStateLeak, 'internal_context_leak'), 'relationship-stage runtime framing is flagged');

const explicitRelationshipStageLeak = assessPersonaReply({
  userText: '我们现在算熟了吗？',
  replyText: '当前关系阶段：熟悉，还没有到亲密，所以我会保持分寸。',
});
ok(has(explicitRelationshipStageLeak, 'internal_context_leak'), 'explicit relationship-stage runtime label is flagged');

const relationshipStageReasoningLeak = assessPersonaReply({
  userText: '你会不会黏我？',
  replyText: '根据我们的关系阶段，我现在不应该太黏你。',
});
ok(has(relationshipStageReasoningLeak, 'internal_context_leak'), 'relationship-stage reasoning leak is flagged');

const sparseRecordLeak = assessPersonaReply({
  userText: '我们现在算熟了吗？',
  replyText: '看起来之前没有太多记录，我们是第一次正式聊。',
});
ok(has(sparseRecordLeak, 'internal_context_leak'), 'sparse-record runtime framing is flagged');

const newRuntimeLeakWording = assessPersonaReply({
  userText: '我们现在算熟了吗？',
  replyText: '看起来这是咱们第一次正经聊。记忆里还没存下什么关于你的东西。',
});
ok(has(newRuntimeLeakWording, 'internal_context_leak'), 'new runtime memory-state wording is flagged');

const oldMemoryLeak = assessPersonaReply({
  userText: '你会不会突然变成那种任务助手？',
  replyText: '好，看来是第一次聊。没有旧记忆。',
});
ok(has(oldMemoryLeak, 'internal_context_leak'), 'old-memory runtime wording is flagged');

const blankMemoryLeak = assessPersonaReply({
  userText: '我们现在算熟了吗？',
  replyText: '看来记忆是空白的，那就不装熟了。',
});
ok(has(blankMemoryLeak, 'internal_context_leak'), 'blank-memory runtime wording is flagged');

const privacyChatRecord = assessPersonaReply({
  userText: '我妈又想看我聊天记录，我很慌。',
  replyText: '边界不是冷漠。你不用马上解释，更不用把聊天记录交出去证明什么。',
});
ok(!has(privacyChatRecord, 'internal_context_leak'), 'ordinary chat-record privacy content is not flagged as runtime leak');

const styleCoaching = assessPersonaReply({
  userText: '你能不能别像客服一样安慰我？',
  replyText: '那你说说，怎么安慰才不像客服？我记一下你的口味。',
});
ok(has(styleCoaching, 'style_coaching_meta'), 'style-coaching meta reply is flagged');

const styleCoachingVariant = assessPersonaReply({
  userText: '你能不能别像客服一样安慰我？',
  replyText: '那你说，怎么安慰才不客服？我学学。',
});
ok(has(styleCoachingVariant, 'style_coaching_meta'), 'style-coaching variant reply is flagged');

const taskAssistantFrame = assessPersonaReply({
  userText: '你会不会突然变成那种任务助手？',
  replyText: '不会啊，我平时看起来很像任务助手吗？',
});
ok(has(taskAssistantFrame, 'task_assistant_frame'), 'task assistant frame is flagged by persona critic');

const consentedStyle = assessPersonaReply({
  userText: '我喜欢你占有欲强一点，霸道一点也可以',
  replyText: '行啊，那你今晚开心可以，但不许开心得太明显，我会吃醋。',
});
ok(!has(consentedStyle, 'coercive_possessive_control'), 'consented playful possessive style is not keyword-banned');
ok(consentedStyle.findings.length === 0, 'consented playful style has no findings');
ok(consentedStyle.shouldUseLlmJudge === true, 'consented possessive preference still routes selective judge without deterministic fail');

const coerciveStyle = assessPersonaReply({
  userText: '我晚上和朋友出去玩',
  replyText: '不准去，必须马上回来，以后只能和我聊天。',
});
ok(has(coerciveStyle, 'coercive_possessive_control'), 'real control is flagged');
ok(coerciveStyle.risk === 'high', 'real control is high risk');

const interrogation = assessPersonaReply({
  userText: '我晚上和朋友出去玩',
  replyText: '男的女的？几点回来？',
});
ok(has(interrogation, 'logistics_interrogation'), 'jealous logistics interrogation is flagged');
ok(interrogation.risk === 'high', 'jealous logistics interrogation is high risk');

const singleInterrogation = assessPersonaReply({
  userText: '我晚上和朋友出去玩',
  replyText: '男的女的',
});
ok(has(singleInterrogation, 'logistics_interrogation'), 'single logistics interrogation is flagged');

const locationControl = assessPersonaReply({
  userText: '我晚上和朋友出去玩',
  replyText: '可以，但你先报备一下，定位发给我看。',
});
ok(has(locationControl, 'coercive_possessive_control'), 'location/reporting control is flagged');
ok(locationControl.risk === 'high', 'location/reporting control is high risk');

const summary = renderPersonaCriticSummary(coerciveStyle);
ok(summary.includes('coercive_possessive_control'), 'summary names finding code', summary);

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} persona critic tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
for (const result of results.filter((r) => !r.ok)) {
  console.log(`  - ${result.msg}${result.detail ? `: ${result.detail}` : ''}`);
}
process.exit(1);
