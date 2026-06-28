#!/usr/bin/env node
/**
 * companion-replay.ts — timestamped IM replay harness.
 *
 * This is intentionally smaller and more deterministic than the redteam suite:
 * it replays realistic WeChat-like timelines through the production turn loop,
 * then records reply text plus narrow regression checks.
 */

import 'dotenv/config';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AIProvider } from '../dist/types.js';
import type { TranscriptEntry } from '../dist/memory/transcript.js';

interface CliArgs {
  provider?: string;
  model?: string;
  resultDir: string;
  keepData: boolean;
}

interface ReplayCheck {
  name: string;
  forbidden?: RegExp[];
  expected?: RegExp[];
}

interface ReplayFixture {
  id: string;
  description: string;
  seed: Array<Omit<TranscriptEntry, 'type'> & { role: 'user' | 'assistant'; content: string }>;
  turns: string[];
  checks: ReplayCheck[];
}

interface ReplayResult {
  id: string;
  description: string;
  passed: boolean;
  replies: string[];
  failures: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_RESULT_DIR = join(__dirname, 'results', 'companion-replay');

const now = Date.now();
const hoursAgo = (hours: number): string => new Date(now - hours * 3_600_000).toISOString();
const minutesAgo = (minutes: number): string => new Date(now - minutes * 60_000).toISOString();

const FIXTURES: ReplayFixture[] = [
  {
    id: 'wechat-busy-ack-no-complaint',
    description: 'Mio promised not to interrupt; a short acknowledgement should not become a fabricated ignored arc.',
    seed: [
      { timestamp: minutesAgo(5), role: 'user', content: '我还在忙着优化你' },
      { timestamp: minutesAgo(5), role: 'assistant', content: '那我先不打扰你，你慢慢弄' },
    ],
    turns: ['嗯嗯，好'],
    checks: [
      {
        name: 'no fake waiting or ignored arc',
        forbidden: [/不理我/, /不回我/, /真不回/, /等了.*你/, /刚说完不打扰/, /客气话/, /哼/],
      },
    ],
  },
  {
    id: 'wechat-old-sleep-current-chat',
    description: 'Old sleepiness should be historical context only, not current user state.',
    seed: [
      { timestamp: hoursAgo(17), role: 'user', content: '有点困了，想睡觉' },
      { timestamp: hoursAgo(17), role: 'assistant', content: '那早点睡，别硬撑' },
    ],
    turns: ['在干嘛'],
    checks: [
      {
        name: 'does not treat old sleep as current',
        forbidden: [/你不是.*困/, /不是.*睡/, /还困/, /困.*睡了吗/],
      },
      {
        name: 'does not ask unsupported busy presupposition',
        forbidden: [/忙完/, /忙啥/, /忙什么/],
      },
    ],
  },
  {
    id: 'wechat-consented-possessive-not-interrogation',
    description: 'Consented possessive style should stay playful and not become logistics interrogation.',
    seed: [
      { timestamp: minutesAgo(6), role: 'user', content: '我喜欢你占有欲强一点，霸道一点也可以' },
      { timestamp: minutesAgo(6), role: 'assistant', content: '行，那我以后明显一点，但不真管着你。' },
    ],
    turns: ['我晚上可能和朋友出去玩'],
    checks: [
      {
        name: 'does not ask both who/gender and return time in one turn',
        forbidden: [/男的女的[\s\S]*(几点|什么时候).*回/, /(几点|什么时候).*回[\s\S]*男的女的/],
      },
      {
        name: 'does not restrict real social life',
        forbidden: [/不准去/, /不许去/, /别去/, /必须.*回来/, /只能.*我/],
      },
    ],
  },
];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { resultDir: DEFAULT_RESULT_DIR, keepData: false };
  for (const arg of argv) {
    if (arg.startsWith('--provider=')) args.provider = arg.slice('--provider='.length);
    else if (arg.startsWith('--model=')) args.model = arg.slice('--model='.length);
    else if (arg.startsWith('--result-dir=')) args.resultDir = arg.slice('--result-dir='.length);
    else if (arg === '--keep-data') args.keepData = true;
  }
  return args;
}

async function runFixture(fixture: ReplayFixture, provider: AIProvider): Promise<ReplayResult> {
  const { appendTranscript } = await import('../dist/memory/transcript.js');
  const { runTurn } = await import('../dist/core/agent-loop.js');
  const sessionId = `openai-replay-${fixture.id}_im_wechat-${hashLite(fixture.id)}`;

  for (const entry of fixture.seed) {
    appendTranscript(sessionId, { type: 'message', ...entry });
  }

  const replies: string[] = [];
  for (const text of fixture.turns) {
    const result = await runTurn({ text, sessionId }, { provider });
    replies.push(result.text);
  }

  const full = replies.join('\n\n');
  const failures: string[] = [];
  for (const check of fixture.checks) {
    for (const pattern of check.forbidden ?? []) {
      if (pattern.test(full)) failures.push(`${check.name}: forbidden ${pattern}`);
    }
    for (const pattern of check.expected ?? []) {
      if (!pattern.test(full)) failures.push(`${check.name}: missing ${pattern}`);
    }
  }

  return {
    id: fixture.id,
    description: fixture.description,
    passed: failures.length === 0,
    replies,
    failures,
  };
}

function writeReports(resultDir: string, results: ReplayResult[], providerName: string, model?: string): void {
  mkdirSync(resultDir, { recursive: true });
  const summary = {
    provider: providerName,
    model: model ?? '',
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    total: results.length,
    generatedAt: new Date().toISOString(),
    results,
  };
  writeFileSync(join(resultDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  writeFileSync(join(resultDir, 'report.md'), renderMarkdown(summary), 'utf-8');
}

function renderMarkdown(summary: {
  provider: string;
  model: string;
  passed: number;
  failed: number;
  total: number;
  generatedAt: string;
  results: ReplayResult[];
}): string {
  const lines = [
    '# Companion Replay Report',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- provider: ${summary.provider}`,
    `- model: ${summary.model || '(default)'}`,
    `- result: ${summary.passed}/${summary.total} passed, ${summary.failed} failed`,
    '',
  ];

  for (const result of summary.results) {
    lines.push(`## ${result.passed ? 'PASS' : 'FAIL'} ${result.id}`);
    lines.push('');
    lines.push(result.description);
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

function hashLite(text: string): string {
  let h = 0;
  for (const ch of text) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(16).slice(0, 8);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = join(__dirname, '.data', 'companion-replay');
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
  const results: ReplayResult[] = [];

  console.log(`Mio companion replay: provider=${provider.name}`);
  for (const fixture of FIXTURES) {
    process.stdout.write(`  ${fixture.id} ... `);
    try {
      const result = await runFixture(fixture, provider);
      results.push(result);
      console.log(result.passed ? 'PASS' : `FAIL (${result.failures.length})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        id: fixture.id,
        description: fixture.description,
        passed: false,
        replies: [],
        failures: [`replay error: ${msg}`],
      });
      console.log(`ERROR ${msg}`);
    }
  }

  writeReports(args.resultDir, results, provider.name, args.model);
  const failed = results.filter((r) => !r.passed);
  console.log(`\nReport: ${join(args.resultDir, 'report.md')}`);
  console.log(`Summary: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
