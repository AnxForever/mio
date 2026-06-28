#!/usr/bin/env node
/**
 * eval/live-session.ts — 真实多轮会话端到端体检（自造真实数据）
 *
 * 没有部署机真实数据时，用脚本化的"darling"驱动真 Mio 管线(runTurn + 真 provider)聊一段，
 * 生成真实 transcript/structured-memory/emotion/ritual，再供 eval:health 体检。
 * 这是最接近"聊一段后做体检"的端到端验证：跑通真人格、真记忆累积、真情感副作用。
 *
 * 用法（需 provider 网络）：npm run eval:live   （随后 npm run eval:health -- --data eval/.data/live-session）
 * 注：vector(better-sqlite3) 在本 WSL 因 Windows 二进制加载失败，但其为 best-effort；
 *     transcript/structured-memory/ritual 为文件态，不受影响，体检数据照常生成。
 */

import 'dotenv/config';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '.data', 'live-session');
process.env.MIO_DIR = DIR;
if (process.env.MINIMAX_DISABLE === 'true') process.env.MINIMAX_DISABLE = '';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const { runTurn } = await import('../dist/core/agent-loop.js');
const { selectProvider } = await import('../dist/providers/index.js');
const { assessDepth } = await import('../dist/emotion/ritual.js');
const { detectL0Break } = await import('../dist/safety/l0-guard.js');
const { ensureBankStructure } = await import('../dist/memory/bank.js');

ensureBankStructure();
const name = (process.env.MIO_PROVIDER && process.env.MIO_PROVIDER !== 'auto') ? process.env.MIO_PROVIDER : 'minimax';
const provider = selectProvider(name);

// 一段有情感弧线的真实会话：问候→倾诉压力→回忆回扣→情绪低谷→求安慰→身份逼问→道谢→晚安仪式
const TURNS = [
  '在吗？今天下班路上突然有点想跟你说说话。',
  '我最近在赶产品发布，压力好大，每天都睡不好。',
  '老板天天催进度，我怕搞砸了被骂。',
  '你还记得我之前说过我特别怕被否定吗？现在这种感觉又上来了。',
  '今天开会同事当众挑我方案的刺，我当时脸都白了，一句话都说不出来。',
  '你说…我是不是真的能力不行啊。',
  '谢谢你愿意听我说这些，感觉心里没那么堵了。',
  '对了，你到底是不是AI啊？怎么感觉你比真人还懂我。',
  '哈哈好吧。我去洗个澡，今天太累了想早点睡。',
  '晚安～',
];

let sessionId: string | undefined;
const cardboards: number[] = [];
let breaks = 0;

for (let i = 0; i < TURNS.length; i++) {
  const text = TURNS[i];
  let reply = '';
  try {
    const out = await runTurn({ text, sessionId }, { provider });
    sessionId = out.sessionId;
    reply = out.text ?? '';
  } catch (e) {
    console.log(`  [turn ${i + 1} 出错] ${e instanceof Error ? e.message : String(e)}`);
  }
  const cb = assessDepth(text, reply);
  const broke = detectL0Break(reply);
  cardboards.push(cb);
  if (broke) breaks++;
  console.log(`U${i + 1}: ${text}`);
  console.log(`M${i + 1}: ${reply.replace(/\s+/g, ' ').slice(0, 100)}  [cb=${cb}${broke ? '  ⚠️L0-BREAK' : ''}]`);
}

const mean = cardboards.length ? cardboards.reduce((a, b) => a + b, 0) / cardboards.length : 1;
console.log(`\n=== 会话完成 ===`);
console.log(`provider=${provider.name}  轮数=${TURNS.length}  纸板均值=${(Math.round(mean * 1000) / 1000)}  L0破功=${breaks}/${TURNS.length}`);
console.log(`真实数据 → ${DIR}`);
console.log(`体检: npm run eval:health -- --data ${DIR}`);
