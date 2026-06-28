/**
 * Mio — knowledge base: ingest text documents into the vector store (source
 * 'knowledge') and retrieve chunks. Reuses vector.ts (RRF fusion) plus a source
 * filter so KB recall never mixes with bookmarks/memories.
 */
import { chunkText } from './chunking.js';
import { indexEntryWithProvider, search, type MaterializedEntry } from '../vector.js';
import { getEmbeddingProvider } from '../embedding.js';
import * as store from '../sqlite-vector.js';
import { logger } from '../../utils/logger.js';

const KB_SOURCE = 'knowledge' as const;

function chunkId(docId: string, index: number): string {
  return `kb:${docId}:${index}`;
}

/** Ingest a text/markdown document: chunk → embed → store. Returns chunk count. */
export async function ingestDocument(docId: string, text: string): Promise<number> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;
  const provider = getEmbeddingProvider();
  const now = new Date().toISOString();
  for (const c of chunks) {
    await indexEntryWithProvider(
      { id: chunkId(docId, c.index), text: c.text, source: KB_SOURCE, timestamp: now },
      provider,
    );
  }
  logger.info('knowledge base: ingested document', { docId, chunks: chunks.length });
  return chunks.length;
}

/** Search only the knowledge base (source-filtered; RRF fusion when dense). */
export async function searchKnowledge(
  query: string,
  limit = 5,
  minScore = 0.05,
): Promise<Array<MaterializedEntry & { score: number }>> {
  return search(query, limit, minScore, [KB_SOURCE]);
}

/** Delete all chunks of a document by id prefix. Returns count removed. */
export function deleteDocument(docId: string): number {
  const prefix = `kb:${docId}:`;
  let deleted = 0;
  for (const e of store.readAll()) {
    if (e.id.startsWith(prefix) && store.deleteById(e.id)) deleted++;
  }
  return deleted;
}

/** Count knowledge chunks currently in the store. */
export function knowledgeStats(): { chunks: number } {
  let chunks = 0;
  for (const e of store.readAll()) if (e.source === KB_SOURCE) chunks++;
  return { chunks };
}
