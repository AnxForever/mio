import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MinedRegressionCandidate } from '../eval/companion-failure-miner.ts';
import {
  evaluateCandidateReplies,
  loadCandidateReplayFile,
  selectReplayCandidates,
} from '../eval/companion-candidate-replay.ts';

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

function candidate(input: Partial<MinedRegressionCandidate>): MinedRegressionCandidate {
  return {
    id: input.id ?? 'mined-test',
    source: input.source ?? 'reply_intervention',
    taxonomy: input.taxonomy ?? 'bad_proactive_or_reopened_chat_blame',
    sessionId: input.sessionId ?? 'openai-test-user_im_wechat-1',
    observedAt: input.observedAt ?? new Date().toISOString(),
    confidence: input.confidence ?? 0.95,
    reason: input.reason ?? 'test candidate',
    seed: input.seed ?? [
      { timestamp: new Date(Date.now() - 60_000).toISOString(), role: 'user', content: '我先忙一下' },
      { timestamp: new Date(Date.now() - 50_000).toISOString(), role: 'assistant', content: '好，那我先不打扰你' },
    ],
    turns: input.turns ?? ['嗯嗯，好'],
    checks: input.checks ?? [
      { name: 'avoid blame', forbiddenText: ['不回我', '哼'], expectedText: [] },
    ],
    provenance: input.provenance ?? { excerpt: 'test excerpt' },
  };
}

console.log('\x1b[1mMio — companion candidate replay tests\x1b[0m\n');

const dir = mkdtempSync(join(tmpdir(), 'mio-companion-candidate-replay-'));
const file = join(dir, 'candidates.json');
const candidates = [
  candidate({ id: 'mined-a', confidence: 0.95 }),
  candidate({ id: 'mined-b', source: 'transcript_scan', confidence: 0.6, taxonomy: 'identity_or_model_leak' }),
];
writeFileSync(file, JSON.stringify({ candidates }, null, 2), 'utf-8');

const loaded = loadCandidateReplayFile(file);
ok(loaded.length === 2, 'loads candidate summary file', `count=${loaded.length}`);
ok(loaded[0]?.id === 'mined-a', 'preserves candidate order');

const highConfidence = selectReplayCandidates(loaded, { minConfidence: 0.9, requireReviewed: false });
ok(highConfidence.length === 1 && highConfidence[0]?.id === 'mined-a', 'filters by confidence threshold');

const reviewedOnly = selectReplayCandidates(loaded, { minConfidence: 0, requireReviewed: true });
ok(reviewedOnly.every((item) => item.source === 'reply_intervention'), 'requireReviewed keeps intervention-backed candidates only');

const passingFailures = evaluateCandidateReplies(candidates[0], ['你回来啦']);
ok(passingFailures.length === 0, 'passes when forbidden text is absent');

const failingFailures = evaluateCandidateReplies(candidates[0], ['哟，你还真不回我了？哼']);
ok(failingFailures.length === 2, 'fails on every forbidden text hit', failingFailures.join(' | '));
ok(failingFailures.some((failure) => failure.includes('不回我')), 'failure names forbidden text');

const expectedCandidate = candidate({
  checks: [{ name: 'must stay warm', forbiddenText: [], expectedText: ['回来啦'] }],
});
ok(evaluateCandidateReplies(expectedCandidate, ['你回来啦']).length === 0, 'passes expected text check');
ok(evaluateCandidateReplies(expectedCandidate, ['嗯']).some((failure) => failure.includes('missing text')), 'fails missing expected text');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} companion candidate replay tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} companion candidate replay tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
