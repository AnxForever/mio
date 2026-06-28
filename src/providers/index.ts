/**
 * Mio — Provider selector / factory
 *
 * Routes a ProviderPreset + API key to the correct StreamingProvider
 * implementation. Supports:
 *
 *   - Anthropic (native API via AnthropicProvider)
 *   - OpenAI + all OpenAI-compatible providers (DeepSeek, Moonshot, Zhipu,
 *     MiniMax, Qwen, Doubao, SiliconFlow) via OpenAICompatibleProvider
 *   - Mock (offline testing)
 *
 * Auto-detection: when provider is 'auto', probes env vars and picks the
 * first provider with a key set.
 */

import type { StreamingProvider, ProviderPresetConfig, ProviderResolution } from '../types.js';
import { logger } from '../utils/logger.js';
import { resolveProvider, PROVIDER_PRESETS } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { MockProvider } from './mock.js';
import { FallbackChainProvider, drainFallbackEvents, resetFallbackCache } from './fallback.js';
import { createLoRAProvider } from './lora-adapter.js';

export { AnthropicProvider, OpenAICompatibleProvider, MockProvider, FallbackChainProvider };
export { drainFallbackEvents, resetFallbackCache };

/**
 * Create a StreamingProvider from a resolved preset.
 *
 * - 'anthropic' → AnthropicProvider (native API, not OpenAI-compatible)
 * - 'mock'       → MockProvider
 * - Everything else → OpenAICompatibleProvider
 */
function createProvider(resolution: ProviderResolution): StreamingProvider {
  const { preset, apiKey, model } = resolution;

  // Mock: no API calls
  if (preset.name === 'mock') {
    return new MockProvider();
  }

  if (preset.name === 'lora') {
    return createLoRAProvider({
      baseUrl: process.env.MIO_LORA_BASE_URL || preset.baseUrl,
      modelName: model || preset.defaultModel,
      apiKey: apiKey || process.env.MIO_LORA_API_KEY,
    });
  }

  // No API key — fall back to Mock with a clear log message
  if (!apiKey) {
    logger.error(
      `[provider] ${preset.label}: no API key set. Set ${preset.apiKeyEnv} env var. Falling back to MockProvider.`,
    );
    return new MockProvider();
  }

  // Anthropic uses its own native API (not OpenAI-compatible)
  if (preset.name === 'anthropic') {
    return new AnthropicProvider(apiKey, model);
  }

  // All other providers use OpenAI-compatible chat completions API
  return new OpenAICompatibleProvider(preset, apiKey, model);
}

/**
 * Select a StreamingProvider based on the provider name and optional model override.
 *
 * Typical usage:
 *   const config = getConfig();
 *   const provider = selectProvider(config.provider, config.model);
 *
 * Provider selection order when `providerName` is 'auto':
 *   anthropic → deepseek → moonshot → zhipu → minimax → qwen → doubao → siliconflow → openai
 *
 * Falls back to MockProvider when no API key is available for any provider.
 *
 * @param providerName  Provider preset name (or 'auto' for auto-detection).
 * @param explicitModel Optional model override (uses preset default if empty).
 * @param enableFallback When true (default), wraps the result in a FallbackChainProvider
 *                       for automatic recovery on provider failure.
 * @returns             A StreamingProvider ready for use.
 */
export function selectProvider(
  providerName: string = 'auto',
  explicitModel?: string,
  enableFallback: boolean = false,
): StreamingProvider {
  const resolution = resolveProvider(providerName, explicitModel);
  if (!resolution) {
    logger.error('[provider] resolveProvider returned null — this should not happen. Using MockProvider.');
    return new MockProvider();
  }

  if (enableFallback && resolution.preset.name !== 'mock') {
    return selectProviderWithFallback(resolution.preset.name, resolution.model);
  }

  return createProvider(resolution);
}

/**
 * Select a provider wrapped in a fallback chain.
 *
 * Creates a FallbackChainProvider that tries the specified provider first,
 * then falls back to other providers with API keys set.
 *
 * @param primaryName  Primary provider preset name.
 * @param model        Optional model override.
 * @returns            A FallbackChainProvider that tries providers in order.
 */
export function selectProviderWithFallback(
  primaryName: string,
  model?: string,
): FallbackChainProvider {
  return new FallbackChainProvider(primaryName, model ?? '');
}

/**
 * Get the resolved provider info without creating a provider instance.
 * Useful for status display and health checks.
 */
export function getProviderInfo(providerName?: string, model?: string): {
  preset: ProviderPresetConfig;
  apiKey: string;
  model: string;
  isMock: boolean;
  reason: string;
} {
  const resolution = resolveProvider(providerName ?? 'auto', model);
  if (!resolution) {
    return {
      preset: PROVIDER_PRESETS.mock,
      apiKey: '',
      model: 'mock',
      isMock: true,
      reason: 'resolveProvider returned null',
    };
  }

  const { preset, apiKey: key, model: resolvedModel } = resolution;
  if (preset.name === 'mock') {
    return { preset, apiKey: '', model: 'mock', isMock: true, reason: 'no API keys found' };
  }
  if (!key) {
    return { preset, apiKey: '', model: resolvedModel, isMock: true, reason: `env var ${preset.apiKeyEnv} not set` };
  }
  return { preset, apiKey: key, model: resolvedModel, isMock: false, reason: 'ok' };
}

/**
 * List all available providers (those with API keys set).
 */
export function listAvailableProviders(): { name: string; label: string; model: string; env: string }[] {
  const result: { name: string; label: string; model: string; env: string }[] = [];
  for (const [name, cfg] of Object.entries(PROVIDER_PRESETS)) {
    if (name === 'mock') continue;
    const key = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
    result.push({
      name,
      label: cfg.label,
      model: cfg.defaultModel,
      env: cfg.apiKeyEnv,
    });
  }
  return result;
}
