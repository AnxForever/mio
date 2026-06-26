/**
 * Mio — Memory Stream (Event Stream)
 *
 * Smallville-style append-only event log with three-dimensional retrieval.
 *
 * Storage: JSONL file (one event per line), append-only.
 * Retrieval: score = α·recency + β·importance + γ·relevance
 *
 * Relevance uses TF-IDF cosine similarity (no external vector DB needed
 * for single-user scale).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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

// ─── Retrieval weights ───

const RETRIEVAL_WEIGHTS = {
  recency: 0.4,
  importance: 0.3,
  relevance: 0.3,
};

const RECENCY_DECAY_PER_HOUR = 0.01; // 1% score decay per hour

// ─── TF-IDF helpers ───

/** Chinese word segmentation (simple character bigram) */
function tokenize(text: string): string[] {
  const cleaned = text.replace(/[^一-鿿\w]/g, ' ');
  const chars = cleaned.replace(/\s+/g, '').split('');
  const bigrams: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) {
    bigrams.push(chars[i] + chars[i + 1]);
  }
  // Also include single chars for short texts
  return [...bigrams, ...chars];
}

/** Compute TF vector from tokens */
function tfVector(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  // Normalize
  const total = tokens.length || 1;
  for (const [k, v] of tf) {
    tf.set(k, v / total);
  }
  return tf;
}

/** Cosine similarity between two TF vectors */
function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const [k, v] of a) {
    magA += v * v;
    dot += v * (b.get(k) || 0);
  }
  for (const [, v] of b) {
    magB += v * v;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─── Write ───

/** Generate a unique event id */
function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `evt_${ts}_${rand}`;
}

/** Append a life event to the memory stream */
export function appendEvent(
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
): LifeEvent {
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

  try {
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8');
  } catch (err) {
    logger.error('[memory-stream] failed to append event', { err: String(err) });
  }

  return event;
}

/** Compute default importance from emotional impact magnitude + category weight */
function computeDefaultImportance(
  impact: EmotionalImpact,
  category: LifeEventCategory,
): number {
  const magnitude =
    (Math.abs(impact.pleasure) + Math.abs(impact.arousal) + Math.abs(impact.dominance)) / 3;

  const categoryWeights: Record<LifeEventCategory, number> = {
    work: 0.4,
    social: 0.6,
    domestic: 0.3,
    health: 0.7,
    creative: 0.5,
    random: 0.4,
  };

  return Math.min(1, magnitude * 0.5 + (categoryWeights[category] || 0.4) * 0.5);
}

// ─── Read ───

/** Read all events from the memory stream */
export function readEvents(characterName: string): MemoryStreamEntry[] {
  const path = memoryStreamPath(characterName);
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, 'utf-8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as MemoryStreamEntry);
  } catch (err) {
    logger.error('[memory-stream] failed to read events', { err: String(err) });
    return [];
  }
}

/** Read the most recent N events */
export function readRecentEvents(characterName: string, count = 50): MemoryStreamEntry[] {
  const all = readEvents(characterName);
  return all.slice(-count).reverse();
}

// ─── Retrieve ───

/**
 * Retrieve the most relevant memories for a query.
 *
 * Smallville-style three-dimensional scoring:
 *   score = α·recency + β·importance + γ·relevance
 *
 * @param characterName  Character to search for
 * @param query          Current context (e.g. user message)
 * @param limit          Max results to return
 */
export function retrieveRelevantMemories(
  characterName: string,
  query: string,
  limit = 5,
): MemoryRetrievalResult[] {
  const events = readEvents(characterName);
  if (events.length === 0) return [];

  const now = Date.now();
  const queryTokens = tfVector(tokenize(query));

  const scored: MemoryRetrievalResult[] = events.map(entry => {
    // Recency: exponential decay by age
    const ageHours = (now - new Date(entry.timestamp).getTime()) / (1000 * 60 * 60);
    const recency = Math.exp(-RECENCY_DECAY_PER_HOUR * ageHours);

    // Importance: direct score
    const importance = entry.importance;

    // Relevance: TF cosine similarity
    const entryTokens = tfVector(tokenize(entry.description));
    const relevance = cosineSimilarity(queryTokens, entryTokens);

    // Combined score
    const score =
      RETRIEVAL_WEIGHTS.recency * recency +
      RETRIEVAL_WEIGHTS.importance * importance +
      RETRIEVAL_WEIGHTS.relevance * relevance;

    return {
      entry,
      score,
      dimensions: { recency, importance, relevance },
    };
  });

  // Sort by score descending, return top N
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

/**
 * Mark recent unacknowledged events as seen by the user.
 */
export function acknowledgeRecentEvents(characterName: string): number {
  const path = memoryStreamPath(characterName);
  if (!existsSync(path)) return 0;

  const events = readEvents(characterName);
  let count = 0;

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
      const { writeFileSync } = require('node:fs');
      writeFileSync(path, lines, 'utf-8');
    } catch (err) {
      logger.error('[memory-stream] failed to acknowledge events', { err: String(err) });
    }
  }

  return count;
}

// ─── Stats ───

/** Get basic stats about the memory stream */
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
