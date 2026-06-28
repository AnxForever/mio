import { createHash } from 'node:crypto';
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
  topic?: string;
}

export interface MemoryPatch {
  type?: MemoryItemType;
  content?: string;
  confidence?: number;
  enabled?: boolean;
  reviewStatus?: MemoryReviewItem['status'];
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

function toReviewItem(memory: StructuredMemory, entity: MemoryEntity): MemoryReviewItem {
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
    topic: findTopic(memory, entity),
  };
}

function recomputeDerived(memory: StructuredMemory): StructuredMemory {
  return mergeMemories(memory, createEmptyMemory());
}

export function listMemoryReviewItems(): MemoryReviewItem[] {
  const memory = loadMemory();
  return memory.entities
    .map((entity) => toReviewItem(memory, entity))
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
  const reviewStatus = patch.reviewStatus ?? target.reviewStatus;
  const updatedEntity: MemoryEntity = {
    ...target,
    type: patch.type ?? target.type,
    content: patch.content?.trim() ?? target.content,
    confidence: reviewStatus === 'confirmed' ? 1 : reviewStatus === 'ignored' ? 0 : patch.confidence ?? target.confidence,
    occurrences: reviewStatus === 'confirmed' ? Math.max(target.occurrences, 3) : target.occurrences,
    enabled: reviewStatus === 'ignored' ? false : patch.enabled ?? target.enabled ?? true,
    reviewStatus,
    reviewedAt: patch.reviewStatus ? now : target.reviewedAt,
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

  return toReviewItem(nextMemory, updatedEntity);
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
