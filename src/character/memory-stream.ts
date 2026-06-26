/**
 * Mio — Memory Stream (Event Stream)
 *
 * Smallville-style append-only event log with three-dimensional retrieval.
 *
 * Storage: JSONL file (one event per line), append-only.
 * Retrieval: Smallville formula — normalized recency*0.5 + relevance*3 + importance*2
 *
 * Relevance: cosine similarity on embeddings from getEmbeddingProvider().
 * Falls back to TF-IDF if no API key (offline mode).
 *
 * Embeddings are stored alongside events (computed once at creation).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  LifeEvent,
  LifeEventType,
  LifeEventCategory,
  EmotionalImpact,
  MemoryStreamEntry,
  MemoryRetrievalResult,
} from './types.js';
import { memoryStreamPath } from './paths.js';
import { logger } from '../utils/logger.js';
import { getEmbeddingProvider } from '../memory/embedding.js';
import type { AnyVector } from '../memory/embedding.js';

// ─── Embedding helpers ───

/** Serialize an embedding vector for JSONL storage */
function serializeEmbedding(v: AnyVector): number[] | Record<string, number> {
  if (v instanceof Float32Array) {
    return Array.from(v);
  }
  return { ...v };
}

/** Deserialize an embedding from JSONL storage to runtime AnyVector */
function toRuntimeEmbedding(raw: number[] | Record<string, number> | undefined): AnyVector | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    return new Float32Array(raw);
  }
  const sparse: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number') sparse[k] = v;
  }
  return sparse;
}

// ─── Cosine similarity (delegates to existing vector.ts impl) ───

/**
 * Cosine similarity that handles both dense (MiniMax, L2-normalized) and
 * sparse (TF) vectors. Copied pattern from src/memory/vector.ts:similarity().
 */
function embeddingSimilarity(a: AnyVector | undefined, b: AnyVector | undefined): number {
  if (!a || !b) return 0;

  const aDense = a instanceof Float32Array;
  const bDense = b instanceof Float32Array;

  if (aDense && bDense) {
    // Both dense — dot product (MiniMax vectors are L2-normalized)
    const n = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < n; i++) dot += (a as Float32Array)[i] * (b as Float32Array)[i];
    return dot;
  }

  if (!aDense && !bDense) {
    // Both sparse — TF cosine
    const sa = a as Record<string, number>;
    const sb = b as Record<string, number>;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const [k, v] of Object.entries(sa)) {
      normA += v * v;
      if (sb[k] !== undefined) dot += v * sb[k];
    }
    for (const [, v] of Object.entries(sb)) {
      normB += v * v;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  return 0; // Mismatched types
}

// ─── Retrieval weights ───
//
// From the Smallville paper (retrieve.py):
//   score = rec*0.5 + rel*3 + imp*2
// gw = [0.5, 3, 2] — relevance dominates.

const GW = { recency: 0.5, relevance: 3, importance: 2 };
const RECENCY_DECAY = 0.99;

// ─── Write ───

function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `evt_${ts}_${rand}`;
}

/** Compute default importance from emotional impact magnitude + category weight */
function computeDefaultImportance(
  impact: EmotionalImpact,
  category: LifeEventCategory,
): number {
  const magnitude =
    (Math.abs(impact.pleasure) + Math.abs(impact.arousal) + Math.abs(impact.dominance)) / 3;

  const categoryWeights: Record<LifeEventCategory, number> = {
    work: 0.4, social: 0.6, domestic: 0.3, health: 0.7, creative: 0.5, random: 0.4,
  };

  return Math.min(1, magnitude * 0.5 + (categoryWeights[category] || 0.4) * 0.5);
}

/**
 * Append a life event to the memory stream.
 * Computes embedding via the configured provider (MiniMax if API key set, TF fallback).
 */
export async function appendEvent(
  characterName: string,
  description: string,
  category: LifeEventCategory,
  emotionalImpact: EmotionalImpact,
  options: {
    type?: LifeEventType;
    importance?: number;
    tags?: string[];
    acknowledged?: boolean;
  } = {},
): Promise<LifeEvent> {
  const path = memoryStreamPath(characterName);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const event: LifeEvent = {
    id: generateEventId(),
    timestamp: new Date().toISOString(),
    type: options.type || 'life_event',
    category,
    description,
    emotionalImpact,
    importance: options.importance ?? computeDefaultImportance(emotionalImpact, category),
    tags: options.tags || [category],
    acknowledged: options.acknowledged ?? false,
  };

  // Compute embedding for relevance retrieval
  try {
    const provider = getEmbeddingProvider();
    const [vec] = await provider.embed([description]);
    const entry: MemoryStreamEntry = {
      ...event,
      embedding: serializeEmbedding(vec),
    };
    appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    // Embedding failed — still write the event without embedding
    logger.warn('[memory-stream] embedding failed, storing without', { err: String(err) });
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8');
  }

  return event;
}

// ─── Read ───

export function readEvents(characterName: string): MemoryStreamEntry[] {
  const path = memoryStreamPath(characterName);
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, 'utf-8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parsed = JSON.parse(line) as MemoryStreamEntry;
        return parsed;
      });
  } catch (err) {
    logger.error('[memory-stream] failed to read events', { err: String(err) });
    return [];
  }
}

export function readRecentEvents(characterName: string, count = 50): MemoryStreamEntry[] {
  const all = readEvents(characterName);
  return all.slice(-count).reverse();
}

// ─── Retrieve ───

function normalizeMap(map: Map<string, number>): Map<string, number> {
  const vals = [...map.values()];
  if (vals.length === 0) return map;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min;
  if (range === 0) {
    for (const k of map.keys()) map.set(k, 0.5);
    return map;
  }
  for (const [k, v] of map) {
    map.set(k, (v - min) / range);
  }
  return map;
}

export function retrieveRelevantMemories(
  characterName: string,
  query: string,
  limit = 5,
): MemoryRetrievalResult[] {
  const events = readEvents(characterName);
  if (events.length === 0) return [];

  const recencyRaw = new Map<string, number>();
  const importanceRaw = new Map<string, number>();
  const relevanceRaw = new Map<string, number>();

  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Compute query embedding once (sync approximation — we don't have the query
  // embedding pre-computed, so text similarity is used as fallback).
  // For a full MiniMax path, we'd need async retrieval. V1 keeps this sync
  // with TF fallback; embedding-based similarity compares stored event embeddings.
  const hasDenseEmbeddings = events.some(
    e => Array.isArray(e.embedding),
  );

  sorted.forEach((entry, idx) => {
    const key = entry.id;

    // Recency: exponential decay on reverse index position
    const reverseIdx = sorted.length - 1 - idx;
    recencyRaw.set(key, Math.pow(RECENCY_DECAY, reverseIdx));

    // Importance
    importanceRaw.set(key, entry.importance);

    // Relevance: embedding cosine if available, else text overlap
    if (hasDenseEmbeddings && entry.embedding) {
      const a = toRuntimeEmbedding(entry.embedding);
      const latestRaw = sorted[sorted.length - 1].embedding;
      const b = latestRaw ? toRuntimeEmbedding(latestRaw) : undefined;
      if (a && b) {
        const sim = embeddingSimilarity(a, b);
        relevanceRaw.set(key, Math.max(0, sim));
      } else {
        relevanceRaw.set(key, 0.5);
      }
    } else {
      // TF fallback: simple text overlap with query
      const qWords = new Set(query.replace(/[^一-鿿\w]/g, ' ').split(/\s+/).filter(w => w.length > 0));
      const eWords = new Set(entry.description.replace(/[^一-鿿\w]/g, ' ').split(/\s+/).filter(w => w.length > 0));
      let overlap = 0;
      for (const w of qWords) { if (eWords.has(w)) overlap++; }
      const relevance = qWords.size > 0 ? overlap / qWords.size : 0;
      relevanceRaw.set(key, relevance);
    }
  });

  const recencyNorm = normalizeMap(recencyRaw);
  const importanceNorm = normalizeMap(importanceRaw);
  const relevanceNorm = normalizeMap(relevanceRaw);

  const scored: MemoryRetrievalResult[] = events.map(entry => {
    const key = entry.id;
    const rec = recencyNorm.get(key) ?? 0;
    const rel = relevanceNorm.get(key) ?? 0;
    const imp = importanceNorm.get(key) ?? 0;
    const score = rec * GW.recency + rel * GW.relevance + imp * GW.importance;

    return {
      entry,
      score,
      dimensions: { recency: rec, importance: imp, relevance: rel },
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Get a context string suitable for prompt injection.
 */
export function getMemoryContext(characterName: string, query: string, limit = 5): string {
  const results = retrieveRelevantMemories(characterName, query, limit);
  if (results.length === 0) return '';

  const lines = results.map(r => {
    const e = r.entry;
    const mood = e.emotionalImpact.pleasure > 0 ? '心情好' :
                 e.emotionalImpact.pleasure < -0.1 ? '心情不好' : '情绪平稳';
    return `- ${e.description}（当时：${mood}）`;
  });

  return lines.join('\n');
}

// ─── Acknowledge ───

export function acknowledgeRecentEvents(characterName: string): number {
  const path = memoryStreamPath(characterName);
  if (!existsSync(path)) return 0;

  const events = readEvents(characterName);
  let count = 0;

  // Re-serialize with embeddings preserved
  const updated = events.map(e => {
    if (!e.acknowledged) {
      e.acknowledged = true;
      count++;
    }
    return e;
  });

  if (count > 0) {
    try {
      const lines = updated.map(e => JSON.stringify(e)).join('\n') + '\n';
      writeFileSync(path, lines, 'utf-8');
    } catch (err) {
      logger.error('[memory-stream] failed to acknowledge events', { err: String(err) });
    }
  }

  return count;
}

// ─── Stats ───

export function memoryStreamStats(characterName: string): {
  totalEvents: number;
  oldestEvent: string | null;
  newestEvent: string | null;
  unacknowledgedCount: number;
} {
  const events = readEvents(characterName);
  if (events.length === 0) {
    return { totalEvents: 0, oldestEvent: null, newestEvent: null, unacknowledgedCount: 0 };
  }

  return {
    totalEvents: events.length,
    oldestEvent: events[0].timestamp,
    newestEvent: events[events.length - 1].timestamp,
    unacknowledgedCount: events.filter(e => !e.acknowledged).length,
  };
}
