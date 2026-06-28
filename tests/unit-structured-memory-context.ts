#!/usr/bin/env node
import type { MemoryEntity, StructuredMemory } from '../src/memory/structured-memory.js';

const { buildStructuredMemoryContext } = await import('../dist/prompt/templates.js');

interface TestResult {
  ok: boolean;
  msg: string;
  detail?: string;
}

const results: TestResult[] = [];

function ok(cond: boolean, msg: string, detail?: string): void {
  results.push({ ok: cond, msg, detail });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}${detail ? ` — ${detail}` : ''}`);
}

function entity(input: Partial<MemoryEntity> & Pick<MemoryEntity, 'type' | 'content'>): MemoryEntity {
  return {
    confidence: 0.8,
    firstSeen: '2026-06-01T00:00:00.000Z',
    lastSeen: '2026-06-28T08:00:00.000Z',
    occurrences: 1,
    source: 'unit',
    ...input,
  };
}

console.log('\n\x1b[1mMio — structured memory prompt context tests\x1b[0m\n');

const currentFact = entity({
  type: 'fact',
  content: '用户住在上海',
  confidence: 1,
  occurrences: 3,
  reviewStatus: 'confirmed',
});
const arcEvent = entity({
  type: 'event',
  content: '用户这周在赶项目上线',
  firstSeen: '2026-06-25T00:00:00.000Z',
  lastSeen: '2026-06-27T00:00:00.000Z',
  occurrences: 2,
});
const recentDecision = entity({
  type: 'decision',
  content: '用户明天准备去医院复查',
  firstSeen: '2026-06-27T10:00:00.000Z',
  lastSeen: '2026-06-27T10:00:00.000Z',
});
const recentEmotion = entity({
  type: 'emotion',
  content: '用户有点焦虑',
  confidence: 0.7,
});
const ignoredFact = entity({
  type: 'fact',
  content: '用户住在杭州',
  reviewStatus: 'ignored',
});

const structured: StructuredMemory = {
  entities: [currentFact, arcEvent, recentDecision, recentEmotion, ignoredFact],
  durableFacts: [currentFact, ignoredFact],
  topics: [
    {
      topic: '工作',
      entities: [arcEvent],
      summary: '事件: 用户这周在赶项目上线',
      dateRange: { start: '2026-06-25T00:00:00.000Z', end: '2026-06-27T00:00:00.000Z' },
    },
  ],
  updatedAt: '2026-06-28T09:00:00.000Z',
};

const context = buildStructuredMemoryContext(structured) ?? '';
ok(context.includes('当前事实'), 'prompt context labels current facts', context);
ok(context.includes('用户住在上海'), 'prompt context includes confirmed current fact');
ok(!context.includes('用户住在杭州'), 'prompt context excludes ignored fact');
ok(context.includes('多日线索'), 'prompt context labels multi-day arcs');
ok(context.includes('不等同于当前状态'), 'prompt context warns multi-day arcs are not current state');
ok(context.includes('近期事件'), 'prompt context labels recent events');
ok(context.includes('近期情绪'), 'prompt context labels recent emotions');
ok(context.includes('不自动当作现在'), 'prompt context warns emotions are time-sensitive');

const emptyContext = buildStructuredMemoryContext({ entities: [], durableFacts: [], topics: [], updatedAt: '2026-06-28T09:00:00.000Z' });
ok(emptyContext === null, 'empty structured memory returns null');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} structured memory prompt context tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
for (const result of results.filter((item) => !item.ok)) {
  console.log(`  - ${result.msg}${result.detail ? `: ${result.detail}` : ''}`);
}
process.exit(1);
