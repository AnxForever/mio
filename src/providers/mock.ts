// providers/mock.ts — Mock provider for testing without an API key
// Returns canned responses; chatStream emits characters one by one with setTimeout

import type {
  StreamingProvider,
  Message,
  ToolDef,
  ToolCall,
} from '../types.js';

/**
 * MockProvider — no-op provider for local testing and compilation verification.
 *
 * Does not make real API calls. Returns a fixed canned response that echoes
 * the last user message and reports the system prompt length.
 *
 * chatStream() reuses chat() and emits each character one by one with a
 * small delay via setTimeout, simulating streaming output.
 */
export class MockProvider implements StreamingProvider {
  readonly name = 'mock';

  /** Delay between emitted characters in chatStream (ms) */
  private readonly charDelay: number;

  constructor(charDelay: number = 10) {
    this.charDelay = charDelay;
  }

  /**
   * Non-streaming chat — returns a canned response immediately.
   */
  async chat(
    messages: Message[],
    systemPrompt: string,
    _tools?: ToolDef[],
    _opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const last = messages[messages.length - 1];
    let lastContent: string;
    if (typeof last?.content === 'string') {
      lastContent = last.content.slice(0, 60);
    } else if (Array.isArray(last?.content)) {
      const firstText = last.content.find((b) => b.type === 'text');
      lastContent = firstText ? firstText.text.slice(0, 60) : '[multimodal]';
    } else {
      lastContent = '';
    }

    return {
      text:
        `[mock reply to: ${lastContent}]\n\n` +
        `(MockProvider — configure MIO_PROVIDER plus a real provider API key to call a model. ` +
        `System prompt length: ${systemPrompt.length} chars.)`,
    };
  }

  /**
   * Streaming chat — emits each character of the canned response one by one
   * with a setTimeout delay, then returns the full text.
   */
  async chatStream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDef[] | undefined,
    onToken: (chunk: string) => void,
    _onToolCall?: (call: ToolCall) => void,
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const response = await this.chat(messages, systemPrompt, tools, opts);

    for (const char of response.text) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          onToken(char);
          resolve();
        }, this.charDelay);
      });
    }

    return response;
  }
}
