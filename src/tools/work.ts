// tools/work.ts — work 管理工具（适配自 cola-companion：work_create/list/update/complete/delete）

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolDef, ToolHandler, WorkItem } from '../types.js';
import { colaDir, taskPath } from '../memory/paths.js';
import { writeFileSyncSafe, appendFileSyncSafe } from '../memory/bank.js';

function workStorePath(): string { return join(colaDir(), 'work', 'items.json'); }

function loadStore(): Record<string, WorkItem> {
  const p = workStorePath();
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
  } catch {
    return {};
  }
}

function saveStore(items: Record<string, WorkItem>): void {
  const p = workStorePath();
  writeFileSyncSafe(p, JSON.stringify(items, null, 2));
}

const CREATE_DEF: ToolDef = {
  name: 'work_create',
  description: 'Create a work item in the UI ledger. After this, immediately write a task scratchpad file to memory-bank/tasks/<work-id>.md with your understanding of the task.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for the work item.' },
      description: { type: 'string', description: 'What the user asked for and what success looks like.' },
      checklist: { type: 'array', items: { type: 'string' }, description: 'Initial checklist item labels.' },
      comment: { type: 'string' },
    },
    required: ['title', 'description'],
  },
};

const CREATE_HANDLER: ToolHandler = async (args) => {
  const { title, description, checklist, comment } = args as { title: string; description: string; checklist?: string[]; comment?: string };
  const id = randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const item: WorkItem = {
    id, title, description, status: 'todo',
    checklist: (checklist ?? []).map((label) => ({ label, done: false })),
    comments: comment ? [{ at: now, text: comment }] : [],
    artifacts: [], createdAt: now, updatedAt: now,
  };
  const items = loadStore();
  items[id] = item;
  saveStore(items);
  return `Created work item ${id}: ${title}\nNow write your task understanding to memory-bank/tasks/${id}.md`;
};

const LIST_DEF: ToolDef = {
  name: 'work_list',
  description: 'List work items, optionally filtered by status or query.',
  inputSchema: {
    type: 'object',
    properties: {
      workId: { type: 'string' },
      statuses: { type: 'array', items: { type: 'string', enum: ['todo', 'in_progress', 'done', 'skipped'] } },
      query: { type: 'string' },
      limit: { type: 'number' },
    },
  },
};

const LIST_HANDLER: ToolHandler = async (args) => {
  const { workId, statuses, query, limit } = args as { workId?: string; statuses?: string[]; query?: string; limit?: number };
  let items = Object.values(loadStore());
  if (workId) items = items.filter((i) => i.id === workId);
  if (statuses) items = items.filter((i) => statuses.includes(i.status));
  if (query) items = items.filter((i) => i.title.includes(query) || i.description.includes(query));
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (limit) items = items.slice(0, limit);
  return items.length ? items.map((i) => `[${i.status}] ${i.id}: ${i.title}`).join('\n') : 'No work items found';
};

const UPDATE_DEF: ToolDef = {
  name: 'work_update',
  description: 'Update a work item — status, checklist, title, description, or append a comment. Also append progress to the task scratchpad file.',
  inputSchema: {
    type: 'object',
    properties: {
      workId: { type: 'string' },
      status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'skipped'] },
      title: { type: 'string' },
      description: { type: 'string' },
      comment: { type: 'string' },
      markDone: { type: 'array', items: { type: 'string' }, description: 'Checklist labels to mark done.' },
      artifacts: { type: 'array', items: { type: 'string' } },
    },
    required: ['workId'],
  },
};

const UPDATE_HANDLER: ToolHandler = async (args) => {
  const { workId, status, title, description, comment, markDone, artifacts } = args as { workId: string; status?: string; title?: string; description?: string; comment?: string; markDone?: string[]; artifacts?: string[] };
  const items = loadStore();
  const item = items[workId];
  if (!item) return `Work item not found: ${workId}`;
  const now = new Date().toISOString();
  if (status) item.status = status as WorkItem['status'];
  if (title) item.title = title;
  if (description) item.description = description;
  if (comment) item.comments.push({ at: now, text: comment });
  if (markDone) for (const label of markDone) {
    const c = item.checklist.find((c) => c.label === label);
    if (c) c.done = true;
  }
  if (artifacts) item.artifacts.push(...artifacts);
  item.updatedAt = now;
  saveStore(items);
  // 追加进度到 task scratchpad
  if (comment) appendFileSyncSafe(taskPath(workId), `\n## ${now}\n${comment}\n`);
  return `Updated ${workId}`;
};

const COMPLETE_DEF: ToolDef = {
  name: 'work_complete',
  description: 'Mark a work item complete. Appends a final entry to the task scratchpad and updates MEMORY.md Active Context.',
  inputSchema: {
    type: 'object',
    properties: {
      workId: { type: 'string' },
      summary: { type: 'string', description: 'What was done, the outcome, artifacts produced.' },
      comment: { type: 'string' },
      markDone: { type: 'array', items: { type: 'string' } },
      artifacts: { type: 'array', items: { type: 'string' } },
    },
    required: ['workId'],
  },
};

const COMPLETE_HANDLER: ToolHandler = async (args) => {
  const { workId, summary, comment, markDone, artifacts } = args as { workId: string; summary?: string; comment?: string; markDone?: string[]; artifacts?: string[] };
  const items = loadStore();
  const item = items[workId];
  if (!item) return `Work item not found: ${workId}`;
  const now = new Date().toISOString();
  item.status = 'done';
  if (markDone) for (const label of markDone) {
    const c = item.checklist.find((c) => c.label === label);
    if (c) c.done = true;
  }
  if (artifacts) item.artifacts.push(...artifacts);
  item.comments.push({ at: now, text: summary ?? comment ?? 'completed' });
  item.updatedAt = now;
  saveStore(items);
  // 追加最终条目到 task scratchpad
  const finalEntry = `\n## [COMPLETE] ${now}\n${summary ?? comment ?? ''}\nArtifacts: ${(item.artifacts).join(', ') || 'none'}\n`;
  appendFileSyncSafe(taskPath(workId), finalEntry);
  return `Completed ${workId}: ${item.title}\nUpdate MEMORY.md Active Context to reflect completion.`;
};

const DELETE_DEF: ToolDef = {
  name: 'work_delete',
  description: 'Delete a work item from the ledger.',
  inputSchema: {
    type: 'object',
    properties: {
      workId: { type: 'string' },
      deleteOutput: { type: 'boolean' },
    },
    required: ['workId'],
  },
};

const DELETE_HANDLER: ToolHandler = async (args) => {
  const { workId } = args as { workId: string };
  const items = loadStore();
  if (!items[workId]) return `Work item not found: ${workId}`;
  delete items[workId];
  saveStore(items);
  return `Deleted ${workId}`;
};

export function registerWorkTools(registry: { register: (def: ToolDef, handler: ToolHandler) => void }): void {
  registry.register(CREATE_DEF, CREATE_HANDLER);
  registry.register(LIST_DEF, LIST_HANDLER);
  registry.register(UPDATE_DEF, UPDATE_HANDLER);
  registry.register(COMPLETE_DEF, COMPLETE_HANDLER);
  registry.register(DELETE_DEF, DELETE_HANDLER);
}

export const WORK_TOOL_NAMES = ['work_create', 'work_list', 'work_update', 'work_complete', 'work_delete'];
