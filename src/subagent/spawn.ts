/**
 * Mio — Subagent Spawner
 *
 * Adapted from cola-companion. Creates an isolated agent loop for a named
 * subagent, injects the subagent-specific system prompt, runs the
 * inference → tool-execution loop, records messages to a transcript,
 * and returns the final text.
 *
 * Key differences from cola-companion:
 *  - provider.chat() uses positional args: (messages, systemPrompt, tools, opts)
 *  - ToolResult.output (not .result)
 *  - ToolCall.input (not .arguments)
 *  - SessionContext.sessionId (not .sessionKey)
 *  - PromptCtx includes gender, emotionState, relationshipState, soulContent
 */

import type {
  AIProvider,
  SessionContext,
  PromptCtx,
  ToolCall,
  ToolResult,
  Message,
  ToolDef,
  EmotionState,
  RelationshipState,
} from '../types.js';
import { buildSubagentPrompt, SUBAGENT_TOOL_CONFIG } from '../prompt/subagent.js';
import { toolRegistry } from '../tools/registry.js';
import { modManager } from '../mod/mod-manager.js';
import { colaDir, outputDir, transcriptPath, globalMemoryPath } from '../memory/paths.js';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Types ───

/** Shape of entries in SUBAGENT_TOOL_CONFIG (mirrors cola-companion). */
interface SubagentToolConfig {
  tools: string[];
  customTools: string[];
  customToolsMode: 'replace' | 'additive';
  maxTurns: number;
  inheritMemory: boolean;
  inheritModContext: boolean;
}

/** Minimal interface for the tool registry (what spawnSubagent needs). */
interface ToolRegistryLike {
  listDefs(names?: string[]): ToolDef[];
  execute(call: ToolCall, ctx: SessionContext): Promise<ToolResult>;
}

// ─── Defaults ───

const SUBAGENT_MAX_TURNS = 30;

const FALLBACK_CONFIG: SubagentToolConfig = {
  tools: [],
  customTools: [],
  customToolsMode: 'additive',
  maxTurns: SUBAGENT_MAX_TURNS,
  inheritMemory: false,
  inheritModContext: false,
};

// ─── Helpers ───

/** Read the global memory file, if it exists. Returns undefined otherwise. */
function readGlobalMemory(): string | undefined {
  const path = globalMemoryPath();
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Append a message to the subagent's transcript JSONL file.
 * Each line is a JSON object with role, content, and timestamp.
 */
function recordToTranscript(sessionId: string, message: Message): void {
  const path = transcriptPath(sessionId);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const line =
      JSON.stringify({
        ...message,
        timestamp: new Date().toISOString(),
      }) + '\n';
    appendFileSync(path, line, 'utf-8');
  } catch {
    // Transcript write failures are non-fatal.
  }
}

// ─── Tool resolution ───

/**
 * Resolve the tool definitions available to a subagent.
 *
 * - 'additive' mode: all registered tools are available.
 * - 'replace' mode: only the tools named in config.tools + config.customTools.
 *
 * @param config    The subagent tool configuration.
 * @param registry  The tool registry instance.
 * @returns         Array of ToolDef objects to pass to the provider.
 */
export function resolveSubagentTools(
  config: SubagentToolConfig,
  registry: ToolRegistryLike,
): ToolDef[] {
  if (config.customToolsMode === 'additive') {
    // additive: full registry + any custom tools (already registered)
    return registry.listDefs();
  }
  // replace: only the specified tools
  const names = [...config.tools, ...config.customTools];
  return registry.listDefs(names);
}

// ─── Main spawner ───

/**
 * Spawn an isolated subagent loop.
 *
 * 1. Resolve tool config from SUBAGENT_TOOL_CONFIG.
 * 2. Build a PromptCtx from baseCtx + mod manager state.
 * 3. Build the subagent system prompt via buildSubagentPrompt.
 * 4. Create an isolated agent loop (max turns from config).
 * 5. Run the inference → tool-execution loop.
 * 6. Record messages to a transcript file.
 * 7. Return the final assistant text.
 *
 * @param name       Subagent name (must exist in SUBAGENT_TOOL_CONFIG).
 * @param prompt     The user prompt / task for the subagent.
 * @param provider   AI provider for inference.
 * @param baseCtx    Partial session context to inherit (model, gender, etc.)
 * @param opts       Optional overrides (customSystemPrompt, maxTurns).
 * @returns          The subagent's final text response.
 */
export async function spawnSubagent(
  name: string,
  prompt: string,
  provider: AIProvider,
  baseCtx?: Partial<SessionContext>,
  opts?: {
    customSystemPrompt?: string;
    maxTurns?: number;
    awaitTerminal?: boolean;
  },
): Promise<string> {
  const config: SubagentToolConfig =
    (SUBAGENT_TOOL_CONFIG as Record<string, SubagentToolConfig>)[name] ??
    (SUBAGENT_TOOL_CONFIG as Record<string, SubagentToolConfig>)['worker'] ??
    FALLBACK_CONFIG;

  const dir = colaDir();
  const sessionId = randomUUID().slice(0, 12);
  const registry = toolRegistry() as unknown as ToolRegistryLike;

  // ── Resolve inherited context ──
  const globalMem = config.inheritMemory ? readGlobalMemory() : undefined;

  let soulContent = '';
  let activeMod = baseCtx?.activeMod ?? 'default';
  if (config.inheritModContext) {
    try {
      const mm = modManager();
      soulContent = mm.getCurrentSoulContent();
      activeMod = mm.activeMod;
    } catch {
      // modManager not initialized — use defaults.
    }
  }

  // ── Build prompt context ──
  const promptCtx: PromptCtx = {
    sessionId,
    model: baseCtx?.model ?? 'claude-sonnet-4-20250514',
    apiKey: baseCtx?.apiKey,
    gender: baseCtx?.gender ?? 'girlfriend',
    emotionState: baseCtx?.emotionState ?? defaultEmotionState(),
    relationshipState: baseCtx?.relationshipState ?? defaultRelationshipState(),
    activeMod,
    soulContent,
    colaDir: dir,
    outputDir: outputDir(),
    connectedChannels: baseCtx?.connectedChannels ?? [],
    allowColaLinkSend: false,
    globalMemory: globalMem,
    initialTask: prompt,
  };

  // ── Build system prompt ──
  const systemPrompt = buildSubagentPrompt(
    name,
    opts?.customSystemPrompt,
    promptCtx,
  );

  // ── Resolve tools ──
  const tools = resolveSubagentTools(config, registry);

  // ── Build session context ──
  const ctx: SessionContext = {
    sessionId,
    model: promptCtx.model,
    apiKey: promptCtx.apiKey,
    gender: promptCtx.gender,
    emotionState: promptCtx.emotionState,
    relationshipState: promptCtx.relationshipState,
    activeMod: promptCtx.activeMod,
    colaDir: dir,
    outputDir: outputDir(),
    connectedChannels: baseCtx?.connectedChannels,
  };

  // ── Initialise messages ──
  const messages: Message[] = [{ role: 'user', content: prompt }];
  recordToTranscript(sessionId, { role: 'user', content: prompt });

  const maxTurns = opts?.maxTurns ?? config.maxTurns ?? SUBAGENT_MAX_TURNS;

  // ── Agent loop ──
  for (let turn = 0; turn < maxTurns; turn++) {
    // Inference call (positional args — Mio's AIProvider.chat signature).
    const response = await provider.chat(
      messages,
      systemPrompt,
      tools,
      { temperature: 0.5, model: ctx.model },
    );

    const assistantMsg: Message = {
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
    };
    messages.push(assistantMsg);
    recordToTranscript(sessionId, assistantMsg);

    // No tool calls → subagent is done.
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return response.text;
    }

    // Execute each tool call.
    const results: ToolResult[] = [];
    for (const call of response.toolCalls) {
      const result = await registry.execute(call, ctx);
      results.push(result);
    }

    // Append tool results as a user message (standard agent pattern).
    const toolResultMsg: Message = {
      role: 'user',
      content: results
        .map((r) => `tool ${r.name}:\n${r.output}`)
        .join('\n\n'),
      toolResults: results,
    };
    messages.push(toolResultMsg);
    recordToTranscript(sessionId, toolResultMsg);
  }

  // Exhausted max turns — return last assistant message.
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant');
  return typeof lastAssistant?.content === 'string'
    ? lastAssistant.content
    : '(subagent ended without final response)';
}

// ─── Default states (for when baseCtx lacks them) ───

function defaultEmotionState(): EmotionState {
  return {
    myMood: '\u5e73\u9759', // 平静
    userMood: '\u672a\u77e5', // 未知
    affection: 30,
    energy: 'mid',
    lastInteraction: new Date().toISOString(),
    unresolvedThread: null,
    recentTopics: [],
  };
}

function defaultRelationshipState(): RelationshipState {
  return {
    stage: 'acquaintance',
    stageChangedAt: new Date().toISOString(),
    interactionCount: 0,
    emotionalDepth: 0,
    sharedMemories: [],
    nicknames: {
      userCallsAgent: null,
      agentCallsUser: null,
    },
  };
}
