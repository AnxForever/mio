/**
 * Mio — Playwright E2E Tests
 *
 * Tests the Mio HTTP/WebSocket API and frontend through Playwright.
 *
 * Prerequisites:
 *   - `npm run build` must have completed (server is started from dist/).
 *   - Server is started by `playwright.global-setup.ts` on a free port.
 *   - The URL is available at `process.env.MIO_TEST_BASE_URL`.
 *
 * Coverage (15 tests):
 *   1. Server health — GET /health returns ok
 *   2. Status page — GET /status returns config + emotion + provider info
 *   3. Chat flow — POST /chat with "hello" → response has text + sessionId
 *   4. SSE streaming — POST /chat/stream → SSE events with token + done
 *   5. OpenAI-compatible models — GET /v1/models
 *   6. OpenAI-compatible chat — POST /v1/chat/completions
 *   7. OpenAI-compatible streaming — POST /v1/chat/completions stream
 *   8. OpenAI-compatible validation — bad body returns OpenAI error envelope
 *   9. Mod switching — POST /mod male → activeMod changes
 *   10. Crisis detection — POST /chat with crisis message → crisisFlagged: true
 *   11. WebSocket — connect to /ws → hello → chat → done events
 *   12. Avatar state — GET /avatar/state → valid structure
 *   13. Web frontend loads — GET / → serves index.html (or 404 gracefully)
 *   14. Session continuity — send 2 messages with same sessionId → both recorded
 *   15. Rate limiter — returns 429 after exceeding limit
 */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import express from 'express';
import WebSocket from 'ws';
import { createRateLimiter } from '../../dist/server/rate-limit.js';

const BASE_URL = () => process.env.MIO_TEST_BASE_URL ?? 'http://127.0.0.1:0';
const WS_URL = () => process.env.MIO_TEST_WS_URL ?? 'ws://127.0.0.1:0/ws';

// ─── Helpers ───

interface ChatResponse {
  text: string;
  sessionId: string;
  toolCallCount: number;
  turns: number;
  crisisFlagged: boolean;
}

interface WsMessage {
  type: string;
  [key: string]: unknown;
}

interface ProbeServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startRateLimitProbe(): Promise<ProbeServer> {
  const app = express();
  app.use(createRateLimiter({ max: 3, windowMs: 5_000 }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/chat', (_req, res) => res.json({ ok: true }));

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('rate-limit probe did not expose a port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

/**
 * Wait for a WebSocket message matching a predicate.
 */
function waitForWsMessage(
  ws: WebSocket,
  predicate: (msg: WsMessage) => boolean,
  timeoutMs: number = 10_000,
): Promise<WsMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout waiting for WS message'));
    }, timeoutMs);

    const handler = (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsMessage;
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
    ws.on('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket error'));
    });
  });
}

/**
 * Send a message over an open WebSocket.
 */
function sendWsMessage(ws: WebSocket, msg: Record<string, unknown>): void {
  ws.send(JSON.stringify(msg));
}

// ─── Test 1: Server health ───

test('GET /health returns ok', async ({ request }) => {
  const res = await request.get(`${BASE_URL()}/health`);
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(body).toHaveProperty('name', 'mio');
  expect(body).toHaveProperty('version');
});

// ─── Test 2: Status page ───

test('GET /status returns config + emotion + provider info', async ({ request }) => {
  const res = await request.get(`${BASE_URL()}/status`);
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body).toHaveProperty('config');
  expect(body.config).toHaveProperty('gender');
  expect(body.config).toHaveProperty('name', 'Mio');
  expect(body.config).toHaveProperty('activeMod');

  expect(body).toHaveProperty('emotion');
  expect(body.emotion).toHaveProperty('myMood');
  expect(body.emotion).toHaveProperty('affection');
  expect(typeof body.emotion.affection).toBe('number');

  expect(body).toHaveProperty('provider');
  expect(body.provider).toHaveProperty('preset');
  expect(body.provider).toHaveProperty('model');

  expect(body).toHaveProperty('relationship');
  expect(body.relationship).toHaveProperty('stage');

  expect(body).toHaveProperty('embedding');
  expect(body.embedding).toHaveProperty('provider');
  expect(body.embedding).toHaveProperty('indexEntries');
});

test('Admin workspace config can be read and updated', async ({ request }) => {
  const initial = await request.get(`${BASE_URL()}/admin/workspace-config`);
  expect(initial.status()).toBe(200);
  const initialBody = await initial.json();
  const original = initialBody.config;
  expect(original).toHaveProperty('skills');
  expect(Array.isArray(original.skills)).toBe(true);

  const e2eSkill = {
    id: 'e2e-config-skill',
    name: 'E2E config skill',
    description: 'Temporary config row used by Playwright.',
    source: 'external',
    enabled: true,
    status: 'planned',
  };
  const patchedSkills = [
    ...original.skills.filter((skill: { id?: string }) => skill.id !== e2eSkill.id),
    e2eSkill,
  ];

  try {
    const saved = await request.put(`${BASE_URL()}/admin/workspace-config`, {
      headers: { 'Content-Type': 'application/json' },
      data: { skills: patchedSkills },
    });
    expect(saved.status()).toBe(200);
    const savedBody = await saved.json();
    expect(savedBody).toHaveProperty('ok', true);
    expect(savedBody.config.skills.some((skill: { id?: string }) => skill.id === e2eSkill.id)).toBe(true);

    const reread = await request.get(`${BASE_URL()}/admin/workspace-config`);
    const rereadBody = await reread.json();
    expect(rereadBody.config.skills.some((skill: { id?: string }) => skill.id === e2eSkill.id)).toBe(true);
  } finally {
    await request.put(`${BASE_URL()}/admin/workspace-config`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        persona: original.persona,
        roles: original.roles,
        skills: original.skills,
        plugins: original.plugins,
        mcp: original.mcp,
      },
    });
  }
});

// ─── Test 3: Chat flow ───

test('POST /chat with "hello" returns response with text + sessionId', async ({ request }) => {
  const res = await request.post(`${BASE_URL()}/chat`, {
    data: { text: 'hello' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);

  const body = (await res.json()) as ChatResponse;
  expect(body).toHaveProperty('text');
  expect(typeof body.text).toBe('string');
  expect(body.text.length).toBeGreaterThan(0);
  expect(body).toHaveProperty('sessionId');
  expect(typeof body.sessionId).toBe('string');
  expect(body.sessionId.length).toBeGreaterThan(0);
  expect(body).toHaveProperty('crisisFlagged');
  expect(body.crisisFlagged).toBe(false);
});

// ─── Test 4: SSE streaming ───

test('POST /chat/stream returns SSE events with token + done', async ({ request }) => {
  const res = await request.post(`${BASE_URL()}/chat/stream`, {
    data: { text: 'streaming test' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);

  const contentType = res.headers()['content-type'] ?? '';
  expect(contentType).toContain('text/event-stream');

  const text = await res.text();
  const blocks = text.split('\n\n').filter((b) => b.trim().length > 0);

  const tokenEvents = blocks.filter((b) => b.startsWith('event: token'));
  const doneEvents = blocks.filter((b) => b.startsWith('event: done'));

  expect(tokenEvents.length).toBeGreaterThan(0);
  expect(doneEvents.length).toBe(1);

  // Verify done event has valid JSON
  const doneLine = doneEvents[0]!;
  const dataMatch = doneLine.match(/^data: (.+)$/m);
  expect(dataMatch).not.toBeNull();
  const donePayload = JSON.parse(dataMatch![1]!);
  expect(donePayload).toHaveProperty('text');
  expect(donePayload).toHaveProperty('sessionId');
});

// ─── Test 5: OpenAI-compatible model list ───

test('GET /v1/models returns OpenAI-compatible model list', async ({ request }) => {
  const res = await request.get(`${BASE_URL()}/v1/models`);
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body).toHaveProperty('object', 'list');
  expect(Array.isArray(body.data)).toBe(true);
  expect(body.data.some((model: { id?: string }) => model.id === 'mio')).toBe(true);
});

// ─── Test 6: OpenAI-compatible non-streaming chat ───

test('POST /v1/chat/completions returns OpenAI-compatible completion', async ({ request }) => {
  const res = await request.post(`${BASE_URL()}/v1/chat/completions`, {
    headers: {
      'Content-Type': 'application/json',
      'X-OpenClaw-User-Id': 'e2e-openclaw-user',
    },
    data: {
      model: 'mio',
      messages: [
        { role: 'system', content: 'gateway context' },
        { role: 'user', content: 'openai compatible e2e test' },
      ],
    },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()['x-mio-session-id']).toMatch(/^openai-e2e-openclaw-user-/);

  const body = await res.json();
  expect(body).toHaveProperty('object', 'chat.completion');
  expect(body).toHaveProperty('model', 'mio');
  expect(body.choices[0]).toHaveProperty('index', 0);
  expect(body.choices[0]).toHaveProperty('finish_reason', 'stop');
  expect(body.choices[0].message).toHaveProperty('role', 'assistant');
  expect(body.choices[0].message.content.length).toBeGreaterThan(0);
  expect(body.usage.total_tokens).toBeGreaterThan(0);
});

// ─── Test 7: OpenAI-compatible streaming chat ───

test('POST /v1/chat/completions streams OpenAI-compatible chunks', async ({ request }) => {
  const res = await request.post(`${BASE_URL()}/v1/chat/completions`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      model: 'mio',
      stream: true,
      metadata: { conversation: { id: 'e2e-room-1' } },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'openai stream e2e test' }] },
      ],
    },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/event-stream');
  expect(res.headers()['x-mio-session-id']).toMatch(/^openai-e2e-room-1-/);

  const text = await res.text();
  const chunks = text.split('\n\n').filter((block) => block.includes('"object":"chat.completion.chunk"'));
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks[0]).toContain('"role":"assistant"');
  expect(text).toContain('data: [DONE]');
});

// ─── Test 8: OpenAI-compatible validation ───

test('POST /v1/chat/completions returns OpenAI error envelope for invalid body', async ({ request }) => {
  const res = await request.post(`${BASE_URL()}/v1/chat/completions`, {
    headers: { 'Content-Type': 'application/json' },
    data: { model: 'mio', messages: [] },
  });
  expect(res.status()).toBe(400);

  const body = await res.json();
  expect(body.error).toHaveProperty('type', 'invalid_request_error');
  expect(body.error).toHaveProperty('code', 'invalid_request');
  expect(typeof body.error.message).toBe('string');
});

// ─── Test 9: Mod switching ───

test('POST /mod switches active persona', async ({ request }) => {
  // Switch to male
  const res1 = await request.post(`${BASE_URL()}/mod`, {
    data: { name: 'male' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res1.status()).toBe(200);
  const body1 = await res1.json();
  expect(body1).toHaveProperty('activeMod', 'male');

  // Verify via status
  const status1 = await request.get(`${BASE_URL()}/status`);
  const s1 = await status1.json();
  expect(s1.config.activeMod).toBe('male');

  // Switch back to female
  const res2 = await request.post(`${BASE_URL()}/mod`, {
    data: { name: 'female' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res2.status()).toBe(200);
  const body2 = await res2.json();
  expect(body2).toHaveProperty('activeMod', 'female');

  // Invalid name
  const res3 = await request.post(`${BASE_URL()}/mod`, {
    data: { name: 'alien' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res3.status()).toBe(400);
});

// ─── Test 10: Crisis detection ───

test('POST /chat with crisis message flags crisis', async ({ request }) => {
  // Yellow crisis: "撑不住"
  const res1 = await request.post(`${BASE_URL()}/chat`, {
    data: { text: '我今天撑不住了,真的很难受' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res1.status()).toBe(200);
  const body1 = (await res1.json()) as ChatResponse;
  expect(body1.crisisFlagged).toBe(true);

  // Red crisis: "死"
  const res2 = await request.post(`${BASE_URL()}/chat`, {
    data: { text: 'I want to end my life' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res2.status()).toBe(200);
  const body2 = (await res2.json()) as ChatResponse;
  expect(body2.crisisFlagged).toBe(true);

  // Normal message: no crisis
  const res3 = await request.post(`${BASE_URL()}/chat`, {
    data: { text: '今天天气真好' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res3.status()).toBe(200);
  const body3 = (await res3.json()) as ChatResponse;
  expect(body3.crisisFlagged).toBe(false);
});

// ─── Test 11: WebSocket ───

test('WebSocket /ws hello + chat + done events', async () => {
  const ws = new WebSocket(WS_URL());

  try {
    // Wait for hello
    const hello = await waitForWsMessage(ws, (msg) => msg.type === 'hello');
    expect(hello).toHaveProperty('protocol', 'mio.ws/1');
    expect(hello).toHaveProperty('sessionId');

    // Send a chat message
    sendWsMessage(ws, { type: 'chat', text: 'hello from ws' });

    // Wait for token events (at least one)
    const token = await waitForWsMessage(ws, (msg) => msg.type === 'token');
    expect(token).toHaveProperty('chunk');
    expect(typeof token.chunk).toBe('string');

    // Wait for done
    const done = await waitForWsMessage(ws, (msg) => msg.type === 'done');
    expect(done).toHaveProperty('text');
    expect(done).toHaveProperty('sessionId');
    expect(typeof done.text).toBe('string');
    expect(done.text.length).toBeGreaterThan(0);

    // Test switch_mod via WS
    sendWsMessage(ws, { type: 'switch_mod', name: 'female' });
    const modSwitched = await waitForWsMessage(ws, (msg) => msg.type === 'mod_switched');
    expect(modSwitched).toHaveProperty('activeMod', 'female');

    // Test ping/pong
    sendWsMessage(ws, { type: 'ping', t: Date.now() });
    const pong = await waitForWsMessage(ws, (msg) => msg.type === 'pong');
    expect(pong).toHaveProperty('t');
    expect(typeof (pong as { t: number }).t).toBe('number');
  } finally {
    ws.close();
  }
});

// ─── Test 12: Avatar state ───

test('GET /avatar/state returns valid structure', async ({ request }) => {
  const res = await request.get(`${BASE_URL()}/avatar/state`);
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body).toHaveProperty('mood');
  expect(typeof body.mood).toBe('string');
  expect(body).toHaveProperty('energy');
  expect(['low', 'mid', 'high']).toContain(body.energy);

  expect(body).toHaveProperty('face');
  expect(['open', 'half', 'closed', 'teary']).toContain(body.face.eyes);
  expect(['neutral', 'smile', 'frown', 'open', 'pursed']).toContain(body.face.mouth);
  expect(['neutral', 'raised', 'furrowed', 'soft']).toContain(body.face.brows);

  expect(body).toHaveProperty('body');
  expect(['relaxed', 'tense', 'leaning', 'still']).toContain(body.body.posture);
  expect(typeof body.body.lean).toBe('number');

  expect(body).toHaveProperty('voice');
  expect(['warm', 'flat', 'bright', 'gentle', 'firm']).toContain(body.voice.tone);
  expect(typeof body.voice.rate).toBe('number');
  expect(typeof body.voice.pitch).toBe('number');

  expect(body).toHaveProperty('affection');
  expect(typeof body.affection).toBe('number');
  expect(body).toHaveProperty('relationship');
  expect(['acquaintance', 'familiar', 'ambiguous', 'intimate']).toContain(body.relationship);
  expect(body).toHaveProperty('timestamp');
  expect(typeof body.timestamp).toBe('string');
});

// ─── Test 13: Web frontend ───

test('GET / serves something (index.html or 404)', async ({ request }) => {
  const res = await request.get(`${BASE_URL()}/`);
  // The server has no static file handler yet (src/server/ and src/core/ are
  // placeholders), so we expect either a 404 JSON response or, if static
  // serving is wired in, the actual index.html. Both are valid outcomes — we
  // just check that the response is well-formed.
  const status = res.status();
  expect([200, 404]).toContain(status);

  if (status === 404) {
    const body = await res.json();
    expect(body).toHaveProperty('error', 'Not found');
  } else {
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    // If it's HTML, it should have basic structure
    if (text.trimStart().startsWith('<')) {
      expect(text).toContain('html');
    }
  }
});

// ─── Test 14: Session continuity ───

test('Session continuity — two messages with same sessionId', async ({ request }) => {
  // First message
  const res1 = await request.post(`${BASE_URL()}/chat`, {
    data: { text: 'first message in session' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res1.status()).toBe(200);
  const body1 = (await res1.json()) as ChatResponse;
  const sessionId = body1.sessionId;
  expect(typeof sessionId).toBe('string');
  expect(sessionId.length).toBeGreaterThan(0);

  // Second message with same sessionId
  const res2 = await request.post(`${BASE_URL()}/chat`, {
    data: { text: 'second message, same session', sessionId },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res2.status()).toBe(200);
  const body2 = (await res2.json()) as ChatResponse;
  expect(body2.sessionId).toBe(sessionId);

  // Third message, also same session
  const res3 = await request.post(`${BASE_URL()}/chat`, {
    data: { text: 'third message', sessionId },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res3.status()).toBe(200);
  const body3 = (await res3.json()) as ChatResponse;
  expect(body3.sessionId).toBe(sessionId);

  // All three should have valid text responses
  expect(body1.text.length).toBeGreaterThan(0);
  expect(body2.text.length).toBeGreaterThan(0);
  expect(body3.text.length).toBeGreaterThan(0);
});

// ─── Test 15: Rate limiting returns 429 (bonus) ───

test('Rate limiter returns 429 after exceeding limit', async ({ request }) => {
  const probe = await startRateLimitProbe();
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await request.post(`${probe.baseUrl}/chat`);
      statuses.push(res.status());
    }

    expect(statuses).toEqual([200, 200, 200, 429]);

    // Health endpoint should never be rate-limited.
    const healthRes = await request.get(`${probe.baseUrl}/health`);
    expect(healthRes.status()).toBe(200);
  } finally {
    await probe.close();
  }
});
