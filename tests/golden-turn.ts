#!/usr/bin/env node
/**
 * Golden regression for one complete agent turn.
 *
 * This locks down the observable side effects of runTurn with MockProvider:
 * response shape, transcript writes, bookmark append, and Active Context.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIProvider, Message, SessionContext, ToolCall } from '../src/types.js';

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(name, false, msg);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'mio-golden-'));
process.env.MIO_DIR = dataDir;
process.env.MIO_PROVIDER = 'mock';

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — golden turn regression\x1b[0m\n');

  const { runTurn } = await import('../dist/core/agent-loop.js');
  const { MockProvider } = await import('../dist/providers/mock.js');
  const { readTranscript } = await import('../dist/memory/transcript.js');
  const { readBookmarks, readMemoryIndex } = await import('../dist/memory/bank.js');
  const { writeRelationshipState, defaultRelationshipState } = await import('../dist/relationship/progression.js');
  const { writeEmotionState, defaultEmotionState } = await import('../dist/emotion/state.js');
  const { writeAffinityState, defaultAffinityState } = await import('../dist/emotion/affinity.js');
  const { resetGhostState, markReplied } = await import('../dist/emotion/ghost.js');
  const { getConfig, updateConfig } = await import('../dist/config.js');

  const inputText = 'hello regression';
  const result = await runTurn(
    { text: inputText },
    { provider: new MockProvider(0) },
  );

  await test('turn: returns stable mock response shape', () => {
    assert(result.sessionId.length === 12, `sessionId length ${result.sessionId.length}`);
    assert(result.text.startsWith('[mock reply to: hello regression]'), 'mock reply prefix');
    assert(result.turns === 1, `turns=${result.turns}`);
    assert(result.toolCallCount === 0, `toolCallCount=${result.toolCallCount}`);
    assert(result.crisisFlagged === false, 'not crisis');
    assert(result.ghosted === false, 'not ghosted');
  });

  await test('turn: records user, assistant, and session_end transcript entries', () => {
    const transcript = readTranscript(result.sessionId);
    assert(transcript.some((e) => e.type === 'message' && e.role === 'user' && e.content === inputText), 'user message recorded');
    assert(transcript.some((e) => e.type === 'message' && e.role === 'assistant' && e.content?.startsWith('[mock reply')), 'assistant message recorded');
    assert(transcript.some((e) => e.type === 'session_end'), 'session_end recorded');
  });

  await test('turn: appends bookmark and updates Active Context', () => {
    const bookmarks = readBookmarks();
    const memoryIndex = readMemoryIndex();
    assert(bookmarks.includes('exchange: user said "hello regression"'), 'bookmark contains exchange');
    assert(memoryIndex.includes('hello regression'), 'active context contains input');
  });

  await test('turn: creates data directory structure', () => {
    assert(existsSync(join(dataDir, 'memory-bank', 'MEMORY.md')), 'MEMORY.md exists');
    assert(existsSync(join(dataDir, 'transcripts', `${result.sessionId}.jsonl`)), 'transcript file exists');
  });

  const followup = await runTurn(
    { text: 'second regression', sessionId: result.sessionId },
    { provider: new MockProvider(0) },
  );

  await test('turn: continues an existing session without session_end', () => {
    assert(followup.sessionId === result.sessionId, 'session id reused');
    assert(followup.text.startsWith('[mock reply to: second regression]'), 'followup mock reply prefix');
    const transcript = readTranscript(result.sessionId);
    const sessionEndCount = transcript.filter((e) => e.type === 'session_end').length;
    assert(sessionEndCount === 1, `session_end count ${sessionEndCount}`);
    assert(transcript.some((e) => e.type === 'message' && e.role === 'user' && e.content === 'second regression'), 'followup user recorded');
  });

  const crisis = await runTurn(
    { text: 'I want to end my life' },
    { provider: new MockProvider(0) },
  );

  await test('turn: crisis input is flagged and bookmarked', () => {
    assert(crisis.crisisFlagged === true, 'crisis flagged');
    assert(crisis.text.startsWith('[mock reply to: I want to end my life]'), 'crisis still receives reply');
    const bookmarks = readBookmarks();
    assert(bookmarks.includes('[crisis:red] user expressed distress'), 'crisis bookmark written');
    assert(bookmarks.includes('end my life'), 'matched keyword recorded');
  });

  writeRelationshipState({
    ...defaultRelationshipState(),
    interactionCount: 15,
    stage: 'familiar',
  });
  writeEmotionState({
    ...defaultEmotionState(),
    lastInteraction: new Date(Date.now() - 60_000).toISOString(),
  });
  writeAffinityState({
    ...defaultAffinityState(),
    warmth: 40,
    patience: 80,
    tension: 10,
  });
  resetGhostState();
  markReplied();

  const ghost = await runTurn(
    { text: '嗯' },
    { provider: new MockProvider(0) },
  );

  await test('turn: ghost path records silence without inference', () => {
    assert(ghost.ghosted === true, 'ghosted');
    assert(ghost.text === '', 'empty ghost text');
    assert(ghost.turns === 0, `turns=${ghost.turns}`);
    assert(ghost.toolCallCount === 0, `toolCallCount=${ghost.toolCallCount}`);
    assert(ghost.crisisFlagged === false, 'not crisis');

    const transcript = readTranscript(ghost.sessionId);
    assert(transcript.some((e) => e.type === 'message' && e.role === 'user' && e.content === '嗯'), 'ghost user recorded');
    assert(transcript.some((e) => e.type === 'message' && e.role === 'assistant' && e.content === ''), 'empty assistant recorded');
    assert(transcript.filter((e) => e.type === 'session_end').length === 1, 'ghost session_end recorded once');

    const bookmarks = readBookmarks();
    assert(bookmarks.includes('[ghost] chose silence'), 'ghost bookmark written');
  });

  class ToolLoopProvider implements AIProvider {
    name = 'tool-loop-test';
    calls = 0;

    async chat(messages: Message[]): Promise<{ text: string; toolCalls?: ToolCall[] }> {
      this.calls++;
      if (this.calls === 1) {
        return {
          text: 'checking',
          toolCalls: [{ id: 'call_1', name: 'echo_tool', input: { value: 'needle' } }],
        };
      }

      const last = messages[messages.length - 1];
      return { text: `final:${typeof last.content === 'string' ? last.content : ''}` };
    }
  }

  const toolProvider = new ToolLoopProvider();
  const executedCalls: string[] = [];
  const tool = await runTurn(
    { text: 'use a tool' },
    {
      provider: toolProvider,
      registry: {
        listDefs: () => [{
          name: 'echo_tool',
          description: 'Echo test tool',
          inputSchema: { type: 'object' },
        }],
        execute: async (call: { id: string; name: string; input: Record<string, unknown> }, _ctx: SessionContext) => {
          executedCalls.push(`${call.id}:${call.name}:${String(call.input.value)}`);
          return {
            id: call.id,
            name: call.name,
            output: `echo:${String(call.input.value)}`,
          };
        },
      },
    },
  );

  await test('turn: executes tool loop and returns final provider reply', () => {
    assert(toolProvider.calls === 2, `provider calls ${toolProvider.calls}`);
    assert(executedCalls.length === 1, `tool calls ${executedCalls.length}`);
    assert(executedCalls[0] === 'call_1:echo_tool:needle', `executed ${executedCalls[0]}`);
    assert(tool.turns === 2, `turns=${tool.turns}`);
    assert(tool.toolCallCount === 1, `toolCallCount=${tool.toolCallCount}`);
    assert(tool.text.includes('tool echo_tool:\necho:needle'), 'final reply saw tool result');
  });

  class SystemPromptCaptureProvider implements AIProvider {
    name = 'system-prompt-capture';
    systemPrompt = '';

    async chat(_messages: Message[], systemPrompt: string): Promise<{ text: string }> {
      this.systemPrompt = systemPrompt;
      return { text: 'captured' };
    }
  }

  const previousConfig = getConfig();
  const promptCapture = new SystemPromptCaptureProvider();
  writeRelationshipState(defaultRelationshipState());
  writeEmotionState(defaultEmotionState());
  writeAffinityState(defaultAffinityState());
  resetGhostState();
  markReplied();
  updateConfig({
    features: {
      ...previousConfig.features,
      ghost: false,
      postHistoryInjection: true,
    },
  });

  try {
    await runTurn(
      { text: 'I want to end my life' },
      { provider: promptCapture },
    );
  } finally {
    updateConfig({ features: previousConfig.features });
  }

  await test('turn: post-history mode preserves crisis safety override', () => {
    assert(
      promptCapture.systemPrompt.includes('## Safety override'),
      `safety override missing; prompt tail=${JSON.stringify(promptCapture.systemPrompt.slice(-180))}`,
    );
    assert(promptCapture.systemPrompt.includes('self-harm') || promptCapture.systemPrompt.includes('suicidal'), 'crisis guidance missing');
  });

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} golden turn tests passed\x1b[0m`);
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  } else {
    console.log(`\x1b[31m✘ ${total - passed}/${total} failed\x1b[0m`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('golden turn runner crashed:', err);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
});
