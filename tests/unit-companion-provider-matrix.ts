import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildProviderMatrixSteps,
  parseProviderMatrixArgs,
  providerResultDir,
  summarizeProviderMatrix,
} from '../eval/companion-provider-matrix.ts';

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

console.log('\x1b[1mMio — companion provider matrix tests\x1b[0m\n');

const dir = mkdtempSync(join(tmpdir(), 'mio-provider-matrix-'));
const args = parseProviderMatrixArgs([
  `--result-dir=${dir}`,
  '--providers=mock,deepseek',
  '--models=deepseek:deepseek-chat',
  '--skip-build',
  '--',
  '--actor-max-candidates=1',
  '--persona-max-candidates=2',
  '--mined-limit=3',
]);

ok(args.targets.length === 2, 'parses provider list', `targets=${args.targets.map((target) => target.provider).join(',')}`);
ok(args.targets[1]?.model === 'deepseek-chat', 'parses provider model mapping', args.targets[1]?.model);
ok(args.loopArgs.includes('--actor-max-candidates=1'), 'forwards loop args after separator');

const steps = buildProviderMatrixSteps(args);
ok(steps.length === 2, 'skip-build creates one companion-loop step per provider', `steps=${steps.map((step) => step.id).join(',')}`);
ok(steps[0]?.command.includes('eval/companion-loop.ts'), 'matrix step calls companion-loop');
ok(steps[0]?.command.includes('--skip-build'), 'provider loop skips nested build');
ok(steps[0]?.command.includes('--provider=mock'), 'mock provider is forwarded');
ok(steps[1]?.command.includes('--provider=deepseek'), 'real provider is forwarded');
ok(steps[1]?.command.includes('--model=deepseek-chat'), 'model override is forwarded');
ok(steps[1]?.command.includes('--persona-max-candidates=2'), 'loop args are forwarded to each provider');

const buildArgs = parseProviderMatrixArgs([`--result-dir=${dir}`, '--providers=mock']);
const buildSteps = buildProviderMatrixSteps(buildArgs);
ok(buildSteps[0]?.id === 'build', 'matrix builds once by default');
ok(buildSteps.length === 2, 'default build plus one provider step');

const mockDir = providerResultDir(dir, { provider: 'mock' });
const deepseekDir = providerResultDir(dir, { provider: 'deepseek', model: 'deepseek-chat' });
mkdirSync(mockDir, { recursive: true });
mkdirSync(deepseekDir, { recursive: true });
writeFileSync(join(mockDir, 'summary.json'), JSON.stringify({
  ok: true,
  totals: { total: 6, passed: 6, failed: 0, skipped: 0 },
  qualityGate: { failed: 0 },
  scriptedGates: {
    redteam: { total: 13, passed: 13, failed: 0, skipped: 0 },
    wechatReplay: { total: 3, passed: 3, failed: 0, skipped: 0 },
  },
  judgeMetrics: { llmJudgeCalls: 0, invalidLlmJudgeCalls: 0 },
  promptAudit: { totalMods: 2, errors: 0, warnings: 0, info: 4 },
  replyRubric: { totalReplies: 98, passed: 98, failed: 0, goodFailed: 0, badMissed: 0 },
  failedRouteTags: {},
}), 'utf-8');
writeFileSync(join(deepseekDir, 'summary.json'), JSON.stringify({
  ok: false,
  totals: { total: 6, passed: 5, failed: 1, skipped: 0 },
  qualityGate: { failed: 0 },
  scriptedGates: {
    redteam: { total: 13, passed: 12, failed: 1, skipped: 0 },
  },
  judgeMetrics: { llmJudgeCalls: 2, invalidLlmJudgeCalls: 0 },
  promptAudit: { totalMods: 2, errors: 1, warnings: 2, info: 4 },
  replyRubric: { totalReplies: 98, passed: 96, failed: 2, goodFailed: 1, badMissed: 1 },
  failedRouteTags: { offline_life: 1 },
}), 'utf-8');

const summary = summarizeProviderMatrix(args, [
  {
    id: 'provider_mock',
    label: 'Run companion loop for mock',
    command: 'node eval/companion-loop.ts --provider=mock',
    exitCode: 0,
    ok: true,
    stdout: '',
    stderr: '',
    durationMs: 10,
    target: { provider: 'mock' },
  },
  {
    id: 'provider_deepseek-deepseek-chat',
    label: 'Run companion loop for deepseek/deepseek-chat',
    command: 'node eval/companion-loop.ts --provider=deepseek --model=deepseek-chat',
    exitCode: 0,
    ok: true,
    stdout: '',
    stderr: '',
    durationMs: 11,
    target: { provider: 'deepseek', model: 'deepseek-chat' },
  },
]);

ok(summary.ok === false, 'matrix fails when any provider summary fails');
ok(summary.totals.total === 12, 'matrix aggregates replay totals', `total=${summary.totals.total}`);
ok(summary.totals.failed === 1, 'matrix aggregates replay failures', `failed=${summary.totals.failed}`);
ok(summary.providers[1]?.scriptedFailed === 1, 'matrix reads scripted failures per provider');
ok(summary.providers[0]?.promptAuditInfo === 4, 'matrix reads prompt audit info per provider', `info=${summary.providers[0]?.promptAuditInfo}`);
ok(summary.providers[1]?.promptAuditErrors === 1, 'matrix reads prompt audit errors per provider', `errors=${summary.providers[1]?.promptAuditErrors}`);
ok(summary.providers[1]?.replyRubricFailed === 2, 'matrix reads reply rubric failures per provider', `failed=${summary.providers[1]?.replyRubricFailed}`);
ok(summary.providers[1]?.replyRubricGoodFailed === 1, 'matrix reads reply rubric good-failed count per provider', `goodFailed=${summary.providers[1]?.replyRubricGoodFailed}`);
ok(summary.providers[1]?.replyRubricBadMissed === 1, 'matrix reads reply rubric bad-missed count per provider', `badMissed=${summary.providers[1]?.replyRubricBadMissed}`);
ok(summary.providers[1]?.qualityGateSummaryPath === join(deepseekDir, 'quality-gate', 'quality-summary.json'), 'matrix records provider quality-gate summary path', summary.providers[1]?.qualityGateSummaryPath);
ok(summary.providers[1]?.qualityGateReportPath === join(deepseekDir, 'quality-gate', 'quality-report.md'), 'matrix records provider quality-gate report path', summary.providers[1]?.qualityGateReportPath);
ok(summary.promptAudit.errors === 1, 'matrix aggregates prompt audit errors', `errors=${summary.promptAudit.errors}`);
ok(summary.promptAudit.warnings === 2, 'matrix aggregates prompt audit warnings', `warnings=${summary.promptAudit.warnings}`);
ok(summary.promptAudit.info === 8, 'matrix aggregates prompt audit info', `info=${summary.promptAudit.info}`);
ok(summary.replyRubric.failed === 2, 'matrix aggregates reply rubric failures', `failed=${summary.replyRubric.failed}`);
ok(summary.replyRubric.goodFailed === 1, 'matrix aggregates reply rubric good-failed count', `goodFailed=${summary.replyRubric.goodFailed}`);
ok(summary.replyRubric.badMissed === 1, 'matrix aggregates reply rubric bad-missed count', `badMissed=${summary.replyRubric.badMissed}`);
ok(summary.providers[1]?.llmJudgeCalls === 2, 'matrix reads judge calls per provider');
ok(summary.providers[1]?.failedRouteTags.offline_life === 1, 'matrix preserves failed route tags per provider');

const promptAuditOnlyFailDir = mkdtempSync(join(tmpdir(), 'mio-provider-matrix-prompt-audit-'));
const promptAuditOnlyProviderDir = providerResultDir(promptAuditOnlyFailDir, { provider: 'mock' });
mkdirSync(promptAuditOnlyProviderDir, { recursive: true });
writeFileSync(join(promptAuditOnlyProviderDir, 'summary.json'), JSON.stringify({
  ok: true,
  totals: { total: 0, passed: 0, failed: 0, skipped: 0 },
  qualityGate: { failed: 0 },
  scriptedGates: {},
  judgeMetrics: { llmJudgeCalls: 0, invalidLlmJudgeCalls: 0 },
  promptAudit: { totalMods: 2, errors: 1, warnings: 0, info: 0 },
  replyRubric: { totalReplies: 98, passed: 98, failed: 0, goodFailed: 0, badMissed: 0 },
  failedRouteTags: {},
}), 'utf-8');
const promptAuditOnlySummary = summarizeProviderMatrix({
  resultDir: promptAuditOnlyFailDir,
  targets: [{ provider: 'mock' }],
  skipBuild: true,
  loopArgs: [],
}, [
  {
    id: 'provider_mock',
    label: 'Run companion loop for mock',
    command: 'node eval/companion-loop.ts --provider=mock',
    exitCode: 0,
    ok: true,
    stdout: '',
    stderr: '',
    durationMs: 10,
    target: { provider: 'mock' },
  },
]);
ok(promptAuditOnlySummary.ok === false, 'matrix fails when provider summary has prompt audit hard errors');
ok(promptAuditOnlySummary.providers[0]?.ok === false, 'provider is failed by prompt audit hard errors');

const replyRubricOnlyFailDir = mkdtempSync(join(tmpdir(), 'mio-provider-matrix-reply-rubric-'));
const replyRubricOnlyProviderDir = providerResultDir(replyRubricOnlyFailDir, { provider: 'mock' });
mkdirSync(replyRubricOnlyProviderDir, { recursive: true });
writeFileSync(join(replyRubricOnlyProviderDir, 'summary.json'), JSON.stringify({
  ok: true,
  totals: { total: 0, passed: 0, failed: 0, skipped: 0 },
  qualityGate: { failed: 0 },
  scriptedGates: {},
  judgeMetrics: { llmJudgeCalls: 0, invalidLlmJudgeCalls: 0 },
  promptAudit: { totalMods: 2, errors: 0, warnings: 0, info: 0 },
  replyRubric: { totalReplies: 98, passed: 97, failed: 1, goodFailed: 0, badMissed: 1 },
  failedRouteTags: {},
}), 'utf-8');
const replyRubricOnlySummary = summarizeProviderMatrix({
  resultDir: replyRubricOnlyFailDir,
  targets: [{ provider: 'mock' }],
  skipBuild: true,
  loopArgs: [],
}, [
  {
    id: 'provider_mock',
    label: 'Run companion loop for mock',
    command: 'node eval/companion-loop.ts --provider=mock',
    exitCode: 0,
    ok: true,
    stdout: '',
    stderr: '',
    durationMs: 10,
    target: { provider: 'mock' },
  },
]);
ok(replyRubricOnlySummary.ok === false, 'matrix fails when provider summary has reply rubric failures');
ok(replyRubricOnlySummary.providers[0]?.ok === false, 'provider is failed by reply rubric failures');
ok(replyRubricOnlySummary.replyRubric.badMissed === 1, 'matrix preserves reply rubric missed bad count');

const missingSummary = summarizeProviderMatrix({
  resultDir: dir,
  targets: [{ provider: 'openai', model: 'gpt-4o' }],
  skipBuild: true,
  loopArgs: [],
}, []);
ok(missingSummary.ok === false, 'matrix fails missing provider summary');
ok(missingSummary.providers[0]?.missingSummary === true, 'missing summary is explicit');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} companion provider matrix tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} companion provider matrix tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
