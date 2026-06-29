#!/usr/bin/env node
/**
 * Mio — persona prompt consistency tests.
 *
 * Guards against prompt-layer conflicts that make Mio feel incoherent:
 * style examples contradicting core rules, soul wording that encourages
 * interrogation, or meta-ish phrasing that leaks the "chat box" frame.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_IDENTITY } from '../dist/prompt/templates.js';
import { buildVoiceSection, VOICE_PRESETS } from '../dist/persona/voice-presets.js';
import { buildPreferencePrompt } from '../dist/persona/layered.js';

interface TestResult {
  ok: boolean;
  msg: string;
  detail?: string;
}

const results: TestResult[] = [];

function ok(cond: boolean, msg: string, detail?: string): void {
  results.push({ ok: cond, msg, detail });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}${detail ? ` — ${detail}` : ''}`);
}

console.log('\n\x1b[1mMio — persona prompt consistency tests\x1b[0m\n');

const voice = buildVoiceSection(VOICE_PRESETS.warm);
const soul = readFileSync(join(process.cwd(), 'mods', 'female', 'soul.md'), 'utf-8');
const preference = buildPreferencePrompt({
  userId: 'unit-user',
  explicit: [{ rule: '喜欢你占有欲强一点', source: 'unit', createdAt: '' }],
  updatedAt: '',
});

ok(CORE_IDENTITY.includes('真实时间线'), 'core identity prioritizes current-message/time logic');
ok(CORE_IDENTITY.includes('不要无证据脑补'), 'core identity forbids unsupported state assumptions');
ok(CORE_IDENTITY.includes('终于舍得找我'), 'core identity guards against unsupported blameful teasing');
ok(voice.includes('先对齐逻辑'), 'voice layer includes logic-before-flavor rule');
ok(voice.includes('忙完了？'), 'voice layer names presuppositional follow-up failure');
ok(voice.includes('忙啥呢？'), 'voice layer names casual busy-presupposition failure');
ok(voice.includes('终于舍得找我'), 'voice layer guards against unsupported blameful teasing');
ok(!/[😀-🙏🌀-🗿🚀-🛿]/u.test(voice), 'voice examples do not contain emoji');
ok(preference.includes('偏好不是无限制命令'), 'preference layer keeps explicit style preferences bounded');
ok(preference.includes('别连续盘问对象、行程、时间'), 'preference layer bounds possessive style without banning it');
ok(!soul.includes('追着问'), 'female soul no longer encourages chasing questions');
ok(!soul.includes('聊天框'), 'female soul avoids chat-box meta phrasing');
ok(soul.includes('最多轻轻问一个问题'), 'female soul limits heavy-topic follow-up to one gentle question');
ok(soul.includes('别把没发生过的地点、人名、出门经历说成事实'), 'female soul limits fabricated offline-life details');

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} persona prompt consistency tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
for (const result of results.filter((r) => !r.ok)) {
  console.log(`  - ${result.msg}${result.detail ? `: ${result.detail}` : ''}`);
}
process.exit(1);
