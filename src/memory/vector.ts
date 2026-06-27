/**
 * Mio — vector memory store.
 *
 * Storage backend: SQLite + sqlite-vec (see ./sqlite-vector.ts). Dense
 * (minimax) vectors use sqlite-vec's vec0 KNN; sparse (tf) vectors use
 * application-level cosine. The public API below is unchanged from the old
 * JSONL implementation, so callers are unaffected. A one-time migration
 * imports any legacy `.vector-index.jsonl` on first access.
 *
 * Why dual format: dense vectors (1536 floats) cost real money per call.
 * TF is free, offline, and good enough for keyword recall. The user picks
 * the trade-off via env (set MINIMAX_API_KEY for dense).
 */

import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../config.js';
import { bankFilePath } from './paths.js';
import { readFileSyncSafe } from './bank.js';
import {
  getEmbeddingProvider,
  type AnyVector,
  type SparseVector,
  type EmbeddingProvider,
} from './embedding.js';
import * as store from './sqlite-vector.js';
import type { SqliteVectorEntry } from './sqlite-vector.js';

// ─── Tokenization ───

const STOP_WORDS_ZH = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那',
  '和', '与', '或', '但', '就', '也', '都', '还', '又', '才', '要',
  '没', '不', '有', '把', '被', '对', '从', '到', '给', '为', '以',
  '上', '下', '里', '外', '前', '后', '中', '一个', '一些', '什么',
  '怎么', '为什么', '吧', '呢', '啊', '哦', '嗯', '哈', '呵', '唉',
]);

const STOP_WORDS_EN = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'can', 'could', 'may', 'might', 'must', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
  'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
  'and', 'or', 'but', 'so', 'if', 'then', 'else', 'when', 'where',
  'why', 'how', 'what', 'which', 'who', 'whom', 'to', 'of', 'in',
  'on', 'at', 'by', 'for', 'with', 'from', 'as', 'into', 'about',
]);

/**
 * Tokenize text into a set of meaningful terms (Chinese bigrams+unigrams,
 * English words minus stop words).
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();

  const enTokens = lower
    .replace(/[一-鿿]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS_EN.has(w));
  tokens.push(...enTokens);

  const cjk = lower.replace(/[^一-鿿]/g, '');
  for (let i = 0; i < cjk.length - 1; i++) {
    const bi = cjk.slice(i, i + 2);
    if (!STOP_WORDS_ZH.has(bi[0]) && !STOP_WORDS_ZH.has(bi[1])) {
      tokens.push(bi);
    }
  }
  for (const ch of cjk) {
    if (!STOP_WORDS_ZH.has(ch)) tokens.push(ch);
  }

  return tokens;
}

// ─── Backward-compat: legacy `embed()` and `cosine()` for sparse TF ───

/** @deprecated Use EmbeddingProvider.embed() instead. */
export type Embedding = SparseVector;

/** @deprecated Use EmbeddingProvider for new code. */
export function embed(tokens: string[]): Embedding {
  const v: Embedding = {};
  for (const t of tokens) v[t] = (v[t] ?? 0) + 1;
  return v;
}

/** @deprecated Cosine for sparse vectors. */
export function cosine(a: Embedding, b: Embedding): number {
  let dot = 0;
  for (const k of Object.keys(a)) {
    if (b[k] !== undefined) dot += a[k] * b[k];
  }
  const normA = Math.sqrt(Object.values(a).reduce((s, x) => s + x * x, 0));
  const normB = Math.sqrt(Object.values(b).reduce((s, x) => s + x * x, 0));
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

// ─── Dense vector helpers (used only for legacy JSONL migration) ───

/** Decode a base64 string back to a Float32Array. */
function decodeDense(s: string): Float32Array {
  const buf = Buffer.from(s, 'base64');
  const out = new Float32Array(buf.byteLength / 4);
  Buffer.from(out.buffer).set(buf);
  return out;
}

/**
 * Cosine similarity that handles both sparse and dense vectors.
 * Dense vectors are assumed L2-normalized, so cosine reduces to a dot product.
 */
function similarity(query: AnyVector, candidate: AnyVector): number {
  if (query instanceof Float32Array && candidate instanceof Float32Array) {
    const n = Math.min(query.length, candidate.length);
    let dot = 0;
    for (let i = 0; i < n; i++) dot += query[i] * candidate[i];
    return dot;
  }
  if (!(query instanceof Float32Array) && !(candidate instanceof Float32Array)) {
    return cosine(query, candidate);
  }
  return 0;
}

// ─── RRF hybrid fusion ───

/**
 * Reciprocal Rank Fusion. Merges multiple ranked id-lists into a combined
 * score map: an item's score is Σ 1/(k + rank) across the lists it appears in.
 * k=60 is the canonical constant (dampens the weight of top ranks).
 */
export function rrfFuse(rankings: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i++) {
      const id = ranking[i];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }
  return scores;
}

/**
 * Re-rank dense KNN candidates by fusing the dense order with a free,
 * query-time TF keyword ranking (computed from each candidate's own text — no
 * stored sparse vectors needed). Lets dense (semantic) recall keep the exact
 * keyword matches it would otherwise miss. Returns the top `limit`.
 */
export function fuseDenseWithKeyword<T extends { id: string; text: string }>(
  query: string,
  denseRanked: T[],
  limit: number,
  k = 60,
): T[] {
  if (denseRanked.length <= 1) return denseRanked.slice(0, limit);
  const qTf = embed(tokenize(query));
  const denseRanking = denseRanked.map((e) => e.id); // already dense-score desc
  const tfRanking = denseRanked
    .map((e) => ({ id: e.id, tf: cosine(qTf, embed(tokenize(e.text))) }))
    .sort((a, b) => b.tf - a.tf)
    .map((e) => e.id);
  const fused = rrfFuse([denseRanking, tfRanking], k);
  const byId = new Map(denseRanked.map((e) => [e.id, e]));
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id)!)
    .slice(0, limit);
}

// ─── Index entry types ───

export interface VectorIndexEntry {
  id: string;
  text: string;
  source: 'bookmark' | 'note' | 'user_profile' | 'diary' | 'manual' | 'knowledge';
  timestamp: string;
  embeddingType: 'tf' | 'minimax';
  /** Sparse vector (object) or base64-encoded Float32Array (string). */
  embedding: SparseVector | string;
}

/** In-memory entry with the vector materialized. Returned by search()/readIndex(). */
export interface MaterializedEntry extends Omit<VectorIndexEntry, 'embedding'> {
  embedding: AnyVector;
  _loadedType: 'tf' | 'minimax';
}

// ─── Legacy JSONL migration (one-time) ───

let _migrated = false;

function legacyJsonlPath(): string {
  return join(getDataDir(), 'memory-bank', '.vector-index.jsonl');
}

/**
 * Import a legacy JSONL index into SQLite once, then rename it aside. Safe to
 * call on every public entry point — it no-ops after the first run (or when no
 * legacy file exists).
 */
function ensureMigrated(): void {
  if (_migrated) return;
  _migrated = true;
  const path = legacyJsonlPath();
  if (!existsSync(path)) return;
  try {
    const content = readFileSync(path, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const entries: SqliteVectorEntry[] = [];
    for (const line of lines) {
      try {
        const p = JSON.parse(line) as Partial<VectorIndexEntry>;
        if (!p.id || !p.text || p.embedding === undefined) continue;
        const type = (p.embeddingType ?? 'tf') as 'tf' | 'minimax';
        const embedding: SparseVector | Float32Array =
          type === 'minimax' && typeof p.embedding === 'string'
            ? decodeDense(p.embedding)
            : (p.embedding as SparseVector);
        entries.push({
          id: p.id,
          text: p.text,
          source: (p.source ?? 'manual') as string,
          timestamp: p.timestamp ?? '',
          embeddingType: type,
          embedding,
        });
      } catch {
        // skip malformed line
      }
    }
    if (entries.length > 0) store.upsertBatch(entries);
    renameSync(path, path + '.migrated');
  } catch {
    // Migration is best-effort; a fresh SQLite store still works.
  }
}

/** Convert a stored entry to the public MaterializedEntry shape. */
function toMaterialized(e: SqliteVectorEntry): MaterializedEntry {
  return {
    id: e.id,
    text: e.text,
    source: e.source as VectorIndexEntry['source'],
    timestamp: e.timestamp,
    embeddingType: e.embeddingType,
    _loadedType: e.embeddingType,
    embedding: e.embedding as AnyVector,
  };
}

// ─── Public API ───

/**
 * Add a single entry to the index using the active embedding provider.
 * Idempotent on `id`. Sync path supports TF only; use indexEntryWithProvider
 * for dense providers.
 */
export function indexEntry(entry: Omit<VectorIndexEntry, 'embedding' | 'embeddingType'>): void {
  ensureMigrated();
  const provider = getEmbeddingProvider();
  if (provider.type !== 'tf') {
    throw new Error(`Sync indexEntry only supports tf; use indexEntryWithProvider for ${provider.type}`);
  }
  store.upsertEntry({
    id: entry.id,
    text: entry.text,
    source: entry.source,
    timestamp: entry.timestamp,
    embeddingType: 'tf',
    embedding: embed(tokenize(entry.text)),
  });
}

/** Force a specific provider for this index call. Mostly used in tests. */
export async function indexEntryWithProvider(
  entry: Omit<VectorIndexEntry, 'embedding' | 'embeddingType'>,
  provider: EmbeddingProvider,
): Promise<void> {
  ensureMigrated();
  const vectors = await provider.embed([entry.text]);
  if (vectors.length !== 1) {
    throw new Error(`Provider returned ${vectors.length} vectors for 1 input`);
  }
  store.upsertEntry({
    id: entry.id,
    text: entry.text,
    source: entry.source,
    timestamp: entry.timestamp,
    embeddingType: provider.type,
    embedding: vectors[0],
  });
}

/** Read the full index with vectors materialized. */
export function readIndex(): MaterializedEntry[] {
  ensureMigrated();
  return store.readAll().map(toMaterialized);
}

function textMatches(haystack: string, needle: string): boolean {
  const n = needle.trim();
  return n.length > 0 && haystack.includes(n);
}

/** Delete entries whose text contains the provided content. */
export function deleteEntriesMatchingText(content: string): number {
  ensureMigrated();
  let deleted = 0;
  for (const entry of store.readAll()) {
    if (textMatches(entry.text, content) && store.deleteById(entry.id)) {
      deleted++;
    }
  }
  return deleted;
}

/**
 * Replace matching text in vector entries and re-embed changed rows.
 * Returns the number of updated entries.
 */
export async function updateEntriesMatchingText(oldContent: string, newContent: string): Promise<number> {
  ensureMigrated();
  const oldText = oldContent.trim();
  const nextText = newContent.trim();
  if (!oldText || !nextText || oldText === nextText) return 0;

  const provider = getEmbeddingProvider();
  let updated = 0;
  for (const entry of store.readAll()) {
    if (!textMatches(entry.text, oldText)) continue;
    await indexEntryWithProvider({
      id: entry.id,
      text: entry.text.split(oldText).join(nextText),
      source: entry.source as VectorIndexEntry['source'],
      timestamp: entry.timestamp,
    }, provider);
    updated++;
  }
  return updated;
}

/**
 * Search the index for entries similar to a query string.
 *
 * Dense (minimax) queries use sqlite-vec KNN; sparse (tf) queries fall back to
 * application-level cosine over the tf entries.
 *
 * @param query    Free-text query.
 * @param limit    Max results (default 5).
 * @param minScore Minimum similarity to include (default 0.05).
 */
export async function search(
  query: string,
  limit: number = 5,
  minScore: number = 0.05,
  sources?: string[],
): Promise<Array<MaterializedEntry & { score: number }>> {
  ensureMigrated();
  const provider = getEmbeddingProvider();
  const queryVecs = await provider.embed([query]);
  if (queryVecs.length === 0) return [];
  const queryVec = queryVecs[0];
  const inSources = (s: string): boolean => !sources || sources.includes(s);

  if (queryVec instanceof Float32Array) {
    // Dense → sqlite-vec KNN, then RRF-fuse with a free TF keyword ranking so
    // exact keyword matches the pure-semantic KNN would miss get surfaced.
    // Oversample the pool when a source filter is set to offset post-filtering.
    const pool = Math.max(limit * 4, 20) * (sources ? 3 : 1);
    const candidates = store
      .searchDense(queryVec, pool, minScore)
      .map((r) => ({ ...toMaterialized(r), score: r.score }))
      .filter((c) => inSources(c.source));
    return fuseDenseWithKeyword(query, candidates, limit);
  }

  // Sparse (tf) → application-level cosine over tf entries.
  const scored: Array<MaterializedEntry & { score: number }> = [];
  for (const e of store.readSparse()) {
    if (!inSources(e.source)) continue;
    const score = similarity(queryVec, e.embedding as AnyVector);
    if (score >= minScore) scored.push({ ...toMaterialized(e), score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ─── Bookmarks reindexer ───

interface ParsedBookmark {
  timestamp: string;
  text: string;
}

/** Stable index id for a parsed bookmark. Must stay byte-identical for dedup. */
function bookmarkId(b: ParsedBookmark): string {
  return `bookmark:${b.timestamp}:${(b.text || '').slice(0, 30).replace(/\s+/g, '-')}`;
}

/** Parse the `- <time=…> …` lines of BOOKMARKS.md into structured records. */
function parseBookmarkLines(content: string): ParsedBookmark[] {
  const lines = content.split('\n').filter((l) => l.trim().startsWith('- '));
  const parsed: ParsedBookmark[] = [];
  for (const line of lines) {
    const m = line.match(/^-\s+<time=([^>]+)>\s+(.*)$/);
    if (!m) continue;
    parsed.push({ timestamp: m[1], text: m[2] });
  }
  return parsed;
}

/** Embed a batch of bookmarks into stored entries via the given provider. */
async function embedBookmarks(
  bookmarks: ParsedBookmark[],
  provider: EmbeddingProvider,
): Promise<SqliteVectorEntry[]> {
  const vectors = await provider.embed(bookmarks.map((b) => b.text));
  return bookmarks.map((b, i) => ({
    id: bookmarkId(b),
    text: b.text,
    source: 'bookmark',
    timestamp: b.timestamp,
    embeddingType: provider.type,
    embedding: vectors[i],
  }));
}

/**
 * Re-index BOOKMARKS.md using the active embedding provider.
 *
 * Incremental by default: triggered on every BOOKMARKS.md mtime change (~every
 * turn), so it only embeds bookmark lines whose id is not already in the index
 * and appends them — existing entries are preserved.
 *
 * Full-rebuild fallback: when the active provider's type no longer matches the
 * embeddingType stored on existing bookmark entries (the user switched
 * providers), the stored vectors are an incomparable format, so every bookmark
 * is dropped and re-embedded under the new provider.
 *
 * Returns the total number of entries in the index after the operation.
 */
export async function reindexBookmarks(): Promise<number> {
  ensureMigrated();
  const bookmarks = readFileSyncSafe(bankFilePath('BOOKMARKS.md'));
  if (!bookmarks) return 0;

  const parsed = parseBookmarkLines(bookmarks);
  if (parsed.length === 0) return 0;

  const provider = getEmbeddingProvider();
  const existingTypes = store.bookmarkEmbeddingTypes();

  // Provider switch → existing vectors are a different format → full rebuild.
  if (existingTypes.size > 0 && !existingTypes.has(provider.type)) {
    store.deleteBySource('bookmark');
    store.upsertBatch(await embedBookmarks(parsed, provider));
    return store.count();
  }

  // Incremental: embed only bookmark lines not already in the index.
  const existingIds = store.readBookmarkIds();
  const fresh = parsed.filter((b) => !existingIds.has(bookmarkId(b)));
  if (fresh.length === 0) return store.count();

  store.upsertBatch(await embedBookmarks(fresh, provider));
  return store.count();
}

// ─── Stats ───

/** Statistics about the index. Used by /status and the test suite. */
export function indexStats(): { entries: number; sources: Record<string, number>; types: Record<string, number> } {
  ensureMigrated();
  return store.stats();
}

// Re-export for callers
export { readFileSyncSafe };
