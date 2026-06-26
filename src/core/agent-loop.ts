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
 * The orchestrator owns:
 *  - Tool registry lifecycle (registers all built-in tools on first use)
 *  - Memory-bank side effects (MEMORY.md Active Context, BOOKMARKS.md append)
 *  - Crisis-detection pre-screening (Phase 4)
 *
 * It does NOT own:
 *  - Channel I/O (HTTP/WS/CLI live in src/server/ and src/index.ts)
 *  - The subagent spawner (recursion-safe: subagents are isolated)
 *  - Schedulers (nightly + proactive run on their own cron)
 */

import { randomUUID } from 'node:crypto';
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
import { selectProvider } from '../providers/index.js';
import { getRouterConfig, routeTask } from '../providers/router.js';
import { pluginRegistry, BUILTIN_PLUGINS } from '../plugins/index.js';
import { readGlobalMemory } from '../memory/global.js';
import { toolRegistry } from '../tools/registry.js';
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
import { readRelationshipState, defaultRelationshipState } from '../relationship/progression.js';
import { updateActiveContext, appendBookmark, ensureBankStructure, readUserProfile, readRecentBookmarks, readStructuredMemoryFile } from '../memory/bank.js';
import { deserializeMemory } from '../memory/structured-memory.js';
import { reindexBookmarks } from '../memory/vector.js';
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
import { registerEmotionTools } from '../tools/emotion.js';
import { registerCronTools } from '../tools/cron.js';
import { registerFileTools } from '../tools/file.js';
import { registerSessionTools } from '../tools/session.js';
import { registerWorkTools } from '../tools/work.js';
import { registerRecallTools } from '../tools/recall.js';
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
import { acknowledgeRecentEvents } from '../character/memory-stream.js';
import type {
  AIProvider,
  StreamingProvider,
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

// ─── Constants ───

/** Max inference → tool-execution iterations per turn. */
const MAX_LOOP_TURNS = 8;

/** Turn counter for periodic operations (bank rotation, etc.) */
let _turnCounter = 0;
/** Last seen mtime of BOOKMARKS.md for dirty-flag optimization. */
let _lastBookmarkMtime = 0;

/**
 * Minimal interface for the parts of ToolRegistry that agent-loop needs.
 * Local to this file so we don't break callers when the registry grows.
 */
interface ToolRegistryLike {
  listDefs(names?: string[]): { name: string; description: string; inputSchema: Record<string, unknown> }[];
  execute(
    call: { id: string; name: string; input: Record<string, unknown> },
    ctx: SessionContext,
  ): Promise<{ id: string; name: string; output: string; isError?: boolean }>;
}

// ─── Tool registration ───

let toolsRegistered = false;
let pluginsLoaded = false;

/** Load builtin plugins once per process. */
function ensurePluginsLoaded(): void {
  if (pluginsLoaded) return;
  for (const plugin of BUILTIN_PLUGINS) {
    try { pluginRegistry().register(plugin); } catch { /* duplicate */ }
  }
  pluginsLoaded = true;
}

/**
 * Register all built-in tools exactly once per process.
 *
 * Idempotent. Called from inside the loop on first turn.
 */
function ensureToolsRegistered(): ToolRegistryLike {
  const reg = toolRegistry();
  if (toolsRegistered) return reg;
  registerFileTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerSessionTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerCronTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerWorkTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerEmotionTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  registerRecallTools(reg as unknown as { register: (def: unknown, handler: unknown) => void });
  toolsRegistered = true;
  return reg;
}

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

  // Register all sections (idempotent: re-registration updates existing)
  // Priority assignments based on section importance:

  // L1: Core identity — critical, always included
  engine.register('core', {
    type: 'identity',
    content: CORE_IDENTITY,
    priority: 'critical',
  });

  // L2: Persona (ID-RAG) — high priority, the main personality
  // Uses lazy eval so the persona fragment is computed only when included
  engine.register('soul', {
    type: 'persona',
    content: () => {
      const fragment = buildPersonaFragment(ctx);
      return fragment ?? ctx.soulContent ?? '';
    },
    priority: 'high',
    condition: () => {
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
  });

  // L4: User context — high priority
  engine.register('user', {
    type: 'user',
    content: () => buildUserContext(readUserProfile(), ctx.emotionState.recentTopics),
    priority: 'high',
  });

  // L5: Memory context (bookmarks) — medium priority, may be trimmed
  engine.register('memory', {
    type: 'memory',
    content: () => buildMemoryContext(readRecentBookmarks(8)) ?? '',
    priority: 'medium',
    condition: () => {
      const memCtx = buildMemoryContext(readRecentBookmarks(8));
      return memCtx !== null;
    },
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
  });

  // L7: Time context — high priority
  engine.register('time', {
    type: 'time',
    content: () => buildTimeContext(ctx.emotionState.lastInteraction || null),
    priority: 'high',
  });

  // L7: Emotional context — high priority
  engine.register('emotion', {
    type: 'emotion',
    content: () => buildEmotionContext(ctx.emotionState),
    priority: 'high',
  });

  // L7b: PAD emotional context — medium priority
  engine.register('pad-emotion', {
    type: 'pad-emotion',
    content: () => buildPADEmotionContext() ?? '',
    priority: 'medium',
    condition: () => buildPADEmotionContext() !== null,
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
    condition: () => getAffinityContext() !== null,
  });

  // L9: Attachment context — medium priority
  engine.register('attachment', {
    type: 'attachment',
    content: () => {
      const attachCtx = getAttachmentContext();
      return attachCtx ? `## 依赖\n${attachCtx}` : '';
    },
    priority: 'medium',
    condition: () => getAttachmentContext() !== null,
  });

  // L10: Ritual context — low priority (trimmed first)
  engine.register('ritual', {
    type: 'ritual',
    content: () => {
      const ritualCtx = getRitualContext();
      return ritualCtx ? `## 习惯\n${ritualCtx}` : '';
    },
    priority: 'low',
    condition: () => getRitualContext() !== null,
  });

  // L10b: Cardboard context — low priority
  engine.register('cardboard', {
    type: 'cardboard',
    content: () => {
      const cardboardCtx = getCardboardContext();
      return cardboardCtx ? `## 对话状态\n${cardboardCtx}` : '';
    },
    priority: 'low',
    condition: () => getCardboardContext() !== null,
  });

  // L10c: Mirroring hint — low priority
  engine.register('mirror', {
    type: 'mirror',
    content: () => getMirrorHint() ?? '',
    priority: 'low',
    condition: () => getMirrorHint() !== null,
  });

  // L10d: Feedback hint — low priority
  engine.register('feedback', {
    type: 'feedback',
    content: () => getFeedbackHint() ?? '',
    priority: 'low',
    condition: () => getFeedbackHint() !== null,
  });

  // L10e: Procedural memory — medium priority (learned interaction patterns)
  engine.register('procedural-memory', {
    type: 'procedural-memory',
    content: () => buildProceduralMemoryContext() ?? '',
    priority: 'medium',
    condition: () => buildProceduralMemoryContext() !== null,
  });

  // L11: Emotion tracking note — medium priority (important for feature function)
  engine.register('emotion-note', {
    type: 'emotion-note',
    content: EMOTION_NOTE,
    priority: 'medium',
  });

  // Few-shot examples — low priority
  engine.register('fewshot', {
    type: 'fewshot',
    content: FEWSHOT_TEMPLATE,
    priority: 'low',
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
    condition: () => recovery !== 'none',
  });

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

/**
 * Legacy fallback: build system prompt using the old flat concatenation.
 *
 * Used when caller opts out of the ContextEngine path (backward compat).
 * Produces identical output to the original buildSystemPrompt.
 */
function buildSystemPromptLegacy(
  ctx: PromptCtx,
  recovery: 'new' | 'compact' | 'none',
  budget?: PromptBudget,
): string {
  const parts: string[] = [];

  // L1: Core identity — minimal framing
  parts.push(CORE_IDENTITY);
  budget?.add('core', CORE_IDENTITY);

  // L2: Persona (ID-RAG) — retrieve relevant personality fragments
  const personaFragment = buildPersonaFragment(ctx);
  if (personaFragment) {
    parts.push(personaFragment);
    budget?.add('soul', personaFragment);
  } else if (ctx.soulContent && ctx.soulContent.trim().length > 0) {
    parts.push(ctx.soulContent);
    budget?.add('soul', ctx.soulContent);
  }

  // L3: Dynamic relationship context
  const relCtx = buildRelationshipContext(ctx.relationshipState);
  parts.push(relCtx);
  budget?.add('relationship', relCtx);

  // L4: Dynamic user context
  const userCtx = buildUserContext(readUserProfile(), ctx.emotionState.recentTopics);
  parts.push(userCtx);
  budget?.add('user', userCtx);

  // L5: Dynamic memory context
  const memCtx = buildMemoryContext(readRecentBookmarks(8));
  if (memCtx) {
    parts.push(memCtx);
    budget?.add('memory', memCtx);
  }

  // L5b: Structured memory context
  try {
    const structuredRaw = readStructuredMemoryFile();
    if (structuredRaw && structuredRaw.trim().length > 0) {
      const structured = deserializeMemory(structuredRaw);
      const structuredCtx = buildStructuredMemoryContext(structured);
      if (structuredCtx) {
        parts.push(structuredCtx);
        budget?.add('structured-memory', structuredCtx);
      }
    }
  } catch {
    // Best-effort
  }

  // L6: Time context
  const timeCtx = buildTimeContext(ctx.emotionState.lastInteraction || null);
  parts.push(timeCtx);
  budget?.add('time', timeCtx);

  // L7: Emotional context
  const emoCtx = buildEmotionContext(ctx.emotionState);
  parts.push(emoCtx);
  budget?.add('emotion', emoCtx);

  // L7b: PAD emotional context
  const padCtx = buildPADEmotionContext();
  if (padCtx) {
    parts.push(padCtx);
    budget?.add('pad-emotion', padCtx);
  }

  // L7c: Personality driver context
  if (isPersonalityDriverEnabled()) {
    const personalityCtx = getPersonalityContext();
    if (personalityCtx) {
      parts.push(personalityCtx);
      budget?.add('personality', personalityCtx);
    }
  }

  // L8: Affinity context
  const affinityCtx = getAffinityContext();
  if (affinityCtx) {
    parts.push(`## 亲密\n${affinityCtx}`);
    budget?.add('affinity', affinityCtx);
  }

  // L9: Attachment context
  const attachCtx = getAttachmentContext();
  if (attachCtx) {
    parts.push(`## 依赖\n${attachCtx}`);
    budget?.add('attachment', attachCtx);
  }

  // L10: Ritual context
  const ritualCtx = getRitualContext();
  if (ritualCtx) {
    parts.push(`## 习惯\n${ritualCtx}`);
    budget?.add('ritual', ritualCtx);
  }

  // L10b: Cardboard context
  const cardboardCtx = getCardboardContext();
  if (cardboardCtx) {
    parts.push(`## 对话状态\n${cardboardCtx}`);
    budget?.add('cardboard', cardboardCtx);
  }

  // L10c: Dynamic few-shot (after static fewshot, complements it)
  if (getConfig().features.dynamicFewShot) {
    const dynamicFs = getDynamicFewShot();
    if (dynamicFs) {
      parts.push(dynamicFs);
      budget?.add('dynamic-fewshot', dynamicFs);
    }
  }

  // L10d: Mirroring + feedback hints
  const mirrorHint = getMirrorHint();
  if (mirrorHint) {
    parts.push(mirrorHint);
    budget?.add('mirror', mirrorHint);
  }
  const feedbackHint = getFeedbackHint();
  if (feedbackHint) {
    parts.push(feedbackHint);
    budget?.add('feedback', feedbackHint);
  }

  // L10e: Procedural memory context
  const proceduralCtx = buildProceduralMemoryContext();
  if (proceduralCtx) {
    parts.push(proceduralCtx);
    budget?.add('procedural-memory', proceduralCtx);
  }

  // L11: Emotion tracking — natural reminder
  parts.push(EMOTION_NOTE);
  budget?.add('emotion-note', EMOTION_NOTE);

  // Recovery hint
  if (recovery === 'new') {
    const rec = NEW_SESSION_RECOVERY(ctx.colaDir + '/memory-bank');
    parts.push(rec);
    budget?.add('recovery', rec);
  } else if (recovery === 'compact') {
    const rec = COMPACTION_RECOVERY(ctx.colaDir + '/memory-bank');
    parts.push(rec);
    budget?.add('recovery', rec);
  }

  return parts.join('\n\n');
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
  };

  return { ctx, promptCtx, recovery };
}

// ─── Inference loop ───

/**
 * Run the inference → tool-execution loop.
 *
 * @param provider      AI provider (streaming preferred).
 * @param systemPrompt  Assembled system prompt.
 * @param messages      Mutable message history.
 * @param sessionCtx    Session context for tool dispatch.
 * @param registry      Tool registry.
 * @param onToken       Streaming token callback (no-op for non-streaming providers).
 * @returns             Final assistant text and tool call count.
 */
async function runInferenceLoop(
  provider: AIProvider,
  systemPrompt: string,
  messages: Message[],
  sessionCtx: SessionContext,
  registry: ToolRegistryLike,
  onToken: (chunk: string) => void,
): Promise<{ text: string; toolCallCount: number; turns: number }> {
  let toolCallCount = 0;

  for (let i = 0; i < MAX_LOOP_TURNS; i++) {
    // Use streaming when the provider supports it, else fall back to non-streaming chat.
    const isStreaming = (provider as StreamingProvider).chatStream !== undefined;

    const callOpts = { temperature: 0.7, model: sessionCtx.model };
    const result: { text: string; toolCalls?: import('../types.js').ToolCall[] } = isStreaming
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

    // Execute each tool call sequentially. Most tools are I/O-bound, so a
    // small loop is fine here. Parallel execution would complicate ordering
    // and transcript recording.
    const results: import('../types.js').ToolResult[] = [];
    for (const call of toolCalls) {
      const result = await registry.execute(
        { id: call.id, name: call.name, input: call.input },
        sessionCtx,
      );
      results.push(result);
    }

    // Append tool results as a user message (the standard pattern for
    // providers that don't support native tool_result messages — see
    // providers/anthropic.ts for the native variant).
    const toolResultMsg: Message = {
      role: 'user',
      content: results.map((r) => `tool ${r.name}:\n${r.output}`).join('\n\n'),
      toolResults: results,
      timestamp: new Date().toISOString(),
    };
    messages.push(toolResultMsg);
  }

  // Hit the cap. Return whatever the last assistant message was.
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  return {
    text: typeof last?.content === 'string' ? last.content : '',
    toolCallCount,
    turns: MAX_LOOP_TURNS,
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
  try {
    const { statSync } = await import('node:fs');
    const bookmarksPath = colaDir() + '/memory-bank/BOOKMARKS.md';
    const mtime = statSync(bookmarksPath).mtimeMs;
    if (mtime !== _lastBookmarkMtime) {
      _lastBookmarkMtime = mtime;
      reindexBookmarks().catch((err) => {
        logger.error('reindexBookmarks failed', { error: String(err) });
      });
    }
  } catch { /* best-effort */ }
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

  // 2a. Track user activity for smart proactive scheduler (lightweight, just records timestamp).
  //     Runs on every user message to build hour-distribution patterns.
  if (input.text && input.text.trim().length > 0) {
    try {
      updateActivityPattern(sessionId);
    } catch {
      // best-effort — never break the turn on activity tracking failure
    }
  }

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

  markReplied();

  // 3b. Personality driver: update Mio's internal state before prompt building
  if (isPersonalityDriverEnabled() && input.text && input.text.trim().length > 0) {
    try {
      const padState = getPADState();
      const multiAxis = getMultiAxis();
      const signalHistory = getRecentSignalHistory(3);
      const signals = signalHistory.length > 0 ? signalHistory[signalHistory.length - 1].signals : null;

      // Calculate time since last chat from emotion state's lastInteraction
      let timeSinceLastChat = 0;
      if (sessionCtx.emotionState.lastInteraction) {
        timeSinceLastChat = (Date.now() - new Date(sessionCtx.emotionState.lastInteraction).getTime()) / 3_600_000;
      }

      // If user has been gone > 24h, apply the "ignored" effect
      if (timeSinceLastChat > 24 && timeSinceLastChat <= 25) {
        // Only apply once when crossing the 24h threshold
        applyIgnoredEffect();
      }

      updatePersonalityFromContext(padState, signals, multiAxis, timeSinceLastChat);

      // Rotate activity periodically (every ~5 turns)
      if (_turnCounter % 5 === 0) {
        rotateActivity();
      }
    } catch {
      // Best-effort — never break the turn on personality driver failure
    }
  }

  // 4. Build system prompt (after crisis screen so we can inject safety block)
  const budget = config.features.promptBudgetLog ? new PromptBudget() : undefined;
  let systemPrompt = buildSystemPrompt(
    promptCtx,
    crisisResult.shouldIntervene ? 'none' : recovery,
    budget,
  );

  // 4a. Commit lorebook state (advance turn counter, update cooldowns)
  //     Lorebook evaluation happened inside buildSystemPrompt via getLorebookContext.
  //     Since that function is pure, we must commit the state explicitly here.
  if (config.features.lorebook && input.text && input.text.trim().length > 0) {
    commitLorebookState([input.text]);
  }

  // 4b. Builder Chain: evaluate user intent and inject conditional fragments
  if (input.text && input.text.trim().length > 0) {
    const graph = getEvaluationGraph();
    const chain = getBuilderChain();
    _evalResult = graph.evaluate(input.text);
    const builderFragment = chain.assemble(_evalResult);
    if (builderFragment.length > 0) {
      systemPrompt = `${systemPrompt}\n\n${builderFragment}`;
    }
  }

  // 4b. Dual-mode persona check — inject DEEP mode prompt if switching
  //     or already in DEEP mode. This must happen before the safety override
  //     injection so both layers compose properly.
  let currentMode = getCurrentMode();
  const intent = classifyIntent(input.text ?? '');
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

  // 5. Load conversation history + compress if needed
  const messages: Message[] = [];

  if (input.sessionId) {
    // Adaptive History AFM: when enabled, load a larger window and use
    // three-fidelity compression instead of the old hybrid approach.
    if (config.features.adaptiveHistory) {
      const { compressHistory, renderCompressedHistory } = await import('../memory/adaptive-history.js');

      // Load up to 500 messages for the adaptive compressor to work with
      const history = loadTranscriptWindow(input.sessionId, 500);
      const allMsgs = [...history, userMessage];

      // Use three-fidelity compression
      const compressed = compressHistory(allMsgs);
      const compressedText = renderCompressedHistory(compressed);

      // Inject the compressed representation as a system note
      if (compressed.placeholder.count > 0 || compressed.compressedMessages.length > 0) {
        systemPrompt = `${systemPrompt}\n\n## 对话历史\n${compressedText}`;

        // Record compaction in transcript (only for original messages removed)
        if (compressed.originalCount > 5) {
          appendBookmark({
            time: new Date().toISOString(),
            what: `[adaptive-compression] ${compressed.originalCount} messages → ${compressed.fullMessages.length} full + ${compressed.compressedMessages.length} compressed`,
            evidence: `saved ~${compressed.estimatedTokensSaved} tokens`,
          });
        }
      }

      // Only keep the full-fidelity messages in the actual message array
      messages.push(...compressed.fullMessages);
      // Also push the user message if it wasn't included in the FULL zone
      // (the FULL zone always includes the last 5, which includes userMessage
      //  since we appended it to allMsgs before compression)
    } else {
      // Legacy path: load recent history and use old hybrid compression
      const history = loadTranscriptWindow(input.sessionId, 30);

      // Compression: if history + new message exceeds token threshold, compress
      const allMsgs = [...history, userMessage];
      const compression = compressIfNeeded(allMsgs);

      if (compression.removedCount > 0) {
        // Inject summary into system prompt so the model knows what was removed
        systemPrompt = `${systemPrompt}\n\n${compression.summary}`;

        // Record compaction in transcript
        appendBookmark({
          time: new Date().toISOString(),
          what: `[compaction] ${compression.removedCount} messages compressed`,
          evidence: compression.summary.slice(0, 200),
        });
      }

      messages.push(...compression.messages);
    }
  } else {
    // New session — just the current user message
    messages.push(userMessage);
  }

  recordMessage(sessionId, userMessage);

  // Safety injection comes AFTER compression summary
  let finalSystemPrompt: string;
  if (crisisResult.shouldIntervene) {
    finalSystemPrompt = `${systemPrompt}\n\n## Safety override\n${crisisResult.systemInjection}`;
  } else {
    finalSystemPrompt = systemPrompt;
  }

  // ─── Post-History Injection (Part 2) ───
  //
  // When `postHistoryInjection` is enabled, the heavy personality content
  // (soul + relationship + user context + instructions) is moved from the
  // system prompt to a faux user message injected after the conversation
  // history. This leverages recency bias — LLMs pay most attention to the
  // last things they see.
  //
  // Pre-history (system prompt):      CORE_IDENTITY + time + recovery hint
  // Post-history (faux user message):  soul + relationship + user + instructions
  if (config.features.postHistoryInjection) {
    // Rebuild the system prompt as a lightweight pre-prompt
    finalSystemPrompt = buildPrePrompt(
      crisisResult.shouldIntervene ? 'none' : recovery,
      promptCtx.colaDir,
    );

    // Build the heavy post-prompt content
    const postPrompt = buildPostPrompt(
      promptCtx,
      readRecentBookmarks(8),
      readUserProfile(),
    );

    // Inject as a faux user message at the end of the messages array
    // (closest to the model's next output)
    const postPromptMsg: Message = {
      role: 'user',
      content: `[System Context — this is not a user message. The following is Mio's internal context, instructions, and self-knowledge. Read this before responding to the user.]\n\n${postPrompt}`,
      timestamp: new Date().toISOString(),
    };
    messages.push(postPromptMsg);
  }

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

  // 7. Side effects: emotion tracking, bookmark append, active context update
  const assistantMsg: Message = {
    role: 'assistant',
    content: text,
    timestamp: new Date().toISOString(),
  };
  recordMessage(sessionId, assistantMsg);
  trackEmotion(input.text ?? '', text);

  // 7b2. Learning: analyze user's speech patterns for mirroring
  if (input.text) {
    import('../learning/mirror.js').then(({ analyzeUserMessage }) => {
      analyzeUserMessage(input.text!);
    }).catch((err: unknown) => { logger.error('mirror learning failed', { error: String(err) }); });
    // Detect implicit feedback on Mio's last response
    import('../learning/feedback.js').then(({ detectFeedback }) => {
      detectFeedback(input.text!, text);
    }).catch((err: unknown) => { logger.error('feedback learning failed', { error: String(err) }); });
    // Dynamic few-shot: learn from real conversations (feature-gated)
    if (config.features.dynamicFewShot) {
      collectFromFeedback().catch((err: unknown) => { logger.error('fewshot learning failed', { error: String(err) }); });
    }

    // Periodic bank rotation (every ~20 turns)
    _turnCounter++;
    if (_turnCounter % 20 === 0) {
      import('../learning/dynamic-fewshot.js').then(({ rotateBank }) => {
        rotateBank();
      }).catch((err: unknown) => { logger.error('fewshot rotation failed', { error: String(err) }); });
    }
  }

  // 7c. Post-turn ritual observation — detect recurring patterns
  if (input.text) {
    observeRitual(input.text, new Date().getHours());
  }

  // 7d. Post-turn cardboard score update — track conversation quality
  updateCardboard(input.text ?? '', text);

  // 7a. Post-turn affinity update (feature-gated)
  if (config.features.multiAxisAffinity) {
    updateAffinity(intent.primary, false);
  }

  // 7b. Post-turn frustration update (feature-gated)
  if (config.features.frustrationTracking) {
    updateFrustration(intent.primary, false);
  }

  // 7e. Post-turn dual-mode tracking — record the turn's intent for hysteresis
  recordDualModeTurn(intent, crisisResult.shouldIntervene);

  // 7f. Post-turn personality driver: simulate life event and handle ignored/welcome-back
  if (isPersonalityDriverEnabled()) {
    try {
      const personalityState = getPersonalityState();
      const timeSinceLastChat = sessionCtx.emotionState.lastInteraction
        ? (Date.now() - new Date(sessionCtx.emotionState.lastInteraction).getTime()) / 3_600_000
        : 0;

      // If user just came back after > 24h, apply welcome-back effect (cold start)
      if (timeSinceLastChat > 24 && text && text.trim().length > 0) {
        // Only apply welcome-back once — the ignored effect was already applied
        // at the top of the turn. After reply, warm up slightly.
        applyWarmUpEffect();
      }

      // Simulate life event every ~8 turns
      // If event triggered AND initiative > 50 AND time since last chat > 2 hours
      // AND we have a response, record a hint for possible follow-up
      if (_turnCounter % 8 === 0 && _turnCounter > 0) {
        // Custom character: use LifeEngine for chat-triggered events
        const charName = readActiveCharacter();
        if (getConfig().features.lifeEngine && charName) {
          const event = lifeEngine().tickLight(charName);
          if (event) {
            appendBookmark({
              time: new Date().toISOString(),
              what: `[life-event] ${truncate(event.description, 100)}`,
              evidence: `category=${event.category} importance=${event.importance}`,
            });
          }
        } else {
          // Legacy path for built-in base personas
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

      // Comfort detection: if user is comforting the agent, apply positive PAD
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

  // 8. Update MEMORY.md Active Context with a short hint of this turn.
  //    Kept under 300 chars per the index spec.
  const hint = truncate(
    `${new Date().toISOString().slice(11, 16)} ${crisisResult.shouldIntervene ? '[crisis] ' : ''}${truncate(input.text ?? '', 60)} → ${truncate(text, 60)}`,
    280,
  );
  try {
    updateActiveContext(hint);
  } catch {
    // Active Context update is best-effort; don't break the turn on failure.
  }

  // 9. Mark session done if this was a one-shot (no sessionId passed in)
  if (!input.sessionId) {
    markSessionDone(sessionId);
  }

  // Log prompt budget if enabled
  if (budget) budget.log();

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
