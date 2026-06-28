#!/usr/bin/env node
/**
 * eval/memory-arc.ts — 跨会话记忆累积端到端测（北极星 #1 命题：记得住 + 会成长）
 *
 * Day1(session A) 分享独特事实 → 固化(extractStructuredMemoryLLM 真 provider) → Day2(全新 session B) 探召回。
 * 这是"纸板感"的根：聊一段、隔一觉，它到底还记不记得你是谁、在意什么。
 * Day2 是全新 sessionId，召回只能来自结构化记忆(跨会话)，不是 transcript 窗口(会话内)。
 *
 * 用法（需 provider 网络）：npm run eval:memory
 */

import 'dotenv/config';
import { rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '.data', 'memory-arc');
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

const FACTS = { name: '沈澜', place: '杭州', project: '产品发布', pref: '先听我说完' };

// ── Day 1: session A — 分享独特事实 ──
console.log('=== Day 1 (session A) ===');
const SESSION_A = [
  '嗨，我叫沈澜，上个月刚搬到杭州工作。',
  '我手头在做一个产品发布的项目，压力挺大的。',
  '跟你说个我的习惯：我心烦的时候，希望你先听我说完，别急着给建议。',
  '今天先聊到这，晚安～',
];
let sidA: string | undefined;
for (const t of SESSION_A) {
  const o = await runTurn({ text: t, sessionId: sidA }, { provider });
  sidA = o.sessionId;
  console.log(`U: ${t}`);
  console.log(`M: ${(o.text ?? '').replace(/\s+/g, ' ').slice(0, 80)}`);
}

// ── 固化：bookmarks → 结构化记忆（LLM 提取，真 provider）──
console.log('\n=== 固化 extractStructuredMemoryLLM ===');
const mem = await extractStructuredMemoryLLM(readBookmarks(), undefined, { provider });
writeStructuredMemoryToDisk(mem);
const disk = readStructuredMemoryFromDisk();
const entities = (disk?.entities ?? []) as Array<{ content?: string }>;
const durable = disk?.durableFacts ?? [];
const blob = JSON.stringify(entities);
const captured = Object.entries(FACTS).filter(([, v]) => blob.includes(v)).map(([k]) => k);
console.log(`durableFacts=${durable.length}  entities=${entities.length}  捕获 day1 事实=${captured.length}/4 (${captured.join(',') || '—'})`);
for (const e of entities.slice(0, 8)) console.log(`  · ${(e.content ?? '').slice(0, 50)}`);

// ── Day 2: session B（全新会话）— 探跨会话召回 ──
console.log('\n=== Day 2 (session B，全新会话) ===');
const SESSION_B = [
  '我回来啦，你还记得我叫什么、在哪个城市吗？',
  '我那个最近忙的项目你还记得是啥不？',
  '我现在心里有点烦，你应该怎么陪我来着？',
];
const prefRe = /先听|听你说完|听我说完|不(急|马上)着?给?(你)?建议|先不给建议/;
let sidB: string | undefined;
const recalled = new Set<string>();
for (const t of SESSION_B) {
  const o = await runTurn({ text: t, sessionId: sidB }, { provider });
  sidB = o.sessionId;
  const r = o.text ?? '';
  const hit: string[] = [];
  if (r.includes(FACTS.name)) hit.push('name');
  if (r.includes(FACTS.place)) hit.push('place');
  if (r.includes(FACTS.project)) hit.push('project');
  if (prefRe.test(r)) hit.push('pref');
  hit.forEach((h) => recalled.add(h));
  console.log(`U: ${t}`);
  console.log(`M: ${r.replace(/\s+/g, ' ').slice(0, 100)}  [召回: ${hit.join(',') || '—'}]`);
}

console.log(`\n=== 跨会话记忆结论 ===`);
console.log(`durableFacts 累积=${durable.length} | 提取捕获 day1 事实=${captured.length}/4 | session B 跨会话召回=${recalled.size}/4 (${[...recalled].join(',') || '—'})`);
console.log(`真实数据 → ${DIR}`);
