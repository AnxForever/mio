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
  const temporal = await import('../dist/memory/temporal-state.js');
  const { appendMemoryUsefulnessTrace } = await import('../dist/memory/usefulness.js');

  ensureBankStructure();
  resetEmbeddingProvider();

  await test('confirm promotes memory into durable facts, vector and lorebook', async () => {
    const content = '用户喜欢乌龙茶';
    writeStructuredMemoryToDisk(memoryWith(entity(content, {
      provenance: {
        sourceType: 'bookmark',
        sourceId: 'unit-source',
        observedAt: '2026-06-01T00:00:00.000Z',
        excerpt: '- <time=2026-06-01T00:00:00.000Z> 用户喜欢乌龙茶',
      },
    })));

    const item = memories.listMemoryReviewItems()[0];
    assert(item?.status === 'inferred', 'seed memory should start inferred');
    assert(item.enabled === true, 'seed memory should be enabled by default');
    assert(item.provenance?.sourceId === 'unit-source', 'review item should expose provenance');

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

  await test('mark wrong retains provenance but removes prompt-facing derived memory', async () => {
    const content = '用户喜欢错误抽取的甜咖啡';
    writeStructuredMemoryToDisk(memoryWith(entity(content, {
      reviewStatus: 'confirmed',
      confidence: 1,
      occurrences: 3,
      provenance: {
        sourceType: 'transcript',
        sourceId: 'unit-wrong-source',
        observedAt: '2026-06-01T00:00:00.000Z',
        excerpt: '用户说不喜欢甜咖啡，但抽取错了',
      },
    })));
    vector.indexEntry({ id: 'manual-wrong-coffee', text: `偏好: ${content}`, source: 'manual', timestamp: '2026-06-01T00:00:00.000Z' });
    lorebook.addLoreEntry({
      id: 'manual-wrong-coffee',
      triggers: ['甜咖啡'],
      content,
      category: 'preference',
      priority: 60,
      scanDepth: 5,
      cooldown: 3,
      permanent: false,
    });

    const item = memories.listMemoryReviewItems().find((candidate) => candidate.content === content);
    assert(item !== undefined, 'wrong target should be listed');

    const wrong = await memories.updateMemoryReviewItem(item.id, { reviewStatus: 'wrong' });
    assert(wrong?.status === 'wrong', 'mark wrong should return wrong status');
    assert(wrong.enabled === false, 'wrong item should be disabled from prompt-facing use');
    assert(wrong.confidence === 0, `wrong item confidence should be 0, got ${wrong.confidence}`);
    assert(wrong.pinned === false, 'wrong item should not remain pinned');
    assert(wrong.provenance?.sourceId === 'unit-wrong-source', 'wrong item should retain provenance');

    const stored = readStructuredMemoryFromDisk();
    assert(stored !== null, 'structured memory should exist');
    const storedWrong = stored.entities.find((e) => e.content === content);
    assert(storedWrong?.reviewStatus === 'wrong', 'wrong entity should remain in entities with wrong status');
    assert(storedWrong.enabled === false, 'wrong entity should be stored as disabled');
    assert(storedWrong.provenance?.sourceId === 'unit-wrong-source', 'wrong entity should preserve provenance');
    assert(!stored.durableFacts.some((e) => e.content === content), 'wrong entity should leave durable facts');
    assert(!stored.topics.some((t) => t.entities.some((e) => e.content === content)), 'wrong entity should leave topics');
    assert(!memoryToContext(stored).includes(content), 'wrong entity should not enter prompt context');
    assert(!vector.readIndex().some((e) => e.text.includes(content)), 'wrong entity should be removed from vector index');
    assert(!lorebook.getLorebook().entries.some((e) => e.content === content), 'wrong entity should be removed from lorebook');
  });

  await test('disable keeps memory reviewable but removes it from prompt-facing context', async () => {
    const content = '用户喜欢普洱茶';
    writeStructuredMemoryToDisk(memoryWith(entity(content, { reviewStatus: 'confirmed', confidence: 1, occurrences: 3 })));
    vector.indexEntry({ id: 'manual-puer', text: `偏好: ${content}`, source: 'manual', timestamp: '2026-06-01T00:00:00.000Z' });
    lorebook.addLoreEntry({
      id: 'manual-puer',
      triggers: ['普洱茶'],
      content,
      category: 'preference',
      priority: 60,
      scanDepth: 5,
      cooldown: 3,
      permanent: false,
    });

    const item = memories.listMemoryReviewItems().find((candidate) => candidate.content === content);
    assert(item !== undefined, 'disable target should be listed');

    const disabled = await memories.updateMemoryReviewItem(item.id, { enabled: false });
    assert(disabled?.enabled === false, 'disabled item should report enabled=false');

    const stored = readStructuredMemoryFromDisk();
    assert(stored !== null, 'structured memory should exist');
    assert(stored.entities.some((e) => e.content === content && e.enabled === false), 'disabled entity should remain stored');
    assert(!memoryToContext(stored).includes(content), 'disabled entity should not enter prompt context');
    assert(!vector.readIndex().some((e) => e.text.includes(content)), 'disabled entity should be removed from vector index');
    assert(!lorebook.getLorebook().entries.some((e) => e.content === content), 'disabled entity should be removed from lorebook');
  });

  await test('review items expose recent memory usage trace', () => {
    const content = '用户喜欢铁观音';
    writeStructuredMemoryToDisk(memoryWith(entity(content, { reviewStatus: 'confirmed', confidence: 1, occurrences: 3 })));
    const trace = appendMemoryUsefulnessTrace({
      sessionId: 'unit-memory-usage',
      userText: '喝什么',
      replyText: '给你泡铁观音吧。',
      candidates: [{
        id: 'structured:test-usage',
        kind: 'structured',
        source: 'structured:durable',
        content,
        timestamp: '2026-06-01T00:00:00.000Z',
        injected: true,
      }],
    });
    assert(trace !== null, 'usage trace should be written');

    const item = memories.listMemoryReviewItems('unit-memory-usage').find((candidate) => candidate.content === content);
    assert(item !== undefined, 'usage target should be listed');
    assert(item.usage?.retrievedCount === 1, `retrieved count should be 1, got ${item.usage?.retrievedCount}`);
    assert(item.usage.injectedCount === 1, `injected count should be 1, got ${item.usage.injectedCount}`);
    assert(item.usage.mentionedCount === 1, `mentioned count should be 1, got ${item.usage.mentionedCount}`);
    assert(item.usage.lastSessionId === 'unit-memory-usage', 'usage should expose last session id');
    assert(typeof item.usage.lastMentionedAt === 'string', 'usage should expose last mentioned timestamp');
    assert(item.usage.latestReplySessionId === 'unit-memory-usage', 'usage should expose latest reply session id');
    assert(item.usage.retrievedInLatestReply === true, 'usage should mark latest reply retrieval');
    assert(item.usage.injectedInLatestReply === true, 'usage should mark latest reply prompt injection');
    assert(item.usage.mentionedInLatestReply === true, 'usage should mark latest reply mention');
    assert(item.usage.usedInLatestReply === true, 'usage should mark latest reply use');

    const withoutSession = memories.listMemoryReviewItems().find((candidate) => candidate.content === content);
    assert(withoutSession?.usage?.latestReplySessionId === undefined, 'global review should not pretend a latest session reply');
  });

  await test('memory review exposes current, resolved and expired temporal states', () => {
    const sessionId = 'openai-memory-review-temporal_im_wechat-1';
    temporal.updateTemporalStateForTurn(sessionId, '我还在忙着优化你', new Date('2026-06-28T10:00:00.000Z'));
    let review = memories.listTemporalStateReview(sessionId, new Date('2026-06-28T10:30:00.000Z'));
    assert(review.sessionId === sessionId, 'temporal review should preserve session id');
    assert(review.current.some((item) => item.kind === 'busy'), 'active busy state should be visible in memory review');
    assert(review.current.some((item) => item.status === 'current' && item.evidence.includes('忙着优化你')), 'current state should expose evidence');
    assert(review.current.some((item) => item.sourceSessionId === sessionId), 'current state should expose source session id');

    temporal.updateTemporalStateForTurn(sessionId, '忙完了，来聊', new Date('2026-06-28T11:00:00.000Z'));
    review = memories.listTemporalStateReview(sessionId, new Date('2026-06-28T11:10:00.000Z'));
    assert(!review.current.some((item) => item.kind === 'busy'), 'resolved busy state should no longer be current');
    assert(review.recentlyResolved.some((item) => item.kind === 'busy' && item.resolutionReason === 'explicit_user_resolution'), 'resolved state should expose resolution reason');
    assert(review.recentlyResolved.some((item) => item.kind === 'busy' && typeof item.resolutionEventId === 'string'), 'resolved state should expose resolution event id');

    temporal.updateTemporalStateForTurn(sessionId, '好困，先睡了', new Date('2026-06-28T23:00:00.000Z'));
    review = memories.listTemporalStateReview(sessionId, new Date('2026-06-29T15:00:00.000Z'));
    assert(review.recentlyExpired.some((item) => item.kind === 'sleepy' || item.kind === 'going_to_sleep'), 'expired sleep state should be visible as recently expired');
  });

  await test('structured state review separates current facts, arcs, recent events and emotions', async () => {
    const pinned = entity('用户重要边界：不喜欢被要求报备定位', {
      type: 'fact',
      reviewStatus: 'confirmed',
      confidence: 1,
      occurrences: 3,
      pinned: true,
      pinnedAt: '2026-06-28T08:00:00.000Z',
      firstSeen: '2026-06-28T08:00:00.000Z',
      lastSeen: '2026-06-28T08:00:00.000Z',
      provenance: {
        sourceType: 'transcript',
        sourceId: 'structured-state-pinned',
        observedAt: '2026-06-28T08:00:00.000Z',
        excerpt: '不要让我报备定位',
      },
    });
    const currentFact = entity('用户目前在上海工作', {
      type: 'fact',
      reviewStatus: 'confirmed',
      confidence: 1,
      occurrences: 3,
      firstSeen: '2026-06-28T09:00:00.000Z',
      lastSeen: '2026-06-28T09:00:00.000Z',
      provenance: {
        sourceType: 'transcript',
        sourceId: 'structured-state-current',
        observedAt: '2026-06-28T09:00:00.000Z',
        excerpt: '我现在在上海工作',
      },
    });
    const arcStart = entity('用户开始优化 Mio 微信回复', {
      type: 'event',
      confidence: 0.9,
      occurrences: 1,
      firstSeen: '2026-06-27T10:00:00.000Z',
      lastSeen: '2026-06-27T10:00:00.000Z',
    });
    const arcNext = entity('用户继续调试 Mio 时间感知', {
      type: 'decision',
      confidence: 0.9,
      occurrences: 1,
      firstSeen: '2026-06-29T10:00:00.000Z',
      lastSeen: '2026-06-29T10:00:00.000Z',
      provenance: {
        sourceType: 'transcript',
        sourceId: 'structured-state-arc',
        observedAt: '2026-06-29T10:00:00.000Z',
        excerpt: '继续优化时间感知',
      },
    });
    const recentEvent = entity('用户今天要测试最新微信效果', {
      type: 'intention',
      confidence: 0.8,
      firstSeen: '2026-06-29T12:00:00.000Z',
      lastSeen: '2026-06-29T12:00:00.000Z',
    });
    const recentEmotion = entity('用户对 Mio 回复感到困惑', {
      type: 'emotion',
      confidence: 0.8,
      firstSeen: '2026-06-29T13:00:00.000Z',
      lastSeen: '2026-06-29T13:00:00.000Z',
    });
    const disabled = entity('用户喜欢错误记忆', {
      type: 'fact',
      reviewStatus: 'confirmed',
      enabled: false,
      confidence: 1,
      occurrences: 3,
    });
    const wrong = entity('用户仍然在北京工作', {
      type: 'fact',
      reviewStatus: 'wrong',
      confidence: 0,
      enabled: false,
    });
    const invalidated = entity('用户目前在杭州工作', {
      type: 'fact',
      reviewStatus: 'confirmed',
      confidence: 1,
      occurrences: 3,
      invalidatedAt: '2026-06-28T09:00:00.000Z',
      supersededBy: currentFact.content,
    });

    writeStructuredMemoryToDisk({
      entities: [pinned, currentFact, arcStart, arcNext, recentEvent, recentEmotion, disabled, wrong, invalidated],
      durableFacts: [pinned, currentFact, disabled, wrong, invalidated],
      topics: [{
        topic: 'Mio 优化',
        entities: [arcStart, arcNext],
        summary: '用户跨多日优化 Mio 的微信回复和时间感知。',
        dateRange: { start: '2026-06-27T10:00:00.000Z', end: '2026-06-29T10:00:00.000Z' },
      }],
      updatedAt: '2026-06-29T13:00:00.000Z',
    });

    const review = memories.getStructuredStateReview(new Date('2026-06-29T14:00:00.000Z'));
    assert(review.counts.pinned === 1, `pinned count should be 1, got ${review.counts.pinned}`);
    assert(review.counts.currentFacts === 1, `current fact count should be 1, got ${review.counts.currentFacts}`);
    assert(review.counts.multiDayArcs === 1, `multi-day arc count should be 1, got ${review.counts.multiDayArcs}`);
    assert(review.counts.recentEvents === 1, `recent event count should be 1, got ${review.counts.recentEvents}`);
    assert(review.counts.recentEmotions === 1, `recent emotion count should be 1, got ${review.counts.recentEmotions}`);
    assert(review.counts.superseded === 1, `superseded count should be 1, got ${review.counts.superseded}`);
    assert(review.pinned[0]?.provenance?.sourceId === 'structured-state-pinned', 'pinned memory should preserve provenance');
    assert(review.currentFacts[0]?.content === currentFact.content, 'current facts should expose the active latest fact');
    assert(review.currentFacts[0]?.provenance?.sourceId === 'structured-state-current', 'current fact should preserve provenance');
    assert(review.multiDayArcs[0]?.topic === 'Mio 优化', 'multi-day arc should expose topic');
    assert(review.multiDayArcs[0]?.entities.some((item) => item.provenance?.sourceId === 'structured-state-arc'), 'multi-day arc should preserve entity provenance');
    const allContent = JSON.stringify(review);
    assert(!allContent.includes(disabled.content), 'disabled memory should not appear in structured state review');
    assert(!allContent.includes(wrong.content), 'wrong memory should not appear in structured state review');
    assert(!JSON.stringify(review.currentFacts).includes(invalidated.content), 'invalidated memory should not appear in current facts');
    assert(review.superseded[0]?.content === invalidated.content, 'invalidated memory should appear in superseded audit view');
    assert(review.superseded[0]?.supersededBy === currentFact.content, 'superseded memory should expose replacement content');
    assert(review.superseded[0]?.invalidatedAt === invalidated.invalidatedAt, 'superseded memory should expose invalidation timestamp');

    const disabledCurrent = await memories.updateMemoryReviewItem(review.currentFacts[0]?.id || '', { enabled: false });
    assert(disabledCurrent?.enabled === false, 'structured state review id should support existing memory governance patch');
    const afterDisable = memories.getStructuredStateReview(new Date('2026-06-29T14:00:00.000Z'));
    assert(!JSON.stringify(afterDisable.currentFacts).includes(currentFact.content), 'disabled current fact should leave current facts');
    assert(!JSON.stringify(afterDisable.pinned).includes(currentFact.content), 'disabled current fact should leave pinned facts');
    assert(!JSON.stringify(afterDisable.recentEvents).includes(currentFact.content), 'disabled current fact should leave recent events');
    assert(!JSON.stringify(afterDisable.recentEmotions).includes(currentFact.content), 'disabled current fact should leave recent emotions');
  });

  await test('pin promotes a memory into priority prompt context', async () => {
    const content = '用户重要边界：不喜欢被要求报备定位';
    const other = '用户喜欢拿铁';
    writeStructuredMemoryToDisk({
      entities: [
        entity(other, { reviewStatus: 'confirmed', confidence: 1, occurrences: 3 }),
        entity(content, { type: 'fact', confidence: 0.5, occurrences: 1 }),
      ],
      topics: [],
      durableFacts: [],
      updatedAt: '2026-06-01T00:00:00.000Z',
    });

    const item = memories.listMemoryReviewItems().find((candidate) => candidate.content === content);
    assert(item !== undefined, 'pin target should be listed');
    assert(item.pinned === false, 'seed memory should not start pinned');

    const pinned = await memories.updateMemoryReviewItem(item.id, { pinned: true });
    assert(pinned?.pinned === true, 'pin should return pinned=true');
    assert(pinned.status === 'confirmed', 'pin should confirm the memory');
    assert(pinned.enabled === true, 'pin should keep memory enabled');

    const stored = readStructuredMemoryFromDisk();
    assert(stored !== null, 'structured memory should exist');
    const storedPinned = stored.entities.find((candidate) => candidate.content === content);
    assert(storedPinned?.pinned === true, 'stored entity should be pinned');
    assert(typeof storedPinned.pinnedAt === 'string', 'stored entity should record pinnedAt');
    assert(stored.durableFacts.some((candidate) => candidate.content === content), 'pinned entity should be durable');

    const context = memoryToContext(stored);
    assert(context.includes('## 固定记忆'), 'prompt context should include pinned section');
    assert(context.indexOf(content) >= 0, 'prompt context should include pinned content');
    assert(context.indexOf(content) < context.indexOf(other), 'pinned content should render before normal confirmed facts');
  });

  await test('unpin removes fixed status without deleting memory', async () => {
    const content = '用户重要边界：不喜欢被要求报备定位';
    const item = memories.listMemoryReviewItems().find((candidate) => candidate.content === content);
    assert(item !== undefined, 'unpin target should be listed');

    const unpinned = await memories.updateMemoryReviewItem(item.id, { pinned: false });
    assert(unpinned?.pinned === false, 'unpin should return pinned=false');

    const stored = readStructuredMemoryFromDisk();
    assert(stored !== null, 'structured memory should exist');
    const storedEntity = stored.entities.find((candidate) => candidate.content === content);
    assert(storedEntity !== undefined, 'unpinned entity should remain stored');
    assert(storedEntity.pinned !== true, 'stored entity should no longer be pinned');
    assert(storedEntity.pinnedAt === undefined, 'stored entity should clear pinnedAt');
    assert(!memoryToContext(stored).includes('## 固定记忆'), 'prompt context should not include pinned section after unpin');
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
