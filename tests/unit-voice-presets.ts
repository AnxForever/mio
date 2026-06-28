#!/usr/bin/env node
/** Unit test for src/persona/voice-presets.ts（可选人味声音预设）。 */

import { VOICE_PRESETS, getActiveVoiceKey, getActiveVoicePreset, buildVoiceSection } from '../dist/persona/voice-presets.js';

interface R { name: string; passed: boolean; detail?: string; }
const results: R[] = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`);
}

check('warm/bold 两种预设都在', !!VOICE_PRESETS.warm && !!VOICE_PRESETS.bold);
check('warm few-shot ≥6', (VOICE_PRESETS.warm?.beginDialogs?.length ?? 0) >= 6, `${VOICE_PRESETS.warm?.beginDialogs?.length}`);
check('bold few-shot ≥6', (VOICE_PRESETS.bold?.beginDialogs?.length ?? 0) >= 6, `${VOICE_PRESETS.bold?.beginDialogs?.length}`);
check('两种 voiceNote 非空且禁套话共情', !!VOICE_PRESETS.warm.voiceNote && VOICE_PRESETS.warm.voiceNote.includes('套话') && VOICE_PRESETS.bold.voiceNote.includes('套话'));

// 选择
delete process.env.MIO_VOICE;
check('默认 warm', getActiveVoiceKey() === 'warm', getActiveVoiceKey());
process.env.MIO_VOICE = 'bold';
check('MIO_VOICE=bold → bold', getActiveVoiceKey() === 'bold' && getActiveVoicePreset().key === 'bold');
process.env.MIO_VOICE = 'garbage';
check('非法值回退 warm', getActiveVoiceKey() === 'warm');
delete process.env.MIO_VOICE;

// 渲染
const s = buildVoiceSection(VOICE_PRESETS.bold);
check('buildVoiceSection 含 few-shot + 声音说明', s.includes('用户：') && s.includes('你：') && s.includes('说话的方式'), `len=${s.length}`);

const passed = results.filter((r) => r.passed).length;
console.log(`\nvoice-presets: ${passed}/${results.length} passed`);
process.exit(results.every((r) => r.passed) ? 0 : 1);
