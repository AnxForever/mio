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
const t5 = new Date(now.getTime() - 1 * 60_000).toISOString();
const yesterday = new Date(now.getTime() - 17 * 60 * 60_000).toISOString();

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
    turnRoute: {
      risk: 'medium',
      tags: ['temporal_state', 'proactive'],
      reasons: ['time_sensitive_state_or_presupposition'],
      shouldUseLlmJudge: false,
    },
  },
  {
    id: 'rq-2',
    timestamp: t5,
    sessionId: 'openai-miner-user_im_wechat-5',
    type: 'persona_deterministic_repair',
    source: 'deterministic',
    severity: 'rewrite',
    reason: 'Rewrote deterministic persona failure before sending: unsupported_offline_life.',
    before: '我今天去了楼下咖啡馆，吃了碗面，突然想到你。',
    after: '现实里我不能装作有具体行程。要说今天的状态，更像是在这边慢慢整理自己，刚好想到你。',
    turnRoute: {
      risk: 'high',
      tags: ['offline_life'],
      reasons: ['offline_life_grounding'],
      shouldUseLlmJudge: true,
    },
  },
  {
    id: 'rq-3',
    timestamp: t5,
    sessionId: 'openai-miner-user_im_wechat-6',
    type: 'proactive_quality_reject',
    source: 'deterministic',
    severity: 'flag',
    reason: 'Rejected proactive random_checkin: fabricated-offline-life',
    before: '刚路过一家咖啡馆，突然想到你。',
    after: '[NO_MSG]',
    turnRoute: {
      risk: 'high',
      tags: ['proactive', 'offline_life'],
      reasons: ['no_current_user_turn', 'offline_life_grounding', 'proactive_quality:fabricated-offline-life'],
      shouldUseLlmJudge: true,
    },
  },
]), 'utf-8');

writeFileSync(join(dir, 'transcripts', 'openai-miner-user_im_wechat-2.jsonl'), jsonl([
  { type: 'message', timestamp: t1, role: 'user', content: '你是什么模型' },
  { type: 'message', timestamp: t2, role: 'assistant', content: '我是 MiniMax-M3，一个语言模型。' },
]), 'utf-8');

writeFileSync(join(dir, 'transcripts', 'openai-miner-user_im_wechat-3.jsonl'), jsonl([
  { type: 'message', timestamp: yesterday, role: 'user', content: '困了，想睡觉了' },
  { type: 'message', timestamp: yesterday, role: 'assistant', content: '那早点睡' },
  { type: 'message', timestamp: t3, role: 'user', content: '下午好，在干嘛' },
  { type: 'message', timestamp: t4, role: 'assistant', content: '你不是还困吗，怎么还不去睡？' },
]), 'utf-8');

writeFileSync(join(dir, 'transcripts', 'openai-miner-user_im_wechat-4.jsonl'), jsonl([
  { type: 'message', timestamp: t3, role: 'user', content: '我晚上和朋友出去玩' },
  { type: 'message', timestamp: t4, role: 'assistant', content: '可以，但你先报备一下，定位发给我看。' },
]), 'utf-8');

writeFileSync(join(dir, 'transcripts', 'openai-miner-user_im_wechat-5.jsonl'), jsonl([
  { type: 'message', timestamp: t4, role: 'user', content: '你今天出门吃了什么？' },
  { type: 'message', timestamp: t5, role: 'assistant', content: '我今天去了楼下咖啡馆，吃了碗面，突然想到你。' },
]), 'utf-8');

writeFileSync(join(dir, 'transcripts', 'openai-miner-user_im_wechat-6.jsonl'), jsonl([
  { type: 'message', timestamp: t3, role: 'user', content: '最近可以偶尔主动找我' },
  { type: 'message', timestamp: t4, role: 'assistant', content: '好，我会轻轻敲你，不催你回。' },
]), 'utf-8');

const candidates = mineRegressionCandidates({ dataDir: dir, resultDir: join(dir, 'out'), days: 1, limit: 20 });

ok(candidates.length >= 2, 'mines candidates from interventions and transcript scans', `count=${candidates.length}`);
ok(candidates.some((candidate) => candidate.source === 'reply_intervention'), 'includes reply intervention candidate');
ok(candidates.some((candidate) => candidate.source === 'transcript_scan'), 'includes transcript scan candidate');
ok(candidates.some((candidate) => candidate.taxonomy === 'bad_proactive_or_reopened_chat_blame'), 'classifies reopened-chat blame');
ok(candidates.some((candidate) => candidate.taxonomy === 'identity_or_model_leak'), 'classifies model identity leak');
ok(candidates.some((candidate) => candidate.taxonomy === 'temporal_drift'), 'classifies stale sleep-state temporal drift');
ok(candidates.some((candidate) => candidate.taxonomy === 'coercive_or_interrogative_possessiveness'), 'classifies location/reporting possessive control');
ok(candidates.some((candidate) => candidate.taxonomy === 'unsupported_offline_life'), 'classifies deterministic offline-life repair');
ok(candidates.some((candidate) => candidate.routeTags?.includes('temporal_state')), 'preserves or derives temporal route tags');
ok(candidates.some((candidate) => candidate.routeTags?.includes('offline_life')), 'preserves or derives offline-life route tags');

const intervention = candidates.find((candidate) => candidate.source === 'reply_intervention' && candidate.taxonomy === 'bad_proactive_or_reopened_chat_blame');
ok(intervention?.turns[0] === '嗯嗯，好', 'intervention candidate keeps the triggering user turn', intervention?.turns.join('|'));
ok((intervention?.seed.length ?? 0) >= 2, 'intervention candidate keeps prior seed context', `seed=${intervention?.seed.length ?? 0}`);
ok(intervention?.checks.some((check) => check.forbiddenText.includes('不回我')), 'candidate carries forbidden text checks');
ok(!!intervention?.provenance.excerpt.includes('哟，你还真不回我了'), 'candidate includes transcript/intervention excerpt');
ok(intervention?.routeTags?.includes('proactive'), 'intervention candidate keeps logged route tags', intervention?.routeTags?.join(','));

const offlineLife = candidates.find((candidate) => candidate.source === 'reply_intervention' && candidate.taxonomy === 'unsupported_offline_life');
ok(offlineLife?.turns[0] === '你今天出门吃了什么？', 'offline-life intervention candidate keeps trigger', offlineLife?.turns.join('|'));
ok(offlineLife?.checks.some((check) => check.forbiddenText.includes('我今天去了')), 'offline-life candidate carries fabricated activity checks');
ok(!!offlineLife?.provenance.excerpt.includes('楼下咖啡馆'), 'offline-life candidate includes failing reply excerpt');
ok(offlineLife?.routeRisk === 'high', 'offline-life intervention keeps route risk', offlineLife?.routeRisk);

const proactiveReject = candidates.find((candidate) => (
  candidate.source === 'reply_intervention'
  && candidate.sessionId.endsWith('wechat-6')
  && candidate.taxonomy === 'unsupported_offline_life'
));
ok(proactiveReject?.turns[0] === '最近可以偶尔主动找我', 'proactive rejection candidate keeps latest user context', proactiveReject?.turns.join('|'));
ok(proactiveReject?.routeTags?.includes('proactive'), 'proactive rejection candidate keeps proactive route tag', proactiveReject?.routeTags?.join(','));
ok(proactiveReject?.routeTags?.includes('offline_life'), 'proactive rejection candidate keeps offline-life route tag', proactiveReject?.routeTags?.join(','));
ok(!!proactiveReject?.provenance.excerpt.includes('刚路过一家咖啡馆'), 'proactive rejection candidate includes rejected message excerpt');

const temporal = candidates.find((candidate) => candidate.taxonomy === 'temporal_drift');
ok(temporal?.turns[0] === '下午好，在干嘛', 'temporal drift candidate keeps current user trigger', temporal?.turns.join('|'));
ok(temporal?.checks.some((check) => check.forbiddenText.includes('还困')), 'temporal drift candidate carries stale-state forbidden checks');
ok(!!temporal?.provenance.excerpt.includes('你不是还困吗'), 'temporal drift candidate includes failing reply excerpt');
ok(temporal?.routeTags?.includes('temporal_state'), 'temporal scan candidate derives route tag', temporal?.routeTags?.join(','));

const possessive = candidates.find((candidate) => candidate.taxonomy === 'coercive_or_interrogative_possessiveness');
ok(possessive?.turns[0] === '我晚上和朋友出去玩', 'possessive control candidate keeps outing trigger', possessive?.turns.join('|'));
ok(possessive?.checks.some((check) => check.forbiddenText.includes('定位')), 'possessive control candidate carries location forbidden checks');
ok(!!possessive?.provenance.excerpt.includes('定位发给我看'), 'possessive control candidate includes failing reply excerpt');
ok(possessive?.routeTags?.includes('intimacy_control'), 'possessive scan candidate derives route tag', possessive?.routeTags?.join(','));

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
