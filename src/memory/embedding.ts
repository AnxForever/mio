/**
 * Mio — Embedding provider abstraction
 *
 * Two implementations, picked automatically by `getEmbeddingProvider()`:
 *
 *   1. `tf`           — Sparse term-frequency, zero-dep, offline. The default
 *                       when no API key is set. Same algorithm as v0.1 of
 *                       memory/vector.ts.
 *
 *   2. `minimax`      — Dense 1536-dim vectors via MiniMax's `/v1/embeddings`
 *                       endpoint. Selected when `MINIMAX_API_KEY` is set.
 *                       L2-normalized, so cosine = dot product.
 *
 * The interface is the same for both:
 *   - embed(texts: string[]): Promise<Float32Array[]>  // batched
 *   - dim: number
 *   - type: 'tf' | 'minimax'
 *
 * Persistence side stores `embeddingType` in the index entry so loading
 * knows how to deserialize. See memory/vector.ts.
 */

import { tokenize } from './vector.js';

// ─── Types ───

/**
 * Output of an embedding provider for a single input.
 *
 * - `tf`     uses a sparse record { term: count }.
 * - `minimax` uses a dense Float32Array of length 1536.
 *
 * The VectorStore code is responsible for handling both shapes.
 */
export type SparseVector = Record<string, number>;
export type DenseVector = Float32Array;
export type AnyVector = SparseVector | DenseVector;

export interface EmbeddingProvider {
  /** Type tag for persistence. */
  readonly type: 'tf' | 'minimax';
  /** Dimensionality hint (sparse: number of distinct terms; dense: fixed). */
  readonly dim: number;
  /** Embed a batch of texts. */
  embed(texts: string[]): Promise<AnyVector[]>;
}

// ─── TF (sparse, zero-dep) ───

/**
 * Term-frequency provider. Identical algorithm to the original
 * memory/vector.ts — kept here so the abstraction has a real fallback.
 */
class TfEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'tf' as const;

  get dim(): number {
    // Dynamic — sparse vectors don't have a fixed dim. Return 0 as a sentinel.
    return 0;
  }

  async embed(texts: string[]): Promise<SparseVector[]> {
    return texts.map((t) => tfEmbed(t));
  }
}

function tfEmbed(text: string): SparseVector {
  const tokens = tokenize(text);
  const v: SparseVector = {};
  for (const t of tokens) {
    v[t] = (v[t] ?? 0) + 1;
  }
  return v;
}

// ─── MiniMax (dense, 1536-dim) ───

/**
 * MiniMax embedding API client.
 *
 * Endpoint: POST https://api.MiniMax.chat/v1/embeddings
 * Auth:     Authorization: Bearer <MINIMAX_API_KEY>
 * Body:     { type: 'db' | 'query', model: string, texts: string[] }
 * Response: { vectors: number[][], total_tokens, base_resp }
 *
 * The MiniMax API is OpenAI-compatible in shape but uses `type` instead of
 * `input` and requires `type` to be either 'db' (indexing) or 'query' (search).
 *
 * The provider is selected at boot — there's no fallback within MiniMax.
 * If the API call fails, we throw and the caller can decide what to do
 * (the agent loop catches and falls back to skipping the index update).
 */
class MiniMaxEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'minimax' as const;
  readonly dim = 1536;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;

  constructor(apiKey: string, endpoint?: string, model?: string) {
    this.apiKey = apiKey;
    this.endpoint = endpoint ?? 'https://api.MiniMax.chat/v1/embeddings';
    this.model = model ?? process.env.MINIMAX_EMBEDDING_MODEL ?? 'embo-01';
  }

  async embed(texts: string[]): Promise<DenseVector[]> {
    if (texts.length === 0) return [];
    // MiniMax requires `type` = 'db' or 'query'. We use 'db' for bulk indexing
    // (which is most of our use case). If a caller needs query-style, they
    // can subclass or we can add a flag later.
    const body = {
      type: 'db',
      model: this.model,
      texts,
    };

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`MiniMax embeddings request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MiniMax embeddings API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      vectors: number[][];
      total_tokens?: number;
      base_resp?: { status_code: number; status_msg: string };
    };

    if (data.base_resp && data.base_resp.status_code !== 0 && data.base_resp.status_code !== undefined) {
      throw new Error(`MiniMax embeddings: ${data.base_resp.status_msg} (code ${data.base_resp.status_code})`);
    }

    if (!Array.isArray(data.vectors)) {
      throw new Error('MiniMax embeddings: response missing vectors array');
    }

    return data.vectors.map((arr) => Float32Array.from(arr));
  }
}

// ─── Factory + cache ───

let _provider: EmbeddingProvider | null = null;

/**
 * Detect which provider to use.
 *
 * Decision tree:
 *   - If `MINIMAX_DISABLE=true` → 'tf' (force offline)
 *   - If `MINIMAX_API_KEY` is set → 'minimax'
 *   - Otherwise → 'tf'
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (_provider) return _provider;

  const forceOffline = process.env.MINIMAX_DISABLE === 'true';
  const apiKey = process.env.MINIMAX_API_KEY;

  if (!forceOffline && apiKey && apiKey.length > 0) {
    _provider = new MiniMaxEmbeddingProvider(apiKey);
  } else {
    _provider = new TfEmbeddingProvider();
  }
  return _provider;
}

/**
 * Reset the cached provider. Used by tests that swap env vars between runs.
 */
export function resetEmbeddingProvider(): void {
  _provider = null;
}

/**
 * Test-only seam: inject a custom provider (e.g. one that rejects) to exercise
 * the embedding-failure fallback path in callers like memory-stream.ts.
 * Pass null to clear and fall back to auto-detection.
 */
export function setEmbeddingProviderForTests(p: EmbeddingProvider | null): void {
  _provider = p;
}

/**
 * Return a string describing the current provider — for /status output.
 */
export function describeProvider(): string {
  const p = getEmbeddingProvider();
  if (p.type === 'minimax') return `minimax (dim=${p.dim}, model=${process.env.MINIMAX_EMBEDDING_MODEL ?? 'embo-01'})`;
  return 'tf (sparse, zero-dep, offline)';
}
