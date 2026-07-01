#!/usr/bin/env node
/**
 * Mio — memory-stream tests
 *
 * Tests for src/character/memory-stream.ts — the append-only life-event log.
 * Coverage focus: appendEvent normal path (event + embedding written) and the
 * embedding-failure fallback path (event written WITHOUT embedding).
 *
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-memory-stream.ts
 */

// ─── Set env BEFORE importing anything from dist/ (config caches dataDir) ───
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'mio-memstream-'));
process.env.MIO_DIR = dataDir;
process.env.MINIMAX_DISABLE = 'true';

// Now safe to import — config will pick up MIO_DIR on first load.
const { appendEvent, readEvents } = await import('../dist/character/memory-stream.js');
const { resetEmbeddingProvider, setEmbeddingProviderForTests } = await import('../dist/memory/embedding.js');
const { readBookmarks, clearBookmarks } = await import('../dist/memory/bank.js');

const results: { ok: boolean; msg: string; detail?: string }[] = [];
const ok = (cond: boolean, msg: string, detail?: string): void => {
  results.push({ ok: cond, msg, detail });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}${detail ? ` — ${detail}` : ''}`);
};

resetEmbeddingProvider();

console.log('\n\x1b[1mMio — memory-stream tests\x1b[0m\n');

// ─── Normal path: event written WITH embedding ───
{
  const charName = 'test-char-normal';
  const event = await appendEvent(
    charName,
    'Mio picked up sketching again this afternoon',
    'creative',
    'positive',
  );
  ok(!!event.id, 'normal path: event has id');
  ok(!!event.timestamp, 'normal path: event has timestamp');
  ok(event.type === 'life_event', 'normal path: default type is life_event');

  const events = readEvents(charName);
  ok(events.length === 1, 'normal path: exactly 1 event in stream', `got ${events.length}`);
  ok('embedding' in events[0] && events[0].embedding !== undefined,
    'normal path: event has embedding (TF provider succeeded)');
}

// ─── Multiple events accumulate (append-only) ───
{
  const charName = 'test-char-accumulate';
  await appendEvent(charName, 'first event', 'social', 'neutral');
  await appendEvent(charName, 'second event', 'social', 'neutral');
  await appendEvent(charName, 'third event', 'social', 'neutral');
  const events = readEvents(charName);
  ok(events.length === 3, 'append-only: 3 events accumulate', `got ${events.length}`);
  ok(events[0].description === 'first event', 'append-only: order preserved (first is oldest)');
}

// ─── readEvents on non-existent file returns [] ───
{
  const events = readEvents('nonexistent-char-xyz');
  ok(Array.isArray(events) && events.length === 0, 'readEvents: missing file returns empty array');
}

// ─── Fallback path: embedding failure stores event WITHOUT embedding ───
// Inject a provider that always rejects, to exercise the catch branch.
{
  const failingProvider = {
    type: 'tf' as const,
    get dim() { return 0; },
    embed: async (_texts: string[]): Promise<never> => {
      throw new Error('simulated embedding failure');
    },
  };
  setEmbeddingProviderForTests(failingProvider as any);
  clearBookmarks(); // isolate bookmark assertions

  const charName = 'test-char-fallback';
  const event = await appendEvent(charName, 'event that fails embedding', 'creative', 'positive');
  ok(!!event.id, 'fallback: event still created (not dropped)');

  const events = readEvents(charName);
  ok(events.length === 1, 'fallback: event written to JSONL', `got ${events.length}`);
  ok(!('embedding' in events[0]) || events[0].embedding === undefined,
    'fallback: event has NO embedding field');

  // Observability: a [mem:embedding-fail] bookmark must be recorded so the
  // nightly Phase 3 can count silent degradations.
  const bookmarks = readBookmarks();
  ok(bookmarks.includes('[mem:embedding-fail]'),
    'fallback: [mem:embedding-fail] bookmark recorded');

  // Restore real provider for any subsequent tests.
  setEmbeddingProviderForTests(null);
  resetEmbeddingProvider();
  clearBookmarks();
}

// ─── Cleanup ───
try {
  rmSync(dataDir, { recursive: true, force: true });
} catch {
  // best-effort
}

// ─── Summary ───
const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} memory-stream tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
