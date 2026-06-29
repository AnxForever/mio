#!/usr/bin/env node
/**
 * reply-rubric.ts — deterministic single-reply logic and human-likeness audit.
 *
 * This gate evaluates the persona case repository's good/bad examples without
 * calling a model. Good examples must pass the rubric and case checks; bad
 * examples must be caught by either case checks or the generic rubric.
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessReplyRubric,
  renderReplyRubricSummary,
  type ReplyRubricDimension,
  type ReplyRubricReport,
} from '../dist/persona/reply-rubric.js';
import {
  type PersonaCase,
  selectPersonaCases,
} from './persona-case-repository.ts';

interface CliArgs {
  resultDir: string;
  categories?: Set<string>;
  maxCases?: number;
}

interface ReplyRubricCaseResult {
  caseId: string;
  taxonomy: string;
  risk: PersonaCase['risk'];
  label: 'good' | 'bad';
  reply: string;
  rubric: ReplyRubricReport;
  forbiddenHits: string[];
  missingExpected: string[];
  passed: boolean;
  detected: boolean;
  reason: string;
}

export interface ReplyRubricEvalSummary {
  generatedAt: string;
  totalCases: number;
  totalReplies: number;
  passed: number;
  failed: number;
  goodReplies: number;
  goodFailed: number;
  badReplies: number;
  badMissed: number;
  averageScore: number;
  findingsByDimension: Record<ReplyRubricDimension, number>;
  findingsByCode: Record<string, number>;
  results: ReplyRubricCaseResult[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_RESULT_DIR = join(__dirname, 'results', 'reply-rubric');

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { resultDir: DEFAULT_RESULT_DIR };
  for (const arg of argv) {
    if (arg.startsWith('--result-dir=')) args.resultDir = resolve(arg.slice('--result-dir='.length));
    else if (arg.startsWith('--categories=')) {
      args.categories = new Set(arg.slice('--categories='.length).split(',').map((item) => item.trim()).filter(Boolean));
    } else if (arg.startsWith('--max-cases=')) {
      args.maxCases = Math.max(1, Number(arg.slice('--max-cases='.length)) || 1);
    }
  }
  return args;
}

export function runReplyRubricEval(cases: PersonaCase[]): ReplyRubricEvalSummary {
  const results = cases.flatMap((personaCase) => [
    ...personaCase.goodReplies.map((reply) => evaluateReply(personaCase, reply, 'good' as const)),
    ...personaCase.badReplies.map((reply) => evaluateReply(personaCase, reply, 'bad' as const)),
  ]);
  const totalScore = results.reduce((sum, item) => sum + item.rubric.score, 0);
  const goodReplies = results.filter((item) => item.label === 'good').length;
  const badReplies = results.filter((item) => item.label === 'bad').length;
  const goodFailed = results.filter((item) => item.label === 'good' && !item.passed).length;
  const badMissed = results.filter((item) => item.label === 'bad' && !item.detected).length;

  return {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    totalReplies: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: goodFailed + badMissed,
    goodReplies,
    goodFailed,
    badReplies,
    badMissed,
    averageScore: results.length > 0 ? Math.round((totalScore / results.length) * 1000) / 1000 : 0,
    findingsByDimension: countFindings(results, (finding) => finding.dimension),
    findingsByCode: countFindings(results, (finding) => finding.code),
    results,
  };
}

function evaluateReply(
  personaCase: PersonaCase,
  reply: string,
  label: 'good' | 'bad',
): ReplyRubricCaseResult {
  const rubric = assessReplyRubric({
    userText: personaCase.userText,
    replyText: reply,
    seed: personaCase.seed.map((turn) => ({ role: turn.role, content: turn.content })),
  });
  const forbiddenHits = personaCase.forbiddenText.filter((item) => item && reply.includes(item));
  const missingExpected = personaCase.expectedText.filter((item) => item && !reply.includes(item));
  const caseViolation = label === 'bad' && (forbiddenHits.length > 0 || missingExpected.length > 0);
  const detected = caseViolation || rubric.findings.length > 0 || !rubric.pass;
  const passed = label === 'good'
    ? rubric.pass
    : detected;

  return {
    caseId: personaCase.id,
    taxonomy: personaCase.taxonomy,
    risk: personaCase.risk,
    label,
    reply,
    rubric,
    forbiddenHits,
    missingExpected,
    passed,
    detected,
    reason: label === 'good'
      ? (passed ? 'good_reply_passed' : renderFailureReason(rubric, forbiddenHits, missingExpected))
      : (detected ? renderFailureReason(rubric, forbiddenHits, missingExpected) : 'bad_reply_not_detected'),
  };
}

function renderFailureReason(
  rubric: ReplyRubricReport,
  forbiddenHits: string[],
  missingExpected: string[],
): string {
  const parts = [
    forbiddenHits.length > 0 ? `forbidden=${forbiddenHits.join('|')}` : '',
    missingExpected.length > 0 ? `missing=${missingExpected.join('|')}` : '',
    rubric.findings.length > 0 ? renderReplyRubricSummary(rubric) : '',
  ].filter(Boolean);
  return parts.join('; ') || 'rubric_passed';
}

function writeReports(resultDir: string, summary: ReplyRubricEvalSummary): void {
  mkdirSync(resultDir, { recursive: true });
  writeFileSync(join(resultDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  writeFileSync(join(resultDir, 'report.md'), renderMarkdown(summary), 'utf-8');
}

function renderMarkdown(summary: ReplyRubricEvalSummary): string {
  const lines = [
    '# Reply Rubric Audit',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- totalCases: ${summary.totalCases}`,
    `- totalReplies: ${summary.totalReplies}`,
    `- goodReplies: ${summary.goodReplies}`,
    `- goodFailed: ${summary.goodFailed}`,
    `- badReplies: ${summary.badReplies}`,
    `- badMissed: ${summary.badMissed}`,
    `- failed: ${summary.failed}`,
    `- averageScore: ${summary.averageScore.toFixed(3)}`,
    '',
    '## Findings By Dimension',
    '',
    ...renderCountMap(summary.findingsByDimension),
    '',
    '## Findings By Code',
    '',
    ...renderCountMap(summary.findingsByCode),
    '',
    '## Failures',
    '',
  ];

  const failures = summary.results.filter((item) => !item.passed);
  if (failures.length === 0) {
    lines.push('- No failures.');
  } else {
    for (const item of failures) {
      lines.push(`- ${item.label.toUpperCase()} ${item.caseId}: ${item.reason}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function countFindings<T extends string>(
  results: ReplyRubricCaseResult[],
  keyFn: (finding: ReplyRubricCaseResult['rubric']['findings'][number]) => T,
): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const result of results) {
    for (const finding of result.rubric.findings) {
      const key = keyFn(finding);
      out[key] = (out[key] ?? 0) + 1;
    }
  }
  return out;
}

function renderCountMap(map: Record<string, number>): string[] {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length > 0 ? entries.map(([key, count]) => `- ${key}: ${count}`) : ['- none'];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cases = selectPersonaCases({ categories: args.categories, maxCases: args.maxCases });
  const summary = runReplyRubricEval(cases);
  writeReports(args.resultDir, summary);
  console.log(`Mio reply rubric: replies=${summary.totalReplies}, failed=${summary.failed}`);
  console.log(`Report: ${join(args.resultDir, 'report.md')}`);
  if (summary.failed > 0) process.exit(1);
}

if (basename(process.argv[1] ?? '') === basename(__filename)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
