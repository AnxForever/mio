import { createHash } from 'node:crypto';
import {
  createEmptyMemory,
  readStructuredMemoryFromDisk,
  writeStructuredMemoryToDisk,
  type MemoryEntity,
  type StructuredMemory,
} from '../memory/structured-memory.js';

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
  status: 'confirmed' | 'inferred';
  durable: boolean;
  topic?: string;
}

export interface MemoryPatch {
  type?: MemoryItemType;
  content?: string;
  confidence?: number;
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
  return {
    id: memoryId(entity),
    type: entity.type,
    content: entity.content,
    confidence: entity.confidence,
    firstSeen: entity.firstSeen,
    lastSeen: entity.lastSeen,
    occurrences: entity.occurrences,
    source: entity.source,
    status: entity.confidence >= 0.8 || entity.occurrences >= 2 ? 'confirmed' : 'inferred',
    durable,
    topic: findTopic(memory, entity),
  };
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

export function updateMemoryReviewItem(id: string, patch: MemoryPatch): MemoryReviewItem | null {
  const memory = loadMemory();
  let updatedEntity: MemoryEntity | null = null;
  const now = new Date().toISOString();

  const updateOne = (entity: MemoryEntity): MemoryEntity => {
    updatedEntity = {
      ...entity,
      type: patch.type ?? entity.type,
      content: patch.content?.trim() ?? entity.content,
      confidence: patch.confidence ?? entity.confidence,
      lastSeen: now,
    };
    return updatedEntity;
  };

  const main = updateMatchingEntities(memory.entities, id, updateOne);
  if (!main.changed || !updatedEntity) return null;

  const durable = updateMatchingEntities(memory.durableFacts, id, updateOne);
  const topics = memory.topics.map((topic) => {
    const topicUpdate = updateMatchingEntities(topic.entities, id, updateOne);
    return topicUpdate.changed
      ? { ...topic, entities: topicUpdate.entities, dateRange: { ...topic.dateRange, end: now } }
      : topic;
  });

  const nextMemory: StructuredMemory = {
    ...memory,
    entities: main.entities,
    durableFacts: durable.entities,
    topics,
    updatedAt: now,
  };
  writeStructuredMemoryToDisk(nextMemory);
  return toReviewItem(nextMemory, updatedEntity);
}

export function deleteMemoryReviewItem(id: string): boolean {
  const memory = loadMemory();
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

  writeStructuredMemoryToDisk({
    ...memory,
    entities: main.entities,
    durableFacts: durable.entities,
    topics,
    updatedAt: new Date().toISOString(),
  });
  return true;
}
