/**
 * Mio — Plugin System
 *
 * Makes emotional modules, tools, and extensions pluggable so users can
 * enable/disable ghost, PAD, affinity, etc. without recompiling.
 *
 * Architecture (3-tier, inspired by OpenClaw Plugin SDK):
 *   - SDK:    src/plugins/types.ts  — type definitions
 *   - Runtime: src/plugins/registry.ts — PluginRegistry + lifecycle
 *   - Harness: src/core/agent-loop.ts, src/server/index.ts — integration points
 *
 * Each existing module (ghost, affinity, pad, frustration) has a plugin
 * wrapper in src/plugins/builtins/ that wraps the module without changing it.
 * This keeps the integration non-breaking: existing direct calls still work if
 * plugins aren't loaded.
 */

export { PluginRegistry, PluginValidationError, PluginDependencyError, PluginConflictError } from './registry.js';
export { pluginRegistry, resetPluginRegistry } from './registry.js';
export { BUILTIN_PLUGINS, BUILTIN_PLUGIN_MAP } from './builtins/index.js';

export type {
  Plugin,
  PluginManifest,
  PluginLifecycle,
  PluginCapability,
  PluginStatus,
  TurnOutput,
} from './types.js';
