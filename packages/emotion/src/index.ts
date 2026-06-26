/**
 * @mio/emotion — Public API
 *
 * PAD 3D emotional model, OCEAN personality traits, 5-axis affinity,
 * ghost silence, frustration tracking, intent classification.
 *
 * Usage:
 *   import { initEmotion, updatePAD, applyDecay } from '@mio/emotion';
 */

// Context (must be called first)
export { initEmotion, getPaths, getIO, getEmotionConfig } from './context.js';
export type { EmotionPaths, EmotionIO, EmotionConfig } from './context.js';

// PAD 3D model
export {
  defaultPADState,
  invalidatePADCache,
  readPADConfig,
  writePADConfig,
  getPADState,
  writePADState,
  updatePAD,
  setPADState,
  applyDecay,
  classifyPAD,
  padToMood,
  padToPromptContext,
  padAffectionDelta,
  getPersonalityBaseline,
  isPADEnabled,
} from './pad.js';
export type { PADState, PADConfig } from './types.internal.js';

// OCEAN personality traits
export { getTraitState, updateTraitState, recordPADState, computeMood as computeTraitMood } from './trait-state.js';
export { runExperienceTraitCycle } from './experience-trait.js';
export type { OCEANTraits } from './types.internal.js';
export type { ExperienceType } from './experience-trait.js';

// 5-axis affinity
export {
  getAffinity,
  updateAffinity,
  readAffinityState,
  writeAffinityState,
} from './affinity.js';
export type { AffinityState } from './types.internal.js';

// Multi-axis relationship
export {
  isMultiAxisRelationshipEnabled,
  updateMultiAxis,
  getMultiAxis,
  deriveAttachmentFromMultiAxis,
} from './multi-axis.js';
export type { MultiAxisState } from './types.internal.js';

// Ghost silence
export { shouldGhost, resetGhostState, doGhost } from './ghost.js';

// Frustration tracking
export {
  trackFrustration,
  deriveAttachmentStyle,
} from './frustration.js';
export type { AttachmentStyle, FrustrationState } from './types.internal.js';

// Intent classifier
export { classifyIntent, intentLabel } from './classifier.js';
export type { IntentResult } from './types.internal.js';
export type { IntentLabel } from './classifier.js';

// Response signals
export { analyzeSignals, getRecentSignalHistory } from './signals.js';
export type { ResponseSignals } from './types.internal.js';

// Ritual detection
export { detectRitual, updateCardboardScore } from './ritual.js';

// Lexical mood
export { analyzeLexicalMood } from './lexical-mood.js';

// State management
export { readEmotionState, updateEmotionState, syncPADToEmotionState } from './state.js';
export type { EmotionState } from './types.internal.js';

// Post-turn tracker
export { trackPostTurn } from './tracker.js';

// Session context
export type { SessionContext, RelationshipState } from './types.internal.js';
