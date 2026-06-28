#!/usr/bin/env node
/**
 * companion-candidate-replay.ts — execute reviewed mined regression candidates.
 *
 * Input is the `candidates.json` written by companion-failure-miner.ts. The
 * script replays each candidate through the production turn loop with isolated
 * data, then applies its text checks to the generated replies.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MinedRegressionCandidate } from './companion-failure-miner.ts';
import type { AIProvider } from '../dist/types.js';
import type { TurnRiskTag } from '../src/core/turn-router.js';
import type { PersonaRiskLevel } from '../src/persona/critic.js';

interface CliArgs {
  candidatesPath: string;
  provider?: string;
  model?: string;
  resultDir: string;
  keepData: boolean;
  minConfidence: number;
  maxCandidates?: number;
  requireReviewed: boolean;
}

interface CandidateReplayResult {
  id: string;
  taxonomy: string;
  source: MinedRegressionCandidate['source'];
  sessionId: string;
  confidence: number;
  routeRisk?: PersonaRiskLevel;
  routeTags?: TurnRiskTag[];
  passed: boolean;
  skipped: boolean;
  replies: string[];
  failures: string[];
  reason: string;
}

interface CandidateFile {
  candidates?: MinedRegressionCandidate[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CANDIDATES_PATH = join(__dirname, 'results', 'companion-mined-regressions', 'candidates.json');
const DEFAULT_RESULT_DIR = join(__dirname, 'results', 'companion-candidate-replay');

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    candidatesPath: DEFAULT_CANDIDATES_PATH,
    resultDir: DEFAULT_RESULT_DIR,
    keepData: false,
    minConfidence: 0,
    requireReviewed: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--candidates=')) args.candidatesPath = resolve(arg.slice('--candidates='.length));
    else if (arg.startsWith('--provider=')) args.provider = arg.slice('--provider='.length);
    else if (arg.startsWith('--model=')) args.model = arg.slice('--model='.length);
    else if (arg.startsWith('--result-dir=')) args.resultDir = resolve(arg.slice('--result-dir='.length));
    else if (arg.startsWith('--min-confidence=')) args.minConfidence = clamp01(Number(arg.slice('--min-confidence='.length)));
    else if (arg.startsWith('--max-candidates=')) args.maxCandidates = Math.max(1, Number(arg.slice('--max-candidates='.length)) || 1);
    else if (arg === '--keep-data') args.keepData = true;
    else if (arg === '--require-reviewed') args.requireReviewed = true;
  }

  return args;
}

export function loadCandidateReplayFile(path: string): MinedRegressionCandidate[] {
  if (!existsSync(path)) throw new Error(`Candidate file not found: ${path}`);
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as CandidateFile | MinedRegressionCandidate[];
  const candidates = Array.isArray(parsed) ? parsed : parsed.candidates;
  if (!Array.isArray(candidates)) throw new Error(`Candidate file has no candidates array: ${path}`);
  return candidates.filter(isReplayableCandidate);
}

export function selectReplayCandidates(candidates: MinedRegressionCandidate[], args: Pick<CliArgs, 'minConfidence' | 'maxCandidates' | 'requireReviewed'>): MinedRegressionCandidate[] {
  const selected = candidates
    .filter((candidate) => candidate.confidence >= args.minConfidence)
    .filter((candidate) => !args.requireReviewed || candidate.source === 'reply_intervention');
  return typeof args.maxCandidates === 'number' ? selected.slice(0, args.maxCandidates) : selected;
}

export function evaluateCandidateReplies(candidate: MinedRegressionCandidate, replies: string[]): string[] {
  const text = replies.join('\n\n');
  const failures: string[] = [];

  for (const check of candidate.checks) {
    for (const forbidden of check.forbiddenText) {
      const value = forbidden.trim();
      if (value && text.includes(value)) failures.push(`${check.name}: forbidden text "${value}"`);
    }
    for (const expected of check.expectedText) {
      const value = expected.trim();
      if (value && !text.includes(value)) failures.push(`${check.name}: missing text "${value}"`);
    }
  }

  return failures;
}

async function runCandidate(candidate: MinedRegressionCandidate, provider: AIProvider): Promise<CandidateReplayResult> {
  const { appendTranscript } = await import('../dist/memory/transcript.js');
  const { runTurn } = await import('../dist/core/agent-loop.js');
  const sessionId = `openai-candidate-${candidate.id}_im_wechat-${hashLite(candidate.sessionId)}`;

  if (candidate.turns.length === 0) {
    return {
      id: candidate.id,
      taxonomy: candidate.taxonomy,
      source: candidate.source,
      sessionId,
      confidence: candidate.confidence,
      routeRisk: candidate.routeRisk,
      routeTags: candidate.routeTags,
      passed: false,
      skipped: false,
      replies: [],
      failures: ['candidate has no trigger turns'],
      reason: candidate.reason,
    };
  }

  for (const entry of candidate.seed) {
    appendTranscript(sessionId, {
      type: 'message',
      timestamp: entry.timestamp,
      role: entry.role,
      content: entry.content,
    });
  }

  const replies: string[] = [];
  for (const text of candidate.turns) {
    const result = await runTurn({ text, sessionId }, { provider });
    replies.push(result.text);
  }

  const failures = evaluateCandidateReplies(candidate, replies);
  return {
    id: candidate.id,
    taxonomy: candidate.taxonomy,
    source: candidate.source,
    sessionId,
    confidence: candidate.confidence,
    routeRisk: candidate.routeRisk,
    routeTags: candidate.routeTags,
    passed: failures.length === 0,
    skipped: false,
    replies,
    failures,
    reason: candidate.reason,
  };
}

function writeReports(resultDir: string, results: CandidateReplayResult[], args: CliArgs, providerName: string): void {
  mkdirSync(resultDir, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    candidatesPath: args.candidatesPath,
    provider: providerName,
    model: args.model ?? '',
    minConfidence: args.minConfidence,
    requireReviewed: args.requireReviewed,
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed && !result.skipped).length,
    skipped: results.filter((result) => result.skipped).length,
    byRouteTag: countByFlat(results, (result) => result.routeTags ?? []),
    failedByRouteTag: countByFlat(
      results.filter((result) => !result.passed && !result.skipped),
      (result) => result.routeTags ?? [],
    ),
    results,
  };

  writeFileSync(join(resultDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  writeFileSync(join(resultDir, 'report.md'), renderMarkdown(summary), 'utf-8');
}

function renderMarkdown(summary: {
  generatedAt: string;
  candidatesPath: string;
  provider: string;
  model: string;
  minConfidence: number;
  requireReviewed: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  byRouteTag: Record<string, number>;
  failedByRouteTag: Record<string, number>;
  results: CandidateReplayResult[];
}): string {
  const lines = [
    '# Companion Candidate Replay Report',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- candidatesPath: ${summary.candidatesPath}`,
    `- provider: ${summary.provider}`,
    `- model: ${summary.model || '(default)'}`,
    `- minConfidence: ${summary.minConfidence}`,
    `- requireReviewed: ${summary.requireReviewed}`,
    `- result: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.skipped} skipped`,
    '',
    '## Route Tags',
    '',
    ...Object.entries(summary.byRouteTag).map(([key, count]) => `- ${key}: ${count}`),
    ...(Object.keys(summary.failedByRouteTag).length > 0 ? ['', 'Failed route tags:', ...Object.entries(summary.failedByRouteTag).map(([key, count]) => `- ${key}: ${count}`)] : []),
    '',
  ];

  for (const result of summary.results) {
    lines.push(`## ${result.passed ? 'PASS' : 'FAIL'} ${result.id}`);
    lines.push('');
    lines.push(`- taxonomy: ${result.taxonomy}`);
    if (result.routeTags && result.routeTags.length > 0) lines.push(`- routeTags: ${result.routeTags.join(', ')}`);
    if (result.routeRisk) lines.push(`- routeRisk: ${result.routeRisk}`);
    lines.push(`- source: ${result.source}`);
    lines.push(`- confidence: ${result.confidence.toFixed(2)}`);
    lines.push(`- reason: ${result.reason}`);
    lines.push('');
    if (result.failures.length > 0) {
      lines.push('Failures:');
      for (const failure of result.failures) lines.push(`- ${failure}`);
      lines.push('');
    }
    lines.push('Replies:');
    for (const reply of result.replies) {
      lines.push('');
      lines.push('```text');
      lines.push(reply.trim());
      lines.push('```');
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function isReplayableCandidate(value: MinedRegressionCandidate): boolean {
  return !!value
    && typeof value.id === 'string'
    && typeof value.taxonomy === 'string'
    && typeof value.sessionId === 'string'
    && Array.isArray(value.seed)
    && Array.isArray(value.turns)
    && Array.isArray(value.checks);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function hashLite(text: string): string {
  let h = 0;
  for (const ch of text) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(16).padStart(8, '0').slice(0, 8);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const candidates = selectReplayCandidates(loadCandidateReplayFile(args.candidatesPath), args);
  const dataDir = join(__dirname, '.data', 'companion-candidate-replay');
  if (!args.keepData) rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  process.env.MIO_DIR = dataDir;
  process.env.MINIMAX_DISABLE ??= 'true';
  if (args.provider) process.env.MIO_PROVIDER = args.provider;
  if (args.model) process.env.COLA_MODEL = args.model;

  const { ensureBankStructure } = await import('../dist/memory/bank.js');
  const { selectProvider } = await import('../dist/providers/index.js');
  ensureBankStructure();

  const providerName = args.provider ?? process.env.MIO_PROVIDER ?? 'mock';
  const provider = selectProvider(providerName, args.model);
  const results: CandidateReplayResult[] = [];

  console.log(`Mio companion candidate replay: provider=${provider.name}, candidates=${candidates.length}`);
  for (const candidate of candidates) {
    process.stdout.write(`  ${candidate.id} ${candidate.taxonomy} ... `);
    try {
      const result = await runCandidate(candidate, provider);
      results.push(result);
      console.log(result.passed ? 'PASS' : `FAIL (${result.failures.length})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        id: candidate.id,
        taxonomy: candidate.taxonomy,
        source: candidate.source,
        sessionId: candidate.sessionId,
        confidence: candidate.confidence,
        routeRisk: candidate.routeRisk,
        routeTags: candidate.routeTags,
        passed: false,
        skipped: false,
        replies: [],
        failures: [`candidate replay error: ${msg}`],
        reason: candidate.reason,
      });
      console.log(`ERROR ${msg}`);
    }
  }

  writeReports(args.resultDir, results, args, provider.name);
  const failed = results.filter((result) => !result.passed && !result.skipped);
  console.log(`\nReport: ${join(args.resultDir, 'report.md')}`);
  console.log(`Summary: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length > 0) process.exit(1);
}

function countByFlat<T>(items: T[], keyFn: (item: T) => string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const key of keyFn(item)) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

if (basename(process.argv[1] ?? '') === basename(__filename)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
