#!/usr/bin/env node
/** Unit test for src/persona/own-life.ts（独立生活流露段）。 */

import { buildOwnLifeSection } from '../dist/persona/own-life.js';

interface R { name: string; passed: boolean; detail?: string; }
const results: R[] = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// month 0-indexed: 5 = June
const night = buildOwnLifeSection(new Date(2026, 5, 28, 2, 0, 0));   // deep-night
const morning = buildOwnLifeSection(new Date(2026, 5, 28, 10, 0, 0)); // morning
const evening = buildOwnLifeSection(new Date(2026, 5, 28, 20, 0, 0)); // evening

check('深夜段非空且含"别每轮"引导', night.length > 0 && night.includes('别每轮'), `len=${night.length}`);
check('上午段非空', morning.length > 0);
check('不同时段内容不同', night !== morning && morning !== evening);
check('含"自己的日子/生活"框架', evening.includes('自己的日子') || evening.includes('自己的生活'));
check('不含 AI 自报词（不破 P5）', !/我是\s*AI|人工智能|大模型|语言模型/.test(night + morning + evening));
check('明确禁止把地点/出门/吃什么说成事实', evening.includes('不要把具体地点、出门、吃了什么、路过哪里说成事实'));
const activityText = [night, morning, evening]
  .map((text) => text.match(/此刻你大概处在：(.+?)（这一类抽象状态/s)?.[1] ?? '')
  .join('、');
check('活动状态不提供具体线下经历素材', !/(出门|去了|路过|咖啡馆|餐厅|商场|公园|吃了|喝了|买了)/.test(activityText), activityText);

const passed = results.filter((r) => r.passed).length;
console.log(`\nown-life: ${passed}/${results.length} passed`);
process.exit(results.every((r) => r.passed) ? 0 : 1);
