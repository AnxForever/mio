/**
 * RoundRobinProvider — rotates across multiple OpenAI-compatible endpoints.
 *
 * When one endpoint returns 429/503/524, it's marked as cooling down (30s)
 * and the next endpoint is tried. This handles free proxy rate limits.
 *
 * Usage: Set GROK_API_KEYS=url1@key1,url2@key2
 * The first key/url pair is used as primary, others as fallbacks.
 */

import type { Message, ToolDef, ToolCall, StreamingProvider } from '../types.js';
import { logger } from '../utils/logger.js';

interface Endpoint {
  url: string;
  key: string;
  cooldownUntil: number;
}

export class RoundRobinProvider implements StreamingProvider {
  name = 'grok-round-robin';
  private endpoints: Endpoint[];
  private currentIndex = 0;
  private defaultModel: string;

  constructor(
    endpoints: Array<{ url: string; key: string }>,
    defaultModel: string,
  ) {
    this.endpoints = endpoints.map((e) => ({ ...e, cooldownUntil: 0 }));
    this.defaultModel = defaultModel;
    this.name = `grok-round-robin(${endpoints.length} endpoints)`;
    logger.info(`[round-robin] ${endpoints.length} endpoints configured`);
  }

  get isAvailable(): boolean {
    return this.endpoints.some((e) => !!e.key);
  }

  private getActiveEndpoint(): Endpoint {
    const now = Date.now();
    // Try each endpoint, skipping those in cooldown
    for (let i = 0; i < this.endpoints.length; i++) {
      const idx = (this.currentIndex + i) % this.endpoints.length;
      const ep = this.endpoints[idx];
      if (now >= ep.cooldownUntil) {
        this.currentIndex = (idx + 1) % this.endpoints.length; // rotate for next call
        return ep;
      }
    }
    // All in cooldown — use the one with shortest remaining cooldown
    let best = this.endpoints[0];
    for (const ep of this.endpoints) {
      if (ep.cooldownUntil < best.cooldownUntil) best = ep;
    }
    return best;
  }

  private markCooldown(url: string): void {
    const ep = this.endpoints.find((e) => e.url === url);
    if (ep) {
      ep.cooldownUntil = Date.now() + 30_000; // 30s cooldown
      logger.warn(`[round-robin] endpoint in cooldown: ${url}`);
    }
  }

  private getHeaders(key: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    };
  }

  async chat(
    messages: Message[],
    systemPrompt: string,
    tools?: ToolDef[],
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const model = opts?.model || this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      max_tokens: opts?.maxTokens ?? 4096,
      temperature: opts?.temperature ?? 0.7,
      stream: false,
    };

    const msgs: Array<{ role: string; content: string }> = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    for (const m of messages) {
      msgs.push({ role: m.role, content: typeof m.content === 'string' ? m.content : '' });
    }
    body['messages'] = msgs;

    if (tools && tools.length > 0) {
      body['tools'] = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.endpoints.length; attempt++) {
      const ep = this.getActiveEndpoint();
      const endpoint = `${ep.url}/chat/completions`;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45_000);

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: this.getHeaders(ep.key),
          body: JSON.stringify(body),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (!res.ok) {
          const status = res.status;
          if (status === 429 || status === 503 || status === 524) {
            this.markCooldown(ep.url);
            continue; // try next endpoint
          }
          const errText = await res.text().catch(() => '(no body)');
          throw new Error(`API error ${status}: ${errText.slice(0, 200)}`);
        }

        const data = await res.json() as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: Record<string, number>;
        };

        const text = data.choices?.[0]?.message?.content ?? '';
        return { text };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          this.markCooldown(ep.url);
          lastError = new Error('timeout');
          continue;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        // For network errors, also try next endpoint
        this.markCooldown(ep.url);
      }
    }

    throw lastError || new Error('All endpoints exhausted');
  }

  // chatStream not supported through round-robin — falls back to chat
  async chatStream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDef[] | undefined,
    onToken: (chunk: string) => void,
    onToolCall?: (call: ToolCall) => void,
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const result = await this.chat(messages, systemPrompt, tools, opts);
    // Simulate streaming by sending the full text as one chunk
    if (result.text) onToken(result.text);
    return result;
  }
}
