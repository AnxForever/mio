#!/usr/bin/env node
/**
 * Unit test for eval/health-check.ts (Phase 0 工作流 A).
 *
 * 端到端：造合成 transcript + 记忆文件 → 子进程跑真脚本 → 读 health-report.json 验证已知期望值。
 * 这样同时验证 assessDepth 接线、配对逻辑、记忆计数，且不依赖 runtime .ts import。
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface TestResult { name: string; passed: boolean; detail?: string; }
const results: TestResult[] = [];
function record(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'mio-health-'));

try {
  // ── 造合成数据 ──
  mkdirSync(join(tmp, 'transcripts'), { recursive: true });
  mkdirSync(join(tmp, 'memory-bank'), { recursive: true });

  const entries = [
    { type: 'message', role: 'user', content: '嗯', timestamp: '2026-06-01T10:00:00.000Z' },
    { type: 'message', role: 'assistant', content: '嗯嗯', timestamp: '2026-06-01T10:00:05.000Z' },
    { type: 'tool_call', timestamp: '2026-06-01T10:00:06.000Z', toolName: 'noop' }, // 应被忽略
    { type: 'message', role: 'user', content: '好的', timestamp: '2026-06-02T11:00:00.000Z' },
    { type: 'message', role: 'assistant', content: '哦', timestamp: '2026-06-02T11:00:05.000Z' },
    { type: 'message', role: 'user', content: 'u-被覆盖', timestamp: '2026-06-08T12:00:00.000Z' },
    { type: 'message', role: 'user', content: '我今天特别难过，想起以前的事就忍不住哭', timestamp: '2026-06-08T12:01:00.000Z' },
    { type: 'message', role: 'assistant', content: '我在，别一个人扛着，慢慢说，我陪你，不着急', timestamp: '2026-06-08T12:01:05.000Z' },
    { type: 'message', role: 'assistant', content: '没有前导 user 的回复', timestamp: '2026-06-08T12:02:00.000Z' }, // 应被忽略
  ];
  writeFileSync(
    join(tmp, 'transcripts', 'sess1.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf-8',
  );

  writeFileSync(
    join(tmp, 'memory-bank', 'structured-memory.json'),
    JSON.stringify({
      entities: [{ reviewStatus: 'confirmed' }, { reviewStatus: 'pending' }],
      durableFacts: [{}, {}, {}],
    }),
    'utf-8',
  );
  writeFileSync(
    join(tmp, 'ritual-state.json'),
    JSON.stringify({ rituals: [{ significance: 0.5 }, { significance: 0.1 }] }),
    'utf-8',
  );

  // ── 跑真脚本 ──
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', join(root, 'eval', 'health-check.ts'), '--data', tmp, '--out', join(tmp, 'out')],
    { stdio: 'pipe', env: { ...process.env, MIO_PROVIDER: 'mock', MINIMAX_DISABLE: 'true' } },
  );

  const report = JSON.parse(readFileSync(join(tmp, 'out', 'health-report.json'), 'utf-8'));

  // ── 断言已知期望值 ──
  record('配对 3 个 exchange（忽略 tool_call + 悬空 assistant）', report.volume.exchanges === 3, `got ${report.volume.exchanges}`);
  record('纸板样本数 = 3', report.cardboard.count === 3, `got ${report.cardboard.count}`);
  record('纸板均值在 [0,1]', typeof report.cardboard.mean === 'number' && report.cardboard.mean >= 0 && report.cardboard.mean <= 1, `mean=${report.cardboard.mean}`);
  record('两条浅回应纸板分 > 深回应', report.cardboard.mean > 0, `mean=${report.cardboard.mean}`);
  record('最后一个 exchange 取最近 user（深）非"u-被覆盖"', report.cardboard.histogram.reduce((a: number, b: number) => a + b, 0) === 3);
  record('durableFacts = 3', report.memory.durableFacts === 3, `got ${report.memory.durableFacts}`);
  record('structuredEntities = 2', report.memory.structuredEntities === 2, `got ${report.memory.structuredEntities}`);
  record('byReviewStatus confirmed=1 pending=1', report.memory.byReviewStatus.confirmed === 1 && report.memory.byReviewStatus.pending === 1, JSON.stringify(report.memory.byReviewStatus));
  record('rituals=2 promoted=1', report.memory.rituals === 2 && report.memory.promotedRituals === 1, `rituals=${report.memory.rituals} promoted=${report.memory.promotedRituals}`);
  record('repetition.replies = 3', report.repetition.replies === 3, `got ${report.repetition.replies}`);
  // 06-01(周一)/06-02(周二) 同 ISO 周，06-08 次周 → 2 周
  record('byWeek 覆盖 2 周（06-01/02 同周，06-08 次周）', Array.isArray(report.cardboard.byWeek) && report.cardboard.byWeek.length === 2, `weeks=${report.cardboard.byWeek?.length}`);
  record('首周聚合 2 个配对', report.cardboard.byWeek?.[0]?.count === 2, `count=${report.cardboard.byWeek?.[0]?.count}`);
} catch (err) {
  record('health-check 运行', false, err instanceof Error ? err.message : String(err));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const passed = results.filter((r) => r.passed).length;
console.log(`\nhealth-check: ${passed}/${results.length} passed`);
process.exit(results.every((r) => r.passed) ? 0 : 1);
