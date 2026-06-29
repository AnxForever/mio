import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadCandidateFile,
  loadRegressionStore,
  patchRegressionCandidate,
  promoteRegressionCandidates,
  writeRegressionStore,
} from '../eval/companion-regression-store.ts';
import type { MinedRegressionCandidate } from '../eval/companion-failure-miner.ts';

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

function candidate(id: string, patch: Partial<MinedRegressionCandidate> = {}): MinedRegressionCandidate {
  return {
    id,
    source: 'transcript_scan',
    taxonomy: 'temporal_drift',
    sessionId: `openai-regression-${id}`,
    observedAt: '2026-06-28T10:00:00.000Z',
    confidence: 0.9,
    routeTags: ['temporal_state'],
    reason: 'unit candidate',
    seed: [
      { timestamp: '2026-06-28T09:00:00.000Z', role: 'user', content: '昨晚困了' },
    ],
    turns: ['下午好'],
    checks: [{ name: 'avoid stale state', forbiddenText: ['还困'], expectedText: [] }],
    provenance: { excerpt: 'Mio: 你不是还困吗' },
    ...patch,
  };
}

console.log('\x1b[1mMio — companion regression store tests\x1b[0m\n');

const dir = mkdtempSync(join(tmpdir(), 'mio-companion-regression-store-'));
mkdirSync(dir, { recursive: true });
const candidatesPath = join(dir, 'candidates.json');
const storePath = join(dir, 'store.json');

const inputCandidates = [
  candidate('mined-a'),
  candidate('mined-b', { taxonomy: 'unsupported_offline_life', confidence: 0.72, routeTags: ['offline_life'] }),
  candidate('mined-low', { confidence: 0.2 }),
];
writeFileSync(candidatesPath, JSON.stringify({ candidates: inputCandidates }, null, 2), 'utf-8');

const loaded = loadCandidateFile(candidatesPath);
ok(loaded.length === 3, 'loads mined candidates from candidates.json', `count=${loaded.length}`);

const first = promoteRegressionCandidates({ version: 1, updatedAt: '', candidates: [] }, loaded, {
  minConfidence: 0.7,
  reviewer: 'unit-reviewer',
  note: 'accepted by test',
  now: '2026-06-29T00:00:00.000Z',
});
ok(first.promoted.length === 2, 'promotes candidates above confidence threshold', `promoted=${first.promoted.length}`);
ok(first.store.candidates.every((item) => item.reviewed === true), 'promoted candidates are marked reviewed');
ok(first.store.candidates.every((item) => item.review.reviewer === 'unit-reviewer'), 'promoted candidates record reviewer');
ok(first.store.candidates.every((item) => item.review.note === 'accepted by test'), 'promoted candidates record review note');
ok(first.store.candidates.some((item) => item.taxonomy === 'unsupported_offline_life'), 'promotion keeps taxonomy and route-sensitive cases');

const second = promoteRegressionCandidates(first.store, [candidate('mined-a', { confidence: 1 })], {
  ids: new Set(['mined-a']),
  reviewer: 'second-reviewer',
  now: '2026-06-30T00:00:00.000Z',
});
ok(second.store.candidates.length === 2, 're-promoting same id replaces instead of duplicating', `total=${second.store.candidates.length}`);
ok(second.store.candidates.find((item) => item.id === 'mined-a')?.review.reviewer === 'second-reviewer', 'duplicate promotion updates review metadata');
ok(second.store.candidates.every((item) => item.enabled === true), 'promoted candidates default to enabled');

const disabled = patchRegressionCandidate(second.store, 'mined-a', {
  enabled: false,
  reviewer: 'unit-reviewer',
  note: 'temporarily noisy',
  now: '2026-07-01T00:00:00.000Z',
});
ok(disabled.candidate?.enabled === false, 'patch can disable reviewed regression candidate');
ok(disabled.candidate?.governance?.updatedBy === 'unit-reviewer', 'patch records governance reviewer');
ok(disabled.candidate?.governance?.note === 'temporarily noisy', 'patch records governance note');

const enabled = patchRegressionCandidate(disabled.store, 'mined-a', {
  enabled: true,
  reviewer: 'unit-reviewer',
  now: '2026-07-02T00:00:00.000Z',
});
ok(enabled.candidate?.enabled === true, 'patch can re-enable reviewed regression candidate');

writeRegressionStore(storePath, enabled.store);
const reloaded = loadRegressionStore(storePath);
ok(reloaded.candidates.length === 2, 'writes and reloads regression store');
ok(reloaded.candidates[0]?.reviewed === true, 'reloaded store preserves reviewed flag');
ok(reloaded.candidates.some((item) => item.id === 'mined-a' && item.enabled === true), 'reloaded store preserves enabled flag');

const taxonomyOnly = promoteRegressionCandidates({ version: 1, updatedAt: '', candidates: [] }, loaded, {
  taxonomies: new Set(['unsupported_offline_life']),
  reviewer: 'taxonomy-reviewer',
  now: '2026-06-29T00:00:00.000Z',
});
ok(taxonomyOnly.promoted.length === 1 && taxonomyOnly.promoted[0]?.id === 'mined-b', 'taxonomy filter promotes only matching failures');

const defaultStore = loadRegressionStore(join(process.cwd(), 'eval', 'scenarios', 'companion-regression-cases.json'));
const defaultTaxonomies = new Set(defaultStore.candidates.map((item) => item.taxonomy));
ok(defaultStore.candidates.length >= 6, 'default regression store seeds core companion failures', `count=${defaultStore.candidates.length}`);
ok(defaultStore.candidates.every((item) => item.reviewed === true), 'default regression store contains only reviewed cases');
ok(defaultStore.candidates.every((item) => item.review.sourceCandidateId === item.id), 'default regression cases keep source candidate ids');
ok(defaultTaxonomies.has('bad_proactive_or_reopened_chat_blame'), 'default regressions cover no-interrupt blame');
ok(defaultTaxonomies.has('temporal_drift'), 'default regressions cover stale time state');
ok(defaultTaxonomies.has('coercive_or_interrogative_possessiveness'), 'default regressions cover consented possessive boundary');
ok(defaultTaxonomies.has('unsupported_offline_life'), 'default regressions cover own-life fabrication');
ok(defaultTaxonomies.has('service_or_checklist_tone'), 'default regressions cover service/checklist tone');
ok(defaultTaxonomies.has('identity_or_model_leak'), 'default regressions cover model identity leaks');
ok(defaultTaxonomies.has('proactive_curiosity_hook'), 'default regressions cover proactive curiosity hooks');
const phoneWaitingDefault = defaultStore.candidates.find((item) => item.id === 'persona-case-proactive-without-phone-waiting-arc');
ok(phoneWaitingDefault?.reviewed === true, 'default regressions cover proactive phone-waiting arc');
ok(phoneWaitingDefault?.routeTags.includes('offline_life') === true, 'phone-waiting regression keeps offline-life route tag');
ok(phoneWaitingDefault?.checks.some((check) => check.forbiddenText.includes('刷会儿手机等你')) === true, 'phone-waiting regression forbids concrete own-activity waiting text');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} companion regression store tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} companion regression store tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
