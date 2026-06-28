#!/usr/bin/env node
/**
 * Mio — begin_dialogs few-shot 定调 tests (C5, borrowed from AstrBot).
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-begin-dialogs.ts
 */
import { buildBeginDialogs, buildDeltaFragment } from '../dist/persona/layered.js';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — begin_dialogs tests\x1b[0m\n');

// --- buildBeginDialogs ---
{
  ok(buildBeginDialogs() === '', 'no dialogs → empty');
  ok(buildBeginDialogs([]) === '', 'empty dialogs → empty');
  const r = buildBeginDialogs([{ user: '今天好累', assistant: '来，靠一下，啥也不用说' }]);
  ok(r.includes('今天好累') && r.includes('靠一下') && r.includes('参考语气'), 'renders a demo dialog pair with guidance');
}

// --- injected via buildDeltaFragment (so it flows through the existing soul section) ---
{
  const f = buildDeltaFragment({ userId: 'u', beginDialogs: [{ user: 'A问', assistant: 'B答' }], updatedAt: '', history: [] });
  ok(f.includes('A问') && f.includes('B答'), 'begin_dialogs injected via delta fragment');

  // delta with begin_dialogs + personaOverride keeps both
  const f2 = buildDeltaFragment({ userId: 'u', personaOverride: '开酒吧的', beginDialogs: [{ user: 'X', assistant: 'Y' }], updatedAt: '', history: [] });
  ok(f2.includes('开酒吧的') && f2.includes('X') && f2.includes('Y'), 'persona override + begin_dialogs both rendered');

  // truly empty delta still empty
  ok(buildDeltaFragment({ userId: 'u', updatedAt: '', history: [] }) === '', 'empty delta → empty fragment');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} begin_dialogs tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
