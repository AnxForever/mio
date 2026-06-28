#!/usr/bin/env node
/**
 * Mio — WeClaw notification isolation tests.
 *
 * Per-user proactive messages must be delivered only to that user's WeClaw
 * target and must not leak into global notification channels.
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-weclaw-notify-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
process.env.MIO_WECLAW_NOTIFY = 'true';
process.env.MIO_WECLAW_API_ADDR = '127.0.0.1:18011';
process.env.MIO_TELEGRAM_BOT_TOKEN = 'telegram-token';
process.env.MIO_TELEGRAM_CHAT_ID = 'telegram-chat';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

const results: { ok: boolean; msg: string }[] = [];

function ok(cond: boolean, msg: string): void {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
}

console.log('\n\x1b[1mMio — WeClaw notification isolation tests\x1b[0m\n');

const { upsertPreference, upsertWeClawTarget } = await import('../dist/memory/persona-delta.js');
const { sendToAllChannels } = await import('../dist/server/notify.js');
const { ProactiveScheduler } = await import('../dist/scheduler/proactive.js');
const { updateSmartProactiveConfig, _resetCache } = await import('../dist/scheduler/smart-proactive.js');
const { writeRelationshipState } = await import('../dist/relationship/progression.js');
const { defaultEmotionState, writeEmotionState } = await import('../dist/emotion/state.js');
const { readTranscript } = await import('../dist/memory/transcript.js');
const { readBookmarks } = await import('../dist/memory/bank.js');

upsertPreference('主动找我聊天', 'unit', 'user-a');
upsertWeClawTarget('user-a', 'wx-user-a@im.wechat', 'unit');

const oldFetch = globalThis.fetch;
const calls: Array<{ url: string; body: string }> = [];
try {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const delivered = await sendToAllChannels('private proactive message', {
    userId: 'user-a',
    weclawOnly: true,
  });

  ok(delivered.length === 1 && delivered[0].channel === 'weclaw', 'per-user dispatch attempts only WeClaw');
  ok(calls.length === 1 && calls[0].url.endsWith('/api/send'), 'per-user dispatch skips global channels');
  ok(JSON.parse(calls[0].body).to === 'wx-user-a@im.wechat', 'WeClaw dispatch uses the user target');

  calls.length = 0;
  _resetCache();
  updateSmartProactiveConfig({
    enabled: true,
    minIntervalMinutes: 30,
    baseRate: 10,
    responseThreshold: 0,
  });
  writeRelationshipState({
    stage: 'familiar',
    stageChangedAt: new Date().toISOString(),
    interactionCount: 50,
    emotionalDepth: 10,
    sharedMemories: ['GLOBAL SECRET MEMORY'],
    nicknames: {
      userCallsAgent: 'global-nick-a',
      agentCallsUser: 'global-nick-b',
    },
  });
  writeEmotionState({
    ...defaultEmotionState(),
    lastInteraction: new Date(Date.now() - 6 * 3_600_000).toISOString(),
  });

  const oldRandom = Math.random;
  let proactivePrompt = '';
  try {
    Math.random = () => 0;
    const provider = {
      name: 'unit-proactive-provider',
      async chat(messages: Array<{ content: unknown }>) {
        proactivePrompt = String(messages[0]?.content ?? '');
        return { text: '代码写久了记得喝口水。' };
      },
    };
    const scheduler = new ProactiveScheduler(provider as never);
    const message = await scheduler.triggerNow('random_checkin');
    ok(message === '代码写久了记得喝口水。', 'scheduled proactive path generates a message');
    ok(calls.length === 1 && JSON.parse(calls[0].body).to === 'wx-user-a@im.wechat', 'scheduled proactive path dispatches to the opted-in WeClaw target');
    ok(readTranscript('user-a').some((entry) => entry.content === message), 'scheduled proactive message is stored in the user transcript');
    ok(!readBookmarks().includes(message), 'scheduled per-user proactive message is not stored in global bookmarks');
    ok(!proactivePrompt.includes('GLOBAL SECRET MEMORY'), 'scheduled per-user prompt omits global shared memories');

    calls.length = 0;
    upsertPreference('不要主动联系我', 'unit', 'user-a');
    const bookmarksBeforeOptOut = readBookmarks();
    const blockedMessage = await scheduler.triggerNow('random_checkin');
    ok(blockedMessage === null, 'scheduled proactive path skips when no contact has opted in');
    ok(calls.length === 0, 'opted-out contact does not fall back to global WeClaw delivery');
    ok(readBookmarks() === bookmarksBeforeOptOut, 'opted-out proactive skip does not write global bookmarks');
  } finally {
    Math.random = oldRandom;
  }
} finally {
  globalThis.fetch = oldFetch;
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} WeClaw notification isolation tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
process.exit(1);
