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
 * Coverage (10 tests):
 *   1. Server health — GET /health returns ok
 *   2. Status page — GET /status returns config + emotion + provider info
 *   3. Chat flow — POST /chat with "hello" → response has text + sessionId
 *   4. SSE streaming — POST /chat/stream → SSE events with token + done
 *   5. Mod switching — POST /mod boyfriend → activeMod changes
 *   6. Crisis detection — POST /chat with crisis message → crisisFlagged: true
 *   7. WebSocket — connect to /ws → hello → chat → done events
 *   8. Avatar state — GET /avatar/state → valid structure
 *   9. Web frontend loads — GET / → serves index.html (or 404 gracefully)
 *   10. Session continuity — send 2 messages with same sessionId → both recorded
 */

import { test, expect } from '@playwright/test';
import WebSocket from 'ws';

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

// ─── Test 5: Mod switching ───

test('POST /mod switches active persona', async ({ request }) => {
  // Switch to boyfriend
  const res1 = await request.post(`${BASE_URL()}/mod`, {
    data: { name: 'boyfriend' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res1.status()).toBe(200);
  const body1 = await res1.json();
  expect(body1).toHaveProperty('activeMod', 'boyfriend');

  // Verify via status
  const status1 = await request.get(`${BASE_URL()}/status`);
  const s1 = await status1.json();
  expect(s1.config.activeMod).toBe('boyfriend');

  // Switch back to girlfriend
  const res2 = await request.post(`${BASE_URL()}/mod`, {
    data: { name: 'girlfriend' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res2.status()).toBe(200);
  const body2 = await res2.json();
  expect(body2).toHaveProperty('activeMod', 'girlfriend');

  // Invalid name
  const res3 = await request.post(`${BASE_URL()}/mod`, {
    data: { name: 'alien' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res3.status()).toBe(400);
});

// ─── Test 6: Crisis detection ───

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

// ─── Test 7: WebSocket ───

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
    sendWsMessage(ws, { type: 'switch_mod', name: 'girlfriend' });
    const modSwitched = await waitForWsMessage(ws, (msg) => msg.type === 'mod_switched');
    expect(modSwitched).toHaveProperty('activeMod', 'girlfriend');

    // Test ping/pong
    sendWsMessage(ws, { type: 'ping', t: Date.now() });
    const pong = await waitForWsMessage(ws, (msg) => msg.type === 'pong');
    expect(pong).toHaveProperty('t');
    expect(typeof (pong as { t: number }).t).toBe('number');
  } finally {
    ws.close();
  }
});

// ─── Test 8: Avatar state ───

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

// ─── Test 9: Web frontend ───

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

// ─── Test 10: Session continuity ───

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

// ─── Test 11: Rate limiting returns 429 (bonus) ───

test('Rate limiter returns 429 after exceeding limit', async ({ request }) => {
  // The rate limiter is configured with default max=30 per window.
  // We'll blast 35 requests from a single IP and expect at least one 429.
  const promises: Promise<{ status: number }>[] = [];
  for (let i = 0; i < 35; i++) {
    promises.push(
      request
        .post(`${BASE_URL()}/chat`, {
          data: { text: `rate limit test ${i}` },
          headers: { 'Content-Type': 'application/json' },
        })
        .then((r) => ({ status: r.status() })),
    );
  }
  const results = await Promise.all(promises);
  const rateLimited = results.filter((r) => r.status === 429);
  expect(rateLimited.length).toBeGreaterThan(0);

  // Health endpoint should never be rate-limited
  const healthRes = await request.get(`${BASE_URL()}/health`);
  expect(healthRes.status()).toBe(200);
});
