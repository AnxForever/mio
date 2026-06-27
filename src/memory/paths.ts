/**
 * Mio — memory-bank 路径函数
 * 扩展自 cola-companion，增加 emotion/relationship/transcripts 路径
 */

import { join } from 'node:path';
import { getDataDir, getModsDir } from '../config.js';

/** 数据根目录 */
export function colaDir(): string {
  return getDataDir();
}

/** memory-bank 根目录 */
export function memoryBankDir(): string {
  return join(colaDir(), 'memory-bank');
}

/** MEMORY.md 索引文件 */
export function memoryIndexPath(): string {
  return join(memoryBankDir(), 'MEMORY.md');
}

/** BOOKMARKS.md */
export function bookmarksPath(): string {
  return join(memoryBankDir(), 'BOOKMARKS.md');
}

/** cola-self-reference 目录 */
export function selfRefDir(): string {
  return join(memoryBankDir(), 'cola-self-reference');
}

/** bank soul.md 工作副本 */
export function bankSoulPath(): string {
  return join(selfRefDir(), 'soul.md');
}

/** user-profile.md */
export function userProfilePath(): string {
  return join(selfRefDir(), 'user-profile.md');
}

/** relationship.md */
export function relationshipPath(): string {
  return join(selfRefDir(), 'relationship.md');
}

/** diaries 目录 */
export function diariesDir(): string {
  return join(selfRefDir(), 'diaries');
}

/** 单日 diary */
export function diaryPath(date: string): string {
  return join(diariesDir(), `${date}.md`);
}

/** notes 目录 */
export function notesDir(): string {
  return join(memoryBankDir(), 'notes');
}

/** tasks 目录 */
export function tasksDir(): string {
  return join(memoryBankDir(), 'tasks');
}

/** 单个 task 文件 */
export function taskPath(workId: string): string {
  return join(tasksDir(), `${workId}.md`);
}

/** memory-bank 下任意文件 */
export function bankFilePath(name: string): string {
  return join(memoryBankDir(), name);
}

/** 全局 memory */
export function globalMemoryPath(): string {
  return join(colaDir(), 'memory', 'memory.md');
}

/** mods 目录 */
export function modsDir(): string {
  return getModsDir();
}

/** 某个 MOD 的 soul.md */
export function modSoulPath(modName: string): string {
  return join(modsDir(), modName, 'soul.md');
}

/** persona 知识图谱 JSON 文件 */
export function personaGraphPath(): string {
  return join(memoryBankDir(), 'persona-graph.json');
}

/** 输出目录 */
export function outputDir(): string {
  return join(colaDir(), 'output');
}

/** 夜间整合 checkpoint */
export function consolidateCheckpointPath(): string {
  return join(memoryBankDir(), '.last-bank-consolidate-date');
}

/** before-state 快照目录 */
export function snapshotDir(): string {
  return join(memoryBankDir(), '.snapshots');
}

// ─── 结构化记忆 & 三层记忆路径 ───

/** 结构化记忆文件 (LTM: long-term memory JSON) */
export function structuredMemoryPath(): string {
  return join(memoryBankDir(), 'structured-memory.json');
}

/** Per-user state root. */
export function usersDir(): string {
  return join(colaDir(), 'users');
}

/** Sanitize external session/contact ids before using them in paths. */
export function userDir(userId = 'default'): string {
  return join(usersDir(), safeUserId(userId));
}

/** L2 per-user 人格覆盖文件 */
export function personaDeltaPath(userId = 'default'): string {
  return join(userDir(userId), 'persona-delta.json');
}

/** L3 per-user 偏好文件 */
export function preferencesPath(userId = 'default'): string {
  return join(userDir(userId), 'preferences.json');
}

/** mid-term memory 目录 (MTM: topic-segmented summaries) */
export function midTermDir(): string {
  return join(memoryBankDir(), 'mid-term');
}

/** 单个 mid-term topic 文件 */
export function midTermTopicPath(topic: string): string {
  // Sanitize the topic name for filesystem use
  const safe = topic.replace(/[^a-zA-Z0-9一-鿿_-]/g, '_').slice(0, 64);
  return join(midTermDir(), `${safe}.json`);
}

// ─── Mio 新增路径 ───

/** 运行时情感状态文件 */
export function emotionStatePath(): string {
  return join(colaDir(), 'emotion-state.json');
}

/** 关系进展状态文件 */
export function relationshipStatePath(): string {
  return join(colaDir(), 'relationship-state.json');
}

/** 多轴亲密度状态文件 */
export function affinityStatePath(): string {
  return join(colaDir(), 'affinity-state.json');
}

/** Multi-axis relationship state file */
export function multiAxisPath(): string {
  return join(colaDir(), 'multi-axis-state.json');
}

/** PAD 情感模型状态文件 */
export function padStatePath(): string {
  return join(colaDir(), 'pad-state.json');
}

/** transcripts 目录（JSONL 持久化） */
export function transcriptsDir(): string {
  return join(colaDir(), 'transcripts');
}

/** 单个会话 transcript 文件 */
export function transcriptPath(sessionId: string): string {
  return join(transcriptsDir(), `${sessionId}.jsonl`);
}

function safeUserId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'default';
  const safe = trimmed
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return safe || 'default';
}

/** 仪式状态文件 (Ritual Engine) */
export function ritualStatePath(): string {
  return join(colaDir(), 'ritual-state.json');
}

/** Cardboard 分数状态文件 */
export function cardboardStatePath(): string {
  return join(colaDir(), 'cardboard-state.json');
}

/** 程序性记忆文件 (procedural memory — how to interact) */
export function proceduralMemoryPath(): string {
  return join(memoryBankDir(), 'procedural-memory.json');
}
