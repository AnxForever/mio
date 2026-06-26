/**
 * Mio — Multi-Model Task Router
 *
 * Routes different tasks to different models based on capability requirements.
 *
 * Rationale:
 * - chat (main dialogue) → strong model (Claude Sonnet / GPT-4o)
 * - classify (intent detection) → cheap/fast model (Haiku / GPT-4o-mini)
 * - summarize (compression) → medium model
 * - reflect (memory quality check) → strong model
 * - embed (vector search) → embedding-specific model
 *
 * The router is a thin wrapper — it does NOT break the existing provider flow.
 * When MIO_MODEL_ROUTER_ENABLED=false (the default), the router returns
 * the current provider as-is.
 *
 * Provider instances are cached by model name to avoid recreating the
 * same provider for the same model.
 */

import type { StreamingProvider } from '../types.js';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';

// ─── Types ───

export type ModelTask = 'chat' | 'classify' | 'summarize' | 'reflect' | 'embed';

export interface RouterConfig {
  defaultModel: string;
  taskModels: Partial<Record<ModelTask, string>>;
  fallbackChain: string[];
}

// ─── Provider instance cache ───

const providerCache = new Map<string, StreamingProvider>();

/**
 * Clear the cached provider instances.
 * Useful for testing or when config changes at runtime.
 */
export function clearRouterCache(): void {
  providerCache.clear();
}

/**
 * Get the model name configured for a specific task.
 *
 * Resolution order:
 * 1. taskModels[task] from config (set via env vars)
 * 2. config.defaultModel (fallback)
 *
 * If the resolved model is empty, returns the defaultModel.
 *
 * @param task    The task type to route.
 * @param config  The RouterConfig to use.
 * @returns       The model string for the given task.
 */
export function getTaskModel(task: ModelTask, config: RouterConfig): string {
  const taskModel = config.taskModels[task];
  if (taskModel && taskModel.length > 0) {
    return taskModel;
  }

  // Apply task-appropriate defaults based on the main model
  const defaultModel = config.defaultModel;
  if (!defaultModel) return '';

  // Map default model to task-appropriate variants
  const modelLower = defaultModel.toLowerCase();

  switch (task) {
    case 'chat':
      return defaultModel;

    case 'classify': {
      // Use a cheaper variant if available
      if (modelLower.includes('sonnet')) {
        return defaultModel.replace(/sonnet/i, 'haiku');
      }
      if (modelLower.includes('gpt-4o') && !modelLower.includes('mini')) {
        return 'gpt-4o-mini';
      }
      if (modelLower.includes('opus')) {
        return defaultModel.replace(/opus/i, 'haiku');
      }
      // Default: use same model for classification (it's still fast enough)
      return defaultModel;
    }

    case 'summarize': {
      // Medium tier — use haiku or mini variants
      if (modelLower.includes('sonnet')) {
        return defaultModel.replace(/sonnet/i, 'haiku');
      }
      if (modelLower.includes('opus')) {
        return defaultModel.replace(/opus/i, 'sonnet');
      }
      return defaultModel;
    }

    case 'reflect': {
      // Quality matters — use the strongest available
      // If already on a strong model, keep it
      return defaultModel;
    }

    case 'embed': {
      // Embedding specific model — return default since we don't have a dedicated embedding model yet
      return defaultModel;
    }

    default:
      return defaultModel;
  }
}

/**
 * Build RouterConfig from current env and defaults.
 *
 * Env vars:
 *   MIO_MODEL_CHAT      — model for chat tasks (default: main model)
 *   MIO_MODEL_CLASSIFY  — model for classification tasks
 *   MIO_MODEL_SUMMARIZE — model for summarization tasks
 *   MIO_MODEL_REFLECT   — model for reflection tasks
 *   MIO_MODEL_EMBED     — model for embedding tasks
 *
 * @returns  A RouterConfig populated from env vars or defaults.
 */
export function getRouterConfig(): RouterConfig {
  const config = getConfig();
  const defaultModel = config.model || '';

  const taskModels: Partial<Record<ModelTask, string>> = {};

  // Explicit env var overrides
  if (process.env.MIO_MODEL_CHAT) taskModels.chat = process.env.MIO_MODEL_CHAT;
  if (process.env.MIO_MODEL_CLASSIFY) taskModels.classify = process.env.MIO_MODEL_CLASSIFY;
  if (process.env.MIO_MODEL_SUMMARIZE) taskModels.summarize = process.env.MIO_MODEL_SUMMARIZE;
  if (process.env.MIO_MODEL_REFLECT) taskModels.reflect = process.env.MIO_MODEL_REFLECT;
  if (process.env.MIO_MODEL_EMBED) taskModels.embed = process.env.MIO_MODEL_EMBED;

  // Env var for fallback chain (comma-separated provider names)
  const fallbackRaw = process.env.MIO_FALLBACK_CHAIN;
  const fallbackChain = fallbackRaw
    ? fallbackRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    defaultModel,
    taskModels,
    fallbackChain,
  };
}

/**
 * Check if the model router is enabled.
 * Controlled by MIO_MODEL_ROUTER_ENABLED env var (default: false).
 */
export function isRouterEnabled(): boolean {
  return process.env.MIO_MODEL_ROUTER_ENABLED === 'true';
}

/**
 * Route a task to the appropriate provider based on the task model configuration.
 *
 * If the task model differs from the current provider's model, this function
 * attempts to create or retrieve a cached provider instance for that model.
 *
 * If the task-specific model matches the current provider's model, the current
 * provider is returned as-is (no overhead).
 *
 * If the task-specific model cannot be resolved (no provider available for that
 * model), falls back to the current provider.
 *
 * @param task              The task to route.
 * @param currentProvider   The currently active provider.
 * @param config            Optional RouterConfig (defaults to getRouterConfig()).
 * @returns                 A StreamingProvider suitable for the task.
 */
export async function routeTask(
  task: ModelTask,
  currentProvider: StreamingProvider,
  config?: RouterConfig,
): Promise<StreamingProvider> {
  // If router is disabled, return current provider as-is
  if (!isRouterEnabled()) {
    return currentProvider;
  }

  const cfg = config ?? getRouterConfig();
  const taskModel = getTaskModel(task, cfg);

  // If no task-specific model or it matches the current provider's model, return as-is
  if (!taskModel || taskModel.length === 0) {
    return currentProvider;
  }

  // Check cache first
  const cached = providerCache.get(taskModel);
  if (cached) {
    return cached;
  }

  // Try to create a provider for the task model
  // Use dynamic import to avoid circular dependency at module load time
  try {
    const { selectProvider } = await import('./index.js');
    const newProvider = selectProvider('auto', taskModel) as StreamingProvider;

    // Only cache if it's not a MockProvider (we don't want to cache mocks)
    if (newProvider.name !== 'mock') {
      providerCache.set(taskModel, newProvider);
    }

    return newProvider;
  } catch {
    // Fallback to current provider if we can't create a new one
    logger.warn(`[router] failed to create provider for model "${taskModel}", falling back to current`);
    return currentProvider;
  }
}

// Re-export types for convenience
export type { RouterConfig as RouterConfigType };
