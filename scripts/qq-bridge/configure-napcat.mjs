#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const env = readEnvFile(join(repoRoot, '.env'));
const webuiConfigPath = process.env.MIO_NAPCAT_WEBUI_CONFIG
  || join(repoRoot, 'data', 'runtime', 'napcat', 'config', 'webui.json');
const webuiBase = stripTrailingSlash(process.env.MIO_NAPCAT_WEBUI_BASE || 'http://127.0.0.1:6099');

const mioPort = env.MIO_HTTP_PORT || process.env.MIO_HTTP_PORT || '3000';
const onebotApiBase = env.MIO_ONEBOT_API_BASE || process.env.MIO_ONEBOT_API_BASE || 'http://127.0.0.1:3001';
const onebotToken = env.MIO_ONEBOT_ACCESS_TOKEN || process.env.MIO_ONEBOT_ACCESS_TOKEN || '';
const mioToken = env.MIO_AUTH_TOKEN || process.env.MIO_AUTH_TOKEN || '';
const napcatNetwork = process.env.MIO_NAPCAT_NETWORK || 'bridge';
const eventHost = process.env.MIO_NAPCAT_EVENT_HOST || (napcatNetwork === 'host' ? '127.0.0.1' : 'host.docker.internal');
const eventUrl = process.env.MIO_NAPCAT_EVENT_URL || `http://${eventHost}:${mioPort}/onebot/v11/events`;
const outboundPort = extractPort(onebotApiBase, '3001');
const serverHost = process.env.MIO_NAPCAT_SERVER_HOST || (napcatNetwork === 'host' ? '127.0.0.1' : '0.0.0.0');

if (!existsSync(webuiConfigPath)) {
  fail(`NapCat WebUI config not found: ${webuiConfigPath}`);
}

const webuiToken = JSON.parse(readFileSync(webuiConfigPath, 'utf8')).token;
if (!webuiToken) {
  fail('NapCat WebUI token is missing. Start NapCat first with npm run qq:napcat:up.');
}

const credential = await loginWebui(webuiToken);
const config = await getOb11Config(credential);
const next = mergeMioNetworkConfig(config);
await postApi('/OB11Config/SetConfig', credential, { config: JSON.stringify(next) });

console.log('NapCat OneBot network config synchronized.');
console.log(`HTTP client event URL: ${eventUrl}`);
console.log(`HTTP server listen: ${serverHost}:${outboundPort}`);
console.log('Tokens are configured but not printed.');

async function loginWebui(token) {
  const hash = createHash('sha256').update(`${token}.napcat`).digest('hex');
  const body = await postApi('/auth/login', null, { hash });
  const credential = body.data?.Credential;
  if (!credential) {
    fail('NapCat WebUI login failed.');
  }
  return credential;
}

async function getOb11Config(credential) {
  const body = await postApi('/OB11Config/GetConfig', credential, {}, { allowError: true });
  if (!body.data || typeof body.data !== 'object') {
    if (body.message === 'Not Login') {
      fail('NapCat QQ is not logged in yet. Scan data/runtime/qq-bridge/napcat-qrcode.png, then run npm run qq:napcat:configure again.');
    }
    fail(`NapCat OB11 config unavailable: ${body.message || 'unknown error'}`);
  }
  return body.data;
}

async function postApi(path, credential, payload, options = {}) {
  const headers = { 'content-type': 'application/json' };
  if (credential) {
    headers.Authorization = `Bearer ${credential}`;
  }
  let response;
  try {
    response = await fetch(`${webuiBase}/api${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    fail(`NapCat WebUI request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    fail(`NapCat WebUI request failed: HTTP ${response.status}`);
  }
  if (body.code !== 0 && !options.allowError) {
    fail(`NapCat WebUI request failed: ${body.message || 'unknown error'}`);
  }
  return body;
}

function mergeMioNetworkConfig(config) {
  const next = structuredClone(config);
  next.network ||= {};
  next.network.httpClients = replaceByName(next.network.httpClients, {
    enable: true,
    name: 'mio-events',
    url: eventUrl,
    reportSelfMessage: false,
    messagePostFormat: 'array',
    token: mioToken,
    debug: false,
  });
  next.network.httpServers = replaceByName(next.network.httpServers, {
    enable: true,
    name: 'mio-api',
    host: serverHost,
    port: Number(outboundPort),
    enableCors: true,
    enableWebsocket: false,
    messagePostFormat: 'array',
    token: onebotToken,
    debug: false,
  });
  next.network.httpSseServers ||= [];
  next.network.websocketServers ||= [];
  next.network.websocketClients ||= [];
  return next;
}

function replaceByName(items, item) {
  const list = Array.isArray(items) ? [...items] : [];
  const index = list.findIndex((entry) => entry?.name === item.name);
  if (index >= 0) {
    list[index] = { ...list[index], ...item };
  } else {
    list.push(item);
  }
  return list;
}

function readEnvFile(path) {
  const values = {};
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      values[match[1]] = unquoteEnv(match[2]);
    }
  }
  return values;
}

function unquoteEnv(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractPort(value, fallback) {
  try {
    const parsed = new URL(value.includes('://') ? value : `http://${value}`);
    return parsed.port || fallback;
  } catch {
    return fallback;
  }
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
