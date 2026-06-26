/**
 * Mio — vector memory store (dual-format: TF sparse + MiniMax dense)
 *
 * Persistence format: JSONL with one entry per line.
 *
 *   {
 *     "id": "bookmark:2026-06-25 12:00 +0800:差异-异用-用户",
 *     "text": "聊到了猫和狗的差异. 用户提到...",
 *     "source": "bookmark",
 *     "timestamp": "2026-06-25 12:00 +0800",
 *     "embeddingType": "tf" | "minimax",
 *     "embedding": SparseVector | "<base64 Float32Array>"
 *   }
 *
 * Backward compat: entries without `embeddingType` are treated as 'tf'.
 * Old sparse indexes load fine; first write to them will rewrite in
 * whichever format the active provider uses.
 *
 * Provider selection: see ./embedding.ts. Default is TF; set
 * MINIMAX_API_KEY to switch to MiniMax.
 *
 * Why dual format: dense vectors (1536 floats) cost real money per call.
 * TF is free, offline, and good enough for keyword recall. We let the
 * user pick the trade-off via env, and we don't force-migrate indexes
 * — if a user switches providers, we rebuild from BOOKMARKS.md on the
 * next reindexBookmarks() call.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../config.js';
import { bankFilePath } from './paths.js';
import { readFileSyncSafe, writeFileSyncSafe } from './bank.js';
import {
  getEmbeddingProvider,
  type AnyVector,
  type SparseVector,
  type DenseVector,
  type EmbeddingProvider,
} from './embedding.js';

// ─── Index file location ───

function indexPath(): string {
  return join(getDataDir(), 'memory-bank', '.vector-index.jsonl');
}

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
 * Tokenize text into a set of meaningful terms.
 *
 * Strategy:
 *   - Chinese: emit bigrams of consecutive CJK characters + unigrams
 *     that aren't stop words.
 *   - English: lowercase, split on non-alpha, drop stop words.
 *   - Strip all CJK punctuation and basic ASCII punctuation.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();

  // 1. English tokens
  const enTokens = lower
    .replace(/[一-鿿]/g, ' ') // remove CJK
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS_EN.has(w));
  tokens.push(...enTokens);

  // 2. Chinese bigrams + meaningful unigrams
  const cjk = lower.replace(/[^一-鿿]/g, '');
  for (let i = 0; i < cjk.length - 1; i++) {
    const bi = cjk.slice(i, i + 2);
    if (!STOP_WORDS_ZH.has(bi[0]) && !STOP_WORDS_ZH.has(bi[1])) {
      tokens.push(bi);
    }
  }
  for (const ch of cjk) {
    if (!STOP_WORDS_ZH.has(ch)) {
      tokens.push(ch);
    }
  }

  return tokens;
}

// ─── Backward-compat: legacy `embed()` and `cosine()` for sparse TF ───

/** @deprecated Use EmbeddingProvider.embed() instead. */
export type Embedding = SparseVector;

/** @deprecated Use EmbeddingProvider for new code. */
export function embed(tokens: string[]): Embedding {
  const v: Embedding = {};
  for (const t of tokens) {
    v[t] = (v[t] ?? 0) + 1;
  }
  return v;
}

/** @deprecated Cosine for sparse vectors. For dense, use dot product on L2-normalized vectors. */
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

// ─── Dense vector helpers ───

/**
 * Encode a Float32Array as base64. ~6KB per 1536-dim vector — much smaller
 * than JSON-encoding each float individually.
 */
function encodeDense(v: Float32Array): string {
  const buf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  return buf.toString('base64');
}

/** Decode a base64 string back to a Float32Array of the same length. */
function decodeDense(s: string): Float32Array {
  const buf = Buffer.from(s, 'base64');
  // Slice into a fresh ArrayBuffer so Float32Array is well-formed.
  const out = new Float32Array(buf.byteLength / 4);
  const view = Buffer.from(out.buffer);
  buf.copy(view);
  return out;
}

/**
 * Cosine similarity that handles both sparse and dense vectors.
 *
 * Dense vectors are assumed L2-normalized (which the MiniMax API guarantees),
 * so cosine reduces to a dot product.
 */
function similarity(query: AnyVector, candidate: AnyVector): number {
  if (query instanceof Float32Array && candidate instanceof Float32Array) {
    // Both dense — dot product (vectors are L2-normalized).
    const n = Math.min(query.length, candidate.length);
    let dot = 0;
    for (let i = 0; i < n; i++) dot += query[i] * candidate[i];
    return dot;
  }
  if (!(query instanceof Float32Array) && !(candidate instanceof Float32Array)) {
    // Both sparse.
    return cosine(query, candidate);
  }
  // Mismatched types — score 0 (this happens during provider transitions).
  return 0;
}

// ─── Index entry ───

export interface VectorIndexEntry {
  id: string;
  text: string;
  source: 'bookmark' | 'note' | 'user_profile' | 'diary' | 'manual';
  timestamp: string;
  embeddingType: 'tf' | 'minimax';
  /** Sparse vector (object) or base64-encoded Float32Array (string). */
  embedding: SparseVector | string;
}

/**
 * Raw in-memory entry with the vector materialized (decoded from base64
 * if it was dense). This is what `search()` and `readIndex()` return.
 */
export interface MaterializedEntry extends Omit<VectorIndexEntry, 'embedding'> {
  embedding: AnyVector;
  _loadedType: 'tf' | 'minimax';
}

// ─── Public API ───

/**
 * Add a single entry to the index. Uses the active embedding provider.
 *
 * Idempotent on `id`: re-adding the same id overwrites the previous entry.
 */
export function indexEntry(entry: Omit<VectorIndexEntry, 'embedding' | 'embeddingType'>): void {
  const provider = getEmbeddingProvider();
  addEntryWithProvider(entry, provider);
}

/**
 * Force a specific provider for this index call. Mostly used in tests.
 */
export async function indexEntryWithProvider(
  entry: Omit<VectorIndexEntry, 'embedding' | 'embeddingType'>,
  provider: EmbeddingProvider,
): Promise<void> {
  await addEntryWithProviderAsync(entry, provider);
}

function addEntryWithProvider(
  entry: Omit<VectorIndexEntry, 'embedding' | 'embeddingType'>,
  provider: EmbeddingProvider,
): void {
  // Sync path for TF. We don't await here; for TF it's trivially fast.
  // For MiniMax, the caller should use indexEntryWithProvider.
  if (provider.type !== 'tf') {
    throw new Error(`Sync indexEntry only supports tf; use indexEntryWithProvider for ${provider.type}`);
  }
  const tokens = tokenize(entry.text);
  const v = embed(tokens);
  writeEntry({ ...entry, embeddingType: 'tf', embedding: v });
}

async function addEntryWithProviderAsync(
  entry: Omit<VectorIndexEntry, 'embedding' | 'embeddingType'>,
  provider: EmbeddingProvider,
): Promise<void> {
  const vectors = await provider.embed([entry.text]);
  if (vectors.length !== 1) {
    throw new Error(`Provider returned ${vectors.length} vectors for 1 input`);
  }
  const v = vectors[0];
  const embedding = v instanceof Float32Array ? encodeDense(v) : v;
  writeEntry({ ...entry, embeddingType: provider.type, embedding });
}

function writeEntry(entry: VectorIndexEntry): void {
  const path = indexPath();
  const existing = readRawIndex();
  const filtered = existing.filter((e) => e.id !== entry.id);
  filtered.push(entry);
  writeFileSyncSafe(path, filtered.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

/**
 * Read the raw index from disk (without decoding dense vectors).
 * Used by `readIndex()` and by the reindex functions.
 */
function readRawIndex(): VectorIndexEntry[] {
  const path = indexPath();
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  const result: VectorIndexEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Partial<VectorIndexEntry>;
      if (parsed.id && parsed.text && parsed.embedding !== undefined) {
        result.push({
          id: parsed.id,
          text: parsed.text,
          source: (parsed.source ?? 'manual') as VectorIndexEntry['source'],
          timestamp: parsed.timestamp ?? '',
          embeddingType: (parsed.embeddingType ?? 'tf') as 'tf' | 'minimax',
          embedding: parsed.embedding as SparseVector | string,
        });
      }
    } catch {
      // skip malformed
    }
  }
  return result;
}

/**
 * Read the index with vectors materialized. Returns the decoded form so
 * callers don't have to think about base64.
 */
export function readIndex(): MaterializedEntry[] {
  const raw = readRawIndex();
  return raw.map((e) => {
    const isDense = e.embeddingType === 'minimax' && typeof e.embedding === 'string';
    const vector: AnyVector = isDense
      ? decodeDense(e.embedding as string)
      : (e.embedding as SparseVector);
    return {
      id: e.id,
      text: e.text,
      source: e.source,
      timestamp: e.timestamp,
      embeddingType: e.embeddingType,
      _loadedType: e.embeddingType,
      embedding: vector,
    };
  });
}

/**
 * Search the index for entries similar to a query string.
 *
 * @param query    Free-text query.
 * @param limit    Max results (default 5).
 * @param minScore Minimum similarity to include (default 0.05).
 * @returns        Top results sorted by similarity desc.
 */
export async function search(
  query: string,
  limit: number = 5,
  minScore: number = 0.05,
): Promise<Array<MaterializedEntry & { score: number }>> {
  const index = readIndex();
  if (index.length === 0) return [];

  const provider = getEmbeddingProvider();
  const queryVecs = await provider.embed([query]);
  if (queryVecs.length === 0) return [];
  const queryVec = queryVecs[0];

  const scored: Array<MaterializedEntry & { score: number }> = [];
  for (const entry of index) {
    // Mismatched provider: skip (will be rebuilt by reindexBookmarks()).
    if (entry._loadedType !== provider.type) continue;
    const score = similarity(queryVec, entry.embedding);
    if (score >= minScore) {
      scored.push({ ...entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ─── Bookmarks reindexer ───

/** Parsed bookmark line: a timestamp and its free-text body. */
interface ParsedBookmark {
  timestamp: string;
  text: string;
}

/**
 * Stable index id for a parsed bookmark. The format must stay byte-identical
 * to the one written below so incremental reindexing can dedup against the
 * existing index.
 */
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

/**
 * Embed a batch of bookmarks into index entries via the given provider.
 *
 * For TF this uses the sync tokenizer under the hood; for MiniMax it is a
 * single batched API call. Dense vectors are base64-encoded for storage.
 */
async function embedBookmarks(
  bookmarks: ParsedBookmark[],
  provider: EmbeddingProvider,
): Promise<VectorIndexEntry[]> {
  const texts = bookmarks.map((b) => b.text);
  const vectors = await provider.embed(texts);
  return bookmarks.map((b, i) => {
    const v = vectors[i];
    const embedding = v instanceof Float32Array ? encodeDense(v) : v;
    return {
      id: bookmarkId(b),
      text: b.text,
      source: 'bookmark' as const,
      timestamp: b.timestamp,
      embeddingType: provider.type,
      embedding,
    };
  });
}

/**
 * Re-index BOOKMARKS.md using the active embedding provider.
 *
 * Incremental by default: this is triggered on every BOOKMARKS.md mtime change
 * (see agent-loop's maybeReindexBookmarks, ~every turn), so re-embedding the
 * full history each call would make embedding cost grow linearly with the
 * conversation. Instead we only embed bookmark lines whose id is not already
 * in the index, and append them — existing entries are preserved untouched.
 *
 * Full-rebuild fallback: when the active provider's `type` no longer matches
 * the `embeddingType` stored on the existing bookmark entries (the user
 * switched providers, e.g. tf → minimax), the stored vectors are a different,
 * incomparable format. In that case every bookmark is dropped and re-embedded
 * under the new provider.
 *
 * Returns the total number of entries in the index after the operation.
 */
export async function reindexBookmarks(): Promise<number> {
  const bookmarks = readFileSyncSafe(bankFilePath('BOOKMARKS.md'));
  if (!bookmarks) return 0;

  const parsed = parseBookmarkLines(bookmarks);
  if (parsed.length === 0) return 0;

  const provider = getEmbeddingProvider();
  const raw = readRawIndex();
  const existingBookmarks = raw.filter((e) => e.source === 'bookmark');

  // Provider switch → existing vectors are a different format → full rebuild.
  const providerSwitched = existingBookmarks.some((e) => e.embeddingType !== provider.type);
  if (providerSwitched) {
    const kept = raw.filter((e) => e.source !== 'bookmark');
    const entries = await embedBookmarks(parsed, provider);
    const all = [...kept, ...entries];
    writeFileSyncSafe(indexPath(), all.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return all.length;
  }

  // Incremental: embed only bookmark lines not already in the index.
  const existingIds = new Set(existingBookmarks.map((e) => e.id));
  const fresh = parsed.filter((b) => !existingIds.has(bookmarkId(b)));
  if (fresh.length === 0) return raw.length;

  const entries = await embedBookmarks(fresh, provider);
  const all = [...raw, ...entries];
  writeFileSyncSafe(indexPath(), all.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return all.length;
}

// ─── Stats ───

/**
 * Statistics about the index. Used by /status and the test suite.
 */
export function indexStats(): { entries: number; sources: Record<string, number>; types: Record<string, number> } {
  const raw = readRawIndex();
  const sources: Record<string, number> = {};
  const types: Record<string, number> = {};
  for (const e of raw) {
    sources[e.source] = (sources[e.source] ?? 0) + 1;
    types[e.embeddingType] = (types[e.embeddingType] ?? 0) + 1;
  }
  return { entries: raw.length, sources, types };
}

// Re-export for callers
export { readFileSyncSafe };
