#!/usr/bin/env node
/**
 * Mio — per-persona tool allowlist tests (C4, borrowed from AstrBot Persona.tools).
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-persona-tool-allowlist.ts
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-tool-allow-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

const { scopedToolRegistry } = await import('../dist/core/tool-runtime.js');
const { writePersonaDelta } = await import('../dist/memory/persona-delta.js');
import type { SessionContext } from '../dist/types.js';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — per-persona tool allowlist tests\x1b[0m\n');

const ALL = [
  { name: 'recall_memories', description: '', inputSchema: { type: 'object', properties: {} } },
  { name: 'current_time', description: '', inputSchema: { type: 'object', properties: {} } },
  { name: 'read_file', description: '', inputSchema: { type: 'object', properties: {} } },
];
const baseReg = {
  listDefs: (names?: string[]) => (names ? ALL.filter((d) => names.includes(d.name)) : ALL),
  execute: async (call: { id: string; name: string }) => ({ id: call.id, name: call.name, output: 'ok' }),
};

// --- no allowlist → all tools ---
{
  const s = scopedToolRegistry(baseReg as never, { sessionId: 'u1', isolatedMemory: false } as SessionContext);
  ok(s.listDefs().length === 3, 'no allowlist → all tools visible');
}

// --- allowlist → only whitelisted ---
{
  writePersonaDelta({ userId: 'u2', allowedTools: ['recall_memories'], updatedAt: '', history: [] });
  const s = scopedToolRegistry(baseReg as never, { sessionId: 'u2', isolatedMemory: false } as SessionContext);
  ok(s.listDefs().length === 1 && s.listDefs()[0].name === 'recall_memories', 'allowlist → only whitelisted tool visible');
  const ex = await s.execute({ id: '1', name: 'read_file', input: {} }, {} as SessionContext);
  ok(ex.isError === true, 'non-whitelisted tool execution rejected');
  const ok2 = await s.execute({ id: '2', name: 'recall_memories', input: {} }, {} as SessionContext);
  ok(ok2.isError !== true && ok2.output === 'ok', 'whitelisted tool still executes');
}

// --- isolated session unaffected by allowlist (still current_time only) ---
{
  writePersonaDelta({ userId: 'u3', allowedTools: ['recall_memories'], updatedAt: '', history: [] });
  const s = scopedToolRegistry(baseReg as never, { sessionId: 'u3', isolatedMemory: true } as SessionContext);
  ok(s.listDefs().every((d) => d.name === 'current_time'), 'isolated session: still current_time only (not the persona allowlist)');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} persona tool allowlist tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
