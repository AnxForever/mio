import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCompanionLoopSteps,
  summarizeCompanionLoop,
} from '../eval/companion-loop.ts';

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

console.log('\x1b[1mMio — companion eval loop tests\x1b[0m\n');

const dir = mkdtempSync(join(tmpdir(), 'mio-companion-loop-'));
const steps = buildCompanionLoopSteps({
  resultDir: dir,
  provider: 'mock',
  actorCountPerActor: 1,
  actorMaxCandidates: 3,
  personaMaxCandidates: 2,
  pairwiseMaxCases: 5,
  minedLimit: 4,
  minedMaxCandidates: 2,
  minConfidence: 0.7,
  regressionStorePath: join(dir, 'missing-regressions.json'),
  skipBuild: true,
  skipQualityGate: false,
  skipRedteam: false,
  skipReplay: false,
  skipActors: false,
  skipPersonaCases: false,
  skipPairwise: false,
  skipMining: false,
});

ok(steps.length === 13, 'builds prompt audit + quality gate + reply rubric + scripted gates + actor + persona case + pairwise + mining loop without build step', `steps=${steps.map((step) => step.id).join(',')}`);
ok(steps[0]?.id === 'persona_prompt_audit_female', 'first step audits female compiled prompt layers');
ok(steps[1]?.id === 'persona_prompt_audit_male', 'second step audits male compiled prompt layers');
ok(steps[0]?.required === false, 'prompt audit failures do not block later evidence collection');
ok(steps[2]?.id === 'quality_gate', 'third step runs deterministic quality gate');
ok(steps[2]?.command.includes('--providers=mock'), 'quality gate is scoped to selected provider');
ok(steps[2]?.required === false, 'quality gate failures do not block later loop steps');
ok(steps[3]?.id === 'reply_rubric', 'fourth step runs reply logic and human-likeness rubric');
ok(steps[3]?.required === false, 'reply rubric failures do not block later loop steps');
ok(steps[4]?.id === 'redteam', 'fifth step runs scripted redteam probes');
ok(steps[4]?.required === false, 'redteam failures do not block later loop steps');
ok(steps[5]?.id === 'wechat_replay', 'sixth step runs timestamped WeChat replay probes');
ok(steps[5]?.required === false, 'WeChat replay failures do not block later loop steps');
ok(steps[6]?.id === 'actor_generate', 'seventh step generates actor candidates');
ok(steps.some((step) => step.id === 'actor_replay' && step.command.includes('--max-candidates=3')), 'actor replay uses max candidate limit');
ok(steps.some((step) => step.id === 'persona_case_generate'), 'loop generates persona case candidates');
ok(steps.some((step) => step.id === 'persona_case_replay' && step.command.includes('--max-candidates=2')), 'persona case replay uses max candidate limit');
ok(steps.some((step) => step.id === 'persona_pairwise' && step.command.includes('--max-cases=5')), 'loop runs pairwise experiment with max case limit');
ok(steps.some((step) => step.id === 'persona_pairwise' && step.command.includes('--judge-provider=mock')), 'pairwise experiment uses deterministic mock judge inside loop');
ok(steps.some((step) => step.id === 'mine_failures' && step.command.includes('--limit=4')), 'failure miner uses mined limit');
ok(steps.some((step) => step.id === 'mined_replay' && step.command.includes('--min-confidence=0.7')), 'candidate replay uses confidence threshold');

const buildSteps = buildCompanionLoopSteps({
  resultDir: dir,
  provider: 'mock',
  actorCountPerActor: 1,
  minedLimit: 1,
  minConfidence: 0,
  skipBuild: false,
  skipQualityGate: true,
  skipRedteam: true,
  skipReplay: true,
  skipPromptAudit: true,
  skipReplyRubric: true,
  skipActors: true,
  skipPersonaCases: true,
  skipPairwise: true,
  skipMining: true,
  skipStoredRegressions: true,
});
ok(buildSteps.length === 1 && buildSteps[0]?.id === 'build', 'skip flags can leave build-only plan');

const regressionStorePath = join(dir, 'reviewed-regressions.json');
writeFileSync(regressionStorePath, JSON.stringify({
  version: 1,
  updatedAt: '2026-06-29T00:00:00.000Z',
  candidates: [{
    id: 'reviewed-regression-1',
    source: 'transcript_scan',
    taxonomy: 'temporal_drift',
    sessionId: 'openai-reviewed-regression',
    observedAt: '2026-06-28T10:00:00.000Z',
    confidence: 0.91,
    reviewed: true,
    review: {
      reviewedAt: '2026-06-29T00:00:00.000Z',
      reviewer: 'unit',
      sourceCandidateId: 'reviewed-regression-1',
    },
    routeTags: ['temporal_state'],
    reason: 'reviewed regression',
    seed: [],
    turns: ['下午好'],
    checks: [{ name: 'avoid stale state', forbiddenText: ['还困'], expectedText: [] }],
    provenance: { excerpt: 'Mio: 你不是还困吗' },
  }],
}), 'utf-8');
const storedRegressionSteps = buildCompanionLoopSteps({
  resultDir: dir,
  provider: 'mock',
  actorCountPerActor: 1,
  minedLimit: 1,
  minConfidence: 0,
  skipBuild: true,
  skipQualityGate: true,
  skipRedteam: true,
  skipReplay: true,
  skipPromptAudit: true,
  skipReplyRubric: true,
  skipActors: true,
  skipPersonaCases: true,
  skipPairwise: true,
  skipMining: true,
  skipStoredRegressions: false,
  regressionStorePath,
});
ok(storedRegressionSteps.length === 1 && storedRegressionSteps[0]?.id === 'stored_regression_replay', 'loop replays reviewed regression store when present');
ok(storedRegressionSteps[0]?.command.includes('--require-reviewed'), 'stored regression replay requires reviewed candidates');

const disabledRegressionStorePath = join(dir, 'disabled-regressions.json');
writeFileSync(disabledRegressionStorePath, JSON.stringify({
  version: 1,
  updatedAt: '2026-06-29T00:00:00.000Z',
  candidates: [{
    id: 'disabled-reviewed-regression-1',
    source: 'transcript_scan',
    taxonomy: 'temporal_drift',
    sessionId: 'openai-disabled-reviewed-regression',
    observedAt: '2026-06-28T10:00:00.000Z',
    confidence: 0.91,
    reviewed: true,
    enabled: false,
    review: {
      reviewedAt: '2026-06-29T00:00:00.000Z',
      reviewer: 'unit',
      sourceCandidateId: 'disabled-reviewed-regression-1',
    },
    routeTags: ['temporal_state'],
    reason: 'disabled reviewed regression',
    seed: [],
    turns: ['下午好'],
    checks: [{ name: 'avoid stale state', forbiddenText: ['还困'], expectedText: [] }],
    provenance: { excerpt: 'Mio: 你不是还困吗' },
  }],
}), 'utf-8');
const disabledRegressionSteps = buildCompanionLoopSteps({
  resultDir: dir,
  provider: 'mock',
  actorCountPerActor: 1,
  minedLimit: 1,
  minConfidence: 0,
  skipBuild: true,
  skipQualityGate: true,
  skipRedteam: true,
  skipReplay: true,
  skipPromptAudit: true,
  skipReplyRubric: true,
  skipActors: true,
  skipPersonaCases: true,
  skipPairwise: true,
  skipMining: true,
  skipStoredRegressions: false,
  regressionStorePath: disabledRegressionStorePath,
});
ok(disabledRegressionSteps.length === 0, 'loop skips stored regression replay when all reviewed cases are disabled');

mkdirSync(join(dir, 'actor-replay'), { recursive: true });
mkdirSync(join(dir, 'persona-case-replay'), { recursive: true });
mkdirSync(join(dir, 'persona-prompt-audit', 'female'), { recursive: true });
mkdirSync(join(dir, 'persona-prompt-audit', 'male'), { recursive: true });
mkdirSync(join(dir, 'persona-pairwise'), { recursive: true });
mkdirSync(join(dir, 'mined-replay'), { recursive: true });
mkdirSync(join(dir, 'stored-regression-replay'), { recursive: true });
mkdirSync(join(dir, 'quality-gate'), { recursive: true });
mkdirSync(join(dir, 'reply-rubric'), { recursive: true });
mkdirSync(join(dir, 'redteam'), { recursive: true });
mkdirSync(join(dir, 'wechat-replay'), { recursive: true });
writeFileSync(join(dir, 'quality-gate', 'quality-summary.json'), JSON.stringify({
  total: 18,
  runnable: 18,
  skipped: 0,
  passed: 18,
  averageScore: 1,
}), 'utf-8');
writeFileSync(join(dir, 'reply-rubric', 'summary.json'), JSON.stringify({
  totalCases: 44,
  totalReplies: 88,
  passed: 88,
  failed: 0,
  goodReplies: 44,
  goodFailed: 0,
  badReplies: 44,
  badMissed: 0,
  averageScore: 0.81,
  findingsByDimension: { reply_logic: 8, human_likeness: 7 },
  findingsByCode: { stale_transient_state: 3, waiting_or_silence_blame: 2 },
}), 'utf-8');
writeFileSync(join(dir, 'persona-prompt-audit', 'female', 'summary.json'), JSON.stringify({
  mod: 'female',
  promptChars: 4900,
  issues: [
    { severity: 'warn', code: 'blame_rule_before_no_interrupt_rule' },
    { severity: 'info', code: 'service_tone_marker' },
  ],
  summary: {
    errors: 0,
    warnings: 1,
    info: 1,
  },
}), 'utf-8');
writeFileSync(join(dir, 'persona-prompt-audit', 'male', 'summary.json'), JSON.stringify({
  mod: 'male',
  promptChars: 4700,
  issues: [
    { severity: 'warn', code: 'transient_marker_in_persona' },
  ],
  summary: {
    errors: 0,
    warnings: 1,
    info: 0,
  },
}), 'utf-8');
writeFileSync(join(dir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 3,
  passed: 3,
  failed: 0,
  skipped: 0,
  byRouteTag: { temporal_state: 2, proactive: 1 },
  failedByRouteTag: {},
  judgeMetrics: {
    interventions: 2,
    shouldUseLlmJudge: 1,
    llmJudgeCalls: 1,
    llmJudgeDurationMs: 120,
    maxLlmJudgeDurationMs: 120,
    llmRepairs: 0,
    deterministicRepairs: 1,
    invalidLlmJudgeCalls: 0,
    judgeCallsByRouteTag: { prompt_probe: 1 },
  },
}), 'utf-8');
writeFileSync(join(dir, 'persona-case-replay', 'summary.json'), JSON.stringify({
  total: 4,
  passed: 4,
  failed: 0,
  skipped: 0,
  byRouteTag: { prompt_probe: 2, intimacy_control: 1 },
  failedByRouteTag: {},
}), 'utf-8');
writeFileSync(join(dir, 'persona-pairwise', 'summary.json'), JSON.stringify({
  total: 4,
  baselineWins: 0,
  candidateWins: 4,
  ties: 0,
  unstable: 0,
  positionConsistent: 4,
  baselineLabel: 'bad-regression',
  candidateLabel: 'good-target',
  judgeProvider: 'mock',
}), 'utf-8');
writeFileSync(join(dir, 'mined-replay', 'summary.json'), JSON.stringify({
  total: 2,
  passed: 1,
  failed: 1,
  skipped: 0,
  byRouteTag: { offline_life: 1, temporal_state: 1 },
  failedByRouteTag: { offline_life: 1 },
}), 'utf-8');
writeFileSync(join(dir, 'stored-regression-replay', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
  byRouteTag: { temporal_state: 1 },
  failedByRouteTag: {},
}), 'utf-8');
writeFileSync(join(dir, 'redteam', 'summary.json'), JSON.stringify({
  total: 9,
  passed: 9,
  failed: 0,
  judgeMetrics: {
    interventions: 1,
    shouldUseLlmJudge: 1,
    llmJudgeCalls: 1,
    llmJudgeDurationMs: 80,
    maxLlmJudgeDurationMs: 80,
    llmRepairs: 1,
    deterministicRepairs: 0,
    invalidLlmJudgeCalls: 0,
    judgeCallsByRouteTag: { intimacy_control: 1 },
  },
}), 'utf-8');
writeFileSync(join(dir, 'wechat-replay', 'summary.json'), JSON.stringify({
  total: 3,
  passed: 3,
  failed: 0,
}), 'utf-8');

const summary = summarizeCompanionLoop(dir, [
  {
    id: 'actor_replay',
    label: 'Actor replay',
    command: 'node actor',
    exitCode: 0,
    ok: true,
    stdout: '',
    stderr: '',
    durationMs: 12,
  },
  {
    id: 'mined_replay',
    label: 'Mined replay',
    command: 'node mined',
    exitCode: 0,
    ok: true,
    stdout: '',
    stderr: '',
    durationMs: 14,
  },
]);

ok(summary.totals.total === 10, 'summary totals replayed candidates', `total=${summary.totals.total}`);
ok(summary.totals.passed === 9, 'summary totals passed candidates', `passed=${summary.totals.passed}`);
ok(summary.totals.failed === 1, 'summary totals failed candidates', `failed=${summary.totals.failed}`);
ok(summary.ok === false, 'summary fails when any replay gate failed');
ok(summary.qualityGate.runnable === 18, 'summary reads deterministic quality gate runnable count', `runnable=${summary.qualityGate.runnable}`);
ok(summary.qualityGate.failed === 0, 'summary reads deterministic quality gate as clean', `failed=${summary.qualityGate.failed}`);
ok(summary.replyRubric.totalReplies === 88, 'summary reads reply rubric total replies', `total=${summary.replyRubric.totalReplies}`);
ok(summary.replyRubric.failed === 0, 'summary reads reply rubric as clean', `failed=${summary.replyRubric.failed}`);
ok(summary.replyRubric.findingsByDimension?.reply_logic === 8, 'summary preserves reply rubric dimension counts', JSON.stringify(summary.replyRubric.findingsByDimension));
ok(summary.replyRubric.findingsByCode?.stale_transient_state === 3, 'summary preserves reply rubric finding codes', JSON.stringify(summary.replyRubric.findingsByCode));
ok(summary.scriptedGates.redteam?.total === 9, 'summary reads scripted redteam gate total', `total=${summary.scriptedGates.redteam?.total}`);
ok(summary.scriptedGates.wechatReplay?.passed === 3, 'summary reads WeChat replay gate passed count', `passed=${summary.scriptedGates.wechatReplay?.passed}`);
ok(summary.promptAudit.totalMods === 2, 'summary reads persona prompt audit mod count', `mods=${summary.promptAudit.totalMods}`);
ok(summary.promptAudit.errors === 0, 'summary reads prompt audit hard errors', `errors=${summary.promptAudit.errors}`);
ok(summary.promptAudit.warnings === 2, 'summary aggregates prompt audit warnings', `warnings=${summary.promptAudit.warnings}`);
ok(summary.promptAudit.mods.female?.issueCodes.includes('blame_rule_before_no_interrupt_rule') === true, 'summary preserves prompt audit issue codes', summary.promptAudit.mods.female?.issueCodes.join(','));
ok(summary.pairwiseExperiment.total === 4, 'summary reads pairwise experiment total', `total=${summary.pairwiseExperiment.total}`);
ok(summary.pairwiseExperiment.candidateWins === 4, 'summary reads pairwise candidate wins', `candidateWins=${summary.pairwiseExperiment.candidateWins}`);
ok(summary.pairwiseExperiment.baselineLabel === 'bad-regression', 'summary reads pairwise labels', summary.pairwiseExperiment.baselineLabel);
ok(summary.judgeMetrics.interventions === 3, 'summary aggregates judge/intervention metrics', JSON.stringify(summary.judgeMetrics));
ok(summary.judgeMetrics.llmJudgeCalls === 2, 'summary aggregates LLM judge calls', JSON.stringify(summary.judgeMetrics));
ok(summary.judgeMetrics.llmJudgeDurationMs === 200, 'summary aggregates LLM judge duration', JSON.stringify(summary.judgeMetrics));
ok(summary.judgeMetrics.maxLlmJudgeDurationMs === 120, 'summary aggregates max LLM judge duration', JSON.stringify(summary.judgeMetrics));
ok(summary.judgeMetrics.llmRepairs === 1, 'summary aggregates LLM repairs', JSON.stringify(summary.judgeMetrics));
ok(summary.judgeMetrics.deterministicRepairs === 1, 'summary aggregates deterministic repairs', JSON.stringify(summary.judgeMetrics));
ok(summary.judgeMetrics.judgeCallsByRouteTag.prompt_probe === 1, 'summary aggregates judge route tags from replay gates', JSON.stringify(summary.judgeMetrics.judgeCallsByRouteTag));
ok(summary.judgeMetrics.judgeCallsByRouteTag.intimacy_control === 1, 'summary aggregates judge route tags from scripted gates', JSON.stringify(summary.judgeMetrics.judgeCallsByRouteTag));
ok(summary.gates.storedRegressionReplay?.total === 1, 'summary reads stored regression replay gate', JSON.stringify(summary.gates.storedRegressionReplay));
ok(summary.routeTags.temporal_state === 4, 'summary aggregates route tags across replay gates', JSON.stringify(summary.routeTags));
ok(summary.routeTags.prompt_probe === 2, 'summary includes persona prompt-probe route tags', JSON.stringify(summary.routeTags));
ok(summary.failedRouteTags.offline_life === 1, 'summary aggregates failed route tags', JSON.stringify(summary.failedRouteTags));
ok(summary.recommendations.length === 1, 'summary creates route-specific recommendations');
ok(summary.recommendations[0]?.routeTag === 'offline_life', 'recommendation names failed route tag', summary.recommendations[0]?.routeTag);
ok(summary.recommendations[0]?.focus.includes('Own-life'), 'offline-life recommendation points at own-life grounding', summary.recommendations[0]?.focus);
ok(summary.criticCost.totalStepDurationMs === 26, 'summary aggregates total loop step duration', JSON.stringify(summary.criticCost));
ok(summary.criticCost.slowestStepId === 'mined_replay', 'summary reports slowest step id', JSON.stringify(summary.criticCost));
ok(summary.criticCost.evaluatedCases === 22, 'summary counts replay and scripted evaluated cases', JSON.stringify(summary.criticCost));
ok(summary.criticCost.estimatedExtraModelCalls === 2, 'summary estimates extra model calls from LLM judge calls', JSON.stringify(summary.criticCost));
ok(summary.criticCost.averageLlmJudgeDurationMs === 100, 'summary reports average LLM judge duration', JSON.stringify(summary.criticCost));
ok(summary.criticCost.maxLlmJudgeDurationMs === 120, 'summary reports max LLM judge duration', JSON.stringify(summary.criticCost));
ok(Math.abs(summary.criticCost.llmJudgeCallRate - (2 / 22)) < 0.000001, 'summary reports LLM judge call rate', JSON.stringify(summary.criticCost));

const cleanDir = mkdtempSync(join(tmpdir(), 'mio-companion-loop-clean-'));
mkdirSync(join(cleanDir, 'actor-replay'), { recursive: true });
writeFileSync(join(cleanDir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
}), 'utf-8');
mkdirSync(join(cleanDir, 'quality-gate'), { recursive: true });
writeFileSync(join(cleanDir, 'quality-gate', 'quality-summary.json'), JSON.stringify({
  total: 2,
  runnable: 2,
  skipped: 0,
  passed: 1,
  averageScore: 0.5,
}), 'utf-8');
const cleanSummary = summarizeCompanionLoop(cleanDir, []);
ok(cleanSummary.ok === false, 'summary fails when deterministic quality gate fails');
ok(cleanSummary.qualityGate.failed === 1, 'summary computes quality gate failures');

const scriptedFailDir = mkdtempSync(join(tmpdir(), 'mio-companion-loop-scripted-fail-'));
mkdirSync(join(scriptedFailDir, 'actor-replay'), { recursive: true });
mkdirSync(join(scriptedFailDir, 'quality-gate'), { recursive: true });
mkdirSync(join(scriptedFailDir, 'redteam'), { recursive: true });
writeFileSync(join(scriptedFailDir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
}), 'utf-8');
writeFileSync(join(scriptedFailDir, 'quality-gate', 'quality-summary.json'), JSON.stringify({
  total: 2,
  runnable: 2,
  skipped: 0,
  passed: 2,
  averageScore: 1,
}), 'utf-8');
writeFileSync(join(scriptedFailDir, 'redteam', 'summary.json'), JSON.stringify({
  total: 2,
  passed: 1,
  failed: 1,
}), 'utf-8');
const scriptedFailSummary = summarizeCompanionLoop(scriptedFailDir, []);
ok(scriptedFailSummary.ok === false, 'summary fails when scripted redteam gate fails');
ok(scriptedFailSummary.scriptedGates.redteam?.failed === 1, 'summary reads scripted redteam failures');

const invalidJudgeDir = mkdtempSync(join(tmpdir(), 'mio-companion-loop-invalid-judge-'));
mkdirSync(join(invalidJudgeDir, 'actor-replay'), { recursive: true });
mkdirSync(join(invalidJudgeDir, 'quality-gate'), { recursive: true });
writeFileSync(join(invalidJudgeDir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
  judgeMetrics: {
    interventions: 1,
    shouldUseLlmJudge: 0,
    llmJudgeCalls: 1,
    llmJudgeDurationMs: 10,
    maxLlmJudgeDurationMs: 10,
    llmRepairs: 0,
    deterministicRepairs: 0,
    invalidLlmJudgeCalls: 1,
    judgeCallsByRouteTag: { low_risk_casual: 1 },
  },
}), 'utf-8');
writeFileSync(join(invalidJudgeDir, 'quality-gate', 'quality-summary.json'), JSON.stringify({
  total: 1,
  runnable: 1,
  skipped: 0,
  passed: 1,
  averageScore: 1,
}), 'utf-8');
const invalidJudgeSummary = summarizeCompanionLoop(invalidJudgeDir, []);
ok(invalidJudgeSummary.ok === false, 'summary fails when LLM judge is called outside requested high-risk route');
ok(invalidJudgeSummary.judgeMetrics.invalidLlmJudgeCalls === 1, 'summary preserves invalid LLM judge call count');

const promptAuditFailDir = mkdtempSync(join(tmpdir(), 'mio-companion-loop-prompt-audit-fail-'));
mkdirSync(join(promptAuditFailDir, 'actor-replay'), { recursive: true });
mkdirSync(join(promptAuditFailDir, 'quality-gate'), { recursive: true });
mkdirSync(join(promptAuditFailDir, 'persona-prompt-audit', 'female'), { recursive: true });
writeFileSync(join(promptAuditFailDir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
}), 'utf-8');
writeFileSync(join(promptAuditFailDir, 'quality-gate', 'quality-summary.json'), JSON.stringify({
  total: 1,
  runnable: 1,
  skipped: 0,
  passed: 1,
  averageScore: 1,
}), 'utf-8');
writeFileSync(join(promptAuditFailDir, 'persona-prompt-audit', 'female', 'summary.json'), JSON.stringify({
  mod: 'female',
  promptChars: 1200,
  issues: [{ severity: 'error', code: 'critical_or_persona_trimmed' }],
  summary: {
    errors: 1,
    warnings: 0,
    info: 0,
  },
}), 'utf-8');
const promptAuditFailSummary = summarizeCompanionLoop(promptAuditFailDir, []);
ok(promptAuditFailSummary.ok === false, 'summary fails when prompt audit has hard errors');
ok(promptAuditFailSummary.promptAudit.errors === 1, 'summary preserves prompt audit error count', `errors=${promptAuditFailSummary.promptAudit.errors}`);

const allCleanDir = mkdtempSync(join(tmpdir(), 'mio-companion-loop-all-clean-'));
mkdirSync(join(allCleanDir, 'actor-replay'), { recursive: true });
mkdirSync(join(allCleanDir, 'quality-gate'), { recursive: true });
mkdirSync(join(allCleanDir, 'redteam'), { recursive: true });
mkdirSync(join(allCleanDir, 'wechat-replay'), { recursive: true });
writeFileSync(join(allCleanDir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
}), 'utf-8');
writeFileSync(join(allCleanDir, 'quality-gate', 'quality-summary.json'), JSON.stringify({
  total: 2,
  runnable: 2,
  skipped: 0,
  passed: 2,
  averageScore: 1,
}), 'utf-8');
writeFileSync(join(allCleanDir, 'redteam', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
}), 'utf-8');
writeFileSync(join(allCleanDir, 'wechat-replay', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
}), 'utf-8');
const allCleanSummary = summarizeCompanionLoop(allCleanDir, []);
ok(allCleanSummary.ok === true, 'summary passes when replay and quality gates pass');
ok(cleanSummary.recommendations.length === 0, 'clean summary has no route recommendations');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} companion eval loop tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} companion eval loop tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
