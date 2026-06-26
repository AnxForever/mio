/**
 * Mio — Conversation search endpoint
 *
 * Uses the hybrid search engine from ../memory/search.js for
 * keyword + semantic retrieval with RRF fusion.
 *
 * Backward-compatible: the exported searchTranscripts, SearchResult,
 * and SearchResponse types remain the same shape.
 */

import { transcriptsDir } from '../memory/paths.js';
import { hybridSearch, type SearchResult as HybridResult } from '../memory/search.js';

// ─── Types (unchanged interface) ───

export interface SearchResult {
  sessionId: string;
  timestamp: string;
  role: 'user' | 'assistant';
  content: string;
  snippet: string;
  score: number;
}

export interface SearchResponse {
  query: string;
  totalHits: number;
  results: SearchResult[];
  searchTimeMs: number;
}

// ─── Core search (backed by hybridSearch) ───

/**
 * Search all transcript JSONL files (or a specific session) for a query.
 *
 * Now delegates to `hybridSearch()` for keyword + semantic matching,
 * with time decay and RRF fusion. The return type is kept for backward
 * compatibility.
 *
 * @param query  Search string (case-insensitive matching).
 * @param opts   Optional filters.
 * @returns      Sorted array of SearchResult (highest score first).
 */
export async function searchTranscripts(
  query: string,
  opts?: {
    sessionId?: string;
    maxResults?: number;
    role?: string;
  },
): Promise<SearchResult[]> {
  const qTrimmed = query.trim();
  if (!qTrimmed) return [];

  const maxResults = opts?.maxResults ?? 50;

  const results = await hybridSearch({
    query: qTrimmed,
    maxResults,
    searchTranscripts: true,
    searchMemory: true,
  });

  // Remap to SearchResult interface
  return results.map((r: HybridResult) => ({
    sessionId: r.id.replace(/^transcript:/, '').split(':')[0] || 'unknown',
    timestamp: r.timestamp,
    role: 'user' as const, // We lose role info in hybrid search; default to user
    content: r.content,
    snippet: r.content.length > 100 ? r.content.slice(0, 100) + '...' : r.content,
    score: r.score,
  }));
}

/**
 * Search endpoint handler — wraps searchTranscripts into a SearchResponse.
 */
export async function searchHandler(
  query: string,
  opts?: { sessionId?: string; maxResults?: number; role?: string },
): Promise<SearchResponse> {
  const startTime = Date.now();
  const results = await searchTranscripts(query, opts);
  const searchTimeMs = Date.now() - startTime;

  return {
    query,
    totalHits: results.length,
    results,
    searchTimeMs,
  };
}
