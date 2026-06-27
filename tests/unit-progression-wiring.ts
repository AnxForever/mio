#!/usr/bin/env node
/**
 * Mio — relationship progression wiring tests ("接电" batch 1).
 *
 * Verifies the three dead wires are now live:
 *   - emotionalDepth grows from meaningful exchanges (was frozen at 0 → relationship
 *     could never advance past "acquaintance").
 *   - checkProgression advances the stage at threshold (was only called in nightly,
 *     which is never armed under serve).
 *   - interactionCount climbs per turn (drives the progression arc).
 *
 * Run:
 *   npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-progression-wiring.ts
 */

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-prog-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

const { trackEmotion } = await import('../dist/emotion/tracker.js');
const prog = await import('../dist/relationship/progression.js');

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — progression wiring tests\x1b[0m\n');

// 1. emotionalDepth grows from a meaningful exchange (was frozen at 0 forever).
const d0 = prog.readRelationshipState().emotionalDepth;
trackEmotion(
  '今天和你聊得特别开心，谢谢你一直陪着我，真的很温暖',
  '我也很开心呀，能陪着你是我最幸福的事，你今天也辛苦啦',
  'sess-1',
);
const d1 = prog.readRelationshipState().emotionalDepth;
ok(d0 === 0 && d1 > 0, `emotionalDepth grows after a meaningful exchange (${d0} → ${d1})`);

// 2. checkProgression advances the stage once thresholds are met (acquaintance → familiar
//    needs 50+ interactions and 10+ depth). Previously this only ran in nightly.
ok(prog.readRelationshipState().stage === 'acquaintance', 'starts at acquaintance');
for (let i = 0; i < 55; i++) prog.recordInteraction();
prog.recordEmotionalDepth(12);
const advanced = prog.checkProgression();
const stage = prog.readRelationshipState().stage;
ok(advanced && stage === 'familiar', `advances acquaintance → familiar at threshold (advanced=${advanced}, stage=${stage})`);

// 3. interactionCount climbs per turn (the arc keeps moving forward).
const i0 = prog.readRelationshipState().interactionCount;
trackEmotion('在吗', '在的，怎么啦～', 'sess-1');
const i1 = prog.readRelationshipState().interactionCount;
ok(i1 > i0, `interactionCount climbs per turn (${i0} → ${i1})`);

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} progression wiring tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
