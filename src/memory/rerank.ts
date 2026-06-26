/**
 * Mio — LLM rerank (second-stage retrieval reranking)
 *
 * Vector recall returns the top-k candidates by raw embedding similarity, but
 * cosine score is a coarse proxy for "which memory actually answers this turn".
 * Aligning with 2026 RAG SOTA (hybrid recall → cross-encoder/LLM rerank), this
 * module adds a cheap LLM rerank pass: over-fetch from the vector store, let a
 * small/fast model re-order the candidates by true relevance, then keep the
 * best topK.
 *
 * Design constraints:
 * - **Generic**: works over any candidate type via a `getText` accessor, so it
 *   sits between `vector.search()` (MaterializedEntry & { score }) and the
 *   prompt without coupling to the entry shape.
 * - **Cheap tier**: routes through the model router's `classify` task — the
 *   documented fast/cheap tier (sonnet→haiku, gpt-4o→gpt-4o-mini). Reranking is
 *   a relevance-judgement task, not generation, so the cheapest tier fits.
 * - **Never throws**: a rerank is a best-effort quality boost. Any failure
 *   (≤1 candidate, LLM unavailable, malformed JSON, out-of-range/missing
 *   indices) degrades silently to the original recall order, sliced to topK.
 *
 * Mirrors `structured-memory.ts`'s `extractEntitiesViaLLM` provider pattern:
 * dynamic-imports the provider stack to stay lightweight, and accepts an
 * optional injected provider for deterministic tests.
 */

import type { AIProvider, Message } from '../types.js';
import { logger } from '../utils/logger.js';

// ─── Prompt ───

/**
 * System prompt for LLM reranking. Instructs the model to emit a strict JSON
 * permutation of the candidate indices, ordered most-relevant first. Kept tight
 * to maximise parse success on small models.
 */
const RERANK_SYSTEM_PROMPT = `你是一个检索重排器(reranker)。下面会给你一个"查询"和若干带编号的"候选记忆"。
请根据每条候选与查询的语义相关性，从高到低对候选编号重新排序。

规则：
- 越相关的候选，其编号排在 order 数组越靠前。
- order 必须是所有候选编号的一个完整排列：每个编号(从0开始)恰好出现一次，不得遗漏、重复或出现不存在的编号。
- 只判断相关性，不要解释，不要改写候选内容。

只输出严格 JSON，不要任何解释、前后缀或 markdown 代码块，格式严格如下：
{"order":[2,0,1]}`;

/** Max characters of each candidate sent to the model — bounds prompt cost. */
const MAX_CANDIDATE_CHARS = 200;

// ─── Helpers ───

/** Collapse whitespace and truncate so each candidate is one tidy line. */
function oneLine(text: unknown): string {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_CANDIDATE_CHARS);
}

/** Strip a leading/trailing ```json … ``` fence if present. */
function stripJsonFence(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? fence[1].trim() : text.trim();
}

/**
 * Parse an LLM response into a validated ranking permutation.
 *
 * Tolerant of code fences and surrounding prose. Accepts either
 * `{"order":[…]}` or a bare `[…]` array. The result must be a *complete
 * permutation* of `[0, n)` — every index appears exactly once. Anything else
 * (missing field, non-integers, out-of-range, duplicate, wrong length) returns
 * `null` so the caller falls back to the original order.
 *
 * @returns  A length-n array of unique indices in `[0, n)`, or `null`.
 */
function parseOrder(rawText: string, n: number): number[] | null {
  if (!rawText || rawText.trim().length === 0) return null;

  let text = stripJsonFence(rawText);

  // Slice to the outermost JSON if the model wrapped it in prose.
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const firstObj = text.indexOf('{');
    const firstArr = text.indexOf('[');
    const starts = [firstObj, firstArr].filter((i) => i >= 0);
    if (starts.length === 0) return null;
    const start = Math.min(...starts);
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (end <= start) return null;
    text = text.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  let rawOrder: unknown = null;
  if (Array.isArray(parsed)) {
    rawOrder = parsed;
  } else if (parsed && typeof parsed === 'object') {
    rawOrder = (parsed as Record<string, unknown>).order;
  }
  if (!Array.isArray(rawOrder)) return null;

  // Must be a complete permutation of [0, n): correct length, all in-range
  // integers, no duplicates, no missing indices.
  if (rawOrder.length !== n) return null;
  const order: number[] = [];
  const seen = new Set<number>();
  for (const v of rawOrder) {
    if (typeof v !== 'number' || !Number.isInteger(v)) return null;
    if (v < 0 || v >= n) return null; // out of bounds
    if (seen.has(v)) return null; // duplicate
    seen.add(v);
    order.push(v);
  }
  if (seen.size !== n) return null; // missing index (defensive — redundant with length)

  return order;
}

/**
 * Resolve the provider used for reranking.
 *
 * - `opts.provider` (test injection) is used directly when given.
 * - Otherwise the active provider is selected and routed through the model
 *   router's cheap `classify` tier (a no-op unless MIO_MODEL_ROUTER_ENABLED).
 *
 * Lazy-loads the provider stack via dynamic import to keep this module light in
 * the many sync contexts that may pull it in (matches router.ts /
 * structured-memory.ts).
 */
async function resolveRerankProvider(
  opts?: { provider?: AIProvider; model?: string },
): Promise<{ provider: AIProvider; model?: string }> {
  if (opts?.provider) {
    return { provider: opts.provider, model: opts.model };
  }

  const { selectProvider } = await import('../providers/index.js');
  const { getRouterConfig, routeTask, getTaskModel } = await import('../providers/router.js');
  const { getConfig } = await import('../config.js');

  const config = getConfig();
  const base = selectProvider(config.provider, config.model);
  const routerCfg = getRouterConfig();
  const provider = await routeTask('classify', base, routerCfg);
  const model = opts?.model ?? (getTaskModel('classify', routerCfg) || undefined);
  return { provider, model };
}

// ─── Public API ───

/**
 * Rerank retrieval candidates by LLM-judged relevance to `query`, returning the
 * best `topK` in the new order.
 *
 * Generic over the candidate type: `getText` extracts the text to compare for
 * each candidate, so this works directly on vector-store hits, bookmarks, or
 * any other shape without coupling.
 *
 * Best-effort and non-throwing: on `candidates.length <= 1`, an unavailable
 * LLM, malformed/invalid JSON, or any thrown error, it returns the original
 * candidate order sliced to `topK`. It never rejects — callers can `await` it
 * unconditionally in the retrieval path.
 *
 * @param query       The user query / turn text to rank relevance against.
 * @param candidates  Recalled candidates (e.g. vector top-k), in recall order.
 * @param topK        Max number of candidates to return after reranking.
 * @param getText     Extracts the comparable text from a candidate.
 * @param opts        Optional provider/model override (used by tests; the
 *                    4-arg call form is the production path).
 * @returns           Up to `topK` candidates, reranked or in original order.
 */
export async function rerankByLLM<T>(
  query: string,
  candidates: T[],
  topK: number,
  getText: (c: T) => string,
  opts?: { provider?: AIProvider; model?: string },
): Promise<T[]> {
  const limit = Math.max(0, Math.floor(topK));

  // Nothing to reorder (0 or 1 candidate) — skip the LLM entirely.
  if (candidates.length <= 1) {
    return candidates.slice(0, limit);
  }

  try {
    const { provider, model } = await resolveRerankProvider(opts);

    const n = candidates.length;
    const numbered = candidates.map((c, i) => `[${i}] ${oneLine(getText(c))}`).join('\n');
    const userText = `查询：${query}\n\n候选：\n${numbered}`;
    const messages: Message[] = [
      { role: 'user', content: userText, timestamp: new Date().toISOString() },
    ];

    const res = await provider.chat(messages, RERANK_SYSTEM_PROMPT, undefined, {
      temperature: 0,
      model,
    });

    const order = parseOrder(res.text, n);
    if (!order) {
      logger.warn('[rerank] unparseable or invalid order from LLM; using original order', {
        candidates: n,
      });
      return candidates.slice(0, limit);
    }

    const reranked = order.map((i) => candidates[i]);
    return reranked.slice(0, limit);
  } catch (err) {
    logger.warn('[rerank] rerank failed; using original order', { error: String(err) });
    return candidates.slice(0, limit);
  }
}
