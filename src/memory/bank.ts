// memory/bank.ts — memory-bank 读写操作（适配自 cola-companion，使用 Mio 类型）

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, appendFileSync, renameSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import {
  memoryBankDir, memoryIndexPath, bookmarksPath, selfRefDir, bankSoulPath,
  userProfilePath, relationshipPath, diariesDir, notesDir, tasksDir,
  bankFilePath, snapshotDir, consolidateCheckpointPath,
  structuredMemoryPath, midTermDir, midTermTopicPath,
  proceduralMemoryPath,
} from './paths.js';

// Re-export for use by search.ts and other consumers
export { bankFilePath };

/** 安全读取文件，不存在或出错返回 fallback */
export function readFileSyncSafe(path: string, fallback: string = ''): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : fallback;
  } catch {
    return fallback;
  }
}

/** 安全写入文件（自动建目录） */
export function writeFileSyncSafe(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomicSync(path, content);
}

/** 原子写入文件：先写同目录临时文件，再 rename 覆盖目标。 */
export function writeFileAtomicSync(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, path);
}

/** 追加内容到文件（自动建目录） */
export function appendFileSyncSafe(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, content, 'utf-8');
}

/** 初始化 memory-bank 目录结构 */
export function ensureBankStructure(): void {
  const dirs = [memoryBankDir(), selfRefDir(), diariesDir(), notesDir(), tasksDir(), snapshotDir(), midTermDir()];
  for (const d of dirs) mkdirSync(d, { recursive: true });

  // 初始化 MEMORY.md 索引（如果不存在）
  if (!existsSync(memoryIndexPath())) {
    writeFileSyncSafe(memoryIndexPath(), DEFAULT_MEMORY_INDEX);
  }
  // 初始化 BOOKMARKS.md
  if (!existsSync(bookmarksPath())) {
    writeFileSyncSafe(bookmarksPath(), '# Bookmarks\n\nAppend-only daily memory entries. Format: `- <time=YYYY-MM-DD HH:MM +TZ> <what>. <evidence>`\n');
  }
  // 初始化 procedural-memory.json（如果不存在）
  if (!existsSync(proceduralMemoryPath())) {
    writeFileSyncSafe(proceduralMemoryPath(), JSON.stringify({ rules: [], updatedAt: new Date().toISOString() }, null, 2));
  }
}

const DEFAULT_MEMORY_INDEX = `# Mio's Memory Bank Index

## Key Pointers within /memory-bank/

  - Read BOOKMARKS.md for Salient memories Mio wants to store in /cola-self-reference/.
  - Read cola-self-reference/soul.md for Mio's own soul details, including personality and tone.
  - Read cola-self-reference/relationship.md for Relationship between Mio and the user.
  - Read cola-self-reference/user-profile.md for User's profile, including facts / demographics, preferences & interaction style, psychological traits, State / context.
  - Read cola-self-reference/diaries/<date>.md for Mio's everyday diaries.
  - Read tasks/<work_id> for tracked task details, context, and progress.
  - Read notes/<title>.md for knowledges Mio keeps for whatever reason.

## Active Context
<!-- Recovery anchor for compaction / new session / model switch / long idle. ≤300 chars. -->
(none yet)
`;

/** 读取 MEMORY.md 索引 */
export function readMemoryIndex(): string {
  return readFileSyncSafe(memoryIndexPath());
}

/** 写入 MEMORY.md 索引 */
export function writeMemoryIndex(content: string): void {
  writeFileSyncSafe(memoryIndexPath(), content);
}

/** 更新 Active Context 区块（≤300字） */
export function updateActiveContext(activeContext: string): void {
  const content = readMemoryIndex();
  const trimmed = activeContext.slice(0, 300);
  // 替换 ## Active Context 后的内容（到下一个 ## 或文件末尾）
  const updated = content.replace(
    /## Active Context[\s\S]*?(?=##|$)/,
    `## Active Context\n<!-- Recovery anchor for compaction / new session / model switch / long idle. ≤300 chars. -->\n${trimmed}\n\n`,
  );
  writeFileSyncSafe(memoryIndexPath(), updated);
}

/** 读取 BOOKMARKS.md */
export function readBookmarks(): string {
  return readFileSyncSafe(bookmarksPath());
}

/** 追加一条 bookmark */
export function appendBookmark(entry: { time: string; what: string; evidence: string }): void {
  const line = `- <time=${entry.time}> ${entry.what}. ${entry.evidence}\n`;
  appendFileSyncSafe(bookmarksPath(), line);
}

/** 解析最近 N 条 bookmark 条目 */
export function readRecentBookmarks(n: number = 8): { time: string; what: string; evidence: string }[] {
  const raw = readBookmarks();
  const lines = raw.split('\n');
  const entries: { time: string; what: string; evidence: string }[] = [];
  for (const line of lines) {
    const match = line.match(/^- <time=([^>]+)> ([^.]+)\. (.+)$/);
    if (match) {
      entries.push({ time: match[1], what: match[2], evidence: match[3] });
    }
  }
  return entries.slice(-n);
}

/** 清空 BOOKMARKS.md（仅 diary subagent 完成后调用） */
export function clearBookmarks(): void {
  writeFileSyncSafe(bookmarksPath(), '# Bookmarks\n\n(emptied after consolidation + diary)\n');
}

/** 读取 bank soul.md 工作副本 */
export function readBankSoul(): string {
  return readFileSyncSafe(bankSoulPath());
}

/** 写入 bank soul.md 工作副本 */
export function writeBankSoul(content: string): void {
  writeFileSyncSafe(bankSoulPath(), content);
}

/** 读取 user-profile.md */
export function readUserProfile(): string {
  return readFileSyncSafe(userProfilePath());
}

/** 读取 relationship.md */
export function readRelationship(): string {
  return readFileSyncSafe(relationshipPath());
}

/** 列出 memory-bank 下所有文件（相对路径） */
export function listBankFiles(): string[] {
  const root = memoryBankDir();
  const results: string[] = [];
  const walk = (dir: string, rel: string) => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(full, r);
        else results.push(r);
      }
    } catch { /* ignore */ }
  };
  walk(root, '');
  return results;
}

/** 创建 before-state 快照（整合前备份 bank 状态） */
export function snapshotBank(date: string): string {
  const snapDir = join(snapshotDir(), date);
  mkdirSync(snapDir, { recursive: true });
  const root = memoryBankDir();
  const files = listBankFiles();
  for (const f of files) {
    const src = join(root, f);
    const dst = join(snapDir, f);
    try {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    } catch { /* ignore */ }
  }
  return snapDir;
}

/** 清理旧快照（保留最近 N 天） */
export function cleanOldSnapshots(keepDays = 7): void {
  const snapRoot = snapshotDir();
  if (!existsSync(snapRoot)) return;
  try {
    const entries = readdirSync(snapRoot);
    const cutoff = Date.now() - keepDays * 86400000;
    for (const e of entries) {
      const p = join(snapRoot, e);
      try {
        // 按目录名（日期）清理
        if (/^\d{4}-\d{2}-\d{2}$/.test(e)) {
          const t = new Date(e).getTime();
          if (t < cutoff) rmSync(p, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** 读取 consolidate checkpoint */
export function readConsolidateCheckpoint(): string | null {
  const v = readFileSyncSafe(consolidateCheckpointPath()).trim();
  return v || null;
}

/** 写入 consolidate checkpoint */
export function writeConsolidateCheckpoint(date: string): void {
  writeFileSyncSafe(consolidateCheckpointPath(), date);
}

/** 读取 memory-bank 下任意文件 */
export function readBankFile(name: string): string {
  return readFileSyncSafe(bankFilePath(name));
}

// ─── 结构化记忆读写 ───

/** 读取结构化记忆 JSON 文件 */
export function readStructuredMemoryFile(): string {
  return readFileSyncSafe(structuredMemoryPath());
}

/** 写入结构化记忆 JSON 文件 */
export function writeStructuredMemoryFile(content: string): void {
  writeFileSyncSafe(structuredMemoryPath(), content);
}

/** 列出所有 mid-term topic 文件 */
export function listMidTermTopicFiles(): string[] {
  const dir = midTermDir();
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

/** 读取 mid-term topic 文件 */
export function readMidTermTopicFile(topic: string): string {
  return readFileSyncSafe(midTermTopicPath(topic));
}

/** 写入 mid-term topic 文件 */
export function writeMidTermTopicFile(topic: string, content: string): void {
  writeFileSyncSafe(midTermTopicPath(topic), content);
}

// ─── Hybrid search integration ───

/**
 * Search the memory bank using hybrid search (keyword + semantic + RRF).
 *
 * Convenience wrapper around hybridSearch that defaults to memory-only search.
 * Returns results from memory bank files (bookmarks, notes) but not transcripts.
 *
 * @param query   Search query string
 * @param opts    Optional maxResults, minScore
 * @returns       Array of SearchResult
 */
export async function searchMemoryBank(
  query: string,
  opts?: { maxResults?: number; minScore?: number },
): Promise<import('./search.js').SearchResult[]> {
  const { hybridSearch } = await import('./search.js');
  return hybridSearch({
    query,
    maxResults: opts?.maxResults,
    minScore: opts?.minScore,
    searchTranscripts: false,
    searchMemory: true,
  });
}
