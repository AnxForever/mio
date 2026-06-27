#!/usr/bin/env node
/**
 * Mio — end-to-end smoke test
 *
 * Spawns the HTTP server on a free port, exercises every endpoint, and
 * exits 0 on success / 1 on failure. Uses fetch (Node 18+) and the built-in
 * `node:net` for port allocation. No external deps.
 *
 * Coverage:
 *   1. /health
 *   2. /status (initial state)
 *   3. /mod (switch to male, back to female)
 *   4. /chat (non-streaming)
 *   5. /chat/stream (SSE — checks for at least one token event)
 *   6. /v1 OpenAI-compatible chat bridge
 *   7. Crisis detection on /chat
 *   8. WebSocket /ws (hello + chat + switch_mod + ping/pong)
 *
 * MockProvider is the default when ANTHROPIC_API_KEY is missing — the tests
 * run offline without an API key.
 */

import { createServer } from 'node:http';
import { startServer, type RunningServer } from '../dist/server/index.js';

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

interface OneBotApiCall {
  path: string;
  body: Record<string, unknown>;
  authorization?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${status} ${name}${detail ? ` — ${detail}` : ''}`);
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

async function startFakeOneBotApi(): Promise<{
  url: string;
  calls: OneBotApiCall[];
  close: () => Promise<void>;
}> {
  const port = await getFreePort();
  const calls: OneBotApiCall[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
      } catch {
        body = {};
      }
      calls.push({
        path: req.url ?? '',
        body,
        authorization: req.headers.authorization,
      });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 123 } }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main(): Promise<void> {
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const wsBase = `ws://127.0.0.1:${port}/ws`;

  let server: RunningServer | undefined;
  try {
    server = await startServer({ port, host: '127.0.0.1' });

    // ─── 1. /health ───
    {
      const r = await fetch(`${base}/health`);
      const j = (await r.json()) as { ok: boolean; name: string };
      record('GET /health', r.status === 200 && j.ok === true && j.name === 'mio');
    }

    // ─── 2. /status ───
    {
      const r = await fetch(`${base}/status`);
      const j = (await r.json()) as { config: { name: string; activeMod: string }; emotion: { affection: number } };
      record('GET /status', r.status === 200 && j.config.name === 'Mio' && typeof j.emotion.affection === 'number');
    }

    // ─── 3. /mod (male → female) ───
    {
      const r1 = await fetch(`${base}/mod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'male' }),
      });
      const j1 = (await r1.json()) as { activeMod: string };
      record('POST /mod male', r1.status === 200 && j1.activeMod === 'male', `→ ${j1.activeMod}`);

      const r2 = await fetch(`${base}/mod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'female' }),
      });
      const j2 = (await r2.json()) as { activeMod: string };
      record('POST /mod female', r2.status === 200 && j2.activeMod === 'female', `→ ${j2.activeMod}`);

      // Bad name
      const r3 = await fetch(`${base}/mod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'alien' }),
      });
      record('POST /mod invalid → 400', r3.status === 400);
    }

    // ─── 4. /chat (non-streaming) ───
    {
      const r = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });
      const j = (await r.json()) as { text: string; sessionId: string; turns: number; crisisFlagged: boolean };
      record(
        'POST /chat',
        r.status === 200 && typeof j.text === 'string' && j.text.length > 0 && typeof j.sessionId === 'string',
        `sessionId=${j.sessionId} turns=${j.turns}`,
      );
    }

    // ─── 5. /chat/stream (SSE) ───
    {
      const r = await fetch(`${base}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'streaming test' }),
      });
      const ctype = r.headers.get('content-type') ?? '';
      const text = await r.text();
      const tokenEvents = text.split('\n\n').filter((b) => b.startsWith('event: token'));
      const hasDone = text.includes('event: done');
      record(
        'POST /chat/stream SSE',
        r.status === 200 && ctype.includes('text/event-stream') && tokenEvents.length > 0 && hasDone,
        `tokens=${tokenEvents.length} done=${hasDone}`,
      );
    }

    // ─── 5.5. OpenAI-compatible bridge ───
    {
      const r = await fetch(`${base}/v1/models`);
      const j = (await r.json()) as { object: string; data: Array<{ id: string }> };
      record(
        'GET /v1/models',
        r.status === 200 && j.object === 'list' && j.data.some((m) => m.id === 'mio'),
      );
    }
    {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mio-Session-Id': 'wechat-smoke-user',
        },
        body: JSON.stringify({
          model: 'mio',
          user: 'wechat-user-1',
          messages: [
            { role: 'system', content: 'gateway context that Mio should not need' },
            { role: 'user', content: 'openai bridge test' },
          ],
        }),
      });
      const j = (await r.json()) as {
        object: string;
        choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
      };
      const sessionHeader = r.headers.get('x-mio-session-id') ?? '';
      record(
        'POST /v1/chat/completions',
        r.status === 200 &&
          j.object === 'chat.completion' &&
          j.choices[0]?.message.role === 'assistant' &&
          j.choices[0]?.message.content.length > 0 &&
          j.choices[0]?.finish_reason === 'stop' &&
          sessionHeader.length > 0,
        `session=${sessionHeader}`,
      );
    }
    {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mio',
          stream: true,
          metadata: { sessionId: 'wechat-smoke-stream' },
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'openai stream bridge test' }],
            },
          ],
        }),
      });
      const ctype = r.headers.get('content-type') ?? '';
      const text = await r.text();
      const chunkEvents = text.split('\n\n').filter((b) => b.includes('"object":"chat.completion.chunk"'));
      const hasDone = text.includes('data: [DONE]');
      record(
        'POST /v1/chat/completions stream',
        r.status === 200 && ctype.includes('text/event-stream') && chunkEvents.length > 0 && hasDone,
        `chunks=${chunkEvents.length} done=${hasDone}`,
      );
    }

    // ─── 5.6. OneBot v11 bridge ───
    {
      const r = await fetch(`${base}/onebot/v11/status`);
      const j = (await r.json()) as {
        enabled: boolean;
        apiBaseConfigured: boolean;
        groupMode: string;
        replyMode: string;
      };
      record(
        'GET /onebot/v11/status',
        r.status === 200 && j.enabled === true && ['mention', 'all', 'off'].includes(j.groupMode),
        `apiBase=${j.apiBaseConfigured} mode=${j.replyMode}`,
      );
    }
    {
      const fakeOneBot = await startFakeOneBotApi();
      const previousApiBase = process.env.MIO_ONEBOT_API_BASE;
      const previousReplyMode = process.env.MIO_ONEBOT_REPLY_MODE;
      process.env.MIO_ONEBOT_API_BASE = fakeOneBot.url;
      delete process.env.MIO_ONEBOT_REPLY_MODE;
      try {
        const r = await fetch(`${base}/onebot/v11/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            post_type: 'message',
            message_type: 'private',
            user_id: 10001,
            self_id: 20002,
            message_id: 30003,
            raw_message: 'onebot private bridge test',
            message: 'onebot private bridge test',
          }),
        });
        const j = (await r.json()) as {
          ok: boolean;
          processed: boolean;
          replyMode: string;
          sent: boolean;
          sessionId: string;
        };
        const call = fakeOneBot.calls[0];
        record(
          'POST /onebot/v11/events private -> send_private_msg',
          r.status === 200 &&
            j.ok === true &&
            j.processed === true &&
            j.replyMode === 'api' &&
            j.sent === true &&
            j.sessionId.startsWith('onebot-private-') &&
            call?.path === '/send_private_msg' &&
            call.body.user_id === 10001 &&
            typeof call.body.message === 'string' &&
            call.body.message.length > 0,
          `session=${j.sessionId} calls=${fakeOneBot.calls.length}`,
        );
      } finally {
        if (previousApiBase === undefined) delete process.env.MIO_ONEBOT_API_BASE;
        else process.env.MIO_ONEBOT_API_BASE = previousApiBase;
        if (previousReplyMode === undefined) delete process.env.MIO_ONEBOT_REPLY_MODE;
        else process.env.MIO_ONEBOT_REPLY_MODE = previousReplyMode;
        await fakeOneBot.close();
      }
    }
    {
      const r = await fetch(`${base}/onebot/v11/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_type: 'message',
          message_type: 'group',
          user_id: 10001,
          group_id: 40004,
          self_id: 20002,
          raw_message: 'group message without mention',
          message: 'group message without mention',
        }),
      });
      const j = (await r.json()) as { ok: boolean; skipped: boolean; reason: string };
      record(
        'POST /onebot/v11/events group skips unmentioned messages',
        r.status === 200 && j.ok === true && j.skipped === true && j.reason === 'group_message_not_mentioned',
        `reason=${j.reason}`,
      );
    }

    // ─── 6. Crisis detection ───
    {
      const r = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '我今天撑不住了,想消失' }),
      });
      const j = (await r.json()) as { crisisFlagged: boolean };
      record(
        'Crisis detection (yellow keyword "撑不住")',
        r.status === 200 && j.crisisFlagged === true,
        `crisisFlagged=${j.crisisFlagged}`,
      );
    }
    {
      const r = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'I want to end my life' }),
      });
      const j = (await r.json()) as { crisisFlagged: boolean };
      record(
        'Crisis detection (red keyword "end my life")',
        r.status === 200 && j.crisisFlagged === true,
        `crisisFlagged=${j.crisisFlagged}`,
      );
    }

    // ─── 6.4. /voice/capabilities ───
    {
      const r = await fetch(`${base}/voice/capabilities`);
      const j = (await r.json()) as {
        recording: boolean; tts: boolean; stt: boolean; fullDuplex: boolean;
      };
      record(
        'GET /voice/capabilities',
        r.status === 200 && typeof j.recording === 'boolean' && typeof j.tts === 'boolean',
        `rec=${j.recording} tts=${j.tts} stt=${j.stt}`,
      );
    }

    // ─── 6.5. /avatar/state ───
    {
      // Verify the structure: we don't assert on a specific mood mapping
      // because MockProvider doesn't run the mutter tool to update state.
      // The unit tests cover the mapping in isolation.
      const r = await fetch(`${base}/avatar/state`);
      const j = (await r.json()) as {
        mood: string;
        energy: string;
        face: { eyes: string; mouth: string; brows: string };
        body: { posture: string; lean: number };
        voice: { tone: string; rate: number; pitch: number };
        affection: number;
        relationship: string;
        timestamp: string;
      };
      const structureOk =
        r.status === 200 &&
        typeof j.mood === 'string' &&
        typeof j.energy === 'string' &&
        ['open', 'half', 'closed', 'teary'].includes(j.face.eyes) &&
        ['neutral', 'smile', 'frown', 'open', 'pursed'].includes(j.face.mouth) &&
        ['relaxed', 'tense', 'leaning', 'still'].includes(j.body.posture) &&
        typeof j.body.lean === 'number' &&
        ['warm', 'flat', 'bright', 'gentle', 'firm'].includes(j.voice.tone) &&
        typeof j.affection === 'number' &&
        ['acquaintance', 'familiar', 'ambiguous', 'intimate'].includes(j.relationship);
      record(
        'GET /avatar/state',
        structureOk,
        `mood=${j.mood} face.mouth=${j.face.mouth} voice.tone=${j.voice.tone} affection=${j.affection}`,
      );
    }

    // ─── 6.6. Character route validation ───
    {
      const r = await fetch(`${base}/character/bad_name/life`);
      const j = (await r.json()) as { success?: boolean; error?: string };
      record(
        'GET /character/:name/life rejects invalid name',
        r.status === 400 && j.error === 'Invalid path parameters',
        `status=${r.status}`,
      );
    }

    // ─── 7. WebSocket /ws ───
    {
      const { WebSocket } = await import('ws');
      const ws = new WebSocket(wsBase);
      let invalidMessageRejected = false;

      const wsInvalidResult = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          try { ws.close(); } catch { /* ignore */ }
          resolve(false);
        }, 5000);

        ws.on('message', (raw: Buffer) => {
          const msg = JSON.parse(raw.toString()) as { type: string; error?: string };
          if (msg.type === 'hello') {
            ws.send(JSON.stringify({ type: 'chat', text: '' }));
          }
          if (msg.type === 'error' && msg.error === 'Invalid message') {
            invalidMessageRejected = true;
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', () => {
          clearTimeout(timeout);
          try { ws.close(); } catch { /* ignore */ }
          resolve(false);
        });
      });

      record(
        'WS /ws rejects invalid chat payload',
        wsInvalidResult && invalidMessageRejected,
        `invalidRejected=${invalidMessageRejected}`,
      );
    }

    {
      const { WebSocket } = await import('ws');
      const ws = new WebSocket(wsBase);
      let helloReceived = false;
      let tokenCount = 0;
      let doneReceived = false;
      let modSwitched = false;
      let pongReceived = false;
      let avatarStateReceived = false;
      let emotionChangedReceived = false;

      const wsResult = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);

        ws.on('message', (raw: Buffer) => {
          const msg = JSON.parse(raw.toString()) as { type: string; chunk?: string; activeMod?: string; state?: unknown };
          if (msg.type === 'hello') helloReceived = true;
          if (msg.type === 'token' && msg.chunk) tokenCount++;
          if (msg.type === 'done') doneReceived = true;
          if (msg.type === 'mod_switched') modSwitched = true;
          if (msg.type === 'pong') pongReceived = true;
          if (msg.type === 'avatar_state' && msg.state) avatarStateReceived = true;
          if (msg.type === 'emotion_changed' && msg.state) emotionChangedReceived = true;

          // After hello, subscribe to avatar updates
          if (helloReceived && !avatarStateReceived) {
            ws.send(JSON.stringify({ type: 'subscribe_avatar' }));
          }
          // After avatar_state, do a chat to trigger emotion_changed
          if (avatarStateReceived && !tokenCount) {
            ws.send(JSON.stringify({ type: 'chat', text: 'ws test' }));
          }
          // After emotion_changed, switch mod + ping
          if (emotionChangedReceived && !modSwitched) {
            ws.send(JSON.stringify({ type: 'switch_mod', name: 'female' }));
            setTimeout(() => ws.send(JSON.stringify({ type: 'ping' })), 100);
          }
          if (pongReceived) {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }
        });

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'chat', text: 'initial' }));
        });

        ws.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });

      record(
        'WS /ws hello + chat + avatar subscribe + emotion_changed + switch_mod + ping/pong',
        wsResult && helloReceived && tokenCount > 0 && doneReceived && modSwitched && pongReceived && avatarStateReceived && emotionChangedReceived,
        `hello=${helloReceived} tokens=${tokenCount} done=${doneReceived} avatar=${avatarStateReceived} emotion_changed=${emotionChangedReceived} modSwitched=${modSwitched} pong=${pongReceived}`,
      );
    }
  } finally {
    if (server) await server.close();
  }

  // ─── 8. OpenAI-compatible auth/client smoke ───
  {
    const authPort = await getFreePort();
    const authBase = `http://127.0.0.1:${authPort}`;
    const oldToken = process.env.MIO_AUTH_TOKEN;
    process.env.MIO_AUTH_TOKEN = 'openai-smoke-token';

    let authServer: RunningServer | undefined;
    try {
      authServer = await startServer({ port: authPort, host: '127.0.0.1' });

      const unauth = await fetch(`${authBase}/v1/models`);
      const unauthJson = (await unauth.json()) as { error?: { type?: string; code?: string } };
      record(
        'GET /v1/models requires OpenAI bearer auth',
        unauth.status === 401 &&
          unauthJson.error?.type === 'authentication_error' &&
          unauthJson.error?.code === 'missing_authorization',
        `status=${unauth.status}`,
      );

      const wrongAuth = await fetch(`${authBase}/v1/models`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      const wrongAuthJson = (await wrongAuth.json()) as { error?: { code?: string } };
      record(
        'GET /v1/models rejects invalid API key',
        wrongAuth.status === 401 && wrongAuthJson.error?.code === 'invalid_api_key',
        `status=${wrongAuth.status}`,
      );

      const models = await fetch(`${authBase}/v1/models`, {
        headers: { Authorization: 'Bearer openai-smoke-token' },
      });
      const modelsJson = (await models.json()) as { object: string; data: Array<{ id: string }> };
      record(
        'GET /v1/models accepts valid API key',
        models.status === 200 && modelsJson.object === 'list' && modelsJson.data.some((m) => m.id === 'mio'),
      );

      const badBody = await fetch(`${authBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer openai-smoke-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'mio', messages: [] }),
      });
      const badBodyJson = (await badBody.json()) as { error?: { type?: string; code?: string; message?: string } };
      record(
        'POST /v1/chat/completions returns OpenAI validation error',
        badBody.status === 400 &&
          badBodyJson.error?.type === 'invalid_request_error' &&
          badBodyJson.error?.code === 'invalid_request' &&
          typeof badBodyJson.error?.message === 'string',
        `status=${badBody.status}`,
      );

      const chat = await fetch(`${authBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer openai-smoke-token',
          'Content-Type': 'application/json',
          'X-OpenClaw-User-Id': 'wechat-openclaw-user',
        },
        body: JSON.stringify({
          model: 'mio',
          messages: [{ role: 'user', content: 'authenticated openai bridge test' }],
        }),
      });
      const chatJson = (await chat.json()) as {
        object: string;
        choices: Array<{ message: { content: string } }>;
      };
      const chatSession = chat.headers.get('x-mio-session-id') ?? '';
      record(
        'POST /v1/chat/completions preserves authenticated gateway session',
        chat.status === 200 &&
          chatJson.object === 'chat.completion' &&
          chatJson.choices[0]?.message.content.length > 0 &&
          chatSession.startsWith('openai-wechat-openclaw-user-'),
        `session=${chatSession}`,
      );

      const stream = await fetch(`${authBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer openai-smoke-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'mio',
          stream: true,
          metadata: { conversation: { id: 'wechat-room-1' } },
          messages: [{ role: 'user', content: 'authenticated stream bridge test' }],
        }),
      });
      const streamText = await stream.text();
      const streamSession = stream.headers.get('x-mio-session-id') ?? '';
      record(
        'POST /v1/chat/completions streams with authenticated metadata session',
        stream.status === 200 &&
          (stream.headers.get('content-type') ?? '').includes('text/event-stream') &&
          streamText.includes('"object":"chat.completion.chunk"') &&
          streamText.includes('data: [DONE]') &&
          streamSession.startsWith('openai-wechat-room-1-'),
        `session=${streamSession}`,
      );
    } finally {
      if (authServer) await authServer.close();
      if (oldToken === undefined) delete process.env.MIO_AUTH_TOKEN;
      else process.env.MIO_AUTH_TOKEN = oldToken;
    }
  }

  // ─── Summary ───
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} tests passed\x1b[0m`);
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
