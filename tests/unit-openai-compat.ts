#!/usr/bin/env node
/**
 * Mio — OpenAI-compatible bridge unit tests.
 *
 * Focuses on deterministic adapter behavior that third-party IM gateways rely
 * on: session identity mapping, text extraction, and bearer auth decisions.
 */

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

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — OpenAI bridge unit tests\x1b[0m\n');

  const {
    extractOpenAIUserText,
    resolveOpenAISessionId,
    resolveOpenAISessionInfo,
    buildOpenAIErrorResponse,
  } = await import('../dist/server/openai-compat.js');
  const { checkBearerAuth } = await import('../dist/server/auth.js');

  await test('extracts the last non-empty user message', () => {
    const text = extractOpenAIUserText({
      model: 'mio',
      messages: [
        { role: 'user', content: '旧消息' },
        { role: 'assistant', content: '上一轮回复' },
        { role: 'user', content: [{ type: 'text', text: '新消息' }] },
      ],
    });
    assert(text === '新消息', `unexpected text: ${text}`);
  });

  await test('rejects requests without non-empty user text', () => {
    let threw = false;
    try {
      extractOpenAIUserText({
        model: 'mio',
        messages: [
          { role: 'system', content: 'context only' },
          { role: 'assistant', content: 'hello' },
        ],
      });
    } catch {
      threw = true;
    }
    assert(threw, 'expected missing user text to throw');
  });

  await test('session id prefers gateway headers over body fields', () => {
    const req = { headers: { 'x-wechat-user-id': 'wx-user-42' } };
    const sessionId = resolveOpenAISessionId({
      model: 'mio',
      user: 'body-user',
      metadata: { sessionId: 'metadata-user' },
      messages: [{ role: 'user', content: 'hi' }],
    }, req);
    assert(sessionId.startsWith('openai-wx-user-42-'), `unexpected session id: ${sessionId}`);
    assert(sessionId.length <= 64, `session id too long: ${sessionId.length}`);
  });

  await test('session id supports nested metadata ids', () => {
    const req = { headers: {} };
    const sessionId = resolveOpenAISessionId({
      model: 'mio',
      metadata: { conversation: { id: 'group/room:123' } },
      messages: [{ role: 'user', content: 'hi' }],
    }, req);
    assert(sessionId.startsWith('openai-group_room_123-'), `unexpected session id: ${sessionId}`);
  });

  await test('session info preserves raw WeClaw contact id for outbound binding', () => {
    const req = { headers: { 'x-openclaw-user-id': 'wx.user-42@im.wechat' } };
    const info = resolveOpenAISessionInfo({
      model: 'mio',
      messages: [{ role: 'user', content: 'hi' }],
    }, req);
    assert(info.sessionId.startsWith('openai-wx_user-42_im_wechat-'), `unexpected session id: ${info.sessionId}`);
    assert(info.rawSessionId === 'wx.user-42@im.wechat', `unexpected raw id: ${info.rawSessionId}`);
  });

  await test('session info keeps raw WeClaw id when Mio session header has precedence', () => {
    const req = {
      headers: {
        'x-mio-session-id': 'stable-internal-thread',
        'x-openclaw-user-id': 'wx.raw-42@im.wechat',
      },
    };
    const info = resolveOpenAISessionInfo({
      model: 'mio',
      messages: [{ role: 'user', content: 'hi' }],
    }, req);
    assert(info.sessionId.startsWith('openai-stable-internal-thread-'), `unexpected session id: ${info.sessionId}`);
    assert(info.rawSessionId === 'wx.raw-42@im.wechat', `unexpected raw id: ${info.rawSessionId}`);
  });

  await test('session info keeps nested metadata WeClaw id when Mio session header has precedence', () => {
    const req = {
      headers: {
        'x-mio-session-id': 'stable-internal-thread',
      },
    };
    const info = resolveOpenAISessionInfo({
      model: 'mio',
      metadata: { conversation: { id: 'wx.meta-42@im.wechat' } },
      messages: [{ role: 'user', content: 'hi' }],
    }, req);
    assert(info.sessionId.startsWith('openai-stable-internal-thread-'), `unexpected session id: ${info.sessionId}`);
    assert(info.rawSessionId === 'wx.meta-42@im.wechat', `unexpected raw id: ${info.rawSessionId}`);
  });

  await test('session id falls back to body user', () => {
    const req = { headers: {} };
    const sessionId = resolveOpenAISessionId({
      model: 'mio',
      user: 'openai-user',
      messages: [{ role: 'user', content: 'hi' }],
    }, req);
    assert(sessionId.startsWith('openai-openai-user-'), `unexpected session id: ${sessionId}`);
  });

  await test('strict bridge mode rejects requests without a stable session id', () => {
    const old = process.env.MIO_OPENAI_REQUIRE_SESSION;
    process.env.MIO_OPENAI_REQUIRE_SESSION = 'true';
    try {
      let message = '';
      try {
        resolveOpenAISessionId({
          model: 'mio',
          messages: [{ role: 'user', content: 'hi' }],
        }, { headers: {} });
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      assert(message.includes('Missing stable session id'), `unexpected error: ${message}`);
    } finally {
      if (old === undefined) delete process.env.MIO_OPENAI_REQUIRE_SESSION;
      else process.env.MIO_OPENAI_REQUIRE_SESSION = old;
    }
  });

  await test('OpenAI error response uses standard error envelope', () => {
    const payload = buildOpenAIErrorResponse('bad request', 'invalid_request_error', 'invalid_request') as {
      error?: { message?: string; type?: string; code?: string };
    };
    assert(payload.error?.message === 'bad request', 'missing message');
    assert(payload.error?.type === 'invalid_request_error', 'missing type');
    assert(payload.error?.code === 'invalid_request', 'missing code');
  });

  await test('bearer auth is disabled when no token is configured', () => {
    const old = process.env.MIO_AUTH_TOKEN;
    delete process.env.MIO_AUTH_TOKEN;
    try {
      assert(checkBearerAuth(undefined) === null, 'auth should pass when token is absent');
    } finally {
      if (old !== undefined) process.env.MIO_AUTH_TOKEN = old;
    }
  });

  await test('bearer auth reports missing and invalid keys', () => {
    const old = process.env.MIO_AUTH_TOKEN;
    process.env.MIO_AUTH_TOKEN = 'secret';
    try {
      assert(checkBearerAuth(undefined)?.code === 'missing_authorization', 'missing header code');
      assert(checkBearerAuth('Token secret')?.code === 'invalid_authorization_format', 'bad format code');
      assert(checkBearerAuth('Bearer wrong')?.code === 'invalid_api_key', 'bad key code');
      assert(checkBearerAuth('Bearer secret') === null, 'valid key should pass');
    } finally {
      if (old === undefined) delete process.env.MIO_AUTH_TOKEN;
      else process.env.MIO_AUTH_TOKEN = old;
    }
  });

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} OpenAI bridge tests passed\x1b[0m`);
    process.exit(0);
  } else {
    console.log(`\x1b[31m✘ ${total - passed}/${total} failed\x1b[0m`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  process.exit(2);
});
