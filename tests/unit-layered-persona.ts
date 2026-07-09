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
const {
  readPersonaDelta,
  writePersonaDelta,
  readPreferences,
  writePreferences,
  upsertPreference,
  patchPersonaDelta,
  upsertWeClawTarget,
  getWeClawTarget,
  listUsersWithProactiveWeClawTargets,
  userWantsProactiveChat,
} =
  await import('../dist/memory/persona-delta.js');
const { applyPersonaDelta, buildDeltaFragment, buildPreferencePrompt, buildCharacterNote } = await import('../dist/persona/layered.js');
const { ContextEngine } = await import('../dist/prompt/context-engine.js');
const { IDENTITY } = await import('../dist/prompt/templates.js');
const { detectDirectives, captureExplicitDirectives } = await import('../dist/persona/directive-capture.js');
const prog2 = await import('../dist/relationship/progression.js');
const { buildRelationshipContext } = await import('../dist/prompt/templates.js');
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
  upsertWeClawTarget('user-a', 'wx-user-a@im.wechat', 'unit');
  upsertWeClawTarget('user-b', 'wx-user-b@im.wechat', 'unit');
  ok(getWeClawTarget('user-a') === 'wx-user-a@im.wechat', 'per-user WeClaw target persists for owner');
  ok(getWeClawTarget('user-b') === 'wx-user-b@im.wechat', 'per-user WeClaw target stays isolated');
  ok(userWantsProactiveChat(readPreferences('user-a')) === true, 'proactive opt-in detected from preference');
  ok(
    listUsersWithProactiveWeClawTargets().some((target) => target.userId === 'user-a' && target.to === 'wx-user-a@im.wechat'),
    'eligible proactive WeClaw target includes opted-in user',
  );
  ok(
    listUsersWithProactiveWeClawTargets().every((target) => target.userId !== 'user-b'),
    'non-opted-in user is not eligible for proactive WeClaw delivery',
  );
  writePreferences({
    userId: 'user-c',
    explicit: [{ rule: '主动找我聊天', source: 'unit', createdAt: '' }],
    channels: {
      weclaw: {
        to: 'wx-user-c@im.wechat',
        enabled: false,
        source: 'unit',
        updatedAt: '',
      },
    },
    updatedAt: '',
  });
  ok(getWeClawTarget('user-c') === null, 'disabled per-user WeClaw target is not returned');
  ok(
    listUsersWithProactiveWeClawTargets().every((target) => target.userId !== 'user-c'),
    'disabled per-user WeClaw target is not eligible for proactive delivery',
  );
  upsertPreference('别再主动联系我了', 'unit', 'user-d');
  upsertWeClawTarget('user-d', 'wx-user-d@im.wechat', 'unit');
  ok(userWantsProactiveChat(readPreferences('user-d')) === false, 'proactive opt-out is not treated as opt-in');
  ok(
    listUsersWithProactiveWeClawTargets().every((target) => target.userId !== 'user-d'),
    'opted-out user is not eligible for proactive delivery',
  );
  upsertPreference('还是主动找我聊天吧', 'unit', 'user-d');
  ok(userWantsProactiveChat(readPreferences('user-d')) === true, 'later proactive opt-in can re-enable outreach');
  upsertPreference('这个用户希望 Mio 主动找他聊天；不要总用“想聊了随时找我”把话题推回给用户。', 'unit', 'user-e');
  upsertWeClawTarget('user-e', 'wx-user-e@im.wechat', 'unit');
  ok(userWantsProactiveChat(readPreferences('user-e')) === true, 'proactive opt-in with unrelated negative wording stays enabled');
  for (const [idx, phrase] of ['不要主动联系我', '不用主动找我聊天', '停止主动联系我', '取消主动找我聊天'].entries()) {
    const userId = `user-optout-${idx}`;
    upsertPreference('主动找我聊天', 'unit', userId);
    upsertWeClawTarget(userId, `wx-user-optout-${idx}@im.wechat`, 'unit');
    captureExplicitDirectives(phrase, userId);
    ok(userWantsProactiveChat(readPreferences(userId)) === false, `${phrase} disables proactive outreach`);
    ok(
      listUsersWithProactiveWeClawTargets().every((target) => target.userId !== userId),
      `${phrase} removes user from proactive WeClaw targets`,
    );
  }
}

// --- Task 2: Character Note (post-history anchor) ---
{
  const note = buildCharacterNote({ userId: 'default', personaOverride: '开酒吧的', tone: 'teasing', updatedAt: '', history: [] });
  ok(note !== null && note.includes('开酒吧的'), 'character note contains persona override');
  ok(buildCharacterNote(null) === null, 'null delta → null note');
  ok(buildCharacterNote({ userId: 'default', tone: 'gentle', updatedAt: '', history: [] }) !== null, 'tone-only delta produces note');
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
  engine.register('identity', { type: 'identity', content: IDENTITY, priority: 'critical' });
  engine.register('preference', { type: 'preference', content: rendered, priority: 'critical' });
  engine.register('soul', { type: 'persona', content: 'S'.repeat(40000), priority: 'high' });
  const out = engine.assemble(2000);
  ok(out.includes(IDENTITY), 'identity survives hard-cap (critical)');
  ok(out.includes('皮一点别老哄我'), 'preference survives hard-cap (critical)');
}

// --- Task 5: 对话内捏人捕获 ---
{
  ok(detectDirectives('以后叫我阿哲吧').some((d) => d.kind === 'nickname' && d.value === '阿哲'), 'detect nickname');
  ok(detectDirectives('你其实是开酒吧的，别当插画师了').some((d) => d.kind === 'persona'), 'detect persona override');
  ok(detectDirectives('你能不能皮一点').some((d) => d.kind === 'preference'), 'detect preference');
  ok(detectDirectives('可是我想你主动找我聊天').some((d) => d.kind === 'preference' && d.value.includes('主动找我聊天')), 'detect proactive chat preference');
  ok(detectDirectives('不要主动联系我').some((d) => d.kind === 'preference' && d.value.includes('不要主动联系我')), 'detect proactive opt-out preference');
  ok(detectDirectives('我喜欢你占有欲强一点').some((d) => d.kind === 'preference' && d.value.includes('占有欲')), 'detect possessive style preference');
  ok(detectDirectives('你能不能霸道一点').some((d) => d.kind === 'preference' && d.value.includes('霸道')), 'detect dominant style preference');
  ok(detectDirectives('今天天气不错').length === 0, 'no false positive on plain chat');

  captureExplicitDirectives('以后叫我阿哲吧');
  ok(prog2.readRelationshipState().nicknames.agentCallsUser === '阿哲', 'nickname persisted to relationship-state');
  captureExplicitDirectives('你其实是开酒吧的');
  ok((readPersonaDelta()?.personaOverride ?? '').includes('开酒吧的'), 'persona override persisted to delta');
  captureExplicitDirectives('你能不能皮一点');
  ok((readPreferences()?.explicit.length ?? 0) >= 1, 'preference persisted');
  captureExplicitDirectives('我喜欢你占有欲强一点');
  ok(readPreferences()?.explicit.some((p) => p.rule.includes('占有欲')) === true, 'possessive style preference persisted');

  // 收紧正则后的反例：防误捕 + 防否定反转
  ok(detectDirectives('记得叫我起床').every((d) => d.kind !== 'nickname'), 'no nickname FP: 记得叫我起床');
  ok(detectDirectives('你为什么叫我笨蛋').every((d) => d.kind !== 'nickname'), 'no nickname FP: question');
  ok(detectDirectives('你其实是对的').every((d) => d.kind !== 'persona'), 'no persona FP: 你其实是对的');
  ok(detectDirectives('你能不能帮我看看吗').every((d) => d.kind !== 'preference'), 'no preference FP: task request');
  const negPref = detectDirectives('别老哄我了').find((d) => d.kind === 'preference');
  ok(!!negPref && negPref.value.startsWith('别'), 'negation preference keeps 别 (not inverted)');
}

// --- Task 6: L4 共同史端到端注入 ---
{
  captureExplicitDirectives('记住：我们说好下周去看海');
  ok(prog2.readRelationshipState().sharedMemories.some((m) => m.includes('看海')), 'shared memory persisted');
  const relCtx = buildRelationshipContext(prog2.readRelationshipState());
  ok(relCtx.includes('阿哲'), 'nickname rendered into relationship prompt');
  ok(relCtx.includes('看海'), 'shared memory rendered into relationship prompt');
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
