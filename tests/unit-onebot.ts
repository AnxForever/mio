#!/usr/bin/env node
/**
 * Mio — OneBot v11 bridge unit tests.
 *
 * Covers deterministic adapter behavior: event normalization, group mention
 * gating, quick replies, outbound OneBot API calls, and bearer token forwarding.
 */

import { createServer } from 'node:http';

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

interface ApiCall {
  path: string;
  body: Record<string, unknown>;
  authorization?: string;
}

const results: TestResult[] = [];
const ONEBOT_ENV_KEYS = [
  'MIO_ONEBOT_API_BASE',
  'ONEBOT_API_BASE',
  'MIO_ONEBOT_ACCESS_TOKEN',
  'ONEBOT_ACCESS_TOKEN',
  'MIO_ONEBOT_REPLY_MODE',
  'MIO_ONEBOT_GROUP_MODE',
  'MIO_ONEBOT_TIMEOUT_MS',
  'MIO_ONEBOT_IGNORE_SELF',
  'MIO_ONEBOT_ALLOW_USERS',
  'MIO_ONEBOT_ALLOWED_USERS',
  'MIO_ONEBOT_ALLOW_GROUPS',
  'MIO_ONEBOT_ALLOWED_GROUPS',
] as const;

function record(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function snapshotEnv(): Record<string, string | undefined> {
  const old: Record<string, string | undefined> = {};
  for (const key of ONEBOT_ENV_KEYS) old[key] = process.env[key];
  return old;
}

function clearEnv(): void {
  for (const key of ONEBOT_ENV_KEYS) delete process.env[key];
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

async function startFakeApi(): Promise<{
  url: string;
  calls: ApiCall[];
  close: () => Promise<void>;
}> {
  const calls: ApiCall[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      calls.push({
        path: req.url ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') as Record<string, unknown>,
        authorization: req.headers.authorization,
      });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 42 } }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  assert(typeof addr === 'object' && addr !== null, 'fake api did not bind');

  return {
    url: `http://127.0.0.1:${addr.port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function restoreEnv(old: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — OneBot bridge unit tests\x1b[0m\n');

  const suiteEnv = snapshotEnv();
  clearEnv();

  const {
    dispatchOneBotReply,
    extractOneBotIncomingMessage,
    getOneBotBridgeStatus,
  } = await import('../dist/server/onebot.js');

  await test('status reports conservative defaults', () => {
    const old = snapshotEnv();
    clearEnv();
    try {
      const status = getOneBotBridgeStatus();
      assert(status.enabled === true, 'bridge should be enabled');
      assert(status.apiBaseConfigured === false, 'api base should be absent');
      assert(status.groupMode === 'mention', `unexpected group mode: ${status.groupMode}`);
      assert(status.replyMode === 'quick', `unexpected reply mode: ${status.replyMode}`);
      assert(status.timeoutMs === 10_000, `unexpected timeout: ${status.timeoutMs}`);
      assert(status.ignoreSelf === true, 'self messages should be ignored by default');
      assert(status.allowUsersConfigured === false, 'user allowlist should be absent');
      assert(status.allowUsersCount === 0, `unexpected user allow count: ${status.allowUsersCount}`);
      assert(status.allowGroupsConfigured === false, 'group allowlist should be absent');
      assert(status.allowGroupsCount === 0, `unexpected group allow count: ${status.allowGroupsCount}`);
    } finally {
      restoreEnv(old);
    }
  });

  await test('status reports allowlist counts without exposing ids', () => {
    const old = snapshotEnv();
    clearEnv();
    process.env.MIO_ONEBOT_ALLOW_USERS = '12345,67890';
    process.env.MIO_ONEBOT_ALLOW_GROUPS = '11111';
    try {
      const status = getOneBotBridgeStatus();
      assert(status.allowUsersConfigured === true, 'user allowlist should be configured');
      assert(status.allowUsersCount === 2, `unexpected user count: ${status.allowUsersCount}`);
      assert(status.allowGroupsConfigured === true, 'group allowlist should be configured');
      assert(status.allowGroupsCount === 1, `unexpected group count: ${status.allowGroupsCount}`);
      assert(!('allowUsers' in status), 'status should not expose user ids');
      assert(!('allowGroups' in status), 'status should not expose group ids');
    } finally {
      restoreEnv(old);
    }
  });

  await test('legacy OneBot env aliases are supported after blank canonical vars', () => {
    const old = snapshotEnv();
    clearEnv();
    process.env.MIO_ONEBOT_API_BASE = ' ';
    process.env.ONEBOT_API_BASE = 'http://127.0.0.1:3001';
    process.env.MIO_ONEBOT_ACCESS_TOKEN = '';
    process.env.ONEBOT_ACCESS_TOKEN = 'legacy-token';
    process.env.MIO_ONEBOT_ALLOW_USERS = ' ';
    process.env.MIO_ONEBOT_ALLOWED_USERS = '12345';
    process.env.MIO_ONEBOT_ALLOW_GROUPS = '';
    process.env.MIO_ONEBOT_ALLOWED_GROUPS = '67890';
    process.env.MIO_ONEBOT_GROUP_MODE = 'all';
    try {
      const status = getOneBotBridgeStatus();
      assert(status.apiBaseConfigured === true, 'legacy api base should be configured');
      assert(status.accessTokenConfigured === true, 'legacy access token should be configured');
      assert(status.allowUsersConfigured === true, 'legacy user allowlist should be configured');
      assert(status.allowUsersCount === 1, `unexpected user count: ${status.allowUsersCount}`);
      assert(status.allowGroupsConfigured === true, 'legacy group allowlist should be configured');
      assert(status.allowGroupsCount === 1, `unexpected group count: ${status.allowGroupsCount}`);

      const incoming = extractOneBotIncomingMessage({
        post_type: 'message',
        message_type: 'group',
        user_id: 12345,
        group_id: 67890,
        self_id: 11111,
        raw_message: 'legacy alias allowed',
      });
      assert(!('skipped' in incoming), `unexpected skip: ${'reason' in incoming ? incoming.reason : ''}`);
      assert(incoming.text === 'legacy alias allowed', `unexpected text: ${incoming.text}`);
    } finally {
      restoreEnv(old);
    }
  });

  await test('extracts private text and stable session id', () => {
    const incoming = extractOneBotIncomingMessage({
      post_type: 'message',
      message_type: 'private',
      user_id: 12345,
      raw_message: 'hello &#91;world&#93;',
    });
    assert(!('skipped' in incoming), `unexpected skip: ${'reason' in incoming ? incoming.reason : ''}`);
    assert(incoming.text === 'hello [world]', `unexpected text: ${incoming.text}`);
    assert(incoming.sessionId.startsWith('onebot-private-12345-'), `unexpected session: ${incoming.sessionId}`);
  });

  await test('group mention gate skips unmentioned messages', () => {
    const incoming = extractOneBotIncomingMessage({
      post_type: 'message',
      message_type: 'group',
      user_id: 12345,
      group_id: 67890,
      self_id: 11111,
      raw_message: 'hello group',
    });
    assert('skipped' in incoming, 'expected skip');
    assert(incoming.reason === 'group_message_not_mentioned', `unexpected reason: ${incoming.reason}`);
  });

  await test('ignores self messages by default', () => {
    const incoming = extractOneBotIncomingMessage({
      post_type: 'message',
      message_type: 'private',
      user_id: 11111,
      self_id: 11111,
      raw_message: 'message from bot account',
    });
    assert('skipped' in incoming, 'expected skip');
    assert(incoming.reason === 'self_message', `unexpected reason: ${incoming.reason}`);
  });

  await test('user allowlist blocks unlisted senders', () => {
    const old = snapshotEnv();
    clearEnv();
    process.env.MIO_ONEBOT_ALLOW_USERS = '12345, 67890';
    try {
      const blocked = extractOneBotIncomingMessage({
        post_type: 'message',
        message_type: 'private',
        user_id: 99999,
        raw_message: 'not allowed',
      });
      assert('skipped' in blocked, 'expected unlisted sender to be skipped');
      assert(blocked.reason === 'user_not_allowed', `unexpected reason: ${blocked.reason}`);

      const allowed = extractOneBotIncomingMessage({
        post_type: 'message',
        message_type: 'private',
        user_id: 12345,
        raw_message: 'allowed',
      });
      assert(!('skipped' in allowed), `unexpected skip: ${'reason' in allowed ? allowed.reason : ''}`);
      assert(allowed.text === 'allowed', `unexpected text: ${allowed.text}`);
    } finally {
      restoreEnv(old);
    }
  });

  await test('group allowlist blocks unlisted groups', () => {
    const old = snapshotEnv();
    clearEnv();
    process.env.MIO_ONEBOT_ALLOW_GROUPS = '67890';
    process.env.MIO_ONEBOT_GROUP_MODE = 'all';
    try {
      const blocked = extractOneBotIncomingMessage({
        post_type: 'message',
        message_type: 'group',
        user_id: 12345,
        group_id: 11111,
        self_id: 22222,
        raw_message: 'not allowed group',
      });
      assert('skipped' in blocked, 'expected unlisted group to be skipped');
      assert(blocked.reason === 'group_not_allowed', `unexpected reason: ${blocked.reason}`);

      const allowed = extractOneBotIncomingMessage({
        post_type: 'message',
        message_type: 'group',
        user_id: 12345,
        group_id: 67890,
        self_id: 22222,
        raw_message: 'allowed group',
      });
      assert(!('skipped' in allowed), `unexpected skip: ${'reason' in allowed ? allowed.reason : ''}`);
      assert(allowed.text === 'allowed group', `unexpected text: ${allowed.text}`);
    } finally {
      restoreEnv(old);
    }
  });

  await test('combined allowlists require both sender and group for group messages', () => {
    const old = snapshotEnv();
    clearEnv();
    process.env.MIO_ONEBOT_ALLOW_USERS = '12345';
    process.env.MIO_ONEBOT_ALLOW_GROUPS = '67890';
    process.env.MIO_ONEBOT_GROUP_MODE = 'all';
    try {
      const blockedUser = extractOneBotIncomingMessage({
        post_type: 'message',
        message_type: 'group',
        user_id: 99999,
        group_id: 67890,
        self_id: 11111,
        raw_message: 'allowed group but blocked user',
      });
      assert('skipped' in blockedUser, 'expected unlisted group sender to be skipped');
      assert(blockedUser.reason === 'user_not_allowed', `unexpected reason: ${blockedUser.reason}`);

      const blockedGroup = extractOneBotIncomingMessage({
        post_type: 'message',
        message_type: 'group',
        user_id: 12345,
        group_id: 11111,
        self_id: 22222,
        raw_message: 'allowed user but blocked group',
      });
      assert('skipped' in blockedGroup, 'expected unlisted group to be skipped');
      assert(blockedGroup.reason === 'group_not_allowed', `unexpected reason: ${blockedGroup.reason}`);

      const allowed = extractOneBotIncomingMessage({
        post_type: 'message',
        message_type: 'group',
        user_id: 12345,
        group_id: 67890,
        self_id: 22222,
        raw_message: 'allowed sender and group',
      });
      assert(!('skipped' in allowed), `unexpected skip: ${'reason' in allowed ? allowed.reason : ''}`);
      assert(allowed.text === 'allowed sender and group', `unexpected text: ${allowed.text}`);
    } finally {
      restoreEnv(old);
    }
  });

  await test('group mention gate accepts array at segment and strips CQ text', () => {
    const incoming = extractOneBotIncomingMessage({
      post_type: 'message',
      message_type: 'group',
      user_id: 12345,
      group_id: 67890,
      self_id: 11111,
      message: [
        { type: 'at', data: { qq: 11111 } },
        { type: 'text', data: { text: '  hello Mio  ' } },
      ],
    });
    assert(!('skipped' in incoming), `unexpected skip: ${'reason' in incoming ? incoming.reason : ''}`);
    assert(incoming.text === 'hello Mio', `unexpected text: ${incoming.text}`);
    assert(incoming.sessionId.startsWith('onebot-group-67890-'), `unexpected session: ${incoming.sessionId}`);
  });

  await test('quick reply returns OneBot operation fields', async () => {
    const old = snapshotEnv();
    clearEnv();
    try {
      const response = await dispatchOneBotReply(
        { type: 'private', text: 'hi', sessionId: 'onebot-private-test', userId: 12345 },
        { text: 'reply text', sessionId: 'onebot-private-test', toolCallCount: 0, turns: 1, crisisFlagged: false },
      );
      assert(response.replyMode === 'quick', `unexpected mode: ${String(response.replyMode)}`);
      assert(response.reply === 'reply text', `unexpected reply: ${String(response.reply)}`);
      assert(response.auto_escape === false, 'auto_escape should be false');
    } finally {
      restoreEnv(old);
    }
  });

  await test('explicit api reply mode fails clearly without API base', async () => {
    const old = snapshotEnv();
    clearEnv();
    process.env.MIO_ONEBOT_REPLY_MODE = 'api';
    try {
      let error: unknown;
      try {
        await dispatchOneBotReply(
          { type: 'private', text: 'hi', sessionId: 'onebot-private-test', userId: 12345 },
          { text: 'reply text', sessionId: 'onebot-private-test', toolCallCount: 0, turns: 1, crisisFlagged: false },
        );
      } catch (err) {
        error = err;
      }
      assert(error instanceof Error, 'expected configuration error');
      assert(error.name === 'OneBotConfigError', `unexpected error name: ${error.name}`);
      assert(error.message.includes('MIO_ONEBOT_API_BASE'), `unexpected error: ${error.message}`);
    } finally {
      restoreEnv(old);
    }
  });

  await test('api reply posts to send_group_msg with access token', async () => {
    const api = await startFakeApi();
    const old = snapshotEnv();
    clearEnv();
    process.env.MIO_ONEBOT_API_BASE = api.url;
    process.env.MIO_ONEBOT_ACCESS_TOKEN = 'secret-token';
    process.env.MIO_ONEBOT_TIMEOUT_MS = '2000';
    try {
      const response = await dispatchOneBotReply(
        { type: 'group', text: 'hi', sessionId: 'onebot-group-test', userId: 12345, groupId: 67890 },
        { text: 'group reply', sessionId: 'onebot-group-test', toolCallCount: 0, turns: 1, crisisFlagged: false },
      );
      assert(response.replyMode === 'api', `unexpected mode: ${String(response.replyMode)}`);
      assert(response.sent === true, 'expected sent=true');
      assert(api.calls.length === 1, `unexpected calls: ${api.calls.length}`);
      assert(api.calls[0].path === '/send_group_msg', `unexpected path: ${api.calls[0].path}`);
      assert(api.calls[0].authorization === 'Bearer secret-token', 'missing bearer token');
      assert(api.calls[0].body.group_id === 67890, 'wrong group_id');
      assert(api.calls[0].body.message === 'group reply', 'wrong message');
    } finally {
      restoreEnv(old);
      await api.close();
    }
  });

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  restoreEnv(suiteEnv);
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} OneBot bridge tests passed\x1b[0m`);
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
