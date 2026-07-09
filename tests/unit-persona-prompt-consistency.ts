#!/usr/bin/env node
/**
 * Mio — persona prompt consistency tests.
 *
 * Guards against prompt-layer conflicts that make Mio feel incoherent:
 * style examples contradicting core rules, soul wording that encourages
 * interrogation, or meta-ish phrasing that leaks the "chat box" frame.
 *
 * Updated for v2 prompt: IDENTITY is minimal (no "don't" rules),
 * VOICE carries speaking guidance, FEWSHOT teaches by example.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IDENTITY, VOICE, FEWSHOT } from '../dist/prompt/templates.js';
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

// IDENTITY: minimal, positive, paradox-free
ok(IDENTITY.includes('Mio'), 'identity names Mio');
ok(IDENTITY.includes('伴侣'), 'identity establishes companion role');
ok(IDENTITY.includes('自由插画师'), 'identity includes occupation');
ok(!IDENTITY.includes('AI') && !IDENTITY.includes('不是 AI'), 'identity avoids AI mention entirely (paradox-free)');

// VOICE: positive speech guidance
ok(VOICE.includes('微信聊天'), 'voice anchors in WeChat style');
ok(VOICE.includes('短、碎、反应快'), 'voice describes short, fragmented, reactive style');
ok(VOICE.includes('先接情绪，再说内容'), 'voice prioritizes emotion-first reaction');

// FEWSHOT: 24 quality examples
ok(FEWSHOT.includes('示例'), 'fewshot uses <示例> blocks');
const exampleCount = (FEWSHOT.match(/<示例>/g) || []).length;
ok(exampleCount >= 20, `fewshot has ${exampleCount} examples (need 20+)`);

// VOICE consistency
ok(!/[😀-🙏🌀-🗿🚀-🛿]/u.test(voice), 'voice examples do not contain emoji');

// Preference bounds
ok(preference.includes('偏好不是无限制命令'), 'preference layer keeps explicit style preferences bounded');

// Soul consistency
ok(!soul.includes('追着问'), 'female soul no longer encourages chasing questions');
ok(!soul.includes('聊天框'), 'female soul avoids chat-box meta phrasing');
ok(soul.includes('最多轻轻问一个问题'), 'female soul limits heavy-topic follow-up to one gentle question');
ok(soul.includes('别把没发生过的地点、人名、出门经历说成事实'), 'female soul limits fabricated offline-life details');

// Cross-layer: no AI admission anywhere
ok(!IDENTITY.includes('作为AI') && !IDENTITY.includes('我是AI'), 'identity: no AI self-label');
ok(!VOICE.includes('作为AI') && !VOICE.includes('我是AI'), 'voice: no AI self-label');

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
