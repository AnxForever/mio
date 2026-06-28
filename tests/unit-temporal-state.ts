#!/usr/bin/env node
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIProvider, Message, ToolDef } from '../src/types.js';

const dir = mkdtempSync(join(tmpdir(), 'mio-temporal-state-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
process.env.MINIMAX_DISABLE = 'true';

const memoryBank = join(dir, 'memory-bank');
mkdirSync(join(memoryBank, 'cola-self-reference'), { recursive: true });
writeFileSync(join(memoryBank, 'BOOKMARKS.md'), '# Bookmarks\n\n', 'utf-8');
writeFileSync(join(memoryBank, 'cola-self-reference', 'user-profile.md'), '', 'utf-8');

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

class CaptureProvider implements AIProvider {
  name = 'temporal-state-capture';
  systemPrompt = '';
  messages: Message[] = [];
  tools: ToolDef[] = [];

  async chat(messages: Message[], systemPrompt: string, tools?: ToolDef[]): Promise<{ text: string }> {
    this.messages = messages;
    this.systemPrompt = systemPrompt;
    this.tools = tools ?? [];
    return { text: '在呢。' };
  }
}

console.log('\n\x1b[1mMio — temporal state tests\x1b[0m\n');

const temporal = await import('../dist/memory/temporal-state.js');
const { runTurn } = await import('../dist/core/agent-loop.js');
const { appendTranscript } = await import('../dist/memory/transcript.js');

const sessionId = 'openai-temporal-user_im_wechat-abc123';
const sleepyAt = new Date('2026-06-27T16:11:10.000Z');
const nextDay = new Date('2026-06-28T09:16:00.000Z');

const sleepyCtx = temporal.updateTemporalStateForTurn(sessionId, '有点困了，想睡觉', sleepyAt);
ok(sleepyCtx.active.some((entry) => entry.kind === 'sleepy' || entry.kind === 'going_to_sleep'), 'sleepy/sleep intent becomes active short-term state');

const expiredCtx = temporal.updateTemporalStateForTurn(sessionId, '在干嘛', nextDay);
ok(!expiredCtx.active.some((entry) => entry.kind === 'sleepy' || entry.kind === 'going_to_sleep'), 'sleep state expires by next afternoon');
ok(expiredCtx.expiredRecent.some((entry) => entry.kind === 'sleepy' || entry.kind === 'going_to_sleep'), 'expired sleep state remains as historical context');

const rendered = temporal.renderTemporalAwarenessContext(expiredCtx);
ok(rendered.includes('时间感'), 'renders temporal awareness section');
ok(rendered.includes('已过期'), 'rendered context marks stale states as expired');
ok(rendered.includes('不能说“你不是还困'), 'rendered context forbids treating expired state as current');
ok(rendered.includes('预设式追问'), 'rendered context forbids presuppositional follow-up questions without active state');

const busyCtx = temporal.updateTemporalStateForTurn('openai-busy-user_im_wechat-def456', '我先忙去了，等会儿再聊', new Date('2026-06-28T10:00:00.000Z'));
ok(busyCtx.active.some((entry) => entry.kind === 'busy' || entry.kind === 'away'), 'busy/away text becomes active state');

const promisedSpaceSessionId = 'openai-promised-space_im_wechat-space1';
const promised = temporal.observeAssistantTemporalCommitments(
  promisedSpaceSessionId,
  '那我先不打扰你，你慢慢弄。',
  new Date('2026-06-28T10:05:00.000Z'),
);
ok(promised.some((entry) => entry.kind === 'mio_promised_space'), 'assistant no-interrupt promise becomes temporal state');
const promisedState = temporal.readTemporalState(promisedSpaceSessionId);
ok(promisedState.events.some((event) => event.type === 'assistant_commitment' && event.kind === 'mio_promised_space'), 'assistant promise writes structured event');
const reopenedCtx = temporal.updateTemporalStateForTurn(promisedSpaceSessionId, '嗯嗯，好', new Date('2026-06-28T10:10:00.000Z'));
ok(!reopenedCtx.active.some((entry) => entry.kind === 'mio_promised_space'), 'user reply resolves Mio no-interrupt promise');
ok(reopenedCtx.resolvedRecent.some((entry) => entry.kind === 'mio_promised_space' && entry.resolutionReason === 'user_reopened_chat'), 'resolved promise records user_reopened_chat reason');
const reopenedState = temporal.readTemporalState(promisedSpaceSessionId);
ok(reopenedState.events.some((event) => event.type === 'resolved' && event.reason === 'user_reopened_chat'), 'reopened chat writes structured resolution event');
const reopenedRendered = temporal.renderTemporalAwarenessContext(reopenedCtx);
ok(reopenedRendered.includes('用户已经主动重新打开聊天'), 'rendered context explains reopened-chat state');
ok(reopenedRendered.includes('不要抱怨'), 'rendered context forbids blame after no-interrupt promise');

const promiseBootstrapSessionId = 'openai-promised-space-bootstrap_im_wechat-space2';
appendTranscript(promiseBootstrapSessionId, {
  type: 'message',
  timestamp: '2026-06-28T10:05:00.000Z',
  role: 'assistant',
  content: '那我先不打扰你，你慢慢弄。',
});
const promiseBootstrappedCtx = temporal.updateTemporalStateForTurn(
  promiseBootstrapSessionId,
  '嗯嗯，好',
  new Date('2026-06-28T10:10:00.000Z'),
);
ok(promiseBootstrappedCtx.resolvedRecent.some((entry) => entry.kind === 'mio_promised_space' && entry.resolutionReason === 'user_reopened_chat'), 'bootstrap replay resolves assistant no-interrupt promise from transcript');

const resolvedSleepSessionId = 'openai-temporal-resolved-sleep_im_wechat-resolve1';
temporal.updateTemporalStateForTurn(resolvedSleepSessionId, '好困，先睡了', new Date('2026-06-28T00:00:00.000Z'));
const resolvedSleepCtx = temporal.updateTemporalStateForTurn(resolvedSleepSessionId, '我睡醒了，现在不困', new Date('2026-06-28T08:00:00.000Z'));
ok(!resolvedSleepCtx.active.some((entry) => entry.kind === 'sleepy' || entry.kind === 'going_to_sleep'), 'explicit wake/not sleepy text resolves active sleep state');
ok(resolvedSleepCtx.expiredRecent.some((entry) => entry.kind === 'sleepy' || entry.kind === 'going_to_sleep'), 'resolved sleep state remains only as expired history');

const resolvedBusySessionId = 'openai-temporal-resolved-busy_im_wechat-resolve2';
temporal.updateTemporalStateForTurn(resolvedBusySessionId, '我还在忙着优化你', new Date('2026-06-28T10:00:00.000Z'));
const resolvedBusyCtx = temporal.updateTemporalStateForTurn(resolvedBusySessionId, '忙完了，来聊', new Date('2026-06-28T10:30:00.000Z'));
ok(!resolvedBusyCtx.active.some((entry) => entry.kind === 'busy' || entry.kind === 'away'), 'explicit done text resolves active busy/away state');

const bootstrapSessionId = 'openai-temporal-bootstrap_im_wechat-bootstrap1';
appendTranscript(bootstrapSessionId, {
  type: 'message',
  timestamp: '2026-06-28T00:00:00.000Z',
  role: 'user',
  content: '好困，先睡了',
});
const bootstrappedCtx = temporal.updateTemporalStateForTurn(bootstrapSessionId, '在干嘛', new Date('2026-06-28T08:30:00.000Z'));
ok(bootstrappedCtx.active.some((entry) => entry.kind === 'going_to_sleep'), 'temporal state bootstraps active state from recent transcript');

appendTranscript(bootstrapSessionId, {
  type: 'message',
  timestamp: '2026-06-28T09:00:00.000Z',
  role: 'user',
  content: '睡醒了，不困了',
});
const bootstrappedResolvedCtx = temporal.updateTemporalStateForTurn(bootstrapSessionId, '现在呢', new Date('2026-06-28T09:05:00.000Z'));
ok(!bootstrappedResolvedCtx.active.some((entry) => entry.kind === 'sleepy' || entry.kind === 'going_to_sleep'), 'bootstrap replay respects later resolution messages');

const promptSessionId = 'openai-temporal-prompt_im_wechat-xyz789';
appendTranscript(promptSessionId, {
  type: 'message',
  timestamp: '2026-06-27T16:11:10.000Z',
  role: 'user',
  content: '有点困了',
});
appendTranscript(promptSessionId, {
  type: 'message',
  timestamp: '2026-06-27T16:11:14.000Z',
  role: 'assistant',
  content: '那早点睡',
});
temporal.updateTemporalStateForTurn(promptSessionId, '有点困了', new Date('2026-06-27T16:11:10.000Z'));
const provider = new CaptureProvider();
await runTurn({ text: '在干嘛', sessionId: promptSessionId }, { provider });
const promptContext = [
  provider.systemPrompt,
  ...provider.messages.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)),
].join('\n\n');
ok(promptContext.includes('## 时间感'), 'runTurn prompt includes temporal awareness context');
ok(promptContext.includes('最近已过期') || promptContext.includes('当前仍有效'), 'runTurn prompt includes temporal state status');

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} temporal state tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
for (const result of results.filter((r) => !r.ok)) {
  console.log(`  - ${result.msg}${result.detail ? `: ${result.detail}` : ''}`);
}
process.exit(1);
