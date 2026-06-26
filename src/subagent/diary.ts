/**
 * Mio — Diary Writer (diary subagent)
 *
 * Adapted from cola-companion.
 *
 * runDiary(today, scopeKey, provider, ctx):
 *   Spawn the 'diary' subagent with 20 max turns. Builds a prompt that
 *   includes the before-state snapshot path, BOOKMARKS content, and
 *   session_read instructions for reconstructing the day's events.
 */

import { spawnSubagent } from './spawn.js';
import { readBookmarks, readMemoryIndex } from '../memory/bank.js';
import { diaryPath, snapshotDir } from '../memory/paths.js';
import { getConfig } from '../config.js';
import { join } from 'node:path';
import type { AIProvider, SessionContext } from '../types.js';

/**
 * Execute the diary-writing pass.
 *
 * The diary subagent:
 *  1. Compares the before-state snapshot (taken before consolidation) with
 *     the live bank to see what the consolidation pass changed.
 *  2. Reads BOOKMARKS.md for the day's salient moments.
 *  3. Uses session_read to verify specific timestamps mentioned in bookmarks.
 *  4. Writes a single diary file at diaries/<today>.md.
 *
 * Rules:
 *  - Does not touch any other bank file (MEMORY.md, soul.md, etc.)
 *  - Does not respond with a summary — just writes the diary file.
 *  - BOOKMARKS.md is cleared by the system after the diary finishes.
 *  - Writes in the user's primary language.
 *
 * @param today     Date string (YYYY-MM-DD).
 * @param scopeKey  Session scope key (or undefined).
 * @param provider  AI provider for the subagent.
 * @param ctx       Partial session context to inherit.
 * @returns         The subagent's final text response.
 */
export async function runDiary(
  today: string,
  scopeKey: string | undefined,
  provider: AIProvider,
  ctx?: Partial<SessionContext>,
): Promise<string> {
  const snapPath = snapshotDir();
  const bookmarks = readBookmarks();
  const memoryIndex = readMemoryIndex();
  const outputPath = diaryPath(today);
  const agentName = getConfig().name;

  // Extract the Active Context section from MEMORY.md for reference.
  const activeContextSection =
    memoryIndex.split('## Active Context')[1]?.slice(0, 500) ?? '(none)';

  const prompt = `Write ${agentName}'s private diary for ${today}.

You are running fresh — no in-context memory of today's conversation. Reconstruct what mattered today from:
1. The diff between the before-state snapshot at \`${join(snapPath, today)}\` and the live bank (read both and compare what the consolidation pass changed).
2. BOOKMARKS.md:
\`\`\`
${bookmarks || '(empty)'}
\`\`\`
3. A few session_read windows of today's actual exchanges around the timestamps named in BOOKMARKS (use session_read with since/until to verify specific moments — \u22642 calls per bookmark).

Then write a single diary file at: \`${outputPath}\`

Rules:
- Do not touch any other bank file. MEMORY.md and cola-self-reference/* are not yours to edit.
- Do not respond with a summary — just write the diary file and stop.
- BOOKMARKS.md will be cleared by the system after you finish.
- Write in the user's primary language.
- Current MEMORY.md Active Context for reference:
${activeContextSection}`;

  return spawnSubagent('diary', prompt, provider, ctx, {
    maxTurns: 20,
    awaitTerminal: true,
  });
}
