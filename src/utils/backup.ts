/**
 * Mio — Data backup & export
 *
 * Provides:
 *   1. createBackup()   — tar.gz the entire data/ directory.
 *   2. exportMemory()   — export MEMORY.md + soul + user-profile as plain text.
 *   3. listBackups()    — enumerate existing .tar.gz backups.
 *   4. pruneBackups()   — delete backups older than N days.
 *
 * Backups are stored in data/backups/ by default. The nightly scheduler
 * can optionally call createBackup() as part of its pipeline.
 *
 * Usage:
 *   import { createBackup, exportMemory, adminRouter } from '../utils/backup.js';
 */

import { createWriteStream, createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { getDataDir } from '../config.js';

// ─── Paths ───

function backupDir(): string {
  const p = join(getDataDir(), 'backups');
  mkdirSync(p, { recursive: true });
  return p;
}

// ─── Backup ───

/**
 * Create a tar.gz snapshot of the data directory.
 *
 * Uses a simple approach: streams each file individually through gzip.
 * For data directories under ~100 MB this is fast enough; for larger
 * datasets, switch to a proper tar streaming library.
 *
 * @returns Path to the created backup file.
 */
export async function createBackup(): Promise<string> {
  const dataDir = getDataDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = join(backupDir(), `mio-backup-${stamp}.tar.gz`);

  // Gather all files recursively (excluding existing backups)
  const files = gatherFiles(dataDir, backupDir());

  // Build a simple tar + gzip stream
  const writeStream = createWriteStream(outPath);
  const gzip = createGzip();

  // Start piping
  const gzipDone = pipeline(gzip, writeStream);

  for (const file of files) {
    const relPath = file.slice(dataDir.length + 1);
    const stat = statSync(file);

    // Tar header (simplified ustar format)
    const header = buildTarHeader(relPath, stat.size);
    gzip.write(header);

    // File content padded to 512-byte blocks
    const content = readFileSync(file);
    gzip.write(content);
    const padding = 512 - (content.length % 512);
    if (padding < 512) {
      gzip.write(Buffer.alloc(padding, 0));
    }
  }

  // Two zero blocks mark end of tar
  gzip.write(Buffer.alloc(1024, 0));
  gzip.end();

  await gzipDone;
  return outPath;
}

/**
 * Quickly export core memory files as a plain-text bundle.
 * Useful for human inspection, migration, or sharing with another Mio instance.
 */
export function exportMemory(): string {
  const dataDir = getDataDir();
  const parts: string[] = [];
  parts.push(`# Mio Memory Export — ${new Date().toISOString()}\n`);

  const memoryMd = join(dataDir, 'memory-bank', 'MEMORY.md');
  if (existsSync(memoryMd)) {
    parts.push('## MEMORY.md\n');
    parts.push(readFileSync(memoryMd, 'utf-8'));
    parts.push('');
  }

  const soul = join(dataDir, 'memory-bank', 'cola-self-reference', 'soul.md');
  if (existsSync(soul)) {
    parts.push('## soul.md\n');
    parts.push(readFileSync(soul, 'utf-8'));
    parts.push('');
  }

  const userProfile = join(dataDir, 'memory-bank', 'cola-self-reference', 'user-profile.md');
  if (existsSync(userProfile)) {
    parts.push('## user-profile.md\n');
    parts.push(readFileSync(userProfile, 'utf-8'));
    parts.push('');
  }

  const emotion = join(dataDir, 'emotion-state.json');
  if (existsSync(emotion)) {
    parts.push('## emotion-state.json\n');
    parts.push(readFileSync(emotion, 'utf-8'));
    parts.push('');
  }

  const relationship = join(dataDir, 'relationship-state.json');
  if (existsSync(relationship)) {
    parts.push('## relationship-state.json\n');
    parts.push(readFileSync(relationship, 'utf-8'));
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * List all backups, newest first.
 */
export function listBackups(): { name: string; size: number; created: string }[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tar.gz'))
    .map((f) => {
      const s = statSync(join(dir, f));
      return { name: f, size: s.size, created: s.birthtime.toISOString() };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}

/**
 * Delete backups older than `maxAgeDays`.
 * @returns Number of deleted files.
 */
export function pruneBackups(maxAgeDays: number = 7): number {
  const dir = backupDir();
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - maxAgeDays * 86400 * 1000;
  let deleted = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.tar.gz')) continue;
    const s = statSync(join(dir, f));
    if (s.birthtimeMs < cutoff) {
      unlinkSync(join(dir, f));
      deleted++;
    }
  }
  return deleted;
}

// ─── Helpers ───

function gatherFiles(root: string, excludeDir?: string): string[] {
  const result: string[] = [];
  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (excludeDir && full === excludeDir) continue;
        if (e.name.startsWith('.')) continue;
        walk(full);
      } else if (e.isFile()) {
        result.push(full);
      }
    }
  }
  walk(root);
  return result;
}

function buildTarHeader(name: string, size: number): Buffer {
  const buf = Buffer.alloc(512, 0);

  // name (100 bytes)
  const nameBuf = Buffer.from(name.slice(0, 99), 'utf-8');
  nameBuf.copy(buf, 0);

  // mode (8 bytes) — 644
  buf.write('0000644', 100, 7, 'ascii');

  // uid / gid (8 bytes each)
  buf.write('0000000', 108, 7, 'ascii');
  buf.write('0000000', 116, 7, 'ascii');

  // size (12 bytes, octal)
  const sizeStr = size.toString(8).padStart(11, '0') + ' ';
  buf.write(sizeStr, 124, 12, 'ascii');

  // mtime (12 bytes, octal)
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ';
  buf.write(mtime, 136, 12, 'ascii');

  // typeflag — '0' for regular file
  buf.write('0', 156, 1, 'ascii');

  // Checksum (8 bytes) — computed over the header with checksum field as spaces
  buf.fill(' ', 148, 8);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  const csum = sum.toString(8).padStart(6, '0') + '\x00 ';
  buf.write(csum, 148, 8, 'ascii');

  return buf;
}
