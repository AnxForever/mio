import { getConfig, getDataDir } from '../config.js';
import { defaultEmotionState, readEmotionState } from '../emotion/state.js';
import { defaultRelationshipState, readRelationshipState } from '../relationship/progression.js';
import { readPersonaDelta, readPreferences } from '../memory/persona-delta.js';
import { colaDir } from '../memory/paths.js';
import { modManager } from '../mod/mod-manager.js';
import type {
  EmotionState,
  Gender,
  PromptCtx,
  RelationshipState,
  SessionContext,
} from '../types.js';
import type { TurnInput } from './turn-types.js';

export function isIsolatedMemorySession(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  return /^openai-/.test(sessionId) || /^onebot-(?:private|group)-/.test(sessionId) || /^wechat-native-/.test(sessionId);
}

/**
 * Resolve or create the SessionContext for a turn.
 *
 * Always reads the latest emotion/relationship state from disk, picks up the
 * active mod from the mod manager, and constructs a fresh SessionContext.
 */
export function resolveSessionContext(input: TurnInput, sessionId: string): {
  ctx: SessionContext;
  promptCtx: PromptCtx;
  recovery: 'new' | 'compact' | 'none';
} {
  const config = getConfig();
  const isolatedMemory = isIsolatedMemorySession(sessionId);
  const emotionState: EmotionState = isolatedMemory ? defaultEmotionState() : readEmotionState();
  const relationshipState: RelationshipState = isolatedMemory ? defaultRelationshipState() : readRelationshipState();
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
    isolatedMemory,
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
    personaDelta: readPersonaDelta(sessionId) ?? undefined,
    preferences: readPreferences(sessionId) ?? undefined,
    isolatedMemory,
  };

  return { ctx, promptCtx, recovery };
}
