import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { captureExplicitDirectives } from '../persona/directive-capture.js';
import { selectProvider } from '../providers/index.js';
import { updateActivityPattern } from '../scheduler/smart-proactive.js';
import { screenForCrisis } from '../safety/crisis.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '../config.js';
import { ensureBankStructure } from '../memory/bank.js';
import { colaDir } from '../memory/paths.js';
import { renderTemporalAwarenessContext, updateTemporalStateForTurn } from '../memory/temporal-state.js';
import { reindexBookmarks } from '../memory/vector.js';
import { pluginRegistry } from '../plugins/index.js';
import type { Message } from '../types.js';
import {
  ensurePluginsLoaded,
  ensureToolsRegistered,
} from './tool-runtime.js';
import { buildUserContent, prepareTurnInput } from './turn-input.js';
import { isIsolatedMemorySession, resolveSessionContext } from './turn-session.js';
import type { PreparedTurnContext, RunTurnOptions, TurnInput } from './turn-types.js';

/** Last seen mtime of BOOKMARKS.md for dirty-flag optimization. */
let _lastBookmarkMtime = 0;

export async function prepareTurnContext(
  input: TurnInput,
  opts: RunTurnOptions,
): Promise<PreparedTurnContext> {
  ensureBankStructure();
  await ensurePluginsLoaded();
  const registry = opts.registry ?? ensureToolsRegistered();

  // Reindex vector store only when BOOKMARKS.md has changed (mtime check).
  // Uses dirty-flag optimization to avoid per-turn network calls with MiniMax.
  maybeReindexBookmarks();
  const config = getConfig();
  // Main inference path: enable the fallback chain so a recoverable provider
  // failure (network / 5xx / 429) transparently retries with another provider
  // that has an API key set. Gated by the providerFallback feature flag
  // (default on); buildChain filters out providers without keys, so a single-key
  // setup just has no fallback available — it never breaks.
  const provider = opts.provider ?? selectProvider(config.provider, config.model, config.features.providerFallback);
  const turnInput = await prepareTurnInput(input);
  const sessionId = turnInput.sessionId ?? randomUUID().slice(0, 12);

  // User shaping should affect the same turn that contains it. Capturing here
  // lets explicit preferences enter this user's prompt context before inference.
  const capturedDirectives = captureExplicitDirectives(
    turnInput.text,
    sessionId,
    !isIsolatedMemorySession(sessionId),
  );

  const { ctx: sessionCtx, promptCtx, recovery } = resolveSessionContext(turnInput, sessionId);
  promptCtx.temporalTurnContext = updateTemporalStateForTurn(sessionId, turnInput.text, new Date());
  promptCtx.temporalContext = renderTemporalAwarenessContext(promptCtx.temporalTurnContext);
  if (!sessionCtx.isolatedMemory && !turnInput.sessionId) {
    await pluginRegistry().invokeHook('onSessionStart', sessionId);
  }
  if (!sessionCtx.isolatedMemory) {
    await pluginRegistry().invokeHook('onBeforeTurn', sessionCtx);
  }

  const userMessage: Message = {
    role: 'user',
    content: buildUserContent(turnInput),
    timestamp: new Date().toISOString(),
  };

  trackTurnActivity(turnInput, sessionId);

  // Crisis pre-screen. If triggered, inference still runs with a safety
  // injection and post-turn side effects record the crisis signal.
  const crisisResult = screenForCrisis(turnInput.text ?? '');

  return {
    registry,
    config,
    provider,
    turnInput,
    sessionId,
    capturedDirectiveCount: capturedDirectives.length,
    sessionCtx,
    promptCtx,
    recovery,
    userMessage,
    crisisResult,
  };
}

function trackTurnActivity(input: TurnInput, sessionId: string): void {
  if (!input.text || input.text.trim().length === 0) return;
  try {
    updateActivityPattern(sessionId);
  } catch {
    // best-effort — never break the turn on activity tracking failure
  }
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
