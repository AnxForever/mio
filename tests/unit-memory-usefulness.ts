#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StructuredMemory } from '../dist/memory/structured-memory.js';

const dir = mkdtempSync(join(tmpdir(), 'mio-memory-usefulness-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
process.env.MINIMAX_DISABLE = 'true';

mkdirSync(join(dir, 'memory-bank'), { recursive: true });
writeFileSync(join(dir, 'memory-bank', 'BOOKMARKS.md'), '# Bookmarks\n\n', 'utf-8');

const {
  collectMemoryUsefulnessCandidates,
  appendMemoryUsefulnessTrace,
} = await import('../dist/memory/usefulness.js');
const { memoryUsefulnessTracePath } = await import('../dist/memory/paths.js');
const { writeStructuredMemoryToDisk } = await import('../dist/memory/structured-memory.js');

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

console.log('\n\x1b[1mMio — memory usefulness trace tests\x1b[0m\n');

const memory: StructuredMemory = {
  entities: [
    {
      type: 'preference',
      content: '用户喜欢乌龙茶',
      confidence: 1,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-01T00:00:00.000Z',
      occurrences: 3,
      source: 'unit',
      enabled: true,
      reviewStatus: 'confirmed',
      provenance: {
        sourceType: 'bookmark',
        sourceId: 'oolong-source',
        observedAt: '2026-06-01T00:00:00.000Z',
        excerpt: '- <time=2026-06-01T00:00:00.000Z> 用户喜欢乌龙茶',
      },
    },
    {
      type: 'emotion',
      content: '用户最近有点焦虑',
      confidence: 0.8,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-02T00:00:00.000Z',
      occurrences: 1,
      source: 'unit',
      enabled: false,
      reviewStatus: 'confirmed',
    },
  ],
  topics: [],
  durableFacts: [
    {
      type: 'preference',
      content: '用户喜欢乌龙茶',
      confidence: 1,
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-06-01T00:00:00.000Z',
      occurrences: 3,
      source: 'unit',
      enabled: true,
      reviewStatus: 'confirmed',
    },
  ],
  updatedAt: '2026-06-02T00:00:00.000Z',
};
writeStructuredMemoryToDisk(memory);

const systemPrompt = [
  '## 相关记忆',
  '- 2026-06-01 用户喜欢手冲咖啡',
  '## 长期记忆',
  '- 用户喜欢乌龙茶',
].join('\n');

const candidates = collectMemoryUsefulnessCandidates({
  semanticMemories: [{ text: '用户喜欢手冲咖啡', timestamp: '2026-06-01T00:00:00.000Z', score: 0.92 }],
}, systemPrompt);

ok(candidates.some((candidate) => candidate.kind === 'semantic' && candidate.injected), 'semantic memory injection is collected');
ok(candidates.some((candidate) => candidate.kind === 'structured' && candidate.content === '用户喜欢乌龙茶' && candidate.injected), 'structured memory injection is collected');
ok(!candidates.some((candidate) => candidate.content === '用户最近有点焦虑'), 'disabled structured memory is excluded from trace candidates');

const trace = appendMemoryUsefulnessTrace({
  sessionId: 'unit-memory-usefulness',
  userText: '喝点什么',
  replyText: '给你泡乌龙茶吧，记得你喜欢这个。',
  candidates,
});

ok(trace !== null, 'trace is returned when candidates exist');
ok(trace?.mentionedCount === 1, 'reply mention count is recorded', `mentioned=${trace?.mentionedCount}`);
ok(existsSync(memoryUsefulnessTracePath()), 'memory usefulness trace file is written');

const rows = readFileSync(memoryUsefulnessTracePath(), 'utf-8').trim().split('\n').filter(Boolean);
const logged = JSON.parse(rows[0] ?? '{}') as { sessionId?: string; candidates?: Array<{ content?: string; mentionedInReply?: boolean }> };
ok(logged.sessionId === 'unit-memory-usefulness', 'trace preserves session id');
ok(logged.candidates?.some((candidate) => candidate.content === '用户喜欢乌龙茶' && candidate.mentionedInReply) === true, 'trace marks mentioned structured memory');

const passed = results.filter((r) => r.ok).length;
if (passed !== results.length) {
  console.log(`\n\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

console.log(`\n\x1b[32m✔ all ${results.length} memory usefulness tests passed\x1b[0m`);
rmSync(dir, { recursive: true, force: true });
