/**
 * Mio — LoRA Adapter Provider
 *
 * StreamingProvider backed by a local fine-tuned model inference server
 * (QLoRA adapter on Qwen2.5-7B / Qwen3-4B) that exposes an
 * OpenAI-compatible chat completions endpoint.
 *
 * STATUS: IMPLEMENTED (chat + chatStream). Not enabled by default — select
 * via `MIO_PROVIDER=lora` + `MIO_LORA_BASE_URL` only when a local inference
 * server is running. The provider does NOT support tool calls; tool turns
 * should still go through a main API provider.
 *
 * Expected deployment:
 *   1. A Python inference server (e.g. FastAPI + vLLM/llama.cpp) loads the
 *      base model + LoRA adapter and serves an OpenAI-compatible API.
 *   2. This module talks to it over HTTP.
 *   3. `providers/index.ts` routes `preset.name === 'lora'` here.
 *
 * @module
 */

import type { StreamingProvider, Message, ToolCall, ToolDef } from '../types.js';
import { logger } from '../utils/logger.js';
import { fetchWithRetry } from './http.js';

/**
 * Configuration for connecting to a LoRA inference server.
 *
 * The inference server is expected to expose an OpenAI-compatible
 * chat completions endpoint at `POST {baseUrl}/v1/chat/completions`.
 */
export interface LoRAAdapterConfig {
  /** Base URL of the inference server (e.g., http://127.0.0.1:8000). */
  baseUrl: string;

  /** Model name to pass in API requests (e.g., "mio-lora-qwen7b"). */
  modelName: string;

  /** Optional API key for the inference server. */
  apiKey?: string;

  /** Generation parameters */
  temperature?: number;
  maxTokens?: number;
}

/**
 * Default LoRA adapter configuration.
 * Update this when you deploy the inference server.
 */
export const DEFAULT_LORA_CONFIG: LoRAAdapterConfig = {
  baseUrl: 'http://127.0.0.1:8000',
  modelName: 'mio-lora-qwen7b',
  temperature: 0.7,
  maxTokens: 256,
};

/**
 * Create a StreamingProvider backed by a LoRA fine-tuned model.
 *
 * `chat()` and `chatStream()` are fully implemented against an
 * OpenAI-compatible endpoint. The provider is selected when
 * `preset.name === 'lora'` in `providers/index.ts`.
 *
 * @example
 * ```typescript
 * import { createLoRAProvider } from './providers/lora-adapter.js';
 *
 * const provider = createLoRAProvider({
 *   baseUrl: 'http://127.0.0.1:8000',
 *   modelName: 'mio-lora-qwen7b',
 * });
 *
 * const response = await provider.chat(messages, systemPrompt);
 * ```
 */
export function createLoRAProvider(config: Partial<LoRAAdapterConfig> = {}): StreamingProvider {
  const fullConfig: LoRAAdapterConfig = { ...DEFAULT_LORA_CONFIG, ...config };

  return new LoRAProvider(fullConfig);
}

/**
 * LoRAProvider — StreamingProvider implementation backed by a local
 * fine-tuned model inference server.
 *
 * IMPLEMENTATION NOTES (for when this is wired up):
 *
 * 1. The inference server should expose an OpenAI-compatible endpoint:
 *    POST {baseUrl}/v1/chat/completions
 *
 * 2. Request format (OpenAI-compatible):
 *    ```json
 *    {
 *      "model": "mio-lora-qwen7b",
 *      "messages": [
 *        {"role": "system", "content": "..."},
 *        {"role": "user", "content": "..."}
 *      ],
 *      "temperature": 0.7,
 *      "max_tokens": 256,
 *      "stream": true
 *    }
 *    ```
 *
 * 3. Response: standard SSE stream of OpenAI chat completion chunks.
 *
 * 4. The LoRA model is for conversation only — it does not support
 *    tool calling. All tool-related requests should still go through
 *    the main API provider (Claude / GPT).
 *
 * 5. Recommended architecture:
 *    - LoRA model handles the chat turn (generates Mio's text response)
 *    - Main API provider handles tool calls (file ops, memory, etc.)
 *    - The agent loop decides which provider to call based on whether
 *      tools are needed for the current turn
 */
class LoRAProvider implements StreamingProvider {
  name = 'lora-finetuned';

  constructor(private config: LoRAAdapterConfig) {
    logger.info(
      `[LoRAProvider] Initialized with model="${config.modelName}" at ${config.baseUrl}`,
    );
  }

  /**
   * Non-streaming chat completion.
   *
   * Sends messages to the inference server and returns the full response.
   * This provider does NOT support tool calls — returns empty toolCalls.
   */
  async chat(
    messages: Message[],
    systemPrompt: string,
    _tools?: ToolDef[],
    _opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const openaiMessages = this.toOpenAIMessages(messages, systemPrompt);

    const response = await fetchWithRetry(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: this.config.modelName,
        messages: openaiMessages,
        temperature: _opts?.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: _opts?.maxTokens ?? this.config.maxTokens ?? 256,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(
        `[LoRAProvider] Inference server error ${response.status}: ${errorText}`,
      );
    }

    const body = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const text = body.choices?.[0]?.message?.content ?? '';
    return { text, toolCalls: [] };
  }

  /**
   * Streaming chat completion.
   *
   * Sends messages and streams tokens via SSE, parsing the OpenAI
   * streaming format (`data: {...}` chunks, `[DONE]` terminator).
   * This provider does NOT support tool calls during streaming.
   */
  async chatStream(
    messages: Message[],
    systemPrompt: string,
    _tools?: ToolDef[],
    onToken?: (chunk: string) => void,
    _onToolCall?: (call: ToolCall) => void,
    _opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const openaiMessages = this.toOpenAIMessages(messages, systemPrompt);
    let fullText = '';

    try {
      const response = await fetchWithRetry(`${this.config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.config.modelName,
          messages: openaiMessages,
          temperature: _opts?.temperature ?? this.config.temperature ?? 0.7,
          max_tokens: _opts?.maxTokens ?? this.config.maxTokens ?? 256,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown error');
        throw new Error(
          `[LoRAProvider] Streaming error ${response.status}: ${errorText}`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('[LoRAProvider] No response body stream');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{ delta: { content?: string } }>;
            };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              onToken?.(content);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (error) {
      logger.error('[LoRAProvider] Streaming error', { error: String(error) });
      throw error;
    }

    return { text: fullText, toolCalls: [] };
  }

  /**
   * Convert Mio's internal message format to OpenAI-compatible messages.
   * System prompt is prepended as a system message.
   */
  private toOpenAIMessages(
    messages: Message[],
    systemPrompt: string,
  ): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of messages) {
      const content = typeof msg.content === 'string'
        ? msg.content
        // ContentBlock[] → extract text
        : msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text?: string }).text ?? '')
          .join('\n');

      result.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content,
      });
    }

    return result;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }
}

/**
 * Quick validation: check if the LoRA inference server is reachable.
 *
 * Returns true if the server responds at the health endpoint.
 */
export async function checkLoRAServer(
  config: LoRAAdapterConfig = DEFAULT_LORA_CONFIG,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const response = await fetch(`${config.baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;
    return { ok: response.ok, latencyMs: latency };
  } catch (error) {
    const latency = Date.now() - start;
    return {
      ok: false,
      latencyMs: latency,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
