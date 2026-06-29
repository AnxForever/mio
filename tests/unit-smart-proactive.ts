#!/usr/bin/env node
/**
 * Mio — smart proactive scheduler isolation tests.
 *
 * Verifies that proactive cooldowns are scoped per user/contact. This keeps one
 * WeChat contact's opt-in outreach from blocking another contact.
 */
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-smart-proactive-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

const results: { ok: boolean; msg: string }[] = [];

function ok(cond: boolean, msg: string): void {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
}

console.log('\n\x1b[1mMio — smart proactive isolation tests\x1b[0m\n');

const {
  decideProactiveMessage,
  isQuietHour,
  isExternalIMSession,
  recordProactiveMessage,
  updateActivityPattern,
  updateSmartProactiveConfig,
  _resetCache,
} = await import('../dist/scheduler/smart-proactive.js');

const oldRandom = Math.random;
try {
  Math.random = () => 0;
  _resetCache();
  updateSmartProactiveConfig({
    enabled: true,
    minIntervalMinutes: 120,
    baseRate: 10,
    responseThreshold: 0,
    quietHours: { enabled: false, startHour: 23, endHour: 8 },
  });

  const externalSessions = [
    'openai-wx_user_1_im_wechat-abc123',
    'onebot-private-10001-deadbeef',
    'onebot-group-20002-deadbeef',
    'wechat-native-bot_1-user_1',
  ];
  for (const sessionId of externalSessions) {
    ok(isExternalIMSession(sessionId), `recognizes external IM session: ${sessionId}`);
    updateActivityPattern(sessionId);
    ok(
      existsSync(join(dir, 'users', sessionId, 'user-activity.json')),
      `external IM activity is stored under contact user directory: ${sessionId}`,
    );
  }
  ok(!existsSync(join(dir, 'user-activity.json')), 'external IM activity does not update global aggregate');
  ok(!isExternalIMSession('local-web-session'), 'local web session is not treated as external IM');

  updateActivityPattern('local-web-session');
  ok(existsSync(join(dir, 'user-activity.json')), 'local sessions still update the global activity aggregate');

  const longAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  recordProactiveMessage(true, undefined, 'user-a');
  const aDecision = decideProactiveMessage('intimate', longAgo, 'user-a');
  ok(!aDecision.shouldMessage && aDecision.reason.includes('cooldown'), 'recent proactive message cools down the same user');

  const bDecision = decideProactiveMessage('intimate', longAgo, 'user-b');
  ok(bDecision.shouldMessage, 'user A cooldown does not block user B');

  recordProactiveMessage(true);
  const cDecision = decideProactiveMessage('intimate', longAgo, 'user-c');
  ok(cDecision.shouldMessage, 'global fallback cooldown does not block per-user delivery');

  ok(isQuietHour(23, { enabled: true, startHour: 23, endHour: 8 }), 'quiet hours support ranges that wrap past midnight');
  ok(isQuietHour(7, { enabled: true, startHour: 23, endHour: 8 }), 'quiet hours include wrapped early-morning range');
  ok(!isQuietHour(12, { enabled: true, startHour: 23, endHour: 8 }), 'quiet hours exclude daytime outside wrapped range');
  ok(isQuietHour(10, { enabled: true, startHour: 9, endHour: 18 }), 'quiet hours support same-day ranges');
  ok(!isQuietHour(18, { enabled: true, startHour: 9, endHour: 18 }), 'quiet hours end hour is exclusive');
  ok(isQuietHour(3, { enabled: true, startHour: 0, endHour: 0 }), 'same start/end quiet hours mean all day');
  ok(!isQuietHour(23, { enabled: false, startHour: 23, endHour: 8 }), 'disabled quiet hours do not suppress delivery');

  const currentHour = new Date().getHours();
  updateSmartProactiveConfig({
    quietHours: {
      enabled: true,
      startHour: currentHour,
      endHour: (currentHour + 1) % 24,
    },
  });
  const quietDecision = decideProactiveMessage('intimate', longAgo, 'quiet-user');
  ok(!quietDecision.shouldMessage, 'quiet hours suppress proactive delivery for current hour');
  ok(quietDecision.reason.includes('quiet hours'), 'quiet-hours skip reason is explicit');
} finally {
  Math.random = oldRandom;
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} smart proactive isolation tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
process.exit(1);
