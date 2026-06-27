#!/usr/bin/env node
/**
 * Mio — reply necessity tests.
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-reply-necessity.ts
 */

import {
  scoreReplyNecessity,
  shouldSkipReplyForNecessity,
  stripReplyNecessityNoise,
} from '../dist/emotion/reply-necessity.js';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — reply necessity tests\x1b[0m\n');

{
  const r = shouldSkipReplyForNecessity('哈哈', { type: 'group', platform: 'onebot' });
  ok(r.skip, 'plain group short reaction is skipped');
  ok(r.score.score < 65, 'short reaction scores below threshold');
}

{
  const r = shouldSkipReplyForNecessity('Mio 帮我看看这个怎么做？', {
    type: 'group',
    platform: 'onebot',
    hasAt: true,
    hasMention: true,
  });
  ok(!r.skip, 'direct mention is not skipped');
  ok(r.score.score >= 65, 'direct mention scores above threshold');
}

{
  const r = scoreReplyNecessity({
    texts: ['这个问题应该怎么处理，可以帮忙看看吗？'],
    pendingCount: 1,
    triggerThreshold: 65,
    hasAt: false,
    hasMention: false,
    isGroupChat: false,
    focusActive: false,
    recentSelfReplies: 0,
    consecutiveSelfReplies: 0,
    effectiveFrequency: 1,
    idleSeconds: 0,
    idleReachedAverage: false,
  });
  ok(r.score >= 65, 'private question/request should be answered');
}

{
  const lowPresence = scoreReplyNecessity({
    texts: ['你觉得这个方案怎么样？'],
    pendingCount: 3,
    triggerThreshold: 65,
    hasAt: false,
    hasMention: true,
    isGroupChat: true,
    focusActive: false,
    recentSelfReplies: 0,
    consecutiveSelfReplies: 0,
    effectiveFrequency: 1,
    idleSeconds: 0,
    idleReachedAverage: false,
  });
  const highPresence = scoreReplyNecessity({
    texts: ['你觉得这个方案怎么样？'],
    pendingCount: 3,
    triggerThreshold: 65,
    hasAt: false,
    hasMention: true,
    isGroupChat: true,
    focusActive: false,
    recentSelfReplies: 3,
    consecutiveSelfReplies: 2,
    effectiveFrequency: 1,
    idleSeconds: 0,
    idleReachedAverage: false,
  });
  ok(highPresence.score < lowPresence.score, 'recent self replies reduce necessity');
}

{
  ok(stripReplyNecessityNoise('[CQ:reply,id=1] @123 还能看看吗？') === '还能看看吗？', 'noise stripper removes reply and at prefixes');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} reply necessity tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
