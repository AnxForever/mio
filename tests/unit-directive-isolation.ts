#!/usr/bin/env node
/**
 * Mio — directive-capture isolation tests.
 * Verifies isolated (per-user IM) sessions never write nickname / shared-memory
 * to the GLOBAL relationship-state — they degrade to per-user preferences.
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-directive-isolation.ts
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-dirisol-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

const { captureExplicitDirectives } = await import('../dist/persona/directive-capture.js');
const { readRelationshipState } = await import('../dist/relationship/progression.js');
const { readPreferences } = await import('../dist/memory/persona-delta.js');

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — directive isolation tests\x1b[0m\n');

// --- isolated session (allowGlobalRelationship=false) ---
{
  captureExplicitDirectives('以后叫我小明吧', 'wx-user-1', false);
  ok(readRelationshipState().nicknames.agentCallsUser !== '小明', 'isolated: nickname NOT written to global relationship-state');
  ok(readPreferences('wx-user-1')?.explicit.some((p) => p.rule.includes('小明')) === true, 'isolated: nickname stored as per-user preference');

  captureExplicitDirectives('记住：周末去爬山', 'wx-user-1', false);
  ok(!readRelationshipState().sharedMemories.some((m) => m.includes('爬山')), 'isolated: shared-memory NOT written to global');
  ok(readPreferences('wx-user-1')?.explicit.some((p) => p.rule.includes('爬山')) === true, 'isolated: shared-memory stored as per-user preference');

  // cross-user: another isolated user does not see user-1's data
  ok(readPreferences('wx-user-2') === null, 'isolated: no leakage to another user');
}

// --- global single-user session (allowGlobalRelationship=true) keeps original behavior ---
{
  captureExplicitDirectives('以后叫我阿哲吧', 'default', true);
  ok(readRelationshipState().nicknames.agentCallsUser === '阿哲', 'global: nickname written to relationship-state (original behavior)');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} directive isolation tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
