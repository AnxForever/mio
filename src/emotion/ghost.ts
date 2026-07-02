/**
 * Mio — Ghost Silence Mechanism
 *
 * Mio sometimes should NOT reply — mimicking "read but not reply" human behavior.
 * This is NOT random — it's driven by context:
 *
 *   - Very short user messages ("嗯", "哦", "好吧") in an active conversation
 *   - User signaling conversation end ("睡了", "去忙了", "先这样")
 *   - Mio's energy is low AND warmth is moderate (tired, not distressed)
 *   - Never ghost twice in a row
 *
 * When ghosting: append a bookmark "[ghost] chose silence" but don't generate a response.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { SessionContext } from '../types.js';
import { readEmotionState } from './state.js';
import { getAffinity } from './affinity.js';
import { appendBookmark, writeFileSyncSafe } from '../memory/bank.js';
import { ghostStatePath } from '../memory/paths.js';
import { readRelationshipState } from '../relationship/progression.js';
import { logger } from '../utils/logger.js';

// ─── Ghost state (in-memory, mirrored to ghost-state.json) ───
// Both flags shape the NEXT turn (double-ghost guard, goodnight follow-up
// silence) — a server restart mid-sequence would otherwise break them.

let lastTurnGhosted = false;
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const path = ghostStatePath();
    if (!existsSync(path)) return;
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      lastTurnGhosted?: boolean;
      willGhostNextTurn?: boolean;
    };
    lastTurnGhosted = parsed.lastTurnGhosted ?? false;
    willGhostNextTurn = parsed.willGhostNextTurn ?? false;
  } catch {
    // Corrupted state file → defaults; never break the turn.
  }
}

function persist(): void {
  try {
    writeFileSyncSafe(ghostStatePath(), JSON.stringify({ lastTurnGhosted, willGhostNextTurn }, null, 2));
  } catch {
    // Best-effort — persistence must never break the turn.
  }
}

/**
 * Drop the in-memory cache and re-read from disk.
 * Equivalent to what a process restart does (used by tests).
 */
export function reloadGhostStateFromDisk(): void {
  loaded = false;
  ensureLoaded();
}

/**
 * Reset the ghost state (called between sessions / for testing).
 * Clears both flags, including a pending goodnight follow-up silence.
 */
export function resetGhostState(): void {
  lastTurnGhosted = false;
  willGhostNextTurn = false;
  loaded = true;
  persist();
}

/**
 * Mark the current turn as ghosted.
 */
function markGhosted(): void {
  lastTurnGhosted = true;
  persist();
}

/**
 * Mark the current turn as NOT ghosted (resets for next check).
 */
export function markReplied(): void {
  ensureLoaded();
  lastTurnGhosted = false;
  persist();
}

// ─── Pattern definitions ───

const SHORT_REPLY_PATTERNS = [
  /^嗯$/,
  /^哦$/,
  /^好吧$/,
  /^好哒$/,
  /^好的$/,
  /^嗯嗯$/,
  /^行$/,
  /^知道了$/,
  /^ok$/i,
  /^嗯呢$/,
  /^哦哦$/,
  /^好趴$/,
  /^行叭$/,
  /^欧了$/,
  /^收到$/,
];

const CONVERSATION_END_PATTERNS = [
  /睡了/,
  /去忙了/,
  /先这样/,
  /不说了/,
  /下次聊/,
  /拜拜/,
  /晚安/,
  /我先.*了$/,
  /挂[了]?$/,
];

// ─── Main decision function ───

/**
 * Determine whether Mio should ghost (not reply) this turn.
 *
 * Returns `true` when Mio should stay silent. Side effect: when ghosting,
 * appends a bookmark and updates the internal `lastTurnGhosted` flag.
 *
 * Never ghosts if:
 *   - The previous turn was already ghosted (avoid double ghost)
 *   - Fewer than 10 interactions (cold start / testing)
 *   - Patience <= 20 (already frustrated)
 *   - Tension >= 70 (already building friction)
 *
 * Ghosts when:
 *   1. Very short message ("嗯", "哦") + conversation was active <5 min ago
 *      + warmth is moderate (15-70)
 *   2. User signals conversation end → reply briefly this turn, ghost next
 *      (returns false for current turn, sets internal flag)
 *   3. Mio's energy is low + warmth is moderate (15-60) — probabilistic (15%)
 */
export function shouldGhost(
  userMessage: string,
  ctx: SessionContext,
): boolean {
  ensureLoaded();

  // IM bridges feel broken when the bot sends an empty reply. Keep ghosting
  // available for first-party/web sessions, but never silently drop WeChat/QQ
  // bridge turns where the user expects contact-like messaging.
  if (isImBridgeSession(ctx.sessionId)) {
    return false;
  }

  // ─── Guard: never ghost twice in a row ───
  if (lastTurnGhosted) {
    return false;
  }

  // ─── Guard: not enough history to justify silence ───
  const rel = readRelationshipState();
  if (rel.interactionCount < 10) {
    return false;
  }

  const affinity = getAffinity();

  // ─── Guard: already at emotional extremes ───
  if (affinity.patience <= 20) return false;
  if (affinity.tension >= 70) return false;

  const text = userMessage.trim();

  // ─── Condition 1: Very short reply ("嗯", "哦") in active conversation ───
  if (text.length <= 4) {
    const lastInteraction = ctx.emotionState.lastInteraction;
    if (lastInteraction) {
      const elapsed = Date.now() - new Date(lastInteraction).getTime();
      if (elapsed < 5 * 60 * 1000) {
        const isShortReply = SHORT_REPLY_PATTERNS.some((p) => p.test(text));
        if (isShortReply && affinity.warmth >= 15 && affinity.warmth <= 70) {
          doGhost('user sent short reply in active conversation');
          return true;
        }
      }
    }
  }

  // ─── Condition 2: User signals conversation end ───
  // When detected, Mio replies briefly this turn and sets a flag so the
  // NEXT call to shouldGhost() will ghost instead.
  const isEndingNow = CONVERSATION_END_PATTERNS.some((p) => p.test(text));
  if (isEndingNow) {
    // Don't ghost this turn — reply briefly.
    // Set flag so next turn will ghost if appropriate.
    markWillGhostNext();
    return false;
  }

  // ─── Condition 3: Previous turn ended conversation — ghost now ───
  if (consumeWillGhostNext()) {
    return true;
  }

  // ─── Condition 4: Mio is tired + moderate closeness ───
  const emotion = readEmotionState();
  if (emotion.energy === 'low' && affinity.warmth >= 15 && affinity.warmth <= 60) {
    // 15% chance — feels natural, not mechanical
    if (Math.random() < 0.15) {
      logger.info('[ghost] energy low, choosing silence');
      doGhost('energy low, choosing silence');
      return true;
    }
  }

  return false;
}

function isImBridgeSession(sessionId: string | undefined): boolean {
  return Boolean(
    sessionId?.startsWith('openai-') ||
    sessionId?.startsWith('onebot-'),
  );
}

/**
 * Check if the user message signals conversation end.
 * Exported for the agent-loop to use after reply.
 */
export function isEndingConversation(text: string): boolean {
  return CONVERSATION_END_PATTERNS.some((p) => p.test(text));
}

// ─── Internal: ghost next turn flag ───

/**
 * When true, the next call to shouldGhost() should ghost because the user
 * signaled conversation end on the previous turn.
 */
let willGhostNextTurn = false;

function markWillGhostNext(): void {
  willGhostNextTurn = true;
  persist();
}

/**
 * Consume the "ghost next turn" flag. Returns true if the previous turn
 * ended the conversation and the current turn should be ghosted.
 *
 * Called from within shouldGhost() when no other condition matches, so
 * that ending conversations get a natural follow-up silence.
 */
function consumeWillGhostNext(): boolean {
  if (willGhostNextTurn) {
    willGhostNextTurn = false;
    doGhost('user ended conversation last turn');
    return true;
  }
  return false;
}

/**
 * Execute ghost side effects.
 */
function doGhost(reason: string): void {
  markGhosted();
  appendBookmark({
    time: new Date().toISOString(),
    what: `[ghost] chose silence — ${reason}`,
    evidence: 'Mio decided not to reply this turn.',
  });
}
