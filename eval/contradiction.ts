#!/usr/bin/env node
/**
 * eval/contradiction.ts — 矛盾/更新处理测（北极星 §4.1 B-1：bi-temporal 修复的现状基线）
 *
 * companion 记忆最硬的问题：事实会变。mem0 都退回 ADD-only 放弃了自动矛盾消解。
 * 测 Mio 现状：Day1 说"杭州/美式" → Day2 改口"搬到上海/改喝拿铁" → 看结构化记忆里
 * 新旧是否并存(矛盾) → Day3 全新会话探召回，用的是新值(✅)/旧值(❌stale)/都提(⚠️confused)。
 *
 * 用法（需 provider 网络）：npm run eval:contradiction
 */

import 'dotenv/config';
import { rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '.data', 'contradiction');
process.env.MIO_DIR = DIR;
if (process.env.MINIMAX_DISABLE === 'true') process.env.MINIMAX_DISABLE = '';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const { runTurn } = await import('../dist/core/agent-loop.js');
const { selectProvider } = await import('../dist/providers/index.js');
const { readBookmarks, ensureBankStructure } = await import('../dist/memory/bank.js');
const { extractStructuredMemoryLLM, writeStructuredMemoryToDisk, readStructuredMemoryFromDisk } = await import('../dist/memory/structured-memory.js');

ensureBankStructure();
const name = (process.env.MIO_PROVIDER && process.env.MIO_PROVIDER !== 'auto') ? process.env.MIO_PROVIDER : 'minimax';
const provider = selectProvider(name);

const OLD = { city: '杭州', drink: '美式' };
const NEW = { city: '上海', drink: '拿铁' };

async function runSession(label: string, turns: string[]): Promise<void> {
  console.log(`\n=== ${label} ===`);
  let sid: string | undefined;
  for (const t of turns) {
    const o = await runTurn({ text: t, sessionId: sid }, { provider });
    sid = o.sessionId;
    console.log(`U: ${t}`);
    console.log(`M: ${(o.text ?? '').replace(/\s+/g, ' ').slice(0, 80)}`);
  }
}

// Day1：立旧事实
await runSession('Day1 (立旧事实)', [
  '我住在杭州，每天通勤挺远的。',
  '我平时爱喝美式咖啡。',
  '今天先聊到这，晚安～',
]);
writeStructuredMemoryToDisk(await extractStructuredMemoryLLM(readBookmarks()));

// Day2：改口（矛盾更新）
await runSession('Day2 (改口更新)', [
  '跟你说个变化：我上个月搬到上海了，不在杭州了。',
  '对了，我现在改喝拿铁了，美式喝腻了。',
  '好啦晚安～',
]);
writeStructuredMemoryToDisk(await extractStructuredMemoryLLM(readBookmarks(), readStructuredMemoryFromDisk() ?? undefined));

// 检视记忆：新旧是否并存
const disk = readStructuredMemoryFromDisk();
const blob = JSON.stringify((disk?.entities ?? []));
const mem = {
  oldCity: blob.includes(OLD.city), newCity: blob.includes(NEW.city),
  oldDrink: blob.includes(OLD.drink), newDrink: blob.includes(NEW.drink),
};
console.log(`\n=== 记忆检视（Day2 固化后）===`);
console.log(`城市：旧(杭州)=${mem.oldCity} 新(上海)=${mem.newCity}  |  饮品：旧(美式)=${mem.oldDrink} 新(拿铁)=${mem.newDrink}`);
console.log(`矛盾并存？城市=${mem.oldCity && mem.newCity ? '是⚠️' : '否'} 饮品=${mem.oldDrink && mem.newDrink ? '是⚠️' : '否'}`);
for (const e of (disk?.entities ?? []).slice(0, 10) as Array<{ content?: string }>) console.log(`  · ${(e.content ?? '').slice(0, 50)}`);

// Day3：全新会话探召回
console.log(`\n=== Day3 (全新会话，探召回) ===`);
function verdict(resp: string, oldV: string, newV: string): string {
  const o = resp.includes(oldV), n = resp.includes(newV);
  if (n && !o) return '✅ 用新值(correct)';
  if (n && o) return '⚠️ 新旧都提(confused)';
  if (o && !n) return '❌ 卡旧值(stale)';
  return '— 未提';
}
let sid: string | undefined;
const probes = [
  { q: '我住哪个城市来着，你还记得吗？', oldV: OLD.city, newV: NEW.city },
  { q: '我平时爱喝什么来着？', oldV: OLD.drink, newV: NEW.drink },
];
for (const p of probes) {
  const o = await runTurn({ text: p.q, sessionId: sid }, { provider });
  sid = o.sessionId;
  const r = o.text ?? '';
  console.log(`U: ${p.q}`);
  console.log(`M: ${r.replace(/\s+/g, ' ').slice(0, 100)}`);
  console.log(`   → ${verdict(r, p.oldV, p.newV)}`);
}

console.log(`\n=== 结论 ===`);
console.log(`矛盾消解现状：记忆是否并存新旧决定 Day3 是否confused；这是北极星 B-1(bi-temporal 修复)的现状基线。`);
console.log(`真实数据 → ${DIR}`);
