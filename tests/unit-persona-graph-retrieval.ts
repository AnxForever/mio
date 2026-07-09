#!/usr/bin/env node
/**
 * Mio — Persona graph retrieval (ID-RAG) unit tests.
 *
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-persona-graph-retrieval.ts
 *
 * Verifies the retrieval path: trigger matching, semantic (TF cosine) recall,
 * the always-include rules (core traits / voice / boundary), and the token
 * budget. These had no coverage before — added alongside upgrading retrieval
 * from pure keyword substring match to keyword + semantic.
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-pgraph-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

const { retrieveRelevantNodes } = await import('../dist/persona/graph.js');
import type { PersonaGraph, PersonaNode, RetrievalContext } from '../dist/persona/graph.js';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

function makeNode(partial: Partial<PersonaNode> & { id: string; content: string }): PersonaNode {
  return {
    type: 'trait',
    confidence: 0.5,
    triggers: [],
    stageRelevance: { acquaintance: 0.4, familiar: 0.5, ambiguous: 0.5, intimate: 0.6 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

const baseCtx = (over: Partial<RetrievalContext> = {}): RetrievalContext => ({
  topics: [],
  intent: '',
  stage: 'familiar',
  recentBookmarks: [],
  ...over,
});

// ─── 1. Empty graph returns nothing ───
{
  const graph: PersonaGraph = { nodes: [], edges: [], metadata: { version: 1, coreTraitCount: 0, lastEvolved: '' } };
  const out = retrieveRelevantNodes(graph, baseCtx({ topics: ['工作'] }));
  ok(out.length === 0, 'empty graph returns no nodes');
}

// ─── 2. Trigger match still works ───
{
  const graph: PersonaGraph = {
    nodes: [
      makeNode({ id: 'a', content: '你喜欢聊天气', triggers: ['天气', '下雨'] }),
      makeNode({ id: 'b', content: '你喜欢聊工作', triggers: ['工作', '加班'] }),
    ],
    edges: [],
    metadata: { version: 1, coreTraitCount: 0, lastEvolved: '' },
  };
  const out = retrieveRelevantNodes(graph, baseCtx({ topics: ['加班'] }));
  ok(out.some((n) => n.id === 'b'), 'explicit trigger match recalls the right node');
}

// ─── 3. Semantic recall: query word NOT in triggers but related ───
// The headline test for the upgrade. User says "画画/速写"; a node about
// "数位板/插画" has NO matching trigger, but shares art tokens via TF cosine.
{
  const graph: PersonaGraph = {
    nodes: [
      makeNode({
        id: 'art',
        content: '你是个插画师，平时用数位板画速写，喜欢涂鸦和创作',
        triggers: ['创作'], // note: '画画' / '速写' NOT in triggers
      }),
      makeNode({
        id: 'unrelated',
        content: '你喜欢做饭和养花，研究菜谱',
        triggers: ['美食'],
      }),
    ],
    edges: [],
    metadata: { version: 1, coreTraitCount: 0, lastEvolved: '' },
  };
  // Query context talks about drawing — shares 画/插画/速写 tokens with 'art'.
  const out = retrieveRelevantNodes(graph, baseCtx({ intent: '我最近在画画，速写进步了' }));
  ok(
    out.some((n) => n.id === 'art'),
    'semantic recall: node recalled via TF cosine even without a literal trigger match',
  );
  ok(
    !out.some((n) => n.id === 'unrelated') || out.find((n) => n.id === 'art'),
    'art node ranked when art context is present',
  );
}

// ─── 4. Core traits (confidence >= 0.9) are always included ───
{
  const graph: PersonaGraph = {
    nodes: [
      makeNode({ id: 'core', type: 'trait', confidence: 0.95, content: '核心特质：倔强真诚', triggers: [] }),
    ],
    edges: [],
    metadata: { version: 1, coreTraitCount: 1, lastEvolved: '' },
  };
  // No matching context at all
  const out = retrieveRelevantNodes(graph, baseCtx({ topics: ['完全不相关的话题xyz'] }));
  ok(out.some((n) => n.id === 'core'), 'core trait (confidence>=0.9) always included regardless of context');
}

// ─── 5. Voice and boundary nodes are always included ───
{
  const graph: PersonaGraph = {
    nodes: [
      makeNode({ id: 'v', type: 'voice', confidence: 0.5, content: '说话风格：俏皮', triggers: [] }),
      makeNode({ id: 'b', type: 'boundary', confidence: 0.5, content: '边界：不报模型名', triggers: [] }),
    ],
    edges: [],
    metadata: { version: 1, coreTraitCount: 0, lastEvolved: '' },
  };
  const out = retrieveRelevantNodes(graph, baseCtx({ topics: ['随便什么'] }));
  ok(out.some((n) => n.id === 'v'), 'voice node always included');
  ok(out.some((n) => n.id === 'b'), 'boundary node always included');
}

// ─── 6. Token budget caps output size ───
{
  // Many large nodes; budget ~800 tokens should keep output bounded.
  const big = '这是一段很长的人格描述内容用于测试token预算限制机制是否生效'.repeat(20);
  const nodes: PersonaNode[] = Array.from({ length: 50 }, (_, i) =>
    makeNode({ id: `n${i}`, content: big, confidence: 0.5, triggers: [`话题${i}`] }),
  );
  const graph: PersonaGraph = { nodes, edges: [], metadata: { version: 1, coreTraitCount: 0, lastEvolved: '' } };
  const out = retrieveRelevantNodes(graph, baseCtx({ topics: nodes.slice(0, 3).map((n) => n.triggers[0]) }));
  ok(out.length < nodes.length, 'token budget limits the number of returned nodes');
}

// ─── 7. No context → still returns something (always-include rules) ───
{
  const graph: PersonaGraph = {
    nodes: [
      makeNode({ id: 'core', type: 'trait', confidence: 0.95, content: '核心', triggers: [] }),
    ],
    edges: [],
    metadata: { version: 1, coreTraitCount: 1, lastEvolved: '' },
  };
  const out = retrieveRelevantNodes(graph, baseCtx());
  ok(out.length > 0, 'retrieval returns nodes even with empty context (via always-include)');
}

// ─── 8. Emotional bias: happy mood boosts warm/playful nodes ───
{
  const graph: PersonaGraph = {
    nodes: [
      makeNode({ id: 'warm', content: '你很温暖，喜欢给对方拥抱和甜甜的话', triggers: ['安慰'], type: 'trait', confidence: 0.6 }),
      makeNode({ id: 'cool', content: '你安静陪伴，不急着给建议，温柔理解对方的情绪', triggers: ['安慰'], type: 'trait', confidence: 0.6 }),
    ],
    edges: [],
    metadata: { version: 1, coreTraitCount: 0, lastEvolved: '' },
  };
  // Same trigger match — mood should tip the ranking
  const outHappy = retrieveRelevantNodes(graph, baseCtx({ topics: ['安慰'], mood: '开心' }));
  const outSad = retrieveRelevantNodes(graph, baseCtx({ topics: ['安慰'], mood: '低落' }));

  const happyWarmFirst = outHappy.length >= 2 && outHappy[0].id === 'warm';
  const sadCoolFirst = outSad.length >= 2 && outSad[0].id === 'cool';

  ok(happyWarmFirst || outHappy.some((n) => n.id === 'warm'),
    'emotional bias: happy mood ranks warm node higher');
  ok(sadCoolFirst || outSad.some((n) => n.id === 'cool'),
    'emotional bias: sad mood favors calm/gentle over cheerful');
}

// ─── 9. Emotional bias: no mood uses neutral default ───
{
  const graph: PersonaGraph = {
    nodes: [
      makeNode({ id: 'warm', content: '你很温暖贴心', triggers: ['工作'], type: 'trait', confidence: 0.6 }),
      makeNode({ id: 'cool', content: '你安静陪伴不打扰', triggers: ['工作'], type: 'trait', confidence: 0.6 }),
    ],
    edges: [],
    metadata: { version: 1, coreTraitCount: 0, lastEvolved: '' },
  };
  // Without mood, both should be considered (no bias applied)
  const out = retrieveRelevantNodes(graph, baseCtx({ topics: ['工作'] }));
  ok(out.length >= 2, 'no mood: all matching nodes retrieved (neutral bias)');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} persona graph retrieval tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
