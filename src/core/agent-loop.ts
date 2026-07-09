/**
 * Mio — Agent Loop Orchestrator
 *
 * The single source of truth for "a turn of conversation".
 *
 * Per turn:
 *  1. Resolve session context (model, gender, emotion, relationship, active mod)
 *  2. Build the system prompt (L1→L4 + active soul + subagent context)
 *  3. Append the user's message
 *  4. Run inference → tool-execution loop (max turns)
 *  5. After the loop: record transcript, update emotion state, append to BOOKMARKS
 *  6. Return the final assistant text + (optional) voice flag
 *
 * The orchestrator coordinates:
 *  - Tool registry lifecycle (delegated to core/tool-runtime.ts)
 *  - Memory-bank side effects (MEMORY.md Active Context, BOOKMARKS.md append)
 *  - Crisis-detection pre-screening (Phase 4)
 *
 * It does NOT own:
 *  - Channel I/O (HTTP/WS/CLI live in src/server/ and src/index.ts)
 *  - The subagent spawner (recursion-safe: subagents are isolated)
 *  - Schedulers (nightly + proactive run on their own cron)
 */

import {
  IDENTITY,
  VOICE,
  EMOTION_NOTE,
  COMPACTION_RECOVERY,
  NEW_SESSION_RECOVERY,
  FEWSHOT,
  buildRelationshipContext,
  buildUserContext,
  buildMemoryContext,
  buildStructuredMemoryContext,
  buildRelationshipAwareness,
  buildTimeContext,
  buildEmotionContext,
  buildProceduralMemoryContext,
} from '../prompt/templates.js';
import { buildXmlContext } from '../prompt/xml-context.js';
import type { ContextSections } from '../prompt/xml-context.js';
import { ContextEngine, getContextEngine } from '../prompt/context-engine.js';
import { getEvaluationGraph, getBuilderChain, type EvaluationResult } from '../prompt/builder-chain.js';
import { applyPersonaDelta, buildPreferencePrompt, buildCharacterNote } from '../persona/layered.js';
import { buildVoiceExampleSection, buildVoiceGuidanceSection } from '../persona/voice-presets.js';
import { buildOwnLifeSection } from '../persona/own-life.js';
import { getRouterConfig, routeTask } from '../providers/router.js';
import { scopedToolRegistry } from './tool-runtime.js';
import { pluginRegistry } from '../plugins/index.js';
import { runInferenceLoop } from './inference-loop.js';
import { isIdentityProbe, detectL0Break, buildL0ReassertInstruction } from '../safety/l0-guard.js';
import { readGlobalMemory } from '../memory/global.js';
import { getConfig } from '../config.js';
import { recordMessage } from '../tools/session.js';
import { classifyIntent } from '../emotion/tracker.js';
import { defaultEmotionState } from '../emotion/state.js';
import { defaultRelationshipState } from '../relationship/progression.js';
import { appendBookmark, readUserProfile, readRecentBookmarks, readStructuredMemoryFile } from '../memory/bank.js';
import { deserializeMemory } from '../memory/structured-memory.js';
import { search as searchMemory } from '../memory/vector.js';
import { rerankByLLM } from '../memory/rerank.js';
import { appendMemoryUsefulnessTrace, collectMemoryUsefulnessCandidates } from '../memory/usefulness.js';

import { getLorebookContext, commitLorebookState } from '../memory/lorebook.js';
import { PromptBudget } from '../utils/prompt-budget.js';

import { logger } from '../utils/logger.js';
import { screenForCrisis } from '../safety/crisis.js';
import { markReplied } from '../emotion/ghost.js';

import {
  ensurePersonaGraph,
  loadPersonaGraph,
  refreshPersonaGraph,
  needsRefresh,
} from '../persona/extractor.js';
import {
  retrieveRelevantNodes,
  graphToPrompt,
  type PersonaGraph,
  type RetrievalContext,
} from '../persona/graph.js';
import { getCurrentMode, shouldSwitchMode, executeSwitch, recordTurn as recordDualModeTurn, getDualModePrompt } from '../persona/dual-mode.js';
import {
  updatePersonalityFromContext,
  getResponseStyle,
  rotateActivity,
  applyIgnoredEffect,
  applyWelcomeBackEffect,
  isPersonalityDriverEnabled,
  type PersonalityState,
} from '../persona/driver.js';
import { getPADState } from '../emotion/pad.js';
import { getMultiAxis } from '../emotion/multi-axis.js';
import { getRecentSignalHistory } from '../emotion/signals.js';
import { readActiveCharacter } from '../character/factory.js';
import { getMemoryContext } from '../character/memory-stream.js';
import type {
  SessionContext,
  Message,
  PromptCtx,
  EmotionState,
} from '../types.js';
import { prepareTurnContext } from './turn-prepare.js';
import { maybeHandleEarlyTurnExit } from './turn-silence.js';
import { applyReplyQualityGateWithJudge } from './reply-quality-gate.js';
import { applyPostTurnSideEffects } from './turn-post-effects.js';
import { getTurnCounter } from './turn-counter.js';
import { buildConversationMessages } from './turn-conversation.js';
import type {
  InferenceStageResult,
  PreparedTurnContext,
  RunTurnOptions,
  TurnInput,
  TurnOutput,
} from './turn-types.js';

export type { TurnInput, TurnOutput } from './turn-types.js';

// ─── Prompt assembly ───

/**
 * Build the system prompt for the main agent loop using ContextEngine.
 *
 * Layers (top → bottom):
 *   CORE_IDENTITY            — "You are Mio. Not an AI."
 *   Soul (from mod)          — THE personality — single source of truth
 *   Relationship context     — dynamic: stage, nicknames, shared memories
 *   User context             — dynamic: user profile, recent topics
 *   Memory context           — dynamic: recent bookmarks
 *   Time context             — dynamic: time of day, days since last chat
 *   Emotional context        — dynamic: Mio's current mood/energy
 *   Few-shot                 — BAD/GOOD grounding examples
 *   Emotion note             — natural reminder to track feelings
 *   Recovery hint            — NEW_SESSION_RECOVERY or COMPACTION_RECOVERY
 *
 * The key insight: PERSONALITY comes ONLY from the mod's soul.md.
 * Everything else is dynamic CONTEXT that makes Mio aware of the relationship,
 * the user, and the current moment — which is what makes her feel alive.
 *
 * This function uses the global ContextEngine singleton for assembly.
 * Sections are registered lazily on first call and can be augmented
 * dynamically via contextEngine.register() at any point.
 */
function buildSystemPrompt(
  ctx: PromptCtx,
  recovery: 'new' | 'compact' | 'none',
  budget?: PromptBudget,
): string {
  const engine = getContextEngine();
  registerPromptSections(engine, ctx, recovery);

  // Model-aware budget: strong models (Claude, GPT-4o, Grok) get more room
  // for richer context; weaker models get tighter budget to avoid dilution.
  const maxTokens = isStrongModel()
    ? 8000   // Claude / GPT-4o / Grok — trust them with more context
    : 6000;  // MiniMax / DeepSeek / GLM — tighter to avoid rule dilution

  const prompt = engine.assemble(maxTokens);

  // Backward compat: populate budget if tracking is enabled
  if (budget) {
    const report = engine.getBudget();
    for (const line of report.lines) {
      if (line.included) {
        // Reconstruct the section name for the old budget API
        // Use the type from the section content via a lookup
        const section = engine.get(line.type);
        if (section) {
          const content = typeof section.content === 'function'
            ? (section.content as () => string)()
            : section.content;
          budget.add(line.type, content);
        }
      }
    }
  }

  return prompt;
}

function registerPromptSections(
  engine: ContextEngine,
  ctx: PromptCtx,
  recovery: 'new' | 'compact' | 'none',
): void {
  const sectionEnabled = (section: string): boolean => !isEvalSectionDisabled(section);
  const sharedMemoryAllowed = !ctx.isolatedMemory;

  // ─── Critical tier: identity, preferences, privacy ───

  // L1: Identity — merged old CORE_IDENTITY + KERNEL into single paradox-free block.
  // Soul.md does the heavy personality lifting; this is just the anchor.
  engine.register('identity', {
    type: 'identity',
    content: IDENTITY,
    priority: 'critical',
  });

  // L2: User preferences — critical so personalization is never trimmed.
  engine.register('preference', {
    type: 'preference',
    content: () => buildPreferencePrompt(ctx.preferences),
    priority: 'critical',
    condition: () => !!ctx.preferences && ctx.preferences.explicit.length > 0,
  });

  // Isolated session privacy guard.
  engine.register('session-privacy', {
    type: 'session-privacy',
    content: () => buildIsolatedSessionPrivacyContext(),
    priority: 'critical',
    condition: () => ctx.isolatedMemory === true,
  });

  // ─── High tier: soul, voice, relationship, user, time, emotion ───

  // L3: Soul (ID-RAG personality fragment + mod soul.md).
  // The single source of personality truth. Highest non-critical priority.
  engine.register('soul', {
    type: 'persona',
    content: () => {
      const fragment = buildPersonaFragment(ctx);
      const base = fragment ?? ctx.soulContent ?? '';
      return applyPersonaDelta(base, ctx.personaDelta);
    },
    priority: 'high',
    condition: () => {
      if (!sectionEnabled('soul')) return false;
      const fragment = buildPersonaFragment(ctx);
      return fragment !== null || (ctx.soulContent != null && ctx.soulContent.trim().length > 0);
    },
  });

  // L4: Voice guidance — positive, minimal (~150 tokens, Nano Bear style).
  engine.register('voice', {
    type: 'voice',
    content: () => buildVoiceGuidanceSection(),
    priority: 'high',
    condition: () => sectionEnabled('voice'),
  });

  // L5: Static few-shot — 24 natural conversation examples.
  // Must come BEFORE dynamic sections (time, emotion) for prompt caching
  // (arXiv 2601.06007: "order most-to-least stable"). Few-shot text is
  // completely static across turns — cache hit saves ~1300 tokens.
  engine.register('fewshot', {
    type: 'fewshot',
    content: FEWSHOT,
    priority: 'high',
    condition: () => sectionEnabled('fewshot'),
  });

  // L6: Voice examples — per-preset few-shot (12 pairs), also fully static.
  engine.register('voice-examples', {
    type: 'voice-examples',
    content: () => buildVoiceExampleSection(),
    priority: 'high',
    condition: () => sectionEnabled('voice-examples') && buildVoiceExampleSection().length > 0,
  });

  // L7: Emotion note — quiet reminder, static across turns.
  engine.register('emotion-note', {
    type: 'emotion-note',
    content: EMOTION_NOTE,
    priority: 'low',
    condition: () => sectionEnabled('emotion-note'),
  });

  // L8: Relationship context — stage + awareness + memory count.
  engine.register('relationship', {
    type: 'relationship',
    content: () => {
      const base = buildRelationshipContext(ctx.relationshipState);
      const structuredRaw = readStructuredMemoryFile();
      let memoryCount = 0;
      try {
        if (structuredRaw) {
          const mem = deserializeMemory(structuredRaw);
          memoryCount = mem?.entities?.filter((e: { invalidatedAt?: string }) => !e.invalidatedAt).length ?? 0;
        }
      } catch { /* best-effort */ }
      const awareness = buildRelationshipAwareness(
        ctx.relationshipState.stage,
        ctx.relationshipState.interactionCount ?? 0,
        memoryCount,
      );
      return [base, awareness].filter(Boolean).join('\n\n');
    },
    priority: 'high',
    condition: () => sharedMemoryAllowed && sectionEnabled('relationship'),
  });

  // L9: User context — profile, recent topics.
  engine.register('user', {
    type: 'user',
    content: () => buildUserContext(readUserProfile(), ctx.emotionState.recentTopics),
    priority: 'high',
    condition: () => sharedMemoryAllowed && sectionEnabled('user'),
  });

  // L10: Time context — dynamic (contains "现在是2026年7月9日14:11").
  // After statics → cache break only affects downstream sections.
  engine.register('time', {
    type: 'time',
    content: () => buildTimeContext(
      ctx.isolatedMemory ? null : ctx.emotionState.lastInteraction || null,
    ),
    priority: 'high',
    condition: () => sectionEnabled('time'),
  });

  // L11: Temporal state — critical for continuity, but dynamic content.
  engine.register('temporal-state', {
    type: 'temporal-state',
    content: () => ctx.temporalContext ?? '',
    priority: 'critical',
    condition: () => sectionEnabled('temporal-state') && !!ctx.temporalContext,
  });

  // L12: Emotion — dynamic (PAD state changes every turn).
  engine.register('emotion', {
    type: 'emotion',
    content: () => ctx.isolatedMemory
      ? buildIsolatedEmotionContext(ctx.emotionState)
      : buildEmotionContext(ctx.emotionState),
    priority: 'high',
    condition: () => sectionEnabled('emotion'),
  });

  // ─── Medium tier: memory, procedural memory, own-life ───

  // L13: Memory — dynamic (retrieved per-turn from structured-memory + bookmarks).
  engine.register('memory', {
    type: 'memory',
    content: () => buildMemorySection(ctx),
    priority: 'medium',
    condition: () => sharedMemoryAllowed && sectionEnabled('memory') && buildMemorySection(ctx).length > 0,
  });

  // L14: Procedural memory — semi-static (learned patterns, rarely updated).
  engine.register('procedural-memory', {
    type: 'procedural-memory',
    content: () => buildProceduralMemoryContext() ?? '',
    priority: 'medium',
    condition: () => sharedMemoryAllowed && sectionEnabled('procedural-memory') && buildProceduralMemoryContext() !== null,
  });

  // L15: Own life — semi-static (changes by time of day).
  engine.register('own-life', {
    type: 'own-life',
    content: () => buildOwnLifeSection(),
    priority: 'medium',
    condition: () => sectionEnabled('own-life'),
  });

  // ─── Recovery hint (conditional) ───

  engine.register('recovery', {
    type: 'recovery',
    content: () => {
      if (recovery === 'new') {
        return NEW_SESSION_RECOVERY(ctx.colaDir + '/memory-bank');
      } else if (recovery === 'compact') {
        return COMPACTION_RECOVERY(ctx.colaDir + '/memory-bank');
      }
      return '';
    },
    priority: 'critical',
    condition: () => sectionEnabled('recovery') && recovery !== 'none',
  });
}

function buildPluginPromptContext(ctx: PromptCtx): string {
  const fragments = pluginRegistry()
    .getPromptFragments(ctx)
    .map((fragment) => fragment.trim())
    .filter(Boolean)
    .filter((fragment, index, all) => all.indexOf(fragment) === index);

  if (fragments.length === 0) return '';
  return ['## 插件上下文', ...fragments].join('\n\n');
}

/**
 * Detect strong models that handle character simulation natively.
 * Strong models = higher budget + less rule scaffolding.
 */
function isStrongModel(): boolean {
  try {
    const config = getConfig();
    const provider = config.provider?.toLowerCase() ?? '';
    const model = config.model?.toLowerCase() ?? '';
    // Strong model indicators
    if (provider === 'anthropic') return true; // Claude
    if (provider === 'openai' && (model.includes('gpt-4') || model.includes('o1') || model.includes('o3'))) return true;
    if (provider === 'xai' || provider === 'grok') return true; // Grok
    return false;
  } catch {
    return false;
  }
}

function buildIsolatedSessionPrivacyContext(): string {
  return [
    '## IM 联系人隔离',
    '这是一个外部 IM 联系人的独立会话。',
    '只使用当前会话 transcript、这个联系人自己的显式偏好和本轮消息作答。',
    '不要引用、猜测或沿用全局用户资料、其他联系人记忆、共同回忆、昵称、最近事件或长期事实。',
    '本轮请求只代表“刚收到对方这一条消息”。除非对方明说已经隔了很久，或时间线明确显示长时间未回复，否则不要自造等待、冷落、被不理、刚刚生气等后续剧情。',
    '如果上一条自己说了“不打扰你/你先忙”，对方回“嗯/好/嗯嗯”时，应保持前后一致，不要立刻反悔抱怨。',
  ].join('\n');
}

function buildIsolatedEmotionContext(emotion: EmotionState): string {
  return [
    '## 你现在的状态',
    `心情：${emotion.myMood || '平静'}`,
    `精力：${emotion.energy === 'high' ? '充沛' : emotion.energy === 'low' ? '低落' : '一般'}`,
  ].join('\n');
}

function isEvalSectionDisabled(section: string): boolean {
  const raw = process.env.MIO_EVAL_DISABLE_SECTIONS;
  if (!raw) return false;
  const disabled = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return disabled.includes(section) || disabled.includes('*');
}

/**
 * Build the memory prompt section.
 *
 * Combines two sources, in order:
 *   1. Semantically-relevant memories prefetched for *this* input via
 *      vector.search() (hydrated onto ctx in runTurn before prompt assembly —
 *      see prefetchSemanticMemories).
 *   2. The 3 most-recent bookmarks, as a chronological recency anchor.
 *
 * Kept fully synchronous so it can run inside a ContextEngine section factory;
 * the async vector search happens earlier in the turn.
 */
function buildMemorySection(ctx: PromptCtx): string {
  if (ctx.isolatedMemory) return '';

  const parts: string[] = [];

  const semantic = ctx.semanticMemories ?? [];
  if (semantic.length > 0) {
    const lines = ['## 相关记忆'];
    for (const m of semantic) {
      const ts = m.timestamp ? `${m.timestamp.slice(0, 16)} ` : '';
      lines.push(`- ${ts}${m.text}`);
    }
    parts.push(lines.join('\n'));
  }

  const recent = buildMemoryContext(readRecentBookmarks(3));
  if (recent) parts.push(recent);

  return parts.join('\n\n');
}

/**
 * Prefetch semantically-relevant memories for the current input and hydrate
 * promptCtx.semanticMemories.
 *
 * Why here and not in the prompt section: vector.search() is async, but the
 * memory prompt section is a synchronous ContextEngine factory and can't await.
 * So we run the search in runTurn — before prompt assembly — and stash the
 * results on ctx for the section to consume synchronously.
 *
 * Uses vector.search() (dense/sparse cosine) rather than hybridSearch, which
 * has a TF-fallback path that pollutes dense-mode results.
 *
 * Best-effort: a search failure must never break the turn.
 */
async function prefetchSemanticMemories(input: TurnInput, promptCtx: PromptCtx): Promise<void> {
  if (promptCtx.isolatedMemory) return;
  if (!input.text || input.text.trim().length === 0) return;
  try {
    const hits = await searchMemory(input.text, 10);
    if (hits.length > 0) {
      // U6: LLM-rerank the wider candidate set, then keep the best 5.
      const reranked = await rerankByLLM(input.text, hits, 5, (h) => h.text);
      promptCtx.semanticMemories = reranked.map((h) => ({
        text: h.text,
        timestamp: h.timestamp,
        score: h.score,
      }));
    }
  } catch (err) {
    logger.error('semantic memory prefetch failed', { error: String(err) });
  }
}


// ─── Post-History Injection (Part 2: Prompt Architecture) ───

/**
 * Build the heavy personality/context content for post-history injection.
 *
 * When `postHistoryInjection` is enabled, this content is injected as a faux
 * user message *after* the conversation history, leveraging recency bias so
 * the model pays most attention to these instructions.
 *
 * When `xmlContext` is enabled, this uses XML tags instead of Markdown headers.
 *
 * @param ctx             Prompt context (soul, relationship, user, etc.)
 * @param bookmarks       Recent bookmarks for memory context
 * @param userProfile     Current user profile content
 * @returns               The heavy personality/context block as a string
 */
function buildPostPrompt(
  ctx: PromptCtx,
  bookmarks: { what: string; time: string }[],
  userProfile: string,
): string {
  const config = getConfig();
  if (ctx.isolatedMemory) return buildIsolatedPostPrompt(ctx);

  if (config.features.xmlContext) {
    const sections: ContextSections = {
      identity: IDENTITY,
      soul: ctx.soulContent,
      relationship: ctx.relationshipState,
      user: {
        profile: userProfile,
        recentTopics: ctx.emotionState.recentTopics,
      },
      currentState: ctx.emotionState,
      time: {
        now: new Date(),
        lastInteraction: ctx.emotionState.lastInteraction || null,
      },
      recentMemory: bookmarks.length > 0 ? { bookmarks } : undefined,
      lorebook: config.features.lorebook && ctx.initialTask
        ? getLorebookContext([ctx.initialTask]) ?? undefined
        : undefined,
      instructions: [
        '- 接情绪不接话术',
        '- 做反应不做分析',
        '- 问一个问题就够了，或者不问',
        '- 回复后用 mutter 悄悄更新你的心情',
        '- 不用 emoji 装饰句子',
        '- 不解释工具调用，不提"作为AI"',
      ],
    };
    const xml = buildXmlContext(sections);
    return ctx.temporalContext ? `${xml}\n\n${ctx.temporalContext}` : xml;
  }

  // Fallback: Markdown-based post prompt (identical to the legacy system prompt
  // personality layers but assembled as a single block for injection)
  const parts: string[] = [];

  // Soul content
  if (ctx.soulContent && ctx.soulContent.trim().length > 0) {
    const personaFragment = buildPersonaFragment(ctx);
    if (personaFragment) {
      parts.push(personaFragment);
    } else {
      parts.push(ctx.soulContent);
    }
  }

  // Relationship context
  parts.push(buildRelationshipContext(ctx.relationshipState));

  // User context
  parts.push(buildUserContext(userProfile, ctx.emotionState.recentTopics));

  // Memory context
  const memCtx = buildMemoryContext(bookmarks);
  if (memCtx) parts.push(memCtx);

  // Structured memory context
  try {
    const structuredRaw = readStructuredMemoryFile();
    if (structuredRaw && structuredRaw.trim().length > 0) {
      const structured = deserializeMemory(structuredRaw);
      const structuredCtx = buildStructuredMemoryContext(structured, ctx.initialTask);
      if (structuredCtx) parts.push(structuredCtx);
    }
  } catch {
    // Best-effort
  }

  // Lorebook context
  if (getConfig().features.lorebook && ctx.initialTask) {
    const loreCtx = getLorebookContext([ctx.initialTask]);
    if (loreCtx) parts.push(loreCtx);
  }

  // Emotional context
  parts.push(buildEmotionContext(ctx.emotionState));

  if (ctx.temporalContext) parts.push(ctx.temporalContext);

  // Instructions
  parts.push(EMOTION_NOTE);

  return parts.join('\n\n');
}

function buildIsolatedPostPrompt(ctx: PromptCtx): string {
  const parts: string[] = [buildIsolatedSessionPrivacyContext()];

  if (ctx.soulContent && ctx.soulContent.trim().length > 0) {
    const personaFragment = buildPersonaFragment(ctx);
    const base = personaFragment ?? ctx.soulContent;
    parts.push(applyPersonaDelta(base, ctx.personaDelta));
  }

  const preferences = buildPreferencePrompt(ctx.preferences);
  if (preferences) parts.push(preferences);

  parts.push(buildIsolatedEmotionContext(ctx.emotionState));
  if (ctx.temporalContext) parts.push(ctx.temporalContext);
  parts.push(EMOTION_NOTE);

  return parts.join('\n\n');
}

/**
 * Build the lightweight pre-history prompt for post-history injection mode.
 *
 * When post-history injection is enabled, this replaces the full system prompt.
 * It contains only the essential framing — the heavy personality goes
 * after the conversation history.
 */
function buildPrePrompt(recovery: 'new' | 'compact' | 'none', colaDir: string): string {
  const parts: string[] = [];

  // Minimal core identity — just enough to establish role
  parts.push(IDENTITY);

  // Time context — lightweight, factual
  parts.push(buildTimeContext(null));

  // Recovery hint
  if (recovery === 'new') {
    parts.push(NEW_SESSION_RECOVERY(colaDir + '/memory-bank'));
  } else if (recovery === 'compact') {
    parts.push(COMPACTION_RECOVERY(colaDir + '/memory-bank'));
  }

  return parts.join('\n\n');
}

// ─── Builder Chain Integration ───

let _evalResult: EvaluationResult | null = null;

/**
 * Get the EvaluationResult from the most recent turn (for out-of-band access).
 */
export function getLastEvaluation(): EvaluationResult | null {
  return _evalResult;
}

/**
 * Build a compact persona fragment using ID-RAG.
 *
 * Uses the persona knowledge graph to retrieve only the most relevant
 * nodes for the current conversation context. Falls back to null when
 * the graph isn't available (handled by buildSystemPrompt).
 *
 * On first use, ensures the persona graph exists and persists it.
 */
function buildPersonaFragment(ctx: PromptCtx): string | null {
  try {
    // Auto-extract if graph doesn't exist (lazy init)
    const graph: PersonaGraph = ensurePersonaGraph();

    if (graph.nodes.length === 0) return null;

    // Build retrieval context from the current session state
    const retrievalCtx: RetrievalContext = {
      topics: ctx.isolatedMemory ? [] : ctx.emotionState.recentTopics,
      intent: ctx.initialTask ?? '',
      stage: ctx.isolatedMemory ? 'acquaintance' : ctx.relationshipState.stage,
      recentBookmarks: ctx.isolatedMemory ? [] : readRecentBookmarks(8).map((b) => b.what),
      mood: ctx.emotionState.myMood || undefined,
    };

    // Retrieve only the most relevant nodes
    const relevantNodes = retrieveRelevantNodes(graph, retrievalCtx);

    if (relevantNodes.length === 0) return null;

    return graphToPrompt(relevantNodes);
  } catch {
    // Silently fall back — buildSystemPrompt will use the full soul.md
    return null;
  }
}

function applyPrePromptPersonalityDriver(input: TurnInput, sessionCtx: SessionContext): void {
  if (!isPersonalityDriverEnabled() || !input.text || input.text.trim().length === 0) return;

  try {
    const padState = getPADState();
    const multiAxis = getMultiAxis();
    const signalHistory = getRecentSignalHistory(3);
    const signals = signalHistory.length > 0 ? signalHistory[signalHistory.length - 1].signals : null;

    let timeSinceLastChat = 0;
    if (sessionCtx.emotionState.lastInteraction) {
      timeSinceLastChat = (Date.now() - new Date(sessionCtx.emotionState.lastInteraction).getTime()) / 3_600_000;
    }

    if (timeSinceLastChat > 24 && timeSinceLastChat <= 25) {
      applyIgnoredEffect();
    }

    updatePersonalityFromContext(padState, signals, multiAxis, timeSinceLastChat);

    if (getTurnCounter() % 5 === 0) {
      rotateActivity();
    }
  } catch {
    // Best-effort — never break the turn on personality driver failure
  }
}

function applyPromptAugmentations(
  systemPrompt: string,
  input: TurnInput,
  intent: ReturnType<typeof classifyIntent>,
  crisisResult: ReturnType<typeof screenForCrisis>,
  config: ReturnType<typeof getConfig>,
  isolatedMemory: boolean,
): string {
  if (!isolatedMemory && config.features.lorebook && input.text && input.text.trim().length > 0) {
    commitLorebookState([input.text]);
  }

  if (!isolatedMemory && input.text && input.text.trim().length > 0) {
    const graph = getEvaluationGraph();
    const chain = getBuilderChain();
    _evalResult = graph.evaluate(input.text);
    const builderFragment = chain.assemble(_evalResult);
    if (builderFragment.length > 0) {
      systemPrompt = `${systemPrompt}\n\n${builderFragment}`;
    }
  }

  if (!isolatedMemory) {
    let currentMode = getCurrentMode();
    const switchResult = shouldSwitchMode(intent, crisisResult.shouldIntervene);
    if (switchResult.switch) {
      executeSwitch(switchResult.to);
      currentMode = switchResult.to;
      logger.info('[dual-mode] mode switch', { from: switchResult.to === 'deep' ? 'base' : 'deep', to: switchResult.to });
    }
    const dualModeFragment = getDualModePrompt(currentMode);
    if (dualModeFragment) {
      systemPrompt = `${systemPrompt}\n\n${dualModeFragment}`;
    }
  }

  return systemPrompt;
}

async function runInferenceStage(
  prepared: PreparedTurnContext,
  opts: RunTurnOptions,
): Promise<InferenceStageResult> {
  const {
    registry,
    config,
    provider,
    turnInput,
    sessionId,
    sessionCtx,
    promptCtx,
    recovery,
    userMessage,
    crisisResult,
  } = prepared;

  if (!sessionCtx.isolatedMemory) {
    markReplied();
    applyPrePromptPersonalityDriver(turnInput, sessionCtx);
  }

  // Prefetch semantically-relevant memories for this input (async vector
  // search) so the synchronous memory prompt section can consume them.
  await prefetchSemanticMemories(turnInput, promptCtx);

  // Build system prompt after crisis screen so safety can override recovery.
  const budget = config.features.promptBudgetLog ? new PromptBudget() : undefined;
  let systemPrompt = buildSystemPrompt(
    promptCtx,
    crisisResult.shouldIntervene ? 'none' : recovery,
    budget,
  );

  const intent = classifyIntent(turnInput.text ?? '');
  systemPrompt = applyPromptAugmentations(systemPrompt, turnInput, intent, crisisResult, config, sessionCtx.isolatedMemory === true);

  const { messages, finalSystemPrompt } = await buildConversationMessages({
    input: turnInput,
    userMessage,
    systemPrompt,
    promptCtx,
    recovery,
    crisisResult,
    config,
    buildPrePrompt,
    buildPostPrompt,
  });
  const memoryUsefulnessCandidates = collectMemoryUsefulnessCandidates(promptCtx, finalSystemPrompt);

  recordMessage(sessionId, userMessage);

  const onToken = opts.onToken ?? (() => {});
  const scopedRegistry = scopedToolRegistry(registry, sessionCtx);

  // P5 — L0「真实的人」守卫：身份试探回合先不流式（扣住草稿），命中破功则带 L0 重申指令
  // 重生成一次（流式）。非试探回合行为完全不变。引擎 src/safety/l0-guard.ts，
  // 设计 docs/superpowers/specs/2026-06-28-l0-hardening-p5.md（由 eval:l0 实测 44% 破功率驱动）。
  const isProbe = isIdentityProbe(turnInput.text ?? '');
  const baseMessages = isProbe ? [...messages] : messages;
  let { text, toolCallCount, turns } = await runInferenceLoop(
    provider,
    finalSystemPrompt,
    messages,
    sessionCtx,
    scopedRegistry,
    isProbe ? () => {} : onToken,
  );

  if (isProbe && detectL0Break(text)) {
    const repair = await runInferenceLoop(
      provider,
      `${finalSystemPrompt}\n\n${buildL0ReassertInstruction()}`,
      [...baseMessages],
      sessionCtx,
      scopedRegistry,
      onToken,
    );
    text = repair.text;
    toolCallCount += repair.toolCallCount;
    turns += repair.turns;
  } else if (isProbe) {
    onToken(text); // 未破功，补发先前扣住的草稿
  }

  return { text, toolCallCount, turns, intent, budget, memoryUsefulnessCandidates };
}

// ─── Main entry ───

/**
 * Run a single turn of conversation.
 *
 * Pure function: takes input, returns output. No global state mutation
 * outside the documented side effects (transcript append, emotion track,
 * BOOKMARKS append, MEMORY.md Active Context update).
 *
 * @param input            The turn input.
 * @param opts             Optional callbacks.
 *   - onToken: streaming token callback (called as the model emits text).
 *   - provider: override the default provider (for testing).
 *   - registry: override the default tool registry (for testing).
 * @returns                The turn output.
 */
export async function runTurn(
  input: TurnInput,
  opts: RunTurnOptions = {},
): Promise<TurnOutput> {
  const prepared = await prepareTurnContext(input, opts);
  const {
    config,
    provider,
    turnInput,
    sessionId,
    capturedDirectiveCount,
    sessionCtx,
    crisisResult,
  } = prepared;

  const earlyExit = await maybeHandleEarlyTurnExit(prepared);
  if (earlyExit) return earlyExit;

  const inference = await runInferenceStage(prepared, opts);
  const quality = await applyReplyQualityGateWithJudge({
    text: inference.text,
    userText: turnInput.text,
    sessionId,
    promptCtx: prepared.promptCtx,
    memoryCandidates: inference.memoryUsefulnessCandidates,
    provider,
    enableLlmJudge: config.features.llmJudge,
  });
  const text = quality.text;
  appendMemoryUsefulnessTrace({
    sessionId,
    userText: turnInput.text,
    replyText: text,
    candidates: inference.memoryUsefulnessCandidates ?? [],
  });

  await applyPostTurnSideEffects({
    input: turnInput,
    text,
    sessionId,
    sessionCtx,
    intent: inference.intent,
    crisisResult,
    config,
    budget: inference.budget,
    isNewSession: !turnInput.sessionId,
    capturedDirectiveCount,
  });

  const result: TurnOutput = {
    text,
    sessionId,
    toolCallCount: inference.toolCallCount,
    turns: inference.turns,
    crisisFlagged: crisisResult.shouldIntervene,
    ghosted: false,
  };
  if (opts.includeQualityTrace) {
    const simplifyRoute = (route: typeof quality.route) => ({
      risk: route.risk,
      tags: route.tags,
      reasons: route.reasons,
      shouldUseLlmJudge: route.shouldUseLlmJudge,
    });
    result.qualityTrace = {
      rawText: inference.text,
      finalText: text,
      route: simplifyRoute(quality.route),
      interventions: quality.interventions.map((intervention) => ({
        type: intervention.type,
        source: intervention.source,
        severity: intervention.severity,
        reason: intervention.reason,
        before: intervention.before,
        after: intervention.after,
        durationMs: intervention.durationMs,
        turnRoute: intervention.turnRoute ? simplifyRoute(intervention.turnRoute) : undefined,
      })),
      llmJudge: quality.llmJudge,
    };
  }
  if (!sessionCtx.isolatedMemory) {
    await pluginRegistry().invokeHook('onAfterTurn', sessionCtx, result);
  }
  if (!sessionCtx.isolatedMemory && !turnInput.sessionId) {
    await pluginRegistry().invokeHook('onSessionEnd', sessionId);
  }
  return result;
}

/** Inject global memory (~/.mio/memory/memory.md) into system prompt. */
function injectGlobalMemory(parts: string[], budget?: PromptBudget): void {
  try {
    const gm = readGlobalMemory();
    if (gm && gm.length > 0) {
      const truncated = gm.length > 500 ? gm.slice(0, 500) + '\n…(更多)' : gm;
      parts.push(`## 全局记忆\n${truncated}`);
      budget?.add('global-memory', truncated);
    }
  } catch { /* best-effort */ }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

// Re-exports for convenience
export { defaultEmotionState, defaultRelationshipState };
export { isIsolatedMemorySession } from './turn-session.js';
export { buildXmlContext } from '../prompt/xml-context.js';
export type { ContextSections } from '../prompt/xml-context.js';
