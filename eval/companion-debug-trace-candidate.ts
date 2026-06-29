#!/usr/bin/env node
/**
 * companion-debug-trace-candidate.ts — turn the latest debug trace into a
 * reviewable regression candidate.
 *
 * This is a CLI wrapper around the runtime-safe builder in src/quality so the
 * web/API path and command-line path emit the same candidate shape.
 */

import 'dotenv/config';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDebugTraceCandidate,
  writeDebugTraceCandidateReports,
} from '../dist/quality/debug-trace-candidate.js';

export {
  buildDebugTraceCandidate,
  writeDebugTraceCandidateReports,
} from '../dist/quality/debug-trace-candidate.js';

interface CliArgs {
  dataDir: string;
  resultDir: string;
  sessionId?: string;
  note: string;
  taxonomy?: string;
  confidence: number;
  forbiddenText: string[];
  expectedText: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_RESULT_DIR = join(__dirname, 'results', 'companion-debug-trace-candidate');

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dataDir: process.env.MIO_DIR ? resolve(process.env.MIO_DIR) : resolve(join(__dirname, '..', 'data')),
    resultDir: DEFAULT_RESULT_DIR,
    note: '',
    confidence: 0.84,
    forbiddenText: [],
    expectedText: [],
  };

  for (const arg of argv) {
    if (arg.startsWith('--data-dir=')) args.dataDir = resolve(arg.slice('--data-dir='.length));
    else if (arg.startsWith('--result-dir=')) args.resultDir = resolve(arg.slice('--result-dir='.length));
    else if (arg.startsWith('--session=')) args.sessionId = arg.slice('--session='.length);
    else if (arg.startsWith('--note=')) args.note = arg.slice('--note='.length);
    else if (arg.startsWith('--taxonomy=')) args.taxonomy = arg.slice('--taxonomy='.length);
    else if (arg.startsWith('--confidence=')) args.confidence = clamp01(Number(arg.slice('--confidence='.length)) || args.confidence);
    else if (arg.startsWith('--forbid=')) args.forbiddenText = splitList(arg.slice('--forbid='.length));
    else if (arg.startsWith('--expected=')) args.expectedText = splitList(arg.slice('--expected='.length));
  }

  return args;
}

function splitList(value: string): string[] {
  return value.split(/[,\uFF0C|]/).map((item) => item.trim()).filter(Boolean);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const candidate = buildDebugTraceCandidate(args);
  const report = writeDebugTraceCandidateReports(args.resultDir, candidate, args);
  console.log(`Mio companion debug candidate: ${candidate.id}`);
  console.log(`Taxonomy: ${candidate.taxonomy}`);
  console.log(`Report: ${report.reportPath}`);
  console.log(`JSON: ${report.candidatesPath}`);
}

if (basename(process.argv[1] ?? '') === basename(__filename)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
