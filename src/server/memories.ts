import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  createEmptyMemory,
  mergeMemories,
  readStructuredMemoryFromDisk,
  writeStructuredMemoryToDisk,
  type MemoryEntity,
  type StructuredMemory,
} from '../memory/structured-memory.js';
import {
  deleteEntriesMatchingText,
  indexEntryWithProvider,
  updateEntriesMatchingText,
} from '../memory/vector.js';
import { getEmbeddingProvider } from '../memory/embedding.js';
import {
  autoGenerateLoreEntries,
  removeLoreEntriesByContent,
  updateLoreEntriesByContent,
} from '../memory/lorebook.js';
import { memoryUsefulnessTracePath } from '../memory/paths.js';
import type { MemoryUsefulnessTrace } from '../memory/usefulness.js';

export type MemoryItemType = MemoryEntity['type'];

export interface MemoryReviewItem {
  id: string;
  type: MemoryItemType;
  content: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  source: string;
  enabled: boolean;
  provenance?: MemoryEntity['provenance'];
  status: 'confirmed' | 'inferred' | 'ignored';
  durable: boolean;
  pinned: boolean;
  pinnedAt?: string;
  topic?: string;
  usage?: MemoryUsageSummary;
}

export interface MemoryUsageSummary {
  retrievedCount: number;
  injectedCount: number;
  mentionedCount: number;
  lastRetrievedAt?: string;
  lastInjectedAt?: string;
  lastMentionedAt?: string;
  lastSessionId?: string;
}

export interface MemoryPatch {
  type?: MemoryItemType;
  content?: string;
  confidence?: number;
  enabled?: boolean;
  reviewStatus?: MemoryReviewItem['status'];
  pinned?: boolean;
}

function entitySignature(entity: MemoryEntity): string {
  return [
    entity.type,
    entity.content,
    entity.firstSeen,
    entity.lastSeen,
    entity.source,
  ].join('\u0000');
}

function memoryId(entity: MemoryEntity): string {
  return createHash('sha1').update(entitySignature(entity)).digest('hex').slice(0, 16);
}

function entityKey(entity: MemoryEntity): string {
  return [
    entity.type,
    entity.content,
    entity.firstSeen,
    entity.source,
  ].join('\u0000');
}

function loadMemory(): StructuredMemory {
  return readStructuredMemoryFromDisk() ?? createEmptyMemory();
}

function findTopic(memory: StructuredMemory, entity: MemoryEntity): string | undefined {
  const key = entityKey(entity);
  return memory.topics.find((topic) =>
    topic.entities.some((candidate) => entityKey(candidate) === key),
  )?.topic;
}

function toReviewItem(
  memory: StructuredMemory,
  entity: MemoryEntity,
  usageByContent: Map<string, MemoryUsageSummary>,
): MemoryReviewItem {
  const durable = memory.durableFacts.some((candidate) => entityKey(candidate) === entityKey(entity));
  const status = entity.reviewStatus
    ?? (entity.confidence >= 0.8 || entity.occurrences >= 2 ? 'confirmed' : 'inferred');
  return {
    id: memoryId(entity),
    type: entity.type,
    content: entity.content,
    confidence: entity.confidence,
    firstSeen: entity.firstSeen,
    lastSeen: entity.lastSeen,
    occurrences: entity.occurrences,
    source: entity.source,
    enabled: entity.enabled !== false && status !== 'ignored',
    provenance: entity.provenance,
    status,
    durable,
    pinned: entity.pinned === true,
    pinnedAt: entity.pinnedAt,
    topic: findTopic(memory, entity),
    usage: usageByContent.get(normalizeMemoryContent(entity.content)),
  };
}

function recomputeDerived(memory: StructuredMemory): StructuredMemory {
  return mergeMemories(memory, createEmptyMemory());
}

export function listMemoryReviewItems(): MemoryReviewItem[] {
  const memory = loadMemory();
  const usageByContent = readMemoryUsageSummaries();
  return memory.entities
    .map((entity) => toReviewItem(memory, entity, usageByContent))
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
}

function updateMatchingEntities(
  entities: MemoryEntity[],
  targetId: string,
  updater: (entity: MemoryEntity) => MemoryEntity | null,
): { entities: MemoryEntity[]; changed: boolean } {
  let changed = false;
  const next = entities.flatMap((entity) => {
    if (memoryId(entity) !== targetId) return [entity];
    changed = true;
    const updated = updater(entity);
    return updated ? [updated] : [];
  });
  return { entities: next, changed };
}

async function maybeIndexConfirmed(entity: MemoryEntity): Promise<void> {
  if (entity.reviewStatus !== 'confirmed') return;
  if (entity.enabled === false) return;
  await indexEntryWithProvider({
    id: `structured:${memoryId(entity)}`,
    text: entity.content,
    source: 'manual',
    timestamp: entity.reviewedAt ?? entity.lastSeen,
  }, getEmbeddingProvider());
}

export async function updateMemoryReviewItem(id: string, patch: MemoryPatch): Promise<MemoryReviewItem | null> {
  const memory = loadMemory();
  const now = new Date().toISOString();

  const target = memory.entities.find((entity) => memoryId(entity) === id);
  if (!target) return null;

  const oldContent = target.content;
  const reviewStatus = patch.pinned === true && patch.reviewStatus === undefined
    ? 'confirmed'
    : patch.reviewStatus ?? target.reviewStatus;
  const pinned = reviewStatus === 'ignored'
    ? false
    : patch.pinned ?? target.pinned ?? false;
  const updatedEntity: MemoryEntity = {
    ...target,
    type: patch.type ?? target.type,
    content: patch.content?.trim() ?? target.content,
    confidence: reviewStatus === 'confirmed' || pinned ? 1 : reviewStatus === 'ignored' ? 0 : patch.confidence ?? target.confidence,
    occurrences: reviewStatus === 'confirmed' || pinned ? Math.max(target.occurrences, 3) : target.occurrences,
    enabled: reviewStatus === 'ignored' ? false : patch.enabled ?? (patch.pinned === true ? true : target.enabled ?? true),
    reviewStatus,
    reviewedAt: patch.reviewStatus || patch.pinned === true ? now : target.reviewedAt,
    pinned,
    pinnedAt: pinned ? target.pinnedAt ?? now : undefined,
    lastSeen: now,
  };

  let nextMemory: StructuredMemory = {
    ...memory,
    entities: memory.entities.map((entity) => memoryId(entity) === id ? updatedEntity : entity),
    updatedAt: now,
  };
  nextMemory = recomputeDerived(nextMemory);
  writeStructuredMemoryToDisk(nextMemory);

  if (updatedEntity.content !== oldContent) {
    await updateEntriesMatchingText(oldContent, updatedEntity.content);
    updateLoreEntriesByContent(oldContent, updatedEntity.content);
  }

  if (updatedEntity.reviewStatus === 'ignored' || updatedEntity.enabled === false) {
    deleteEntriesMatchingText(updatedEntity.content);
    removeLoreEntriesByContent(updatedEntity.content);
  } else if (updatedEntity.reviewStatus === 'confirmed') {
    await maybeIndexConfirmed(updatedEntity);
    autoGenerateLoreEntries();
  }

  return toReviewItem(nextMemory, updatedEntity, readMemoryUsageSummaries());
}

export function deleteMemoryReviewItem(id: string): boolean {
  const memory = loadMemory();
  const target = memory.entities.find((entity) => memoryId(entity) === id);
  const main = updateMatchingEntities(memory.entities, id, () => null);
  if (!main.changed) return false;

  const durable = updateMatchingEntities(memory.durableFacts, id, () => null);
  const topics = memory.topics
    .map((topic) => {
      const topicUpdate = updateMatchingEntities(topic.entities, id, () => null);
      return topicUpdate.changed
        ? { ...topic, entities: topicUpdate.entities }
        : topic;
    })
    .filter((topic) => topic.entities.length > 0);

  const nextMemory = recomputeDerived({
    ...memory,
    entities: main.entities,
    durableFacts: durable.entities,
    topics,
    updatedAt: new Date().toISOString(),
  });
  writeStructuredMemoryToDisk(nextMemory);
  if (target) {
    deleteEntriesMatchingText(target.content);
    removeLoreEntriesByContent(target.content);
  }
  return true;
}

function readMemoryUsageSummaries(): Map<string, MemoryUsageSummary> {
  const path = memoryUsefulnessTracePath();
  const summaries = new Map<string, MemoryUsageSummary>();
  if (!existsSync(path)) return summaries;

  const lines = readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-500);

  for (const line of lines) {
    let trace: MemoryUsefulnessTrace;
    try {
      trace = JSON.parse(line) as MemoryUsefulnessTrace;
    } catch {
      continue;
    }
    if (!trace.timestamp || !Array.isArray(trace.candidates)) continue;
    for (const candidate of trace.candidates) {
      const key = normalizeMemoryContent(candidate.content);
      if (!key) continue;
      const current = summaries.get(key) ?? {
        retrievedCount: 0,
        injectedCount: 0,
        mentionedCount: 0,
      };
      current.retrievedCount += 1;
      current.lastRetrievedAt = newerIso(current.lastRetrievedAt, trace.timestamp);
      current.lastSessionId = trace.sessionId || current.lastSessionId;
      if (candidate.injected) {
        current.injectedCount += 1;
        current.lastInjectedAt = newerIso(current.lastInjectedAt, trace.timestamp);
      }
      if (candidate.mentionedInReply) {
        current.mentionedCount += 1;
        current.lastMentionedAt = newerIso(current.lastMentionedAt, trace.timestamp);
      }
      summaries.set(key, current);
    }
  }

  return summaries;
}

function normalizeMemoryContent(content: string): string {
  return content.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').trim();
}

function newerIso(a: string | undefined, b: string): string {
  if (!a) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}
