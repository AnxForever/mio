#!/usr/bin/env node
/**
 * companion-loop.ts — orchestrate the companion automated chat test loop.
 *
 * Pipeline:
 *   1. Generate scenario-actor candidates.
 *   2. Replay scenario candidates through the production turn loop.
 *   3. Mine real transcripts/intervention logs into regression candidates.
 *   4. Replay mined candidates.
 *   5. Write one summary/report for nightly or manual review.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CliArgs {
  resultDir: string;
  provider: string;
  model?: string;
  dataDir?: string;
  actorCountPerActor: number;
  actorMaxCandidates?: number;
  minedLimit: number;
  minedMaxCandidates?: number;
  minConfidence: number;
  skipBuild: boolean;
  skipActors: boolean;
  skipMining: boolean;
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
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(join(__dirname, '..'));
const DEFAULT_RESULT_DIR = join(__dirname, 'results', 'companion-loop');

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    resultDir: DEFAULT_RESULT_DIR,
    provider: 'mock',
    actorCountPerActor: 1,
    minedLimit: 40,
    minConfidence: 0,
    skipBuild: false,
    skipActors: false,
    skipMining: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--result-dir=')) args.resultDir = resolve(arg.slice('--result-dir='.length));
    else if (arg.startsWith('--provider=')) args.provider = arg.slice('--provider='.length);
    else if (arg.startsWith('--model=')) args.model = arg.slice('--model='.length);
    else if (arg.startsWith('--data-dir=')) args.dataDir = resolve(arg.slice('--data-dir='.length));
    else if (arg.startsWith('--actor-count-per-actor=')) args.actorCountPerActor = Math.max(1, Number(arg.slice('--actor-count-per-actor='.length)) || 1);
    else if (arg.startsWith('--actor-max-candidates=')) args.actorMaxCandidates = Math.max(1, Number(arg.slice('--actor-max-candidates='.length)) || 1);
    else if (arg.startsWith('--mined-limit=')) args.minedLimit = Math.max(1, Number(arg.slice('--mined-limit='.length)) || 1);
    else if (arg.startsWith('--mined-max-candidates=')) args.minedMaxCandidates = Math.max(1, Number(arg.slice('--mined-max-candidates='.length)) || 1);
    else if (arg.startsWith('--min-confidence=')) args.minConfidence = clamp01(Number(arg.slice('--min-confidence='.length)));
    else if (arg === '--skip-build') args.skipBuild = true;
    else if (arg === '--skip-actors') args.skipActors = true;
    else if (arg === '--skip-mining') args.skipMining = true;
  }

  return args;
}

export function buildCompanionLoopSteps(args: CliArgs): LoopStep[] {
  const node = process.execPath;
  const stripTypes = '--experimental-strip-types';
  const steps: LoopStep[] = [];
  const actorDir = join(args.resultDir, 'actors');
  const actorReplayDir = join(args.resultDir, 'actor-replay');
  const minedDir = join(args.resultDir, 'mined');
  const minedReplayDir = join(args.resultDir, 'mined-replay');
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
  totals: { total: number; passed: number; failed: number; skipped: number };
} {
  const gates = {
    actorReplay: readReplaySummary(join(resultDir, 'actor-replay', 'summary.json')),
    minedReplay: readReplaySummary(join(resultDir, 'mined-replay', 'summary.json')),
  };
  const totals = Object.values(gates).reduce(
    (acc, item) => ({
      total: acc.total + (item.total ?? 0),
      passed: acc.passed + (item.passed ?? 0),
      failed: acc.failed + (item.failed ?? 0),
      skipped: acc.skipped + (item.skipped ?? 0),
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );
  const ok = stepResults.every((step) => step.ok) && totals.failed === 0;

  return {
    ok,
    generatedAt: new Date().toISOString(),
    steps: stepResults,
    gates,
    totals,
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
    '',
    '## Steps',
    '',
  ];

  for (const step of summary.steps) {
    lines.push(`- ${step.ok ? 'PASS' : 'FAIL'} ${step.id} (${step.durationMs}ms): ${step.command}`);
  }

  lines.push('');
  lines.push('## Gates');
  lines.push('');
  for (const [name, gate] of Object.entries(summary.gates)) {
    lines.push(`- ${name}: total=${gate.total ?? 0}, passed=${gate.passed ?? 0}, failed=${gate.failed ?? 0}, skipped=${gate.skipped ?? 0}`);
  }

  return `${lines.join('\n')}\n`;
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
    };
  } catch {
    return {};
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
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
