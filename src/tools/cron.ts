// tools/cron.ts — cron/mutter/current_time 工具（适配自 cola-companion，使用 Mio 的 CronTask 类型）

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ToolDef, ToolHandler, CronTask } from '../types.js';
import { colaDir } from '../memory/paths.js';

function cronStorePath(): string { return join(colaDir(), 'cron', 'tasks.json'); }

function loadCrons(): Record<string, CronTask> {
  const p = cronStorePath();
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
  } catch {
    return {};
  }
}

function saveCrons(tasks: Record<string, CronTask>): void {
  const p = cronStorePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(tasks, null, 2), 'utf-8');
}

const CRON_DEF: ToolDef = {
  name: 'cron',
  description: 'Manage scheduled reminders. Creates clock-based or interval-based scheduled prompts that fire later.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'delete', 'enable', 'disable'], description: 'Operation to perform.' },
      schedule: { type: 'string', description: 'Cron expression (e.g. "30 9 * * *") or interval in minutes.' },
      prompt: { type: 'string', description: 'The prompt to fire at schedule time.' },
      name: { type: 'string', description: 'Friendly name for the task.' },
      id: { type: 'string', description: 'Task ID (for delete/enable/disable).' },
    },
    required: ['action'],
  },
};

const CRON_HANDLER: ToolHandler = async (args) => {
  const { action, schedule, prompt, id, name } = args as {
    action: string; schedule?: string; prompt?: string; id?: string; name?: string;
  };
  const tasks = loadCrons();
  switch (action) {
    case 'create': {
      if (!schedule || !prompt) return 'create requires schedule and prompt';
      const tid = randomUUID().slice(0, 8);
      const now = new Date().toISOString();
      tasks[tid] = {
        id: tid,
        name: name ?? 'unnamed',
        cron: schedule,
        prompt,
        enabled: true,
        createdAt: now,
      };
      saveCrons(tasks);
      return `Created cron ${tid} (${name ?? 'unnamed'}): "${schedule}" -> ${prompt.slice(0, 60)}`;
    }
    case 'list': {
      const list = Object.values(tasks);
      return list.length
        ? list.map((t) => `[${t.enabled ? 'on' : 'off'}] ${t.id} (${t.name}): ${t.cron} -> ${t.prompt.slice(0, 50)}`).join('\n')
        : 'No cron tasks';
    }
    case 'delete': {
      if (!id || !tasks[id]) return `Not found: ${id}`;
      delete tasks[id];
      saveCrons(tasks);
      return `Deleted ${id}`;
    }
    case 'enable':
    case 'disable': {
      if (!id || !tasks[id]) return `Not found: ${id}`;
      tasks[id].enabled = action === 'enable';
      saveCrons(tasks);
      return `${action}d ${id}`;
    }
    default:
      return `Unknown action: ${action}`;
  }
};

const MUTTER_DEF: ToolDef = {
  name: 'mutter',
  description: 'Internal monologue / thinking out loud. Use to share reactions mid-task (e.g. "oh this is interesting", "wait this is not right"). Not shown as a direct reply to the user.',
  inputSchema: {
    type: 'object',
    properties: { content: { type: 'string', description: 'The inner thought / reaction.' } },
    required: ['content'],
  },
};

const MUTTER_HANDLER: ToolHandler = async (args) => {
  const { content } = args as { content: string };
  // 碎碎念只记入 transcript，不直接回复用户
  return `(noted: ${content})`;
};

const CURRENT_TIME_DEF: ToolDef = {
  name: 'current_time',
  description: 'Get the current date and time in ISO format.',
  inputSchema: { type: 'object', properties: {} },
};

const CURRENT_TIME_HANDLER: ToolHandler = async () => {
  return new Date().toISOString();
};

export function registerCronTools(registry: { register: (def: ToolDef, handler: ToolHandler) => void }): void {
  registry.register(CRON_DEF, CRON_HANDLER);
  registry.register(MUTTER_DEF, MUTTER_HANDLER);
  registry.register(CURRENT_TIME_DEF, CURRENT_TIME_HANDLER);
}

export const CRON_TOOL_NAMES = ['cron', 'mutter', 'current_time'];

/** 读取所有 cron 任务（供调度器用） */
export function listCronTasks(): CronTask[] {
  return Object.values(loadCrons());
}
