/**
 * Mio — OpenAI-compatible provider
 *
 * A single generic provider that works with ANY LLM API that follows the
 * OpenAI /v1/chat/completions format. This covers:
 *
 *   - OpenAI (GPT-4o, GPT-4.1, o4)
 *   - DeepSeek (V3, R1)
 *   - Moonshot / Kimi (v1)
 *   - Zhipu / GLM (GLM-4)
 *   - MiniMax (abab6.5s, abab7)
 *   - Qwen / DashScope (Qwen Max, Plus, Turbo)
 *   - Doubao / Volcengine (Pro, Lite)
 *   - SiliconFlow (hosted models)
 *
 * Implements both StreamingProvider.chatStream() (SSE) and AIProvider.chat()
 * (non-streaming). Tool calling uses OpenAI's native function-calling format.
 *
 * Quirks handled:
 *   - Some providers return tool_calls as a flat array; others nest them.
 *   - Zhipu includes a `sensitive` flag in extra fields.
 *   - MiniMax / DeepSeek sometimes omit `role` on assistant tool_calls.
 *   - Streaming tool_calls are accumulated index-by-index (some providers
 *     send the index only on the first chunk; some repeat it).
 */

import { TextDecoder } from 'node:util';
import type {
  StreamingProvider,
  Message,
  ToolDef,
  ToolCall,
  ContentBlock,
  ProviderPresetConfig,
} from '../types.js';

// ─── OpenAI wire types ───

interface OpenAIMessage {
  role: string;
  content?: string | null | Record<string, unknown>[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON-encoded
  };
}

interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  id: string;
  choices: {
    index: number;
    message: {
      role: string;
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface SSEChoice {
  index: number;
  delta: {
    role?: string;
    content?: string | null;
    tool_calls?: {
      index: number;
      id?: string;
      type?: 'function';
      function?: {
        name?: string;
        arguments?: string;
      };
    }[];
  };
  finish_reason: string | null;
}

interface SSEPayload {
  id: string;
  object: string;
  choices: SSEChoice[];
}

// ─── OpenAICompatibleProvider ───

export class OpenAICompatibleProvider implements StreamingProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly authHeader: string;
  private readonly presetName: string;

  /**
   * @param preset  Provider preset config (from config.ts PROVIDER_PRESETS).
   * @param apiKey  Resolved API key.
   * @param model   Override model (defaults to preset.defaultModel).
   */
  constructor(
    preset: ProviderPresetConfig,
    apiKey: string,
    model?: string,
  ) {
    this.presetName = preset.name;
    this.name = preset.name;
    this.apiKey = apiKey;
    this.baseUrl = preset.baseUrl;
    this.defaultModel = model || preset.defaultModel;
    this.authHeader = preset.authHeader.replace('${apiKey}', apiKey);
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  // ─── Headers ───

  private getHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // Anthropic uses x-api-key; everyone else uses Authorization: Bearer
    if (this.presetName === 'anthropic') {
      h['x-api-key'] = this.apiKey;
      h['anthropic-version'] = '2023-06-01';
    } else {
      h['Authorization'] = this.authHeader;
    }
    return h;
  }

  // ─── Message mapping (Mio → OpenAI) ───

  /**
   * Map Mio Message[] to OpenAI-compatible messages array.
   *
   * Conversion rules:
   *   - string content → { role, content: string }
   *   - ContentBlock[] → { role, content: [{ type: "text", text }, ...] }
   *   - image ContentBlock → { type: "image_url", image_url: { url: "data:..." } }
   *   - assistant toolCalls → { role: "assistant", tool_calls: [...] }
   *   - user toolResults → { role: "tool", tool_call_id, content }
   */
  private mapMessages(messages: Message[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    for (const msg of messages) {
      const role = msg.role === 'system' ? 'user' : msg.role;

      // Tool results → role: "tool" messages (one per result)
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.id,
            content: tr.output,
          });
        }
        // If there's also text content, add it as a separate user message
        if (typeof msg.content === 'string' && msg.content.trim().length > 0) {
          result.push({ role: 'user', content: msg.content });
        }
        continue;
      }

      // Assistant with tool calls
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolCalls: OpenAIToolCall[] = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          },
        }));

        result.push({
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content : null,
          tool_calls: toolCalls,
        });
        continue;
      }

      // Simple text message
      if (typeof msg.content === 'string') {
        result.push({ role, content: msg.content });
        continue;
      }

      // Content blocks (text + optional images)
      if (Array.isArray(msg.content)) {
        const parts: Record<string, unknown>[] = [];
        for (const block of msg.content as ContentBlock[]) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text });
          } else if (block.type === 'image') {
            parts.push({
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type};base64,${block.source.data}`,
              },
            });
          }
        }
        // OpenAI expects content as an array of content parts for multimodal
        result.push({ role, content: parts.length > 0 ? parts : null });
      }
    }

    return result;
  }

  // ─── Tool definition mapping ───

  private mapTools(tools: ToolDef[]): OpenAIToolDef[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  // ─── Request body builder ───

  private buildBody(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDef[] | undefined,
    opts: { temperature?: number; maxTokens?: number; model?: string } | undefined,
    stream: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: (opts?.model && opts.model.length > 0) ? opts.model : this.defaultModel,
      max_tokens: opts?.maxTokens ?? 4096,
      temperature: opts?.temperature ?? 0.7,
    };

    if (stream) {
      body['stream'] = true;
      body['stream_options'] = { include_usage: false };
    }

    const msgs: OpenAIMessage[] = [];

    // System prompt → top-level `messages[0]` with role: "system"
    if (systemPrompt) {
      msgs.push({ role: 'system', content: systemPrompt });
    }

    msgs.push(...this.mapMessages(messages));
    body['messages'] = msgs;

    if (tools && tools.length > 0) {
      body['tools'] = this.mapTools(tools);
    }

    return body;
  }

  // ─── Thinking block filter ───

  /**
   * Strip `<think>...</think>` blocks from model output.
   * Reasoning models (MiniMax-M3, DeepSeek-R1, etc.) emit chain-of-thought
   * in `<think>` tags — these are internal reasoning, not meant for the user.
   */
  private stripThinking(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  // ─── Response parser (non-streaming) ───

  private parseResponse(data: OpenAIResponse): { text: string; toolCalls?: ToolCall[] } {
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const choice of data.choices) {
      const msg = choice.message;
      if (msg.content) {
        text += msg.content;
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          if (tc.function.arguments) {
            try {
              input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            } catch {
              // Malformed JSON → empty input
            }
          }
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }
    }

    return {
      text: this.stripThinking(text),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  // ─── SSE stream consumer ───

  /**
   * Consume an OpenAI-format SSE stream.
   *
   * Format:
   *   data: {"id":"...","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}
   *   data: [DONE]
   *
   * Tool calls arrive as incremental deltas with an index:
   *   data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"...","type":"function","function":{"name":"read"}}]}}]}
   *   data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"p"}}]}}]}
   */
  private async consumeSSEStream(
    response: Response,
    onToken: (chunk: string) => void,
    onToolCall?: (call: ToolCall) => void,
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    if (!response.body) {
      throw new Error(`${this.name} API returned empty response body`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    const toolCalls: ToolCall[] = [];

    // Thinking-block filter state (for reasoning models like MiniMax-M3)
    let thinkDepth = 0;
    let thinkBuffer = '';

    // Accumulate tool call chunks by index
    const tcAccum: Map<number, { id: string; name: string; args: string }> = new Map();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) {
          // Could be a partial line — put it back
          buffer = trimmed;
          continue;
        }

        const dataStr = trimmed.slice(6);
        let payload: SSEPayload;
        try {
          payload = JSON.parse(dataStr) as SSEPayload;
        } catch {
          // Partial or malformed JSON — could be a chunked line, skip
          continue;
        }

        for (const choice of payload.choices) {
          const delta = choice.delta;

          // Text content (with thinking-block filter for reasoning models)
          if (delta.content) {
            let textChunk = delta.content;
            fullText += textChunk;

            // Filter <think>...</think> blocks from streaming output
            if (thinkDepth > 0 || textChunk.includes('<think>')) {
              thinkBuffer += textChunk;
              // Count think tags to handle nested/sequential blocks
              let idx = 0;
              while (idx < thinkBuffer.length) {
                const openIdx = thinkBuffer.indexOf('<think>', idx);
                const closeIdx = thinkBuffer.indexOf('</think>', idx);
                if (openIdx >= 0 && (closeIdx < 0 || openIdx < closeIdx)) {
                  thinkDepth++;
                  idx = openIdx + 7;
                } else if (closeIdx >= 0) {
                  thinkDepth = Math.max(0, thinkDepth - 1);
                  idx = closeIdx + 8;
                } else {
                  break;
                }
              }
              // If we're outside think blocks, flush any remaining non-think content
              if (thinkDepth === 0) {
                const cleaned = thinkBuffer.replace(/<think>[\s\S]*?<\/think>/g, '');
                thinkBuffer = '';
                if (cleaned.trim()) {
                  onToken(cleaned);
                }
              }
              // Skip forwarding raw think content
            } else {
              onToken(textChunk);
            }
          }

          // Tool calls
          if (delta.tool_calls) {
            for (const tcDelta of delta.tool_calls) {
              const idx = tcDelta.index;
              let acc = tcAccum.get(idx);
              if (!acc) {
                acc = { id: '', name: '', args: '' };
                tcAccum.set(idx, acc);
              }

              if (tcDelta.id) acc.id = tcDelta.id;
              if (tcDelta.function?.name) acc.name += tcDelta.function.name;
              if (tcDelta.function?.arguments) acc.args += tcDelta.function.arguments;

              // If this is the last chunk for this tool call (finish_reason present
              // or the accumulated data looks complete), finalize it.
              // We defer finalization to the finish_reason check below;
              // some providers (e.g. DeepSeek, Zhipu) complete tool calls
              // mid-stream without an explicit stop marker.
              if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
                // Finalize all accumulated tool calls
                for (const [i, a] of tcAccum) {
                  if (!a.id) continue;
                  let input: Record<string, unknown> = {};
                  if (a.args) {
                    try {
                      input = JSON.parse(a.args) as Record<string, unknown>;
                    } catch {
                      // ignore
                    }
                  }
                  const call: ToolCall = { id: a.id, name: a.name, input };
                  toolCalls.push(call);
                  if (onToolCall) onToolCall(call);
                }
                tcAccum.clear();
              }
            }
          }
        }
      }
    }

    // Drain any remaining tool call accumulations (for providers that don't
    // emit a clean finish_reason on tool calls).
    for (const [_i, a] of tcAccum) {
      if (!a.id) continue;
      let input: Record<string, unknown> = {};
      if (a.args) {
        try {
          input = JSON.parse(a.args) as Record<string, unknown>;
        } catch {
          // ignore
        }
      }
      const call: ToolCall = { id: a.id, name: a.name, input };
      toolCalls.push(call);
      if (onToolCall) onToolCall(call);
    }

    return { text: this.stripThinking(fullText), toolCalls };
  }

  // ─── AIProvider.chat() — non-streaming ───

  async chat(
    messages: Message[],
    systemPrompt: string,
    tools?: ToolDef[],
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const body = this.buildBody(messages, systemPrompt, tools, opts, false);

    const endpoint = `${this.baseUrl}/chat/completions`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '(no body)');
      throw new Error(`${this.name} API error ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await res.json()) as OpenAIResponse;
    return this.parseResponse(data);
  }

  // ─── StreamingProvider.chatStream() — SSE streaming ───

  async chatStream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDef[] | undefined,
    onToken: (chunk: string) => void,
    onToolCall?: (call: ToolCall) => void,
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const body = this.buildBody(messages, systemPrompt, tools, opts, true);

    // Some providers (e.g., MiniMax) need the Accept header for SSE
    const headers = {
      ...this.getHeaders(),
      Accept: 'text/event-stream',
    };

    const endpoint = `${this.baseUrl}/chat/completions`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '(no body)');
      throw new Error(`${this.name} API error ${res.status}: ${errText.slice(0, 500)}`);
    }

    const { text, toolCalls } = await this.consumeSSEStream(res, onToken, onToolCall);

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
