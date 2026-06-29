import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PromptCtx, SemanticMemory } from '../types.js';
import { memoryUsefulnessTracePath } from './paths.js';
import { readStructuredMemoryFromDisk, type MemoryEntity } from './structured-memory.js';

export type MemoryUsefulnessKind = 'semantic' | 'structured';

export interface MemoryUsefulnessCandidate {
  id: string;
  kind: MemoryUsefulnessKind;
  source: string;
  content: string;
  timestamp?: string;
  score?: number;
  injected: boolean;
  provenance?: MemoryEntity['provenance'];
}

export interface MemoryUsefulnessTrace {
  timestamp: string;
  sessionId: string;
  userText: string;
  replyText: string;
  retrievedCount: number;
  injectedCount: number;
  mentionedCount: number;
  candidates: Array<MemoryUsefulnessCandidate & {
    mentionedInReply: boolean;
  }>;
}

export function collectMemoryUsefulnessCandidates(
  promptCtx: Pick<PromptCtx, 'semanticMemories' | 'isolatedMemory'>,
  systemPrompt: string,
): MemoryUsefulnessCandidate[] {
  if (promptCtx.isolatedMemory) return [];

  const candidates: MemoryUsefulnessCandidate[] = [];
  for (const memory of promptCtx.semanticMemories ?? []) {
    candidates.push(semanticCandidate(memory, systemPrompt));
  }

  const structured = readStructuredMemoryFromDisk();
  if (structured) {
    const seen = new Set<string>();
    const add = (entity: MemoryEntity, source: string): void => {
      if (!isPromptActiveEntity(entity)) return;
      const id = entityId(entity, source);
      if (seen.has(id)) return;
      seen.add(id);
      candidates.push({
        id,
        kind: 'structured',
        source,
        content: entity.content,
        timestamp: entity.lastSeen,
        injected: containsMemoryText(systemPrompt, entity.content),
        provenance: entity.provenance,
      });
    };

    for (const entity of structured.durableFacts.slice(0, 8)) add(entity, 'structured:durable');
    for (const topic of structured.topics.slice(0, 3)) {
      const active = topic.entities.filter(isPromptActiveEntity);
      if (active.length < 2) continue;
      for (const entity of active) add(entity, `structured:topic:${topic.topic}`);
    }
    const emotions = structured.entities
      .filter((entity) => isPromptActiveEntity(entity) && entity.type === 'emotion' && entity.confidence >= 0.5)
      .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
      .slice(0, 5);
    for (const entity of emotions) add(entity, 'structured:recent-emotion');
  }

  return candidates;
}

export function appendMemoryUsefulnessTrace(input: {
  sessionId: string;
  userText?: string;
  replyText: string;
  candidates: MemoryUsefulnessCandidate[];
}): MemoryUsefulnessTrace | null {
  if (input.candidates.length === 0) return null;
  const candidates = input.candidates.map((candidate) => ({
    ...candidate,
    mentionedInReply: containsMemoryText(input.replyText, candidate.content),
  }));
  const trace: MemoryUsefulnessTrace = {
    timestamp: new Date().toISOString(),
    sessionId: input.sessionId,
    userText: input.userText ?? '',
    replyText: input.replyText,
    retrievedCount: candidates.length,
    injectedCount: candidates.filter((candidate) => candidate.injected).length,
    mentionedCount: candidates.filter((candidate) => candidate.mentionedInReply).length,
    candidates,
  };
  const path = memoryUsefulnessTracePath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(trace) + '\n', 'utf-8');
  return trace;
}

function semanticCandidate(memory: SemanticMemory, systemPrompt: string): MemoryUsefulnessCandidate {
  return {
    id: `semantic:${hashText(`${memory.timestamp}\n${memory.text}`)}`,
    kind: 'semantic',
    source: 'vector',
    content: memory.text,
    timestamp: memory.timestamp,
    score: memory.score,
    injected: containsMemoryText(systemPrompt, memory.text),
  };
}

function isPromptActiveEntity(entity: MemoryEntity): boolean {
  return entity.enabled !== false
    && entity.reviewStatus !== 'ignored'
    && entity.reviewStatus !== 'wrong'
    && !entity.invalidatedAt;
}

function entityId(entity: MemoryEntity, source: string): string {
  return `structured:${hashText([
    source,
    entity.type,
    entity.content,
    entity.firstSeen,
    entity.source,
  ].join('\n'))}`;
}

function containsMemoryText(container: string, memoryText: string): boolean {
  const containerNorm = normalizeForMemoryMatch(container);
  const memoryNorm = normalizeForMemoryMatch(memoryText);
  if (!containerNorm || !memoryNorm) return false;
  if (containerNorm.includes(memoryNorm)) return true;

  const anchors = memoryAnchors(memoryNorm);
  return anchors.some((anchor) => anchor.length >= 2 && containerNorm.includes(anchor));
}

function memoryAnchors(text: string): string[] {
  const anchors = [
    stripUserFactPrefix(text),
    text.slice(0, 12),
    text.slice(Math.max(0, Math.floor(text.length / 2) - 6), Math.floor(text.length / 2) + 6),
    text.slice(-12),
  ].filter((anchor) => anchor.length > 0);
  if (text.length <= 12) anchors.push(text);
  return [...new Set(anchors)];
}

function stripUserFactPrefix(text: string): string {
  return text
    .replace(/^用户(最近|一直|明确)?/, '')
    .replace(/^(喜欢|偏好|爱|讨厌|不喜欢|想要|希望|觉得|有点)/, '');
}

function normalizeForMemoryMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}
