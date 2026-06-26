/**
 * Mio — Frustration / Attachment Tracking
 *
 * Tracks relationship tension and Mio's attachment behavior:
 *   - frustrationStreak: increments when user is cold/dismissive/ghosts-mio-back
 *   - attachmentLevel: derived from warmth + intimacy
 *   - rejectionCount: how many times Mio's messages were ignored (>2h no response)
 *   - Mini-crisis: when frustrationStreak >= 3 AND tension > 50
 */

import type { AttachmentStyle, AffinityState, MultiAxisState } from './types.internal.js';
import type { IntentLabel } from './classifier.js';
import { getAffinity, readAffinityState, writeAffinityState } from './affinity.js';
import { appendBookmark } from './bank.internal.js';
import { logger } from './logger.js';
import {
  getMultiAxis,
  isMultiAxisRelationshipEnabled,
  deriveAttachmentFromMultiAxis,
} from './multi-axis.js';

// ─── In-memory state ───

let state: LocalFrustrationState = {
  frustrationStreak: 0,
  rejectionCount: 0,
  attachmentLevel: 'secure',
  lastWarmAt: null,
  crisisActive: false,
};

interface LocalFrustrationState {
  frustrationStreak: number;
  rejectionCount: number;
  attachmentLevel: AttachmentStyle;
  lastWarmAt: string | null;
  crisisActive: boolean;
}

/**
 * Reset frustration state (for testing / session boundaries).
 */
export function resetFrustrationState(): void {
  state = {
    frustrationStreak: 0,
    rejectionCount: 0,
    attachmentLevel: 'secure',
    lastWarmAt: null,
    crisisActive: false,
  };
}

/**
 * Get current frustration state.
 */
export function getFrustrationState(): LocalFrustrationState {
  return { ...state };
}

// ─── Intent classification for cold/dismissive ───

const COLD_INTENTS: IntentLabel[] = ['angry'];
const WARM_INTENTS: IntentLabel[] = ['affectionate', 'playful', 'excited', 'joking'];
const NEUTRAL_INTENTS: IntentLabel[] = ['casual_chat', 'neutral'];

/**
 * Update frustration state based on the user's intent and exchange outcome.
 *
 * Called after every turn.
 *
 * @param intent       Classified user intent
 * @param wasGhosted   Whether Mio ghosted this turn
 * @param userIgnored  Whether the user ignored Mio's last message (>2h gap, approximated)
 */
export function updateFrustration(
  intent: IntentLabel,
  wasGhosted: boolean,
  userIgnored: boolean = false,
): void {
  // Warm intents → reset frustration, update lastWarmAt
  if (WARM_INTENTS.includes(intent) || intent === 'seeking_comfort') {
    state.frustrationStreak = 0;
    state.lastWarmAt = new Date().toISOString();

    // If crisis was active and user sends warm message, de-escalate
    if (state.crisisActive) {
      state.crisisActive = false;
      appendBookmark({
        time: new Date().toISOString(),
        what: '[tension] crisis de-escalated by warm user interaction',
        evidence: 'user sent a warm/friendly message, tension eased',
      });
    }
  }

  // Cold intents → increment frustration streak
  if (COLD_INTENTS.includes(intent)) {
    state.frustrationStreak++;
  }

  // Mio ghosted → user might feel frustrated (but this is Mio's choice)
  if (wasGhosted) {
    // Ghosting creates a small tension cost
    const affinity = readAffinityState();
    writeAffinityState({
      ...affinity,
      tension: Math.min(100, affinity.tension + 1),
      patience: Math.max(0, affinity.patience - 1),
    });
  }

  // User ignored Mio → increment rejectionCount
  if (userIgnored) {
    state.rejectionCount++;
    // Also increment frustration (user is avoiding Mio)
    state.frustrationStreak = Math.min(10, state.frustrationStreak + 1);
  }

  // Recalculate attachment level
  state.attachmentLevel = deriveAttachmentLevel(getAffinity());

  // Check mini-crisis condition
  checkMiniCrisis(intent);
}

/**
 * Check whether a "mini-crisis" should be triggered.
 *
 * Trigger conditions:
 *   - frustrationStreak >= 3 AND tension > 50
 *   - rejectionCount >= 2 AND frustrationStreak >= 2
 */
function checkMiniCrisis(intent: IntentLabel): void {
  if (state.crisisActive) return; // already in crisis

  const affinity = readAffinityState();
  let shouldTrigger = false;

  if (state.frustrationStreak >= 3 && affinity.tension > 50) {
    shouldTrigger = true;
  }

  if (state.rejectionCount >= 2 && state.frustrationStreak >= 2) {
    shouldTrigger = true;
  }

  if (shouldTrigger) {
    state.crisisActive = true;
    appendBookmark({
      time: new Date().toISOString(),
      what: '[tension] relationship friction building',
      evidence: `frustrationStreak=${state.frustrationStreak}, tension=${affinity.tension}, rejectionCount=${state.rejectionCount}`,
    });
    logger.info('[frustration] mini-crisis triggered');
  }
}

/**
 * Derive the attachment style from affinity or multi-axis state.
 *
 * When multi-axis relationship is enabled, delegates to deriveAttachmentFromMultiAxis.
 *
 * Legacy (AffinityState):
 *   warmth >= 40 && intimacy >= 30 → 'secure'
 *   intimacy >= 20 && warmth < 30  → 'anxious'
 *   warmth >= 30 && intimacy < 15  → 'avoidant'
 *   else                            → 'balanced'
 */
export function deriveAttachmentLevel(affinity: AffinityState): AttachmentStyle {
  // When multi-axis relationship is enabled, use its more nuanced derivation.
  // But fall back to legacy if multi-axis returns 'balanced' (first run / no data)
  // while the legacy affinity model has a clear signal.
  if (isMultiAxisRelationshipEnabled()) {
    try {
      const multiAxis = getMultiAxis();
      const result = deriveAttachmentFromMultiAxis(multiAxis);
      // Only trust multi-axis if it has a clear signal; otherwise
      // fall through to legacy (multi-axis may have default values on first run)
      if (result !== 'balanced') return result;
    } catch {
      // Fall through to legacy
    }
  }

  // Legacy derivation based on affinity warmth/intimacy
  if (affinity.warmth >= 40 && affinity.intimacy >= 30) return 'secure';
  if (affinity.intimacy >= 20 && affinity.warmth < 30) return 'anxious';
  if (affinity.warmth >= 30 && affinity.intimacy < 15) return 'avoidant';
  return 'balanced';
}

/**
 * Get a brief attachment context string for system prompt injection.
 *
 * When attachment is 'anxious', hints that Mio misses the user but doesn't
 * want to show it. When 'avoidant', hints that Mio is keeping distance.
 *
 * When multi-axis relationship is enabled, includes closeness/trust/neediness
 * values alongside the legacy affinity context.
 */
export function getAttachmentContext(): string {
  const f = getFrustrationState();
  const affinity = getAffinity();

  const parts: string[] = [];
  parts.push(`依赖状态: ${attachmentLabel(f.attachmentLevel)}`);

  // Multi-axis context
  if (isMultiAxisRelationshipEnabled()) {
    try {
      const multiAxis = getMultiAxis();
      parts.push(`亲密度 ${multiAxis.closeness}/100，信任 ${multiAxis.trust}/100，依赖度 ${multiAxis.neediness}/100`);
    } catch {
      // Fall through to legacy context
    }
  }

  if (f.attachmentLevel === 'anxious') {
    parts.push('你最近有点想他，但不想表现得太明显');
  }
  if (f.attachmentLevel === 'avoidant') {
    parts.push('你想靠近，但又在保持一点距离');
  }
  if (f.crisisActive) {
    parts.push('你们之间最近有点紧张');
  }

  if (f.frustrationStreak >= 2) {
    parts.push(`他对你的态度有点冷（连续${f.frustrationStreak}次了）`);
  }

  return parts.join('，');
}

function attachmentLabel(style: AttachmentStyle): string {
  const map: Record<AttachmentStyle, string> = {
    secure: '安全',
    anxious: '焦虑',
    avoidant: '回避',
    balanced: '平衡',
  };
  return map[style] || '平衡';
}
