#!/usr/bin/env node
/**
 * Mio — recall cues, transcript scope, and dirty structured memory tests.
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-memory-recall-scope.ts
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    ok(true, name);
  } catch (err) {
    ok(false, `${name} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'mio-memory-scope-'));
process.env.MIO_DIR = dataDir;
process.env.MIO_PROVIDER = 'mock';
delete process.env.MINIMAX_API_KEY;

class EchoFactProvider {
  readonly name = 'echo-fact';
  calls = 0;
  lastUserContent = '';

  async chat(messages: Array<{ content?: unknown }>): Promise<{ text: string }> {
    this.calls++;
    this.lastUserContent = String(messages.at(-1)?.content ?? '');
    const fact = this.lastUserContent.includes('只新增第二条')
      ? '用户只新增第二条'
      : '用户喜欢第一条';
    return { text: JSON.stringify({ entities: [{ type: 'fact', content: fact, confidence: 0.9 }] }) };
  }
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — memory recall/scope tests\x1b[0m\n');

  const { appendTranscript } = await import('../dist/memory/transcript.js');
  const { hybridSearch } = await import('../dist/memory/search.js');
  const { extractStructuredMemoryLLM } = await import('../dist/memory/structured-memory.js');

  await test('compaction recall cues are searchable within the current group scope', async () => {
    const groupAUser1 = 'onebot-group-67890-e2217d3e-111-aaaabbbb';
    const groupAUser2 = 'onebot-group-67890-e2217d3e-222-ccccdddd';
    const groupBUser = 'onebot-group-99999-abcdef12-111-aaaabbbb';

    appendTranscript(groupAUser1, {
      type: 'compaction',
      timestamp: '2026-06-01T10:00:00.000Z',
      summary: '讨论过群A里的咖啡计划',
      recallCues: ['群A秘密拿铁'],
    });
    appendTranscript(groupAUser2, {
      type: 'message',
      timestamp: '2026-06-01T10:01:00.000Z',
      role: 'user',
      content: '群A同频道另一个成员提过秘密拿铁和燕麦奶',
    });
    appendTranscript(groupBUser, {
      type: 'message',
      timestamp: '2026-06-01T10:02:00.000Z',
      role: 'user',
      content: '群B秘密拿铁不该出现',
    });

    const scoped = await hybridSearch({
      query: '秘密拿铁',
      searchMemory: false,
      searchTranscripts: true,
      minScore: 0,
      scope: { sessionId: groupAUser1 },
    });

    assert(scoped.some((r) => r.content.includes('群A秘密拿铁')), 'group A compaction cue missing');
    assert(scoped.some((r) => r.content.includes('燕麦奶')), 'same group different user should be visible');
    assert(!scoped.some((r) => r.content.includes('群B秘密拿铁')), 'different group leaked into scoped search');
  });

  await test('dirty structured memory skips unchanged snapshots and extracts only new lines', async () => {
    const provider = new EchoFactProvider();
    const first = '- <time=2026-06-01 10:00 +0800> 第一条：用户喜欢第一条';
    const mem1 = await extractStructuredMemoryLLM(first, undefined, { provider: provider as never });
    assert(provider.calls === 1, `first extraction calls=${provider.calls}`);
    assert(mem1.extractionState?.processedSourceIds.length === 1, 'first extraction state missing');

    const mem2 = await extractStructuredMemoryLLM(first, mem1, { provider: provider as never });
    assert(provider.calls === 1, `unchanged snapshot should not call provider again; calls=${provider.calls}`);
    assert(mem2 === mem1, 'unchanged extraction should return existing memory object');

    const second = `${first}\n- <time=2026-06-02 10:00 +0800> 只新增第二条：用户只新增第二条`;
    const mem3 = await extractStructuredMemoryLLM(second, mem2, { provider: provider as never });
    assert(provider.calls === 2, `dirty extraction should call provider once more; calls=${provider.calls}`);
    assert(!provider.lastUserContent.includes('第一条：用户喜欢第一条'), 'dirty prompt included already processed line');
    assert(provider.lastUserContent.includes('只新增第二条'), 'dirty prompt did not include new line');
    assert(mem3.entities.some((e) => e.content === '用户喜欢第一条'), 'existing entity lost after dirty merge');
    assert(mem3.entities.some((e) => e.content === '用户只新增第二条'), 'new dirty entity missing');
  });

  const passed = results.filter((r) => r.ok).length;
  console.log('');
  if (passed === results.length) {
    console.log(`\x1b[32m✔ all ${results.length} memory recall/scope tests passed\x1b[0m`);
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  } else {
    console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('memory recall/scope runner crashed:', err);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
});
