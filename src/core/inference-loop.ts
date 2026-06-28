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

/** Warn the model after this many consecutive same-tool turns. */
export const TOOL_STREAK_THRESHOLD = 3;

/**
 * Detect a tool called in the last `threshold` consecutive assistant turns — a
 * sign the agent is stuck looping. Returns a nudge message, or null if no
 * single tool spans all the recent turns. (Borrowed from AstrBot's
 * ToolLoopAgentRunner streak guard.)
 */
export function detectRepeatedToolStreak(toolNamesPerTurn: string[][], threshold: number): string | null {
  if (toolNamesPerTurn.length < threshold) return null;
  const recent = toolNamesPerTurn.slice(-threshold);
  const common = recent[0].filter((name) => recent.every((turn) => turn.includes(name)));
  if (common.length === 0) return null;
  return `你已经连续 ${threshold} 次调用 ${common.join('、')}。若没有进展，换个工具或直接用现有信息回答，别重复同样的调用。`;
}

/**
 * Run the inference -> tool-execution loop.
 *
 * The loop is intentionally independent from prompt assembly and post-turn
 * side effects: it mutates only the provided message history and returns the
 * model text plus tool/turn counts.
 *
 * Guardrails (borrowed from AstrBot's ToolLoopAgentRunner):
 *   - streak warning: nudge the model when it loops on the same tool.
 *   - max-step forced summary: on hitting MAX_LOOP_TURNS with tools still
 *     pending, do one final tool-free turn so the user gets a real answer
 *     instead of an empty/partial tool-requesting message.
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
  const toolNamesPerTurn: string[][] = [];

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
    toolNamesPerTurn.push(toolCalls.map((c) => c.name));

    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      const r = await registry.execute(
        { id: call.id, name: call.name, input: call.input },
        sessionCtx,
      );
      results.push(r);
    }

    let content = results.map((r) => `tool ${r.name}:\n${r.output}`).join('\n\n');
    const streak = detectRepeatedToolStreak(toolNamesPerTurn, TOOL_STREAK_THRESHOLD);
    if (streak) content += `\n\n[系统提示] ${streak}`;

    const toolResultMsg: Message = {
      role: 'user',
      content,
      toolResults: results,
      timestamp: new Date().toISOString(),
    };
    messages.push(toolResultMsg);
  }

  // Max steps reached with tools still pending → force one final tool-free turn.
  messages.push({
    role: 'user',
    content: '（已达到工具调用上限，请基于以上信息直接给出回答，不要再调用工具。）',
    timestamp: new Date().toISOString(),
  });
  const isStreaming = (provider as StreamingProvider).chatStream !== undefined;
  const finalOpts = { temperature: 0.7, model: sessionCtx.model };
  const summary: { text: string } = isStreaming
    ? await (provider as StreamingProvider).chatStream(messages, systemPrompt, [], onToken, undefined, finalOpts)
    : await provider.chat(messages, systemPrompt, [], finalOpts);
  messages.push({
    role: 'assistant',
    content: summary.text,
    timestamp: new Date().toISOString(),
  });
  return { text: summary.text, toolCallCount, turns: MAX_LOOP_TURNS };
}
