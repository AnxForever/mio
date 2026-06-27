#!/usr/bin/env node
/**
 * U1 — incremental bookmark reindexing regression.
 *
 * reindexBookmarks() is triggered on every BOOKMARKS.md mtime change (~every
 * turn). It must therefore embed only *new* bookmark lines, not the full
 * history each call — except when the embedding provider changes, where the
 * stored vectors become incomparable and a full rebuild is required.
 *
 * Strategy: wrap the active provider's embed() to count how many texts get
 * embedded per reindex call, then assert:
 *   - first reindex of 2 bookmarks embeds 2
 *   - after appending 1, the next reindex embeds ONLY 1 (not 3)
 *   - a reindex with nothing new embeds 0
 *   - switching provider (tf → minimax) re-embeds ALL bookmarks
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(name, false, msg);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'mio-vec-inc-'));
process.env.MIO_DIR = dataDir;
delete process.env.MINIMAX_API_KEY;
delete process.env.MINIMAX_DISABLE;

/** Sum of the per-call batch sizes recorded so far. */
function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Minimal shape we cast a provider to when swapping its embed() for a spy. */
interface EmbedSpyable {
  embed: (texts: string[]) => Promise<unknown[]>;
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — vector incremental reindex tests\x1b[0m\n');

  const { reindexBookmarks } = await import('../dist/memory/vector.js');
  const { appendBookmark, ensureBankStructure } = await import('../dist/memory/bank.js');
  const { getEmbeddingProvider, resetEmbeddingProvider } = await import('../dist/memory/embedding.js');

  ensureBankStructure();
  resetEmbeddingProvider();

  // ── Spy on the TF provider's embed() to count embedded texts per reindex ──
  const tf = getEmbeddingProvider();
  assertEq(tf.type, 'tf', 'tf provider active by default');
  const origEmbed = tf.embed.bind(tf);
  const batches: number[] = [];
  (tf as unknown as EmbedSpyable).embed = async (texts: string[]) => {
    batches.push(texts.length);
    return origEmbed(texts);
  };

  // Two initial bookmarks (distinct timestamps → distinct ids).
  appendBookmark({ time: '2026-06-01 10:00 +0800', what: '聊到了猫', evidence: '用户家里养了一只橘猫' });
  appendBookmark({ time: '2026-06-02 10:00 +0800', what: '聊到了狗', evidence: '用户邻居有一只柴犬' });

  const firstCount = await reindexBookmarks();
  const embeddedFirst = sum(batches);

  await test('first reindex embeds both new bookmarks', () => {
    assertEq(embeddedFirst, 2, `embedded ${embeddedFirst}`);
    assert(firstCount >= 2, `index has ${firstCount} entries`);
  });

  // Append a third bookmark and reindex again.
  batches.length = 0;
  appendBookmark({ time: '2026-06-03 10:00 +0800', what: '聊到了兔子', evidence: '用户想养一只垂耳兔' });

  const secondCount = await reindexBookmarks();
  const embeddedSecond = sum(batches);

  await test('second reindex embeds ONLY the new bookmark (not the full history)', () => {
    assertEq(embeddedSecond, 1, `embedded ${embeddedSecond} (expected 1, not 3)`);
    assertEq(secondCount, firstCount + 1, `index grew by exactly 1 (${firstCount} → ${secondCount})`);
  });

  // Reindex with nothing new → no embedding work at all.
  batches.length = 0;
  const thirdCount = await reindexBookmarks();

  await test('reindex with no new bookmarks embeds nothing', () => {
    assertEq(sum(batches), 0, `embedded ${sum(batches)} (expected 0)`);
    assertEq(thirdCount, secondCount, `index size unchanged (${secondCount} → ${thirdCount})`);
  });

  // ── Provider switch (tf → minimax) forces a full rebuild ──
  process.env.MINIMAX_API_KEY = 'test-key-not-real';
  resetEmbeddingProvider();
  const mm = getEmbeddingProvider();
  assertEq(mm.type, 'minimax', 'switched to minimax provider');
  const mmBatches: number[] = [];
  (mm as unknown as EmbedSpyable).embed = async (texts: string[]) => {
    mmBatches.push(texts.length);
    // Fake dense vectors so we never hit the network.
    return texts.map(() => new Float32Array(8).fill(0.1));
  };

  try {
    const rebuiltCount = await reindexBookmarks();
    await test('provider switch triggers full rebuild (re-embeds ALL bookmarks)', () => {
      assertEq(sum(mmBatches), 3, `re-embedded ${sum(mmBatches)} (expected all 3)`);
      assert(rebuiltCount >= 3, `index has ${rebuiltCount} entries`);
    });
  } finally {
    delete process.env.MINIMAX_API_KEY;
    resetEmbeddingProvider();
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} incremental reindex tests passed\x1b[0m`);
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  } else {
    console.log(`\x1b[31m✘ ${total - passed}/${total} failed\x1b[0m`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('vector incremental runner crashed:', err);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
});
