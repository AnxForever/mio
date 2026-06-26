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
 *   3. /mod (switch to boyfriend, back to girlfriend)
 *   4. /chat (non-streaming)
 *   5. /chat/stream (SSE — checks for at least one token event)
 *   6. Crisis detection on /chat
 *   7. WebSocket /ws (hello + chat + switch_mod + ping/pong)
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

    // ─── 3. /mod (boyfriend → girlfriend) ───
    {
      const r1 = await fetch(`${base}/mod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'boyfriend' }),
      });
      const j1 = (await r1.json()) as { activeMod: string };
      record('POST /mod boyfriend', r1.status === 200 && j1.activeMod === 'boyfriend', `→ ${j1.activeMod}`);

      const r2 = await fetch(`${base}/mod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'girlfriend' }),
      });
      const j2 = (await r2.json()) as { activeMod: string };
      record('POST /mod girlfriend', r2.status === 200 && j2.activeMod === 'girlfriend', `→ ${j2.activeMod}`);

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

    // ─── 7. WebSocket /ws ───
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
            ws.send(JSON.stringify({ type: 'switch_mod', name: 'girlfriend' }));
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
