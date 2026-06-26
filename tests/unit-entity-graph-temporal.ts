#!/usr/bin/env node
/**
 * U11 — Temporal entity-relation graph regression.
 *
 * The entity graph models *state changes* over time (inspired by Zep): when a
 * functional (single-valued) relation changes value — the classic "用户从北京搬到
 * 上海" — the old object is superseded (active=false) instead of coexisting with
 * the new one and contradicting it. Multi-valued relations (likes/…) accumulate.
 *
 * Coverage:
 *   - State change: lives_in·北京 → lives_in·上海 ⇒ 北京 active=false, 上海 active=true
 *   - getRelationContext renders ACTIVE only (上海, not 北京); optional 曾经 history
 *   - Same exact fact re-merged ⇒ no duplicate; lastSeen bumped, validFrom anchored
 *   - Backward compat: legacy records with no `active` field default to active=true
 *   - Multi-valued coexistence: likes·拿铁 + likes·科幻 both stay active
 *   - Move-back: 北京 → 上海 → 北京 ⇒ 北京 active again, 上海 superseded, exactly one active
 *   - Chinese alias "住在" is detected as functional via normalizeRelation
 *
 * Runs against the compiled output (../dist) like the other unit suites, in an
 * isolated temp MIO_DIR so it never touches real data.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EntityRelation } from '../dist/memory/entity-graph.js';

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

// Isolated data dir — must be set BEFORE importing modules that resolve paths.
const dataDir = mkdtempSync(join(tmpdir(), 'mio-entity-graph-'));
process.env.MIO_DIR = dataDir;
process.env.MIO_PROVIDER = 'mock';

/** Build a fully-formed EntityRelation with sensible defaults for tests. */
function rel(
  subject: string,
  relation: string,
  object: string,
  overrides: Partial<EntityRelation> = {},
): EntityRelation {
  const validFrom = overrides.validFrom ?? new Date().toISOString();
  return {
    subject,
    relation,
    object,
    confidence: overrides.confidence ?? 0.9,
    evidence: overrides.evidence ?? `${subject} ${relation} ${object}`,
    since: overrides.since ?? validFrom.slice(0, 10),
    validFrom,
    active: overrides.active ?? true,
    supersededBy: overrides.supersededBy,
    lastSeen: overrides.lastSeen,
  };
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — temporal entity-graph tests\x1b[0m\n');

  const { mergeEntityGraph, readEntityGraph, writeEntityGraph, getRelationContext } = await import(
    '../dist/memory/entity-graph.js'
  );
  const { colaDir } = await import('../dist/memory/paths.js');

  /** Reset the on-disk graph so each test starts clean and isolated. */
  function resetGraph(): void {
    writeEntityGraph([]);
  }

  // ── 1. State change: a new functional value supersedes the old one ──
  await test('state change: lives_in·北京 → lives_in·上海 supersedes 北京', async () => {
    resetGraph();
    mergeEntityGraph([rel('用户', 'lives_in', '北京')]);
    mergeEntityGraph([rel('用户', 'lives_in', '上海')]);

    const graph = readEntityGraph();
    const beijing = graph.find((r) => r.object === '北京');
    const shanghai = graph.find((r) => r.object === '上海');

    assert(beijing !== undefined, '北京 record missing');
    assert(shanghai !== undefined, '上海 record missing');
    assertEq(beijing!.active, false, '北京 should be superseded (active=false)');
    assertEq(shanghai!.active, true, '上海 should be the current state (active=true)');
    // Tombstone points at the new fact.
    assertEq(beijing!.supersededBy, '用户|lives_in|上海', '北京.supersededBy should reference 上海');
  });

  // ── 2. getRelationContext renders ACTIVE only; history is opt-in ──
  await test('getRelationContext shows 上海 (current) not 北京 (superseded)', async () => {
    resetGraph();
    mergeEntityGraph([rel('用户', 'lives_in', '北京')]);
    mergeEntityGraph([rel('用户', 'lives_in', '上海')]);

    const ctx = getRelationContext('用户');
    assert(ctx.includes('上海'), `current state 上海 missing from context: "${ctx}"`);
    assert(!ctx.includes('北京'), `superseded 北京 leaked into current context: "${ctx}"`);
    assert(ctx.includes('lives_in·上海'), `expected grouped "lives_in·上海" form: "${ctx}"`);

    // Opt-in history surfaces the past state without dropping the current one.
    const withHistory = getRelationContext('用户', true);
    assert(withHistory.includes('上海'), 'history mode still shows current 上海');
    assert(withHistory.includes('北京'), 'history mode should surface superseded 北京');
    assert(withHistory.includes('曾经'), 'history mode should carry the （曾经: …） trailer');
  });

  // ── 3. Same exact fact re-merged: no duplicate, freshness updated ──
  await test('re-merging the same fact does not duplicate; lastSeen bumped, validFrom anchored', async () => {
    resetGraph();
    const t1 = '2026-01-01T00:00:00.000Z';
    const t2 = '2026-06-01T00:00:00.000Z';
    mergeEntityGraph([rel('用户', 'lives_in', '上海', { validFrom: t1, confidence: 0.7 })]);
    mergeEntityGraph([rel('用户', 'lives_in', '上海', { validFrom: t2, confidence: 0.9 })]);

    const graph = readEntityGraph();
    const shanghai = graph.filter((r) => r.relation === 'lives_in' && r.object === '上海');
    assertEq(shanghai.length, 1, 'same fact should not be duplicated');
    assertEq(graph.length, 1, 'graph should hold exactly one record');
    assertEq(shanghai[0].validFrom, t1, 'validFrom stays anchored to first observation');
    assertEq(shanghai[0].lastSeen, t2, 'lastSeen advances to the latest observation');
    assertEq(shanghai[0].confidence, 0.9, 'confidence takes the higher value');
  });

  // ── 4. Backward compatibility: legacy records default to active=true ──
  await test('legacy records without `active`/`validFrom` default to active=true', async () => {
    resetGraph();
    // Simulate a graph file written before the temporal upgrade.
    const legacy = [
      { subject: '用户', relation: 'likes', object: '咖啡', confidence: 0.9, evidence: '用户喜欢咖啡', since: '2025-01-01' },
    ];
    mkdirSync(colaDir(), { recursive: true });
    writeFileSync(join(colaDir(), 'entity-graph.json'), JSON.stringify(legacy, null, 2));

    const graph = readEntityGraph();
    assertEq(graph.length, 1, 'legacy record should be read');
    const r = graph[0];
    assertEq(r.active, true, 'legacy record defaults to active=true');
    assert(typeof r.validFrom === 'string' && r.validFrom.length > 0, 'validFrom backfilled to a non-empty string');
    assert(typeof r.lastSeen === 'string' && r.lastSeen.length > 0, 'lastSeen backfilled');
    assertEq(r.since, '2025-01-01', 'original since preserved');
    // A legacy fact must still render in context (no silent disappearance).
    assert(getRelationContext('用户').includes('咖啡'), 'legacy fact missing from context');
  });

  // ── 5. Multi-valued relations accumulate (NOT superseded) ──
  await test('multi-valued likes coexist: 拿铁 and 科幻 both stay active', async () => {
    resetGraph();
    mergeEntityGraph([rel('用户', 'likes', '拿铁咖啡')]);
    mergeEntityGraph([rel('用户', 'likes', '科幻电影')]);

    const graph = readEntityGraph();
    const active = graph.filter((r) => r.relation === 'likes' && r.active);
    assertEq(active.length, 2, 'both likes should remain active');

    const ctx = getRelationContext('用户');
    assert(ctx.includes('拿铁咖啡'), 'first like missing');
    assert(ctx.includes('科幻电影'), 'second like missing');
  });

  // ── 6. Move-back: 北京 → 上海 → 北京 reactivates 北京, exactly one active ──
  await test('move-back reactivates the original value with exactly one active', async () => {
    resetGraph();
    mergeEntityGraph([rel('用户', 'lives_in', '北京', { validFrom: '2026-01-01T00:00:00.000Z' })]);
    mergeEntityGraph([rel('用户', 'lives_in', '上海', { validFrom: '2026-03-01T00:00:00.000Z' })]);
    mergeEntityGraph([rel('用户', 'lives_in', '北京', { validFrom: '2026-06-01T00:00:00.000Z' })]);

    const graph = readEntityGraph();
    const active = graph.filter((r) => r.relation === 'lives_in' && r.active);
    assertEq(active.length, 1, 'exactly one current city');
    assertEq(active[0].object, '北京', 'moved back to 北京');
    // Reactivation starts a fresh validity period.
    assertEq(active[0].validFrom, '2026-06-01T00:00:00.000Z', 'reactivation resets validFrom');
    const shanghai = graph.find((r) => r.object === '上海');
    assertEq(shanghai!.active, false, '上海 superseded again');
  });

  // ── 7. Chinese alias "住在" is treated as functional via normalizeRelation ──
  await test('Chinese alias 住在 supersedes via normalized functional detection', async () => {
    resetGraph();
    mergeEntityGraph([rel('用户', '住在', '北京')]);
    mergeEntityGraph([rel('用户', '住在', '上海')]);

    const graph = readEntityGraph();
    const beijing = graph.find((r) => r.object === '北京');
    const shanghai = graph.find((r) => r.object === '上海');
    assertEq(beijing!.active, false, '住在·北京 should be superseded');
    assertEq(shanghai!.active, true, '住在·上海 should be current');
  });

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} temporal entity-graph tests passed\x1b[0m`);
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
  console.error('temporal entity-graph runner crashed:', err);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
});
