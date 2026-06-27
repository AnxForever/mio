/**
 * Mio — Hybrid Search (keyword + semantic + RRF fusion)
 *
 * Replaces plain grep-based memory retrieval with a hybrid approach:
 *
 *   1. Keyword search — substring matching across transcripts + memory bank
 *   2. Semantic search — TF sparse vector cosine similarity (from embedding.ts)
 *   3. RRF fusion — Reciprocal Rank Fusion to merge both result sets
 *   4. Time decay — newer results score higher via exponential decay
 *
 * Zero new dependencies — uses existing tokenizer from vector.ts
 * and embedding provider from embedding.ts.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { transcriptsDir } from './paths.js';
import { readIndex, type MaterializedEntry } from './vector.js';
import { getEmbeddingProvider } from './embedding.js';
import { memoryBankDir } from './paths.js';
import { bankFilePath, readFileSyncSafe } from './bank.js';
import { transcriptVisibleInScope, type MemorySearchScope } from './scope.js';

// ─── Types ───

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  source: string;
  timestamp: string;
  role?: 'user' | 'assistant';
}

export interface HybridSearchOptions {
  query: string;
  maxResults?: number;
  minScore?: number;
  searchTranscripts?: boolean;
  searchMemory?: boolean;
  role?: 'user' | 'assistant';
  scope?: MemorySearchScope;
}

// ─── Constants ───

const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MIN_SCORE = 0.5;

// RRF constants
const RRF_K = 60;

// Score weights
const KEYWORD_MATCH_SCORE = 10;
const EXACT_PHRASE_SCORE = 50;
const SEMANTIC_MIN_SCORE = 0.5;
const SEMANTIC_BONUS = 20;

// Time decay: 1% per day
const TIME_DECAY_RATE = 0.01;

// ─── Internal helpers ───

/**
 * Parse a timestamp string into a Date.
 * Supports ISO 8601, "YYYY-MM-DD HH:MM +TZ", and unix epoch strings.
 */
function parseTimestamp(ts: string): Date {
  // Try ISO first
  const d = new Date(ts);
  if (!isNaN(d.getTime())) return d;

  // Try "YYYY-MM-DD HH:MM +TZ" format used by bookmarks
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/);
  if (m) {
    const d2 = new Date(`${m[1]}T${m[2]}:00`);
    if (!isNaN(d2.getTime())) return d2;
  }

  // Fallback: try as epoch ms
  const epoch = Number(ts);
  if (!isNaN(epoch) && epoch > 1e10) return new Date(epoch);

  return new Date(0); // unknown
}

/**
 * Compute time decay factor: 1 for brand new, approaches 0 for very old.
 * Uses exponential decay: exp(-rate * daysElapsed)
 */
function timeDecay(timestamp: string, now: Date = new Date()): number {
  const ts = parseTimestamp(timestamp);
  const days = (now.getTime() - ts.getTime()) / 86_400_000;
  if (days <= 0) return 1;
  return Math.exp(-TIME_DECAY_RATE * days);
}

/**
 * Simple inline tokenizer (Chinese + English).
 */
function inlineTokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();

  // English tokens
  const enTokens = lower
    .replace(/[一-鿿]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  tokens.push(...enTokens);

  // Chinese bigrams + unigrams
  const cjk = lower.replace(/[^一-鿿]/g, '');
  for (let i = 0; i < cjk.length - 1; i++) {
    tokens.push(cjk.slice(i, i + 2));
  }
  for (const ch of cjk) {
    tokens.push(ch);
  }

  return tokens;
}

/**
 * Cosine similarity between two sparse term-frequency vectors.
 */
function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  for (const k of Object.keys(a)) {
    if (b[k] !== undefined) dot += a[k] * b[k];
  }
  const normA = Math.sqrt(Object.values(a).reduce((s, x) => s + x * x, 0));
  const normB = Math.sqrt(Object.values(b).reduce((s, x) => s + x * x, 0));
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

// ─── Keyword search over memory bank files ───

interface ScoredMatch {
  id: string;
  content: string;
  score: number;
  source: string;
  timestamp: string;
  role?: 'user' | 'assistant';
}

/**
 * Search memory bank files for keyword matches.
 * Scans BOOKMARKS.md and any notes/*.md files.
 */
function keywordSearchMemory(query: string): ScoredMatch[] {
  const results: ScoredMatch[] = [];
  const qLower = query.toLowerCase();
  const terms = qLower.split(/\s+/).filter((w) => w.length > 0);

  // Search BOOKMARKS.md
  const bookmarks = readFileSyncSafe(bankFilePath('BOOKMARKS.md'));
  if (bookmarks) {
    const lines = bookmarks.split('\n');
    for (const line of lines) {
      const m = line.match(/^- <time=([^>]+)>\s+(.*)$/);
      if (!m) continue;
      const timestamp = m[1];
      const content = m[2];
      const score = scoreKeywordMatch(content, qLower, terms);
      if (score > 0) {
        results.push({
          id: `bookmark:${timestamp}`,
          content,
          score,
          source: 'bookmark',
          timestamp,
        });
      }
    }
  }

  // Search notes/*.md
  const notesDir = join(memoryBankDir(), 'notes');
  try {
    if (existsSync(notesDir)) {
      const files = readdirSync(notesDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const content = readFileSyncSafe(join(notesDir, file));
        if (!content) continue;
        const score = scoreKeywordMatch(content, qLower, terms);
        if (score > 0) {
          results.push({
            id: `note:${file.replace(/\.md$/, '')}`,
            content: content.slice(0, 200), // first 200 chars as summary
            score,
            source: 'note',
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  } catch {
    // notes dir may not exist
  }

  return results;
}

/**
 * Score a piece of content against a query for keyword matching.
 */
function scoreKeywordMatch(
  content: string,
  qLower: string,
  terms: string[],
): number {
  const cLower = content.toLowerCase();
  let score = 0;

  // Exact phrase match
  if (cLower.includes(qLower)) {
    score += EXACT_PHRASE_SCORE;
  }

  // Per-term matching
  for (const term of terms) {
    let idx = -1;
    let count = 0;
    for (;;) {
      idx = cLower.indexOf(term, idx + 1);
      if (idx === -1) break;
      count++;
    }
    if (count > 0) {
      score += KEYWORD_MATCH_SCORE * count;
    }
  }

  return score;
}

// ─── Keyword search over transcripts ───

/**
 * Search transcript JSONL files for keyword matches.
 */
function keywordSearchTranscripts(
  query: string,
  scope?: MemorySearchScope,
  role?: 'user' | 'assistant',
): ScoredMatch[] {
  const results: ScoredMatch[] = [];
  const qLower = query.toLowerCase();
  const terms = qLower.split(/\s+/).filter((w) => w.length > 0);

  const dir = transcriptsDir();
  if (!existsSync(dir)) return results;

  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const now = Date.now();

  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, '');
    if (!transcriptVisibleInScope(sessionId, scope)) continue;
    const filePath = join(dir, file);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const lines = raw.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let entry: {
          type?: string;
          role?: string;
          content?: string;
          summary?: string;
          recallCues?: string[];
          timestamp?: string;
        };
        try {
          entry = JSON.parse(trimmed);
        } catch {
          // skip malformed JSON lines
          continue;
        }

        if (entry.type === 'message' || entry.type === undefined) {
          const content = entry.content;
          if (!content || typeof content !== 'string') continue;
          const entryRole = entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : undefined;
          if (role && entryRole !== role) continue;

          const score = scoreKeywordMatch(content, qLower, terms);
          if (score > 0) {
            results.push({
              id: `transcript:${sessionId}:${entry.timestamp ?? now}`,
              content: content.slice(0, 200),
              score,
              source: 'transcript',
              timestamp: entry.timestamp ?? new Date().toISOString(),
              role: entryRole,
            });
          }
          continue;
        }

        if (!role && entry.type === 'compaction' && entry.summary) {
          const cueText = Array.isArray(entry.recallCues) ? entry.recallCues.join(' ') : '';
          const content = `${entry.summary}\n${cueText}`.trim();
          const score = scoreKeywordMatch(content, qLower, terms);
          if (score > 0) {
            results.push({
              id: `transcript:${sessionId}:${entry.timestamp ?? now}:compaction`,
              content: content.slice(0, 300),
              score,
              source: 'transcript_compaction',
              timestamp: entry.timestamp ?? new Date().toISOString(),
            });
          }
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return results;
}

// ─── Semantic search using TF embeddings ───

/**
 * Search the vector index using TF sparse vector cosine similarity.
 */
async function semanticSearch(query: string, minScore: number = DEFAULT_MIN_SCORE): Promise<ScoredMatch[]> {
  const results: ScoredMatch[] = [];

  // Try to use the vector index
  let index: MaterializedEntry[];
  try {
    index = readIndex();
  } catch {
    // If vector store is unavailable, fall back to inline TF on memory bank
    return semanticSearchInline(query);
  }

  if (index.length === 0) {
    return semanticSearchInline(query);
  }

  // Get provider
  let provider;
  try {
    provider = getEmbeddingProvider();
  } catch {
    return semanticSearchInline(query);
  }

  // For TF provider, do cosine similarity directly
  if (provider.type === 'tf') {
    const queryVec = tfEmbedSparse(query);
    for (const entry of index) {
      if (entry._loadedType !== 'tf') continue;
      if (typeof entry.embedding === 'object' && !(entry.embedding instanceof Float32Array)) {
        const score = cosineSimilarity(queryVec, entry.embedding as Record<string, number>);
        if (score >= minScore) {
          results.push({
            id: entry.id,
            content: entry.text,
            score: score,
            source: entry.source,
            timestamp: entry.timestamp,
          });
        }
      }
    }
  } else {
    // For dense providers, skip if mismatched or unavailable
    return semanticSearchInline(query);
  }

  return results;
}

/**
 * Fallback semantic search: compute TF cosine similarity against the
 * content of memory bank files directly.
 */
async function semanticSearchInline(query: string, minScore: number = DEFAULT_MIN_SCORE): Promise<ScoredMatch[]> {
  const results: ScoredMatch[] = [];
  const queryVec = tfEmbedSparse(query);

  // Search bookmarks
  const bookmarks = readFileSyncSafe(bankFilePath('BOOKMARKS.md'));
  if (bookmarks) {
    const lines = bookmarks.split('\n');
    for (const line of lines) {
      const m = line.match(/^- <time=([^>]+)>\s+(.*)$/);
      if (!m) continue;
      const content = m[2];
      const contentVec = tfEmbedSparse(content);
      const score = cosineSimilarity(queryVec, contentVec);
      if (score >= minScore) {
        results.push({
          id: `bookmark:${m[1]}`,
          content,
          score,
          source: 'bookmark',
          timestamp: m[1],
        });
      }
    }
  }

  return results;
}

/**
 * Build a sparse TF vector from text using inline tokenizer.
 */
function tfEmbedSparse(text: string): Record<string, number> {
  const tokens = inlineTokenize(text);
  const v: Record<string, number> = {};
  for (const t of tokens) {
    v[t] = (v[t] ?? 0) + 1;
  }
  return v;
}

// ─── RRF Fusion ───

/**
 * Reciprocal Rank Fusion: merge multiple ranked lists into a single ranked list.
 *
 * RRF(k) = 1 / (k + rank(item))
 * where rank(item) is the position in each individual result list (1-based).
 */
function rrfFusion(
  lists: ScoredMatch[][],
  k: number = RRF_K,
  maxResults: number = DEFAULT_MAX_RESULTS,
): ScoredMatch[] {
  // Map item id -> list of ranks (1-based position in each list where it appears)
  const idToRanks: Map<string, number[]> = new Map();
  const idToItem: Map<string, ScoredMatch> = new Map();

  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const id = item.id;
      if (!idToRanks.has(id)) {
        idToRanks.set(id, []);
      }
      idToRanks.get(id)!.push(i + 1); // 1-based rank
      // Keep the item with the highest individual score
      const existing = idToItem.get(id);
      if (!existing || item.score > existing.score) {
        idToItem.set(id, item);
      }
    }
  }

  // Compute RRF score and collect results
  const fused: Array<{ item: ScoredMatch; rrfScore: number }> = [];
  for (const [id, ranks] of idToRanks) {
    const item = idToItem.get(id)!;
    const rrfScore = ranks.reduce((sum, r) => sum + 1 / (k + r), 0);
    fused.push({ item, rrfScore });
  }

  // Sort by RRF score descending
  fused.sort((a, b) => b.rrfScore - a.rrfScore);

  return fused.slice(0, maxResults).map((f) => ({
    ...f.item,
    score: parseFloat(f.rrfScore.toFixed(4)),
  }));
}

// ─── Main hybridSearch API ───

/**
 * Perform hybrid search across transcripts and memory bank.
 *
 * Uses RRF (Reciprocal Rank Fusion) to merge keyword and semantic results,
 * with time decay applied to final scores.
 *
 * @param opts.query          Search query string
 * @param opts.maxResults     Maximum results to return (default 20)
 * @param opts.minScore       Minimum score threshold (default 0.5)
 * @param opts.searchTranscripts  Whether to search transcripts (default true)
 * @param opts.searchMemory       Whether to search memory bank (default true)
 * @returns Sorted array of SearchResult
 */
export async function hybridSearch(opts: HybridSearchOptions): Promise<SearchResult[]> {
  const query = opts.query.trim();
  if (!query) return [];

  const maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;
  const searchTranscripts = opts.searchTranscripts !== false;
  const searchMemory = opts.searchMemory !== false && !opts.role;

  const now = new Date();
  const lists: ScoredMatch[][] = [];

  // 1. Keyword search
  const keywordResults: ScoredMatch[] = [];
  if (searchMemory) {
    keywordResults.push(...keywordSearchMemory(query));
  }
  if (searchTranscripts) {
    keywordResults.push(...keywordSearchTranscripts(query, opts.scope, opts.role));
  }
  if (keywordResults.length > 0) {
    lists.push(keywordResults);
  }

  // 2. Semantic search (async)
  try {
    const semanticResults = searchMemory ? await semanticSearch(query) : [];
    if (semanticResults.length > 0) {
      lists.push(semanticResults);
    }
  } catch {
    // Semantic search failed — fall back to keyword-only
  }

  // 3. RRF Fusion
  let results: ScoredMatch[];
  if (lists.length === 0) {
    return [];
  } else if (lists.length === 1) {
    results = lists[0];
  } else {
    results = rrfFusion(lists, RRF_K, maxResults * 2); // get more for filtering
  }

  // 4. Apply time decay
  for (const r of results) {
    const decay = timeDecay(r.timestamp, now);
    r.score = parseFloat((r.score * decay).toFixed(4));
  }

  // 5. Filter by minScore and sort
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  results = results
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  // 6. Map to SearchResult interface
  return results.map((r) => ({
    id: r.id,
    content: r.content,
    score: r.score,
    source: r.source,
    timestamp: r.timestamp,
    role: r.role,
  }));
}

/**
 * Simple grep-style search — fallback when hybrid search is not needed.
 * Pure synchronous, no dependencies on embedding provider.
 */
export function simpleGrep(query: string, opts?: {
  maxResults?: number;
  searchTranscripts?: boolean;
  searchMemory?: boolean;
}): SearchResult[] {
  const qTrimmed = query.trim();
  if (!qTrimmed) return [];

  const maxResults = opts?.maxResults ?? 20;
  const results: SearchResult[] = [];

  if (opts?.searchMemory !== false) {
    const memoryResults = keywordSearchMemory(qTrimmed);
    results.push(...memoryResults);
  }

  if (opts?.searchTranscripts !== false) {
    const transcriptResults = keywordSearchTranscripts(qTrimmed);
    results.push(...transcriptResults);
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults).map((r) => ({
    id: r.id,
    content: r.content,
    score: r.score,
    source: r.source,
    timestamp: r.timestamp,
  }));
}
