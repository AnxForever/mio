#!/usr/bin/env node
/**
 * eval/health-check.ts — 现状体检 (Phase 0 工作流 A)
 *
 * 对真实/本地 data 出一份"改进前"基线，关掉交接文档的体检 todo。
 * 北极星见 docs/north-star-architecture.md；计划见 docs/superpowers/plans/2026-06-28-phase-0-foundation-eval.md。
 *
 * 设计：只读 data，绝不写 data/。最小耦合——只从 dist 借 assessDepth（纸板分单一真相源），
 * 其余直接按 src/memory/paths.ts 的布局读 JSON/JSONL。纯函数导出供 tests/unit-health-check.ts。
 *
 * 用法：
 *   npm run eval:health                 # 默认 ./data
 *   npm run eval:health -- --data <dir> # 指向拉回的部署机 data
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── 数据口径（对齐 src/memory/transcript.ts / structured-memory / ritual / persona-delta） ───

export interface TranscriptEntryLike {
  type?: string;
  timestamp?: string;
  role?: string;
  content?: string;
}

export interface Exchange {
  user: string;
  assistant: string;
  timestamp: string;
}

export interface CardboardStats {
  count: number;
  mean: number;
  median: number;
  p90: number;
  /** 0–1 分十档计数（bucket[0]=[0,0.1) … bucket[9]=[0.9,1]） */
  histogram: number[];
  /** 按 ISO 周聚合的纸板均值趋势 */
  byWeek: Array<{ week: string; count: number; mean: number }>;
}

export interface RepetitionStats {
  replies: number;
  distinct1: number;
  distinct2: number;
  exactDupRate: number;
  topOpeners: Array<{ opener: string; count: number }>;
}

export interface IsolationReport {
  /** 非 default 用户（IM 联系人/隔离会话）数量 */
  nonDefaultUsers: number;
  /** 非 default 用户的偏好出现在全局记忆里的疑似泄漏 */
  leakFlags: Array<{ userId: string; snippet: string }>;
  leakCount: number;
}

// ─── 纯函数（无 dist 依赖，可单测） ───

/** 从一个 session 的有序 entries 中抽 user→assistant 配对（取 assistant 前最近一条 user，兼容 IM 多条）。 */
export function extractExchanges(entries: TranscriptEntryLike[]): Exchange[] {
  const out: Exchange[] = [];
  let lastUser: TranscriptEntryLike | null = null;
  for (const e of entries) {
    if (e.type !== 'message') continue;
    if (e.role === 'user' && typeof e.content === 'string' && e.content.trim()) {
      lastUser = e;
    } else if (e.role === 'assistant' && typeof e.content === 'string' && e.content.trim()) {
      if (lastUser) {
        out.push({
          user: lastUser.content ?? '',
          assistant: e.content,
          timestamp: e.timestamp ?? lastUser.timestamp ?? '',
        });
        lastUser = null;
      }
    }
  }
  return out;
}

/** ISO 周键 "YYYY-Www"（避开 Date.now，纯解析传入的 ISO 串）。 */
export function weekKey(iso: string): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7; // 周一=0
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3); // 当周周四
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((tmp.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** 语料级 distinct-n（中文按字 n-gram）。返回 unique/total，越低=越重复。 */
export function distinctN(texts: string[], n: number): number {
  const grams = new Map<string, number>();
  let total = 0;
  for (const t of texts) {
    const chars = [...(t ?? '').replace(/\s+/g, '')];
    for (let i = 0; i + n <= chars.length; i++) {
      grams.set(chars.slice(i, i + n).join(''), 1);
      total++;
    }
  }
  return total === 0 ? 0 : grams.size / total;
}

/** 纸板分分布统计（mean/median/p90/直方图/按周趋势）。scores 与 weeks 同序对齐。 */
export function bucketCardboard(scores: number[], weeks: string[] = []): CardboardStats {
  const n = scores.length;
  if (n === 0) {
    return { count: 0, mean: 0, median: 0, p90: 0, histogram: new Array(10).fill(0), byWeek: [] };
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const mean = scores.reduce((s, x) => s + x, 0) / n;
  const median = sorted[Math.floor(n / 2)];
  const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))];
  const histogram = new Array(10).fill(0);
  for (const s of scores) histogram[Math.min(9, Math.max(0, Math.floor(s * 10)))]++;

  const weekMap = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const w = weeks[i] ?? 'unknown';
    (weekMap.get(w) ?? weekMap.set(w, []).get(w)!).push(scores[i]);
  }
  const byWeek = [...weekMap.entries()]
    .map(([week, xs]) => ({ week, count: xs.length, mean: round3(xs.reduce((s, x) => s + x, 0) / xs.length) }))
    .sort((a, b) => a.week.localeCompare(b.week));

  return { count: n, mean: round3(mean), median: round3(median), p90: round3(p90), histogram, byWeek };
}

/** assistant 回复重复度（distinct-1/2 + 精确重复率 + top 开头）。 */
export function summarizeRepetition(replies: string[]): RepetitionStats {
  const norm = replies.map((r) => (r ?? '').trim().toLowerCase()).filter(Boolean);
  const seen = new Map<string, number>();
  let dups = 0;
  for (const r of norm) {
    const c = seen.get(r) ?? 0;
    if (c > 0) dups++;
    seen.set(r, c + 1);
  }
  const openers = new Map<string, number>();
  for (const r of norm) {
    const op = [...r].slice(0, 8).join('');
    if (op) openers.set(op, (openers.get(op) ?? 0) + 1);
  }
  const topOpeners = [...openers.entries()]
    .map(([opener, count]) => ({ opener, count }))
    .filter((o) => o.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    replies: norm.length,
    distinct1: round3(distinctN(norm, 1)),
    distinct2: round3(distinctN(norm, 2)),
    exactDupRate: norm.length === 0 ? 0 : round3(dups / norm.length),
    topOpeners,
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ─── I/O（按 paths.ts 布局直接读 dataDir，只读） ───

function readJsonl(path: string): TranscriptEntryLike[] {
  if (!existsSync(path)) return [];
  const out: TranscriptEntryLike[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as TranscriptEntryLike); } catch { /* skip */ }
  }
  return out;
}

function readJsonSafe<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as T; } catch { return null; }
}

function readTextSafe(path: string): string {
  if (!existsSync(path)) return '';
  try { return readFileSync(path, 'utf-8'); } catch { return ''; }
}

function listJsonl(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f));
}

/**
 * 串户检测：非 default 用户（IM 联系人/隔离会话）的显式偏好不应出现在全局记忆里。
 * default = 本机主用户，其内容本就该全局，故排除。任何非 default 的 per-user 规则
 * 出现在全局 structured-memory/BOOKMARKS/MEMORY 中 = 疑似隔离泄漏，标记待人工核对。
 */
export function analyzeIsolation(dataDir: string, globalMemoryText: string): IsolationReport {
  const usersDir = join(dataDir, 'users');
  const leakFlags: Array<{ userId: string; snippet: string }> = [];
  let nonDefaultUsers = 0;
  if (existsSync(usersDir)) {
    for (const entry of readdirSync(usersDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'default') continue;
      nonDefaultUsers++;
      const prefs = readJsonSafe<{ explicit?: Array<{ rule?: string }> }>(
        join(usersDir, entry.name, 'preferences.json'),
      );
      for (const p of prefs?.explicit ?? []) {
        const rule = (p.rule ?? '').trim();
        // 只查足够独特的规则串，避免泛化词误报
        if (rule.length >= 6 && globalMemoryText.includes(rule)) {
          leakFlags.push({ userId: entry.name, snippet: rule.slice(0, 40) });
        }
      }
    }
  }
  return { nonDefaultUsers, leakFlags, leakCount: leakFlags.length };
}

// ─── 编排（用 dist 的 assessDepth；其余只读文件） ───

export interface HealthReport {
  dataDir: string;
  generatedAt: string;
  volume: { sessions: number; exchanges: number; firstTs: string; lastTs: string };
  cardboard: CardboardStats;
  repetition: RepetitionStats;
  memory: {
    structuredEntities: number;
    durableFacts: number;
    byReviewStatus: Record<string, number>;
    rituals: number;
    promotedRituals: number;
    perUserDirs: number;
    usersWithPersonaDelta: number;
    usersWithPreferences: number;
    relationshipStage: string;
    interactionCount: number;
  };
  isolation: IsolationReport;
  notes: string[];
}

export async function runHealthCheck(dataDir: string, nowIso: string): Promise<HealthReport> {
  // 仅此处借 dist 的单一真相源纸板函数。
  const { assessDepth } = await import('../dist/emotion/ritual.js') as {
    assessDepth: (user: string, reply: string) => number;
  };

  const transcriptsDir = join(dataDir, 'transcripts');
  const files = listJsonl(transcriptsDir);
  const scores: number[] = [];
  const weeks: string[] = [];
  const replies: string[] = [];
  let exchanges = 0;
  let firstTs = '';
  let lastTs = '';
  for (const file of files) {
    const ex = extractExchanges(readJsonl(file));
    for (const x of ex) {
      exchanges++;
      scores.push(assessDepth(x.user, x.assistant));
      weeks.push(weekKey(x.timestamp));
      replies.push(x.assistant);
      if (x.timestamp) {
        if (!firstTs || x.timestamp < firstTs) firstTs = x.timestamp;
        if (!lastTs || x.timestamp > lastTs) lastTs = x.timestamp;
      }
    }
  }

  const notes: string[] = [];
  if (files.length === 0) notes.push('⚠️ transcripts 目录为空——拉回部署机 data/transcripts 后重跑才有真实基线。');

  const structured = readJsonSafe<{ entities?: unknown[]; durableFacts?: unknown[] }>(
    join(dataDir, 'memory-bank', 'structured-memory.json'),
  );
  const entities = (structured?.entities ?? []) as Array<{ reviewStatus?: string }>;
  const byReviewStatus: Record<string, number> = {};
  for (const e of entities) {
    const k = e.reviewStatus ?? 'unknown';
    byReviewStatus[k] = (byReviewStatus[k] ?? 0) + 1;
  }

  const ritualState = readJsonSafe<{ rituals?: Array<{ significance?: number }> }>(
    join(dataDir, 'ritual-state.json'),
  );
  const rituals = ritualState?.rituals ?? [];

  const usersDir = join(dataDir, 'users');
  let perUserDirs = 0;
  let usersWithPersonaDelta = 0;
  let usersWithPreferences = 0;
  if (existsSync(usersDir)) {
    for (const entry of readdirSync(usersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      perUserDirs++;
      if (existsSync(join(usersDir, entry.name, 'persona-delta.json'))) usersWithPersonaDelta++;
      if (existsSync(join(usersDir, entry.name, 'preferences.json'))) usersWithPreferences++;
    }
  }

  const rel = readJsonSafe<{ stage?: string; interactionCount?: number }>(
    join(dataDir, 'relationship-state.json'),
  );

  const globalMemoryText = [
    readTextSafe(join(dataDir, 'memory-bank', 'structured-memory.json')),
    readTextSafe(join(dataDir, 'memory-bank', 'BOOKMARKS.md')),
    readTextSafe(join(dataDir, 'memory-bank', 'MEMORY.md')),
  ].join('\n');
  const isolation = analyzeIsolation(dataDir, globalMemoryText);
  if (isolation.leakCount > 0) {
    notes.push(`⚠️ 疑似串户：${isolation.leakCount} 条非 default 用户的偏好出现在全局记忆里，需人工核对隔离。`);
  }

  return {
    dataDir,
    generatedAt: nowIso,
    volume: { sessions: files.length, exchanges, firstTs: firstTs || 'n/a', lastTs: lastTs || 'n/a' },
    cardboard: bucketCardboard(scores, weeks),
    repetition: summarizeRepetition(replies),
    memory: {
      structuredEntities: entities.length,
      durableFacts: (structured?.durableFacts ?? []).length,
      byReviewStatus,
      rituals: rituals.length,
      promotedRituals: rituals.filter((r) => (r.significance ?? 0) >= 0.3).length,
      perUserDirs,
      usersWithPersonaDelta,
      usersWithPreferences,
      relationshipStage: rel?.stage ?? 'n/a',
      interactionCount: rel?.interactionCount ?? 0,
    },
    isolation,
    notes,
  };
}

export function formatReport(r: HealthReport): string {
  const cb = r.cardboard;
  const histLine = cb.histogram
    .map((c, i) => `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}: ${c}`)
    .join('  ');
  const weekLines = cb.byWeek.map((w) => `| ${w.week} | ${w.count} | ${w.mean} |`).join('\n');
  const openerLines = r.repetition.topOpeners.map((o) => `| \`${o.opener}…\` | ${o.count} |`).join('\n') || '| (无重复开头) | |';
  const reviewLines = Object.entries(r.memory.byReviewStatus).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a';
  return `# Mio 现状体检 (Phase 0 基线)

Generated: ${r.generatedAt}
Data dir: \`${r.dataDir}\`

${r.notes.map((n) => `> ${n}`).join('\n') || '> (无告警)'}

## 体量
- Sessions: ${r.volume.sessions}
- Exchanges (user→assistant 配对): ${r.volume.exchanges}
- 时间跨度: ${r.volume.firstTs} → ${r.volume.lastTs}

## 纸板感 (Cardboard)  — 0=深, 1=纸板
- 均值: **${cb.mean}** | 中位: ${cb.median} | p90: ${cb.p90} | 样本: ${cb.count}
- 直方图: ${histLine}

### 按周趋势（纸板感随时间变好还是变差）
| 周 | 配对数 | 纸板均值 |
|---|---:|---:|
${weekLines || '| (无数据) | | |'}

## 跨会话重复
- assistant 回复数: ${r.repetition.replies}
- distinct-1: ${r.repetition.distinct1} | distinct-2: ${r.repetition.distinct2} （越低越重复）
- 精确重复率: ${r.repetition.exactDupRate}

### 高频开头（"每次都那句"）
| 开头 | 次数 |
|---|---:|
${openerLines}

## 记忆留存
- 结构化 entities: ${r.memory.structuredEntities} (${reviewLines})
- durableFacts: ${r.memory.durableFacts}
- rituals: ${r.memory.rituals}（已晋升 significance≥0.3: ${r.memory.promotedRituals}）
- per-user 目录: ${r.memory.perUserDirs}（有 persona-delta: ${r.memory.usersWithPersonaDelta}，有 preferences: ${r.memory.usersWithPreferences}）
- 关系阶段: ${r.memory.relationshipStage}，互动计数: ${r.memory.interactionCount}

## 串户隔离 (cross-user contamination)
- 非 default 用户数: ${r.isolation.nonDefaultUsers}
- 疑似泄漏到全局的 per-user 偏好: **${r.isolation.leakCount}** ${r.isolation.leakCount > 0 ? '（应为 0；>0 需人工核对隔离）' : '（干净）'}
${r.isolation.leakFlags.map((f) => `  - [${f.userId}] \`${f.snippet}…\``).join('\n')}

---
> 这是 Phase 0 的"改进前"基线。Phase 1–5 每步落地后重跑本脚本，对比 cardboard 均值 / distinct-2 / durableFacts 看是否真的更好。
> 串户(跨用户污染)深度检测留待后续——当前仅报告 per-user 结构计数。
`;
}

function parseArgs(argv: string[]): { dataDir: string; outDir: string } {
  let dataDir = resolve(process.cwd(), 'data');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let outDir = join(__dirname, 'results', 'health');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data' && argv[i + 1]) dataDir = resolve(argv[++i]);
    else if (argv[i] === '--out' && argv[i + 1]) outDir = resolve(argv[++i]);
  }
  return { dataDir, outDir };
}

async function main(): Promise<void> {
  const { dataDir, outDir } = parseArgs(process.argv.slice(2));
  const report = await runHealthCheck(dataDir, new Date().toISOString());
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'health-report.md'), formatReport(report), 'utf-8');
  writeFileSync(join(outDir, 'health-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf-8');
  console.log(`体检完成 → ${join(outDir, 'health-report.md')}`);
  console.log(`纸板均值=${report.cardboard.mean} distinct-2=${report.repetition.distinct2} exchanges=${report.volume.exchanges} durableFacts=${report.memory.durableFacts}`);
}

const isMain = (() => {
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? ''); }
  catch { return false; }
})();
if (isMain) {
  main().catch((err) => { console.error(err instanceof Error ? err.stack : String(err)); process.exit(1); });
}
