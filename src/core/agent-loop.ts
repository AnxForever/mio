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

import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import {
  CORE_IDENTITY,
  EMOTION_NOTE,
  COMPACTION_RECOVERY,
  NEW_SESSION_RECOVERY,
  FEWSHOT as FEWSHOT_TEMPLATE,
  buildRelationshipContext,
  buildUserContext,
  buildMemoryContext,
  buildStructuredMemoryContext,
  buildTimeContext,
  buildEmotionContext,
  buildPADEmotionContext,
  buildProceduralMemoryContext,
} from '../prompt/templates.js';
import { buildXmlContext } from '../prompt/xml-context.js';
import type { ContextSections } from '../prompt/xml-context.js';
import { ContextEngine, getContextEngine } from '../prompt/context-engine.js';
import { getEvaluationGraph, getBuilderChain, type EvaluationResult } from '../prompt/builder-chain.js';
import { buildKernel, applyPersonaDelta } from '../persona/layered.js';
import { readPersonaDelta, readPreferences } from '../memory/persona-delta.js';
import { selectProvider } from '../providers/index.js';
import { getRouterConfig, routeTask } from '../providers/router.js';
import { ensurePluginsLoaded, ensureToolsRegistered, type ToolRegistryLike } from './tool-runtime.js';
import { runInferenceLoop } from './inference-loop.js';
import { readGlobalMemory } from '../memory/global.js';
import { modManager } from '../mod/mod-manager.js';
import { getConfig } from '../config.js';
import { getDataDir } from '../config.js';
import { colaDir } from '../memory/paths.js';
import {
  recordMessage,
  markSessionDone,
} from '../tools/session.js';
import { trackEmotion, classifyIntent } from '../emotion/tracker.js';
import { readEmotionState, defaultEmotionState } from '../emotion/state.js';
import { readRelationshipState, defaultRelationshipState, checkProgression } from '../relationship/progression.js';
import { updateActiveContext, appendBookmark, ensureBankStructure, readUserProfile, readRecentBookmarks, readStructuredMemoryFile } from '../memory/bank.js';
import { deserializeMemory } from '../memory/structured-memory.js';
import { reindexBookmarks, search as searchMemory } from '../memory/vector.js';
import { rerankByLLM } from '../memory/rerank.js';
import { getRelationContext } from '../memory/entity-graph.js';
import { compressIfNeeded } from '../memory/compression.js';
import { loadTranscriptWindow } from '../memory/transcript.js';
import { getLorebookContext, commitLorebookState } from '../memory/lorebook.js';
import { PromptBudget } from '../utils/prompt-budget.js';
import { getMirrorHint } from '../learning/mirror.js';
import { getFeedbackHint } from '../learning/feedback.js';
import { getDynamicFewShot, collectFromFeedback } from '../learning/dynamic-fewshot.js';
import { logger } from '../utils/logger.js';
import { screenForCrisis } from '../safety/crisis.js';
import { updateActivityPattern } from '../scheduler/smart-proactive.js';
import { shouldGhost, markReplied } from '../emotion/ghost.js';
import { updateAffinity, getAffinityContext } from '../emotion/affinity.js';
import { updateFrustration, getAttachmentContext } from '../emotion/frustration.js';
import { observeRitual, getRitualContext, getCardboardContext, updateCardboard } from '../emotion/ritual.js';
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
  getPersonalityState,
  updatePersonalityFromContext,
  getPersonalityContext,
  getResponseStyle,
  simulateLifeEvent,
  rotateActivity,
  applyIgnoredEffect,
  applyWelcomeBackEffect,
  applyWarmUpEffect,
  isPersonalityDriverEnabled,
  type PersonalityState,
} from '../persona/driver.js';
import { getPADState, updatePAD } from '../emotion/pad.js';
import { getMultiAxis } from '../emotion/multi-axis.js';
import { getRecentSignalHistory } from '../emotion/signals.js';
import { lifeEngine } from '../character/life-engine.js';
import { readActiveCharacter } from '../character/factory.js';
import { acknowledgeRecentEvents, getMemoryContext } from '../character/memory-stream.js';
import type {
  AIProvider,
  SessionContext,
  Message,
  PromptCtx,
  Gender,
  EmotionState,
  RelationshipState,
  ContentBlock,
} from '../types.js';

// ─── Public types ───

/**
 * Input to a single agent-loop turn.
 *
 * - `text`         : plain text user input (most common).
 * - `imageBlocks`  : optional pre-processed image content blocks (vision/image.ts).
 * - `audioPath`    : optional path to an audio file; if provided, transcribed via STT.
 * - `sessionId`    : continue an existing session, or omit to start a new one.
 */
export interface TurnInput {
  text?: string;
  imageBlocks?: ContentBlock[];
  audioPath?: string;
  sessionId?: string;
}

/**
 * Output from a single agent-loop turn.
 */
export interface TurnOutput {
  /** Final assistant text. */
  text: string;
  /** Session id (newly generated if input.sessionId was undefined). */
  sessionId: string;
  /** Tool calls made during the turn (for observability / logging). */
  toolCallCount: number;
  /** Number of inference iterations (1 = no tool calls, >1 = tool use). */
  turns: number;
  /** Whether a crisis signal was detected and surfaced. */
  crisisFlagged: boolean;
  /** Whether Mio chose to ghost this turn (no reply generated). */
  ghosted?: boolean;
}

/** Turn counter for periodic operations (bank rotation, etc.) */
let _turnCounter = 0;
/** Last seen mtime of BOOKMARKS.md for dirty-flag optimization. */
let _lastBookmarkMtime = 0;

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

  // Assemble the prompt using priority-based ordering and budget
  const prompt = engine.assemble(6000);

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

  // L1: Core identity — critical, always included
  engine.register('core', {
    type: 'identity',
    content: CORE_IDENTITY,
    priority: 'critical',
  });

  // L0: Kernel — 不可变内核，永远注入、不可裁剪（critical）
  engine.register('kernel', {
    type: 'kernel',
    content: buildKernel(),
    priority: 'critical',
  });

  // L2: Persona (ID-RAG) — high priority, the main personality
  // Uses lazy eval so the persona fragment is computed only when included
  engine.register('soul', {
    type: 'persona',
    content: () => {
      const fragment = buildPersonaFragment(ctx);
      const base = fragment ?? ctx.soulContent ?? '';
      return applyPersonaDelta(base, ctx.personaDelta);  // L1 ⊕ L2，在 ID-RAG 输出之后
    },
    priority: 'high',
    condition: () => {
      if (!sectionEnabled('soul')) return false;
      // Only include if we have content
      const fragment = buildPersonaFragment(ctx);
      return fragment !== null || (ctx.soulContent != null && ctx.soulContent.trim().length > 0);
    },
  });

  // L3: Relationship context — high priority
  engine.register('relationship', {
    type: 'relationship',
    content: () => buildRelationshipContext(ctx.relationshipState),
    priority: 'high',
    condition: () => sectionEnabled('relationship'),
  });

  // L4: User context — high priority
  engine.register('user', {
    type: 'user',
    content: () => buildUserContext(readUserProfile(), ctx.emotionState.recentTopics),
    priority: 'high',
    condition: () => sectionEnabled('user'),
  });

  // L5: Memory context — medium priority, may be trimmed.
  // Semantically-relevant memories (prefetched onto ctx for this input) plus a
  // short recency anchor. See buildMemorySection / prefetchSemanticMemories.
  engine.register('memory', {
    type: 'memory',
    content: () => buildMemorySection(ctx),
    priority: 'medium',
    condition: () => sectionEnabled('memory') && buildMemorySection(ctx).length > 0,
  });

  // L5b: Structured memory — medium priority, best-effort
  engine.register('structured-memory', {
    type: 'structured-memory',
    content: () => {
      try {
        const structuredRaw = readStructuredMemoryFile();
        if (structuredRaw && structuredRaw.trim().length > 0) {
          const structured = deserializeMemory(structuredRaw);
          return buildStructuredMemoryContext(structured) ?? '';
        }
      } catch {
        // Best-effort
      }
      return '';
    },
    priority: 'medium',
    condition: () => {
      if (!sectionEnabled('structured-memory')) return false;
      try {
        const raw = readStructuredMemoryFile();
        return raw !== null && raw.trim().length > 0;
      } catch {
        return false;
      }
    },
  });

  // L6: Lorebook — keyword-triggered memory context (medium priority)
  // Only included when the lorebook feature is enabled and entries match
  engine.register('lorebook', {
    type: 'lorebook',
    content: () => {
      if (!getConfig().features.lorebook) return '';
      const recentTexts: string[] = [];
      if (ctx.initialTask) recentTexts.push(ctx.initialTask);
      return getLorebookContext(recentTexts) ?? '';
    },
    priority: 'medium',
    condition: () => sectionEnabled('lorebook'),
  });

  // L6b: Entity relations (temporal knowledge graph) — current-state facts
  engine.register('relations', {
    type: 'relations',
    content: () => getRelationContext(),
    priority: 'medium',
    condition: () => sectionEnabled('relations') && getRelationContext().trim().length > 0,
  });

  // L7: Time context — high priority
  engine.register('time', {
    type: 'time',
    content: () => buildTimeContext(ctx.emotionState.lastInteraction || null),
    priority: 'high',
    condition: () => sectionEnabled('time'),
  });

  // L7: Emotional context — high priority
  engine.register('emotion', {
    type: 'emotion',
    content: () => buildEmotionContext(ctx.emotionState),
    priority: 'high',
    condition: () => sectionEnabled('emotion'),
  });

  // L7b: PAD emotional context — medium priority
  engine.register('pad-emotion', {
    type: 'pad-emotion',
    content: () => buildPADEmotionContext() ?? '',
    priority: 'medium',
    condition: () => sectionEnabled('pad-emotion') && buildPADEmotionContext() !== null,
  });

  // L7c: Personality driver context — medium priority
  // Injects natural behavior hints derived from Mio's internal state
  engine.register('personality', {
    type: 'personality',
    content: () => {
      if (!isPersonalityDriverEnabled()) return '';
      const ctx = getPersonalityContext();
      return ctx || '';
    },
    priority: 'medium',
    condition: () => {
      if (!sectionEnabled('personality')) return false;
      if (!isPersonalityDriverEnabled()) return false;
      return getPersonalityContext() !== null;
    },
  });

  // L8: Affinity context — medium priority
  engine.register('affinity', {
    type: 'affinity',
    content: () => {
      const affinityCtx = getAffinityContext();
      return affinityCtx ? `## 亲密\n${affinityCtx}` : '';
    },
    priority: 'medium',
    condition: () => sectionEnabled('affinity') && getAffinityContext() !== null,
  });

  // L9: Attachment context — medium priority
  engine.register('attachment', {
    type: 'attachment',
    content: () => {
      const attachCtx = getAttachmentContext();
      return attachCtx ? `## 依赖\n${attachCtx}` : '';
    },
    priority: 'medium',
    condition: () => sectionEnabled('attachment') && getAttachmentContext() !== null,
  });

  // L10: Ritual context — low priority (trimmed first)
  engine.register('ritual', {
    type: 'ritual',
    content: () => {
      const ritualCtx = getRitualContext();
      return ritualCtx ? `## 习惯\n${ritualCtx}` : '';
    },
    priority: 'low',
    condition: () => sectionEnabled('ritual') && getRitualContext() !== null,
  });

  // L10b: Cardboard context — low priority
  engine.register('cardboard', {
    type: 'cardboard',
    content: () => {
      const cardboardCtx = getCardboardContext();
      return cardboardCtx ? `## 对话状态\n${cardboardCtx}` : '';
    },
    priority: 'low',
    condition: () => sectionEnabled('cardboard') && getCardboardContext() !== null,
  });

  // L10c: Mirroring hint — low priority
  engine.register('mirror', {
    type: 'mirror',
    content: () => getMirrorHint() ?? '',
    priority: 'low',
    condition: () => sectionEnabled('mirror') && getMirrorHint() !== null,
  });

  // L10d: Feedback hint — low priority
  engine.register('feedback', {
    type: 'feedback',
    content: () => getFeedbackHint() ?? '',
    priority: 'low',
    condition: () => sectionEnabled('feedback') && getFeedbackHint() !== null,
  });

  // L10e: Procedural memory — medium priority (learned interaction patterns)
  engine.register('procedural-memory', {
    type: 'procedural-memory',
    content: () => buildProceduralMemoryContext() ?? '',
    priority: 'medium',
    condition: () => sectionEnabled('procedural-memory') && buildProceduralMemoryContext() !== null,
  });

  // L11: Emotion tracking note — medium priority (important for feature function)
  // Life events — character's own life (autonomous + user interactions)
  engine.register('life-events', {
    type: 'life-events',
    content: () => {
      if (!getConfig().features.lifeEngine) return '';
      const name = readActiveCharacter();
      if (!name) return '';
      return getMemoryContext(name, '', 3);
    },
    priority: 'medium',
    condition: () => sectionEnabled('life-events') && getConfig().features.lifeEngine && readActiveCharacter() !== null,
  });

  engine.register('emotion-note', {
    type: 'emotion-note',
    content: EMOTION_NOTE,
    priority: 'medium',
    condition: () => sectionEnabled('emotion-note'),
  });

  // Few-shot examples — low priority
  engine.register('fewshot', {
    type: 'fewshot',
    content: FEWSHOT_TEMPLATE,
    priority: 'low',
    condition: () => sectionEnabled('fewshot'),
  });

  // Dynamic few-shot — low priority, complements static fewshot
  engine.register('dynamic-fewshot', {
    type: 'dynamic-fewshot',
    content: () => {
      if (!getConfig().features.dynamicFewShot) return '';
      return getDynamicFewShot() ?? '';
    },
    priority: 'low',
    condition: () => {
      if (!sectionEnabled('dynamic-fewshot')) return false;
      if (!getConfig().features.dynamicFewShot) return false;
      return getDynamicFewShot() !== null;
    },
  });

  // Recovery hint — varies by recovery type
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
    priority: 'high',
    condition: () => sectionEnabled('recovery') && recovery !== 'none',
  });
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

  if (config.features.xmlContext) {
    const sections: ContextSections = {
      identity: CORE_IDENTITY,
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
    return buildXmlContext(sections);
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
      const structuredCtx = buildStructuredMemoryContext(structured);
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

  // Instructions
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
  parts.push(CORE_IDENTITY);

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
      topics: ctx.emotionState.recentTopics,
      intent: ctx.initialTask ?? '',
      stage: ctx.relationshipState.stage,
      recentBookmarks: readRecentBookmarks(8).map((b) => b.what),
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

// ─── Session resolution ───

/**
 * Resolve or create the SessionContext for a turn.
 *
 * Always reads the latest emotion/relationship state from disk, picks up the
 * active mod from the mod manager, and constructs a fresh SessionContext.
 */
function resolveSessionContext(input: TurnInput, sessionId: string): {
  ctx: SessionContext;
  promptCtx: PromptCtx;
  recovery: 'new' | 'compact' | 'none';
} {
  const config = getConfig();
  const emotionState: EmotionState = readEmotionState();
  const relationshipState: RelationshipState = readRelationshipState();
  const mod = modManager();
  const soulContent = mod.getCurrentSoulContent();
  const activeMod = mod.activeMod;
  const gender: Gender = config.gender;
  const dir = getDataDir() || colaDir();

  // New sessions get the new-session recovery prompt; the agent will read MEMORY.md
  // before responding. The 'compact' case is reserved for future use when a turn
  // is being resumed from a compacted summary (not implemented yet).
  const recovery: 'new' | 'compact' | 'none' = input.sessionId ? 'none' : 'new';

  const ctx: SessionContext = {
    sessionId,
    model: config.model,
    apiKey: config.apiKey,
    gender,
    emotionState,
    relationshipState,
    activeMod,
    colaDir: dir,
    outputDir: dir + '/output',
    connectedChannels: [],
  };

  const promptCtx: PromptCtx = {
    sessionId,
    model: config.model,
    apiKey: config.apiKey,
    gender,
    emotionState,
    relationshipState,
    activeMod,
    soulContent,
    colaDir: dir,
    outputDir: dir + '/output',
    connectedChannels: [],
    allowColaLinkSend: false,
    initialTask: input.text,
    personaDelta: readPersonaDelta() ?? undefined,
    preferences: readPreferences() ?? undefined,
  };

  return { ctx, promptCtx, recovery };
}

interface PostTurnSideEffectsInput {
  input: TurnInput;
  text: string;
  sessionId: string;
  sessionCtx: SessionContext;
  intent: ReturnType<typeof classifyIntent>;
  crisisResult: ReturnType<typeof screenForCrisis>;
  config: ReturnType<typeof getConfig>;
  budget?: PromptBudget;
  isNewSession: boolean;
}

async function applyPostTurnSideEffects({
  input,
  text,
  sessionId,
  sessionCtx,
  intent,
  crisisResult,
  config,
  budget,
  isNewSession,
}: PostTurnSideEffectsInput): Promise<void> {
  const assistantMsg: Message = {
    role: 'assistant',
    content: text,
    timestamp: new Date().toISOString(),
  };
  recordMessage(sessionId, assistantMsg);
  trackEmotion(input.text ?? '', text, sessionId);

  scheduleLearningSideEffects(input, text, config);
  updateRelationalSideEffects(input, text, intent, crisisResult, config);
  await updatePersonalitySideEffects(input, text, sessionCtx);
  persistTurnMemorySideEffects(input, text, sessionId, crisisResult, isNewSession);

  if (budget) budget.log();
}

function scheduleLearningSideEffects(
  input: TurnInput,
  text: string,
  config: ReturnType<typeof getConfig>,
): void {
  if (input.text) {
    import('../learning/mirror.js').then(({ analyzeUserMessage }) => {
      analyzeUserMessage(input.text!);
    }).catch((err: unknown) => { logger.error('mirror learning failed', { error: String(err) }); });

    import('../learning/feedback.js').then(({ detectFeedback }) => {
      detectFeedback(input.text!, text);
    }).catch((err: unknown) => { logger.error('feedback learning failed', { error: String(err) }); });

    if (config.features.dynamicFewShot) {
      collectFromFeedback().catch((err: unknown) => { logger.error('fewshot learning failed', { error: String(err) }); });
    }

    _turnCounter++;
    if (_turnCounter % 20 === 0) {
      import('../learning/dynamic-fewshot.js').then(({ rotateBank }) => {
        rotateBank();
      }).catch((err: unknown) => { logger.error('fewshot rotation failed', { error: String(err) }); });
    }
  }
}

function updateRelationalSideEffects(
  input: TurnInput,
  text: string,
  intent: ReturnType<typeof classifyIntent>,
  crisisResult: ReturnType<typeof screenForCrisis>,
  config: ReturnType<typeof getConfig>,
): void {
  if (input.text) {
    observeRitual(input.text, new Date().getHours());
  }

  updateCardboard(input.text ?? '', text);

  if (config.features.multiAxisAffinity) {
    updateAffinity(intent.primary, false);
  }

  if (config.features.frustrationTracking) {
    updateFrustration(intent.primary, false);
  }

  recordDualModeTurn(intent, crisisResult.shouldIntervene);

  // Lightweight per-turn stage-progression check. checkProgression was
  // previously only called in nightly (never armed under serve), so the
  // relationship stayed frozen at "acquaintance". Running it per turn — after
  // trackEmotion has bumped interactionCount + emotionalDepth — unfreezes the
  // progression arc (familiar → ambiguous → intimate) and the gated behaviors.
  checkProgression();
}

async function updatePersonalitySideEffects(
  input: TurnInput,
  text: string,
  sessionCtx: SessionContext,
): Promise<void> {
  if (isPersonalityDriverEnabled()) {
    try {
      const personalityState = getPersonalityState();
      const timeSinceLastChat = sessionCtx.emotionState.lastInteraction
        ? (Date.now() - new Date(sessionCtx.emotionState.lastInteraction).getTime()) / 3_600_000
        : 0;

      if (timeSinceLastChat > 24 && text && text.trim().length > 0) {
        applyWarmUpEffect();
      }

      if (_turnCounter % 8 === 0 && _turnCounter > 0) {
        const charName = readActiveCharacter();
        if (getConfig().features.lifeEngine && charName) {
          const event = await lifeEngine().tickLight(charName);
          if (event) {
            appendBookmark({
              time: new Date().toISOString(),
              what: `[life-event] ${truncate(event.description, 100)}`,
              evidence: `category=${event.category} importance=${event.importance}`,
            });
          }
        } else {
          const lifeEvent = simulateLifeEvent();
          if (lifeEvent && personalityState.initiative > 50 && timeSinceLastChat > 2) {
            appendBookmark({
              time: new Date().toISOString(),
              what: `[life-event] 你: ${truncate(lifeEvent, 100)}`,
              evidence: `personality: sociability=${personalityState.sociability}, initiative=${personalityState.initiative}`,
            });
          }
        }
      }

      if (getConfig().features.lifeEngine && text && /抱抱|不哭|没事|我在|陪|心疼|还好吗|辛苦了|会好起来的|别难过/.test(text)) {
        try {
          updatePAD({ pleasure: 0.15, arousal: -0.05, dominance: 0.1 });
          const charName = readActiveCharacter();
          if (charName) acknowledgeRecentEvents(charName);
        } catch { /* best-effort */ }
      }
    } catch {
      // Best-effort
    }
  }
}

function persistTurnMemorySideEffects(
  input: TurnInput,
  text: string,
  sessionId: string,
  crisisResult: ReturnType<typeof screenForCrisis>,
  isNewSession: boolean,
): void {
  if (crisisResult.shouldIntervene || (input.text && input.text.trim().length > 5)) {
    appendBookmark({
      time: new Date().toISOString(),
      what: crisisResult.shouldIntervene
        ? `[crisis:${crisisResult.level}] user expressed distress`
        : `exchange: user said "${truncate(input.text ?? '', 80)}"`,
      evidence: crisisResult.shouldIntervene
        ? `matched: ${crisisResult.matchedKeywords.join(', ')}`
        : `agent replied: "${truncate(text, 80)}"`,
    });
  }

  const hint = truncate(
    `${new Date().toISOString().slice(11, 16)} ${crisisResult.shouldIntervene ? '[crisis] ' : ''}${truncate(input.text ?? '', 60)} → ${truncate(text, 60)}`,
    280,
  );
  try {
    updateActiveContext(hint);
  } catch {
    // Active Context update is best-effort; don't break the turn on failure.
  }

  if (isNewSession) {
    markSessionDone(sessionId);
  }
}

interface ConversationBuildInput {
  input: TurnInput;
  userMessage: Message;
  systemPrompt: string;
  promptCtx: PromptCtx;
  recovery: 'new' | 'compact' | 'none';
  crisisResult: ReturnType<typeof screenForCrisis>;
  config: ReturnType<typeof getConfig>;
}

function buildFinalSystemPrompt(
  systemPrompt: string,
  crisisResult: ReturnType<typeof screenForCrisis>,
): string {
  if (!crisisResult.shouldIntervene) return systemPrompt;
  return `${systemPrompt}\n\n## Safety override\n${crisisResult.systemInjection}`;
}

async function buildConversationMessages({
  input,
  userMessage,
  systemPrompt,
  promptCtx,
  recovery,
  crisisResult,
  config,
}: ConversationBuildInput): Promise<{ messages: Message[]; finalSystemPrompt: string }> {
  const messages: Message[] = [];

  if (input.sessionId) {
    if (config.features.adaptiveHistory) {
      const { compressHistory, renderCompressedHistory } = await import('../memory/adaptive-history.js');
      const history = loadTranscriptWindow(input.sessionId, 500);
      const allMsgs = [...history, userMessage];
      const compressed = compressHistory(allMsgs);
      const compressedText = renderCompressedHistory(compressed);

      if (compressed.placeholder.count > 0 || compressed.compressedMessages.length > 0) {
        systemPrompt = `${systemPrompt}\n\n## 对话历史\n${compressedText}`;

        if (compressed.originalCount > 5) {
          appendBookmark({
            time: new Date().toISOString(),
            what: `[adaptive-compression] ${compressed.originalCount} messages → ${compressed.fullMessages.length} full + ${compressed.compressedMessages.length} compressed`,
            evidence: `saved ~${compressed.estimatedTokensSaved} tokens`,
          });
        }
      }

      messages.push(...compressed.fullMessages);
    } else {
      const history = loadTranscriptWindow(input.sessionId, 30);
      const allMsgs = [...history, userMessage];
      const compression = compressIfNeeded(allMsgs);

      if (compression.removedCount > 0) {
        systemPrompt = `${systemPrompt}\n\n${compression.summary}`;

        appendBookmark({
          time: new Date().toISOString(),
          what: `[compaction] ${compression.removedCount} messages compressed`,
          evidence: compression.summary.slice(0, 200),
        });
      }

      messages.push(...compression.messages);
    }
  } else {
    messages.push(userMessage);
  }

  let finalSystemPrompt = buildFinalSystemPrompt(systemPrompt, crisisResult);

  if (config.features.postHistoryInjection) {
    const prePrompt = buildPrePrompt(
      crisisResult.shouldIntervene ? 'none' : recovery,
      promptCtx.colaDir,
    );
    finalSystemPrompt = buildFinalSystemPrompt(prePrompt, crisisResult);

    const postPrompt = buildPostPrompt(
      promptCtx,
      readRecentBookmarks(8),
      readUserProfile(),
    );

    messages.push({
      role: 'user',
      content: `[System Context — this is not a user message. The following is Mio's internal context, instructions, and self-knowledge. Read this before responding to the user.]\n\n${postPrompt}`,
      timestamp: new Date().toISOString(),
    });
  }

  return { messages, finalSystemPrompt };
}

function trackTurnActivity(input: TurnInput, sessionId: string): void {
  if (!input.text || input.text.trim().length === 0) return;
  try {
    updateActivityPattern(sessionId);
  } catch {
    // best-effort — never break the turn on activity tracking failure
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

    if (_turnCounter % 5 === 0) {
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
): string {
  if (config.features.lorebook && input.text && input.text.trim().length > 0) {
    commitLorebookState([input.text]);
  }

  if (input.text && input.text.trim().length > 0) {
    const graph = getEvaluationGraph();
    const chain = getBuilderChain();
    _evalResult = graph.evaluate(input.text);
    const builderFragment = chain.assemble(_evalResult);
    if (builderFragment.length > 0) {
      systemPrompt = `${systemPrompt}\n\n${builderFragment}`;
    }
  }

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

  return systemPrompt;
}

function maybeReindexBookmarks(): void {
  try {
    const bookmarksPath = colaDir() + '/memory-bank/BOOKMARKS.md';
    const mtime = statSync(bookmarksPath).mtimeMs;
    if (mtime === _lastBookmarkMtime) return;

    _lastBookmarkMtime = mtime;
    reindexBookmarks().catch((err) => {
      logger.error('reindexBookmarks failed', { error: String(err) });
    });
  } catch {
    // Best-effort — missing bookmarks or index failures should not break chat.
  }
}

function handleGhostTurn({
  input,
  sessionId,
  userMessage,
  config,
}: {
  input: TurnInput;
  sessionId: string;
  userMessage: Message;
  config: ReturnType<typeof getConfig>;
}): TurnOutput {
  recordMessage(sessionId, userMessage);

  if (config.features.multiAxisAffinity) {
    const intent = classifyIntent(input.text ?? '');
    updateAffinity(intent.primary, true);
  }
  if (config.features.frustrationTracking) {
    const intent = classifyIntent(input.text ?? '');
    updateFrustration(intent.primary, true);
  }

  const ghostMsg: Message = {
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  };
  recordMessage(sessionId, ghostMsg);

  if (!input.sessionId) markSessionDone(sessionId);

  return {
    text: '',
    sessionId,
    toolCallCount: 0,
    turns: 0,
    crisisFlagged: false,
    ghosted: true,
  };
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
  opts: {
    onToken?: (chunk: string) => void;
    provider?: AIProvider;
    registry?: ToolRegistryLike;
  } = {},
): Promise<TurnOutput> {
  ensureBankStructure();
  ensurePluginsLoaded();
  const registry = opts.registry ?? ensureToolsRegistered();

  // Reindex vector store only when BOOKMARKS.md has changed (mtime check).
  // Uses dirty-flag optimization to avoid per-turn network calls with MiniMax.
  maybeReindexBookmarks();
  const config = getConfig();
  const provider = opts.provider ?? selectProvider(config.provider, config.model);

  // 1. Resolve session + context
  const sessionId = input.sessionId ?? randomUUID().slice(0, 12);
  const { ctx: sessionCtx, promptCtx, recovery } = resolveSessionContext(input, sessionId);

  // 2. Build the user message (text + optional image content blocks)
  const userContent: string | ContentBlock[] = buildUserContent(input);
  const userMessage: Message = {
    role: 'user',
    content: userContent,
    timestamp: new Date().toISOString(),
  };

  trackTurnActivity(input, sessionId);

  // 3. Crisis pre-screen (Phase 4). Runs in parallel with provider selection.
  //    If triggered, we still let the model respond — but the loop will inject
  //    a safety preamble and the side-effect step will append a BOOKMARKS line.
  const crisisResult = screenForCrisis(input.text ?? '');

  // 3a. Ghost check — should Mio stay silent this turn?
  // Feature-gated via MIO_FEATURE_GHOST / config.features.ghost
  let ghosted = false;
  if (config.features.ghost && !crisisResult.shouldIntervene) {
    ghosted = shouldGhost(input.text ?? '', sessionCtx);
  }

  // If ghosting, skip inference entirely and return empty text
  if (ghosted) {
    return handleGhostTurn({ input, sessionId, userMessage, config });
  }

  markReplied();

  applyPrePromptPersonalityDriver(input, sessionCtx);

  // Prefetch semantically-relevant memories for this input (async vector
  // search) so the synchronous memory prompt section can consume them.
  await prefetchSemanticMemories(input, promptCtx);

  // 4. Build system prompt (after crisis screen so we can inject safety block)
  const budget = config.features.promptBudgetLog ? new PromptBudget() : undefined;
  let systemPrompt = buildSystemPrompt(
    promptCtx,
    crisisResult.shouldIntervene ? 'none' : recovery,
    budget,
  );

  const intent = classifyIntent(input.text ?? '');
  systemPrompt = applyPromptAugmentations(systemPrompt, input, intent, crisisResult, config);

  const { messages, finalSystemPrompt } = await buildConversationMessages({
    input,
    userMessage,
    systemPrompt,
    promptCtx,
    recovery,
    crisisResult,
    config,
  });

  recordMessage(sessionId, userMessage);

  // 6. Run inference loop
  const onToken = opts.onToken ?? (() => {});
  const { text, toolCallCount, turns } = await runInferenceLoop(
    provider,
    finalSystemPrompt,
    messages,
    sessionCtx,
    registry,
    onToken,
  );

  await applyPostTurnSideEffects({
    input,
    text,
    sessionId,
    sessionCtx,
    intent,
    crisisResult,
    config,
    budget,
    isNewSession: !input.sessionId,
  });

  return {
    text,
    sessionId,
    toolCallCount,
    turns,
    crisisFlagged: crisisResult.shouldIntervene,
    ghosted: false,
  };
}

// ─── Helpers ───

function buildUserContent(input: TurnInput): string | ContentBlock[] {
  if (input.imageBlocks && input.imageBlocks.length > 0) {
    if (input.text && input.text.trim().length > 0) {
      return [{ type: 'text', text: input.text }, ...input.imageBlocks];
    }
    return input.imageBlocks;
  }
  return input.text ?? '';
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
export { buildXmlContext } from '../prompt/xml-context.js';
export type { ContextSections } from '../prompt/xml-context.js';
