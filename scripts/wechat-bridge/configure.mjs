#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const repoRoot = process.cwd();
const envPath = join(repoRoot, '.env');

const env = readEnvFile(envPath);
const port = env.values.MIO_HTTP_PORT || process.env.MIO_HTTP_PORT || '3000';
const apiAddr = env.values.MIO_WECLAW_API_ADDR || process.env.MIO_WECLAW_API_ADDR || '127.0.0.1:18011';
const token = env.values.MIO_AUTH_TOKEN || process.env.MIO_AUTH_TOKEN || randomToken();

setEnv(env, 'MIO_AUTH_TOKEN', token);
setEnv(env, 'MIO_OPENAI_REQUIRE_SESSION', 'true');
setEnv(env, 'MIO_HTTP_PORT', port);
writeEnvFile(envPath, env);

const weclawHome = process.env.MIO_WECLAW_HOME || homedir();
const configPath = join(weclawHome, '.weclaw', 'config.json');
const config = readJson(configPath) ?? {};
const agents = config.agents && typeof config.agents === 'object' ? config.agents : {};

agents.mio = {
  ...(agents.mio && typeof agents.mio === 'object' ? agents.mio : {}),
  type: 'http',
  model: 'mio',
  endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
  api_key: token,
  max_history: 1,
};

const nextConfig = {
  ...config,
  default_agent: 'mio',
  api_addr: apiAddr,
  agents,
};

mkdirSync(dirname(configPath), { recursive: true });
writePrivateFile(configPath, JSON.stringify(nextConfig, null, 2) + '\n');

console.log(`Mio .env synchronized: ${envPath}`);
console.log(`WeClaw config synchronized: ${configPath}`);
console.log(`Mio endpoint: http://127.0.0.1:${port}/v1/chat/completions`);
console.log(`WeClaw API: http://${apiAddr}`);
console.log('Auth token is configured but not printed.');

function randomToken() {
  return `mio_${randomBytes(24).toString('base64url')}`;
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

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
