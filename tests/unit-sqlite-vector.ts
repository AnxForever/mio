#!/usr/bin/env node
/**
 * Mio — SQLite + sqlite-vec vector store tests (U2).
 *
 * Covers the new storage backend end to end:
 *   - sqlite-vector.ts: dense KNN, stable-rowid upsert, sparse roundtrip,
 *     stats, delete-by-source.
 *   - vector.ts: legacy JSONL migration, TF index/search/stats, incremental
 *     reindex, and dense-entry storage via indexEntryWithProvider.
 *
 * Isolation: getDataDir() caches the data dir, so we use ONE fixed MIO_DIR and
 * reset on-disk state between tests rather than switching directories. The
 * migration test runs first among the vector.ts cases so vector.ts's one-time
 * `_migrated` latch fires against a real legacy file.
 *
 * Run:
 *   npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-sqlite-vector.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EmbeddingProvider } from '../dist/memory/embedding.js';

interface TestResult { name: string; passed: boolean; detail?: string; }
const results: TestResult[] = [];
function record(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${status} ${name}${detail ? ` — ${detail}` : ''}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function norm(a: number[]): Float32Array {
  const n = Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1;
  return new Float32Array(a.map((x) => x / n));
}

/** A deterministic dense embedding provider for testing the minimax path. */
function denseProvider(map: Record<string, number[]>): EmbeddingProvider {
  return {
    type: 'minimax',
    embed: async (texts: string[]) => texts.map((t) => norm(map[t] ?? [0.01, 0.01, 0.01, 0.01])),
  } as EmbeddingProvider;
}

const dir = mkdtempSync(join(tmpdir(), 'mio-sv-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
const mb = join(dir, 'memory-bank');
mkdirSync(mb, { recursive: true });

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — sqlite-vec vector store tests\x1b[0m\n');

  const store = await import('../dist/memory/sqlite-vector.js');
  const v = await import('../dist/memory/vector.js');

  /** Reset on-disk state between tests (fixed dir, so wipe the files). */
  function reset(): void {
    store.closeDb();
    for (const f of ['vector.db', 'vector.db-wal', 'vector.db-shm', '.vector-index.jsonl', '.vector-index.jsonl.migrated', 'BOOKMARKS.md']) {
      const p = join(mb, f);
      try { if (existsSync(p)) rmSync(p); } catch { /* ignore */ }
    }
  }

  async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    reset();
    try {
      await fn();
      record(name, true);
    } catch (err) {
      record(name, false, err instanceof Error ? err.message : String(err));
    }
  }

  // ─── sqlite-vector.ts layer (direct store, does not touch vector.ts) ───
  await test('sqlite-vector: dense KNN returns nearest neighbours by cosine', () => {
    store.upsertEntry({ id: 'a', text: 'cat', source: 'bookmark', timestamp: 't1', embeddingType: 'minimax', embedding: norm([1, 0, 0, 0]) });
    store.upsertEntry({ id: 'b', text: 'dog', source: 'bookmark', timestamp: 't2', embeddingType: 'minimax', embedding: norm([0, 1, 0, 0]) });
    store.upsertEntry({ id: 'c', text: 'kitten', source: 'bookmark', timestamp: 't3', embeddingType: 'minimax', embedding: norm([0.9, 0.15, 0, 0]) });
    const d = store.searchDense(norm([1, 0, 0, 0]), 2, 0.05);
    assert(d.length === 2, `expected 2 results, got ${d.length}`);
    assert(d[0].id === 'a' && d[1].id === 'c', `expected [a,c], got [${d.map((x) => x.id)}]`);
    assert(d[0].score > 0.99, `self-cosine ~1, got ${d[0].score}`);
  });

  await test('sqlite-vector: upsert by id is stable (no duplicate rowid)', () => {
    store.upsertEntry({ id: 'a', text: 'v1', source: 'bookmark', timestamp: 't1', embeddingType: 'minimax', embedding: norm([1, 0, 0, 0]) });
    store.upsertEntry({ id: 'a', text: 'v2', source: 'bookmark', timestamp: 't1', embeddingType: 'minimax', embedding: norm([1, 0, 0, 0]) });
    assert(store.count() === 1, `expected 1 entry, got ${store.count()}`);
    const d = store.searchDense(norm([1, 0, 0, 0]), 5, 0.05);
    assert(d.length === 1 && d[0].text === 'v2', `expected single updated row, got ${d.length}`);
  });

  await test('sqlite-vector: sparse roundtrips, stats and delete-by-source', () => {
    store.upsertEntry({ id: 'd1', text: 'dense', source: 'bookmark', timestamp: 't1', embeddingType: 'minimax', embedding: norm([1, 0, 0, 0]) });
    store.upsertEntry({ id: 's1', text: 'sparse', source: 'note', timestamp: 't2', embeddingType: 'tf', embedding: { cat: 1, pet: 2 } });
    const sp = store.readSparse();
    assert(sp.length === 1 && JSON.stringify(sp[0].embedding) === '{"cat":1,"pet":2}', 'sparse vector must roundtrip');
    const st = store.stats();
    assert(st.entries === 2 && st.types.minimax === 1 && st.types.tf === 1, `stats must count both types, got ${JSON.stringify(st.types)}`);
    store.deleteBySource('bookmark');
    assert(store.count() === 1, `delete left ${store.count()} entries`);
    assert(store.searchDense(norm([1, 0, 0, 0]), 5, 0.05).length === 0, 'dense rows must be gone after delete');
  });

  // ─── vector.ts layer — migration FIRST (one-time _migrated latch) ───
  await test('vector.ts: migrates a legacy JSONL index on first access', () => {
    writeFileSync(join(mb, '.vector-index.jsonl'),
      JSON.stringify({ id: 'old1', text: '旧记忆猫', source: 'bookmark', timestamp: 't0', embeddingType: 'tf', embedding: { 旧记: 1, 记忆: 1, 猫: 1 } }) + '\n');
    v.indexEntry({ id: 'n1', text: '我喜欢猫', source: 'note', timestamp: 't1' });
    assert(existsSync(join(mb, '.vector-index.jsonl.migrated')), 'legacy file must be renamed');
    assert(!existsSync(join(mb, '.vector-index.jsonl')), 'legacy file must be moved aside');
    assert(v.readIndex().some((e) => e.id === 'old1'), 'migrated entry must be present');
  });

  await test('vector.ts: TF index + sparse-path search + stats', async () => {
    v.indexEntry({ id: 'n1', text: '我喜欢猫和狗', source: 'note', timestamp: 't1' });
    v.indexEntry({ id: 'n2', text: '今天天气很好', source: 'note', timestamp: 't2' });
    const r = await v.search('猫', 5, 0.0);
    assert(r.some((x) => x.text.includes('猫')), 'TF search must find the 猫 entry');
    const st = v.indexStats();
    assert(st.entries === 2 && st.types.tf === 2, `stats: expected 2 tf entries, got ${JSON.stringify(st)}`);
  });

  await test('vector.ts: incremental reindex embeds only new bookmarks', async () => {
    writeFileSync(join(mb, 'BOOKMARKS.md'), '- <time=t1> 聊到旅行. 想去日本\n- <time=t2> 讨论工作. 很忙\n');
    assert((await v.reindexBookmarks()) === 2, 'first reindex embeds 2');
    assert((await v.reindexBookmarks()) === 2, 'second reindex is a no-op');
    writeFileSync(join(mb, 'BOOKMARKS.md'), '- <time=t1> 聊到旅行. 想去日本\n- <time=t2> 讨论工作. 很忙\n- <time=t3> 新内容. 增量\n');
    assert((await v.reindexBookmarks()) === 3, 'incremental reindex adds only the new one');
  });

  await test('vector.ts: dense entries stored + materialized as Float32Array', async () => {
    const prov = denseProvider({ '猫': [1, 0, 0, 0], '狗': [0, 1, 0, 0] });
    await v.indexEntryWithProvider({ id: 'd1', text: '猫', source: 'bookmark', timestamp: 't1' }, prov);
    await v.indexEntryWithProvider({ id: 'd2', text: '狗', source: 'bookmark', timestamp: 't2' }, prov);
    const d1 = v.readIndex().find((e) => e.id === 'd1');
    assert(d1 !== undefined && d1.embedding instanceof Float32Array, 'dense entry must materialize as Float32Array');
    assert(v.indexStats().types.minimax === 2, 'stats must report 2 minimax entries');
  });

  store.closeDb();
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} sqlite-vec tests passed\x1b[0m`);
    process.exit(0);
  } else {
    console.log(`\x1b[31m✘ ${total - passed}/${total} failed\x1b[0m`);
    process.exit(1);
  }
}

main();
