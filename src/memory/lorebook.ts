/**
 * Mio — Lorebook Triggered Memory
 *
 * Inspired by SillyTavern's lorebook system: context fragments that are only
 * injected when triggered by specific keywords or topics, rather than always
 * being present. This saves tokens and keeps the prompt focused.
 *
 * The lorebook is file-backed (data/lorebook.json) and maintains a turn counter
 * for cooldown tracking. Each entry has:
 *  - `triggers`: keywords that activate this entry when found in recent messages
 *  - `content`: the context to inject when triggered
 *  - `priority`: 0-100, higher = more important (used for sorting, not trimming)
 *  - `scanDepth`: how many messages back to scan for triggers (default 5)
 *  - `cooldown`: minimum turns between activations (default 3)
 *  - `permanent`: if true, always inject regardless
 *
 * Auto-generation scans structured-memory.json for high-confidence durable facts
 * (confidence >= 0.8) and creates lore entries from them.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../config.js';
import {
  readFileSyncSafe,
  writeFileSyncSafe,
  readStructuredMemoryFile,
} from './bank.js';
import { deserializeMemory } from './structured-memory.js';
import type { StructuredMemory } from './structured-memory.js';

// ─── Types ───

export interface LoreEntry {
  id: string;
  triggers: string[];
  content: string;
  category: 'memory' | 'fact' | 'preference' | 'rule' | 'note';
  priority: number;
  scanDepth: number;
  cooldown: number;
  lastTriggered: number;
  permanent: boolean;
}

export interface Lorebook {
  entries: LoreEntry[];
  turnCount: number;
}

// ─── Defaults ───

const DEFAULT_SCAN_DEPTH = 5;
const DEFAULT_COOLDOWN = 3;

// ─── Path ───

function lorebookPath(): string {
  return join(getDataDir(), 'lorebook.json');
}

// ─── Seed data ───

const SEED_ENTRIES: Omit<LoreEntry, 'lastTriggered'>[] = [
  {
    id: 'seed-overtime',
    triggers: ['加班', '工作', '加班到很晚', '加班完了'],
    content: '上次他加班到很晚的时候，你说要帮他点外卖。他后来吃了拉面。',
    category: 'memory',
    priority: 50,
    scanDepth: 5,
    cooldown: 3,
    permanent: false,
  },
  {
    id: 'seed-sleep',
    triggers: ['困', '累', '睡', '熬夜', '失眠', '睡不着'],
    content: '他经常熬夜。你每次都会催他早点睡。',
    category: 'fact',
    priority: 60,
    scanDepth: 5,
    cooldown: 3,
    permanent: false,
  },
];

// ─── File I/O ───

function defaultLorebook(): Lorebook {
  return {
    entries: SEED_ENTRIES.map((e) => ({ ...e, lastTriggered: -1 })),
    turnCount: 0,
  };
}

/**
 * Read the lorebook from disk. Returns the default (with seed data) if the
 * file doesn't exist or is corrupt.
 */
let _lorebookCache: Lorebook | null = null;
let _lorebookCacheTime = 0;
const LOREBOOK_CACHE_TTL_MS = 30_000; // 30 seconds

export function getLorebook(): Lorebook {
  if (_lorebookCache && (Date.now() - _lorebookCacheTime) < LOREBOOK_CACHE_TTL_MS) {
    return _lorebookCache;
  }
  const path = lorebookPath();
  const raw = readFileSyncSafe(path);
  if (!raw || raw.trim().length === 0) {
    _lorebookCache = defaultLorebook();
    _lorebookCacheTime = Date.now();
    return _lorebookCache;
  }
  try {
    const parsed = JSON.parse(raw) as Lorebook;
    // Ensure seed entries exist (in case of old files without them)
    const existingIds = new Set(parsed.entries.map((e) => e.id));
    for (const seed of SEED_ENTRIES) {
      if (!existingIds.has(seed.id)) {
        parsed.entries.push({ ...seed, lastTriggered: -1 });
      }
    }
    _lorebookCache = parsed;
    _lorebookCacheTime = Date.now();
    return parsed;
  } catch {
    return defaultLorebook();
  }
}

function persistLorebook(lb: Lorebook): void {
  _lorebookCache = lb;
  _lorebookCacheTime = Date.now();
  writeFileSyncSafe(lorebookPath(), JSON.stringify(lb, null, 2));
}

// ─── CRUD ───

/**
 * Add a new lore entry. Generates a unique ID if not provided.
 */
export function addLoreEntry(
  entry: Omit<LoreEntry, 'lastTriggered'> & { id?: string },
): LoreEntry {
  const lb = getLorebook();
  const full: LoreEntry = {
    ...entry,
    id: entry.id ?? `lore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lastTriggered: -1,
  };
  lb.entries.push(full);
  persistLorebook(lb);
  return full;
}

/**
 * Remove a lore entry by ID. Returns true if found and removed.
 */
export function removeLoreEntry(id: string): boolean {
  const lb = getLorebook();
  const before = lb.entries.length;
  lb.entries = lb.entries.filter((e) => e.id !== id);
  if (lb.entries.length === before) return false;
  persistLorebook(lb);
  return true;
}

/**
 * Update an existing lore entry. Fields in `patch` override the existing values.
 * `lastTriggered` cannot be patched this way — it's managed internally.
 */
export function updateLoreEntry(
  id: string,
  patch: Partial<Omit<LoreEntry, 'id' | 'lastTriggered'>>,
): boolean {
  const lb = getLorebook();
  const entry = lb.entries.find((e) => e.id === id);
  if (!entry) return false;
  Object.assign(entry, patch);
  persistLorebook(lb);
  return true;
}

function normalizedContent(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Remove derived lore entries whose content matches the given memory text. */
export function removeLoreEntriesByContent(content: string): number {
  const target = normalizedContent(content);
  if (!target) return 0;
  const lb = getLorebook();
  const before = lb.entries.length;
  lb.entries = lb.entries.filter((entry) => normalizedContent(entry.content) !== target);
  const removed = before - lb.entries.length;
  if (removed > 0) persistLorebook(lb);
  return removed;
}

/** Update derived lore entries whose content matches the old memory text. */
export function updateLoreEntriesByContent(oldContent: string, newContent: string): number {
  const oldTarget = normalizedContent(oldContent);
  const next = newContent.trim();
  if (!oldTarget || !next) return 0;
  const lb = getLorebook();
  let changed = 0;
  for (const entry of lb.entries) {
    if (normalizedContent(entry.content) !== oldTarget) continue;
    entry.content = next;
    entry.triggers = extractKeywords(next);
    changed++;
  }
  if (changed > 0) persistLorebook(lb);
  return changed;
}

// ─── Trigger evaluation ───

/**
 * Scan a list of message strings for lorebook triggers.
 *
 * Returns entries that have at least one trigger found in the scanned messages,
 * respecting cooldown (enough turns must have passed since lastTriggered).
 * Permanent entries are always included regardless of triggers.
 *
 * Results are sorted by priority descending.
 *
 * This function is **pure** — it reads the lorebook from disk, evaluates,
 * and returns matched entries WITHOUT persisting any state changes.
 * Call `persistLorebookState()` after if you want the cooldowns committed.
 */
export function evaluateLorebook(recentMessages: string[]): LoreEntry[] {
  const lb = getLorebook();
  const matched: LoreEntry[] = [];

  for (const entry of lb.entries) {
    // Permanent entries are always included
    if (entry.permanent) {
      matched.push(entry);
      continue;
    }

    // Cooldown check: skip if activated too recently
    if (
      entry.cooldown > 0 &&
      entry.lastTriggered >= 0 &&
      lb.turnCount - entry.lastTriggered < entry.cooldown
    ) {
      continue;
    }

    // Scan the most recent N messages for triggers
    const scanWindow = recentMessages.slice(-entry.scanDepth);
    const found = scanWindow.some((msg) =>
      entry.triggers.some((trigger) => {
        if (trigger.length === 0) return false;
        return msg.toLowerCase().includes(trigger.toLowerCase());
      }),
    );

    if (found) {
      matched.push(entry);
    }
  }

  // Sort by priority descending
  matched.sort((a, b) => b.priority - a.priority);

  return matched;
}

/**
 * Advance the turn count and update lastTriggered for the given entries.
 * Persists the lorebook to disk.
 *
 * Call this after evaluateLorebook() when you're ready to commit the
 * cooldown state (typically once per turn, not per evaluation).
 */
export function persistLorebookState(matched: LoreEntry[]): void {
  if (matched.length === 0) return;
  const lb = getLorebook();
  lb.turnCount++;
  for (const entry of matched) {
    entry.lastTriggered = lb.turnCount;
  }
  persistLorebook(lb);
}

// ─── Prompt injection ───

/**
 * Evaluate the lorebook against recent messages and format the triggered
 * entries as a prompt context string. Returns null if nothing matched.
 *
 * The output format uses Markdown by default:
 *
 *   ## 触发记忆
 *   - <content> (category)
 *   - <content> (category)
 *
 * This function is **pure** — it does NOT commit cooldown state to disk.
 * Call `commitLorebookState()` separately (once per turn) to persist.
 */
export function getLorebookContext(recentMessages: string[]): string | null {
  if (!recentMessages || recentMessages.length === 0) return null;

  const matched = evaluateLorebook(recentMessages);
  if (matched.length === 0) return null;

  const lines: string[] = ['## 触发记忆'];
  for (const entry of matched) {
    lines.push(`- ${entry.content} (${entry.category})`);
  }

  return lines.join('\n');
}

/**
 * Commit the current turn's lorebook state to disk.
 *
 * Call this exactly once per turn — after the system prompt has been built
 * using `getLorebookContext()`, to advance the turn counter and update
 * cooldowns for all triggered entries.
 */
export function commitLorebookState(recentMessages: string[]): void {
  if (!recentMessages || recentMessages.length === 0) return;
  const matched = evaluateLorebook(recentMessages);
  if (matched.length === 0) return;
  persistLorebookState(matched);
}

// ─── Auto-generation ───

/**
 * Extract meaningful keywords from a fact content string.
 * Splits on common delimiters and filters out short/stop words.
 */
function extractKeywords(content: string): string[] {
  // First, try to extract meaningful phrases using Chinese/word boundaries
  const raw = content
    .replace(/[，。！？、；：""''（）【】《》\-\s]+/g, ' ')
    .trim();

  // Split into candidate tokens
  const candidates = raw.split(/\s+/).filter((t) => t.length >= 1);

  // Generate trigrams/2-grams from Chinese text (since there's no word segmenter)
  const grams: string[] = [];
  for (const token of candidates) {
    // For long Chinese tokens, generate sliding bigrams
    if (/[一-鿿]/.test(token) && token.length >= 4) {
      for (let i = 0; i <= token.length - 2; i++) {
        grams.push(token.slice(i, i + 2));
      }
    } else if (token.length >= 2) {
      grams.push(token);
    }
  }

  // Remove duplicates and short tokens
  const seen = new Set<string>();
  const result: string[] = [];
  for (const g of grams) {
    if (g.length >= 2 && !seen.has(g)) {
      seen.add(g);
      result.push(g);
    }
  }

  // Limit to a reasonable number of triggers per entry
  return result.slice(0, 8);
}

/**
 * Auto-generate lore entries from high-confidence durable facts in
 * structured-memory.json. For each durable fact (confidence >= 0.8),
 * creates a lore entry with keywords extracted from the content as triggers.
 *
 * This is idempotent — it checks for existing entries with matching content
 * before creating new ones, so calling it multiple times won't duplicate.
 */
export function autoGenerateLoreEntries(): void {
  const lb = getLorebook();

  // Read structured memory
  const raw = readStructuredMemoryFile();
  if (!raw || raw.trim().length === 0) return;

  let memory: StructuredMemory;
  try {
    memory = deserializeMemory(raw);
  } catch {
    return;
  }

  if (!memory.durableFacts || memory.durableFacts.length === 0) return;

  // Build a set of existing entry contents for dedup
  const existingContents = new Set(lb.entries.map((e) => e.content.trim()));

  let changed = false;

  for (const fact of memory.durableFacts) {
    // Skip entries whose content is already in the lorebook
    const content = fact.content.trim();
    if (existingContents.has(content)) continue;

    // Only generate for facts with sufficient confidence
    if (fact.confidence < 0.8) continue;

    const triggers = extractKeywords(content);
    if (triggers.length === 0) continue;

    // Map entity type to category
    const categoryMap: Record<string, 'fact' | 'preference' | 'memory' | 'note'> = {
      fact: 'fact',
      preference: 'preference',
      event: 'memory',
      decision: 'fact',
      intention: 'note',
      emotion: 'memory',
    };

    lb.entries.push({
      id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      triggers,
      content,
      category: categoryMap[fact.type] ?? 'note',
      priority: Math.round(fact.confidence * 70),
      scanDepth: DEFAULT_SCAN_DEPTH,
      cooldown: DEFAULT_COOLDOWN,
      lastTriggered: -1,
      permanent: false,
    });

    existingContents.add(content);
    changed = true;
  }

  if (changed) {
    persistLorebook(lb);
  }
}
