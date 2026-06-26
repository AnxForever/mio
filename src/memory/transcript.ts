// memory/transcript.ts — JSONL 持久化 transcript（替代内存存储）

import { readFileSync, existsSync, mkdirSync, readdirSync, appendFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { transcriptPath, transcriptsDir } from './paths.js';
import type { Message } from '../types.js';

// ─── Types ───

export interface TranscriptEntry {
  type: 'message' | 'tool_call' | 'tool_result' | 'session_end' | 'compaction';
  timestamp: string;
  role?: string;
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  isError?: boolean;
  summary?: string;
}

// ─── Core Operations ───

/** 追加一条 entry 到 session transcript JSONL 文件 */
export function appendTranscript(sessionId: string, entry: TranscriptEntry): void {
  const path = transcriptPath(sessionId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
}

/** 读取 session transcript，支持 since/until 时间过滤 */
export function readTranscript(
  sessionId: string,
  opts?: { since?: string; until?: string },
): TranscriptEntry[] {
  const path = transcriptPath(sessionId);
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  let entries: TranscriptEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as TranscriptEntry);
    } catch { /* skip malformed lines */ }
  }
  if (opts?.since) {
    const since = opts.since;
    entries = entries.filter((e) => e.timestamp >= since);
  }
  if (opts?.until) {
    const until = opts.until;
    entries = entries.filter((e) => e.timestamp <= until);
  }
  return entries;
}

/** 在 session transcript 中搜索文本（返回匹配的 entries） */
export function searchTranscript(sessionId: string, query: string): TranscriptEntry[] {
  const entries = readTranscript(sessionId);
  const lower = query.toLowerCase();
  return entries.filter((e) => {
    const text = e.content ?? e.toolOutput ?? '';
    return text.toLowerCase().includes(lower);
  });
}

/**
 * Load the most recent N messages from a transcript as Message objects.
 * Used by agent-loop to provide conversation history/context.
 *
 * Skips session_end and compaction entries; only returns user/assistant messages.
 *
 * @param sessionId  Session to load from.
 * @param maxMsgs    Maximum number of recent messages to return (default 20).
 * @returns          Array of Message objects, oldest first.
 */
export function loadTranscriptWindow(
  sessionId: string,
  maxMsgs: number = 20,
): Message[] {
  const entries = readTranscript(sessionId);
  const messages: Message[] = [];

  for (const entry of entries) {
    if (entry.type === 'message' && entry.role && entry.content) {
      messages.push({
        role: entry.role as Message['role'],
        content: entry.content,
        timestamp: entry.timestamp,
      });
    } else if (entry.type === 'compaction' && entry.summary) {
      // Inject compaction summaries as system messages so the model
      // remembers compressed context.
      messages.push({
        role: 'system',
        content: `[之前的对话摘要]\n${entry.summary}`,
        timestamp: entry.timestamp,
      });
    }
  }

  // Return the most recent N messages
  return messages.slice(-maxMsgs);
}

/** 列出所有 transcript 文件（session ID 列表） */
export function listTranscripts(): string[] {
  const dir = transcriptsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace(/\.jsonl$/, ''));
}

/** 获取最近的 transcript session ID（按文件修改时间） */
export function getLatestSessionId(): string | null {
  const files = listTranscripts();
  if (files.length === 0) return null;
  let latest: string | null = null;
  let latestMtime = 0;
  for (const f of files) {
    try {
      const stat = statSync(transcriptPath(f));
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latest = f;
      }
    } catch { /* ignore */ }
  }
  return latest;
}

/** 记录一条消息到 transcript（便捷封装，供 agent-loop 调用） */
export function recordMessage(sessionId: string, message: Message): void {
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);
  appendTranscript(sessionId, {
    type: 'message',
    timestamp: message.timestamp ?? new Date().toISOString(),
    role: message.role,
    content,
  });
}

/** 标记 session 完成（写入 session_end entry） */
export function markSessionDone(sessionId: string): void {
  appendTranscript(sessionId, {
    type: 'session_end',
    timestamp: new Date().toISOString(),
  });
}

/** 获取最近 N 天内的所有 transcript entries */
export function getRecentTranscripts(days: number): TranscriptEntry[] {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const allEntries: TranscriptEntry[] = [];

  for (const sessionId of listTranscripts()) {
    const entries = readTranscript(sessionId, { since: cutoff });
    allEntries.push(...entries);
  }

  // Sort by timestamp ascending
  allEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return allEntries;
}
