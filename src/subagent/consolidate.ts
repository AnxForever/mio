/**
 * Mio — Nightly Consolidation (bank-consolidate subagent)
 *
 * Adapted from cola-companion.
 *
 * buildConsolidateRuntimePrompt(today, scopeKey, colaDir):
 *   Build the runtime prompt by combining the NIGHTLY_CONSOLIDATION template
 *   with the current MEMORY.md content, BOOKMARKS.md content, and bank file list.
 *
 * runConsolidation(today, scopeKey, provider, ctx):
 *   Spawn the 'bank-consolidate' subagent with 30 max turns.
 */

import { NIGHTLY_CONSOLIDATION } from '../prompt/templates.js';
import { spawnSubagent } from './spawn.js';
import { logger } from '../utils/logger.js';
import { readMemoryIndex, readBookmarks, listBankFiles, readStructuredMemoryFile, writeMidTermTopicFile } from '../memory/bank.js';
import { colaDir } from '../memory/paths.js';
import { modManager } from '../mod/mod-manager.js';
import { extractStructuredMemory, writeStructuredMemoryToDisk, cleanExpiredMidTermTopics, readStructuredMemoryFromDisk, deserializeMemory } from '../memory/structured-memory.js';
import { runReflectionCycle } from '../memory/reflector.js';
import { getConfig } from '../config.js';
import type { AIProvider, SessionContext } from '../types.js';

/**
 * Build the runtime prompt for the bank-consolidate subagent.
 *
 * Injects:
 *  - NIGHTLY_CONSOLIDATION template (with colaDir)
 *  - Current MEMORY.md content
 *  - Current BOOKMARKS.md content
 *  - Current bank file list
 *  - Today's date and session scope key
 *
 * @param today    Date string (YYYY-MM-DD).
 * @param scopeKey Session scope key (or undefined).
 * @param colaDir  Path to the cola data directory.
 * @returns        The full runtime prompt string.
 */
export function buildConsolidateRuntimePrompt(
  today: string,
  scopeKey: string | undefined,
  colaDir: string,
): string {
  const memoryIndex = readMemoryIndex();
  const bookmarks = readBookmarks();
  const bankFiles = listBankFiles();
  const window = scopeKey
    ? `today's session scopeKey: ${scopeKey}`
    : `date window: ${today}`;

  // Attempt to read active MOD from the mod manager.
  let activeMod = 'default';
  try {
    activeMod = modManager().activeMod;
  } catch {
    // modManager not initialized — use default.
  }

  // Read existing structured memory to pass as context for the subagent
  let structuredContext = '';
  try {
    const structuredRaw = readStructuredMemoryFile();
    if (structuredRaw && structuredRaw.trim().length > 0) {
      const parsed = JSON.parse(structuredRaw);
      const durableCount = (parsed.durableFacts ?? []).length;
      const entityCount = (parsed.entities ?? []).length;
      if (entityCount > 0) {
        structuredContext = `\n### Current Structured Memory\n- ${entityCount} total entities\n- ${durableCount} durable facts\n- ${(parsed.topics ?? []).length} topic clusters\n`;
      }
    }
  } catch {
    // Best effort
  }

  return `${NIGHTLY_CONSOLIDATION(colaDir)}

---

## Tonight's Run Context

- Date: ${today}
- ${window}
- Active MOD: ${activeMod}

### Current MEMORY.md
\`\`\`markdown
${memoryIndex || '(empty)'}
\`\`\`

### Current BOOKMARKS.md
\`\`\`markdown
${bookmarks || '(no bookmarks today)'}
\`\`\`

### Current bank files
${bankFiles.length > 0 ? bankFiles.map((f) => `- ${f}`).join('\n') : '(bank is empty)'}
${structuredContext}
---

Start now. Read BOOKMARKS.md, route each entry, run your passes, execute edits.
Remember: do NOT clear BOOKMARKS.md — the diary subagent runs after you.

## After your consolidation work

In addition to the consolidation instructions above, after merging bookmarks into the bank files, extract the key facts, preferences, events, decisions, intentions, and emotions from each bookmark as structured data. The system will process this into \`structured-memory.json\` automatically — but your rich, nuanced bookmark entries make the extraction more accurate. Write clear, fact-rich bookmarks with concrete evidence. The structured extraction is more accurate when you pack high-signal content into the bookmark text.`;
}

/**
 * Execute the nightly bank-consolidate pass.
 *
 * 1. Build the runtime prompt.
 * 2. Spawn the 'bank-consolidate' subagent with 30 max turns.
 * 3. After completion, run structured memory extraction on bookmarks
 *    and persist to structured-memory.json + mid-term topic files.
 * 4. Clean expired mid-term topics (touched >30 days ago).
 *
 * @param today     Date string (YYYY-MM-DD).
 * @param scopeKey  Session scope key (or undefined).
 * @param provider  AI provider for the subagent.
 * @param ctx       Partial session context to inherit.
 * @returns         The subagent's final text response.
 */
export async function runConsolidation(
  today: string,
  scopeKey: string | undefined,
  provider: AIProvider,
  ctx?: Partial<SessionContext>,
): Promise<string> {
  const dir = ctx?.colaDir ?? colaDir();
  const runtimePrompt = buildConsolidateRuntimePrompt(today, scopeKey, dir);

  const result = await spawnSubagent('bank-consolidate', runtimePrompt, provider, ctx, {
    maxTurns: 30,
    awaitTerminal: true,
  });

  // After consolidation, run structured memory extraction
  try {
    await runStructuredExtraction(dir);
  } catch (err) {
    logger.error(`[consolidate] structured extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Run structured memory extraction on the current bookmarks
 * and existing structured memory, then persist results.
 *
 * After extraction, runs the ACE reflection cycle (reflect → curate) to
 * improve memory quality by flagging vague/outdated/contradictory entities.
 * Controlled by config.features.aceReflector (default: true).
 */
async function runStructuredExtraction(_colaDirPath: string): Promise<void> {
  const bookmarks = readBookmarks();
  const config = getConfig();
  const aceEnabled = config.features?.aceReflector ?? true;

  // Read existing structured memory if available
  let existingMemory = undefined;
  try {
    const existingRaw = readStructuredMemoryFile();
    if (existingRaw && existingRaw.trim().length > 0) {
      existingMemory = deserializeMemory(existingRaw);
    }
  } catch {
    // No existing memory — start fresh
  }

  // Extract structured memory from bookmarks
  let structured = extractStructuredMemory(bookmarks, existingMemory);

  // ACE Reflection Cycle: quality check pass
  if (aceEnabled) {
    try {
      const beforeCount = structured.entities.length;
      structured = runReflectionCycle(structured);
      const afterCount = structured.entities.length;
      if (afterCount !== beforeCount) {
        logger.info(`[consolidate] ACE reflector: ${beforeCount} → ${afterCount} entities after curation`);
      }
    } catch (err) {
      logger.error(`[consolidate] ACE reflection failed: ${err instanceof Error ? err.message : String(err)}`);
      // Continue with un-reflected memory — reflection is not critical
    }
  }

  // Write to LTM file
  writeStructuredMemoryToDisk(structured);
  logger.info(`[consolidate] structured memory: ${structured.entities.length} entities, ${structured.durableFacts.length} durable facts, ${structured.topics.length} topics`);

  // Write mid-term topic files (one per topic)
  for (const topic of structured.topics) {
    writeMidTermTopicFile(topic.topic, JSON.stringify(topic, null, 2));
  }

  // Clean expired mid-term topics (>30 days without update)
  cleanExpiredMidTermTopics();
}
