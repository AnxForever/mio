/**
 * Mio — Plugin System Types
 *
 * Three-tier design inspired by OpenClaw Plugin SDK:
 *   - SDK (these type definitions)
 *   - Runtime (PluginRegistry in registry.ts)
 *   - Harness (integration points in agent-loop, server, etc.)
 *
 * Each plugin has a lifecycle (onLoad → onUnload), optional lifecycle hooks
 * for the turn loop (onBeforeTurn / onAfterTurn / onSessionStart / onSessionEnd),
 * and three capability levels:
 *   - 'tool': exposes registerTools(registry)
 *   - 'prompt': exposes getPromptFragment(ctx)
 *   - 'command': exposes commands record
 *   - 'hook': participates in lifecycle hooks
 */

import type { SessionContext, PromptCtx } from '../types.js';
import type { ToolRegistry } from '../tools/registry.js';

// ─── Plugin Capabilities ───

export type PluginCapability = 'tool' | 'command' | 'hook' | 'prompt';

// ─── Turn Output (re-declared here to avoid circular imports) ───

export interface TurnOutput {
  text: string;
  sessionId: string;
  toolCallCount: number;
  turns: number;
  crisisFlagged: boolean;
  ghosted?: boolean;
}

// ─── Plugin Manifest ───

export interface PluginManifest {
  /** Unique id, e.g. "ghost", "pad", "affinity" */
  name: string;
  /** Semver version string */
  version: string;
  /** Human-readable description */
  description: string;
  /** What this plugin can do */
  capabilities: PluginCapability[];
  /** Declared configuration schema (keys → { type, default, description }) */
  config: Record<string, { type: string; default: unknown; description: string }>;
  /** Dependency plugin names — these must be loaded first */
  requires?: string[];
  /** Incompatible plugin names — cannot be loaded simultaneously */
  conflicts?: string[];
}

// ─── Plugin Lifecycle ───

export interface PluginLifecycle {
  /** Called when the plugin is registered (after dep/conflict validation) */
  onLoad?: () => Promise<void>;
  /** Called when the plugin is unregistered */
  onUnload?: () => Promise<void>;
  /** Called before every agent-loop inference turn */
  onBeforeTurn?: (ctx: SessionContext) => Promise<void>;
  /** Called after every agent-loop inference turn */
  onAfterTurn?: (ctx: SessionContext, result: TurnOutput) => Promise<void>;
  /** Called when a new session starts */
  onSessionStart?: (sessionId: string) => Promise<void>;
  /** Called when a session ends */
  onSessionEnd?: (sessionId: string) => Promise<void>;
}

// ─── Full Plugin Interface ───

export interface Plugin extends PluginLifecycle {
  manifest: PluginManifest;

  /**
   * Register tools with the ToolRegistry.
   * Only called if 'tool' is in capabilities.
   */
  registerTools?: (registry: ToolRegistry) => void;

  /**
   * Get a prompt fragment to inject into the system prompt.
   * Only called if 'prompt' is in capabilities.
   * Return null to signal "no fragment this turn".
   */
  getPromptFragment?: (ctx: PromptCtx) => string | null;

  /**
   * Expose named commands (e.g. "/ghost status").
   * Only called if 'command' is in capabilities.
   */
  commands?: Record<string, (args: string[]) => Promise<string>>;
}

// ─── Plugin Status ───

export interface PluginStatus {
  name: string;
  version: string;
  description: string;
  capabilities: PluginCapability[];
  loaded: boolean;
  error?: string;
}
