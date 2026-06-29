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

  const {
    deriveStructuredStateView,
    extractStructuredMemoryLLM,
    extractStructuredMemory,
    renderStructuredStateView,
  } = await import('../dist/memory/structured-memory.js');

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

  await test('sync path resolves current fact conflicts and keeps latest fact prompt-facing', async () => {
    const oldFact = {
      type: 'fact',
      content: '用户住在北京',
      confidence: 1,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-01T00:00:00.000Z',
      occurrences: 3,
      source: 'unit',
      reviewStatus: 'confirmed',
    };
    const existing = {
      entities: [oldFact],
      durableFacts: [oldFact],
      topics: [],
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const bookmarks = '- <time=2026-06-28T10:00:00.000Z> 用户住在上海. 当前住址';
    const mem = extractStructuredMemory(bookmarks, existing);
    const oldStored = mem.entities.find((entity) => entity.content === '用户住在北京');
    assert(oldStored?.invalidatedAt, 'old current fact should be invalidated');
    assert(oldStored?.supersededBy?.includes('上海'), `old fact should point at Shanghai successor: ${oldStored?.supersededBy}`);

    const view = deriveStructuredStateView(mem, new Date('2026-06-28T12:00:00.000Z'));
    assert(!view.currentFacts.some((entity) => entity.content.includes('北京')), 'old city should not remain prompt-facing current fact');
    assert(view.currentFacts.some((entity) => entity.content.includes('上海')), 'latest city should become prompt-facing current fact');
  });

  await test('sync path resolves negated calling preference', async () => {
    const oldPreference = {
      type: 'preference',
      content: '喜欢你叫我哥哥',
      confidence: 0.95,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-01T00:00:00.000Z',
      occurrences: 3,
      source: 'unit',
    };
    const existing = {
      entities: [oldPreference],
      durableFacts: [oldPreference],
      topics: [],
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const bookmarks = '- <time=2026-06-28T10:00:00.000Z> 以后别叫哥哥了，叫我名字就好. 用户修正称呼偏好';
    const mem = extractStructuredMemory(bookmarks, existing);
    const oldStored = mem.entities.find((entity) => entity.content === '喜欢你叫我哥哥');
    assert(oldStored?.invalidatedAt, 'old calling preference should be invalidated');

    const view = deriveStructuredStateView(mem, new Date('2026-06-28T12:00:00.000Z'));
    assert(!view.currentFacts.some((entity) => entity.content === '喜欢你叫我哥哥'), 'old calling preference should not remain current');
    assert(view.currentFacts.some((entity) => entity.content.includes('别叫哥哥')), 'new calling preference should become current');
  });

  await test('sync path resolves current drink preference conflicts', async () => {
    const oldPreference = {
      type: 'preference',
      content: '喜欢喝咖啡',
      confidence: 0.95,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-01T00:00:00.000Z',
      occurrences: 3,
      source: 'unit',
    };
    const existing = {
      entities: [oldPreference],
      durableFacts: [oldPreference],
      topics: [],
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const bookmarks = '- <time=2026-06-28T10:00:00.000Z> 现在不喝咖啡了，改喝奶茶. 用户修正饮品偏好';
    const mem = extractStructuredMemory(bookmarks, existing);
    const oldStored = mem.entities.find((entity) => entity.content === '喜欢喝咖啡');
    assert(oldStored?.invalidatedAt, 'old drink preference should be invalidated');

    const view = deriveStructuredStateView(mem, new Date('2026-06-28T12:00:00.000Z'));
    const rendered = renderStructuredStateView(view) ?? '';
    assert(!view.currentFacts.some((entity) => entity.content === '喜欢喝咖啡'), 'old drink preference should not remain current');
    assert(view.currentFacts.some((entity) => entity.content.includes('奶茶')), 'latest drink preference should become current');
    assert(!rendered.includes('喜欢喝咖啡'), 'old drink preference should not enter structured prompt context');
  });

  await test('sync path resolves current support-style conflicts', async () => {
    const oldPreference = {
      type: 'preference',
      content: '难受时需要给我建议',
      confidence: 0.95,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-01T00:00:00.000Z',
      occurrences: 3,
      source: 'unit',
    };
    const existing = {
      entities: [oldPreference],
      durableFacts: [oldPreference],
      topics: [],
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const bookmarks = '- <time=2026-06-28T10:00:00.000Z> 今天别给我建议，只想你陪我. 用户修正支持方式';
    const mem = extractStructuredMemory(bookmarks, existing);
    const oldStored = mem.entities.find((entity) => entity.content === '难受时需要给我建议');
    assert(oldStored?.invalidatedAt, 'old support style should be invalidated');

    const view = deriveStructuredStateView(mem, new Date('2026-06-28T12:00:00.000Z'));
    const rendered = renderStructuredStateView(view) ?? '';
    assert(!view.currentFacts.some((entity) => entity.content === '难受时需要给我建议'), 'old support style should not remain current');
    assert(view.currentFacts.some((entity) => entity.content.includes('别给我建议')), 'latest support style should become current');
    assert(!rendered.includes('难受时需要给我建议'), 'old support style should not enter structured prompt context');
  });

  await test('sync path resolves current relationship-boundary conflicts', async () => {
    const oldPreference = {
      type: 'preference',
      content: '喜欢你叫我宝贝',
      confidence: 0.95,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-01T00:00:00.000Z',
      occurrences: 3,
      source: 'unit',
    };
    const existing = {
      entities: [oldPreference],
      durableFacts: [oldPreference],
      topics: [],
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const bookmarks = '- <time=2026-06-28T10:00:00.000Z> 我们还是慢慢来，别叫宝贝. 用户修正关系边界';
    const mem = extractStructuredMemory(bookmarks, existing);
    const oldStored = mem.entities.find((entity) => entity.content === '喜欢你叫我宝贝');
    assert(oldStored?.invalidatedAt, 'old relationship boundary should be invalidated');

    const view = deriveStructuredStateView(mem, new Date('2026-06-28T12:00:00.000Z'));
    const rendered = renderStructuredStateView(view) ?? '';
    assert(!view.currentFacts.some((entity) => entity.content === '喜欢你叫我宝贝'), 'old relationship boundary should not remain current');
    assert(view.currentFacts.some((entity) => entity.content.includes('慢慢来') || entity.content.includes('别叫宝贝')), 'latest relationship boundary should become current');
    assert(!rendered.includes('喜欢你叫我宝贝'), 'old relationship boundary should not enter structured prompt context');
  });

  await test('sync path resolves current project context conflicts', async () => {
    const oldFact = {
      type: 'fact',
      content: '用户现在在做论文',
      confidence: 0.95,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-01T00:00:00.000Z',
      occurrences: 3,
      source: 'unit',
    };
    const existing = {
      entities: [oldFact],
      durableFacts: [oldFact],
      topics: [],
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const bookmarks = '- <time=2026-06-28T10:00:00.000Z> 现在不做论文了，改做简历. 用户修正当前项目';
    const mem = extractStructuredMemory(bookmarks, existing);
    const oldStored = mem.entities.find((entity) => entity.content === '用户现在在做论文');
    assert(oldStored?.invalidatedAt, 'old project context should be invalidated');

    const view = deriveStructuredStateView(mem, new Date('2026-06-28T12:00:00.000Z'));
    const rendered = renderStructuredStateView(view) ?? '';
    assert(!view.currentFacts.some((entity) => entity.content === '用户现在在做论文'), 'old project context should not remain current');
    assert(view.currentFacts.some((entity) => entity.content.includes('简历')), 'latest project context should become current');
    assert(!rendered.includes('用户现在在做论文'), 'old project context should not enter structured prompt context');
  });

  await test('structured state view separates current facts, multi-day arcs, recent events, and emotions', async () => {
    const fact = {
      type: 'fact',
      content: '用户住在上海',
      confidence: 1,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-20T00:00:00.000Z',
      occurrences: 3,
      source: 'unit',
      reviewStatus: 'confirmed',
    };
    const preference = {
      type: 'preference',
      content: '用户喜欢乌龙茶',
      confidence: 0.95,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-22T00:00:00.000Z',
      occurrences: 3,
      source: 'unit',
    };
    const arcEvent = {
      type: 'event',
      content: '用户这周在赶项目上线',
      confidence: 0.8,
      firstSeen: '2026-06-25T00:00:00.000Z',
      lastSeen: '2026-06-27T00:00:00.000Z',
      occurrences: 2,
      source: 'unit',
    };
    const recentDecision = {
      type: 'decision',
      content: '用户明天准备去医院复查',
      confidence: 0.75,
      firstSeen: '2026-06-27T10:00:00.000Z',
      lastSeen: '2026-06-27T10:00:00.000Z',
      occurrences: 1,
      source: 'unit',
    };
    const recentEmotion = {
      type: 'emotion',
      content: '用户有点焦虑',
      confidence: 0.7,
      firstSeen: '2026-06-28T08:00:00.000Z',
      lastSeen: '2026-06-28T08:00:00.000Z',
      occurrences: 1,
      source: 'unit',
    };
    const ignoredFact = {
      ...fact,
      content: '用户住在杭州',
      reviewStatus: 'ignored',
    };
    const invalidatedFact = {
      ...fact,
      content: '用户住在北京',
      invalidatedAt: '2026-06-20T00:00:00.000Z',
    };
    const disabledPreference = {
      ...preference,
      content: '用户喜欢普洱茶',
      enabled: false,
    };
    const structured = {
      entities: [fact, preference, arcEvent, recentDecision, recentEmotion, ignoredFact, invalidatedFact, disabledPreference],
      durableFacts: [fact, preference, ignoredFact, invalidatedFact, disabledPreference],
      topics: [
        {
          topic: '工作',
          entities: [arcEvent],
          summary: '事件: 用户这周在赶项目上线',
          dateRange: { start: '2026-06-25T00:00:00.000Z', end: '2026-06-27T00:00:00.000Z' },
        },
        {
          topic: '健康',
          entities: [recentDecision, recentEmotion],
          summary: '事件: 用户明天准备去医院复查 | 情绪: 用户有点焦虑',
          dateRange: { start: '2026-06-27T10:00:00.000Z', end: '2026-06-28T08:00:00.000Z' },
        },
      ],
      updatedAt: '2026-06-28T09:00:00.000Z',
    };

    const view = deriveStructuredStateView(structured, new Date('2026-06-28T09:00:00.000Z'));
    assert(view.currentFacts.some((entity) => entity.content === '用户住在上海'), 'confirmed fact should be current fact');
    assert(view.currentFacts.some((entity) => entity.content === '用户喜欢乌龙茶'), 'durable preference should be current fact');
    assert(!view.currentFacts.some((entity) => entity.content === '用户住在杭州'), 'ignored fact should be excluded');
    assert(!view.currentFacts.some((entity) => entity.content === '用户住在北京'), 'invalidated fact should be excluded');
    assert(!view.currentFacts.some((entity) => entity.content === '用户喜欢普洱茶'), 'disabled preference should be excluded');
    assert(view.multiDayArcs.some((topic) => topic.topic === '工作'), 'multi-day work topic should be an arc');
    assert(!view.recentEvents.some((entity) => entity.content === '用户这周在赶项目上线'), 'arc event should not be duplicated as recent event');
    assert(view.recentEvents.some((entity) => entity.content === '用户明天准备去医院复查'), 'single recent decision should be recent event');
    assert(view.recentEmotions.some((entity) => entity.content === '用户有点焦虑'), 'recent emotion should be recent emotion');

    const rendered = renderStructuredStateView(view) ?? '';
    assert(rendered.includes('当前事实'), 'rendered view should label current facts');
    assert(rendered.includes('多日线索'), 'rendered view should label multi-day arcs');
    assert(rendered.includes('近期事件'), 'rendered view should label recent events');
    assert(rendered.includes('不等同于当前状态'), 'rendered view should warn arcs are not current state');
    assert(rendered.includes('不自动当作现在'), 'rendered view should warn emotions are time-sensitive');
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
