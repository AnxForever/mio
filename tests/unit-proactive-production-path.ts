#!/usr/bin/env node
/**
 * Mio — proactive production-path quality gate tests.
 *
 * Covers the real sendProactiveMessage path, not just the local quality
 * function: rejected messages must not enter delivery, callbacks, buffers, or
 * contact transcripts; accepted abstract own-life messages should pass.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-proactive-production-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
process.env.MIO_WECLAW_NOTIFY = 'true';
process.env.MIO_WECLAW_API_ADDR = '127.0.0.1:18011';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

const results: { ok: boolean; msg: string; detail?: string }[] = [];

function ok(cond: boolean, msg: string, detail?: string): void {
  results.push({ ok: cond, msg, detail });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}${detail && !cond ? ` — ${detail}` : ''}`);
}

console.log('\n\x1b[1mMio — proactive production path tests\x1b[0m\n');

const { upsertPreference, upsertWeClawTarget } = await import('../dist/memory/persona-delta.js');
const { ProactiveScheduler } = await import('../dist/scheduler/proactive.js');
const { updateSmartProactiveConfig } = await import('../dist/scheduler/smart-proactive.js');
const { writeRelationshipState } = await import('../dist/relationship/progression.js');
const { defaultEmotionState, writeEmotionState } = await import('../dist/emotion/state.js');
const { readTranscript } = await import('../dist/memory/transcript.js');
const { replyQualityInterventionsPath } = await import('../dist/memory/paths.js');
const { observeAssistantTemporalCommitments } = await import('../dist/memory/temporal-state.js');
const { readRecentProactiveDecisionTrace } = await import('../dist/scheduler/proactive-trace.js');

upsertPreference('主动找我聊天', 'unit', 'user-a');
upsertWeClawTarget('user-a', 'wx-user-a@im.wechat', 'unit');
upsertPreference('主动找我聊天', 'unit', 'user-space');
upsertWeClawTarget('user-space', 'wx-user-space@im.wechat', 'unit');
upsertPreference('主动找我聊天', 'unit', 'user-quiet');
upsertWeClawTarget('user-quiet', 'wx-user-quiet@im.wechat', 'unit');

writeRelationshipState({
  stage: 'intimate',
  stageChangedAt: new Date().toISOString(),
  interactionCount: 100,
  emotionalDepth: 80,
  sharedMemories: [],
  nicknames: {
    userCallsAgent: null,
    agentCallsUser: null,
  },
});
writeEmotionState({
  ...defaultEmotionState(),
  lastInteraction: new Date(Date.now() - 8 * 3_600_000).toISOString(),
});

const oldFetch = globalThis.fetch;
const calls: Array<{ url: string; body: string }> = [];

function readInterventions(): Array<{
  type?: string;
  reason?: string;
  before?: string;
  after?: string;
  turnRoute?: { tags?: string[] };
}> {
  const path = replyQualityInterventionsPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function runCandidate(
  text: string,
  userId = 'user-a',
  opts: {
    skipSmartGate?: boolean;
    recordSmartOutcome?: boolean;
  } = {},
): Promise<{
  returned: string | null;
  callbackCount: number;
  drained: Array<{ content: string }>;
  chatCalls: number;
  systemPrompts: string[];
  taskPrompts: string[];
}> {
  let chatCalls = 0;
  const systemPrompts: string[] = [];
  const taskPrompts: string[] = [];
  const provider = {
    name: 'unit-proactive-production-provider',
    async chat(messages: Array<{ role?: string; content?: unknown }>, systemPrompt: string) {
      chatCalls += 1;
      systemPrompts.push(systemPrompt);
      const firstUser = messages.find((message) => message.role === 'user');
      if (typeof firstUser?.content === 'string') taskPrompts.push(firstUser.content);
      return { text };
    },
  };
  const scheduler = new ProactiveScheduler(provider as never);
  let callbackCount = 0;
  scheduler.setMessageCallback(() => {
    callbackCount += 1;
  });
  const returned = await scheduler.sendProactiveMessage('random_checkin', userId, {
    skipSmartGate: opts.skipSmartGate ?? true,
    recordSmartOutcome: opts.recordSmartOutcome ?? false,
  });
  return { returned, callbackCount, drained: scheduler.drainMessages(), chatCalls, systemPrompts, taskPrompts };
}

try {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const waitingText = '你还知道回来啊，我等你这么久。';
  const waiting = await runCandidate(waitingText);
  ok(waiting.returned === null, 'rejects waiting/blame copy on the real proactive path');
  ok(waiting.callbackCount === 0, 'waiting/blame rejection does not trigger message callback');
  ok(waiting.drained.length === 0, 'waiting/blame rejection does not enter message buffer');
  ok(calls.length === 0, 'waiting/blame rejection is not dispatched');
  ok(!readTranscript('user-a').some((entry) => entry.content === waitingText), 'waiting/blame rejection is not stored in contact transcript');
  ok(
    readInterventions().some((row) => (
      row.type === 'proactive_quality_reject'
      && row.reason?.includes('waiting-or-blame-arc')
      && row.before === waitingText
      && row.after === '[NO_MSG]'
      && row.turnRoute?.tags?.includes('temporal_state')
    )),
    'waiting/blame rejection writes temporal quality intervention',
  );
  ok(
    readRecentProactiveDecisionTrace().some((row) => (
      row.outcome === 'rejected'
      && row.phase === 'quality_gate'
      && row.reasonCode === 'quality_gate_reject'
      && row.reason.includes('waiting-or-blame-arc')
      && row.routeTags?.includes('temporal_state')
    )),
    'waiting/blame rejection writes proactive decision trace',
  );

  const offlineText = '刚路过一家咖啡馆，突然想到你。';
  const offline = await runCandidate(offlineText);
  ok(offline.returned === null, 'rejects fabricated offline-life copy on the real proactive path');
  ok(calls.length === 0, 'fabricated offline-life rejection is not dispatched');
  ok(
    readInterventions().some((row) => (
      row.type === 'proactive_quality_reject'
      && row.reason?.includes('fabricated-offline-life')
      && row.before === offlineText
      && row.turnRoute?.tags?.includes('offline_life')
    )),
    'fabricated offline-life rejection writes offline-life quality intervention',
  );
  ok(
    readRecentProactiveDecisionTrace().some((row) => (
      row.outcome === 'rejected'
      && row.reason.includes('fabricated-offline-life')
      && row.messagePreview === offlineText
      && row.routeTags?.includes('offline_life')
    )),
    'fabricated offline-life rejection writes proactive decision trace',
  );

  const phoneWaitingText = '那我先刷会儿手机等你。';
  const phoneWaiting = await runCandidate(phoneWaitingText);
  ok(phoneWaiting.returned === null, 'rejects concrete own-activity waiting copy on the real proactive path');
  ok(calls.length === 0, 'concrete own-activity waiting rejection is not dispatched');
  ok(!readTranscript('user-a').some((entry) => entry.content === phoneWaitingText), 'concrete own-activity waiting rejection is not stored in contact transcript');
  ok(
    readInterventions().some((row) => (
      row.type === 'proactive_quality_reject'
      && row.reason?.includes('fabricated-offline-life')
      && row.reason?.includes('waiting-or-blame-arc')
      && row.before === phoneWaitingText
      && row.turnRoute?.tags?.includes('offline_life')
      && row.turnRoute?.tags?.includes('temporal_state')
    )),
    'concrete own-activity waiting rejection writes offline-life and temporal intervention',
  );
  ok(
    phoneWaiting.taskPrompts.some((prompt) => (
      prompt.includes('do not invent concrete offline activities')
      && prompt.includes('scrolling my phone while waiting for you')
      && prompt.includes('Do not make waiting for the user into a story')
    )),
    'proactive subagent task prompt forbids concrete offline activity and waiting stories',
  );

  const hookText = '我刚拍了一张照片，想看吗？';
  const hook = await runCandidate(hookText);
  ok(hook.returned === null, 'rejects curiosity/FOMO hook on the real proactive path');
  ok(hook.callbackCount === 0, 'curiosity hook rejection does not trigger message callback');
  ok(hook.drained.length === 0, 'curiosity hook rejection does not enter message buffer');
  ok(calls.length === 0, 'curiosity hook rejection is not dispatched');
  ok(!readTranscript('user-a').some((entry) => entry.content === hookText), 'curiosity hook rejection is not stored in contact transcript');
  ok(
    readInterventions().some((row) => (
      row.type === 'proactive_quality_reject'
      && row.reason?.includes('curiosity-hook-pressure')
      && row.before === hookText
      && row.after === '[NO_MSG]'
      && row.turnRoute?.tags?.includes('proactive')
    )),
    'curiosity hook rejection writes proactive quality intervention',
  );
  ok(
    readRecentProactiveDecisionTrace().some((row) => (
      row.outcome === 'rejected'
      && row.phase === 'quality_gate'
      && row.reason.includes('curiosity-hook-pressure')
      && row.messagePreview === hookText
      && row.routeTags?.includes('proactive')
    )),
    'curiosity hook rejection writes proactive decision trace',
  );

  const safeText = '我这边刚把脑子放空了一点，想到你。看到就好，不用回。';
  const safe = await runCandidate(safeText);
  ok(safe.returned === safeText, 'allows abstract own-life state on the real proactive path');
  ok(safe.callbackCount === 1, 'accepted proactive message triggers callback once');
  ok(safe.drained.length === 1 && safe.drained[0].content === safeText, 'accepted proactive message enters buffer');
  ok(calls.length === 1, 'accepted proactive message is dispatched once');
  ok(JSON.parse(calls[0].body).text === safeText, 'accepted proactive dispatch carries generated text');
  ok(readTranscript('user-a').some((entry) => entry.content === safeText), 'accepted proactive message is stored in contact transcript');
  ok(
    !readInterventions().some((row) => row.before === safeText),
    'accepted proactive message does not write a rejection intervention',
  );
  ok(
    readRecentProactiveDecisionTrace().some((row) => (
      row.outcome === 'sent'
      && row.phase === 'dispatch'
      && row.reasonCode === 'sent'
      && row.messagePreview === safeText
    )),
    'accepted proactive message writes sent decision trace',
  );

  calls.length = 0;
  observeAssistantTemporalCommitments(
    'user-space',
    '那我先不打扰你，你慢慢弄。',
    new Date(),
  );
  const quiet = await runCandidate('代码写久了记得喝口水。', 'user-space');
  ok(quiet.returned === null, 'skips proactive message while no-interrupt promise is active');
  ok(quiet.chatCalls === 0, 'no-interrupt skip does not call proactive subagent/provider');
  ok(quiet.callbackCount === 0, 'no-interrupt skip does not trigger callback');
  ok(quiet.drained.length === 0, 'no-interrupt skip does not enter message buffer');
  ok(calls.length === 0, 'no-interrupt skip is not dispatched');
  ok(!readTranscript('user-space').some((entry) => entry.content === '代码写久了记得喝口水。'), 'no-interrupt skip is not stored in contact transcript');
  ok(
    readRecentProactiveDecisionTrace().some((row) => (
      row.outcome === 'skipped'
      && row.phase === 'temporal'
      && row.reasonCode === 'no_interrupt_active'
      && row.userId === 'user-space'
      && row.routeTags?.includes('temporal_state')
    )),
    'no-interrupt skip writes proactive decision trace',
  );

  const currentHour = new Date().getHours();
  updateSmartProactiveConfig({
    quietHours: {
      enabled: true,
      startHour: currentHour,
      endHour: (currentHour + 1) % 24,
    },
  });
  const quietHour = await runCandidate('这个不应该生成。', 'user-quiet', {
    skipSmartGate: false,
    recordSmartOutcome: false,
  });
  ok(quietHour.returned === null, 'skips proactive message during configured quiet hours');
  ok(quietHour.chatCalls === 0, 'quiet-hours skip does not call proactive subagent/provider');
  ok(quietHour.callbackCount === 0, 'quiet-hours skip does not trigger callback');
  ok(quietHour.drained.length === 0, 'quiet-hours skip does not enter message buffer');
  ok(!readTranscript('user-quiet').some((entry) => entry.content === '这个不应该生成。'), 'quiet-hours skip is not stored in contact transcript');
  ok(
    readRecentProactiveDecisionTrace().some((row) => (
      row.outcome === 'skipped'
      && row.phase === 'smart_gate'
      && row.reasonCode === 'quiet_hours'
      && row.userId === 'user-quiet'
      && row.reason.includes('quiet hours')
      && row.routeTags?.includes('proactive')
    )),
    'quiet-hours skip writes explicit proactive decision trace',
  );
} finally {
  globalThis.fetch = oldFetch;
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} proactive production path tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
process.exit(1);
