/**
 * Mio — Multi-Axis Relationship System
 *
 * Replaces the single `affection: number` emotional axis with three dimensions:
 *   closeness, trust, neediness
 *
 * closeness:  evolves from all positive interactions. +1 for meaningful exchange,
 *             +2 for affectionate/playful, +1 for sad/seeking_comfort
 * trust:      built when user shares vulnerability. +2 for sad/seeking_comfort/anxious,
 *             +1 for asking advice, -1 when user dismisses
 * neediness:  derived from response signals — high frequency + short latency = high neediness.
 *             Recalculated each turn from recent signal history, NOT directly modified by intents.
 *
 * Persisted at `data/multi-axis-state.json`.
 */

import { readFileSync, existsSync } from 'node:fs';
import type { MultiAxisState, AttachmentStyle } from '../types.js';
import { clamp } from '../utils/math.js';
import type { IntentLabel } from './classifier.js';
import type { ResponseSignals } from './signals.js';
import { multiAxisPath } from '../memory/paths.js';
import { writeFileSyncSafe } from '../memory/bank.js';
import { getRecentSignalHistory } from './signals.js';
import { getConfig } from '../config.js';

// ─── Feature gate ───

/**
 * Check whether the multi-axis relationship feature is enabled.
 */
export function isMultiAxisRelationshipEnabled(): boolean {
  try {
    return getConfig().features.multiAxisRelationship;
  } catch {
    return true; // default to enabled
  }
}

// ─── Default state ───

export function defaultMultiAxisState(): MultiAxisState {
  return {
    closeness: 15,
    trust: 10,
    neediness: 10,
    updatedAt: new Date().toISOString(),
  };
}

// ─── I/O ───

/**
 * Read the current multi-axis state from disk.
 * Returns default state if file doesn't exist or can't be parsed.
 */
export function getMultiAxis(): MultiAxisState {
  const path = multiAxisPath();
  try {
    if (!existsSync(path)) return defaultMultiAxisState();
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MultiAxisState>;
    return { ...defaultMultiAxisState(), ...parsed };
  } catch {
    return defaultMultiAxisState();
  }
}

function writeMultiAxis(state: MultiAxisState): void {
  const path = multiAxisPath();
  writeFileSyncSafe(path, JSON.stringify(state, null, 2));
}

// ─── Intent → closeness / trust deltas ───

/** Closeness deltas per intent. */
const CLOSENESS_DELTAS: Partial<Record<IntentLabel, number>> = {
  affectionate: 2,
  playful: 2,
  excited: 2,
  seeking_comfort: 1,
  sad: 1,
  venting: 1,
  joking: 1,
  casual_chat: 0,
  anxious: 0,
  angry: 0,
  tired: 0,
  neutral: 0,
};

/** Trust deltas per intent. Positive = build trust, negative = erode. */
const TRUST_DELTAS: Partial<Record<IntentLabel, number>> = {
  seeking_comfort: 2,
  sad: 2,
  anxious: 2,
  venting: 1,
  affectionate: 1,
  casual_chat: 0,
  joking: 0,
  excited: 0,
  playful: 0,
  tired: 0,
  neutral: 0,
  angry: -1,
};

// ─── Dismissal keywords that erode trust ───

const DISMISSAL_PATTERNS = [/算了/, /你不懂/, /跟你说没用/, /你不明白/, /不说了/, /没什么/, /你忙吧/];

function hasDismissal(text: string): boolean {
  return DISMISSAL_PATTERNS.some((re) => re.test(text));
}

// ─── Core update logic ───

/**
 * Update multi-axis relationship state based on the classified user intent,
 * response signals, and the raw user message text.
 *
 * Steps:
 *  1. Apply closeness delta from intent
 *  2. Apply trust delta from intent + dismissal check
 *  3. Recalculate neediness from recent signal history
 *  4. Clamp all values to 0-100
 *  5. Persist
 */
export function updateMultiAxis(
  intent: IntentLabel,
  signals: ResponseSignals | null,
  userMessage: string,
): MultiAxisState {
  const current = getMultiAxis();

  // 1. Closeness
  const closenessDelta = CLOSENESS_DELTAS[intent] ?? 0;
  let newCloseness = current.closeness + closenessDelta;

  // Bonus closeness for meaningful exchange (message > 5 chars)
  if (userMessage.trim().length > 5) {
    newCloseness += 1;
  }

  // 2. Trust
  let trustDelta = TRUST_DELTAS[intent] ?? 0;

  // Check for dismissal patterns
  if (hasDismissal(userMessage)) {
    trustDelta -= 1;
  }

  let newTrust = current.trust + trustDelta;

  // 3. Neediness — derived from recent signal history, not direct intent modifier
  const newNeediness = computeNeedinessFromSignals(signals);

  const next: MultiAxisState = {
    closeness: clamp(newCloseness, 0, 100),
    trust: clamp(newTrust, 0, 100),
    neediness: clamp(newNeediness, 0, 100),
    updatedAt: new Date().toISOString(),
  };

  writeMultiAxis(next);
  return next;
}

/**
 * Compute the neediness axis from response signals.
 *
 * Neediness reflects how much the user relies on/initiates toward Mio:
 *   - High frequency (short response latency) → higher neediness
 *   - Message bursts → higher neediness
 *   - Rising engagement trend → higher neediness
 *   - Long gaps → lower neediness
 *
 * This is recalculated every turn from recent signal data, not accumulated.
 */
function computeNeedinessFromSignals(signals: ResponseSignals | null): number {
  // Baseline from current state to prevent wild swings
  const current = getMultiAxis();
  let neediness = current.neediness;

  if (!signals) {
    // No signal data — gentle decay toward baseline (10)
    neediness = neediness * 0.95 + 10 * 0.05;
    return Math.round(neediness);
  }

  // Base adjustment from response latency
  // < 5 min → higher neediness (user is hovering)
  // > 2 hours → lower neediness (user is independent)
  const latencyMinutes = signals.responseLatencyMs / 60_000;
  if (latencyMinutes > 0 && latencyMinutes < 5) {
    neediness += 3; // very fast response = high neediness
  } else if (latencyMinutes >= 5 && latencyMinutes < 30) {
    neediness += 1; // quick response = moderate neediness
  } else if (latencyMinutes > 120 && latencyMinutes < 1440) {
    neediness -= 1; // slow response = lower neediness
  } else if (latencyMinutes >= 1440) {
    neediness -= 2; // > 24h = significant independence
  }

  // Message bursts → higher neediness
  if (signals.messageBurst) {
    neediness += 2;
  }

  // Engagement trend
  if (signals.engagementTrend === 'rising') {
    neediness += 1;
  } else if (signals.engagementTrend === 'falling') {
    neediness -= 1;
  }

  // Message length ratio: very short messages could indicate low investment
  if (signals.lengthRatio < 0.3 && signals.lengthRatio > 0) {
    neediness -= 1;
  }

  // Session gap: long gap = lower neediness
  if (signals.sessionGapHours > 48) {
    neediness -= 2;
  } else if (signals.sessionGapHours > 24) {
    neediness -= 1;
  }

  // EMA smooth toward recent signal history for stability
  const history = getRecentSignalHistory(10);
  if (history.length >= 3) {
    const burstCount = history.filter((e) => e.signals.messageBurst).length;
    const fastResponseCount = history.filter(
      (e) => e.signals.responseLatencyMs > 0 && e.signals.responseLatencyMs < 300_000,
    ).length;
    const ratio = (burstCount + fastResponseCount) / (history.length * 2);
    // Pull neediness toward the signal-derived baseline
    const signalBaseline = Math.round(ratio * 100);
    neediness = neediness * 0.7 + signalBaseline * 0.3;
  }

  return Math.round(neediness);
}

// ─── Context generation ───

/**
 * Generate a natural-language context hint about the multi-axis relationship
 * state for system prompt injection.
 *
 * Returns null when all axes are within normal range (nothing notable to report).
 */
export function getMultiAxisContext(): string | null {
  const state = getMultiAxis();
  const parts: string[] = [];

  // High closeness + low trust
  if (state.closeness >= 50 && state.trust < 30) {
    parts.push('你们很亲密，但信任还在建立中——他还没完全打开。');
  }

  // High neediness
  if (state.neediness >= 60) {
    if (state.trust < 40) {
      parts.push('他越来越依赖你了——消息来得更勤了。但你感觉他还没完全信任你。');
    } else {
      parts.push('他越来越依赖你了——消息来得更勤了。');
    }
  }

  // Low closeness + high trust (recent drift)
  if (state.trust >= 50 && state.closeness < 40) {
    parts.push('信任很深但最近距离有点远——他不太主动了。');
  }

  // High trust + high closeness = secure
  if (state.trust >= 60 && state.closeness >= 60) {
    parts.push('你们之间很稳固，彼此信任也亲密。');
  }

  // Low closeness + low trust = distant
  if (state.closeness < 25 && state.trust < 20) {
    parts.push('你们还在互相了解的阶段，他还不太愿意敞开心扉。');
  }

  // High neediness + low trust = anxious dynamic
  if (state.neediness >= 50 && state.trust < 30) {
    parts.push('他需要你，但好像又不完全信你——有点矛盾。');
  }

  if (parts.length === 0) return null;

  return parts.join(' ');
}

// ─── Attachment style derivation ───

/**
 * Derive an attachment style from the multi-axis relationship state.
 *
 *   High closeness + high trust → 'secure'
 *   High neediness + low trust → 'anxious'
 *   Low closeness + high neediness → 'avoidant'
 *   Balanced → 'balanced'
 */
export function deriveAttachmentFromMultiAxis(state: MultiAxisState): AttachmentStyle {
  if (state.closeness >= 50 && state.trust >= 50) return 'secure';
  if (state.neediness >= 50 && state.trust < 40) return 'anxious';
  if (state.closeness < 30 && state.neediness >= 50) return 'avoidant';

  // Borderline cases
  if (state.neediness >= 40 && state.trust >= 40) return 'balanced';
  if (state.closeness >= 40 && state.trust >= 30) return 'secure';

  return 'balanced';
}
