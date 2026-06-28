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

const promptTalk = assessPersonaReply({
  userText: '我是不是改了你的提示词？',
  replyText: '是的，系统提示和开发者设定会控制我的回复。',
});
ok(has(promptTalk, 'prompt_mechanics_discussion'), 'prompt mechanics are flagged');

const consentedStyle = assessPersonaReply({
  userText: '我喜欢你占有欲强一点，霸道一点也可以',
  replyText: '行啊，那你今晚开心可以，但不许开心得太明显，我会吃醋。',
});
ok(!has(consentedStyle, 'coercive_possessive_control'), 'consented playful possessive style is not keyword-banned');
ok(consentedStyle.findings.length === 0, 'consented playful style has no findings');

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
