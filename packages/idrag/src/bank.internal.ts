import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readFileSyncSafe(path: string, fallback = ''): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : fallback;
  } catch {
    return fallback;
  }
}

export function writeFileSyncSafe(path: string, content: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
  } catch {
    // Best-effort package stub.
  }
}
