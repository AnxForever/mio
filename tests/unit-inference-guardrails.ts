#!/usr/bin/env node
/**
 * Mio — inference loop guardrail tests (streak warning + max-step forced summary).
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-inference-guardrails.ts
 */
import { runInferenceLoop, detectRepeatedToolStreak, MAX_LOOP_TURNS } from '../dist/core/inference-loop.js';
import type { Message, SessionContext } from '../dist/types.js';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — inference guardrails tests\x1b[0m\n');

// --- streak detection (pure) ---
{
  ok(detectRepeatedToolStreak([['a'], ['a'], ['a']], 3) !== null, 'streak: 3x same tool detected');
  ok(detectRepeatedToolStreak([['a'], ['b'], ['a']], 3) === null, 'streak: interleaved → none');
  ok(detectRepeatedToolStreak([['a'], ['a']], 3) === null, 'streak: below threshold → none');
  ok((detectRepeatedToolStreak([['a'], ['a'], ['a']], 3) || '').includes('a'), 'streak: names the looping tool');
}

// --- max-step forced summary (integration with a fake provider that never stops calling tools) ---
{
  let n = 0;
  const fakeProvider = {
    async chat(_m: Message[], _s: string, tools?: unknown[]) {
      if (!tools || tools.length === 0) return { text: '基于现有信息的最终总结' };
      n++;
      return { text: '', toolCalls: [{ id: 't' + n, name: 'spin', input: {} }] };
    },
  };
  const fakeRegistry = {
    listDefs: () => [{ name: 'spin', description: '', inputSchema: { type: 'object', properties: {} } }],
    execute: async (call: { id: string }) => ({ id: call.id, name: 'spin', output: 'spun' }),
  };
  const msgs: Message[] = [{ role: 'user', content: 'hi', timestamp: '' }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await runInferenceLoop(fakeProvider as any, 'sys', msgs, { model: 'test' } as SessionContext, fakeRegistry as any, () => {});

  ok(r.turns === MAX_LOOP_TURNS, `reached max turns (${r.turns})`);
  ok(r.text.includes('总结'), 'max-step forces a tool-free summary (not empty/partial)');
  ok(msgs.some((m) => typeof m.content === 'string' && m.content.includes('工具调用上限')), 'injected the stop-calling-tools nudge');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} inference guardrail tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
