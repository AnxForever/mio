/**
 * @mio/idrag — Public API
 *
 * ID-RAG knowledge graph for persona memory.
 * Bootstrap a persona from markdown (soul.md), retrieve contextually
 * relevant subgraphs at inference time.
 *
 * Usage:
 *   import { bootstrapGraph, retrieveContext } from '@mio/idrag';
 */

// Knowledge graph
export {
  bootstrapGraph,
  retrieveContext,
  addNode,
  addEdge,
  querySubgraph,
  serializeGraph,
  deserializeGraph,
} from './graph.js';

// Extraction
export { extractPersonaGraph } from './extractor.js';

// Generation
export { generatePersonaResponse } from './generator.js';
export type { PersonaRequest, PersonaResult } from './types.internal.js';

// Driver
export { runPersonaDriver } from './driver.js';

// Dual mode
export { switchMode, getActiveMode, getDualModeState } from './dual-mode.js';
export type { DualModeState, PersonaMode } from './types.internal.js';
