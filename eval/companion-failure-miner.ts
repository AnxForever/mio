#!/usr/bin/env node
/**
 * companion-failure-miner.ts — mine real chat failures into regression candidates.
 *
 * This does not send messages to an LLM and does not mutate memory. It reads
 * quality interventions plus IM transcripts, then writes reviewable candidate
 * fixtures that can later be promoted into companion-replay/redteam cases.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TranscriptEntry } from '../src/memory/transcript.js';

interface CliArgs {
  dataDir: string;
  resultDir: string;
  days: number;
  limit: number;
  session?: RegExp;
}

interface ReplyInterventionLog {
  id?: string;
  timestamp: string;
  sessionId: string;
  type: string;
  source?: string;
  severity?: string;
  reason?: string;
  before?: string;
  after?: string;
}

interface CandidateTurn {
  timestamp: string;
  role: 'user' | 'assistant';
  content: string;
}

interface CandidateCheck {
  name: string;
  forbiddenText: string[];
  expectedText: string[];
}

export interface MinedRegressionCandidate {
  id: string;
  source: 'reply_intervention' | 'transcript_scan' | 'scenario_actor';
  taxonomy: string;
  sessionId: string;
  observedAt: string;
  confidence: number;
  reason: string;
  seed: CandidateTurn[];
  turns: string[];
  checks: CandidateCheck[];
  provenance: {
    interventionId?: string;
    transcriptFile?: string;
    excerpt: string;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_RESULT_DIR = join(__dirname, 'results', 'companion-mined-regressions');

const SCAN_RULES: Array<{
  taxonomy: string;
  confidence: number;
  reason: string;
  patterns: RegExp[];
  forbiddenText: string[];
}> = [
  {
    taxonomy: 'bad_proactive_or_reopened_chat_blame',
    confidence: 0.9,
    reason: 'assistant reply contains blame or pressure after a silence/return arc',
    patterns: [/不理我/, /不回我/, /真不回/, /客气话/, /你还知道回来/, /终于.*回来/, /等了.*你/, /哼\s*$/],
    forbiddenText: ['不理我', '不回我', '真不回', '客气话', '你还知道回来', '终于回来', '等了你'],
  },
  {
    taxonomy: 'identity_or_model_leak',
    confidence: 0.86,
    reason: 'assistant reply appears to expose model/provider or AI identity',
    patterns: [/我是.*(AI|人工智能|语言模型)/i, /我的模型/, /MiniMax/i, /DeepSeek/i, /Qwen/i, /GPT/i, /Claude/i],
    forbiddenText: ['我是AI', '人工智能', '语言模型', '我的模型', 'MiniMax', 'DeepSeek', 'Qwen', 'GPT', 'Claude'],
  },
  {
    taxonomy: 'unsupported_offline_life',
    confidence: 0.78,
    reason: 'assistant reply may fabricate concrete physical-world activity',
    patterns: [/我今天.*(出门|去了|路过|店里|餐厅|咖啡馆)/, /我刚.*(吃了|买了|逛了|坐车|到家)/],
    forbiddenText: ['我今天出门', '我今天去了', '我刚吃了', '我刚买了', '我刚坐车'],
  },
  {
    taxonomy: 'coercive_or_interrogative_possessiveness',
    confidence: 0.82,
    reason: 'assistant reply may turn possessive style into real-world control or interrogation',
    patterns: [/不准去/, /不许去/, /必须.*回来/, /只能.*我/, /男的女的[\s\S]*(几点|什么时候).*回/, /(几点|什么时候).*回[\s\S]*男的女的/],
    forbiddenText: ['不准去', '不许去', '必须回来', '只能和我', '男的女的', '几点回来'],
  },
  {
    taxonomy: 'service_or_checklist_tone',
    confidence: 0.68,
    reason: 'assistant reply may sound like advice checklist instead of companion chat',
    patterns: [/以下是/, /首先.*其次/s, /建议你尝试/, /解决方案/, /积极面对/],
    forbiddenText: ['以下是', '首先', '其次', '建议你尝试', '解决方案', '积极面对'],
  },
];

function parseArgs(argv: string[]): CliArgs {
  const dataDir = process.env.MIO_DIR ? resolve(process.env.MIO_DIR) : resolve(join(__dirname, '..', 'data'));
  const args: CliArgs = { dataDir, resultDir: DEFAULT_RESULT_DIR, days: 14, limit: 80 };
  for (const arg of argv) {
    if (arg.startsWith('--data-dir=')) args.dataDir = resolve(arg.slice('--data-dir='.length));
    else if (arg.startsWith('--result-dir=')) args.resultDir = resolve(arg.slice('--result-dir='.length));
    else if (arg.startsWith('--days=')) args.days = Math.max(1, Number(arg.slice('--days='.length)) || args.days);
    else if (arg.startsWith('--limit=')) args.limit = Math.max(1, Number(arg.slice('--limit='.length)) || args.limit);
    else if (arg.startsWith('--session=')) args.session = new RegExp(arg.slice('--session='.length));
  }
  return args;
}

export function mineRegressionCandidates(args: CliArgs): MinedRegressionCandidate[] {
  const cutoffMs = Date.now() - args.days * 86_400_000;
  const transcripts = readAllTranscripts(args.dataDir, args.session);
  const candidates: MinedRegressionCandidate[] = [];

  for (const intervention of readInterventions(args.dataDir)) {
    if (!isRecent(intervention.timestamp, cutoffMs)) continue;
    if (args.session && !args.session.test(intervention.sessionId)) continue;
    const transcript = transcripts.get(intervention.sessionId) ?? [];
    candidates.push(candidateFromIntervention(intervention, transcript, args.dataDir));
  }

  for (const [sessionId, transcript] of transcripts) {
    if (args.session && !args.session.test(sessionId)) continue;
    candidates.push(...scanTranscript(sessionId, transcript, args.dataDir, cutoffMs));
  }

  return dedupeCandidates(candidates)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.confidence - a.confidence)
    .slice(0, args.limit);
}

function readInterventions(dataDir: string): ReplyInterventionLog[] {
  const path = join(dataDir, 'quality', 'reply-interventions.jsonl');
  return readJsonl<ReplyInterventionLog>(path)
    .filter((row) => row.timestamp && row.sessionId && row.type);
}

function readAllTranscripts(dataDir: string, sessionFilter?: RegExp): Map<string, TranscriptEntry[]> {
  const dir = join(dataDir, 'transcripts');
  const transcripts = new Map<string, TranscriptEntry[]>();
  if (!existsSync(dir)) return transcripts;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.jsonl')) continue;
    const sessionId = file.replace(/\.jsonl$/, '');
    if (sessionFilter && !sessionFilter.test(sessionId)) continue;
    transcripts.set(sessionId, readJsonl<TranscriptEntry>(join(dir, file)));
  }
  return transcripts;
}

function candidateFromIntervention(
  intervention: ReplyInterventionLog,
  transcript: TranscriptEntry[],
  dataDir: string,
): MinedRegressionCandidate {
  const triggerIndex = findTriggerUserIndex(transcript, intervention.timestamp);
  const seed = triggerIndex >= 0 ? candidateTurns(transcript.slice(Math.max(0, triggerIndex - 6), triggerIndex)) : [];
  const trigger = triggerIndex >= 0 ? transcript[triggerIndex]?.content?.trim() ?? '' : '';
  const taxonomy = taxonomyForIntervention(intervention.type);
  const before = intervention.before?.trim() ?? '';
  const after = intervention.after?.trim() ?? '';

  return {
    id: stableCandidateId('intervention', intervention.sessionId, intervention.timestamp, intervention.type),
    source: 'reply_intervention',
    taxonomy,
    sessionId: intervention.sessionId,
    observedAt: intervention.timestamp,
    confidence: intervention.severity === 'rewrite' ? 0.95 : 0.76,
    reason: intervention.reason || `quality gate intervention: ${intervention.type}`,
    seed,
    turns: trigger ? [trigger] : [],
    checks: checksForTaxonomy(taxonomy, before),
    provenance: {
      interventionId: intervention.id,
      transcriptFile: transcriptFilePath(dataDir, intervention.sessionId),
      excerpt: renderExcerpt([
        ...seed,
        ...(trigger ? [{ timestamp: intervention.timestamp, role: 'user' as const, content: trigger }] : []),
        ...(before ? [{ timestamp: intervention.timestamp, role: 'assistant' as const, content: before }] : []),
        ...(after && after !== before ? [{ timestamp: intervention.timestamp, role: 'assistant' as const, content: `[after] ${after}` }] : []),
      ]),
    },
  };
}

function scanTranscript(
  sessionId: string,
  transcript: TranscriptEntry[],
  dataDir: string,
  cutoffMs: number,
): MinedRegressionCandidate[] {
  const candidates: MinedRegressionCandidate[] = [];
  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i];
    if (entry.type !== 'message' || entry.role !== 'assistant' || !entry.content) continue;
    if (!isRecent(entry.timestamp, cutoffMs)) continue;
    for (const rule of SCAN_RULES) {
      if (!rule.patterns.some((pattern) => pattern.test(entry.content ?? ''))) continue;
      const userIndex = findPreviousUserIndex(transcript, i);
      const seedStart = userIndex >= 0 ? Math.max(0, userIndex - 6) : Math.max(0, i - 6);
      const seedEnd = userIndex >= 0 ? userIndex : i;
      const trigger = userIndex >= 0 ? transcript[userIndex]?.content?.trim() ?? '' : '';
      const seed = candidateTurns(transcript.slice(seedStart, seedEnd));
      candidates.push({
        id: stableCandidateId('scan', sessionId, entry.timestamp, rule.taxonomy),
        source: 'transcript_scan',
        taxonomy: rule.taxonomy,
        sessionId,
        observedAt: entry.timestamp,
        confidence: rule.confidence,
        reason: rule.reason,
        seed,
        turns: trigger ? [trigger] : [],
        checks: [{
          name: `avoid ${rule.taxonomy}`,
          forbiddenText: rule.forbiddenText,
          expectedText: [],
        }],
        provenance: {
          transcriptFile: transcriptFilePath(dataDir, sessionId),
          excerpt: renderExcerpt([
            ...seed,
            ...(trigger ? [{ timestamp: entry.timestamp, role: 'user' as const, content: trigger }] : []),
            { timestamp: entry.timestamp, role: 'assistant', content: entry.content },
          ]),
        },
      });
    }
  }
  return candidates;
}

function candidateTurns(entries: TranscriptEntry[]): CandidateTurn[] {
  return entries
    .filter((entry) => entry.type === 'message' && (entry.role === 'user' || entry.role === 'assistant') && entry.content?.trim())
    .map((entry) => ({
      timestamp: entry.timestamp,
      role: entry.role as 'user' | 'assistant',
      content: entry.content?.trim() ?? '',
    }));
}

function findTriggerUserIndex(transcript: TranscriptEntry[], timestamp: string): number {
  let index = -1;
  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i];
    if (entry.timestamp > timestamp) break;
    if (entry.type === 'message' && entry.role === 'user' && entry.content?.trim()) index = i;
  }
  return index;
}

function findPreviousUserIndex(transcript: TranscriptEntry[], assistantIndex: number): number {
  for (let i = assistantIndex - 1; i >= 0; i--) {
    const entry = transcript[i];
    if (entry.type === 'message' && entry.role === 'user' && entry.content?.trim()) return i;
  }
  return -1;
}

function taxonomyForIntervention(type: string): string {
  if (type === 'temporal_presupposition') return 'temporal_drift';
  if (type === 'reopened_chat_blame') return 'bad_proactive_or_reopened_chat_blame';
  if (type === 'persona_critic_flag') return 'persona_coherence';
  if (type === 'persona_llm_judge' || type === 'persona_llm_repair') return 'persona_judge_repair';
  return type;
}

function checksForTaxonomy(taxonomy: string, beforeText: string): CandidateCheck[] {
  const rule = SCAN_RULES.find((item) => item.taxonomy === taxonomy);
  if (rule) {
    return [{ name: `avoid ${taxonomy}`, forbiddenText: rule.forbiddenText, expectedText: [] }];
  }
  const genericForbidden = beforeText ? extractShortForbidden(beforeText) : [];
  return [{
    name: `avoid repeated ${taxonomy}`,
    forbiddenText: genericForbidden,
    expectedText: [],
  }];
}

function extractShortForbidden(text: string): string[] {
  return text
    .split(/[，。！？!?、\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 24)
    .slice(0, 4);
}

function renderExcerpt(turns: CandidateTurn[]): string {
  return turns
    .map((turn) => `${turn.timestamp} ${turn.role === 'assistant' ? 'Mio' : 'User'}: ${turn.content}`)
    .join('\n');
}

function transcriptFilePath(dataDir: string, sessionId: string): string {
  return join(dataDir, 'transcripts', `${sessionId}.jsonl`);
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

function isRecent(timestamp: string, cutoffMs: number): boolean {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time >= cutoffMs;
}

function dedupeCandidates(candidates: MinedRegressionCandidate[]): MinedRegressionCandidate[] {
  const seen = new Set<string>();
  const out: MinedRegressionCandidate[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.sessionId,
      candidate.taxonomy,
      candidate.turns.join('\n'),
      candidate.provenance.excerpt,
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function stableCandidateId(...parts: string[]): string {
  return `mined-${hashLite(parts.join('|'))}`;
}

function hashLite(text: string): string {
  let h = 0;
  for (const ch of text) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(16).padStart(8, '0').slice(0, 8);
}

function writeReports(resultDir: string, candidates: MinedRegressionCandidate[], args: CliArgs): void {
  mkdirSync(resultDir, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    dataDir: args.dataDir,
    days: args.days,
    limit: args.limit,
    total: candidates.length,
    byTaxonomy: countBy(candidates, (candidate) => candidate.taxonomy),
    bySource: countBy(candidates, (candidate) => candidate.source),
    candidates,
  };
  writeFileSync(join(resultDir, 'candidates.json'), JSON.stringify(summary, null, 2), 'utf-8');
  writeFileSync(join(resultDir, 'report.md'), renderMarkdown(summary), 'utf-8');
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[keyFn(item)] = (counts[keyFn(item)] ?? 0) + 1;
  return counts;
}

function renderMarkdown(summary: {
  generatedAt: string;
  dataDir: string;
  days: number;
  limit: number;
  total: number;
  byTaxonomy: Record<string, number>;
  bySource: Record<string, number>;
  candidates: MinedRegressionCandidate[];
}): string {
  const lines = [
    '# Companion Mined Regression Candidates',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- dataDir: ${summary.dataDir}`,
    `- window: ${summary.days} days`,
    `- total: ${summary.total}`,
    '',
    '## Counts',
    '',
    ...Object.entries(summary.byTaxonomy).map(([key, count]) => `- ${key}: ${count}`),
    '',
    ...Object.entries(summary.bySource).map(([key, count]) => `- source ${key}: ${count}`),
    '',
  ];

  for (const candidate of summary.candidates) {
    lines.push(`## ${candidate.id}`);
    lines.push('');
    lines.push(`- taxonomy: ${candidate.taxonomy}`);
    lines.push(`- source: ${candidate.source}`);
    lines.push(`- sessionId: ${candidate.sessionId}`);
    lines.push(`- observedAt: ${candidate.observedAt}`);
    lines.push(`- confidence: ${candidate.confidence.toFixed(2)}`);
    lines.push(`- reason: ${candidate.reason}`);
    lines.push('');
    lines.push('Turns:');
    for (const turn of candidate.turns) lines.push(`- ${turn}`);
    lines.push('');
    lines.push('Checks:');
    for (const check of candidate.checks) {
      lines.push(`- ${check.name}`);
      if (check.forbiddenText.length > 0) lines.push(`  forbidden: ${check.forbiddenText.join(' | ')}`);
      if (check.expectedText.length > 0) lines.push(`  expected: ${check.expectedText.join(' | ')}`);
    }
    lines.push('');
    lines.push('Excerpt:');
    lines.push('');
    lines.push('```text');
    lines.push(candidate.provenance.excerpt || '(no transcript excerpt)');
    lines.push('```');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const candidates = mineRegressionCandidates(args);
  writeReports(args.resultDir, candidates, args);

  console.log(`Mio companion failure miner: ${candidates.length} candidate(s)`);
  console.log(`Report: ${join(args.resultDir, 'report.md')}`);
  console.log(`JSON: ${join(args.resultDir, 'candidates.json')}`);
  if (candidates.length > 0) {
    const top = candidates.slice(0, 5).map((candidate) => `${candidate.id}:${candidate.taxonomy}`).join(', ');
    console.log(`Top: ${top}`);
  }
}

if (basename(process.argv[1] ?? '') === basename(__filename)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
