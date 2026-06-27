import type {
  AIProvider,
  StreamingProvider,
  Message,
  SessionContext,
  ToolCall,
  ToolResult,
} from '../types.js';
import type { ToolRegistryLike } from './tool-runtime.js';

/** Max inference -> tool-execution iterations per turn. */
export const MAX_LOOP_TURNS = 8;

/**
 * Run the inference -> tool-execution loop.
 *
 * The loop is intentionally independent from prompt assembly and post-turn
 * side effects: it mutates only the provided message history and returns the
 * model text plus tool/turn counts.
 */
export async function runInferenceLoop(
  provider: AIProvider,
  systemPrompt: string,
  messages: Message[],
  sessionCtx: SessionContext,
  registry: ToolRegistryLike,
  onToken: (chunk: string) => void,
): Promise<{ text: string; toolCallCount: number; turns: number }> {
  let toolCallCount = 0;

  for (let i = 0; i < MAX_LOOP_TURNS; i++) {
    const isStreaming = (provider as StreamingProvider).chatStream !== undefined;

    const callOpts = { temperature: 0.7, model: sessionCtx.model };
    const result: { text: string; toolCalls?: ToolCall[] } = isStreaming
      ? await (provider as StreamingProvider).chatStream(
          messages,
          systemPrompt,
          registry.listDefs(),
          onToken,
          undefined,
          callOpts,
        )
      : await provider.chat(messages, systemPrompt, registry.listDefs(), callOpts);

    const toolCalls = result.toolCalls ?? [];
    const assistantMsg: Message = {
      role: 'assistant',
      content: result.text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      timestamp: new Date().toISOString(),
    };
    messages.push(assistantMsg);

    if (toolCalls.length === 0) {
      return { text: result.text, toolCallCount, turns: i + 1 };
    }

    toolCallCount += toolCalls.length;

    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      const result = await registry.execute(
        { id: call.id, name: call.name, input: call.input },
        sessionCtx,
      );
      results.push(result);
    }

    const toolResultMsg: Message = {
      role: 'user',
      content: results.map((r) => `tool ${r.name}:\n${r.output}`).join('\n\n'),
      toolResults: results,
      timestamp: new Date().toISOString(),
    };
    messages.push(toolResultMsg);
  }

  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  return {
    text: typeof last?.content === 'string' ? last.content : '',
    toolCallCount,
    turns: MAX_LOOP_TURNS,
  };
}
