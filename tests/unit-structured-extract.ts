#!/usr/bin/env node
/**
 * U5 — LLM structured extraction regression.
 *
 * extractStructuredMemoryLLM() extracts Mem0-style atomic facts via an LLM and
 * falls back to the regex extractor when the LLM is unavailable or its output
 * can't be parsed (offline, MockProvider, API error, malformed JSON).
 *
 * These tests cover both paths deterministically:
 *   - LLM path: an injected provider returns controlled JSON; we assert the
 *     extracted entities appear (leak-proof — the asserted content can't be
 *     produced by the regex extractor from the given input).
 *   - Fallback path: the real MockProvider (MIO_PROVIDER=mock), a non-JSON
 *     provider, and a throwing provider all degrade to regex extraction without
 *     crashing — so `npm test` stays green under mock.
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

const dataDir = mkdtempSync(join(tmpdir(), 'mio-structured-'));
process.env.MIO_DIR = dataDir;
process.env.MIO_PROVIDER = 'mock';
delete process.env.MIO_MODEL_ROUTER_ENABLED;

/** A provider that returns a fixed canned string from chat(). */
class CannedProvider implements AIProvider {
  readonly name = 'canned';
  calls = 0;
  reply = '';
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
  async chat(): Promise<{ text: string }> {
    throw new Error('simulated provider failure');
  }
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — structured extraction tests\x1b[0m\n');

  const { extractStructuredMemoryLLM, extractStructuredMemory } = await import('../dist/memory/structured-memory.js');

  // ── LLM path: injected provider returns controlled JSON ──
  await test('LLM path injects atomic facts from JSON output', async () => {
    // Input deliberately contains NO "建筑师"/"极简" tokens, and nothing the
    // regex extractor would turn into those — so their presence proves the LLM
    // JSON path was used.
    const bookmarks = '- <time=2026-06-01 10:00 +0800> 我们今天聊了挺多的. 都是些日常';
    const provider = new CannedProvider(
      '{"entities":[{"type":"fact","content":"用户是一名建筑师","confidence":0.9},{"type":"preference","content":"喜欢极简主义设计","confidence":0.8}]}',
    );
    const mem = await extractStructuredMemoryLLM(bookmarks, undefined, { provider });

    assertEq(provider.calls, 1, 'provider invoked once');
    assert(
      mem.entities.some((e) => e.type === 'fact' && e.content === '用户是一名建筑师'),
      `fact entity missing; got ${JSON.stringify(mem.entities.map((e) => e.content))}`,
    );
    assert(mem.entities.some((e) => e.content.includes('极简主义')), 'preference entity missing');
    // Confidence carried through from JSON.
    const fact = mem.entities.find((e) => e.content === '用户是一名建筑师');
    assertEq(fact?.confidence, 0.9, 'confidence preserved');
    assertEq(fact?.source, 'llm-extraction', 'source tagged llm-extraction');
  });

  // ── Fallback path: real MockProvider (no injected provider) ──
  await test('falls back to regex under MockProvider without crashing', async () => {
    // MockProvider returns canned non-JSON text → parse fails → regex fallback.
    // The regex preference pattern matches "喜欢喝拿铁咖啡".
    const bookmarks = '- <time=2026-06-02 10:00 +0800> 我喜欢喝拿铁咖啡. 用户说的';
    const mem = await extractStructuredMemoryLLM(bookmarks);
    assert(
      mem.entities.some((e) => e.type === 'preference'),
      `regex preference missing; got ${JSON.stringify(mem.entities.map((e) => `${e.type}:${e.content}`))}`,
    );
    // The mock's canned reply must not leak in as an entity.
    assert(!mem.entities.some((e) => e.content.includes('mock reply')), 'mock text leaked as entity');
  });

  // ── Fallback path: injected non-JSON provider ──
  await test('falls back to regex when LLM output is not JSON', async () => {
    const bookmarks = '- <time=2026-06-03 10:00 +0800> 我喜欢看电影. 周末常去';
    const provider = new CannedProvider('Sorry, I cannot produce that.');
    const mem = await extractStructuredMemoryLLM(bookmarks, undefined, { provider });
    assertEq(provider.calls, 1, 'provider invoked once');
    assert(mem.entities.some((e) => e.type === 'preference'), 'regex fallback preference missing');
    assert(!mem.entities.some((e) => e.content.includes('Sorry')), 'non-JSON text leaked as entity');
  });

  // ── Fallback path: provider throws ──
  await test('falls back to regex when the provider throws', async () => {
    const bookmarks = '- <time=2026-06-04 10:00 +0800> 我喜欢跑步. 每天早上';
    const mem = await extractStructuredMemoryLLM(bookmarks, undefined, { provider: new ThrowingProvider() });
    assert(mem.entities.some((e) => e.type === 'preference'), 'regex fallback after throw missing');
  });

  // ── Validation: invalid types dropped, confidence defaulted/clamped ──
  await test('drops invalid entity types and defaults/clamps confidence', async () => {
    const bookmarks = '- <time=2026-06-05 10:00 +0800> 闲聊. 没什么重点';
    const provider = new CannedProvider(
      '{"entities":[' +
        '{"type":"garbage","content":"应当被丢弃","confidence":0.9},' +
        '{"type":"fact","content":"用户住在上海","confidence":2.5},' +
        '{"type":"emotion","content":"最近有点焦虑"}' +
      ']}',
    );
    const mem = await extractStructuredMemoryLLM(bookmarks, undefined, { provider });

    assert(!mem.entities.some((e) => e.content === '应当被丢弃'), 'invalid type not dropped');
    const fact = mem.entities.find((e) => e.content === '用户住在上海');
    assert(fact !== undefined, 'valid fact missing');
    assertEq(fact!.confidence, 1, 'out-of-range confidence clamped to 1');
    const emotion = mem.entities.find((e) => e.content === '最近有点焦虑');
    assert(emotion !== undefined, 'emotion entity missing');
    assertEq(emotion!.confidence, 0.6, 'missing confidence defaulted to 0.6');
  });

  // ── JSON wrapped in a markdown code fence ──
  await test('parses JSON wrapped in a markdown code fence', async () => {
    const bookmarks = '- <time=2026-06-06 10:00 +0800> 随便聊聊. 无关紧要';
    const provider = new CannedProvider(
      '```json\n{"entities":[{"type":"fact","content":"用户养了一只柯基","confidence":0.7}]}\n```',
    );
    const mem = await extractStructuredMemoryLLM(bookmarks, undefined, { provider });
    assert(mem.entities.some((e) => e.content === '用户养了一只柯基'), 'fenced JSON not parsed');
  });

  // ── Shape preserved + sync regex path still works (regression) ──
  await test('output shape preserved and sync extractStructuredMemory unchanged', async () => {
    const bookmarks = '- <time=2026-06-07 10:00 +0800> 我喜欢喝咖啡. 用户的偏好';
    const llmMem = await extractStructuredMemoryLLM(bookmarks); // mock → fallback
    assert(Array.isArray(llmMem.entities), 'entities is array');
    assert(Array.isArray(llmMem.topics), 'topics is array');
    assert(Array.isArray(llmMem.durableFacts), 'durableFacts is array');
    assert(typeof llmMem.updatedAt === 'string', 'updatedAt is string');

    const syncMem = extractStructuredMemory(bookmarks);
    assert(syncMem.entities.some((e) => e.type === 'preference'), 'sync regex still extracts');
  });

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} structured extraction tests passed\x1b[0m`);
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
  console.error('structured extraction runner crashed:', err);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
});
