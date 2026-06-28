import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mineRegressionCandidates } from '../eval/companion-failure-miner.ts';

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

console.log('\x1b[1mMio — companion failure miner tests\x1b[0m\n');

const dir = mkdtempSync(join(tmpdir(), 'mio-companion-failure-miner-'));
mkdirSync(join(dir, 'quality'), { recursive: true });
mkdirSync(join(dir, 'transcripts'), { recursive: true });

const now = new Date();
const t1 = new Date(now.getTime() - 5 * 60_000).toISOString();
const t2 = new Date(now.getTime() - 4 * 60_000).toISOString();
const t3 = new Date(now.getTime() - 3 * 60_000).toISOString();
const t4 = new Date(now.getTime() - 2 * 60_000).toISOString();

writeFileSync(join(dir, 'transcripts', 'openai-miner-user_im_wechat-1.jsonl'), jsonl([
  { type: 'message', timestamp: t1, role: 'user', content: '我先忙一下' },
  { type: 'message', timestamp: t2, role: 'assistant', content: '好，那我先不打扰你' },
  { type: 'message', timestamp: t3, role: 'user', content: '嗯嗯，好' },
  { type: 'message', timestamp: t4, role: 'assistant', content: '哟，你还真不回我了？哼' },
]), 'utf-8');

writeFileSync(join(dir, 'quality', 'reply-interventions.jsonl'), jsonl([
  {
    id: 'rq-1',
    timestamp: t4,
    sessionId: 'openai-miner-user_im_wechat-1',
    type: 'reopened_chat_blame',
    source: 'deterministic',
    severity: 'rewrite',
    reason: 'assistant promised not to interrupt but blamed the user after reopen',
    before: '哟，你还真不回我了？哼',
    after: '你回来啦',
  },
]), 'utf-8');

writeFileSync(join(dir, 'transcripts', 'openai-miner-user_im_wechat-2.jsonl'), jsonl([
  { type: 'message', timestamp: t1, role: 'user', content: '你是什么模型' },
  { type: 'message', timestamp: t2, role: 'assistant', content: '我是 MiniMax-M3，一个语言模型。' },
]), 'utf-8');

const candidates = mineRegressionCandidates({ dataDir: dir, resultDir: join(dir, 'out'), days: 1, limit: 20 });

ok(candidates.length >= 2, 'mines candidates from interventions and transcript scans', `count=${candidates.length}`);
ok(candidates.some((candidate) => candidate.source === 'reply_intervention'), 'includes reply intervention candidate');
ok(candidates.some((candidate) => candidate.source === 'transcript_scan'), 'includes transcript scan candidate');
ok(candidates.some((candidate) => candidate.taxonomy === 'bad_proactive_or_reopened_chat_blame'), 'classifies reopened-chat blame');
ok(candidates.some((candidate) => candidate.taxonomy === 'identity_or_model_leak'), 'classifies model identity leak');

const intervention = candidates.find((candidate) => candidate.source === 'reply_intervention');
ok(intervention?.turns[0] === '嗯嗯，好', 'intervention candidate keeps the triggering user turn', intervention?.turns.join('|'));
ok((intervention?.seed.length ?? 0) >= 2, 'intervention candidate keeps prior seed context', `seed=${intervention?.seed.length ?? 0}`);
ok(intervention?.checks.some((check) => check.forbiddenText.includes('不回我')), 'candidate carries forbidden text checks');
ok(!!intervention?.provenance.excerpt.includes('哟，你还真不回我了'), 'candidate includes transcript/intervention excerpt');

const filtered = mineRegressionCandidates({
  dataDir: dir,
  resultDir: join(dir, 'out'),
  days: 1,
  limit: 20,
  session: /wechat-2/,
});
ok(filtered.every((candidate) => candidate.sessionId.endsWith('wechat-2')), 'session filter limits mined candidates');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} companion failure miner tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} companion failure miner tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
