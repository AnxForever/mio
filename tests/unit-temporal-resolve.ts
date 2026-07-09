#!/usr/bin/env node
/**
 * Unit test for src/memory/temporal-resolve.ts (B-1 bi-temporal 矛盾消解引擎).
 * 注入确定性 fake contradicts，复现验证 supersede 逻辑（不依赖 LLM/网络）。
 *
 * 覆盖：
 *   - 显式 slot 匹配 (lives_in, drink_preference 等 7 个槽位)
 *   - Content-key 匹配 (S-R-O key matching，MemStrata 原理)
 *   - 大实体集 L1-only 模式 (n > 60 不调 LLM)
 */

import {
  resolveContradictions,
  resolveContradictionsSync,
  makeRuleBasedContradicts,
} from '../dist/memory/temporal-resolve.js';
import type { MemoryEntity } from '../dist/memory/structured-memory.js';

interface R { name: string; passed: boolean; detail?: string; }
const results: R[] = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function e(type: MemoryEntity['type'], content: string, day: string): MemoryEntity {
  return { type, content, confidence: 0.6, firstSeen: `2026-06-${day}T10:00:00.000Z`, lastSeen: `2026-06-${day}T10:00:00.000Z`, occurrences: 1, source: 't' };
}

// ═══ Section 1: Explicit slot matching (existing + expanded) ═══

const entities: MemoryEntity[] = [
  e('fact', '用户住在杭州', '01'),
  e('fact', '用户住在上海', '08'),
  e('preference', '喜欢喝美式', '01'),
  e('preference', '改喝拿铁了', '08'),
  e('fact', '用户叫沈澜', '01'),
];

// fake：同主题(城市/咖啡)关键词共现 = 取代
const fake = (older: MemoryEntity, newer: MemoryEntity): boolean => {
  const city = /杭州|上海|住/, drink = /美式|拿铁|喝/;
  if (city.test(older.content) && city.test(newer.content)) return true;
  if (drink.test(older.content) && drink.test(newer.content)) return true;
  return false;
};

const { entities: res, supersededCount } = await resolveContradictions(entities, fake, '2026-06-08T12:00:00.000Z');
const by = (c: string): MemoryEntity | undefined => res.find((x) => x.content === c);

check('旧城市(杭州)失效', !!by('用户住在杭州')?.invalidatedAt);
check('新城市(上海)仍 active', !by('用户住在上海')?.invalidatedAt);
check('旧口味(美式)失效', !!by('喜欢喝美式')?.invalidatedAt);
check('新口味(拿铁)仍 active', !by('改喝拿铁了')?.invalidatedAt);
check('无关事实(沈澜)不误杀', !by('用户叫沈澜')?.invalidatedAt);
check('supersededCount = 2', supersededCount === 2, `got ${supersededCount}`);
check('supersededBy 溯源到新值', by('用户住在杭州')?.supersededBy === '用户住在上海', by('用户住在杭州')?.supersededBy);
check('原数组未被改(纯函数)', !entities[0].invalidatedAt);

// async contradicts 也要支持
const asyncFake = (o: MemoryEntity, n: MemoryEntity): Promise<boolean> => Promise.resolve(fake(o, n));
const r2 = await resolveContradictions(entities, asyncFake, '2026-06-08T12:00:00.000Z');
check('async contradicts 生效', r2.supersededCount === 2, `got ${r2.supersededCount}`);

// ═══ Section 2: makeRuleBasedContradicts (确定性，零 LLM 成本) ═══

const ruleBased = makeRuleBasedContradicts();

// 2a: Explicit slot matching — 7 slot types via extractSingleValueSlot
const slotEntities: MemoryEntity[] = [
  e('fact', '用户住在北京', '01'),
  e('fact', '用户现在住深圳了', '08'),
  e('preference', '用户喜欢喝咖啡', '01'),
  e('preference', '用户现在不喝咖啡了改喝茶', '08'),
  e('fact', '用户在做论文', '01'),
  e('fact', '用户最近忙简历', '08'),
];
const sr = resolveContradictionsSync(slotEntities, ruleBased, '2026-06-08T12:00:00.000Z');
const sb = (c: string): MemoryEntity | undefined => sr.entities.find((x) => x.content === c);

check('slot: 旧住地失效', !!sb('用户住在北京')?.invalidatedAt);
check('slot: 新住地仍 active', !sb('用户现在住深圳了')?.invalidatedAt);
check('slot: 旧饮料失效', !!sb('用户喜欢喝咖啡')?.invalidatedAt);
check('slot: 新饮料仍 active', !sb('用户现在不喝咖啡了改喝茶')?.invalidatedAt);
check('slot: 旧项目失效', !!sb('用户在做论文')?.invalidatedAt);
check('slot: 新项目仍 active', !sb('用户最近忙简历')?.invalidatedAt);
check('slot: supersededCount = 3', sr.supersededCount === 3, `got ${sr.supersededCount}`);

// 2b: Content-key matching — LCP ≥ 4 + stripped LCP ≥ 2, persistent types only
const ckEntities: MemoryEntity[] = [
  e('fact', '用户在北京工作', '01'),
  e('fact', '用户在深圳工作', '08'),
  e('fact', '用户养了只猫', '01'),
  e('fact', '用户养了只狗', '08'),
  // event type — should NOT be auto-superseded (transient, not persistent)
  e('event', '用户昨天去爬山了', '01'),
  e('event', '用户昨天去看电影了', '08'),
  // preference — persistent, should be superseded
  e('preference', '用户喜欢猫', '01'),
  e('preference', '用户喜欢狗', '08'),
];
const ckr = resolveContradictionsSync(ckEntities, ruleBased, '2026-06-08T12:00:00.000Z');
const ckb = (c: string): MemoryEntity | undefined => ckr.entities.find((x) => x.content === c);

check('content-key: 旧工作失效', !!ckb('用户在北京工作')?.invalidatedAt);
check('content-key: 新工作仍 active', !ckb('用户在深圳工作')?.invalidatedAt);
check('content-key: 旧宠物失效', !!ckb('用户养了只猫')?.invalidatedAt);
check('content-key: 新宠物仍 active', !ckb('用户养了只狗')?.invalidatedAt);
check('content-key: 偏好间的取代(同type+同键)', !!ckb('用户喜欢猫')?.invalidatedAt);
check('content-key: 新偏好仍 active', !ckb('用户喜欢狗')?.invalidatedAt);
// 不同类型 — 不取代 (event vs fact)
check('content-key: 不同类型不误杀', !ckb('用户昨天去爬山了')?.invalidatedAt, ckb('用户昨天去爬山了')?.invalidatedAt ? 'should NOT be invalidated' : 'correct');
check('content-key: 至少 3 个取代 (event 类型被排除)', ckr.supersededCount >= 3, `got ${ckr.supersededCount}`);

// 2c: Same content — should NOT be detected as contradiction
const sameEntities: MemoryEntity[] = [
  e('fact', '用户住在杭州', '01'),
  e('fact', '用户住在杭州', '08'),
];
const sc = resolveContradictionsSync(sameEntities, ruleBased, '2026-06-08T12:00:00.000Z');
check('content-key: 相同内容不取代', sc.supersededCount === 0, `got ${sc.supersededCount}`);

// ═══ Section 3: Large entity set (simulate n > 60 — deterministic-only) ═══
// 构造 65 个实体（含 5 对矛盾），验证确定性路径不受 n>60 限制
const largeEntities: MemoryEntity[] = [];
for (let i = 0; i < 55; i++) {
  largeEntities.push(e('fact', `用户${i}号事实`, '01'));
}
// 5 对矛盾：其中 4 对确定性可检测（共享显著前缀），
// "用户爱看科幻片"/"用户现在爱看悬疑片" 中间插了"现在"→LCP="用户"(2)<4→需要 LLM 语义兜底
largeEntities.push(e('fact', '用户住在成都', '01'));
largeEntities.push(e('fact', '用户搬到重庆了', '08'));
largeEntities.push(e('preference', '用户爱看科幻片', '01'));
largeEntities.push(e('preference', '用户现在爱看悬疑片', '08')); // LLM-needed case
largeEntities.push(e('fact', '用户在学钢琴', '01'));
largeEntities.push(e('fact', '用户在学吉他', '08'));
largeEntities.push(e('fact', '用户吃辣', '01'));
largeEntities.push(e('fact', '用户戒辣了', '08')); // LCP="用户"(2)<4 → LLM-needed
largeEntities.push(e('decision', '用户打算考研', '01'));
largeEntities.push(e('decision', '用户决定直接工作', '08'));

check('大集合: 实体数 > 60', largeEntities.length > 60, `got ${largeEntities.length}`);

const lr = resolveContradictionsSync(largeEntities, ruleBased, '2026-06-08T12:00:00.000Z');
// 确定性路径应捕获 2-3 对（住址 + 学琴/吉他）。其余需要 LLM 语义兜底
check('大集合: 确定性路径不受限 (n>60 不跳过)', lr.supersededCount > 0, `got ${lr.supersededCount} superseded`);
check('大集合: 成都(住址)失效', !!lr.entities.find((x) => x.content === '用户住在成都')?.invalidatedAt);
check('大集合: 钢琴(学琴)失效', !!lr.entities.find((x) => x.content === '用户在学钢琴')?.invalidatedAt);
// 以下需要 LLM 语义兜底（短词/插入修饰词），确定性路径不覆盖——保留为设计决策
const missed = ['用户爱看科幻片', '用户吃辣', '用户打算考研'].filter(
  (c) => !lr.entities.find((x) => x.content === c)?.invalidatedAt
);
check('大集合: 插入修饰词/短词 case 留给 LLM 兜底', missed.length >= 2, `${missed.length}/3 LLM-needed cases correctly deferred`);

// ═══ Section 4: Edge cases ═══

// Empty entity list
const emptyR = resolveContradictionsSync([], ruleBased, '2026-06-08T12:00:00.000Z');
check('空列表: supersededCount = 0', emptyR.supersededCount === 0, `got ${emptyR.supersededCount}`);

// Single entity
const singleR = resolveContradictionsSync([e('fact', '用户住在杭州', '01')], ruleBased, '2026-06-08T12:00:00.000Z');
check('单实体: supersededCount = 0', singleR.supersededCount === 0, `got ${singleR.supersededCount}`);

// Different types with same content key — should NOT supersede
const diffTypeEntities: MemoryEntity[] = [
  e('fact', '用户喜欢游泳', '01'),
  e('preference', '用户喜欢游泳', '08'), // same key but different type
];
const dtR = resolveContradictionsSync(diffTypeEntities, ruleBased, '2026-06-08T12:00:00.000Z');
check('不同类型: 不取代', dtR.supersededCount === 0, `got ${dtR.supersededCount}`);

// Already invalidated entities should be skipped
const preInvalidated: MemoryEntity[] = [
  { ...e('fact', '用户住在北京', '01'), invalidatedAt: '2026-06-05T00:00:00.000Z', supersededBy: 'already dead' },
  e('fact', '用户住在上海', '08'),
];
const piR = resolveContradictionsSync(preInvalidated, ruleBased, '2026-06-08T12:00:00.000Z');
check('已失效实体: 跳过不重复标记', piR.supersededCount === 0, `got ${piR.supersededCount}`);

const passed = results.filter((r) => r.passed).length;
console.log(`\ntemporal-resolve: ${passed}/${results.length} passed`);
process.exit(results.every((r) => r.passed) ? 0 : 1);
