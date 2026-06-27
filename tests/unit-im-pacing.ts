#!/usr/bin/env node
/**
 * Mio — IM pacing tests (A1: 打字节奏感 / 分段 + 延迟).
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-im-pacing.ts
 */
import {
  splitIntoBubbles,
  computeTypingDelayMs,
  computeBubbleDelaysMs,
  joinBubbles,
  planPacing,
  sleep,
  DEFAULT_PACING,
} from '../dist/server/im-pacing.js';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — IM pacing tests\x1b[0m\n');

// ── splitIntoBubbles ──
{
  ok(splitIntoBubbles('') .length === 0, 'empty → []');
  ok(splitIntoBubbles('   \n  ').length === 0, 'whitespace → []');

  ok(splitIntoBubbles('好呀～').length === 1, 'short single line → not split');

  // 长多句段落 → 拆成多条，每条不超过软上限
  const long = '诶我跟你说今天发生了好多事情真的好想跟你分享。早上起来就发现闹钟没响差点迟到。然后挤地铁被人踩了一脚。中午吃的外卖还是凉的。你说我这一天是不是有点惨。';
  const lb = splitIntoBubbles(long);
  ok(lb.length >= 2, `long multi-sentence → split into ${lb.length} bubbles`);
  ok(lb.every((b) => b.length <= DEFAULT_PACING.maxBubbleChars), 'each bubble within maxBubbleChars');
  ok(lb.join('') .replace(/\s/g, '').length === long.replace(/\s/g, '').length, 'no content lost when splitting');

  // 空行分段
  const para = splitIntoBubbles('第一段想说的话题在这里。\n\n第二段完全不同的话题。');
  ok(para.length >= 2, 'blank-line paragraphs → separate bubbles');

  // 代码块整块保留
  const withCode = '给你看这个写法：\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\n就这样用就行。';
  const cb = splitIntoBubbles(withCode);
  ok(cb.some((b) => b.includes('```js') && b.includes('const b = 2;') && b.trim().endsWith('```')), 'code block kept whole in one bubble');

  // maxBubbles 上限
  const many = splitIntoBubbles('第一段内容写这里。\n\n第二段内容写这里。\n\n第三段内容写这里。\n\n第四段内容写这里。\n\n第五段内容写这里。', { maxBubbles: 3 });
  ok(many.length <= 3, `maxBubbles=3 respected (got ${many.length})`);
  ok(many[many.length - 1].includes('第五段'), 'overflow folded into last bubble');
}

// ── computeTypingDelayMs ──
{
  ok(computeTypingDelayMs('') === DEFAULT_PACING.minMs, 'empty text → minMs floor');
  ok(computeTypingDelayMs('嗯') === DEFAULT_PACING.minMs, 'tiny text clamped to minMs');
  ok(computeTypingDelayMs('字'.repeat(1000)) === DEFAULT_PACING.maxMs, 'huge text clamped to maxMs');

  const short = computeTypingDelayMs('字'.repeat(20));
  const longer = computeTypingDelayMs('字'.repeat(100));
  ok(short < longer, 'delay grows with length (within clamp)');
  ok(short >= DEFAULT_PACING.minMs && longer <= DEFAULT_PACING.maxMs, 'delays stay within [min,max]');

  // options override
  ok(computeTypingDelayMs('字'.repeat(10), { minMs: 100, baseMs: 0, perCharMs: 10, maxMs: 9999 }) === 100, 'custom options honored (clamped to custom min)');
}

// ── computeBubbleDelaysMs ──
{
  const delays = computeBubbleDelaysMs(['短', '这是一条稍微长一点点的气泡内容用来对比']);
  ok(delays.length === 2, 'one delay per bubble');
  ok(delays[0] <= delays[1], 'shorter bubble ≤ longer bubble delay');
}

// ── joinBubbles ──
{
  ok(joinBubbles(['a', 'b', 'c']) === 'a\n\nb\n\nc', 'default separator is blank line');
  ok(joinBubbles(['a', 'b'], '\n') === 'a\nb', 'custom separator honored');
  ok(joinBubbles(['only']) === 'only', 'single bubble → no separator');
  ok(joinBubbles(['a', '  ', 'b']) === 'a\n\nb', 'blank bubbles dropped before join');
}

// ── planPacing + sleep ──
{
  const plan = planPacing('诶我跟你说今天发生了好多事情真的好想跟你分享。早上起来就发现闹钟没响差点迟到。然后挤地铁被人踩了一脚。中午吃的外卖还是凉的。你说我这一天是不是有点惨。');
  ok(plan.bubbles.length >= 2, `planPacing splits into ${plan.bubbles.length} bubbles`);
  ok(plan.text.includes('\n\n'), 'planPacing joined text carries blank-line separators');
  ok(plan.bubbleDelaysMs.length === plan.bubbles.length, 'one delay per bubble');
  ok(plan.initialDelayMs >= DEFAULT_PACING.minMs, 'initial delay respects floor');

  const tiny = planPacing('好呀');
  ok(tiny.bubbles.length === 1 && tiny.text === '好呀', 'planPacing keeps short reply single');

  ok(typeof sleep(0).then === 'function', 'sleep returns a thenable');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} IM pacing tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
