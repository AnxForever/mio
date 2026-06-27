#!/usr/bin/env node
/**
 * Mio — knowledge base tests (chunking + ingest/search).
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-knowledge-base.ts
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-kb-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

// === IMPORTS ===
const { chunkText } = await import('../dist/memory/knowledge-base/chunking.js');
const { ingestDocument, searchKnowledge, knowledgeStats, deleteDocument } = await import('../dist/memory/knowledge-base/kb.js');
const { indexEntry } = await import('../dist/memory/vector.js');
const { registerKnowledgeTools } = await import('../dist/tools/knowledge.js');
// === END IMPORTS ===

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — knowledge base tests\x1b[0m\n');

// --- chunking ---
{
  ok(chunkText('').length === 0, 'empty → no chunks');
  ok(chunkText('   \n  ').length === 0, 'whitespace → no chunks');

  const short = chunkText('一句话而已');
  ok(short.length === 1 && short[0].text === '一句话而已', 'short text → single chunk');

  const long = '这是第一句话。这是第二句话。这是第三句话。'.repeat(20);
  const chunks = chunkText(long, { chunkSize: 100, overlap: 20 });
  ok(chunks.length > 1, 'long text → multiple chunks');
  ok(chunks.every((c) => c.text.length <= 130), 'each chunk within chunkSize+overlap bound');
  ok(chunks.every((c, i) => c.index === i), 'chunks indexed sequentially from 0');
  ok(chunks.some((c) => c.text.includes('第一句话')), 'content preserved across chunks');

  // paragraph-priority split
  const paras = chunkText('段落甲内容。\n\n段落乙内容。\n\n段落丙内容。', { chunkSize: 12, overlap: 0 });
  ok(paras.length >= 2, 'splits on paragraph boundaries when oversized');
}

// --- ingest + search + source isolation ---
{
  // a non-KB memory (bookmark) to prove KB search doesn't leak across sources
  indexEntry({ id: 'bm:1', text: '用户喜欢喝拿铁咖啡', source: 'bookmark', timestamp: '2026-06-01' });

  const n = await ingestDocument('diary-2026', '我最爱的城市是京都。京都的秋天有红叶。我在京都吃过抹茶冰淇淋。');
  ok(n >= 1, `ingest returns chunk count (${n})`);
  ok(knowledgeStats().chunks === n, 'knowledge stats counts ingested chunks');

  const hits = await searchKnowledge('京都', 5);
  ok(hits.length > 0 && hits.every((h) => h.source === 'knowledge'), 'searchKnowledge returns only knowledge chunks');
  ok(hits.some((h) => h.text.includes('京都')), 'searchKnowledge finds a relevant chunk');
  ok(hits.every((h) => h.id !== 'bm:1'), 'kb search excludes non-knowledge sources');

  const del = deleteDocument('diary-2026');
  ok(del === n && knowledgeStats().chunks === 0, 'deleteDocument removes all chunks');
}

// --- recall_knowledge tool ---
{
  const tools = new Map<string, { h: (a: unknown) => Promise<string> }>();
  registerKnowledgeTools({ register: (def, h) => tools.set(def.name, { h: h as (a: unknown) => Promise<string> }) });
  ok(tools.has('recall_knowledge') && tools.has('knowledge_stats'), 'registers recall_knowledge + knowledge_stats');

  await ingestDocument('topic-q', '量子计算利用量子叠加和纠缠来并行处理信息。');
  const out = await tools.get('recall_knowledge')!.h({ query: '量子计算' });
  ok(typeof out === 'string' && out.includes('量子'), 'recall_knowledge tool returns relevant text');

  const empty = await tools.get('recall_knowledge')!.h({ query: '' });
  ok(empty.includes('required'), 'recall_knowledge requires a query');
}

// === APPEND KB TESTS ABOVE THIS LINE ===

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} knowledge base tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
