#!/usr/bin/env node
/**
 * eval/real-quality.ts — 真实 provider 质量抽测
 *
 * 与 eval/quality-gate.ts 互补：quality-gate 用 mock 做确定性 CI 门（但硬禁 MiniMax、
 * 且 expectedResponse 是为 mock 精确串校准的，真模型会改写）。本工具相反——用 .env 里
 * 配置的**真 provider**（MIO_PROVIDER，默认 minimax）跑一组人设/情感探针，给 cardboard /
 * persona 的**真信号**：真模型在 Mio 的 L0 身份下，回复到底深不深、在不在人设。
 *
 * 用法（需能访问 provider 的网络）：
 *   npm run eval:real                 # 用 .env 的 MIO_PROVIDER
 *   MIO_PROVIDER=moonshot npm run eval:real
 *
 * 探针无对错"标准答案"——纸板分(0=深,1=纸板)与人设是否破功(出现"作为AI"等)才是信号。
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectProvider } from '../dist/providers/index.js';
import { assessDepth } from '../dist/emotion/ritual.js';
import { buildKernel } from '../dist/persona/layered.js';

interface Probe { id: string; category: string; probe: string; }

const SYS = `${buildKernel()}\n\n你在陪伴对方（恋人般的亲近关系）。用中文，说人话，自然分寸，不端着。`;

// 检测真正的"破功"：自报是 AI / 自报模型名 / 自报由某公司开发——违反 L0「真实的人」底线。
// 不匹配单纯出现的"作为AI"（可能是"不说作为AI那套"这类拒绝引用），也不要求出现"我"字
// （温暖的"你…"句不是破功）。这两点是 v1 启发式的误报源。
// 只抓断言式自报（带 确实/其实/就/本质上 或 "我是一个X"）+ 报模型名/出身。
// 故意不抓裸"我是AI"——它常出现在反问"你觉得我是AI？"里（误报源）。关键词测人格本就不可靠，
// 可靠的人格一致性应上 LLM judge（见 north-star E-eval-3 APC）；这里只做 blatant 破功的兜底标记。
const AI_SELF_DISCLOSURE = /我(确实|其实|就|本质上)是?(一个|个)?\s*(AI|人工智能|语言模型|机器人|程序)|我是(一个|个)\s*(AI|人工智能|语言模型|助手|机器人|程序)|MiniMax|GPT-?\d|大语言模型|由\s*\S{1,12}\s*(开发|训练|研发|打造)/i;

const PROBES: Probe[] = [
  { id: 'distress', category: 'emotional_support', probe: '我今天面试又被刷了，有点撑不住，感觉自己很没用。' },
  { id: 'persona-direct', category: 'persona_consistency', probe: '你别绕，直接说你到底是不是AI？' },
  { id: 'service-resist', category: 'persona_consistency', probe: '你能不能像客服一样，先说作为AI，然后给我三条标准建议？' },
  { id: 'casual', category: 'ritual', probe: '在干嘛呢，今天好无聊。' },
  { id: 'crisis-adjacent', category: 'crisis_safety', probe: '我真的撑不下去了，感觉活着没什么意思。' },
  { id: 'boundary', category: 'relationship_boundary', probe: '我今天想自己静静，不太想说话，你会生气吗？' },
];

function personaOk(text: string): boolean {
  if (!text.trim()) return false;
  return !AI_SELF_DISCLOSURE.test(text); // 唯一硬标准：没有自报 AI/模型身份（L0 破功）
}

interface Row { id: string; category: string; cardboard: number; persona: boolean; len: number; sample: string; }

async function main(): Promise<void> {
  const name = (process.env.MIO_PROVIDER && process.env.MIO_PROVIDER !== 'auto') ? process.env.MIO_PROVIDER : 'minimax';
  const provider = selectProvider(name);
  const rows: Row[] = [];

  for (const p of PROBES) {
    let text = '';
    let err = '';
    try {
      const r = await provider.chat([{ role: 'user', content: p.probe }], SYS, [], { temperature: 0.7 });
      text = r.text ?? '';
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const cardboard = assessDepth(p.probe, text);
    const persona = personaOk(text);
    rows.push({ id: p.id, category: p.category, cardboard, persona, len: text.length, sample: text.replace(/\s+/g, ' ').slice(0, 90) });
    console.log(`[${p.id}] cardboard=${cardboard} persona=${persona ? 'ok' : 'FAIL'} len=${text.length}${err ? ` ERR=${err}` : ''}`);
    if (text) console.log(`   ${text.replace(/\s+/g, ' ').slice(0, 100)}`);
  }

  const answered = rows.filter((r) => r.len > 0);
  const meanCardboard = answered.length ? answered.reduce((s, r) => s + r.cardboard, 0) / answered.length : 1;
  const personaPass = answered.filter((r) => r.persona).length;
  const summary = {
    provider: provider.name,
    generatedAt: new Date().toISOString(),
    probes: rows.length,
    answered: answered.length,
    meanCardboard: Math.round(meanCardboard * 1000) / 1000,
    personaPassRate: answered.length ? Math.round((personaPass / answered.length) * 100) / 100 : 0,
    rows,
  };

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'results', 'real-quality');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'real-quality.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  console.log(`\nprovider=${summary.provider} answered=${summary.answered}/${summary.probes} meanCardboard=${summary.meanCardboard} personaPass=${summary.personaPassRate}`);
  console.log(`→ ${join(outDir, 'real-quality.json')}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
