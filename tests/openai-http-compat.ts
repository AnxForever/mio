#!/usr/bin/env node
/**
 * Mio — real HTTP compatibility tests for OpenAI-compatible clients.
 *
 * Starts the actual HTTP server and exercises browser/SDK/gateway behavior:
 * CORS preflight, bearer auth, OpenAI SDK-ish optional fields, SSE parsing,
 * OpenAI error envelopes, and concurrent session isolation.
 */

import { createServer } from 'node:http';
import { startServer, type RunningServer } from '../dist/server/index.js';

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

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (typeof addr === 'object' && addr) {
        const p = addr.port;
        s.close(() => resolve(p));
      } else {
        s.close(() => reject(new Error('could not get port')));
      }
    });
  });
}

function restoreEnv(old: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: 'Bearer compat-token',
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — OpenAI HTTP compatibility tests\x1b[0m\n');

  const oldEnv = {
    MIO_AUTH_TOKEN: process.env.MIO_AUTH_TOKEN,
    MIO_CORS_ORIGIN: process.env.MIO_CORS_ORIGIN,
    MIO_PROVIDER: process.env.MIO_PROVIDER,
    MINIMAX_DISABLE: process.env.MINIMAX_DISABLE,
  };
  process.env.MIO_AUTH_TOKEN = 'compat-token';
  process.env.MIO_CORS_ORIGIN = 'https://client.example,http://localhost:5173';
  process.env.MIO_PROVIDER = 'mock';
  process.env.MINIMAX_DISABLE = 'true';

  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  let server: RunningServer | undefined;

  try {
    server = await startServer({ port, host: '127.0.0.1' });

    await test('CORS preflight allows configured OpenAI client origin', async () => {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://client.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type,x-openai-session-id',
        },
      });
      assert(res.status === 204, `expected 204, got ${res.status}`);
      assert(res.headers.get('access-control-allow-origin') === 'https://client.example', 'origin not allowed');
      assert((res.headers.get('access-control-allow-headers') ?? '').toLowerCase().includes('authorization'), 'authorization header not allowed');
      assert((res.headers.get('access-control-expose-headers') ?? '').includes('X-Mio-Session-Id'), 'session header not exposed');
    });

    await test('auth errors use OpenAI authentication envelope', async () => {
      const missing = await fetch(`${base}/v1/models`);
      const missingBody = await missing.json() as { error?: { type?: string; code?: string } };
      assert(missing.status === 401, `expected 401, got ${missing.status}`);
      assert(missingBody.error?.type === 'authentication_error', 'missing auth error type');
      assert(missingBody.error?.code === 'missing_authorization', 'missing auth code');

      const invalid = await fetch(`${base}/v1/models`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      const invalidBody = await invalid.json() as { error?: { code?: string } };
      assert(invalid.status === 401, `expected 401, got ${invalid.status}`);
      assert(invalidBody.error?.code === 'invalid_api_key', 'missing invalid_api_key code');
    });

    await test('accepts common OpenAI SDK chat fields without breaking Mio turn', async () => {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: authHeaders({
          Origin: 'https://client.example',
          'X-OpenAI-Session-Id': 'sdk-user-1',
        }),
        body: JSON.stringify({
          model: 'mio',
          temperature: 0.7,
          top_p: 0.9,
          n: 1,
          max_tokens: 256,
          presence_penalty: 0,
          frequency_penalty: 0,
          stop: ['\n\nUser:'],
          response_format: { type: 'text' },
          tools: [
            {
              type: 'function',
              function: {
                name: 'noop',
                description: 'ignored client tool declaration',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          tool_choice: 'none',
          metadata: { conversation: { id: 'sdk-conversation' } },
          messages: [
            { role: 'system', content: 'External client context.' },
            { role: 'developer', content: 'Keep adapter behavior stable.' },
            { role: 'assistant', content: 'previous assistant text' },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'OpenAI SDK compatibility test' },
                { type: 'input_text', input_text: 'second text part' },
              ],
            },
          ],
          store: false,
          stream_options: { include_usage: true },
        }),
      });
      const body = await res.json() as {
        object?: string;
        choices?: Array<{ message?: { role?: string; content?: string }; finish_reason?: string }>;
        usage?: { total_tokens?: number };
      };

      assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
      assert(res.headers.get('access-control-allow-origin') === 'https://client.example', 'CORS response missing');
      assert((res.headers.get('x-mio-session-id') ?? '').startsWith('openai-sdk-user-1-'), 'wrong session header');
      assert(body.object === 'chat.completion', `wrong object: ${String(body.object)}`);
      assert(body.choices?.[0]?.message?.role === 'assistant', 'missing assistant message');
      assert((body.choices?.[0]?.message?.content ?? '').length > 0, 'empty assistant content');
      assert(body.choices?.[0]?.finish_reason === 'stop', 'wrong finish reason');
      assert((body.usage?.total_tokens ?? 0) > 0, 'missing usage estimate');
    });

    await test('streams parseable OpenAI SSE chunks and DONE marker', async () => {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          model: 'mio',
          stream: true,
          stream_options: { include_usage: true },
          metadata: { thread: { id: 'stream-thread-1' } },
          messages: [{ role: 'user', content: 'stream compatibility test' }],
        }),
      });
      const text = await res.text();
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert((res.headers.get('content-type') ?? '').includes('text/event-stream'), 'not SSE');
      assert((res.headers.get('x-mio-session-id') ?? '').startsWith('openai-stream-thread-1-'), 'wrong stream session');

      const dataLines = text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length));
      assert(dataLines.at(-1) === '[DONE]', 'missing DONE marker');

      const chunks = dataLines.slice(0, -1).map((line) => JSON.parse(line) as {
        object?: string;
        choices?: Array<{ delta?: { role?: string; content?: string }; finish_reason?: string | null }>;
      });
      assert(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
      assert(chunks[0].object === 'chat.completion.chunk', 'wrong first chunk object');
      assert(chunks[0].choices?.[0]?.delta?.role === 'assistant', 'missing assistant role delta');
      assert(chunks.some((chunk) => (chunk.choices?.[0]?.delta?.content ?? '').length > 0), 'missing content chunk');
      assert(chunks.at(-1)?.choices?.[0]?.finish_reason === 'stop', 'missing stop chunk');
    });

    await test('invalid request errors use OpenAI invalid_request envelope', async () => {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          model: 'mio',
          messages: [{ role: 'assistant', content: 'no user message' }],
        }),
      });
      const body = await res.json() as { error?: { message?: string; type?: string; code?: string } };
      assert(res.status === 400, `expected 400, got ${res.status}`);
      assert(body.error?.type === 'invalid_request_error', 'wrong error type');
      assert(body.error?.code === 'invalid_request', 'wrong error code');
      assert((body.error?.message ?? '').includes('No non-empty user text'), 'wrong error message');
    });

    await test('concurrent gateway sessions remain isolated and stable', async () => {
      const [a, b] = await Promise.all([
        fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: authHeaders({ 'X-OpenClaw-User-Id': 'concurrent-a' }),
          body: JSON.stringify({ model: 'mio', messages: [{ role: 'user', content: 'hello from A' }] }),
        }),
        fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: authHeaders({ 'X-OpenClaw-User-Id': 'concurrent-b' }),
          body: JSON.stringify({ model: 'mio', messages: [{ role: 'user', content: 'hello from B' }] }),
        }),
      ]);

      const sessionA = a.headers.get('x-mio-session-id') ?? '';
      const sessionB = b.headers.get('x-mio-session-id') ?? '';
      assert(a.status === 200 && b.status === 200, `unexpected statuses: ${a.status}/${b.status}`);
      assert(sessionA.startsWith('openai-concurrent-a-'), `bad session A: ${sessionA}`);
      assert(sessionB.startsWith('openai-concurrent-b-'), `bad session B: ${sessionB}`);
      assert(sessionA !== sessionB, 'sessions should differ');

      const again = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: authHeaders({ 'X-OpenClaw-User-Id': 'concurrent-a' }),
        body: JSON.stringify({ model: 'mio', messages: [{ role: 'user', content: 'same A again' }] }),
      });
      assert((again.headers.get('x-mio-session-id') ?? '') === sessionA, 'same gateway id should map to same Mio session');
    });
  } finally {
    if (server) await server.close();
    restoreEnv(oldEnv);
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} OpenAI HTTP compatibility tests passed\x1b[0m`);
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
