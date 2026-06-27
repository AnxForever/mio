#!/usr/bin/env node
/**
 * Mio — Layered Persona (per-user) unit tests.
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-layered-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

// === IMPORTS (each task appends here) ===
const { readPersonaDelta, writePersonaDelta, readPreferences, upsertPreference, patchPersonaDelta } =
  await import('../dist/memory/persona-delta.js');
// === END IMPORTS ===

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — layered persona tests\x1b[0m\n');

// === TESTS ===

// --- Task 1: persona-delta / preferences IO ---
{
  ok(readPersonaDelta() === null, 'missing delta returns null before any write');
  writePersonaDelta({ userId: 'default', personaOverride: '开酒吧的', updatedAt: new Date().toISOString(), history: [] });
  ok(readPersonaDelta()?.personaOverride === '开酒吧的', 'persona-delta write→read roundtrip');
  patchPersonaDelta({ tone: 'teasing' }, 'unit');
  ok(readPersonaDelta()?.tone === 'teasing' && readPersonaDelta()?.personaOverride === '开酒吧的', 'patch merges, keeps prior fields');
  upsertPreference('皮一点别老哄我', 'unit');
  ok((readPreferences()?.explicit.length ?? 0) === 1, 'preference upsert persists');
  upsertPreference('皮一点别老哄我', 'unit');
  ok((readPreferences()?.explicit.length ?? 0) === 1, 'preference upsert dedupes identical rule');
}

// === APPEND NEW TEST BLOCKS ABOVE THIS LINE ===

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} layered-persona tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
