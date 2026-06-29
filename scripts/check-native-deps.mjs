#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
let failures = 0;

function mark(ok, label, detail = '') {
  const prefix = ok ? 'ok' : 'fail';
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`[${prefix}] ${label}${suffix}`);
  if (!ok) failures += 1;
}

function nativeKind(file) {
  if (!existsSync(file)) return 'missing';
  const head = readFileSync(file).subarray(0, 4);
  if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return 'ELF';
  if (head[0] === 0x4d && head[1] === 0x5a) return 'PE/MZ';
  if (head[0] === 0xcf && head[1] === 0xfa && head[2] === 0xed && head[3] === 0xfe) return 'Mach-O';
  if (head[0] === 0xfe && head[1] === 0xed && head[2] === 0xfa && head[3] === 0xcf) return 'Mach-O';
  return 'unknown';
}

function expectedKind() {
  if (process.platform === 'linux') return 'ELF';
  if (process.platform === 'win32') return 'PE/MZ';
  if (process.platform === 'darwin') return 'Mach-O';
  return 'unknown';
}

try {
  const pkgPath = require.resolve('better-sqlite3/package.json');
  const bindingPath = join(dirname(pkgPath), 'build', 'Release', 'better_sqlite3.node');
  const kind = nativeKind(bindingPath);
  const expected = expectedKind();
  mark(kind === expected || expected === 'unknown', 'better-sqlite3 native binary', `${kind} at ${bindingPath}`);
} catch (err) {
  mark(false, 'better-sqlite3 native binary', err instanceof Error ? err.message : String(err));
}

try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const row = db.prepare('select 1 as ok').get();
  db.close();
  mark(row?.ok === 1, 'better-sqlite3 opens an in-memory database');
} catch (err) {
  mark(false, 'better-sqlite3 opens an in-memory database', err instanceof Error ? err.message : String(err));
}

try {
  const Database = require('better-sqlite3');
  const sqliteVec = require('sqlite-vec');
  const db = new Database(':memory:');
  sqliteVec.load(db);
  const row = db.prepare('select vec_version() as version').get();
  db.close();
  mark(typeof row?.version === 'string', 'sqlite-vec extension loads', row?.version ?? 'no version');
} catch (err) {
  mark(false, 'sqlite-vec extension loads', err instanceof Error ? err.message : String(err));
}

if (failures > 0) {
  console.error('\nNative dependency check failed.');
  console.error('If this repo is used from WSL/Linux after installing dependencies on Windows, run:');
  console.error('  npm rebuild better-sqlite3 --build-from-source');
  process.exit(1);
}

console.log(`\nNative dependency check passed for ${process.platform}-${process.arch} ${process.version}.`);
