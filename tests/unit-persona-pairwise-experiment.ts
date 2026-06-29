import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultPairwiseReplySets,
  judgePairwiseLocally,
  loadPairwiseReplySet,
  runPairwiseExperiment,
  scorePersonaCaseReply,
} from '../eval/persona-pairwise-experiment.ts';
import { selectPersonaCases } from '../eval/persona-case-repository.ts';

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

console.log('\x1b[1mMio — persona pairwise experiment tests\x1b[0m\n');

const cases = selectPersonaCases({ maxCases: 3 });
const sets = defaultPairwiseReplySets(cases, 'bad-baseline', 'good-candidate');

ok(cases.length === 3, 'loads selected persona cases', `cases=${cases.length}`);
ok(Object.keys(sets.baseline.replies).length === cases.length, 'default baseline replies cover selected cases');
ok(Object.keys(sets.candidate.replies).length === cases.length, 'default candidate replies cover selected cases');

const first = cases[0];
if (!first) throw new Error('missing first case');
const goodScore = scorePersonaCaseReply(first, first.goodReplies[0] ?? '');
const badScore = scorePersonaCaseReply(first, first.badReplies[0] ?? '');
ok(goodScore.score > badScore.score, 'local score prefers good reply over bad reply', `good=${goodScore.score}, bad=${badScore.score}`);

const baselineFirst = judgePairwiseLocally({
  personaCase: first,
  replyA: first.badReplies[0] ?? '',
  replyB: first.goodReplies[0] ?? '',
  order: 'baseline_first',
});
const candidateFirst = judgePairwiseLocally({
  personaCase: first,
  replyA: first.goodReplies[0] ?? '',
  replyB: first.badReplies[0] ?? '',
  order: 'candidate_first',
});
ok(baselineFirst.winner === 'b', 'baseline-first ballot chooses candidate position');
ok(candidateFirst.winner === 'a', 'candidate-first ballot chooses candidate position after swap');

const summary = await runPairwiseExperiment({
  cases,
  baseline: sets.baseline,
  candidate: sets.candidate,
});
ok(summary.total === cases.length, 'summary includes every case');
ok(summary.candidateWins === cases.length, 'candidate wins all default good-vs-bad cases', `candidate=${summary.candidateWins}`);
ok(summary.baselineWins === 0, 'baseline has no wins in default good-vs-bad cases');
ok(summary.unstable === 0, 'position-swapped local judge is stable');
ok(summary.positionConsistent === cases.length, 'all cases are position-consistent');

const filteredCases = selectPersonaCases({ categories: ['possessive_style'] });
const filteredSets = defaultPairwiseReplySets(filteredCases);
const filteredSummary = await runPairwiseExperiment({
  cases: filteredCases,
  baseline: filteredSets.baseline,
  candidate: filteredSets.candidate,
});
ok(
  filteredSummary.total === filteredCases.length
    && filteredSummary.total >= 1
    && filteredCases.every((item) => item.labels.includes('possessive_style'))
    && filteredSummary.results.some((item) => item.caseId === 'consented-possessive-without-control'),
  'can run a label-filtered experiment',
  `total=${filteredSummary.total}`,
);

const dir = mkdtempSync(join(tmpdir(), 'mio-pairwise-'));
const replyPath = join(dir, 'replies.json');
writeFileSync(replyPath, JSON.stringify({
  label: 'custom',
  replies: { [first.id]: '嗯，我在。' },
}), 'utf-8');
const loaded = loadPairwiseReplySet(replyPath, 'fallback');
ok(loaded.label === 'custom', 'loads reply set label from file');
ok(loaded.replies[first.id] === '嗯，我在。', 'loads replies from file');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} persona pairwise experiment tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} persona pairwise experiment tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
