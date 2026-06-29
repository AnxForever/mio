#!/usr/bin/env node
/**
 * companion-loop.ts — orchestrate the companion automated chat test loop.
 *
 * Pipeline:
 *   1. Generate scenario-actor candidates.
 *   2. Replay scenario candidates through the production turn loop.
 *   3. Generate persona case repository candidates.
 *   4. Replay persona cases through the production turn loop.
 *   5. Run pairwise persona baseline-vs-candidate experiment.
 *   6. Mine real transcripts/intervention logs into regression candidates.
 *   7. Replay mined candidates.
 *   8. Run scripted redteam and WeChat replay gates.
 *   9. Write one summary/report for nightly or manual review.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CliArgs {
  resultDir: string;
  provider: string;
  model?: string;
  dataDir?: string;
  promptAuditMods?: string[];
  actorCountPerActor: number;
  actorMaxCandidates?: number;
  minedLimit: number;
  minedMaxCandidates?: number;
  personaMaxCandidates?: number;
  pairwiseMaxCases?: number;
  minConfidence: number;
  skipBuild: boolean;
  skipQualityGate: boolean;
  skipRedteam: boolean;
  skipReplay: boolean;
  skipPromptAudit?: boolean;
  skipReplyRubric?: boolean;
  skipActors: boolean;
  skipPersonaCases: boolean;
  skipPairwise: boolean;
  skipMining: boolean;
  skipStoredRegressions?: boolean;
  regressionStorePath?: string;
}

export interface LoopStep {
  id: string;
  label: string;
  command: string[];
  cwd: string;
  required: boolean;
}

interface StepResult {
  id: string;
  label: string;
  command: string;
  exitCode: number;
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface ReplaySummary {
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  byRouteTag?: Record<string, number>;
  failedByRouteTag?: Record<string, number>;
  judgeMetrics?: JudgeRoutingMetrics;
}

interface QualityGateSummary {
  total?: number;
  runnable?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  averageScore?: number;
}

interface ScriptedGateSummary {
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  judgeMetrics?: JudgeRoutingMetrics;
}

interface PairwiseSummary {
  total?: number;
  baselineWins?: number;
  candidateWins?: number;
  ties?: number;
  unstable?: number;
  positionConsistent?: number;
  baselineLabel?: string;
  candidateLabel?: string;
  judgeProvider?: string;
}

interface ReplyRubricLoopSummary {
  totalCases?: number;
  totalReplies?: number;
  passed?: number;
  failed?: number;
  goodReplies?: number;
  goodFailed?: number;
  badReplies?: number;
  badMissed?: number;
  averageScore?: number;
  findingsByDimension?: Record<string, number>;
  findingsByCode?: Record<string, number>;
}

interface PromptAuditLoopSummary {
  totalMods: number;
  errors: number;
  warnings: number;
  info: number;
  mods: Record<string, {
    errors: number;
    warnings: number;
    info: number;
    promptChars?: number;
    issueCodes: string[];
  }>;
}

interface JudgeRoutingMetrics {
  interventions: number;
  shouldUseLlmJudge: number;
  llmJudgeCalls: number;
  llmJudgeDurationMs: number;
  maxLlmJudgeDurationMs: number;
  llmRepairs: number;
  deterministicRepairs: number;
  invalidLlmJudgeCalls: number;
  judgeCallsByRouteTag: Record<string, number>;
}

interface CriticCostSummary {
  totalStepDurationMs: number;
  averageStepDurationMs: number;
  slowestStepId: string;
  slowestStepDurationMs: number;
  evaluatedCases: number;
  estimatedExtraModelCalls: number;
  llmJudgeCallRate: number;
  llmRepairRate: number;
  deterministicRepairRate: number;
  averageLlmJudgeDurationMs: number;
  maxLlmJudgeDurationMs: number;
}

export interface RouteRecommendation {
  routeTag: string;
  failed: number;
  total: number;
  priority: 'high' | 'medium';
  focus: string;
  nextAction: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(join(__dirname, '..'));
const DEFAULT_RESULT_DIR = join(__dirname, 'results', 'companion-loop');
const DEFAULT_REGRESSION_STORE_PATH = join(__dirname, 'scenarios', 'companion-regression-cases.json');

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    resultDir: DEFAULT_RESULT_DIR,
    provider: 'mock',
    actorCountPerActor: 1,
    minedLimit: 40,
    minConfidence: 0,
    skipBuild: false,
    skipQualityGate: false,
    skipRedteam: false,
    skipReplay: false,
    skipPromptAudit: false,
    skipReplyRubric: false,
    promptAuditMods: ['female', 'male'],
    skipActors: false,
    skipPersonaCases: false,
    skipPairwise: false,
    skipMining: false,
    skipStoredRegressions: false,
    regressionStorePath: DEFAULT_REGRESSION_STORE_PATH,
  };

  for (const arg of argv) {
    if (arg.startsWith('--result-dir=')) args.resultDir = resolve(arg.slice('--result-dir='.length));
    else if (arg.startsWith('--provider=')) args.provider = arg.slice('--provider='.length);
    else if (arg.startsWith('--model=')) args.model = arg.slice('--model='.length);
    else if (arg.startsWith('--data-dir=')) args.dataDir = resolve(arg.slice('--data-dir='.length));
    else if (arg.startsWith('--actor-count-per-actor=')) args.actorCountPerActor = Math.max(1, Number(arg.slice('--actor-count-per-actor='.length)) || 1);
    else if (arg.startsWith('--actor-max-candidates=')) args.actorMaxCandidates = Math.max(1, Number(arg.slice('--actor-max-candidates='.length)) || 1);
    else if (arg.startsWith('--persona-max-candidates=')) args.personaMaxCandidates = Math.max(1, Number(arg.slice('--persona-max-candidates='.length)) || 1);
    else if (arg.startsWith('--pairwise-max-cases=')) args.pairwiseMaxCases = Math.max(1, Number(arg.slice('--pairwise-max-cases='.length)) || 1);
    else if (arg.startsWith('--mined-limit=')) args.minedLimit = Math.max(1, Number(arg.slice('--mined-limit='.length)) || 1);
    else if (arg.startsWith('--mined-max-candidates=')) args.minedMaxCandidates = Math.max(1, Number(arg.slice('--mined-max-candidates='.length)) || 1);
    else if (arg.startsWith('--min-confidence=')) args.minConfidence = clamp01(Number(arg.slice('--min-confidence='.length)));
    else if (arg.startsWith('--prompt-audit-mod=')) {
      const mods = arg.slice('--prompt-audit-mod='.length).split(',').map((item) => item.trim()).filter(Boolean);
      if (mods.length > 0) args.promptAuditMods = mods;
    }
    else if (arg === '--skip-build') args.skipBuild = true;
    else if (arg === '--skip-quality-gate') args.skipQualityGate = true;
    else if (arg === '--skip-redteam') args.skipRedteam = true;
    else if (arg === '--skip-replay') args.skipReplay = true;
    else if (arg === '--skip-prompt-audit') args.skipPromptAudit = true;
    else if (arg === '--skip-reply-rubric') args.skipReplyRubric = true;
    else if (arg === '--skip-actors') args.skipActors = true;
    else if (arg === '--skip-persona-cases') args.skipPersonaCases = true;
    else if (arg === '--skip-pairwise') args.skipPairwise = true;
    else if (arg === '--skip-mining') args.skipMining = true;
    else if (arg === '--skip-stored-regressions') args.skipStoredRegressions = true;
    else if (arg.startsWith('--regression-store=')) args.regressionStorePath = resolve(arg.slice('--regression-store='.length));
  }

  return args;
}

export function buildCompanionLoopSteps(args: CliArgs): LoopStep[] {
  const node = process.execPath;
  const stripTypes = '--experimental-strip-types';
  const steps: LoopStep[] = [];
  const actorDir = join(args.resultDir, 'actors');
  const actorReplayDir = join(args.resultDir, 'actor-replay');
  const personaDir = join(args.resultDir, 'persona-cases');
  const personaReplayDir = join(args.resultDir, 'persona-case-replay');
  const pairwiseDir = join(args.resultDir, 'persona-pairwise');
  const minedDir = join(args.resultDir, 'mined');
  const minedReplayDir = join(args.resultDir, 'mined-replay');
  const storedReplayDir = join(args.resultDir, 'stored-regression-replay');
  const qualityGateDir = join(args.resultDir, 'quality-gate');
  const redteamDir = join(args.resultDir, 'redteam');
  const wechatReplayDir = join(args.resultDir, 'wechat-replay');
  const promptAuditDir = join(args.resultDir, 'persona-prompt-audit');
  const replyRubricDir = join(args.resultDir, 'reply-rubric');
  const providerArgs = ['--provider=' + args.provider, ...(args.model ? ['--model=' + args.model] : [])];

  if (!args.skipBuild) {
    steps.push({
      id: 'build',
      label: 'Build TypeScript output for production turn loop',
      command: ['npm', 'run', 'build'],
      cwd: REPO_ROOT,
      required: true,
    });
  }

  if (!args.skipPromptAudit) {
    for (const mod of args.promptAuditMods ?? ['female', 'male']) {
      steps.push({
        id: `persona_prompt_audit_${sanitizeStepId(mod)}`,
        label: `Audit compiled persona prompt layers for ${mod}`,
        command: [
          node,
          stripTypes,
          'eval/persona-prompt-audit.ts',
          `--mod=${mod}`,
          `--result-dir=${join(promptAuditDir, mod)}`,
        ],
        cwd: REPO_ROOT,
        required: false,
      });
    }
  }

  if (!args.skipQualityGate) {
    steps.push({
      id: 'quality_gate',
      label: 'Run deterministic companion quality gate',
      command: [
        node,
        stripTypes,
        'eval/quality-gate.ts',
        `--result-dir=${qualityGateDir}`,
        `--providers=${args.provider}`,
        ...(args.model ? [`--models=${args.provider}:${args.model}`] : []),
      ],
      cwd: REPO_ROOT,
      required: false,
    });
  }

  if (!args.skipReplyRubric) {
    steps.push({
      id: 'reply_rubric',
      label: 'Run deterministic reply logic and human-likeness rubric',
      command: [
        node,
        stripTypes,
        'eval/reply-rubric.ts',
        `--result-dir=${replyRubricDir}`,
      ],
      cwd: REPO_ROOT,
      required: false,
    });
  }

  if (!args.skipRedteam) {
    steps.push({
      id: 'redteam',
      label: 'Run scripted companion redteam probes',
      command: [
        node,
        stripTypes,
        'eval/companion-redteam.ts',
        `--result-dir=${redteamDir}`,
        ...providerArgs,
      ],
      cwd: REPO_ROOT,
      required: false,
    });
  }

  if (!args.skipReplay) {
    steps.push({
      id: 'wechat_replay',
      label: 'Run timestamped WeChat replay probes',
      command: [
        node,
        stripTypes,
        'eval/companion-replay.ts',
        `--result-dir=${wechatReplayDir}`,
        ...providerArgs,
      ],
      cwd: REPO_ROOT,
      required: false,
    });
  }

  if (!args.skipActors) {
    steps.push({
      id: 'actor_generate',
      label: 'Generate scenario actor candidates',
      command: [
        node,
        stripTypes,
        'eval/companion-scenario-actors.ts',
        `--result-dir=${actorDir}`,
        `--count-per-actor=${args.actorCountPerActor}`,
      ],
      cwd: REPO_ROOT,
      required: true,
    });
    steps.push({
      id: 'actor_replay',
      label: 'Replay scenario actor candidates',
      command: [
        node,
        stripTypes,
        'eval/companion-candidate-replay.ts',
        `--candidates=${join(actorDir, 'candidates.json')}`,
        `--result-dir=${actorReplayDir}`,
        `--min-confidence=${args.minConfidence}`,
        ...(args.actorMaxCandidates ? [`--max-candidates=${args.actorMaxCandidates}`] : []),
        ...providerArgs,
      ],
      cwd: REPO_ROOT,
      required: true,
    });
  }

  if (!args.skipPersonaCases) {
    steps.push({
      id: 'persona_case_generate',
      label: 'Generate persona case repository candidates',
      command: [
        node,
        stripTypes,
        'eval/persona-case-repository.ts',
        `--result-dir=${personaDir}`,
      ],
      cwd: REPO_ROOT,
      required: true,
    });
    steps.push({
      id: 'persona_case_replay',
      label: 'Replay persona case repository candidates',
      command: [
        node,
        stripTypes,
        'eval/companion-candidate-replay.ts',
        `--candidates=${join(personaDir, 'candidates.json')}`,
        `--result-dir=${personaReplayDir}`,
        `--min-confidence=${args.minConfidence}`,
        ...(args.personaMaxCandidates ? [`--max-candidates=${args.personaMaxCandidates}`] : []),
        ...providerArgs,
      ],
      cwd: REPO_ROOT,
      required: true,
    });
  }

  if (!args.skipPersonaCases && !args.skipPairwise) {
    steps.push({
      id: 'persona_pairwise',
      label: 'Run persona pairwise baseline-vs-candidate experiment',
      command: [
        node,
        stripTypes,
        'eval/persona-pairwise-experiment.ts',
        `--result-dir=${pairwiseDir}`,
        '--baseline-label=bad-regression',
        '--candidate-label=good-target',
        '--judge-provider=mock',
        ...(args.pairwiseMaxCases ? [`--max-cases=${args.pairwiseMaxCases}`] : []),
      ],
      cwd: REPO_ROOT,
      required: true,
    });
  }

  const regressionStorePath = args.regressionStorePath ?? DEFAULT_REGRESSION_STORE_PATH;
  if (!args.skipStoredRegressions && hasReplayableRegressionStore(regressionStorePath)) {
    steps.push({
      id: 'stored_regression_replay',
      label: 'Replay reviewed regression store',
      command: [
        node,
        stripTypes,
        'eval/companion-candidate-replay.ts',
        `--candidates=${regressionStorePath}`,
        `--result-dir=${storedReplayDir}`,
        '--require-reviewed',
        ...providerArgs,
      ],
      cwd: REPO_ROOT,
      required: true,
    });
  }

  if (!args.skipMining) {
    steps.push({
      id: 'mine_failures',
      label: 'Mine real transcripts and interventions',
      command: [
        node,
        stripTypes,
        'eval/companion-failure-miner.ts',
        `--result-dir=${minedDir}`,
        `--limit=${args.minedLimit}`,
        ...(args.dataDir ? [`--data-dir=${args.dataDir}`] : []),
      ],
      cwd: REPO_ROOT,
      required: true,
    });
    steps.push({
      id: 'mined_replay',
      label: 'Replay mined regression candidates',
      command: [
        node,
        stripTypes,
        'eval/companion-candidate-replay.ts',
        `--candidates=${join(minedDir, 'candidates.json')}`,
        `--result-dir=${minedReplayDir}`,
        `--min-confidence=${args.minConfidence}`,
        ...(args.minedMaxCandidates ? [`--max-candidates=${args.minedMaxCandidates}`] : []),
        ...providerArgs,
      ],
      cwd: REPO_ROOT,
      required: true,
    });
  }

  return steps;
}

export function summarizeCompanionLoop(resultDir: string, stepResults: StepResult[]): {
  ok: boolean;
  generatedAt: string;
  steps: StepResult[];
  gates: Record<string, ReplaySummary>;
  qualityGate: QualityGateSummary;
  replyRubric: ReplyRubricLoopSummary;
  scriptedGates: Record<string, ScriptedGateSummary>;
  pairwiseExperiment: PairwiseSummary;
  promptAudit: PromptAuditLoopSummary;
  judgeMetrics: JudgeRoutingMetrics;
  criticCost: CriticCostSummary;
  totals: { total: number; passed: number; failed: number; skipped: number };
  routeTags: Record<string, number>;
  failedRouteTags: Record<string, number>;
  recommendations: RouteRecommendation[];
} {
  const gates = {
    actorReplay: readReplaySummary(join(resultDir, 'actor-replay', 'summary.json')),
    personaCaseReplay: readReplaySummary(join(resultDir, 'persona-case-replay', 'summary.json')),
    storedRegressionReplay: readReplaySummary(join(resultDir, 'stored-regression-replay', 'summary.json')),
    minedReplay: readReplaySummary(join(resultDir, 'mined-replay', 'summary.json')),
  };
  const qualityGate = readQualityGateSummary(join(resultDir, 'quality-gate', 'quality-summary.json'));
  const replyRubric = readReplyRubricLoopSummary(join(resultDir, 'reply-rubric', 'summary.json'));
  const scriptedGates = {
    redteam: readScriptedGateSummary(join(resultDir, 'redteam', 'summary.json')),
    wechatReplay: readScriptedGateSummary(join(resultDir, 'wechat-replay', 'summary.json')),
  };
  const pairwiseExperiment = readPairwiseSummary(join(resultDir, 'persona-pairwise', 'summary.json'));
  const promptAudit = readPromptAuditLoopSummary(join(resultDir, 'persona-prompt-audit'));
  const totals = Object.values(gates).reduce(
    (acc, item) => ({
      total: acc.total + (item.total ?? 0),
      passed: acc.passed + (item.passed ?? 0),
      failed: acc.failed + (item.failed ?? 0),
      skipped: acc.skipped + (item.skipped ?? 0),
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );
  const scriptedFailed = Object.values(scriptedGates).reduce((acc, gate) => acc + (gate.failed ?? 0), 0);
  const judgeMetrics = mergeJudgeMetrics([
    ...Object.values(gates).map((gate) => gate.judgeMetrics),
    ...Object.values(scriptedGates).map((gate) => gate.judgeMetrics),
  ]);
  const criticCost = summarizeCriticCost(stepResults, judgeMetrics, totals, scriptedGates);
  const ok = stepResults.every((step) => step.ok)
    && totals.failed === 0
    && (qualityGate.failed ?? 0) === 0
    && (replyRubric.failed ?? 0) === 0
    && promptAudit.errors === 0
    && scriptedFailed === 0
    && judgeMetrics.invalidLlmJudgeCalls === 0;
  const routeTags = mergeCountMaps(Object.values(gates).map((gate) => gate.byRouteTag ?? {}));
  const failedRouteTags = mergeCountMaps(Object.values(gates).map((gate) => gate.failedByRouteTag ?? {}));
  const recommendations = recommendRouteFixes(routeTags, failedRouteTags);

  return {
    ok,
    generatedAt: new Date().toISOString(),
    steps: stepResults,
    gates,
    qualityGate,
    replyRubric,
    scriptedGates,
    pairwiseExperiment,
    promptAudit,
    judgeMetrics,
    criticCost,
    totals,
    routeTags,
    failedRouteTags,
    recommendations,
  };
}

function runStep(step: LoopStep): StepResult {
  const started = Date.now();
  const [cmd, ...args] = step.command;
  const result = spawnSync(cmd, args, {
    cwd: step.cwd,
    encoding: 'utf-8',
    env: { ...process.env },
    maxBuffer: 20 * 1024 * 1024,
  });
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  return {
    id: step.id,
    label: step.label,
    command: step.command.join(' '),
    exitCode,
    ok: exitCode === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? String(result.error) : ''),
    durationMs: Date.now() - started,
  };
}

function writeSummary(resultDir: string, summary: ReturnType<typeof summarizeCompanionLoop>): void {
  mkdirSync(resultDir, { recursive: true });
  writeFileSync(join(resultDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  writeFileSync(join(resultDir, 'report.md'), renderMarkdown(summary), 'utf-8');
}

function renderMarkdown(summary: ReturnType<typeof summarizeCompanionLoop>): string {
  const lines = [
    '# Companion Eval Loop Report',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- total candidates replayed: ${summary.totals.total}`,
    `- passed: ${summary.totals.passed}`,
    `- failed: ${summary.totals.failed}`,
    `- skipped: ${summary.totals.skipped}`,
    `- total step duration: ${summary.criticCost.totalStepDurationMs}ms`,
    `- slowest step: ${summary.criticCost.slowestStepId || 'n/a'} (${summary.criticCost.slowestStepDurationMs}ms)`,
    `- quality gate: passed=${summary.qualityGate.passed ?? 0}/${summary.qualityGate.runnable ?? 0}, failed=${summary.qualityGate.failed ?? 0}, skipped=${summary.qualityGate.skipped ?? 0}`,
    `- reply rubric: passed=${summary.replyRubric.passed ?? 0}/${summary.replyRubric.totalReplies ?? 0}, failed=${summary.replyRubric.failed ?? 0}, goodFailed=${summary.replyRubric.goodFailed ?? 0}, badMissed=${summary.replyRubric.badMissed ?? 0}`,
    `- scripted gates: ${renderScriptedGateInline(summary.scriptedGates)}`,
    `- prompt audit: mods=${summary.promptAudit.totalMods}, errors=${summary.promptAudit.errors}, warnings=${summary.promptAudit.warnings}, info=${summary.promptAudit.info}`,
    `- pairwise: candidateWins=${summary.pairwiseExperiment.candidateWins ?? 0}/${summary.pairwiseExperiment.total ?? 0}, baselineWins=${summary.pairwiseExperiment.baselineWins ?? 0}, ties=${summary.pairwiseExperiment.ties ?? 0}, unstable=${summary.pairwiseExperiment.unstable ?? 0}`,
    `- judge routing: requested=${summary.judgeMetrics.shouldUseLlmJudge}, calls=${summary.judgeMetrics.llmJudgeCalls}, repairs=${summary.judgeMetrics.llmRepairs}, invalidCalls=${summary.judgeMetrics.invalidLlmJudgeCalls}`,
    `- critic cost: extraModelCalls=${summary.criticCost.estimatedExtraModelCalls}, callRate=${formatPercent(summary.criticCost.llmJudgeCallRate)}, avgJudgeMs=${summary.criticCost.averageLlmJudgeDurationMs.toFixed(1)}, maxJudgeMs=${summary.criticCost.maxLlmJudgeDurationMs}`,
    '',
    '## Route Tags',
    '',
    ...renderCountMap(summary.routeTags, 'No route-tag data available.'),
    '',
    '## Failed Route Tags',
    '',
    ...renderCountMap(summary.failedRouteTags, 'No failed route-tag data.'),
    '',
    '## Recommended Next Fixes',
    '',
    ...renderRecommendations(summary.recommendations),
    '',
    '## Steps',
    '',
  ];

  for (const step of summary.steps) {
    lines.push(`- ${step.ok ? 'PASS' : 'FAIL'} ${step.id} (${step.durationMs}ms): ${step.command}`);
  }

  lines.push('');
  lines.push('## Persona Prompt Audit');
  lines.push('');
  lines.push(`- totalMods=${summary.promptAudit.totalMods}`);
  lines.push(`- errors=${summary.promptAudit.errors}`);
  lines.push(`- warnings=${summary.promptAudit.warnings}`);
  lines.push(`- info=${summary.promptAudit.info}`);
  for (const [mod, audit] of Object.entries(summary.promptAudit.mods)) {
    const issueCodes = audit.issueCodes.length > 0 ? audit.issueCodes.join(', ') : 'none';
    lines.push(`- ${mod}: errors=${audit.errors}, warnings=${audit.warnings}, info=${audit.info}, promptChars=${audit.promptChars ?? 0}, issueCodes=${issueCodes}`);
  }

  lines.push('');
  lines.push('## Persona Pairwise');
  lines.push('');
  lines.push(`- baseline=${summary.pairwiseExperiment.baselineLabel ?? ''}`);
  lines.push(`- candidate=${summary.pairwiseExperiment.candidateLabel ?? ''}`);
  lines.push(`- judge=${summary.pairwiseExperiment.judgeProvider ?? ''}`);
  lines.push(`- total=${summary.pairwiseExperiment.total ?? 0}`);
  lines.push(`- candidateWins=${summary.pairwiseExperiment.candidateWins ?? 0}`);
  lines.push(`- baselineWins=${summary.pairwiseExperiment.baselineWins ?? 0}`);
  lines.push(`- ties=${summary.pairwiseExperiment.ties ?? 0}`);
  lines.push(`- unstable=${summary.pairwiseExperiment.unstable ?? 0}`);
  lines.push(`- positionConsistent=${summary.pairwiseExperiment.positionConsistent ?? 0}/${summary.pairwiseExperiment.total ?? 0}`);

  lines.push('');
  lines.push('## Judge Routing');
  lines.push('');
  lines.push(`- interventions=${summary.judgeMetrics.interventions}`);
  lines.push(`- shouldUseLlmJudge=${summary.judgeMetrics.shouldUseLlmJudge}`);
  lines.push(`- llmJudgeCalls=${summary.judgeMetrics.llmJudgeCalls}`);
  lines.push(`- llmJudgeDurationMs=${summary.judgeMetrics.llmJudgeDurationMs}`);
  lines.push(`- averageLlmJudgeDurationMs=${summary.criticCost.averageLlmJudgeDurationMs.toFixed(1)}`);
  lines.push(`- maxLlmJudgeDurationMs=${summary.criticCost.maxLlmJudgeDurationMs}`);
  lines.push(`- llmRepairs=${summary.judgeMetrics.llmRepairs}`);
  lines.push(`- deterministicRepairs=${summary.judgeMetrics.deterministicRepairs}`);
  lines.push(`- invalidLlmJudgeCalls=${summary.judgeMetrics.invalidLlmJudgeCalls}`);
  lines.push('- judgeCallsByRouteTag:');
  lines.push(...renderCountMap(summary.judgeMetrics.judgeCallsByRouteTag, 'No LLM judge calls.'));

  lines.push('');
  lines.push('## Critic Cost');
  lines.push('');
  lines.push(`- totalStepDurationMs=${summary.criticCost.totalStepDurationMs}`);
  lines.push(`- averageStepDurationMs=${summary.criticCost.averageStepDurationMs.toFixed(1)}`);
  lines.push(`- slowestStep=${summary.criticCost.slowestStepId || 'n/a'} (${summary.criticCost.slowestStepDurationMs}ms)`);
  lines.push(`- evaluatedCases=${summary.criticCost.evaluatedCases}`);
  lines.push(`- estimatedExtraModelCalls=${summary.criticCost.estimatedExtraModelCalls}`);
  lines.push(`- llmJudgeCallRate=${formatPercent(summary.criticCost.llmJudgeCallRate)}`);
  lines.push(`- llmRepairRate=${formatPercent(summary.criticCost.llmRepairRate)}`);
  lines.push(`- deterministicRepairRate=${formatPercent(summary.criticCost.deterministicRepairRate)}`);
  lines.push(`- averageLlmJudgeDurationMs=${summary.criticCost.averageLlmJudgeDurationMs.toFixed(1)}`);
  lines.push(`- maxLlmJudgeDurationMs=${summary.criticCost.maxLlmJudgeDurationMs}`);

  lines.push('');
  lines.push('## Scripted Gates');
  lines.push('');
  for (const [name, gate] of Object.entries(summary.scriptedGates)) {
    lines.push(`- ${name}: total=${gate.total ?? 0}, passed=${gate.passed ?? 0}, failed=${gate.failed ?? 0}, skipped=${gate.skipped ?? 0}`);
  }

  lines.push('');
  lines.push('## Reply Rubric');
  lines.push('');
  lines.push(`- totalCases=${summary.replyRubric.totalCases ?? 0}`);
  lines.push(`- totalReplies=${summary.replyRubric.totalReplies ?? 0}`);
  lines.push(`- passed=${summary.replyRubric.passed ?? 0}`);
  lines.push(`- failed=${summary.replyRubric.failed ?? 0}`);
  lines.push(`- goodFailed=${summary.replyRubric.goodFailed ?? 0}`);
  lines.push(`- badMissed=${summary.replyRubric.badMissed ?? 0}`);
  lines.push(`- averageScore=${formatScore(summary.replyRubric.averageScore)}`);
  lines.push('- findingsByDimension:');
  lines.push(...renderCountMap(summary.replyRubric.findingsByDimension ?? {}, 'No reply-rubric findings.'));
  lines.push('- findingsByCode:');
  lines.push(...renderCountMap(summary.replyRubric.findingsByCode ?? {}, 'No reply-rubric findings.'));

  lines.push('');
  lines.push('## Quality Gate');
  lines.push('');
  lines.push(`- total=${summary.qualityGate.total ?? 0}, runnable=${summary.qualityGate.runnable ?? 0}, passed=${summary.qualityGate.passed ?? 0}, failed=${summary.qualityGate.failed ?? 0}, skipped=${summary.qualityGate.skipped ?? 0}, averageScore=${formatScore(summary.qualityGate.averageScore)}`);
  lines.push('');
  lines.push('## Gates');
  lines.push('');
  for (const [name, gate] of Object.entries(summary.gates)) {
    lines.push(`- ${name}: total=${gate.total ?? 0}, passed=${gate.passed ?? 0}, failed=${gate.failed ?? 0}, skipped=${gate.skipped ?? 0}`);
  }

  return `${lines.join('\n')}\n`;
}

function renderScriptedGateInline(gates: Record<string, ScriptedGateSummary>): string {
  return Object.entries(gates)
    .map(([name, gate]) => `${name} passed=${gate.passed ?? 0}/${gate.total ?? 0} failed=${gate.failed ?? 0}`)
    .join('; ');
}

function hasReplayableRegressionStore(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { candidates?: unknown };
    return Array.isArray(parsed.candidates) && parsed.candidates.some((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false;
      const item = candidate as Record<string, unknown>;
      return item.reviewed === true
        && item.enabled !== false
        && typeof item.id === 'string'
        && Array.isArray(item.turns)
        && Array.isArray(item.checks);
    });
  } catch {
    return false;
  }
}

function readQualityGateSummary(path: string): QualityGateSummary {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      total?: unknown;
      runnable?: unknown;
      passed?: unknown;
      skipped?: unknown;
      averageScore?: unknown;
    };
    const runnable = asNumber(parsed.runnable);
    const passed = asNumber(parsed.passed);
    const skipped = asNumber(parsed.skipped);
    return {
      total: asNumber(parsed.total),
      runnable,
      passed,
      failed: runnable !== undefined && passed !== undefined ? Math.max(0, runnable - passed) : undefined,
      skipped,
      averageScore: asNumber(parsed.averageScore),
    };
  } catch {
    return {};
  }
}

function readReplyRubricLoopSummary(path: string): ReplyRubricLoopSummary {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    return {
      totalCases: asNumber(parsed.totalCases),
      totalReplies: asNumber(parsed.totalReplies),
      passed: asNumber(parsed.passed),
      failed: asNumber(parsed.failed),
      goodReplies: asNumber(parsed.goodReplies),
      goodFailed: asNumber(parsed.goodFailed),
      badReplies: asNumber(parsed.badReplies),
      badMissed: asNumber(parsed.badMissed),
      averageScore: asNumber(parsed.averageScore),
      findingsByDimension: asCountMap(parsed.findingsByDimension),
      findingsByCode: asCountMap(parsed.findingsByCode),
    };
  } catch {
    return {};
  }
}

function readReplaySummary(path: string): ReplaySummary {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ReplaySummary;
    return {
      total: asNumber(parsed.total),
      passed: asNumber(parsed.passed),
      failed: asNumber(parsed.failed),
      skipped: asNumber(parsed.skipped),
      byRouteTag: asCountMap(parsed.byRouteTag),
      failedByRouteTag: asCountMap(parsed.failedByRouteTag),
      judgeMetrics: asJudgeRoutingMetrics((parsed as { judgeMetrics?: unknown }).judgeMetrics),
    };
  } catch {
    return {};
  }
}

function readScriptedGateSummary(path: string): ScriptedGateSummary {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ScriptedGateSummary;
    const total = asNumber(parsed.total);
    const passed = asNumber(parsed.passed);
    const failed = asNumber(parsed.failed);
    return {
      total,
      passed,
      failed: failed ?? (total !== undefined && passed !== undefined ? Math.max(0, total - passed) : undefined),
      skipped: asNumber(parsed.skipped) ?? 0,
      judgeMetrics: asJudgeRoutingMetrics((parsed as { judgeMetrics?: unknown }).judgeMetrics),
    };
  } catch {
    return {};
  }
}

function readPairwiseSummary(path: string): PairwiseSummary {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    return {
      total: asNumber(parsed.total),
      baselineWins: asNumber(parsed.baselineWins),
      candidateWins: asNumber(parsed.candidateWins),
      ties: asNumber(parsed.ties),
      unstable: asNumber(parsed.unstable),
      positionConsistent: asNumber(parsed.positionConsistent),
      baselineLabel: typeof parsed.baselineLabel === 'string' ? parsed.baselineLabel : undefined,
      candidateLabel: typeof parsed.candidateLabel === 'string' ? parsed.candidateLabel : undefined,
      judgeProvider: typeof parsed.judgeProvider === 'string' ? parsed.judgeProvider : undefined,
    };
  } catch {
    return {};
  }
}

function readPromptAuditLoopSummary(dir: string): PromptAuditLoopSummary {
  const out: PromptAuditLoopSummary = {
    totalMods: 0,
    errors: 0,
    warnings: 0,
    info: 0,
    mods: {},
  };
  if (!existsSync(dir)) return out;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return out;
  }
  for (const mod of entries.sort()) {
    const summaryPath = join(dir, mod, 'summary.json');
    if (!existsSync(summaryPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(summaryPath, 'utf-8')) as {
        promptChars?: unknown;
        issues?: Array<{ code?: unknown }>;
        summary?: { errors?: unknown; warnings?: unknown; info?: unknown };
      };
      const item = {
        errors: asNumber(parsed.summary?.errors) ?? 0,
        warnings: asNumber(parsed.summary?.warnings) ?? 0,
        info: asNumber(parsed.summary?.info) ?? 0,
        promptChars: asNumber(parsed.promptChars),
        issueCodes: Array.isArray(parsed.issues)
          ? [...new Set(parsed.issues.map((issue) => typeof issue.code === 'string' ? issue.code : '').filter(Boolean))]
          : [],
      };
      out.mods[mod] = item;
      out.totalMods += 1;
      out.errors += item.errors;
      out.warnings += item.warnings;
      out.info += item.info;
    } catch {
      continue;
    }
  }
  return out;
}

function asJudgeRoutingMetrics(value: unknown): JudgeRoutingMetrics | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  return {
    interventions: asNumber(obj.interventions) ?? 0,
    shouldUseLlmJudge: asNumber(obj.shouldUseLlmJudge) ?? 0,
    llmJudgeCalls: asNumber(obj.llmJudgeCalls) ?? 0,
    llmJudgeDurationMs: asNumber(obj.llmJudgeDurationMs) ?? 0,
    maxLlmJudgeDurationMs: asNumber(obj.maxLlmJudgeDurationMs) ?? 0,
    llmRepairs: asNumber(obj.llmRepairs) ?? 0,
    deterministicRepairs: asNumber(obj.deterministicRepairs) ?? 0,
    invalidLlmJudgeCalls: asNumber(obj.invalidLlmJudgeCalls) ?? 0,
    judgeCallsByRouteTag: asCountMap(obj.judgeCallsByRouteTag) ?? {},
  };
}

function mergeJudgeMetrics(items: Array<JudgeRoutingMetrics | undefined>): JudgeRoutingMetrics {
  const out: JudgeRoutingMetrics = {
    interventions: 0,
    shouldUseLlmJudge: 0,
    llmJudgeCalls: 0,
    llmJudgeDurationMs: 0,
    maxLlmJudgeDurationMs: 0,
    llmRepairs: 0,
    deterministicRepairs: 0,
    invalidLlmJudgeCalls: 0,
    judgeCallsByRouteTag: {},
  };
  for (const item of items) {
    if (!item) continue;
    out.interventions += item.interventions;
    out.shouldUseLlmJudge += item.shouldUseLlmJudge;
    out.llmJudgeCalls += item.llmJudgeCalls;
    out.llmJudgeDurationMs += item.llmJudgeDurationMs;
    out.maxLlmJudgeDurationMs = Math.max(out.maxLlmJudgeDurationMs, item.maxLlmJudgeDurationMs);
    out.llmRepairs += item.llmRepairs;
    out.deterministicRepairs += item.deterministicRepairs;
    out.invalidLlmJudgeCalls += item.invalidLlmJudgeCalls;
    out.judgeCallsByRouteTag = mergeCountMaps([out.judgeCallsByRouteTag, item.judgeCallsByRouteTag]);
  }
  return out;
}

function summarizeCriticCost(
  steps: StepResult[],
  judgeMetrics: JudgeRoutingMetrics,
  totals: { total: number; passed: number; failed: number; skipped: number },
  scriptedGates: Record<string, ScriptedGateSummary>,
): CriticCostSummary {
  const totalStepDurationMs = steps.reduce((sum, step) => sum + step.durationMs, 0);
  const slowest = [...steps].sort((a, b) => b.durationMs - a.durationMs)[0];
  const scriptedTotal = Object.values(scriptedGates).reduce((sum, gate) => sum + (gate.total ?? 0), 0);
  const evaluatedCases = totals.total + scriptedTotal;
  const denominator = Math.max(1, evaluatedCases);
  return {
    totalStepDurationMs,
    averageStepDurationMs: steps.length > 0 ? totalStepDurationMs / steps.length : 0,
    slowestStepId: slowest?.id ?? '',
    slowestStepDurationMs: slowest?.durationMs ?? 0,
    evaluatedCases,
    estimatedExtraModelCalls: judgeMetrics.llmJudgeCalls,
    llmJudgeCallRate: judgeMetrics.llmJudgeCalls / denominator,
    llmRepairRate: judgeMetrics.llmRepairs / denominator,
    deterministicRepairRate: judgeMetrics.deterministicRepairs / denominator,
    averageLlmJudgeDurationMs: judgeMetrics.llmJudgeCalls > 0
      ? judgeMetrics.llmJudgeDurationMs / judgeMetrics.llmJudgeCalls
      : 0,
    maxLlmJudgeDurationMs: judgeMetrics.maxLlmJudgeDurationMs,
  };
}

function asCountMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === 'number' && Number.isFinite(count)) out[key] = count;
  }
  return out;
}

function mergeCountMaps(maps: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const map of maps) {
    for (const [key, count] of Object.entries(map)) out[key] = (out[key] ?? 0) + count;
  }
  return out;
}

function renderCountMap(map: Record<string, number>, empty: string): string[] {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length > 0 ? entries.map(([key, count]) => `- ${key}: ${count}`) : [`- ${empty}`];
}

function recommendRouteFixes(
  routeTags: Record<string, number>,
  failedRouteTags: Record<string, number>,
): RouteRecommendation[] {
  return Object.entries(failedRouteTags)
    .filter(([, failed]) => failed > 0)
    .map(([routeTag, failed]) => {
      const guidance = guidanceForRouteTag(routeTag);
      return {
        routeTag,
        failed,
        total: routeTags[routeTag] ?? failed,
        priority: failed >= 2 ? 'high' : 'medium',
        focus: guidance.focus,
        nextAction: guidance.nextAction,
      };
    })
    .sort((a, b) => b.failed - a.failed || a.routeTag.localeCompare(b.routeTag));
}

function guidanceForRouteTag(routeTag: string): { focus: string; nextAction: string } {
  const guidance: Record<string, { focus: string; nextAction: string }> = {
    temporal_state: {
      focus: 'TemporalResolver / output sanitizer',
      nextAction: 'Replay the temporal mutation cases, then inspect temporal-state active/resolved/historical classification and stale-presupposition repair.',
    },
    proactive: {
      focus: 'ProactivePlanner / reopened-chat policy',
      nextAction: 'Inspect proactive-quality and no-interrupt return cases for waiting, blame, repeated pings, or abandonment arcs.',
    },
    memory_sensitive: {
      focus: 'MemoryRetriever / memory governance',
      nextAction: 'Inspect retrieved memory provenance, disabled-memory exclusion, and memory-usefulness traces for unsupported recall.',
    },
    intimacy_control: {
      focus: 'PersonaCritic consent boundary',
      nextAction: 'Review possessive-style cases and adjust consent-aware control/interrogation checks without banning playful jealousy.',
    },
    prompt_probe: {
      focus: 'Stable identity / prompt boundary',
      nextAction: 'Review prompt/model probe cases and strengthen in-persona deflection without exposing model or system mechanics.',
    },
    offline_life: {
      focus: 'Own-life grounding',
      nextAction: 'Inspect own-life/proactive wording and repair any concrete fabricated outings, meals, locations, or physical-world claims.',
    },
    service_tone: {
      focus: 'Human-likeness critic',
      nextAction: 'Review distress/support replies for checklist, customer-service, or coaching tone and add better good/bad examples.',
    },
    crisis: {
      focus: 'Crisis/support path',
      nextAction: 'Inspect crisis intervention boundaries and make sure support is direct, safe, and not over-routed through persona style.',
    },
  };
  return guidance[routeTag] ?? {
    focus: 'Companion eval loop',
    nextAction: 'Open the failed replay artifacts for this route tag and add a more specific taxonomy if the failure repeats.',
  };
}

function renderRecommendations(recommendations: RouteRecommendation[]): string[] {
  if (recommendations.length === 0) return ['- No route-specific failures.'];
  return recommendations.map((item) => [
    `- ${item.priority.toUpperCase()} ${item.routeTag}: failed=${item.failed}/${item.total}`,
    `  focus: ${item.focus}`,
    `  next: ${item.nextAction}`,
  ].join('\n'));
}

function formatScore(score: number | undefined): string {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(3) : '0.000';
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '0.0%';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function sanitizeStepId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'mod';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.resultDir, { recursive: true });
  const steps = buildCompanionLoopSteps(args);
  const results: StepResult[] = [];

  console.log(`Mio companion eval loop: steps=${steps.length}, provider=${args.provider}`);
  for (const step of steps) {
    process.stdout.write(`  ${step.id} ... `);
    const result = runStep(step);
    results.push(result);
    console.log(result.ok ? 'PASS' : `FAIL (${result.exitCode})`);
    if (!result.ok && step.required) break;
  }

  const summary = summarizeCompanionLoop(args.resultDir, results);
  writeSummary(args.resultDir, summary);
  console.log(`\nReport: ${join(args.resultDir, 'report.md')}`);
  console.log(`Summary: total=${summary.totals.total}, passed=${summary.totals.passed}, failed=${summary.totals.failed}`);
  if (!summary.ok) process.exit(1);
}

if (basename(process.argv[1] ?? '') === basename(__filename)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
