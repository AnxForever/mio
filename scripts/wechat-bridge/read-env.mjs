#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

const [, , envPath, requestedKey] = process.argv;

if (!envPath) {
  console.error('Usage: read-env.mjs <env-file> [KEY]');
  process.exit(2);
}

const values = readEnvFile(envPath);
if (requestedKey) {
  process.stdout.write(values[requestedKey] ?? '');
} else {
  for (const [key, value] of Object.entries(values)) {
    process.stdout.write(`${key}=${value.replace(/\r?\n/g, ' ')}\n`);
  }
}

function readEnvFile(path) {
  const values = {};
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];

  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = unquoteEnv(match[2]);
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
