import type { SessionContext } from '../types.js';
import { pluginRegistry, BUILTIN_PLUGINS } from '../plugins/index.js';
import { toolRegistry } from '../tools/registry.js';
import { registerEmotionTools } from '../tools/emotion.js';
import { registerCronTools } from '../tools/cron.js';
import { registerFileTools } from '../tools/file.js';
import { registerSessionTools } from '../tools/session.js';
import { registerWorkTools } from '../tools/work.js';
import { registerRecallTools } from '../tools/recall.js';

export interface ToolRegistryLike {
  listDefs(names?: string[]): { name: string; description: string; inputSchema: Record<string, unknown> }[];
  execute(
    call: { id: string; name: string; input: Record<string, unknown> },
    ctx: SessionContext,
  ): Promise<{ id: string; name: string; output: string; isError?: boolean }>;
}

let toolsRegistered = false;
let pluginsLoaded = false;

/** Load builtin plugins once per process. */
export function ensurePluginsLoaded(): void {
  if (pluginsLoaded) return;
  for (const plugin of BUILTIN_PLUGINS) {
    try { pluginRegistry().register(plugin); } catch { /* duplicate */ }
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
  toolsRegistered = true;
  return reg;
}
