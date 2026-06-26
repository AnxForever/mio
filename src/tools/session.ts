// tools/session.ts — session 工具（JSONL-backed，适配自 cola-companion）
// 关键变更：session_read/session_search 从 JSONL 文件读取（通过 ../memory/transcript.js）
// 使用 sessionId（非 sessionKey），与 Mio 的 SessionContext 一致

import { randomUUID } from 'node:crypto';
import type { ToolDef, ToolHandler } from '../types.js';
import {
  readTranscript,
  searchTranscript,
  listTranscripts,
  recordMessage,
  markSessionDone,
} from '../memory/transcript.js';

// 重新导出供 agent-loop 使用
export { recordMessage, markSessionDone };

// ─── Child Session 跟踪（内存元数据，消息持久化在 JSONL） ───

interface ChildSession {
  key: string;
  parentSessionId: string;
  agent: string;
  status: 'running' | 'done';
}
const childSessions = new Map<string, ChildSession>();

// ─── Tool Definitions ───

const READ_DEF: ToolDef = {
  name: 'session_read',
  description: 'Read messages from a session transcript. Used by subagents to verify specific moments in today\'s conversation. Supports since/until time windows and projection.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session to read. Omit for current session.' },
      limit: { type: 'number' },
      tail: { type: 'number', description: 'Read last N entries.' },
      projection: { type: 'string', enum: ['raw', 'conversation', 'tools'], description: 'What to return: raw=all, conversation=messages only, tools=tool calls only.' },
      since: { type: 'string', description: 'ISO timestamp — only entries after this.' },
      until: { type: 'string', description: 'ISO timestamp — only entries before this.' },
    },
  },
};

const READ_HANDLER: ToolHandler = async (args, ctx) => {
  const { sessionId: sid, limit, tail, projection, since, until } = args as {
    sessionId?: string; limit?: number; tail?: number; projection?: string; since?: string; until?: string;
  };
  const id = sid ?? ctx.sessionId;
  let entries = readTranscript(id, { since, until });

  // 按 projection 过滤
  if (projection === 'conversation') {
    entries = entries.filter((e) => e.type === 'message');
  } else if (projection === 'tools') {
    entries = entries.filter((e) => e.type === 'tool_call');
  }
  // 'raw' 或 undefined: 保留全部

  // 应用 tail/limit
  if (tail) entries = entries.slice(-tail);
  if (limit) entries = entries.slice(0, limit);

  // 格式化输出
  if (projection === 'tools') {
    return entries.map((e) => `${e.toolName}:${e.toolInput ? JSON.stringify(e.toolInput) : ''}`).join('\n') || '(no tool calls)';
  }

  return entries.map((e) => {
    if (e.type === 'message') return `${e.role}: ${e.content}`;
    if (e.type === 'tool_call') return `[tool_call] ${e.toolName}: ${e.toolInput ? JSON.stringify(e.toolInput) : ''}`;
    if (e.type === 'tool_result') return `[tool_result] ${e.toolName}: ${e.toolOutput}`;
    if (e.type === 'session_end') return '[session_end]';
    if (e.type === 'compaction') return `[compaction] ${e.summary ?? ''}`;
    return `[${e.type}]`;
  }).join('\n') || '(empty transcript)';
};

const SEARCH_DEF: ToolDef = {
  name: 'session_search',
  description: 'Search across a session transcript for a query string.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      sessionId: { type: 'string', description: 'Session to search. Omit for current session.' },
      includeToolOutput: { type: 'boolean' },
    },
    required: ['query'],
  },
};

const SEARCH_HANDLER: ToolHandler = async (args, ctx) => {
  const { query, sessionId: sid } = args as { query?: string; sessionId?: string };
  if (!query) return 'No query provided';
  const id = sid ?? ctx.sessionId;
  const results = searchTranscript(id, query);
  return results.length
    ? results.map((e) => `[${e.timestamp}] ${e.role ?? e.type}: ${(e.content ?? e.toolOutput ?? '').slice(0, 200)}`).join('\n---\n')
    : 'No matches found';
};

const SPAWN_DEF: ToolDef = {
  name: 'session_spawn',
  description: 'Spawn a child subagent session with a given agent type and initial prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Subagent name (explore/planner/worker/reviewer/diary/bank-consolidate/scheduled).' },
      prompt: { type: 'string' },
    },
    required: ['agent', 'prompt'],
  },
};

const SPAWN_HANDLER: ToolHandler = async (args, ctx) => {
  const { agent, prompt } = args as { agent: string; prompt: string };
  const key = randomUUID().slice(0, 8);
  childSessions.set(key, {
    key,
    parentSessionId: ctx.sessionId,
    agent,
    status: 'running',
  });
  // 将初始 prompt 记录到子 session 的 JSONL transcript
  recordMessage(key, { role: 'user', content: prompt, timestamp: new Date().toISOString() });
  // 实际执行由 spawn 执行器异步处理
  return `Spawned subagent ${agent} as session ${key}. Use session_send/session_wait to interact.`;
};

const SEND_DEF: ToolDef = {
  name: 'session_send',
  description: 'Send a message to a running child session.',
  inputSchema: {
    type: 'object',
    properties: { key: { type: 'string' }, message: { type: 'string' } },
    required: ['key', 'message'],
  },
};

const SEND_HANDLER: ToolHandler = async (args) => {
  const { key, message } = args as { key: string; message: string };
  const child = childSessions.get(key);
  if (!child) return `Session not found: ${key}`;
  recordMessage(key, { role: 'user', content: message, timestamp: new Date().toISOString() });
  return `Sent to ${key}`;
};

const WAIT_DEF: ToolDef = {
  name: 'session_wait',
  description: 'Check the status of a child session. Returns the result if done, or running status if still in progress. Does not block.',
  inputSchema: {
    type: 'object',
    properties: { key: { type: 'string' }, timeoutMs: { type: 'number' } },
    required: ['key'],
  },
};

const WAIT_HANDLER: ToolHandler = async (args) => {
  const { key } = args as { key: string };
  const child = childSessions.get(key);
  let isDone: boolean;
  if (child) {
    isDone = child.status === 'done';
  } else {
    // 进程重启后内存丢失，检查 transcript 是否有 session_end
    const entries = readTranscript(key);
    isDone = entries.some((e) => e.type === 'session_end');
  }
  if (isDone) {
    const entries = readTranscript(key);
    const lastAssistant = [...entries].reverse().find((e) => e.type === 'message' && e.role === 'assistant');
    return lastAssistant?.content ?? '(no result)';
  }
  return `Session ${key} still running`;
};

const LIST_DEF: ToolDef = {
  name: 'session_list',
  description: 'List all transcripts and child sessions.',
  inputSchema: { type: 'object', properties: {} },
};

const LIST_HANDLER: ToolHandler = async (_args, ctx) => {
  const transcripts = listTranscripts();
  const children = [...childSessions.values()].filter((c) => c.parentSessionId === ctx.sessionId);
  const lines: string[] = [];
  if (children.length) {
    lines.push('Child sessions:');
    for (const c of children) {
      lines.push(`  [${c.status}] ${c.key} (${c.agent})`);
    }
  }
  if (transcripts.length) {
    lines.push('All transcripts:');
    for (const t of transcripts) {
      lines.push(`  ${t}`);
    }
  }
  return lines.length ? lines.join('\n') : 'No sessions';
};

const CLOSE_DEF: ToolDef = {
  name: 'session_close',
  description: 'Close a child session and mark it as done.',
  inputSchema: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key'],
  },
};

const CLOSE_HANDLER: ToolHandler = async (args) => {
  const { key } = args as { key: string };
  const child = childSessions.get(key);
  if (!child) return `Session not found: ${key}`;
  child.status = 'done';
  markSessionDone(key);
  return `Closed ${key}`;
};

export function registerSessionTools(registry: { register: (def: ToolDef, handler: ToolHandler) => void }): void {
  registry.register(READ_DEF, READ_HANDLER);
  registry.register(SEARCH_DEF, SEARCH_HANDLER);
  registry.register(SPAWN_DEF, SPAWN_HANDLER);
  registry.register(SEND_DEF, SEND_HANDLER);
  registry.register(WAIT_DEF, WAIT_HANDLER);
  registry.register(LIST_DEF, LIST_HANDLER);
  registry.register(CLOSE_DEF, CLOSE_HANDLER);
}

export const SESSION_TOOL_NAMES = ['session_read', 'session_search', 'session_spawn', 'session_send', 'session_wait', 'session_list', 'session_close'];

/** 标记子 session 完成（供 spawn 执行器调用） */
export function finishChildSession(key: string, _result: string): void {
  const child = childSessions.get(key);
  if (child) {
    child.status = 'done';
  }
  markSessionDone(key);
}
