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
