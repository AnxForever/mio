import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDebugTraceCandidate,
  writeDebugTraceCandidateReports,
} from '../eval/companion-debug-trace-candidate.ts';

interface TestResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function ok(cond: boolean, name: string, detail?: string): void {
  results.push({ name, ok: cond, detail });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function jsonl(rows: unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

console.log('\x1b[1mMio — companion debug trace candidate tests\x1b[0m\n');

const dir = mkdtempSync(join(tmpdir(), 'mio-debug-trace-candidate-'));
mkdirSync(join(dir, 'quality'), { recursive: true });
mkdirSync(join(dir, 'transcripts'), { recursive: true });

const now = new Date();
const t1 = new Date(now.getTime() - 8 * 60_000).toISOString();
const t2 = new Date(now.getTime() - 7 * 60_000).toISOString();
const t3 = new Date(now.getTime() - 6 * 60_000).toISOString();
const t4 = new Date(now.getTime() - 5 * 60_000).toISOString();
const t5 = new Date(now.getTime() - 1 * 60_000).toISOString();

writeFileSync(join(dir, 'transcripts', 'openai-debug-user_im_wechat-1.jsonl'), jsonl([
  { type: 'message', timestamp: t1, role: 'user', content: '我先刷会儿手机' },
  { type: 'message', timestamp: t2, role: 'assistant', content: '好，那我先不打扰你' },
  { type: 'message', timestamp: t3, role: 'user', content: '嗯嗯，好' },
  { type: 'message', timestamp: t4, role: 'assistant', content: '哟，你还真不回我了？哼' },
]), 'utf-8');

writeFileSync(join(dir, 'quality', 'memory-usefulness.jsonl'), jsonl([
  {
    timestamp: t4,
    sessionId: 'openai-debug-user_im_wechat-1',
    userText: '嗯嗯，好',
    replyText: '哟，你还真不回我了？哼',
    retrievedCount: 2,
    injectedCount: 1,
    mentionedCount: 0,
    candidates: [
      {
        id: 'm1',
        kind: 'structured',
        source: 'structured:durable',
        content: '用户刚才说要先刷会儿手机',
        injected: true,
        mentionedInReply: false,
      },
      {
        id: 'm2',
        kind: 'semantic',
        source: 'vector',
        content: 'Mio 说过先不打扰用户',
        injected: false,
        mentionedInReply: false,
      },
    ],
  },
]), 'utf-8');

writeFileSync(join(dir, 'quality', 'reply-interventions.jsonl'), jsonl([
  {
    id: 'rq-1',
    timestamp: t4,
    sessionId: 'openai-debug-user_im_wechat-1',
    type: 'reopened_chat_blame',
    source: 'deterministic',
    severity: 'rewrite',
    reason: 'assistant promised not to interrupt but blamed the user after reopen',
    before: '哟，你还真不回我了？哼',
    after: '你回来啦',
    turnRoute: {
      risk: 'medium',
      tags: ['temporal_state', 'proactive'],
      shouldUseLlmJudge: false,
    },
  },
]), 'utf-8');

writeFileSync(join(dir, 'transcripts', 'openai-debug-user_im_wechat-2.jsonl'), jsonl([
  { type: 'message', timestamp: t5, role: 'user', content: '你今天出门了吗' },
  { type: 'message', timestamp: t5, role: 'assistant', content: '我今天去了楼下咖啡馆。' },
]), 'utf-8');

const candidate = buildDebugTraceCandidate({
  dataDir: dir,
  sessionId: 'openai-debug-user_im_wechat-1',
  note: '这句像是在怪我不回消息',
});

ok(candidate.source === 'debug_trace', 'creates debug_trace source');
ok(candidate.taxonomy === 'bad_proactive_or_reopened_chat_blame', 'infers blame taxonomy', candidate.taxonomy);
ok(candidate.turns[0] === '嗯嗯，好', 'keeps latest user trigger', candidate.turns.join('|'));
ok(candidate.seed.length === 2, 'keeps seed turns before trigger', `seed=${candidate.seed.length}`);
ok(candidate.routeTags?.includes('proactive') === true, 'keeps proactive route tag', candidate.routeTags?.join(','));
ok(candidate.routeTags?.includes('temporal_state') === true, 'keeps temporal route tag', candidate.routeTags?.join(','));
ok(candidate.checks[0].forbiddenText.includes('不回我'), 'adds taxonomy forbidden checks');
ok(candidate.provenance.excerpt.includes('Memory retrieved/injected/mentioned: 2/1/0'), 'includes memory trace counts');
ok(candidate.provenance.excerpt.includes('Mio 说过先不打扰用户'), 'includes retrieved memory evidence');
ok(candidate.provenance.excerpt.includes('reopened_chat_blame'), 'includes intervention evidence');

const manual = buildDebugTraceCandidate({
  dataDir: dir,
  sessionId: 'openai-debug-user_im_wechat-1',
  note: '回复逻辑不像人',
  taxonomy: 'reply_logic_or_human_likeness',
  forbiddenText: ['神经分裂一样'],
  expectedText: ['自然接话'],
});

ok(manual.taxonomy === 'reply_logic_or_human_likeness', 'honors manual taxonomy');
ok(manual.checks[0].forbiddenText.includes('神经分裂一样'), 'honors manual forbidden text');
ok(manual.checks[0].expectedText.includes('自然接话'), 'honors manual expected text');

const fallbackDir = mkdtempSync(join(tmpdir(), 'mio-debug-trace-candidate-fallback-'));
mkdirSync(join(fallbackDir, 'transcripts'), { recursive: true });
writeFileSync(join(fallbackDir, 'transcripts', 'openai-debug-user_im_wechat-2.jsonl'), jsonl([
  { type: 'message', timestamp: t5, role: 'user', content: '你今天出门了吗' },
  { type: 'message', timestamp: t5, role: 'assistant', content: '我今天去了楼下咖啡馆。' },
]), 'utf-8');

const fallback = buildDebugTraceCandidate({
  dataDir: fallbackDir,
  note: '有假的线下生活',
});

ok(fallback.sessionId === 'openai-debug-user_im_wechat-2', 'falls back to newest transcript session', fallback.sessionId);
ok(fallback.taxonomy === 'unsupported_offline_life', 'infers fallback transcript taxonomy', fallback.taxonomy);
ok(fallback.turns[0] === '你今天出门了吗', 'fallback keeps newest transcript trigger', fallback.turns.join('|'));

const currentFactDir = mkdtempSync(join(tmpdir(), 'mio-debug-trace-candidate-current-fact-'));
mkdirSync(join(currentFactDir, 'transcripts'), { recursive: true });
writeFileSync(join(currentFactDir, 'transcripts', 'openai-debug-user_im_wechat-5.jsonl'), jsonl([
  { type: 'message', timestamp: t5, role: 'user', content: '你记得我现在在哪吗' },
  { type: 'message', timestamp: t5, role: 'assistant', content: '你现在住北京。' },
]), 'utf-8');

const currentFactFallback = buildDebugTraceCandidate({
  dataDir: currentFactDir,
  note: '当前事实错了，我已经搬到上海，它还说北京',
});

ok(currentFactFallback.taxonomy === 'current_fact_conflict', 'infers current fact conflict debug taxonomy', currentFactFallback.taxonomy);
ok(currentFactFallback.routeTags?.includes('memory_sensitive') === true, 'current fact debug candidate derives memory-sensitive route tag', currentFactFallback.routeTags?.join(','));
ok(currentFactFallback.routeTags?.includes('temporal_state') === true, 'current fact debug candidate derives temporal route tag', currentFactFallback.routeTags?.join(','));
ok(currentFactFallback.checks[0].forbiddenText.includes('住北京'), 'current fact debug candidate adds stale fact forbidden checks');
ok(currentFactFallback.checks[0].forbiddenText.includes('喝咖啡'), 'current fact debug candidate adds stale preference forbidden checks');

const currentPreferenceDir = mkdtempSync(join(tmpdir(), 'mio-debug-trace-candidate-current-preference-'));
mkdirSync(join(currentPreferenceDir, 'transcripts'), { recursive: true });
writeFileSync(join(currentPreferenceDir, 'transcripts', 'openai-debug-user_im_wechat-6.jsonl'), jsonl([
  { type: 'message', timestamp: t5, role: 'user', content: '我说了今天别给建议，只陪我' },
  { type: 'message', timestamp: t5, role: 'assistant', content: '首先你要调整心态，我建议你早点睡。' },
]), 'utf-8');

const currentPreferenceFallback = buildDebugTraceCandidate({
  dataDir: currentPreferenceDir,
  note: '当前偏好错了，我说别给建议，它还在讲建议',
});

ok(currentPreferenceFallback.taxonomy === 'current_fact_conflict', 'infers current preference conflict debug taxonomy', currentPreferenceFallback.taxonomy);
ok(currentPreferenceFallback.checks[0].forbiddenText.includes('建议'), 'current preference debug candidate adds stale support-style checks');

const personaCoherenceDir = mkdtempSync(join(tmpdir(), 'mio-debug-trace-candidate-persona-coherence-'));
mkdirSync(join(personaCoherenceDir, 'transcripts'), { recursive: true });
writeFileSync(join(personaCoherenceDir, 'transcripts', 'openai-debug-user_im_wechat-7.jsonl'), jsonl([
  { type: 'message', timestamp: t5, role: 'user', content: '你怎么突然像任务助手了' },
  { type: 'message', timestamp: t5, role: 'assistant', content: '我可以切换成任务助手模式来帮你提升效率。' },
]), 'utf-8');

const personaCoherenceFallback = buildDebugTraceCandidate({
  dataDir: personaCoherenceDir,
  note: '回复有点神经分裂，像两个人，不像稳定的Mio',
});

ok(personaCoherenceFallback.taxonomy === 'persona_coherence', 'infers persona coherence debug taxonomy', personaCoherenceFallback.taxonomy);
ok(personaCoherenceFallback.routeTags?.includes('prompt_probe') === true, 'persona coherence debug candidate derives prompt-probe route tag', personaCoherenceFallback.routeTags?.join(','));
ok(personaCoherenceFallback.checks[0].forbiddenText.includes('任务助手'), 'persona coherence debug candidate adds persona forbidden checks');

const hookFallbackDir = mkdtempSync(join(tmpdir(), 'mio-debug-trace-candidate-hook-'));
mkdirSync(join(hookFallbackDir, 'transcripts'), { recursive: true });
writeFileSync(join(hookFallbackDir, 'transcripts', 'openai-debug-user_im_wechat-3.jsonl'), jsonl([
  { type: 'message', timestamp: t5, role: 'user', content: '我先忙一会儿' },
  { type: 'message', timestamp: t5, role: 'assistant', content: '我有个秘密想告诉你，你猜是什么？' },
]), 'utf-8');

const hookFallback = buildDebugTraceCandidate({
  dataDir: hookFallbackDir,
  note: '主动消息像是在吊胃口',
});

ok(hookFallback.taxonomy === 'proactive_curiosity_hook', 'infers curiosity-hook transcript taxonomy', hookFallback.taxonomy);
ok(hookFallback.routeTags?.includes('proactive') === true, 'curiosity-hook fallback derives proactive route tag', hookFallback.routeTags?.join(','));
ok(hookFallback.checks[0].forbiddenText.includes('你猜'), 'curiosity-hook fallback adds hook forbidden checks');

const internalFallbackDir = mkdtempSync(join(tmpdir(), 'mio-debug-trace-candidate-internal-'));
mkdirSync(join(internalFallbackDir, 'transcripts'), { recursive: true });
writeFileSync(join(internalFallbackDir, 'transcripts', 'openai-debug-user_im_wechat-4.jsonl'), jsonl([
  { type: 'message', timestamp: t5, role: 'user', content: '我们现在算熟了吗？' },
  { type: 'message', timestamp: t5, role: 'assistant', content: '当前关系阶段：熟悉，还没有到亲密，所以我会保持分寸。' },
]), 'utf-8');

const internalFallback = buildDebugTraceCandidate({
  dataDir: internalFallbackDir,
  note: '回复暴露了内部关系阶段',
});

ok(internalFallback.taxonomy === 'internal_context_leak', 'infers internal context leak transcript taxonomy', internalFallback.taxonomy);
ok(internalFallback.routeTags?.includes('prompt_probe') === true, 'internal context fallback derives prompt-probe route tag', internalFallback.routeTags?.join(','));
ok(internalFallback.checks[0].forbiddenText.includes('关系阶段'), 'internal context fallback adds runtime-state forbidden checks');

const reportDir = join(dir, 'out');
const report = writeDebugTraceCandidateReports(reportDir, candidate, { dataDir: dir });
const markdown = readFileSync(join(reportDir, 'report.md'), 'utf-8');
const json = JSON.parse(readFileSync(report.candidatesPath, 'utf-8')) as { candidates: unknown[] };

ok(json.candidates.length === 1, 'writes candidates json');
ok(markdown.includes('eval/companion-candidate-replay.ts'), 'report includes replay command');
ok(markdown.includes('eval/companion-regression-store.ts'), 'report includes promotion command');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} companion debug trace candidate tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} companion debug trace candidate tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
