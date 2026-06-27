/**
 * Mio — recall_knowledge tool
 *
 * Exposes the knowledge base (src/memory/knowledge-base/) as a tool the agent
 * can call to retrieve relevant chunks from documents the user ingested
 * (diaries, preferences, long notes). Agentic injection: Mio decides when to
 * query it — complements the passive memory-bank context.
 */

import type { ToolDef, ToolHandler } from '../types.js';
import { searchKnowledge, knowledgeStats } from '../memory/knowledge-base/kb.js';

const RECALL_KB_DEF: ToolDef = {
  name: 'recall_knowledge',
  description:
    '检索用户知识库（用户喂入的文档：日记、喜好、长文笔记）中与查询相关的片段。' +
    '当用户提到的内容可能在他提供的文档里、而系统提示里的被动记忆不够时使用。' +
    '返回匹配片段及相似度分数。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text query describing what to look for.' },
      limit: { type: 'number', description: 'Max results to return (default 5, max 20).' },
    },
    required: ['query'],
  },
};

const RECALL_KB_HANDLER: ToolHandler = async (args) => {
  const { query, limit } = args as { query?: string; limit?: number };
  if (!query || query.trim().length === 0) {
    return 'recall_knowledge: query is required';
  }
  const n = Math.min(Math.max(limit ?? 5, 1), 20);
  const results = await searchKnowledge(query, n);
  if (results.length === 0) {
    return `recall_knowledge: no matches for "${query}"`;
  }
  return results.map((r) => `(score=${r.score.toFixed(2)}) ${r.text}`).join('\n');
};

const KB_STATS_DEF: ToolDef = {
  name: 'knowledge_stats',
  description: 'Return the number of knowledge-base chunks currently indexed.',
  inputSchema: { type: 'object', properties: {} },
};

const KB_STATS_HANDLER: ToolHandler = async () => {
  const { chunks } = knowledgeStats();
  return `Knowledge base: ${chunks} chunks indexed`;
};

export function registerKnowledgeTools(registry: { register: (def: ToolDef, handler: ToolHandler) => void }): void {
  registry.register(RECALL_KB_DEF, RECALL_KB_HANDLER);
  registry.register(KB_STATS_DEF, KB_STATS_HANDLER);
}

export const KNOWLEDGE_TOOL_NAMES = ['recall_knowledge', 'knowledge_stats'];
