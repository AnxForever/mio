#!/usr/bin/env node
/**
 * companion-provider-matrix.ts — run the companion eval loop across providers.
 *
 * The regular companion-loop is intentionally scoped to one provider/model so
 * every output directory stays easy to inspect. This wrapper is the nightly or
 * pre-deploy entry point when the same gates need to be compared across model
 * providers without overwriting each other's summaries.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ProviderMatrixTarget {
  provider: string;
  model?: string;
}

export interface ProviderMatrixArgs {
  resultDir: string;
  targets: ProviderMatrixTarget[];
  skipBuild: boolean;
  loopArgs: string[];
}

export interface ProviderMatrixStep {
  id: string;
  label: string;
  command: string[];
  cwd: string;
  target?: ProviderMatrixTarget;
}

interface ProviderMatrixStepResult {
  id: string;
  label: string;
  command: string;
  exitCode: number;
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  target?: ProviderMatrixTarget;
}

interface ProviderLoopSummary {
  ok?: boolean;
  totals?: {
    total?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
  };
  qualityGate?: {
    failed?: number;
  };
  replyRubric?: {
    totalReplies?: number;
    passed?: number;
    failed?: number;
    goodFailed?: number;
    badMissed?: number;
  };
  scriptedGates?: Record<string, {
    total?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
  }>;
  judgeMetrics?: {
    shouldUseLlmJudge?: number;
    llmJudgeCalls?: number;
    invalidLlmJudgeCalls?: number;
  };
  criticCost?: {
    estimatedExtraModelCalls?: number;
    llmJudgeCallRate?: number;
    averageLlmJudgeDurationMs?: number;
    maxLlmJudgeDurationMs?: number;
  };
  promptAudit?: {
    totalMods?: number;
    errors?: number;
    warnings?: number;
    info?: number;
  };
  failedRouteTags?: Record<string, number>;
}

interface ProviderMatrixProviderSummary {
  provider: string;
  model: string;
  resultDir: string;
  summaryPath: string;
  qualityGateSummaryPath: string;
  qualityGateReportPath: string;
  ok: boolean;
  missingSummary: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  qualityGateFailed: number;
  replyRubricFailed: number;
  replyRubricGoodFailed: number;
  replyRubricBadMissed: number;
  scriptedFailed: number;
  promptAuditErrors: number;
  promptAuditWarnings: number;
  promptAuditInfo: number;
  llmJudgeCalls: number;
  invalidLlmJudgeCalls: number;
  failedRouteTags: Record<string, number>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(join(__dirname, '..'));
const DEFAULT_RESULT_DIR = join(__dirname, 'results', 'companion-provider-matrix');

export function parseProviderMatrixArgs(argv: string[]): ProviderMatrixArgs {
  let resultDir = DEFAULT_RESULT_DIR;
  let providers = parseList(process.env.MIO_COMPANION_PROVIDERS || 'mock');
  let models: Record<string, string> = parseModels(process.env.MIO_COMPANION_MODELS || '');
  let skipBuild = false;
  const loopArgs: string[] = [];
  let forwarding = false;

  for (const arg of argv) {
    if (arg === '--') {
      forwarding = true;
      continue;
    }

    if (forwarding) {
      loopArgs.push(arg);
      continue;
    }

    if (arg.startsWith('--result-dir=')) resultDir = resolve(arg.slice('--result-dir='.length));
    else if (arg.startsWith('--providers=')) providers = parseList(arg.slice('--providers='.length));
    else if (arg.startsWith('--models=')) models = parseModels(arg.slice('--models='.length));
    else if (arg === '--skip-build') skipBuild = true;
    else loopArgs.push(arg);
  }

  const targets = providers.map((provider) => ({ provider, model: models[provider] })).filter((target) => target.provider);
  if (targets.length === 0) throw new Error('No providers selected. Use --providers=mock,deepseek or MIO_COMPANION_PROVIDERS.');

  return {
    resultDir,
    targets,
    skipBuild,
    loopArgs,
  };
}

export function buildProviderMatrixSteps(args: ProviderMatrixArgs): ProviderMatrixStep[] {
  const node = process.execPath;
  const steps: ProviderMatrixStep[] = [];

  if (!args.skipBuild) {
    steps.push({
      id: 'build',
      label: 'Build TypeScript output once for provider matrix',
      command: ['npm', 'run', 'build'],
      cwd: REPO_ROOT,
    });
  }

  for (const target of args.targets) {
    const resultDir = providerResultDir(args.resultDir, target);
    steps.push({
      id: `provider_${targetSlug(target)}`,
      label: `Run companion loop for ${formatTarget(target)}`,
      command: [
        node,
        '--experimental-strip-types',
        'eval/companion-loop.ts',
        '--skip-build',
        `--result-dir=${resultDir}`,
        `--provider=${target.provider}`,
        ...(target.model ? [`--model=${target.model}`] : []),
        ...args.loopArgs,
      ],
      cwd: REPO_ROOT,
      target,
    });
  }

  return steps;
}

export function providerResultDir(resultDir: string, target: ProviderMatrixTarget): string {
  return join(resultDir, targetSlug(target));
}

export function summarizeProviderMatrix(args: ProviderMatrixArgs, stepResults: ProviderMatrixStepResult[]): {
  ok: boolean;
  generatedAt: string;
  resultDir: string;
  providers: ProviderMatrixProviderSummary[];
  totals: { total: number; passed: number; failed: number; skipped: number };
  promptAudit: { errors: number; warnings: number; info: number };
  replyRubric: { failed: number; goodFailed: number; badMissed: number };
  steps: ProviderMatrixStepResult[];
} {
  const providers = args.targets.map((target) => readProviderSummary(args.resultDir, target));
  const totals = providers.reduce(
    (acc, provider) => ({
      total: acc.total + provider.total,
      passed: acc.passed + provider.passed,
      failed: acc.failed + provider.failed,
      skipped: acc.skipped + provider.skipped,
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );
  const promptAudit = providers.reduce(
    (acc, provider) => ({
      errors: acc.errors + provider.promptAuditErrors,
      warnings: acc.warnings + provider.promptAuditWarnings,
      info: acc.info + provider.promptAuditInfo,
    }),
    { errors: 0, warnings: 0, info: 0 },
  );
  const replyRubric = providers.reduce(
    (acc, provider) => ({
      failed: acc.failed + provider.replyRubricFailed,
      goodFailed: acc.goodFailed + provider.replyRubricGoodFailed,
      badMissed: acc.badMissed + provider.replyRubricBadMissed,
    }),
    { failed: 0, goodFailed: 0, badMissed: 0 },
  );
  const ok = stepResults.every((step) => step.ok) && providers.every((provider) => provider.ok);

  return {
    ok,
    generatedAt: new Date().toISOString(),
    resultDir: args.resultDir,
    providers,
    totals,
    promptAudit,
    replyRubric,
    steps: stepResults,
  };
}

function readProviderSummary(resultDir: string, target: ProviderMatrixTarget): ProviderMatrixProviderSummary {
  const dir = providerResultDir(resultDir, target);
  const summaryPath = join(dir, 'summary.json');
  if (!existsSync(summaryPath)) {
    return {
      provider: target.provider,
      model: target.model ?? '',
      resultDir: dir,
      summaryPath,
      qualityGateSummaryPath: join(dir, 'quality-gate', 'quality-summary.json'),
      qualityGateReportPath: join(dir, 'quality-gate', 'quality-report.md'),
      ok: false,
      missingSummary: true,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      qualityGateFailed: 0,
      replyRubricFailed: 0,
      replyRubricGoodFailed: 0,
      replyRubricBadMissed: 0,
      scriptedFailed: 0,
      promptAuditErrors: 0,
      promptAuditWarnings: 0,
      promptAuditInfo: 0,
      llmJudgeCalls: 0,
      invalidLlmJudgeCalls: 0,
      failedRouteTags: {},
    };
  }

  const parsed = JSON.parse(readFileSync(summaryPath, 'utf-8')) as ProviderLoopSummary;
  const scriptedFailed = Object.values(parsed.scriptedGates ?? {}).reduce((acc, gate) => acc + asNumber(gate.failed), 0);
  const promptAuditErrors = asNumber(parsed.promptAudit?.errors);
  const replyRubricFailed = asNumber(parsed.replyRubric?.failed);
  return {
    provider: target.provider,
    model: target.model ?? '',
    resultDir: dir,
    summaryPath,
    qualityGateSummaryPath: join(dir, 'quality-gate', 'quality-summary.json'),
    qualityGateReportPath: join(dir, 'quality-gate', 'quality-report.md'),
    ok: parsed.ok === true && promptAuditErrors === 0 && replyRubricFailed === 0,
    missingSummary: false,
    total: asNumber(parsed.totals?.total),
    passed: asNumber(parsed.totals?.passed),
    failed: asNumber(parsed.totals?.failed),
    skipped: asNumber(parsed.totals?.skipped),
    qualityGateFailed: asNumber(parsed.qualityGate?.failed),
    replyRubricFailed,
    replyRubricGoodFailed: asNumber(parsed.replyRubric?.goodFailed),
    replyRubricBadMissed: asNumber(parsed.replyRubric?.badMissed),
    scriptedFailed,
    promptAuditErrors,
    promptAuditWarnings: asNumber(parsed.promptAudit?.warnings),
    promptAuditInfo: asNumber(parsed.promptAudit?.info),
    llmJudgeCalls: asNumber(parsed.judgeMetrics?.llmJudgeCalls),
    invalidLlmJudgeCalls: asNumber(parsed.judgeMetrics?.invalidLlmJudgeCalls),
    failedRouteTags: asCountMap(parsed.failedRouteTags),
  };
}

function runStep(step: ProviderMatrixStep): ProviderMatrixStepResult {
  const started = Date.now();
  const [cmd, ...args] = step.command;
  const result = spawnSync(cmd, args, {
    cwd: step.cwd,
    encoding: 'utf-8',
    env: { ...process.env },
    maxBuffer: 30 * 1024 * 1024,
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
    target: step.target,
  };
}

function writeProviderMatrixReports(args: ProviderMatrixArgs, summary: ReturnType<typeof summarizeProviderMatrix>): void {
  mkdirSync(args.resultDir, { recursive: true });
  writeFileSync(join(args.resultDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  writeFileSync(join(args.resultDir, 'report.md'), renderProviderMatrixMarkdown(summary), 'utf-8');
}

function renderProviderMatrixMarkdown(summary: ReturnType<typeof summarizeProviderMatrix>): string {
  const lines = [
    '# Companion Provider Matrix Report',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- providers: ${summary.providers.length}`,
    `- total candidates replayed: ${summary.totals.total}`,
    `- passed: ${summary.totals.passed}`,
    `- failed: ${summary.totals.failed}`,
    `- skipped: ${summary.totals.skipped}`,
    `- prompt audit: errors=${summary.promptAudit.errors}, warnings=${summary.promptAudit.warnings}, info=${summary.promptAudit.info}`,
    `- reply rubric: failed=${summary.replyRubric.failed}, goodFailed=${summary.replyRubric.goodFailed}, badMissed=${summary.replyRubric.badMissed}`,
    '',
    '## Providers',
    '',
  ];

  for (const provider of summary.providers) {
    lines.push(`- ${provider.ok ? 'PASS' : 'FAIL'} ${provider.provider}${provider.model ? `/${provider.model}` : ''}: candidates=${provider.passed}/${provider.total} passed, failed=${provider.failed}, skipped=${provider.skipped}, qualityFailed=${provider.qualityGateFailed}, replyRubric=${provider.replyRubricFailed}/${provider.replyRubricGoodFailed}/${provider.replyRubricBadMissed}, scriptedFailed=${provider.scriptedFailed}, promptAudit=${provider.promptAuditErrors}/${provider.promptAuditWarnings}/${provider.promptAuditInfo}, llmJudgeCalls=${provider.llmJudgeCalls}, invalidJudgeCalls=${provider.invalidLlmJudgeCalls}`);
    lines.push(`  - quality gate report: ${provider.qualityGateReportPath}`);
    if (provider.missingSummary) lines.push(`  - missing summary: ${provider.summaryPath}`);
    for (const [tag, count] of Object.entries(provider.failedRouteTags)) {
      lines.push(`  - failed ${tag}: ${count}`);
    }
  }

  lines.push('');
  lines.push('## Steps');
  lines.push('');
  for (const step of summary.steps) {
    lines.push(`- ${step.ok ? 'PASS' : 'FAIL'} ${step.id} (${step.durationMs}ms): ${step.command}`);
  }

  return `${lines.join('\n')}\n`;
}

function parseList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseModels(value: string): Record<string, string> {
  const models: Record<string, string> = {};
  for (const item of parseList(value)) {
    const idx = item.indexOf(':');
    if (idx <= 0) continue;
    const provider = item.slice(0, idx).trim();
    const model = item.slice(idx + 1).trim();
    if (provider && model) models[provider] = model;
  }
  return models;
}

function targetSlug(target: ProviderMatrixTarget): string {
  const raw = target.model ? `${target.provider}-${target.model}` : target.provider;
  return raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 80);
}

function formatTarget(target: ProviderMatrixTarget): string {
  return target.model ? `${target.provider}/${target.model}` : target.provider;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    const n = asNumber(count);
    if (n > 0) out[key] = n;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseProviderMatrixArgs(process.argv.slice(2));
  mkdirSync(args.resultDir, { recursive: true });
  const steps = buildProviderMatrixSteps(args);
  const results: ProviderMatrixStepResult[] = [];

  for (const step of steps) {
    console.log(`\n[companion-provider-matrix] ${step.label}`);
    console.log(`$ ${step.command.join(' ')}`);
    const result = runStep(step);
    results.push(result);
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
  }

  const summary = summarizeProviderMatrix(args, results);
  writeProviderMatrixReports(args, summary);
  console.log(`\nProvider matrix: ${summary.providers.filter((provider) => provider.ok).length}/${summary.providers.length} providers passed`);
  console.log(`Report: ${join(args.resultDir, 'report.md')}`);
  if (!summary.ok) process.exit(1);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
