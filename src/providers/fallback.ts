/**
 * Mio — Model Fallback Chain
 *
 * When the primary model fails with a recoverable error (network error, 5xx,
 * or 4xx except 401), automatically try backup providers in order.
 *
 * Design:
 *   - Implements the `StreamingProvider` interface, wrapping a chain of providers.
 *   - On failure: logs the error, tries the next provider.
 *   - On successful fallback: bookmarks the event so the nightly consolidation
 *     can record it in the user's relationship context.
 *   - 401 / 403 errors do NOT trigger fallback (wrong API key is a config
 *     problem, not a transient failure).
 *   - If ALL providers in the chain fail, throws a combined error listing
 *     every failure.
 *   - Default chain: anthropic → openai → deepseek → zhipu → moonshot → minimax
 *     Only providers with API keys set are included in the chain.
 */

import type { StreamingProvider, Message, ToolDef, ToolCall } from '../types.js';
import { logger } from '../utils/logger.js';
import { PROVIDER_PRESETS } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { MockProvider } from './mock.js';

// ─── Fallback bookmark event ───

/**
 * In-memory buffer of fallback events.
 * The agent loop or nightly consolidation can read these to record them
 * in BOOKMARKS.md or the relationship context.
 */
const fallbackEvents: string[] = [];

/**
 * Read and clear the current fallback events buffer.
 * Returns recent fallback events for recording into BOOKMARKS.md.
 */
export function drainFallbackEvents(): string[] {
  const events = fallbackEvents.slice();
  fallbackEvents.length = 0;
  return events;
}

function recordFallbackEvent(event: string): void {
  fallbackEvents.push(event);
  logger.warn(`[fallback] ${event}`);
}

// ─── Provider factory ───

/**
 * Cached provider instances (by provider name) so we don't re-create
 * providers on every fallback attempt.
 */
const providerCache = new Map<string, StreamingProvider>();

function getOrCreateProvider(name: string, model?: string): StreamingProvider | null {
  const preset = PROVIDER_PRESETS[name];
  if (!preset) return null;

  const resolvedModel = model || preset.defaultModel;
  const cacheKey = `${name}:${resolvedModel}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  const apiKey = preset.apiKeyEnv ? (process.env[preset.apiKeyEnv] ?? '') : '';
  if (!apiKey) return null;

  let provider: StreamingProvider;
  if (name === 'anthropic') {
    provider = new AnthropicProvider(apiKey, resolvedModel);
  } else if (name === 'mock') {
    provider = new MockProvider();
  } else {
    provider = new OpenAICompatibleProvider(preset, apiKey, resolvedModel);
  }

  providerCache.set(cacheKey, provider);
  return provider;
}

// ─── Default fallback order ───

/**
 * Default fallback order: same-family first (Anthropic → OpenAI-compatible),
 * then cross-family. Only providers with API keys set will be included.
 */
const DEFAULT_FALLBACK_ORDER: string[] = [
  'anthropic',
  'openai',
  'deepseek',
  'zhipu',
  'moonshot',
  'minimax',
  'qwen',
  'doubao',
  'siliconflow',
];

/**
 * Build the active provider chain from the primary + fallback list.
 * Filters out providers that have no API key. The primary is always first.
 */
function buildChain(
  primaryName: string,
  primaryModel: string,
  fallbackNames: string[],
): { providers: StreamingProvider[]; names: string[] } {
  const providers: StreamingProvider[] = [];
  const names: string[] = [];

  // Add the primary (even if no key — let it fail with a clear error)
  const primary = getOrCreateProvider(primaryName, primaryModel);
  if (primary) {
    providers.push(primary);
    names.push(primaryName);
  }

  // Add fallbacks that have API keys. Cross-provider fallbacks must use their
  // own default model; a Claude model string is invalid for OpenAI-compatible
  // providers, and vice versa.
  for (const name of fallbackNames) {
    if (name === primaryName) continue; // skip duplicate
    const provider = getOrCreateProvider(name);
    if (provider) {
      providers.push(provider);
      names.push(name);
    }
  }

  return { providers, names };
}

// ─── Error classification ───

function isRecoverableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;

  // Network / fetch errors — definitely recoverable
  if (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('abort') ||
    msg.includes('timeout')
  ) {
    return true;
  }

  // 5xx server errors — recoverable, the next provider might work
  if (/5\d{2}/.test(msg)) return true;

  // 429 rate limit — technically recoverable but we don't wait; try next provider
  if (msg.includes('429')) return true;

  // 401 / 403 — NOT recoverable (bad API key is a config issue)
  if (msg.includes('401') || msg.includes('403')) return false;

  // 4xx other than 401/403/429 — probably recoverable (bad request on one API
  // might work on another)
  if (/4\d{2}/.test(msg)) return true;

  return false;
}

// ─── FallbackChainProvider ───

/**
 * A `StreamingProvider` wrapper that chains multiple providers.
 *
 * On `chat()` or `chatStream()`:
 *   1. Try the primary provider.
 *   2. If it fails with a recoverable error, log and try the next.
 *   3. If a fallback succeeds, bookmark the switch.
 *   4. If ALL fail, throw a combined error.
 */
export class FallbackChainProvider implements StreamingProvider {
  readonly name = 'fallback-chain';

  private readonly providers: StreamingProvider[];
  private readonly names: string[];
  private activeProviderIndex: number = 0;

  constructor(
    primaryName: string,
    primaryModel: string,
    fallbackNames: string[] = DEFAULT_FALLBACK_ORDER,
  ) {
    const { providers, names } = buildChain(primaryName, primaryModel, fallbackNames);
    this.providers = providers;
    this.names = names;

    if (this.providers.length === 0) {
      logger.warn(
        '[fallback] No providers with API keys available. Using MockProvider as last resort.',
      );
      this.providers.push(new MockProvider());
      this.names.push('mock');
    }
  }

  /**
   * Get the name of the currently active provider.
   */
  get activeProvider(): string {
    return this.names[this.activeProviderIndex] ?? 'unknown';
  }

  /**
   * Get all configured provider names (for status display).
   */
  get providerChain(): string[] {
    return [...this.names];
  }

  /**
   * Check if any provider in the chain is available.
   */
  get isAvailable(): boolean {
    return this.providers.length > 0;
  }

  // ─── chat() — non-streaming ───

  async chat(
    messages: Message[],
    systemPrompt: string,
    tools?: ToolDef[],
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const errors: { provider: string; error: string }[] = [];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]!;
      const name = this.names[i]!;

      try {
        const result = await provider.chat(messages, systemPrompt, tools, opts);
        this.activeProviderIndex = i;

        // If this wasn't the first attempt, record the fallback event
        if (i > 0) {
          const primaryName = this.names[0]!;
          recordFallbackEvent(`switched from ${primaryName} to ${name} (non-streaming)`);
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ provider: name, error: msg });

        if (isRecoverableError(err)) {
          logger.warn(
            `[fallback] ${name} failed (recoverable), trying next provider: ${msg}`,
          );
          continue; // try next provider
        }

        // Non-recoverable error (401/403) — don't try other providers,
        // the API key is invalid.
        throw new Error(
          `[fallback] ${name} failed with non-recoverable error: ${msg}`,
        );
      }
    }

    // All providers failed
    const combined = errors.map((e) => `  ${e.provider}: ${e.error}`).join('\n');
    throw new Error(
      `[fallback] All providers failed:\n${combined}`,
    );
  }

  // ─── chatStream() — SSE streaming ───

  async chatStream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDef[] | undefined,
    onToken: (chunk: string) => void,
    onToolCall?: (call: ToolCall) => void,
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const errors: { provider: string; error: string }[] = [];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]!;
      const name = this.names[i]!;

      try {
        const result = await provider.chatStream(
          messages,
          systemPrompt,
          tools,
          onToken,
          onToolCall,
          opts,
        );
        this.activeProviderIndex = i;

        if (i > 0) {
          const primaryName = this.names[0]!;
          recordFallbackEvent(`switched from ${primaryName} to ${name} (streaming)`);
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ provider: name, error: msg });

        if (isRecoverableError(err)) {
          logger.warn(
            `[fallback] ${name} streaming failed (recoverable), trying next: ${msg}`,
          );
          continue;
        }

        throw new Error(
          `[fallback] ${name} streaming failed with non-recoverable error: ${msg}`,
        );
      }
    }

    const combined = errors.map((e) => `  ${e.provider}: ${e.error}`).join('\n');
    throw new Error(
      `[fallback] All providers streaming failed:\n${combined}`,
    );
  }
}

/**
 * Reset the internal provider cache (useful for tests).
 */
export function resetFallbackCache(): void {
  providerCache.clear();
  fallbackEvents.length = 0;
}
