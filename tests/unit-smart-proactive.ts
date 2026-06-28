#!/usr/bin/env node
/**
 * Mio — smart proactive scheduler isolation tests.
 *
 * Verifies that proactive cooldowns are scoped per user/contact. This keeps one
 * WeChat contact's opt-in outreach from blocking another contact.
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
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
  recordProactiveMessage,
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
  });

  const longAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  recordProactiveMessage(true, undefined, 'user-a');
  const aDecision = decideProactiveMessage('intimate', longAgo, 'user-a');
  ok(!aDecision.shouldMessage && aDecision.reason.includes('cooldown'), 'recent proactive message cools down the same user');

  const bDecision = decideProactiveMessage('intimate', longAgo, 'user-b');
  ok(bDecision.shouldMessage, 'user A cooldown does not block user B');

  recordProactiveMessage(true);
  const cDecision = decideProactiveMessage('intimate', longAgo, 'user-c');
  ok(cDecision.shouldMessage, 'global fallback cooldown does not block per-user delivery');
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
