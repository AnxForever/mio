// memory/global.ts — 全局 memory

import { readFileSyncSafe } from './bank.js';
import { globalMemoryPath } from './paths.js';

/** 读取全局 memory 文件（~/.mio/memory/memory.md） */
export function readGlobalMemory(): string {
  return readFileSyncSafe(globalMemoryPath()).trim();
}
