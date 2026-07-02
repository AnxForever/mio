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

// Window-sensitive fixtures: prod filters emotions to 72h / events to 14d against
// the real clock, so dates must be relative offsets — absolute dates rot and re-fail.
const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

function entity(input: Partial<MemoryEntity> & Pick<MemoryEntity, 'type' | 'content'>): MemoryEntity {
  return {
    confidence: 0.8,
    firstSeen: iso(27 * DAY),
    lastSeen: iso(1 * HOUR),
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
  firstSeen: iso(3 * DAY),
  lastSeen: iso(1 * DAY),
  occurrences: 2,
});
const recentDecision = entity({
  type: 'decision',
  content: '用户明天准备去医院复查',
  firstSeen: iso(1 * DAY),
  lastSeen: iso(1 * DAY),
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
      dateRange: { start: iso(3 * DAY), end: iso(1 * DAY) },
    },
  ],
  updatedAt: new Date(NOW).toISOString(),
};

const context = buildStructuredMemoryContext(structured) ?? '';
ok(context.includes('当前事实'), 'prompt context labels current facts', context);
ok(context.includes('用户住在上海'), 'prompt context includes confirmed current fact');
ok(!context.includes('用户住在杭州'), 'prompt context excludes ignored fact');
ok(context.includes('当前相关线索'), 'prompt context labels response anchors');
ok(context.includes('先点名最相关的具体线索'), 'prompt context tells replies to ground compound memory questions');
ok(context.includes('不要只问“什么内容”'), 'prompt context discourages ungrounded follow-up when a recent event exists');
ok(context.includes('多日线索'), 'prompt context labels multi-day arcs');
ok(context.includes('不等同于当前状态'), 'prompt context warns multi-day arcs are not current state');
ok(context.includes('近期事件'), 'prompt context labels recent events');
ok(context.includes('近期情绪'), 'prompt context labels recent emotions');
ok(context.includes('不自动当作现在'), 'prompt context warns emotions are time-sensitive');

const emptyContext = buildStructuredMemoryContext({ entities: [], durableFacts: [], topics: [], updatedAt: new Date(NOW).toISOString() });
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
