// providers/anthropic.ts — Anthropic Claude provider with SSE streaming
// Implements StreamingProvider: non-streaming chat() + streaming chatStream()

import type {
  StreamingProvider,
  Message,
  ToolDef,
  ToolCall,
  ContentBlock,
} from '../types.js';
import { TextDecoder } from 'node:util';
import { fetchWithRetry } from './http.js';

// ─── Anthropic API types ───

interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  source?: { type: string; media_type: string; data: string };
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/** SSE event payload (fields are optional depending on event type) */
interface SSEData {
  type: string;
  index?: number;
  content_block?: { type: string; text?: string; id?: string; name?: string };
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
}

// ─── AnthropicProvider ───

/**
 * AnthropicProvider — Anthropic Claude implementation of StreamingProvider.
 *
 * - chat():       Non-streaming call to POST /v1/messages
 * - chatStream(): SSE streaming call (stream: true), parses content_block_delta
 *                 events and invokes onToken for text deltas, onToolCall for
 *                 completed tool_use blocks.
 *
 * Supports both text and image content blocks in messages.
 * Tool use: parses tool_use content blocks from the response and maps them to
 * ToolCall[].
 */
export class AnthropicProvider implements StreamingProvider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly baseUrl = 'https://api.anthropic.com/v1/messages';

  constructor(apiKey: string, defaultModel: string = 'claude-sonnet-4-20250514') {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  // ─── Headers ───

  private getHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  // ─── Message mapping ───

  /**
   * Map Mio Message[] to Anthropic messages format.
   *
   * - role 'system' is converted to 'user' (system prompt is sent separately)
   * - string content is passed through when no tool blocks are present
   * - ContentBlock[] is mapped element-by-element (text / image)
   * - assistant toolCalls become tool_use blocks
   * - user toolResults become tool_result blocks
   */
  private mapMessages(messages: Message[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      // Anthropic only accepts 'user' and 'assistant' roles in messages
      const role = msg.role === 'system' ? 'user' : msg.role;

      const hasToolBlocks =
        (msg.toolCalls !== undefined && msg.toolCalls.length > 0) ||
        (msg.toolResults !== undefined && msg.toolResults.length > 0);

      // Simple case: string content, no tool blocks → pass string directly
      if (typeof msg.content === 'string' && !hasToolBlocks) {
        result.push({ role, content: msg.content });
        continue;
      }

      // Build content block array
      const blocks: AnthropicContentBlock[] = [];

      // Map message content
      if (typeof msg.content === 'string') {
        if (msg.content.length > 0) {
          blocks.push({ type: 'text', text: msg.content });
        }
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content as ContentBlock[]) {
          if (block.type === 'text') {
            blocks.push({ type: 'text', text: block.text });
          } else if (block.type === 'image') {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: block.source.media_type,
                data: block.source.data,
              },
            });
          }
        }
      }

      // Add tool_use blocks for assistant messages with tool calls
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
      }

      // Add tool_result blocks for user messages with tool results
      if (msg.toolResults) {
        for (const tr of msg.toolResults) {
          const block: AnthropicContentBlock = {
            type: 'tool_result',
            tool_use_id: tr.id,
            content: tr.output,
          };
          if (tr.isError) {
            block.is_error = true;
          }
          blocks.push(block);
        }
      }

      result.push({ role, content: blocks });
    }

    return result;
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
      system: systemPrompt,
      messages: this.mapMessages(messages),
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    if (stream) {
      body['stream'] = true;
    }

    return body;
  }

  // ─── Response parser (non-streaming) ───

  private parseResponse(data: AnthropicResponse): { text: string; toolCalls?: ToolCall[] } {
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        text += block.text;
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        });
      }
    }

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  // ─── SSE stream consumer ───

  /**
   * Consume an SSE response stream from the Anthropic API.
   *
   * Parses content_block_start / content_block_delta / content_block_stop events:
   * - text_delta → calls onToken(chunk)
   * - input_json_delta → accumulates partial JSON for tool_use blocks
   * - content_block_stop for tool_use → parses accumulated JSON, calls onToolCall
   *
   * Returns the full text and all tool calls.
   */
  private async consumeSSEStream(
    response: Response,
    onToken: (chunk: string) => void,
    onToolCall?: (call: ToolCall) => void,
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    if (!response.body) {
      throw new Error('Anthropic API returned empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    const toolCalls: ToolCall[] = [];

    // Track in-flight content blocks by index
    const blockStates = new Map<
      number,
      {
        type: string;
        text: string;
        toolId?: string;
        toolName?: string;
        inputJson: string;
      }
    >();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';

      for (const eventStr of events) {
        const lines = eventStr.split(/\r?\n/);
        let dataStr = '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            dataStr = line.slice(6);
          } else if (line.startsWith('data:')) {
            dataStr = line.slice(5);
          }
        }

        if (!dataStr) continue;

        let data: SSEData;
        try {
          data = JSON.parse(dataStr) as SSEData;
        } catch {
          continue;
        }

        // content_block_start — register a new block
        if (
          data.type === 'content_block_start' &&
          data.index !== undefined &&
          data.content_block
        ) {
          blockStates.set(data.index, {
            type: data.content_block.type ?? 'text',
            text: '',
            toolId: data.content_block.id,
            toolName: data.content_block.name,
            inputJson: '',
          });
          continue;
        }

        // content_block_delta — append text or tool input JSON
        if (
          data.type === 'content_block_delta' &&
          data.index !== undefined &&
          data.delta
        ) {
          const state = blockStates.get(data.index);
          if (!state) continue;

          if (data.delta.type === 'text_delta' && data.delta.text) {
            state.text += data.delta.text;
            fullText += data.delta.text;
            onToken(data.delta.text);
          } else if (
            data.delta.type === 'input_json_delta' &&
            data.delta.partial_json
          ) {
            state.inputJson += data.delta.partial_json;
          }
          continue;
        }

        // content_block_stop — finalize block (tool_use → ToolCall)
        if (data.type === 'content_block_stop' && data.index !== undefined) {
          const state = blockStates.get(data.index);
          if (!state) continue;

          if (state.type === 'tool_use' && state.toolId && state.toolName) {
            let input: Record<string, unknown> = {};
            if (state.inputJson) {
              try {
                input = JSON.parse(state.inputJson) as Record<string, unknown>;
              } catch {
                // Keep empty input if accumulated JSON is malformed
              }
            }
            const call: ToolCall = {
              id: state.toolId,
              name: state.toolName,
              input,
            };
            toolCalls.push(call);
            if (onToolCall) {
              onToolCall(call);
            }
          }

          blockStates.delete(data.index);
          continue;
        }
      }
    }

    return { text: fullText, toolCalls };
  }

  // ─── AIProvider.chat() — non-streaming ───

  async chat(
    messages: Message[],
    systemPrompt: string,
    tools?: ToolDef[],
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const body = this.buildBody(messages, systemPrompt, tools, opts, false);

    const res = await fetchWithRetry(this.baseUrl, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as AnthropicResponse;
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

    const res = await fetchWithRetry(this.baseUrl, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errText}`);
    }

    const { text, toolCalls } = await this.consumeSSEStream(
      res,
      onToken,
      onToolCall,
    );

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
