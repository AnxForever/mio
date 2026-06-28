#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ONEBOT_TOKEN = 'mio_qq_verify_onebot_token';
const MIO_TOKEN = 'mio_qq_verify_auth_token';

function log(message) {
  process.stdout.write(`${message}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not allocate a local port')));
      }
    });
  });
}

async function startFakeOneBotApi() {
  const port = await getFreePort();
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        body = {};
      }
      calls.push({
        method: req.method,
        path: req.url ?? '',
        authorization: req.headers.authorization,
        body,
      });

      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/get_status') {
        res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { online: true, good: true } }));
        return;
      }
      res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 9001 } }));
    });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const json = await response.json();
  return { response, json };
}

async function main() {
  const fakeOneBot = await startFakeOneBotApi();
  const mioPort = await getFreePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'mio-qq-verify-'));
  let mioServer;

  process.env.MIO_PROVIDER = 'mock';
  process.env.MIO_AUTH_TOKEN = MIO_TOKEN;
  process.env.MIO_ONEBOT_API_BASE = fakeOneBot.url;
  process.env.MIO_ONEBOT_ACCESS_TOKEN = ONEBOT_TOKEN;
  process.env.MIO_ONEBOT_REPLY_MODE = 'api';
  process.env.MIO_ONEBOT_GROUP_MODE = 'off';
  process.env.MIO_ONEBOT_OUTBOUND_FORMAT = 'array';
  process.env.MIO_DIR = dataDir;

  try {
    const { startServer } = await import('../../dist/server/index.js');
    mioServer = await startServer({ port: mioPort, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${mioPort}`;
    const auth = { Authorization: `Bearer ${MIO_TOKEN}` };

    const health = await requestJson(`${base}/health`, { headers: auth });
    assert(health.response.status === 200 && health.json.ok === true, 'Mio /health failed');
    log('ok   Mio /health');

    const status = await requestJson(`${base}/onebot/v11/status`, { headers: auth });
    assert(status.response.status === 200, 'Mio /onebot/v11/status failed');
    assert(status.json.replyMode === 'api', `Unexpected replyMode: ${status.json.replyMode}`);
    assert(status.json.groupMode === 'off', `Unexpected groupMode: ${status.json.groupMode}`);
    assert(status.json.outboundFormat === 'array', `Unexpected outboundFormat: ${status.json.outboundFormat}`);
    assert(status.json.apiBaseConfigured === true, 'OneBot API base not configured');
    assert(status.json.accessTokenConfigured === true, 'OneBot access token not configured');
    log('ok   Mio /onebot/v11/status');

    const onebotStatus = await requestJson(`${fakeOneBot.url}/get_status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ONEBOT_TOKEN}`,
      },
      body: '{}',
    });
    assert(onebotStatus.response.status === 200 && onebotStatus.json.retcode === 0, 'Fake OneBot /get_status failed');
    log('ok   OneBot /get_status');

    const event = await requestJson(`${base}/onebot/v11/events`, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        user_id: 10001,
        self_id: 20002,
        message_id: 30003,
        message: [{ type: 'text', data: { text: 'QQ verify private message' } }],
      }),
    });
    assert(event.response.status === 200, `OneBot event returned ${event.response.status}`);
    assert(event.json.ok === true && event.json.sent === true, 'OneBot event did not send a reply');
    const privateCall = fakeOneBot.calls.find((call) => call.path === '/send_private_msg');
    assert(privateCall, 'Mio did not call send_private_msg');
    assert(privateCall.authorization === `Bearer ${ONEBOT_TOKEN}`, 'Outbound OneBot token mismatch');
    assert(privateCall.body.user_id === 10001, 'send_private_msg user_id mismatch');
    assert(Array.isArray(privateCall.body.message), 'Outbound OneBot message is not an array segment list');
    assert(privateCall.body.message[0]?.type === 'text', 'Outbound OneBot first segment is not text');
    log('ok   private message -> send_private_msg');

    const { dispatchOneBotReply } = await import('../../dist/server/onebot.js');
    await dispatchOneBotReply(
      { type: 'private', text: 'image probe', sessionId: 'onebot-private-verify', userId: 10001 },
      {
        text: '给你看 ![图](https://example.com/a.png)',
        sessionId: 'onebot-private-verify',
        toolCallCount: 0,
        turns: 1,
        crisisFlagged: false,
      },
    );
    const imageCall = fakeOneBot.calls.at(-1);
    const imageSegment = Array.isArray(imageCall?.body?.message)
      ? imageCall.body.message.find((segment) => segment.type === 'image')
      : null;
    assert(imageSegment?.data?.file === 'https://example.com/a.png', 'Image marker was not converted to an image segment');
    log('ok   image marker -> OneBot image segment');

    log('');
    log('QQ local verification passed.');
  } finally {
    if (mioServer) await mioServer.close();
    await fakeOneBot.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`QQ local verification failed: ${message}`);
  process.exit(1);
});
