#!/usr/bin/env node
/**
 * Mio — knowledge base ingest CLI.
 *
 * Usage (build first so dist/ exists):
 *   npm run build
 *   MIO_PROVIDER=mock node --experimental-strip-types scripts/kb-ingest.ts <docId> <file.txt|file.md>
 *
 * Ingests a text/markdown file into the knowledge base (recursive chunk +
 * embed via the active provider). Set a provider key (e.g. MINIMAX_API_KEY) for
 * dense embeddings; MIO_PROVIDER=mock uses free TF.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ingestDocument, knowledgeStats } from '../dist/memory/knowledge-base/kb.js';

async function main(): Promise<void> {
  const [docIdArg, file] = process.argv.slice(2);
  if (!file) {
    console.error('Usage: node --experimental-strip-types scripts/kb-ingest.ts <docId> <file.txt|file.md>');
    process.exit(1);
  }
  const docId = docIdArg || basename(file).replace(/\.[^.]+$/, '');
  const text = readFileSync(file, 'utf-8');
  const n = await ingestDocument(docId, text);
  console.log(`✔ ingested "${docId}": ${n} chunks (total ${knowledgeStats().chunks} in KB)`);
}

main().catch((err) => {
  console.error('ingest failed:', err);
  process.exit(1);
});
