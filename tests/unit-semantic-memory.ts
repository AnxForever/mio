#!/usr/bin/env node
/**
 * U3 — semantic memory injection regression.
 *
 * Verifies that memories prefetched by vector.search() for the current input
 * are injected into the assembled system prompt (the "相关记忆" section).
 *
 * The test is designed to be leak-proof: the relevant memory is the OLDEST
 * bookmark (so it is NOT in the recency anchor of the 3 most-recent
 * bookmarks), and we assert on a token ("燕麦奶") that exists ONLY in that
 * memory's stored text — not in the input, the recent fillers, or the soul.
 * If it appears in the system prompt, it can only have arrived via semantic
 * retrieval.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIProvider, Message } from '../src/types.js';

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(name, false, msg);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'mio-semantic-'));
process.env.MIO_DIR = dataDir;
process.env.MIO_PROVIDER = 'mock';
delete process.env.MINIMAX_API_KEY;   // force TF embeddings (offline, deterministic)
delete process.env.MINIMAX_DISABLE;

/** Captures the system prompt passed to chat() so we can assert on it. */
class SystemPromptCaptureProvider implements AIProvider {
  name = 'system-prompt-capture';
  systemPrompt = '';

  async chat(_messages: Message[], systemPrompt: string): Promise<{ text: string }> {
    this.systemPrompt = systemPrompt;
    return { text: 'captured' };
  }
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — semantic memory injection tests\x1b[0m\n');

  const { runTurn } = await import('../dist/core/agent-loop.js');
  const { appendBookmark, ensureBankStructure } = await import('../dist/memory/bank.js');
  const { reindexBookmarks } = await import('../dist/memory/vector.js');
  const { resetEmbeddingProvider } = await import('../dist/memory/embedding.js');
  const { getConfig, updateConfig } = await import('../dist/config.js');
  const { writeRelationshipState, defaultRelationshipState } = await import('../dist/relationship/progression.js');
  const { writeEmotionState, defaultEmotionState } = await import('../dist/emotion/state.js');

  ensureBankStructure();
  resetEmbeddingProvider();

  // One OLD, semantically-distinct memory about coffee. "燕麦奶" appears ONLY
  // here, and the timestamp is the earliest so it falls outside the recent-3
  // recency anchor.
  appendBookmark({ time: '2026-05-01 09:00 +0800', what: '你说最爱喝拿铁咖啡', evidence: '尤其是燕麦奶做的拿铁' });

  // Five newer, unrelated fillers — these dominate readRecentBookmarks(3).
  const fillers = [
    { time: '2026-06-10 09:00 +0800', what: '今天下雨没带伞', evidence: '淋湿了有点感冒' },
    { time: '2026-06-11 09:00 +0800', what: '加班到很晚', evidence: '项目快要上线了' },
    { time: '2026-06-12 09:00 +0800', what: '周末想去爬山', evidence: '天气预报说是晴天' },
    { time: '2026-06-13 09:00 +0800', what: '买了一本新书', evidence: '是讲历史的' },
    { time: '2026-06-14 09:00 +0800', what: '楼下新开了面馆', evidence: '味道还算不错' },
  ];
  for (const f of fillers) appendBookmark(f);

  const indexed = await reindexBookmarks();

  await test('reindex covers all six bookmarks', () => {
    assert(indexed >= 6, `indexed ${indexed} entries`);
  });

  // Disable ghost so the turn always runs inference; reset relational state.
  const prev = getConfig();
  writeRelationshipState(defaultRelationshipState());
  writeEmotionState(defaultEmotionState());
  updateConfig({ features: { ...prev.features, ghost: false } });

  const capture = new SystemPromptCaptureProvider();
  try {
    // Semantically related to the OLD coffee memory; shares no tokens with the
    // recent fillers and does not itself contain "燕麦奶".
    await runTurn({ text: '我突然好想喝拿铁咖啡' }, { provider: capture });
  } finally {
    updateConfig({ features: prev.features });
  }

  await test('system prompt contains the 相关记忆 (semantic) section', () => {
    assert(
      capture.systemPrompt.includes('相关记忆'),
      `missing 相关记忆 section; prompt tail=${JSON.stringify(capture.systemPrompt.slice(-200))}`,
    );
  });

  await test('semantic retrieval injects the relevant non-recent memory', () => {
    // "燕麦奶" lives only in the oldest coffee bookmark's text. Its presence in
    // the system prompt proves it was pulled in by semantic search, not by the
    // recency anchor (which only holds the 3 newest fillers).
    assert(
      capture.systemPrompt.includes('燕麦奶'),
      `coffee memory not injected; prompt tail=${JSON.stringify(capture.systemPrompt.slice(-300))}`,
    );
  });

  await test('recency anchor (最近发生的事) is still present alongside semantics', () => {
    assert(capture.systemPrompt.includes('最近发生的事'), 'recency anchor missing');
  });

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} semantic memory tests passed\x1b[0m`);
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  } else {
    console.log(`\x1b[31m✘ ${total - passed}/${total} failed\x1b[0m`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('semantic memory runner crashed:', err);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
});
