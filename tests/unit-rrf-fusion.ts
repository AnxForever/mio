#!/usr/bin/env node
/**
 * Mio — RRF hybrid retrieval fusion tests.
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-rrf-fusion.ts
 */
import { rrfFuse, fuseDenseWithKeyword } from '../dist/memory/vector.js';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — RRF fusion tests\x1b[0m\n');

// --- rrfFuse 纯函数 ---
{
  const fused = rrfFuse([['a', 'b', 'c'], ['a', 'c', 'b']]);
  ok(fused.get('a')! > fused.get('b')! && fused.get('a')! > fused.get('c')!, 'rrf: top-in-both ranks highest');
  const sym = rrfFuse([['a', 'b', 'c'], ['c', 'b', 'a']]);
  ok(Math.abs(sym.get('a')! - sym.get('c')!) < 1e-9, 'rrf: symmetric ids tie');

  const single = rrfFuse([['x', 'y', 'z']]);
  ok(single.get('x')! > single.get('y')! && single.get('y')! > single.get('z')!, 'rrf: single ranking preserves order');

  ok(rrfFuse([]).size === 0, 'rrf: empty input → empty');
}

// --- fuseDenseWithKeyword：关键词精确匹配的候选 RRF 后排名上升 ---
{
  // dense 顺序（按 score 降序）：sem1 > sem2 > kw（kw 语义分最低、排最后）
  const denseRanked = [
    { id: 'sem1', text: '今天天气真不错阳光明媚', score: 0.92 },
    { id: 'sem2', text: '心情很愉快很放松', score: 0.85 },
    { id: 'kw', text: '我最爱拿铁咖啡的味道', score: 0.55 },
  ];
  ok(denseRanked[denseRanked.length - 1].id === 'kw', 'baseline: kw is last by dense score');

  const fused = fuseDenseWithKeyword('拿铁咖啡', denseRanked, 3);
  const kwRank = fused.findIndex((e) => e.id === 'kw');
  ok(kwRank >= 0 && kwRank < 2, `rrf: keyword-exact candidate rises into top-2 (was last) → rank ${kwRank}`);

  const top1 = fuseDenseWithKeyword('拿铁咖啡', denseRanked, 1);
  ok(top1.length === 1, 'rrf: respects limit');

  ok(fuseDenseWithKeyword('x', [{ id: 'only', text: 'whatever', score: 0.5 }], 5).length === 1, 'rrf: single candidate safe');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} RRF fusion tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
