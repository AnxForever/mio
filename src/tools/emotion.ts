// tools/emotion.ts — 情感状态工具（Mio 新增）
// emotion_get: 读取当前情感状态
// emotion_history: 读取情感状态历史（最近 N 条）

import { join } from 'node:path';
import { readFileSyncSafe } from '../memory/bank.js';
import { emotionStatePath, colaDir } from '../memory/paths.js';
import type { ToolDef, ToolHandler, EmotionState } from '../types.js';

/** 情感状态历史 JSONL 文件路径 */
function emotionHistoryPath(): string {
  return join(colaDir(), 'emotion-history.jsonl');
}

/** 读取当前情感状态（从 emotion-state.json） */
function readEmotionState(): EmotionState | null {
  const raw = readFileSyncSafe(emotionStatePath());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EmotionState;
  } catch {
    return null;
  }
}

/** 情感历史条目 */
interface EmotionHistoryEntry {
  timestamp: string;
  state: EmotionState;
}

/** 读取情感状态历史（最近 N 条） */
function readEmotionHistory(limit: number = 10): EmotionHistoryEntry[] {
  const raw = readFileSyncSafe(emotionHistoryPath());
  if (!raw) return [];
  const lines = raw.split('\n').filter((l) => l.trim());
  const entries: EmotionHistoryEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as EmotionHistoryEntry);
    } catch { /* skip malformed */ }
  }
  return entries.slice(-limit);
}

/** 格式化情感状态为可读文本 */
function formatEmotionState(s: EmotionState): string {
  return [
    `My mood: ${s.myMood}`,
    `User mood: ${s.userMood}`,
    `Affection: ${s.affection}`,
    `Energy: ${s.energy}`,
    `Last interaction: ${s.lastInteraction}`,
    `Unresolved thread: ${s.unresolvedThread ?? '(none)'}`,
    `Recent topics: ${s.recentTopics.join(', ') || '(none)'}`,
  ].join('\n');
}

// ─── Tool Definitions ───

const GET_DEF: ToolDef = {
  name: 'emotion_get',
  description: 'Read the current emotion state of Mio, including mood, affection, energy, and recent topics.',
  inputSchema: { type: 'object', properties: {} },
};

const GET_HANDLER: ToolHandler = async () => {
  const state = readEmotionState();
  if (!state) return 'No emotion state recorded yet.';
  return formatEmotionState(state);
};

const HISTORY_DEF: ToolDef = {
  name: 'emotion_history',
  description: 'Read the emotion state history (last N states).',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Number of history entries to return (default 10).' },
    },
  },
};

const HISTORY_HANDLER: ToolHandler = async (args) => {
  const { limit } = args as { limit?: number };
  const entries = readEmotionHistory(limit ?? 10);
  if (entries.length === 0) return 'No emotion history recorded yet.';
  return entries.map((e) => `[${e.timestamp}]\n${formatEmotionState(e.state)}`).join('\n---\n');
};

/** 注册所有情感工具 */
export function registerEmotionTools(registry: { register: (def: ToolDef, handler: ToolHandler) => void }): void {
  registry.register(GET_DEF, GET_HANDLER);
  registry.register(HISTORY_DEF, HISTORY_HANDLER);
}

/** 情感工具名列表 */
export const EMOTION_TOOL_NAMES = ['emotion_get', 'emotion_history'];
