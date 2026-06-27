#!/usr/bin/env node
/**
 * Mio — context compression tests (round-aware token budget + halving fallback).
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-compression.ts
 */
import { compressIfNeeded, estimateTotalTokens } from '../dist/memory/compression.js';
import type { Message } from '../dist/types.js';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — compression tests\x1b[0m\n');

const msg = (role: 'user' | 'assistant', text: string): Message => ({ role, content: text, timestamp: '' });

// --- short conversation: untouched ---
{
  const short = [msg('user', '在吗'), msg('assistant', '在的')];
  const r = compressIfNeeded(short, { maxTokens: 1000 });
  ok(r.removedCount === 0 && r.messages.length === 2, 'short convo not compressed');
}

// --- long conversation: round-aware token-budget keep + summary ---
{
  const long: Message[] = [];
  for (let i = 0; i < 24; i++) long.push(msg(i % 2 === 0 ? 'user' : 'assistant', `这是第${i}条消息`.repeat(15)));
  const cfg = { maxTokens: 600, keepOldest: 2, keepRecent: 4, keepRecentTokens: 300 };
  const r = compressIfNeeded(long, cfg);

  ok(r.removedCount > 0, 'long convo compressed');
  ok(r.messages.length < long.length, 'fewer messages after compression');
  ok(r.summary.includes('摘要'), 'middle section summarized');
  ok(r.summary.includes('召回线索'), 'summary includes recall cues');
  ok(r.recallCues.length > 0, 'compression returns recall cues');
  ok(r.messages[r.messages.length - 1].content === long[long.length - 1].content, 'latest message always kept');
  ok(r.messages[cfg.keepOldest].role === 'user', 'recent section starts at a user turn (round-aware)');
  ok(estimateTotalTokens(r.messages) <= cfg.maxTokens, 'kept within token budget');
}

// --- default config runs end-to-end ---
{
  const long: Message[] = [];
  for (let i = 0; i < 120; i++) long.push(msg(i % 2 === 0 ? 'user' : 'assistant', `闲聊内容${i}`.repeat(30)));
  const r = compressIfNeeded(long);
  ok(r.removedCount > 0 && r.messages.length < long.length, 'default config compresses a very long convo');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} compression tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
