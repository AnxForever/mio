#!/usr/bin/env node
/**
 * Memory review synchronization tests.
 *
 * Covers the /memories service layer without starting HTTP:
 * - confirm promotes structured memory into durable/topics/vector/lorebook
 * - ignore keeps the review record but removes prompt-facing derived state
 * - edit propagates content into vector/lorebook derived entries
 * - delete removes the memory and matching derived entries
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryEntity, StructuredMemory } from '../dist/memory/structured-memory.js';

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

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'mio-memory-review-'));
process.env.MIO_DIR = dataDir;
process.env.MIO_PROVIDER = 'mock';
process.env.MINIMAX_DISABLE = 'true';
delete process.env.MINIMAX_API_KEY;

function entity(content: string, patch: Partial<MemoryEntity> = {}): MemoryEntity {
  return {
    type: 'preference',
    content,
    confidence: 0.6,
    firstSeen: '2026-06-01T00:00:00.000Z',
    lastSeen: '2026-06-01T00:00:00.000Z',
    occurrences: 1,
    source: 'unit-test',
    ...patch,
  };
}

function memoryWith(entry: MemoryEntity): StructuredMemory {
  return {
    entities: [entry],
    topics: [],
    durableFacts: [],
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — memory review sync tests\x1b[0m\n');

  const { ensureBankStructure } = await import('../dist/memory/bank.js');
  const {
    readStructuredMemoryFromDisk,
    writeStructuredMemoryToDisk,
    memoryToContext,
  } = await import('../dist/memory/structured-memory.js');
  const { resetEmbeddingProvider } = await import('../dist/memory/embedding.js');
  const vector = await import('../dist/memory/vector.js');
  const sqlite = await import('../dist/memory/sqlite-vector.js');
  const lorebook = await import('../dist/memory/lorebook.js');
  const memories = await import('../dist/server/memories.js');

  ensureBankStructure();
  resetEmbeddingProvider();

  await test('confirm promotes memory into durable facts, vector and lorebook', async () => {
    const content = '用户喜欢乌龙茶';
    writeStructuredMemoryToDisk(memoryWith(entity(content)));

    const item = memories.listMemoryReviewItems()[0];
    assert(item?.status === 'inferred', 'seed memory should start inferred');

    const confirmed = await memories.updateMemoryReviewItem(item.id, { reviewStatus: 'confirmed' });
    assert(confirmed?.status === 'confirmed', 'confirm should return confirmed status');
    assert(confirmed.confidence === 1, `confidence should be 1, got ${confirmed.confidence}`);
    assert(confirmed.occurrences >= 3, `occurrences should be >=3, got ${confirmed.occurrences}`);

    const stored = readStructuredMemoryFromDisk();
    assert(stored !== null, 'structured memory should exist');
    assert(stored.entities.some((e) => e.content === content && e.reviewStatus === 'confirmed'), 'entity should be stored as confirmed');
    assert(stored.durableFacts.some((e) => e.content === content), 'confirmed entity should be durable');
    assert(stored.topics.some((t) => t.entities.some((e) => e.content === content)), 'confirmed entity should be topic-clustered');
    assert(vector.readIndex().some((e) => e.id === `structured:${confirmed.id}` && e.text === content), 'confirmed entity should be indexed');
    assert(lorebook.getLorebook().entries.some((e) => e.content === content), 'confirmed entity should generate a lorebook entry');
  });

  await test('ignore retains review record but removes prompt-facing derived memory', async () => {
    const content = '用户喜欢乌龙茶';
    const current = memories.listMemoryReviewItems().find((item) => item.content === content);
    assert(current !== undefined, 'confirmed memory should still be reviewable');

    const ignored = await memories.updateMemoryReviewItem(current.id, { reviewStatus: 'ignored' });
    assert(ignored?.status === 'ignored', 'ignore should return ignored status');

    const stored = readStructuredMemoryFromDisk();
    assert(stored !== null, 'structured memory should exist');
    assert(stored.entities.some((e) => e.content === content && e.reviewStatus === 'ignored'), 'ignored entity should remain in entities');
    assert(!stored.durableFacts.some((e) => e.content === content), 'ignored entity should leave durable facts');
    assert(!stored.topics.some((t) => t.entities.some((e) => e.content === content)), 'ignored entity should leave topics');
    assert(!memoryToContext(stored).includes(content), 'ignored entity should not enter prompt context');
    assert(!vector.readIndex().some((e) => e.text.includes(content)), 'ignored entity should be removed from vector index');
    assert(!lorebook.getLorebook().entries.some((e) => e.content === content), 'ignored entity should be removed from lorebook');
  });

  await test('edit propagates content changes into vector and lorebook entries', async () => {
    const oldContent = '用户喜欢红茶';
    const newContent = '用户喜欢茉莉茶';
    writeStructuredMemoryToDisk(memoryWith(entity(oldContent)));
    vector.indexEntry({ id: 'manual:red-tea', text: `偏好: ${oldContent}`, source: 'manual', timestamp: '2026-06-01T00:00:00.000Z' });
    lorebook.addLoreEntry({
      id: 'manual-red-tea',
      triggers: ['红茶'],
      content: oldContent,
      category: 'preference',
      priority: 60,
      scanDepth: 5,
      cooldown: 3,
      permanent: false,
    });

    const item = memories.listMemoryReviewItems().find((candidate) => candidate.content === oldContent);
    assert(item !== undefined, 'editable memory should be listed');
    await memories.updateMemoryReviewItem(item.id, { content: newContent });

    const stored = readStructuredMemoryFromDisk();
    assert(stored !== null, 'structured memory should exist');
    assert(stored.entities.some((e) => e.content === newContent), 'structured entity should use new content');
    assert(!stored.entities.some((e) => e.content === oldContent), 'old structured content should be gone');
    assert(vector.readIndex().some((e) => e.text.includes(newContent)), 'vector entry should contain new content');
    assert(!vector.readIndex().some((e) => e.text.includes(oldContent)), 'vector entry should not contain old content');
    assert(lorebook.getLorebook().entries.some((e) => e.content === newContent), 'lorebook entry should contain new content');
    assert(!lorebook.getLorebook().entries.some((e) => e.content === oldContent), 'lorebook entry should not contain old content');
  });

  await test('delete removes structured memory plus matching vector and lorebook entries', () => {
    const content = '用户喜欢茉莉茶';
    const item = memories.listMemoryReviewItems().find((candidate) => candidate.content === content);
    assert(item !== undefined, 'deletable memory should be listed');

    const deleted = memories.deleteMemoryReviewItem(item.id);
    assert(deleted, 'delete should return true');

    const stored = readStructuredMemoryFromDisk();
    assert(stored !== null, 'structured memory should exist');
    assert(!stored.entities.some((e) => e.content === content), 'structured entity should be deleted');
    assert(!stored.durableFacts.some((e) => e.content === content), 'durable fact should be deleted');
    assert(!stored.topics.some((t) => t.entities.some((e) => e.content === content)), 'topic entry should be deleted');
    assert(!vector.readIndex().some((e) => e.text.includes(content)), 'matching vector entry should be deleted');
    assert(!lorebook.getLorebook().entries.some((e) => e.content === content), 'matching lorebook entry should be deleted');
  });

  sqlite.closeDb();
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} memory review tests passed\x1b[0m`);
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  }

  console.log(`\x1b[31m✘ ${total - passed}/${total} failed\x1b[0m`);
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  - ${r.name}: ${r.detail}`);
  }
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(1);
}

main().catch((err) => {
  console.error('memory review runner crashed:', err);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
});
