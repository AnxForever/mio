import type { SessionContext } from '../types.js';
import { pluginRegistry, BUILTIN_PLUGINS } from '../plugins/index.js';
import { toolRegistry } from '../tools/registry.js';
import { registerEmotionTools } from '../tools/emotion.js';
import { registerCronTools } from '../tools/cron.js';
import { registerFileTools } from '../tools/file.js';
import { registerSessionTools } from '../tools/session.js';
import { registerWorkTools } from '../tools/work.js';
import { registerRecallTools } from '../tools/recall.js';
import { registerKnowledgeTools } from '../tools/knowledge.js';

export interface ToolRegistryLike {
  listDefs(names?: string[]): { name: string; description: string; inputSchema: Record<string, unknown> }[];
  execute(
    call: { id: string; name: string; input: Record<string, unknown> },
    ctx: SessionContext,
  ): Promise<{ id: string; name: string; output: string; isError?: boolean }>;
}

const ISOLATED_SESSION_TOOL_NAMES = new Set(['current_time']);

/**
 * Return a registry view scoped to the current session.
 *
 * External IM bridge sessions are contact-isolated. They must not see or call
 * tools that can read shared memory, transcripts, files, emotion state, cron
 * tasks, or work ledgers.
 */
export function scopedToolRegistry(
  registry: ToolRegistryLike,
  ctx: SessionContext,
): ToolRegistryLike {
  if (ctx.isolatedMemory !== true) return registry;

  return {
    listDefs(names?: string[]) {
      const requested = names
        ? names.filter((name) => ISOLATED_SESSION_TOOL_NAMES.has(name))
        : [...ISOLATED_SESSION_TOOL_NAMES];
      return registry.listDefs(requested);
    },
    async execute(call, execCtx) {
      if (!ISOLATED_SESSION_TOOL_NAMES.has(call.name)) {
        return {
          id: call.id,
          name: call.name,
          output: `Tool "${call.name}" is not available in isolated IM contact sessions.`,
          isError: true,
        };
      }
      return registry.execute(call, execCtx);
    },
  };
}

let toolsRegistered = false;
let pluginsLoaded = false;

/** Load builtin plugins once per process. */
export async function ensurePluginsLoaded(): Promise<void> {
  if (pluginsLoaded) return;
  for (const plugin of BUILTIN_PLUGINS) {
    try { await pluginRegistry().register(plugin); } catch { /* duplicate */ }
  }
  pluginsLoaded = true;
}

/**
 * Register all built-in tools exactly once per process.
 *
 * Idempotent. Called from inside the loop on first turn.
 */
export function ensureToolsRegistered(): ToolRegistryLike {
  const reg = toolRegistry();
  if (toolsRegistered) return reg;
  registerFileTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerSessionTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerCronTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerWorkTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerEmotionTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerRecallTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerKnowledgeTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  toolsRegistered = true;
  return reg;
}
