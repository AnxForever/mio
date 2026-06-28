#!/usr/bin/env node
/**
 * Mio — circadian state tests (B: 时间/状态感知).
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-circadian.ts
 */
import { describeCircadianState } from '../dist/emotion/circadian.js';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — circadian tests\x1b[0m\n');

// 各时段映射
ok(describeCircadianState(2).phase === 'deep-night', '02:00 → deep-night');
ok(describeCircadianState(7).phase === 'early-morning', '07:00 → early-morning');
ok(describeCircadianState(10).phase === 'morning', '10:00 → morning');
ok(describeCircadianState(13).phase === 'noon', '13:00 → noon');
ok(describeCircadianState(15).phase === 'afternoon', '15:00 → afternoon');
ok(describeCircadianState(20).phase === 'evening', '20:00 → evening');
ok(describeCircadianState(23).phase === 'late-night', '23:00 → late-night');

// 边界
ok(describeCircadianState(0).phase === 'deep-night', '00:00 boundary → deep-night');
ok(describeCircadianState(6).phase === 'early-morning', '06:00 boundary → early-morning');
ok(describeCircadianState(9).phase === 'morning', '09:00 boundary → morning');
ok(describeCircadianState(22).phase === 'late-night', '22:00 boundary → late-night');

// 每个 phase 都有非空 guidance
for (const h of [2, 7, 10, 13, 15, 20, 23]) {
  ok(describeCircadianState(h).guidance.trim().length > 0, `${h}:00 has non-empty guidance`);
}

// 深夜/夜深指引应体现"短/睡意"
ok(/困|睡|短/.test(describeCircadianState(2).guidance), 'deep-night guidance hints sleepiness/brevity');
ok(/短|轻|慵懒/.test(describeCircadianState(23).guidance), 'late-night guidance hints lighter/shorter');

// 越界归一化
ok(describeCircadianState(25).phase === describeCircadianState(1).phase, 'hour 25 normalizes to 01:00');
ok(describeCircadianState(-1).phase === describeCircadianState(23).phase, 'hour -1 normalizes to 23:00');

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} circadian tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
