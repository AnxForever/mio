#!/usr/bin/env node
/**
 * Unit test for src/memory/temporal-resolve.ts (B-1 bi-temporal 矛盾消解引擎).
 * 注入确定性 fake contradicts，复现验证 supersede 逻辑（不依赖 LLM/网络）。
 */

import { resolveContradictions } from '../dist/memory/temporal-resolve.js';
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

const passed = results.filter((r) => r.passed).length;
console.log(`\ntemporal-resolve: ${passed}/${results.length} passed`);
process.exit(results.every((r) => r.passed) ? 0 : 1);
