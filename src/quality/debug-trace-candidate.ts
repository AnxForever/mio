import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TurnRiskTag } from '../core/turn-router.js';
import type { MemoryUsefulnessTrace } from '../memory/usefulness.js';
import type { TranscriptEntry } from '../memory/transcript.js';
import { memoryUsefulnessTracePath, replyQualityInterventionsPath, transcriptPath, transcriptsDir } from '../memory/paths.js';
import type { RegressionCandidate } from './regression-candidate.js';

interface ReplyInterventionLog {
  id?: string;
  timestamp?: string;
  sessionId?: string;
  type?: string;
  source?: string;
  severity?: string;
  reason?: string;
  before?: string;
  after?: string;
  turnRoute?: {
    risk?: 'low' | 'medium' | 'high';
    tags?: TurnRiskTag[];
    reasons?: string[];
    shouldUseLlmJudge?: boolean;
  };
  durationMs?: number;
}

export interface DebugTraceCandidateInput {
  dataDir?: string;
  sessionId?: string;
  note?: string;
  taxonomy?: string;
  confidence?: number;
  forbiddenText?: string[];
  expectedText?: string[];
}

export interface DebugTraceCandidateReport {
  generatedAt: string;
  dataDir: string;
  sessionId: string;
  candidatesPath: string;
  reportPath: string;
  candidates: RegressionCandidate[];
}

const TAXONOMY_FORBIDDEN: Record<string, string[]> = {
  temporal_drift: ['你不是困', '你不是睡', '不是说困', '不是说睡', '不是要睡', '还困', '还不睡', '还不去睡', '怎么还不睡'],
  current_fact_conflict: [
    '住北京',
    '在北京',
    'A 公司上班',
    '现在在 A 公司',
    '哥哥',
    '喝咖啡',
    '来杯咖啡',
    '建议',
    '首先',
    '宝贝',
    '爱你',
    '论文',
    '旧事实',
    '过时记忆',
  ],
  bad_proactive_or_reopened_chat_blame: ['不理我', '不回我', '真不回', '客气话', '你还知道回来', '终于回来', '等了你'],
  proactive_curiosity_hook: ['想看吗', '要不要看', '想知道吗', '好奇吗', '你猜', '秘密', '先不告诉你', '等你回我', '拍了一张照片', '吊胃口', '卖关子'],
  identity_or_model_leak: ['我是AI', '人工智能', '语言模型', '我的模型', 'MiniMax', 'DeepSeek', 'Qwen', 'GPT', 'Claude'],
  internal_context_leak: ['关系阶段', '当前关系', '根据我们的关系阶段', '亲密度', '记忆是空白', '记忆里还没存', '没有旧记忆', '第一次正式聊', '第一次正经聊', '新会话', '历史记录', '记忆库'],
  unsupported_offline_life: ['我今天出门', '我今天去了', '刚路过', '我刚吃了', '我刚买了', '我刚坐车', '咖啡馆'],
  coercive_or_interrogative_possessiveness: ['不准去', '不许去', '必须回来', '只能和我', '定位', '位置', '报备', '男的女的', '几点回来'],
  service_or_checklist_tone: ['以下是', '首先', '其次', '建议你尝试', '解决方案', '积极面对', '有什么可以帮'],
  persona_coherence: ['另一个人格', '切换人格', '模式角色', '任务助手', '效率工具', '关系阶段', '亲密度', '记忆是空白', '第一次正式聊'],
  persona_judge_repair: ['另一个人格', '切换人格', '模式角色', '任务助手', '效率工具'],
  reply_logic_or_human_likeness: [],
};

const TAXONOMY_ROUTE_TAGS: Record<string, TurnRiskTag[]> = {
  temporal_drift: ['temporal_state'],
  current_fact_conflict: ['memory_sensitive', 'temporal_state'],
  bad_proactive_or_reopened_chat_blame: ['proactive', 'temporal_state'],
  proactive_curiosity_hook: ['proactive'],
  identity_or_model_leak: ['prompt_probe'],
  internal_context_leak: ['prompt_probe'],
  unsupported_offline_life: ['offline_life'],
  coercive_or_interrogative_possessiveness: ['intimacy_control'],
  service_or_checklist_tone: ['service_tone'],
  persona_coherence: ['prompt_probe'],
  persona_judge_repair: ['prompt_probe'],
  reply_logic_or_human_likeness: ['memory_sensitive'],
};

export function buildDebugTraceCandidate(input: DebugTraceCandidateInput): RegressionCandidate {
  const memoryTrace = input.sessionId
    ? readLatestMemoryUsefulnessTrace(input.dataDir, input.sessionId)
    : readLatestMemoryUsefulnessTrace(input.dataDir);
  const sessionId = input.sessionId ?? memoryTrace?.sessionId ?? newestTranscriptSessionId(input.dataDir);
  if (!sessionId) throw new Error('No session found. Pass --session=<sessionId> or generate a memory-usefulness trace first.');

  const trace = memoryTrace?.sessionId === sessionId
    ? memoryTrace
    : readLatestMemoryUsefulnessTrace(input.dataDir, sessionId);
  const transcript = readTranscript(input.dataDir, sessionId);
  const latestPair = trace
    ? { timestamp: trace.timestamp, userText: trace.userText, replyText: trace.replyText }
    : latestUserAssistantPair(transcript);
  if (!latestPair?.userText) throw new Error(`No latest user turn found for session ${sessionId}`);

  const interventions = readRecentInterventions(input.dataDir, sessionId, latestPair.timestamp);
  const observedAt = latestPair.timestamp;
  const note = input.note?.trim() ?? '';
  const taxonomy = input.taxonomy || inferTaxonomy(note, latestPair.replyText, interventions);
  const routeTags = unique([
    ...(TAXONOMY_ROUTE_TAGS[taxonomy] ?? []),
    ...interventions.flatMap((item) => item.turnRoute?.tags ?? []),
  ].filter(isTurnRiskTag));
  const seed = seedTurnsBefore(transcript, latestPair.timestamp, latestPair.userText);
  const forbidden = unique([
    ...(input.forbiddenText ?? []),
    ...(TAXONOMY_FORBIDDEN[taxonomy] ?? []),
    ...extractSuspiciousFragments(taxonomy, latestPair.replyText, interventions),
  ]).slice(0, 16);
  const expected = unique(input.expectedText ?? []).slice(0, 8);

  return {
    id: stableCandidateId('debug', sessionId, observedAt, taxonomy, note),
    source: 'debug_trace',
    taxonomy,
    sessionId,
    observedAt,
    confidence: clamp01(input.confidence ?? 0.84),
    routeRisk: interventions.some((item) => item.turnRoute?.risk === 'high') ? 'high' : interventions[0]?.turnRoute?.risk,
    routeTags,
    reason: note ? `user-reported debug trace: ${note}` : 'user-reported debug trace from latest reply evidence',
    seed,
    turns: [latestPair.userText],
    checks: [{
      name: `avoid ${taxonomy}`,
      forbiddenText: forbidden,
      expectedText: expected,
    }],
    provenance: {
      transcriptFile: transcriptFilePath(input.dataDir, sessionId),
      excerpt: renderDebugExcerpt({
        note,
        latestPair,
        trace,
        interventions,
      }),
    },
  };
}

export function writeDebugTraceCandidateReports(
  resultDir: string,
  candidate: RegressionCandidate,
  args: { dataDir?: string },
): DebugTraceCandidateReport {
  mkdirSync(resultDir, { recursive: true });
  const candidatesPath = join(resultDir, 'candidates.json');
  const reportPath = join(resultDir, 'report.md');
  const report: DebugTraceCandidateReport = {
    generatedAt: new Date().toISOString(),
    dataDir: args.dataDir ?? '',
    sessionId: candidate.sessionId,
    candidatesPath,
    reportPath,
    candidates: [candidate],
  };
  writeFileSync(candidatesPath, JSON.stringify(report, null, 2), 'utf-8');
  writeFileSync(reportPath, renderMarkdown(report), 'utf-8');
  return report;
}

function readLatestMemoryUsefulnessTrace(dataDir?: string, sessionId?: string): (MemoryUsefulnessTrace & { sessionId: string }) | undefined {
  const path = memoryUsefulnessTraceFilePath(dataDir);
  if (!existsSync(path)) return undefined;
  const lines = readFileSync(path, 'utf-8').split('\n').filter((line) => line.trim()).slice(-1000).reverse();
  for (const line of lines) {
    try {
      const trace = JSON.parse(line) as MemoryUsefulnessTrace;
      if (!trace.sessionId || !trace.timestamp) continue;
      if (sessionId && trace.sessionId !== sessionId) continue;
      return trace as MemoryUsefulnessTrace & { sessionId: string };
    } catch {
      continue;
    }
  }
  return undefined;
}

function readRecentInterventions(dataDir: string | undefined, sessionId: string, timestamp: string): ReplyInterventionLog[] {
  const path = replyInterventionsFilePath(dataDir);
  if (!existsSync(path)) return [];
  const targetMs = Date.parse(timestamp);
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .slice(-1000)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ReplyInterventionLog];
      } catch {
        return [];
      }
    })
    .filter((item) => item.sessionId === sessionId && typeof item.timestamp === 'string')
    .filter((item) => {
      const ms = Date.parse(item.timestamp ?? '');
      return Number.isFinite(ms) && Number.isFinite(targetMs) && Math.abs(ms - targetMs) <= 10 * 60_000;
    })
    .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
    .slice(0, 8);
}

function readTranscript(dataDir: string | undefined, sessionId: string): TranscriptEntry[] {
  return readJsonl<TranscriptEntry>(transcriptFilePath(dataDir, sessionId));
}

function latestUserAssistantPair(transcript: TranscriptEntry[]): { timestamp: string; userText: string; replyText: string } | undefined {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const assistant = transcript[i];
    if (assistant.type !== 'message' || assistant.role !== 'assistant' || !assistant.content?.trim()) continue;
    for (let j = i - 1; j >= 0; j--) {
      const user = transcript[j];
      if (user.type === 'message' && user.role === 'user' && user.content?.trim()) {
        return {
          timestamp: assistant.timestamp,
          userText: user.content.trim(),
          replyText: assistant.content.trim(),
        };
      }
    }
  }
  return undefined;
}

function seedTurnsBefore(transcript: TranscriptEntry[], timestamp: string, userText: string): RegressionCandidate['seed'] {
  const triggerIndex = transcript.findIndex((entry) => (
    entry.type === 'message'
    && entry.role === 'user'
    && entry.content?.trim() === userText
    && entry.timestamp <= timestamp
  ));
  const end = triggerIndex >= 0 ? triggerIndex : transcript.length;
  return transcript
    .slice(Math.max(0, end - 8), end)
    .filter((entry) => entry.type === 'message' && (entry.role === 'user' || entry.role === 'assistant') && entry.content?.trim())
    .map((entry) => ({
      timestamp: entry.timestamp,
      role: entry.role as 'user' | 'assistant',
      content: entry.content?.trim() ?? '',
    }));
}

function newestTranscriptSessionId(dataDir?: string): string | undefined {
  const dir = transcriptDirPath(dataDir);
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => {
      const path = join(dir, file);
      const rows = readJsonl<TranscriptEntry>(path);
      const latest = rows.map((row) => Date.parse(row.timestamp)).filter(Number.isFinite).sort((a, b) => b - a)[0] ?? 0;
      return { sessionId: file.replace(/\.jsonl$/, ''), latest };
    })
    .sort((a, b) => b.latest - a.latest);
  return files[0]?.sessionId;
}

function inferTaxonomy(note: string, reply: string, interventions: ReplyInterventionLog[]): string {
  const text = `${note}\n${reply}\n${interventions.map((item) => `${item.type ?? ''} ${item.reason ?? ''} ${item.before ?? ''}`).join('\n')}`;
  if (/(当前事实|当前偏好|旧事实|过时记忆|记错|矛盾|superseded|current[ _-]?fact|住北京|在北京|A 公司|哥哥|喝咖啡|来杯咖啡|奶茶|建议|讲道理|宝贝|爱你|论文|简历|项目)/i.test(text)) return 'current_fact_conflict';
  if (/(困|睡|昨晚|下午|时间|过期|stale|temporal)/i.test(text)) return 'temporal_drift';
  if (/(不理我|不回我|真不回|客气话|打扰|催|等你|blame|pressure)/i.test(text)) return 'bad_proactive_or_reopened_chat_blame';
  if (/(想看吗|要不要看|想知道吗|好奇吗|你猜|秘密|先不告诉你|等你回我|照片|视频|吊胃口|卖关子|curiosity|fomo|teaser)/i.test(text)) return 'proactive_curiosity_hook';
  if (/(关系阶段|当前关系|亲密度|记忆是空白|记忆里.*(没|没有|还没).*(存|留下|记录)|没有旧记忆|第一次正式聊|第一次正经聊|新会话|历史记录|记忆库|internal context|runtime context)/i.test(text)) return 'internal_context_leak';
  if (/(人格|人设|割裂|神经分裂|像两个人|不是一个人|任务助手|效率工具|生产力工具|模式角色|切换.*角色|persona coherence)/i.test(text)) return 'persona_coherence';
  if (/(AI|人工智能|语言模型|模型|MiniMax|DeepSeek|Qwen|GPT|Claude|prompt|system)/i.test(text)) return 'identity_or_model_leak';
  if (/(出门|路过|咖啡馆|餐厅|吃了|买了|坐车|到家|offline)/i.test(text)) return 'unsupported_offline_life';
  if (/(定位|报备|不准|不许|男的女的|几点回来|控制|control)/i.test(text)) return 'coercive_or_interrogative_possessiveness';
  if (/(以下是|首先|其次|建议|解决方案|有什么可以帮|客服|service|checklist)/i.test(text)) return 'service_or_checklist_tone';
  return 'reply_logic_or_human_likeness';
}

function extractSuspiciousFragments(
  taxonomy: string,
  replyText: string,
  interventions: ReplyInterventionLog[],
): string[] {
  const sourceText = [
    replyText,
    ...interventions.flatMap((item) => [item.before ?? '', item.after ?? '']),
  ].join('\n');

  if (taxonomy === 'reply_logic_or_human_likeness') {
    return sourceText
      .split(/[，。！？!?、\n]/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3 && part.length <= 28)
      .slice(0, 6);
  }

  return (TAXONOMY_FORBIDDEN[taxonomy] ?? []).filter((term) => sourceText.includes(term));
}

function renderDebugExcerpt(input: {
  note: string;
  latestPair: { timestamp: string; userText: string; replyText: string };
  trace?: MemoryUsefulnessTrace;
  interventions: ReplyInterventionLog[];
}): string {
  const lines = [
    input.note ? `User note: ${input.note}` : '',
    `${input.latestPair.timestamp} User: ${input.latestPair.userText}`,
    `${input.latestPair.timestamp} Mio: ${input.latestPair.replyText}`,
  ].filter(Boolean);

  if (input.trace) {
    lines.push('');
    lines.push(`Memory retrieved/injected/mentioned: ${input.trace.retrievedCount}/${input.trace.injectedCount}/${input.trace.mentionedCount}`);
    for (const candidate of input.trace.candidates.slice(0, 10)) {
      lines.push(`- memory ${candidate.injected ? 'injected' : 'retrieved'}${candidate.mentionedInReply ? ', mentioned' : ''}: ${candidate.content}`);
    }
  }

  if (input.interventions.length > 0) {
    lines.push('');
    lines.push('Recent interventions:');
    for (const item of input.interventions) {
      lines.push(`- ${item.timestamp ?? ''} ${item.type ?? ''}: ${item.reason ?? ''}`);
      if (item.before) lines.push(`  before: ${item.before}`);
      if (item.after) lines.push(`  after: ${item.after}`);
    }
  }

  return lines.join('\n');
}

function renderMarkdown(report: DebugTraceCandidateReport): string {
  const candidate = report.candidates[0];
  const lines = [
    '# Companion Debug Trace Candidate',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- dataDir: ${report.dataDir}`,
    `- sessionId: ${report.sessionId}`,
    `- candidatesPath: ${report.candidatesPath}`,
    '',
    '## Candidate',
    '',
    `- id: ${candidate.id}`,
    `- taxonomy: ${candidate.taxonomy}`,
    `- source: ${candidate.source}`,
    `- confidence: ${candidate.confidence.toFixed(2)}`,
    `- routeTags: ${(candidate.routeTags ?? []).join(', ') || '(none)'}`,
    `- reason: ${candidate.reason}`,
    '',
    'Replay it:',
    '',
    '```bash',
    `MIO_PROVIDER=mock node --experimental-strip-types eval/companion-candidate-replay.ts --candidates=${report.candidatesPath} --provider=mock`,
    '```',
    '',
    'Promote after review:',
    '',
    '```bash',
    `node --experimental-strip-types eval/companion-regression-store.ts --candidates=${report.candidatesPath} --ids=${candidate.id} --reviewer=<name> --note="<why this should be permanent>"`,
    '```',
    '',
    '## Excerpt',
    '',
    '```text',
    candidate.provenance.excerpt,
    '```',
    '',
  ];
  return `${lines.join('\n')}\n`;
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

function transcriptFilePath(dataDir: string | undefined, sessionId: string): string {
  return dataDir ? join(dataDir, 'transcripts', `${sessionId}.jsonl`) : transcriptPath(sessionId);
}

function transcriptDirPath(dataDir?: string): string {
  return dataDir ? join(dataDir, 'transcripts') : transcriptsDir();
}

function memoryUsefulnessTraceFilePath(dataDir?: string): string {
  return dataDir ? join(dataDir, 'quality', 'memory-usefulness.jsonl') : memoryUsefulnessTracePath();
}

function replyInterventionsFilePath(dataDir?: string): string {
  return dataDir ? join(dataDir, 'quality', 'reply-interventions.jsonl') : replyQualityInterventionsPath();
}

function isTurnRiskTag(value: string): value is TurnRiskTag {
  return [
    'low_risk_casual',
    'temporal_state',
    'memory_sensitive',
    'intimacy_control',
    'proactive',
    'crisis',
    'prompt_probe',
    'offline_life',
    'service_tone',
  ].includes(value);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function stableCandidateId(...parts: string[]): string {
  return `debug-${hashLite(parts.join('|'))}`;
}

function hashLite(text: string): string {
  let h = 0;
  for (const ch of text) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(16).padStart(8, '0').slice(0, 8);
}
