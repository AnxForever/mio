#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const repoRoot = process.cwd();
const envPath = join(repoRoot, '.env');
const runtimeDir = join(repoRoot, 'data', 'runtime', 'qq-bridge');

const env = readEnvFile(envPath);
const mioPort = env.values.MIO_HTTP_PORT || process.env.MIO_HTTP_PORT || '3000';
const mioToken = env.values.MIO_AUTH_TOKEN || process.env.MIO_AUTH_TOKEN || randomToken();
const onebotApiBase = env.values.MIO_ONEBOT_API_BASE || process.env.MIO_ONEBOT_API_BASE || 'http://127.0.0.1:3001';
const onebotToken = env.values.MIO_ONEBOT_ACCESS_TOKEN || process.env.MIO_ONEBOT_ACCESS_TOKEN || randomToken();
const groupMode = env.values.MIO_ONEBOT_GROUP_MODE || process.env.MIO_ONEBOT_GROUP_MODE || 'off';
const napcatNetwork = process.env.MIO_NAPCAT_NETWORK || 'bridge';
const napcatEventHost = process.env.MIO_NAPCAT_EVENT_HOST || (napcatNetwork === 'host' ? '127.0.0.1' : 'host.docker.internal');
const napcatEventUrl = `http://${napcatEventHost}:${mioPort}/onebot/v11/events`;
const napcatHttpServerHost = process.env.MIO_NAPCAT_SERVER_HOST || (napcatNetwork === 'host' ? '127.0.0.1' : '0.0.0.0');
const napcatHttpServerListen = `${napcatHttpServerHost}:${extractPort(onebotApiBase, '3001')}`;

setEnv(env, 'MIO_AUTH_TOKEN', mioToken);
setEnv(env, 'MIO_HTTP_PORT', mioPort);
setEnv(env, 'MIO_ONEBOT_API_BASE', onebotApiBase);
setEnv(env, 'MIO_ONEBOT_ACCESS_TOKEN', onebotToken);
setEnv(env, 'MIO_ONEBOT_REPLY_MODE', 'api');
setEnv(env, 'MIO_ONEBOT_GROUP_MODE', groupMode);
setEnv(env, 'MIO_ONEBOT_OUTBOUND_FORMAT', 'array');
writeEnvFile(envPath, env);

mkdirSync(runtimeDir, { recursive: true });
writePrivateFile(join(runtimeDir, 'napcat-http-client.json'), JSON.stringify({
  name: 'Mio HTTP post client',
  url: napcatEventUrl,
  messagePostFormat: 'array',
  reportSelfMessage: false,
  headers: {
    Authorization: 'Bearer <MIO_AUTH_TOKEN from .env>',
  },
}, null, 2) + '\n');

writePrivateFile(join(runtimeDir, 'napcat-http-server.env'), [
  `listen=${napcatHttpServerListen}`,
  'token=<MIO_ONEBOT_ACCESS_TOKEN from .env>',
  '',
].join('\n'));

writePrivateFile(join(runtimeDir, 'README.md'), [
  '# Mio QQ Bridge Runtime',
  '',
  'Use these values in NapCat WebUI:',
  '',
  '1. HTTP client / event post:',
  `   - URL: ${napcatEventUrl}`,
  '   - messagePostFormat: array',
  '   - reportSelfMessage: false',
  '   - Header: Authorization: Bearer <MIO_AUTH_TOKEN from .env>',
  '',
  '2. HTTP server / outbound API:',
  `   - Listen: ${napcatHttpServerListen}`,
  '   - Token: <MIO_ONEBOT_ACCESS_TOKEN from .env>',
  `   - Mio API base stays: ${onebotApiBase}`,
  '',
  'Group mode is conservative by default. Set MIO_ONEBOT_GROUP_MODE=mention or all only after private chat works.',
  '',
].join('\n'));

console.log(`Mio .env synchronized: ${envPath}`);
console.log(`QQ bridge notes written: ${runtimeDir}`);
console.log(`Mio OneBot webhook for NapCat: ${napcatEventUrl}`);
console.log(`NapCat OneBot API base: ${onebotApiBase}`);
console.log('Tokens are configured but not printed.');

function randomToken() {
  return `mio_${randomBytes(24).toString('base64url')}`;
}

function extractPort(value, fallback) {
  try {
    const parsed = new URL(value.includes('://') ? value : `http://${value}`);
    return parsed.port || fallback;
  } catch {
    return fallback;
  }
}

function readEnvFile(path) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  const entries = [];
  const values = {};

  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      entries.push({ type: 'raw', line });
      continue;
    }
    const key = match[1];
    const value = unquoteEnv(match[2]);
    entries.push({ type: 'kv', key, value });
    values[key] = value;
  }

  return { entries, values };
}

function setEnv(env, key, value) {
  env.values[key] = value;
  const existing = env.entries.find((entry) => entry.type === 'kv' && entry.key === key);
  if (existing) {
    existing.value = value;
    return;
  }
  if (env.entries.length > 0 && env.entries.at(-1)?.type !== 'raw') {
    env.entries.push({ type: 'raw', line: '' });
  }
  env.entries.push({ type: 'kv', key, value });
}

function writeEnvFile(path, env) {
  const body = env.entries.map((entry) => {
    if (entry.type === 'raw') return entry.line;
    return `${entry.key}=${quoteEnv(entry.value)}`;
  }).join('\n').replace(/\n*$/, '\n');
  writePrivateFile(path, body);
}

function writePrivateFile(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Some Windows/WSL mounts ignore chmod; keep the file written.
  }
}

function quoteEnv(value) {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function unquoteEnv(raw) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
