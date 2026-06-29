#!/usr/bin/env node
/**
 * Mio — external IM session isolation tests.
 *
 * OpenAI/WeClaw and OneBot sessions represent distinct IM contacts. Their
 * normal chat turns must not read or write the shared single-user memory bank.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIProvider, Message, ToolDef } from '../src/types.js';

const dir = mkdtempSync(join(tmpdir(), 'mio-im-isolation-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';

const memoryBank = join(dir, 'memory-bank');
mkdirSync(join(memoryBank, 'cola-self-reference'), { recursive: true });
writeFileSync(
  join(memoryBank, 'BOOKMARKS.md'),
  '# Bookmarks\n\n- <time=2026-06-27T00:00:00.000Z> GLOBAL SECRET MEMORY. evidence\n',
  'utf-8',
);
writeFileSync(
  join(memoryBank, 'cola-self-reference', 'user-profile.md'),
  'GLOBAL USER SECRET PROFILE',
  'utf-8',
);
writeFileSync(
  join(dir, 'emotion-state.json'),
  JSON.stringify({
    myMood: 'OWNER_SECRET_MOOD',
    userMood: 'OWNER_SECRET_USER_MOOD',
    affection: 99,
    energy: 'low',
    lastInteraction: '2026-06-27T00:00:00.000Z',
    unresolvedThread: null,
    recentTopics: ['OWNER_SECRET_TOPIC'],
  }, null, 2),
  'utf-8',
);

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
  name = 'im-isolation-capture';
  systemPrompt = '';
  messages: Message[] = [];
  tools: ToolDef[] = [];

  async chat(messages: Message[], systemPrompt: string, tools?: ToolDef[]): Promise<{ text: string }> {
    this.messages = messages;
    this.systemPrompt = systemPrompt;
    this.tools = tools ?? [];
    return { text: '收到，我在。' };
  }
}

class ForbiddenToolProvider implements AIProvider {
  name = 'im-isolation-forbidden-tool';
  calls = 0;
  firstTools: ToolDef[] = [];
  messages: Message[] = [];

  async chat(messages: Message[], _systemPrompt: string, tools?: ToolDef[]) {
    this.calls++;
    this.messages = messages;
    if (this.calls === 1) {
      this.firstTools = tools ?? [];
      return {
        text: '',
        toolCalls: [
          {
            id: 'leak-read',
            name: 'read',
            input: { path: join(memoryBank, 'BOOKMARKS.md') },
          },
        ],
      };
    }
    return { text: '我只根据你这条消息回你。' };
  }
}

console.log('\n\x1b[1mMio — IM session isolation tests\x1b[0m\n');

const { runTurn, isIsolatedMemorySession } = await import('../dist/core/agent-loop.js');
const { readBookmarks } = await import('../dist/memory/bank.js');
const { appendTranscript, readTranscript } = await import('../dist/memory/transcript.js');

const sessionId = 'openai-wx-user-42_im_wechat-abc123';
const beforeBookmarks = readBookmarks();
const provider = new CaptureProvider();
const result = await runTurn(
  { text: '普通微信消息', sessionId },
  { provider },
);
const afterBookmarks = readBookmarks();
const modelContext = [
  provider.systemPrompt,
  ...provider.messages.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)),
].join('\n\n');

ok(isIsolatedMemorySession(sessionId), 'OpenAI bridge session is isolated');
ok(isIsolatedMemorySession('onebot-private-10001-deadbeef'), 'OneBot private session is isolated');
ok(isIsolatedMemorySession('wechat-native-bot_1-user_1'), 'native WeChat session is isolated');
ok(!isIsolatedMemorySession('local-web-session'), 'local web session is not forced into IM isolation');
ok(modelContext.includes('IM 联系人隔离'), 'isolated prompt includes privacy constraint');
ok(modelContext.includes('不要自造等待'), 'isolated prompt prevents fabricated waiting/ignored arcs');
ok(!modelContext.includes('GLOBAL SECRET MEMORY'), 'isolated prompt omits global bookmarks');
ok(!modelContext.includes('GLOBAL USER SECRET PROFILE'), 'isolated prompt omits global user profile');
ok(!modelContext.includes('OWNER_SECRET_MOOD'), 'isolated prompt omits global emotion mood');
ok(!modelContext.includes('OWNER_SECRET_TOPIC'), 'isolated prompt omits global emotion topics');
ok(
  !provider.messages.some((message) => String(message.content).includes('GLOBAL SECRET MEMORY')),
  'isolated conversation messages omit global bookmarks',
);
ok(afterBookmarks === beforeBookmarks, 'isolated normal turn does not append global bookmarks');
ok(result.sessionId === sessionId, 'isolated turn keeps the contact session id');
ok(
  readTranscript(sessionId).some((entry) => entry.type === 'message' && entry.role === 'user' && entry.content === '普通微信消息'),
  'isolated turn records the user message in the contact transcript',
);
ok(
  readTranscript(sessionId).some((entry) => entry.type === 'message' && entry.role === 'assistant' && entry.content === '收到，我在。'),
  'isolated turn records the assistant message in the contact transcript',
);

const forbiddenProvider = new ForbiddenToolProvider();
const leakProbeSessionId = 'openai-wx-user-43_im_wechat-def456';
const leakProbe = await runTurn(
  { text: '帮我回忆一下你全局记忆里有什么', sessionId: leakProbeSessionId },
  { provider: forbiddenProvider },
);
const exposedTools = forbiddenProvider.firstTools.map((tool) => tool.name).sort();
const leakProbeContext = forbiddenProvider.messages
  .map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
  .join('\n\n');

ok(exposedTools.join(',') === 'current_time', 'isolated sessions expose only current_time tool');
ok(!exposedTools.includes('read'), 'isolated sessions do not expose file read tool');
ok(!exposedTools.includes('recall_memories'), 'isolated sessions do not expose global memory recall tool');
ok(!exposedTools.includes('session_read'), 'isolated sessions do not expose transcript read tool');
ok(leakProbe.toolCallCount === 1, 'forbidden tool call was attempted during leak probe');
ok(leakProbeContext.includes('not available in isolated IM contact sessions'), 'forbidden hidden tool call is denied at execution');
ok(!leakProbeContext.includes('GLOBAL SECRET MEMORY'), 'forbidden hidden tool call does not leak global memory content');

const timedSessionId = 'openai-wx-time-user_im_wechat-abcdef';
appendTranscript(timedSessionId, {
  type: 'message',
  timestamp: '2026-06-27T16:11:10.000Z',
  role: 'user',
  content: '有点困了',
});
appendTranscript(timedSessionId, {
  type: 'message',
  timestamp: '2026-06-27T16:11:14.000Z',
  role: 'assistant',
  content: '那早点睡',
});
const timedProvider = new CaptureProvider();
await runTurn(
  { text: '在干嘛', sessionId: timedSessionId },
  { provider: timedProvider },
);
const timedContext = [
  timedProvider.systemPrompt,
  ...timedProvider.messages.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)),
].join('\n\n');
ok(timedContext.includes('IM 时间边界'), 'isolated prompt includes timestamped IM timeline');
ok(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} 对方: 有点困了/.test(timedContext), 'timeline preserves old message timestamp');
ok(timedContext.includes('本轮刚收到 对方: 在干嘛'), 'timeline marks only current message as newly received');

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} IM session isolation tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
for (const result of results.filter((r) => !r.ok)) {
  console.log(`  - ${result.msg}${result.detail ? `: ${result.detail}` : ''}`);
}
process.exit(1);
