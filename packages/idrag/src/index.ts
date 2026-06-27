/**
 * @mio/idrag — Public API
 *
 * ID-RAG knowledge graph for persona memory.
 * Bootstrap a persona from markdown (soul.md), retrieve contextually
 * relevant subgraphs at inference time.
 *
 * Usage:
 *   import { extractGraphFromSoul, retrieveRelevantNodes, graphToPrompt } from '@mio/idrag';
 */

// Knowledge graph
export {
  extractGraphFromSoul,
  retrieveRelevantNodes,
  graphToPrompt,
  evolveGraph,
  serializeGraph,
  deserializeGraph,
  defaultGraph,
} from './graph.js';
export type { PersonaGraph, PersonaNode, PersonaEdge, RetrievalContext } from './graph.js';

// Extraction
export { ensurePersonaGraph, refreshPersonaGraph, loadPersonaGraph, needsRefresh } from './extractor.js';

// Generation
export { generatePersona, previewPersona } from './generator.js';
export type { PersonaRequest, PersonaResult } from './types.internal.js';

// Driver
export {
  isPersonalityDriverEnabled,
  defaultPersonalityState,
  getPersonalityState,
  updatePersonalityFromContext,
  rotateActivity,
  getPersonalityContext,
  getResponseStyle,
  simulateLifeEvent,
  applyIgnoredEffect,
  applyWelcomeBackEffect,
  applyWarmUpEffect,
  resetPersonalityState,
} from './driver.js';
export type { PersonalityState, ResponseStyle } from './driver.js';

// Dual mode
export { getCurrentMode, shouldSwitchMode, executeSwitch, recordTurn, getDualModePrompt } from './dual-mode.js';
export type { DualModeState, PersonaMode } from './types.internal.js';
