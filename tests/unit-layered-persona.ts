#!/usr/bin/env node
/**
 * Mio — Layered Persona (per-user) unit tests.
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-layered-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

// === IMPORTS (each task appends here) ===
const { readPersonaDelta, writePersonaDelta, readPreferences, upsertPreference, patchPersonaDelta } =
  await import('../dist/memory/persona-delta.js');
const { buildKernel, applyPersonaDelta, buildDeltaFragment, buildPreferencePrompt } = await import('../dist/persona/layered.js');
const { ContextEngine } = await import('../dist/prompt/context-engine.js');
const { detectDirectives, captureExplicitDirectives } = await import('../dist/persona/directive-capture.js');
const prog2 = await import('../dist/relationship/progression.js');
// === END IMPORTS ===

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — layered persona tests\x1b[0m\n');

// === TESTS ===

// --- Task 1: persona-delta / preferences IO ---
{
  ok(readPersonaDelta() === null, 'missing delta returns null before any write');
  writePersonaDelta({ userId: 'default', personaOverride: '开酒吧的', updatedAt: new Date().toISOString(), history: [] });
  ok(readPersonaDelta()?.personaOverride === '开酒吧的', 'persona-delta write→read roundtrip');
  patchPersonaDelta({ tone: 'teasing' }, 'unit');
  ok(readPersonaDelta()?.tone === 'teasing' && readPersonaDelta()?.personaOverride === '开酒吧的', 'patch merges, keeps prior fields');
  upsertPreference('皮一点别老哄我', 'unit');
  ok((readPreferences()?.explicit.length ?? 0) === 1, 'preference upsert persists');
  upsertPreference('皮一点别老哄我', 'unit');
  ok((readPreferences()?.explicit.length ?? 0) === 1, 'preference upsert dedupes identical rule');
  upsertPreference('主动找我聊天', 'unit', 'user-a');
  ok(readPreferences('user-a')?.explicit.some((p) => p.rule === '主动找我聊天') === true, 'per-user preference persists for owner');
  ok(readPreferences('user-b') === null, 'per-user preference does not leak to another user');
}

// --- Task 2: L0 Kernel + 不可裁 ---
{
  const kernel = buildKernel();
  ok(kernel.length > 0 && /真实的人/.test(kernel), 'kernel non-empty and contains identity floor');

  const engine = new ContextEngine();
  engine.register('kernel', { type: 'kernel', content: kernel, priority: 'critical' });
  // 一个超大 high soul，逼出 hard-cap
  engine.register('soul', { type: 'persona', content: 'S'.repeat(40000), priority: 'high' });
  const out = engine.assemble(2000);
  ok(out.includes(kernel), 'kernel survives hard-cap (critical never trimmed)');
  ok(!engine.getTrimmedSections().includes('kernel'), 'kernel not in trimmed list');
}

// --- Task 3: L1→L2 合成 ---
{
  const base = 'L1-ARCHETYPE-SOUL';
  ok(applyPersonaDelta(base, null) === base, 'empty delta returns base unchanged');
  const merged = applyPersonaDelta(base, { userId: 'default', personaOverride: '开酒吧的', tone: 'teasing', updatedAt: '', history: [] });
  ok(merged.includes(base) && merged.includes('开酒吧的'), 'delta overlays after L1 base');
  ok(buildDeltaFragment(null) === '', 'no delta → empty fragment');
}

// --- Task 4: L3 偏好渲染 + 不可裁 ---
{
  ok(buildPreferencePrompt(null) === '', 'no prefs → empty');
  ok(buildPreferencePrompt({ userId: 'default', explicit: [], updatedAt: '' }) === '', 'empty prefs → empty');
  const rendered = buildPreferencePrompt({ userId: 'default', explicit: [{ rule: '皮一点别老哄我', source: 'unit', createdAt: '' }], updatedAt: '' });
  ok(rendered.includes('皮一点别老哄我'), 'preference rule rendered');

  const engine = new ContextEngine();
  engine.register('kernel', { type: 'kernel', content: buildKernel(), priority: 'critical' });
  engine.register('preference', { type: 'preference', content: rendered, priority: 'critical' });
  engine.register('soul', { type: 'persona', content: 'S'.repeat(40000), priority: 'high' });
  const out = engine.assemble(2000);
  ok(out.includes('皮一点别老哄我'), 'preference survives hard-cap (critical)');
}

// --- Task 5: 对话内捏人捕获 ---
{
  ok(detectDirectives('以后叫我阿哲吧').some((d) => d.kind === 'nickname' && d.value === '阿哲'), 'detect nickname');
  ok(detectDirectives('你其实是开酒吧的，别当插画师了').some((d) => d.kind === 'persona'), 'detect persona override');
  ok(detectDirectives('你能不能皮一点').some((d) => d.kind === 'preference'), 'detect preference');
  ok(detectDirectives('可是我想你主动找我聊天').some((d) => d.kind === 'preference' && d.value.includes('主动找我聊天')), 'detect proactive chat preference');
  ok(detectDirectives('今天天气不错').length === 0, 'no false positive on plain chat');

  captureExplicitDirectives('以后叫我阿哲吧');
  ok(prog2.readRelationshipState().nicknames.agentCallsUser === '阿哲', 'nickname persisted to relationship-state');
  captureExplicitDirectives('你其实是开酒吧的');
  ok((readPersonaDelta()?.personaOverride ?? '').includes('开酒吧的'), 'persona override persisted to delta');
  captureExplicitDirectives('你能不能皮一点');
  ok((readPreferences()?.explicit.length ?? 0) >= 1, 'preference persisted');
}

// === APPEND NEW TEST BLOCKS ABOVE THIS LINE ===

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} layered-persona tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
