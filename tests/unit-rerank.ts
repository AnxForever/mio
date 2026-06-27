#!/usr/bin/env node
/**
 * U6 — LLM rerank regression.
 *
 * rerankByLLM() re-orders recalled candidates by LLM-judged relevance and keeps
 * the best topK. It is best-effort and non-throwing: ≤1 candidate, an
 * unavailable LLM, malformed JSON, or an invalid permutation all degrade to the
 * original recall order, sliced to topK.
 *
 * These tests cover both paths deterministically:
 *   - Rerank path: an injected provider returns a controlled `{"order":[…]}`;
 *     we assert the candidates are re-ordered and sliced to topK.
 *   - Fallback path: the real MockProvider (non-JSON), internal provider
 *     resolution under MIO_PROVIDER=mock, a throwing provider, and every invalid
 *     order (out-of-bounds / missing / duplicate) all return the original order
 *     without crashing — so `npm test` stays green under mock.
 *   - Robustness: bare-array form, markdown code fences, and prose-wrapped JSON
 *     are still parsed.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIProvider, Message, ToolDef, ToolCall } from '../src/types.js';

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

const dataDir = mkdtempSync(join(tmpdir(), 'mio-rerank-'));
process.env.MIO_DIR = dataDir;
process.env.MIO_PROVIDER = 'mock';
delete process.env.MIO_MODEL_ROUTER_ENABLED;

interface Candidate {
  id: string;
  text: string;
}

/** A provider that returns a fixed canned string from chat() and counts calls. */
class CannedProvider implements AIProvider {
  readonly name = 'canned';
  calls = 0;
  reply: string;
  constructor(reply: string) {
    this.reply = reply;
  }
  async chat(
    _messages: Message[],
    _systemPrompt: string,
    _tools?: ToolDef[],
    _opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    this.calls++;
    return { text: this.reply };
  }
}

/** A provider whose chat() throws — simulates an API failure. */
class ThrowingProvider implements AIProvider {
  readonly name = 'throwing';
  calls = 0;
  async chat(): Promise<{ text: string }> {
    this.calls++;
    throw new Error('simulated provider failure');
  }
}

/** Join candidate ids for compact order assertions. */
function ids(cands: Candidate[]): string {
  return cands.map((c) => c.id).join(',');
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — LLM rerank tests\x1b[0m\n');

  const { rerankByLLM } = await import('../dist/memory/rerank.js');
  const { MockProvider } = await import('../dist/providers/mock.js');

  const base: Candidate[] = [
    { id: 'a', text: 'apple pie recipe' },
    { id: 'b', text: 'banana bread' },
    { id: 'c', text: 'cherry tart' },
  ];

  // ── Rerank path: controlled order → reorder + topK ──
  await test('reorders by LLM order and applies topK', async () => {
    const provider = new CannedProvider('{"order":[2,0,1]}');
    const out = await rerankByLLM('dessert', base, 2, (c) => c.text, { provider });
    assertEq(provider.calls, 1, 'provider invoked once');
    assertEq(ids(out), 'c,a', 'reordered to [c,a,b] then sliced to topK=2');
  });

  await test('returns all in new order when topK >= candidate count', async () => {
    const provider = new CannedProvider('{"order":[1,2,0]}');
    const out = await rerankByLLM('dessert', base, 10, (c) => c.text, { provider });
    assertEq(ids(out), 'b,c,a', 'full reorder preserved');
  });

  // ── Fallback path: real MockProvider injected (non-JSON canned reply) ──
  await test('falls back to original order under real MockProvider', async () => {
    const out = await rerankByLLM('dessert', base, 2, (c) => c.text, { provider: new MockProvider() });
    assertEq(ids(out), 'a,b', 'original order, sliced to topK=2');
  });

  // ── Fallback path: no injected provider → internal resolution (MIO_PROVIDER=mock) ──
  await test('falls back via internal provider resolution without crashing', async () => {
    const out = await rerankByLLM('dessert', base, 3, (c) => c.text);
    assertEq(ids(out), 'a,b,c', 'original order preserved');
  });

  // ── Fallback path: provider throws ──
  await test('falls back to original order when the provider throws', async () => {
    const provider = new ThrowingProvider();
    const out = await rerankByLLM('dessert', base, 2, (c) => c.text, { provider });
    assertEq(provider.calls, 1, 'provider invoked once');
    assertEq(ids(out), 'a,b', 'original order after throw');
  });

  // ── Short-circuit: ≤1 candidate never calls the LLM ──
  await test('returns empty for zero candidates without calling the provider', async () => {
    const provider = new CannedProvider('{"order":[0]}');
    const empty: Candidate[] = [];
    const out = await rerankByLLM('dessert', empty, 5, (c) => c.text, { provider });
    assertEq(out.length, 0, 'empty result');
    assertEq(provider.calls, 0, 'provider not called for 0 candidates');
  });

  await test('returns the single candidate without calling the provider', async () => {
    const provider = new CannedProvider('{"order":[0]}');
    const out = await rerankByLLM('dessert', [base[0]], 5, (c) => c.text, { provider });
    assertEq(ids(out), 'a', 'single candidate returned');
    assertEq(provider.calls, 0, 'provider not called for 1 candidate');
  });

  // ── Invalid permutations all fall back to original order ──
  await test('falls back when order contains an out-of-bounds index', async () => {
    const provider = new CannedProvider('{"order":[0,1,5]}');
    const out = await rerankByLLM('dessert', base, 3, (c) => c.text, { provider });
    assertEq(ids(out), 'a,b,c', 'original order on out-of-bounds index');
  });

  await test('falls back when order is missing an index (too few)', async () => {
    const provider = new CannedProvider('{"order":[0,1]}');
    const out = await rerankByLLM('dessert', base, 3, (c) => c.text, { provider });
    assertEq(ids(out), 'a,b,c', 'original order on incomplete permutation');
  });

  await test('falls back when order contains a duplicate index', async () => {
    const provider = new CannedProvider('{"order":[0,0,1]}');
    const out = await rerankByLLM('dessert', base, 3, (c) => c.text, { provider });
    assertEq(ids(out), 'a,b,c', 'original order on duplicate index');
  });

  await test('falls back when output is not JSON at all', async () => {
    const provider = new CannedProvider('Sorry, I cannot rank these.');
    const out = await rerankByLLM('dessert', base, 3, (c) => c.text, { provider });
    assertEq(ids(out), 'a,b,c', 'original order on non-JSON output');
  });

  // ── Robustness: alternate-but-valid output shapes still parse ──
  await test('accepts a bare array order form', async () => {
    const provider = new CannedProvider('[2,1,0]');
    const out = await rerankByLLM('dessert', base, 3, (c) => c.text, { provider });
    assertEq(ids(out), 'c,b,a', 'bare array reordered');
  });

  await test('parses order wrapped in a markdown code fence', async () => {
    const provider = new CannedProvider('```json\n{"order":[2,0,1]}\n```');
    const out = await rerankByLLM('dessert', base, 3, (c) => c.text, { provider });
    assertEq(ids(out), 'c,a,b', 'fenced JSON reordered');
  });

  await test('extracts order from surrounding prose', async () => {
    const provider = new CannedProvider('Here you go: {"order":[1,0,2]} hope that helps');
    const out = await rerankByLLM('dessert', base, 3, (c) => c.text, { provider });
    assertEq(ids(out), 'b,a,c', 'prose-wrapped JSON reordered');
  });

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} rerank tests passed\x1b[0m`);
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
  console.error('rerank runner crashed:', err);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
});
