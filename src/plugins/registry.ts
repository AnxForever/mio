/**
 * Mio — Plugin Registry
 *
 * Central registry for all plugins. Manages lifecycle (load/unload),
 * dependency resolution, conflict detection, and hook dispatch.
 *
 * Usage:
 *   const registry = new PluginRegistry();
 *   await registry.register(myPlugin);
 *   await registry.invokeHook('onBeforeTurn', sessionCtx);
 *   const fragments = registry.getPromptFragments(promptCtx);
 */

import type { SessionContext, PromptCtx } from '../types.js';
import { logger } from '../utils/logger.js';
import type {
  Plugin,
  PluginLifecycle,
  PluginManifest,
  PluginCapability,
  PluginStatus,
  TurnOutput,
} from './types.js';

// ─── Validation Errors ───

export class PluginValidationError extends Error {
  constructor(message: string, public pluginName: string) {
    super(`[plugin:${pluginName}] ${message}`);
    this.name = 'PluginValidationError';
  }
}

export class PluginDependencyError extends Error {
  constructor(message: string, public pluginName: string, public dependency: string) {
    super(`[plugin:${pluginName}] missing dependency: ${dependency} — ${message}`);
    this.name = 'PluginDependencyError';
  }
}

export class PluginConflictError extends Error {
  constructor(message: string, public pluginName: string, public conflict: string) {
    super(`[plugin:${pluginName}] conflict with: ${conflict} — ${message}`);
    this.name = 'PluginConflictError';
  }
}

// ─── Helper: validate manifest ───

const VALID_CAPABILITIES: PluginCapability[] = ['tool', 'command', 'hook', 'prompt'];

function validateManifest(manifest: PluginManifest): void {
  const { name, version, description, capabilities } = manifest;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new PluginValidationError('name is required and must be a non-empty string', name || '<unknown>');
  }

  if (!version || typeof version !== 'string') {
    throw new PluginValidationError('version is required and must be a string', name);
  }

  if (!description || typeof description !== 'string') {
    throw new PluginValidationError('description is required and must be a string', name);
  }

  if (!Array.isArray(capabilities)) {
    throw new PluginValidationError('capabilities must be an array', name);
  }

  for (const cap of capabilities) {
    if (!VALID_CAPABILITIES.includes(cap)) {
      throw new PluginValidationError(`unknown capability: "${cap}"`, name);
    }
  }

  // Validate capability → plugin shape match
  if (capabilities.includes('tool') && typeof manifest !== 'object') {
    // registerTools is checked at registration time, not in manifest validation
  }

  if (Array.isArray(manifest.conflicts)) {
    const selfConflict = manifest.conflicts.includes(name);
    if (selfConflict) {
      throw new PluginValidationError('plugin lists itself in conflicts', name);
    }
  }
}

// ─── PluginRegistry ───

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private loadOrder: string[] = [];

  // ─── Registration ───

  /**
   * Register a plugin. Validates manifest, checks deps/conflicts, calls onLoad.
   *
   * Throws PluginValidationError, PluginDependencyError, or PluginConflictError
   * on failure. Safe to retry after fixing the issue — no partial state remains.
   */
  async register(plugin: Plugin): Promise<void> {
    const manifest = plugin.manifest;

    // 1. Validate manifest shape
    validateManifest(manifest);

    // 2. Check for duplicate registration
    if (this.plugins.has(manifest.name)) {
      throw new PluginValidationError(
        `plugin "${manifest.name}" is already registered (version ${this.plugins.get(manifest.name)!.manifest.version})`,
        manifest.name,
      );
    }

    // 3. Check dependencies
    if (Array.isArray(manifest.requires)) {
      for (const dep of manifest.requires) {
        if (!this.plugins.has(dep)) {
          throw new PluginDependencyError(
            `required plugin "${dep}" is not registered`,
            manifest.name,
            dep,
          );
        }
        if (!this.isLoaded(dep)) {
          throw new PluginDependencyError(
            `required plugin "${dep}" is registered but not loaded`,
            manifest.name,
            dep,
          );
        }
      }
    }

    // 4. Check conflicts
    if (Array.isArray(manifest.conflicts)) {
      for (const conflict of manifest.conflicts) {
        if (this.plugins.has(conflict) && this.isLoaded(conflict)) {
          throw new PluginConflictError(
            `incompatible plugin "${conflict}" is already loaded`,
            manifest.name,
            conflict,
          );
        }
      }
    }

    // 5. Validate tool capability — must provide registerTools
    if (manifest.capabilities.includes('tool') && typeof plugin.registerTools !== 'function') {
      throw new PluginValidationError(
        'capabilities includes "tool" but plugin does not implement registerTools()',
        manifest.name,
      );
    }

    // 6. Validate prompt capability — must provide getPromptFragment
    if (manifest.capabilities.includes('prompt') && typeof plugin.getPromptFragment !== 'function') {
      throw new PluginValidationError(
        'capabilities includes "prompt" but plugin does not implement getPromptFragment()',
        manifest.name,
      );
    }

    // 7. Validate command capability — must provide commands
    if (manifest.capabilities.includes('command') && (!plugin.commands || typeof plugin.commands !== 'object')) {
      throw new PluginValidationError(
        'capabilities includes "command" but plugin does not implement commands',
        manifest.name,
      );
    }

    // 8. Store the plugin
    this.plugins.set(manifest.name, plugin);
    this.loadOrder.push(manifest.name);

    // 9. Call onLoad lifecycle hook
    try {
      if (typeof plugin.onLoad === 'function') {
        await plugin.onLoad();
      }
    } catch (err) {
      // If onLoad fails, roll back registration
      this.plugins.delete(manifest.name);
      this.loadOrder = this.loadOrder.filter((n) => n !== manifest.name);
      throw new PluginValidationError(
        `onLoad failed: ${err instanceof Error ? err.message : String(err)}`,
        manifest.name,
      );
    }
  }

  // ─── Unregistration ───

  /**
   * Unregister a plugin. Calls onUnload and removes it.
   *
   * Throws if the plugin is not registered (use isLoaded() to check first).
   * Does NOT check for dependents — callers should ensure no other plugin
   * depends on this one before unregistering.
   */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new PluginValidationError(`plugin "${name}" is not registered`, name);
    }

    try {
      if (typeof plugin.onUnload === 'function') {
        await plugin.onUnload();
      }
    } catch (err) {
      logger.error(`[plugin:${name}] onUnload failed: ${err instanceof Error ? err.message : String(err)}`);
      // Continue with unregistration even if onUnload fails
    }

    this.plugins.delete(name);
    this.loadOrder = this.loadOrder.filter((n) => n !== name);
  }

  // ─── Query ───

  /**
   * Get a registered plugin by name.
   */
  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * List all registered plugins.
   */
  list(): Plugin[] {
    return this.loadOrder.map((name) => this.plugins.get(name)!).filter(Boolean);
  }

  /**
   * Check if a plugin is registered and loaded.
   */
  isLoaded(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get the status of all registered plugins (for /plugins endpoint).
   */
  getStatuses(): PluginStatus[] {
    return this.loadOrder.map((name) => {
      const plugin = this.plugins.get(name)!;
      return {
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        capabilities: plugin.manifest.capabilities,
        loaded: true,
      };
    });
  }

  // ─── Hook Dispatch ───

  /**
   * Invoke a lifecycle hook on all loaded plugins that implement it.
   * Plugins are called in registration order.
   *
   * Errors from individual plugins are caught and logged — one failing
   * plugin does not prevent others from running.
   */
  async invokeHook<K extends keyof PluginLifecycle>(
    hook: K,
    ...args: Parameters<Required<PluginLifecycle>[K]>
  ): Promise<void> {
    for (const name of this.loadOrder) {
      const plugin = this.plugins.get(name)!;
      const fn = plugin[hook] as ((...a: unknown[]) => Promise<void>) | undefined;
      if (typeof fn !== 'function') continue;

      try {
        await fn(...args);
      } catch (err) {
        logger.error(
          `[plugin:${name}] hook "${hook}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ─── Prompt Fragments ───

  /**
   * Collect prompt fragments from all plugins with 'prompt' capability.
   * Returns an array of non-null fragment strings, in registration order.
   */
  getPromptFragments(ctx: PromptCtx): string[] {
    const fragments: string[] = [];

    for (const name of this.loadOrder) {
      const plugin = this.plugins.get(name)!;
      if (!plugin.manifest.capabilities.includes('prompt')) continue;
      if (typeof plugin.getPromptFragment !== 'function') continue;

      try {
        const fragment = plugin.getPromptFragment(ctx);
        if (fragment !== null && fragment !== undefined) {
          fragments.push(fragment);
        }
      } catch (err) {
        logger.error(
          `[plugin:${name}] getPromptFragment failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return fragments;
  }

  // ─── Commands ───

  /**
   * Collect all commands from all plugins with 'command' capability.
   * Later-registered plugins' commands overwrite earlier ones on name collision.
   */
  getCommands(): Record<string, (args: string[]) => Promise<string>> {
    const commands: Record<string, (args: string[]) => Promise<string>> = {};

    for (const name of this.loadOrder) {
      const plugin = this.plugins.get(name)!;
      if (!plugin.manifest.capabilities.includes('command')) continue;
      if (!plugin.commands) continue;

      for (const [cmdName, handler] of Object.entries(plugin.commands)) {
        // Warn on collision but allow overwrite
        if (commands[cmdName]) {
          logger.warn(`[plugin:${name}] command "${cmdName}" overwrites a previously registered command`);
        }
        commands[cmdName] = handler;
      }
    }

    return commands;
  }
}

/**
 * Global plugin registry singleton.
 *
 * Import this from agent-loop.ts and server/index.ts to access the shared
 * registry instance. Created lazily on first access.
 */
let _registry: PluginRegistry | null = null;

export function pluginRegistry(): PluginRegistry {
  if (!_registry) _registry = new PluginRegistry();
  return _registry;
}

/**
 * Reset the global plugin registry (for testing / hot-reload).
 * Also clears the singleton.
 */
export function resetPluginRegistry(): void {
  _registry = null;
}
