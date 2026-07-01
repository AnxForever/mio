#!/usr/bin/env node
/**
 * Mio — feature wiring regression tests.
 *
 * Covers features that can silently become "configured but not connected":
 * model-router feature flag, OpenAI bridge channel context, audio chat input,
 * and role-filtered transcript search.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    record(name, false, err instanceof Error ? err.message : String(err));
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'mio-wiring-'));
process.env.MIO_DIR = dataDir;
process.env.MIO_PROVIDER = 'mock';
delete process.env.MIO_MODEL_ROUTER_ENABLED;
delete process.env.MIO_FEATURE_MODEL_ROUTER;

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — wiring tests\x1b[0m\n');

  const { getConfig, updateConfig } = await import('../dist/config.js');
  const { isRouterEnabled } = await import('../dist/providers/router.js');
  const { resolveOpenAIChannelContext } = await import('../dist/server/openai-compat.js');
  const { chatBody } = await import('../dist/validation.js');
  const { appendTranscript } = await import('../dist/memory/transcript.js');
  const { searchHandler } = await import('../dist/server/search.js');
  const { generatePersona } = await import('../packages/idrag/dist/generator.js');

  await test('model router follows config.features.modelRouter', () => {
    const config = getConfig();
    updateConfig({ features: { ...config.features, modelRouter: true } });
    assert(isRouterEnabled() === true, 'router should be enabled by config feature flag');

    updateConfig({ features: { ...getConfig().features, modelRouter: false } });
    assert(isRouterEnabled() === false, 'router should be disabled when feature flag is false');
  });

  await test('legacy MIO_MODEL_ROUTER_ENABLED overrides config flag', () => {
    updateConfig({ features: { ...getConfig().features, modelRouter: true } });
    process.env.MIO_MODEL_ROUTER_ENABLED = 'false';
    try {
      assert(isRouterEnabled() === false, 'legacy env false should override config true');
    } finally {
      delete process.env.MIO_MODEL_ROUTER_ENABLED;
    }
  });

  await test('OpenAI bridge resolves group channel context from metadata', () => {
    const channel = resolveOpenAIChannelContext({
      model: 'mio',
      messages: [{ role: 'user', content: 'hello' }],
      metadata: {
        message_type: 'group',
        group_id: 'room-42',
        sender_id: 'user-7',
        has_at: false,
        has_mention: true,
      },
    }, { headers: {} });

    assert(channel?.type === 'group', `unexpected type: ${channel?.type}`);
    assert(channel.groupId === 'room-42', `unexpected group id: ${channel.groupId}`);
    assert(channel.userId === 'user-7', `unexpected user id: ${channel.userId}`);
    assert(channel.hasMention === true, 'hasMention should be preserved');
  });

  await test('chat validation accepts audioPath without text', () => {
    assert(chatBody.safeParse({ audioPath: '/tmp/audio.wav' }).success, 'audio-only chat should be valid');
    assert(!chatBody.safeParse({}).success, 'empty chat body should be invalid');
  });

  await test('search role filter returns only matching transcript role', async () => {
    const sessionId = 'role-filter-session';
    appendTranscript(sessionId, {
      type: 'message',
      role: 'user',
      content: 'shared needle from user',
      timestamp: '2026-06-01T10:00:00.000Z',
    });
    appendTranscript(sessionId, {
      type: 'message',
      role: 'assistant',
      content: 'shared needle from assistant',
      timestamp: '2026-06-01T10:01:00.000Z',
    });

    const assistant = await searchHandler('shared needle', { sessionId, role: 'assistant', maxResults: 10 });
    assert(assistant.results.length === 1, `assistant results=${assistant.results.length}`);
    assert(assistant.results[0].role === 'assistant', `unexpected role: ${assistant.results[0].role}`);
    assert(assistant.results[0].content.includes('assistant'), 'assistant content missing');

    const user = await searchHandler('shared needle', { sessionId, role: 'user', maxResults: 10 });
    assert(user.results.length === 1, `user results=${user.results.length}`);
    assert(user.results[0].role === 'user', `unexpected role: ${user.results[0].role}`);
    assert(user.results[0].content.includes('user'), 'user content missing');
  });

  await test('@mio/idrag generator honors male/female package gender type', () => {
    const male = generatePersona({ name: 'Akira', gender: 'male', style: '温柔', traits: ['可靠'] });
    const female = generatePersona({ name: 'Mika', gender: 'female', style: '温柔', traits: ['温柔'] });

    assert(!male.soul.includes('undefined岁') && !male.soul.includes('undefined。'), 'male defaults should not be undefined');
    assert(!female.soul.includes('undefined岁') && !female.soul.includes('undefined。'), 'female defaults should not be undefined');
    assert(male.soul.includes('26岁，自由职业'), 'male defaults should use male age and occupation');
    assert(female.soul.includes('24岁，自由插画师'), 'female defaults should use female age and occupation');
    assert(male.soul.includes('你是她的男朋友'), 'male persona should address the user with female-side pronoun');
    assert(female.soul.includes('你是他的女朋友'), 'female persona should address the user with male-side pronoun');
    assert(male.soul.includes('你叫他"宝贝"'), 'male warm voice should use male branch wording');
    assert(female.soul.includes('你叫他"亲爱的"'), 'female warm voice should use female branch wording');
  });

  const passed = results.filter((r) => r.passed).length;
  console.log('');
  rmSync(dataDir, { recursive: true, force: true });
  if (passed === results.length) {
    console.log(`\x1b[32m✔ all ${results.length} wiring tests passed\x1b[0m`);
    process.exit(0);
  }
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}

main().catch((err) => {
  console.error('wiring runner crashed:', err);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
});
