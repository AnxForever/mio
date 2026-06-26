/**
 * Mio — recall_memories tool
 *
 * Exposes the vector memory backend (src/memory/vector.ts) as a tool
 * the agent can call to retrieve relevant past exchanges.
 *
 * The agent loop already injects a memory-bank context block into the
 * prompt; this tool is for *targeted* recall when the agent decides the
 * user is referring to something from the past and the passive context
 * isn't enough.
 */

import type { ToolDef, ToolHandler } from '../types.js';
import { search, indexStats } from '../memory/vector.js';

const RECALL_DEF: ToolDef = {
  name: 'recall_memories',
  description:
    'Search past exchanges and notes for content relevant to a query. ' +
    'Use when the user references something from the past and the passive ' +
    'memory-bank context in your system prompt is not enough. Returns a ' +
    'list of matching entries with similarity scores.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text query describing what to look for.' },
      limit: { type: 'number', description: 'Max results to return (default 5, max 20).' },
    },
    required: ['query'],
  },
};

const RECALL_HANDLER: ToolHandler = async (args) => {
  const { query, limit } = args as { query?: string; limit?: number };
  if (!query || query.trim().length === 0) {
    return 'recall_memories: query is required';
  }
  const n = Math.min(Math.max(limit ?? 5, 1), 20);
  const results = await search(query, n);
  if (results.length === 0) {
    return `recall_memories: no matches for "${query}"`;
  }
  return results
    .map((r) => `[${r.timestamp}] (${r.source}, score=${r.score.toFixed(2)}) ${r.text}`)
    .join('\n');
};

const INDEX_STATS_DEF: ToolDef = {
  name: 'memory_stats',
  description: 'Return statistics about the vector memory index (entry count, breakdown by source).',
  inputSchema: { type: 'object', properties: {} },
};

const INDEX_STATS_HANDLER: ToolHandler = async () => {
  const stats = indexStats();
  const sourceLines = Object.entries(stats.sources)
    .map(([src, n]) => `  ${src}: ${n}`)
    .join('\n');
  return `Memory index: ${stats.entries} entries\n${sourceLines || '(no entries yet)'}`;
};

export function registerRecallTools(registry: { register: (def: ToolDef, handler: ToolHandler) => void }): void {
  registry.register(RECALL_DEF, RECALL_HANDLER);
  registry.register(INDEX_STATS_DEF, INDEX_STATS_HANDLER);
}

export const RECALL_TOOL_NAMES = ['recall_memories', 'memory_stats'];
