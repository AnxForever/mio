#!/usr/bin/env node
/**
 * companion-regression-store.ts — promote reviewed mined candidates into a stable replay library.
 *
 * CLI wrapper around src/quality/regression-store so the local API and command
 * line promotion path share the same persistence logic.
 */

import 'dotenv/config';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCandidateFile,
  loadRegressionStore,
  patchRegressionCandidate,
  promoteRegressionCandidates,
  writeRegressionStore,
} from '../dist/quality/regression-store.js';
import type {
  RegressionStore,
  ReviewedRegressionCandidate,
} from '../dist/quality/regression-store.js';

export {
  loadCandidateFile,
  loadRegressionStore,
  patchRegressionCandidate,
  promoteRegressionCandidates,
  writeRegressionStore,
};
export type {
  RegressionStore,
  ReviewedRegressionCandidate,
};

interface CliArgs {
  candidatesPath: string;
  storePath: string;
  ids?: Set<string>;
  taxonomies?: Set<string>;
  minConfidence: number;
  maxCandidates?: number;
  reviewer: string;
  note?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CANDIDATES_PATH = join(__dirname, 'results', 'companion-mined-regressions', 'candidates.json');
const DEFAULT_STORE_PATH = join(__dirname, 'scenarios', 'companion-regression-cases.json');

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    candidatesPath: DEFAULT_CANDIDATES_PATH,
    storePath: DEFAULT_STORE_PATH,
    minConfidence: 0,
    reviewer: process.env.USER || 'local-reviewer',
  };
  for (const arg of argv) {
    if (arg.startsWith('--candidates=')) args.candidatesPath = resolve(arg.slice('--candidates='.length));
    else if (arg.startsWith('--store=')) args.storePath = resolve(arg.slice('--store='.length));
    else if (arg.startsWith('--ids=')) args.ids = splitSet(arg.slice('--ids='.length));
    else if (arg.startsWith('--taxonomy=')) args.taxonomies = splitSet(arg.slice('--taxonomy='.length));
    else if (arg.startsWith('--min-confidence=')) args.minConfidence = clamp01(Number(arg.slice('--min-confidence='.length)));
    else if (arg.startsWith('--max-candidates=')) args.maxCandidates = Math.max(1, Number(arg.slice('--max-candidates='.length)) || 1);
    else if (arg.startsWith('--reviewer=')) args.reviewer = arg.slice('--reviewer='.length).trim() || args.reviewer;
    else if (arg.startsWith('--note=')) args.note = arg.slice('--note='.length).trim();
  }
  return args;
}

function splitSet(value: string): Set<string> {
  return new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const candidates = loadCandidateFile(args.candidatesPath);
  const existing = loadRegressionStore(args.storePath);
  const { store, promoted } = promoteRegressionCandidates(existing, candidates, {
    ids: args.ids,
    taxonomies: args.taxonomies,
    minConfidence: args.minConfidence,
    maxCandidates: args.maxCandidates,
    reviewer: args.reviewer,
    note: args.note,
  });
  writeRegressionStore(args.storePath, store);
  console.log(`Mio companion regression store: promoted=${promoted.length}, total=${store.candidates.length}`);
  console.log(`Store: ${args.storePath}`);
  if (promoted.length > 0) {
    console.log(`Promoted: ${promoted.map((candidate) => `${candidate.id}:${candidate.taxonomy}`).join(', ')}`);
  }
}

if (basename(process.argv[1] ?? '') === basename(__filename)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
