/**
 * Mio — Multi-axis Affinity System
 *
 * Replaces the single `affection: number` with a multi-dimensional model:
 *   warmth, trust, intimacy, patience, tension
 *
 * Each axis decays toward baseline over WALL-CLOCK time (not per interaction):
 * frequent chatting keeps the relationship warm; long silence lets it drift
 * back to baseline. Decay is exponential per hour (like PAD).
 *
 * Persisted at `data/affinity-state.json`.
 */

import { readFileSync, existsSync } from 'node:fs';
import type { AffinityState } from '../types.js';
import { clamp } from '../utils/math.js';
import type { IntentLabel } from './classifier.js';
import { affinityStatePath } from '../memory/paths.js';
import { writeFileSyncSafe } from '../memory/bank.js';

// ─── Constants ───

/**
 * Decay rate per HOUR toward baseline (e.g. 0.05 → ~5%/hour).
 * Time-based: frequent chatting barely decays; long silence drifts back.
 * (Previously decayed once per interaction, which penalized high-frequency
 *  chatting — the opposite of intended.)
 */
const DECAY_RATE_PER_HOUR = 0.05;
/** Cap elapsed hours so a very long gap doesn't over-decay beyond baseline. */
const MAX_DECAY_HOURS = 168; // 7 days

/** Baseline values each axis gravitates toward over time. */
const BASELINES: Record<keyof Omit<AffinityState, 'updatedAt'>, number> = {
  warmth: 20,
  trust: 15,
  intimacy: 5,
  patience: 80,
  tension: 5,
};

/** Intent → axis deltas. Positive = increase, negative = decrease. */
const INTENT_DELTAS: Record<IntentLabel, Partial<Record<keyof Omit<AffinityState, 'updatedAt'>, number>>> = {
  affectionate: { warmth: 8, intimacy: 6 },
  seeking_comfort: { trust: 6, intimacy: 4 },
  venting: { trust: 4, tension: 3 },
  casual_chat: { warmth: 2 },
  joking: { warmth: 5 },
  sad: { trust: 3, intimacy: 3 },
  excited: { warmth: 5 },
  angry: { patience: -8, tension: 6 },
  anxious: { trust: 3, tension: 2 },
  playful: { warmth: 4, intimacy: 2 },
  tired: { warmth: 1 },
  neutral: { warmth: 1 },
};

/** Additional deltas when Mio ghosts the user. */
const GHOST_DELTAS: Partial<Record<keyof Omit<AffinityState, 'updatedAt'>, number>> = {
  warmth: -2,
  trust: -1,
  tension: 2,
  patience: 0,
  intimacy: -1,
};

// ─── Default state ───

export function defaultAffinityState(): AffinityState {
  return {
    warmth: 20,
    trust: 15,
    intimacy: 5,
    patience: 80,
    tension: 5,
    updatedAt: new Date().toISOString(),
  };
}

// ─── I/O ───

export function readAffinityState(): AffinityState {
  const path = affinityStatePath();
  try {
    if (!existsSync(path)) return defaultAffinityState();
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AffinityState>;
    return { ...defaultAffinityState(), ...parsed };
  } catch {
    return defaultAffinityState();
  }
}

export function writeAffinityState(state: AffinityState): void {
  const path = affinityStatePath();
  writeFileSyncSafe(path, JSON.stringify(state, null, 2));
}

// ─── Core logic ───

/**
 * Apply time-based exponential decay toward baseline for all axes.
 * Factor = exp(-rate * hoursElapsed): near 0 elapsed → no decay (frequent
 * chatting stays warm); many hours → drifts back toward baseline.
 */
function decay(state: AffinityState, hoursElapsed: number): AffinityState {
  const factor = Math.exp(-DECAY_RATE_PER_HOUR * hoursElapsed);
  return {
    warmth: clamp(BASELINES.warmth + (state.warmth - BASELINES.warmth) * factor, 0, 100),
    trust: clamp(BASELINES.trust + (state.trust - BASELINES.trust) * factor, 0, 100),
    intimacy: clamp(BASELINES.intimacy + (state.intimacy - BASELINES.intimacy) * factor, 0, 100),
    patience: clamp(BASELINES.patience + (state.patience - BASELINES.patience) * factor, 0, 100),
    tension: clamp(BASELINES.tension + (state.tension - BASELINES.tension) * factor, 0, 100),
    updatedAt: state.updatedAt,
  };
}

/** Compute real elapsed hours since the last update (0 on parse failure / first run). */
function elapsedHours(updatedAt: string | undefined): number {
  if (!updatedAt) return 0;
  const prev = Date.parse(updatedAt);
  if (!Number.isFinite(prev)) return 0;
  return Math.min(Math.max((Date.now() - prev) / (1000 * 60 * 60), 0), MAX_DECAY_HOURS);
}

function applyDelta(
  state: AffinityState,
  delta: Partial<Record<keyof Omit<AffinityState, 'updatedAt'>, number>>,
): AffinityState {
  return {
    warmth: clamp(state.warmth + (delta.warmth ?? 0), 0, 100),
    trust: clamp(state.trust + (delta.trust ?? 0), 0, 100),
    intimacy: clamp(state.intimacy + (delta.intimacy ?? 0), 0, 100),
    patience: clamp(state.patience + (delta.patience ?? 0), 0, 100),
    tension: clamp(state.tension + (delta.tension ?? 0), 0, 100),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Update affinity state based on the classified user intent and optional ghost flag.
 *
 * Steps:
 *  1. Apply time-based decay (axes drift toward baseline by wall-clock elapsed;
 *     frequent chatting keeps them warm, long silence lets them settle)
 *  2. Apply intent-based deltas
 *  3. Apply ghost penalty if applicable
 *  4. Persist and return the new state
 */
export function updateAffinity(
  intent: IntentLabel,
  isGhosted: boolean = false,
): AffinityState {
  const current = readAffinityState();

  // 1. Decay toward baseline (by real elapsed time, not per-interaction)
  let next = decay(current, elapsedHours(current.updatedAt));

  // 2. Apply intent deltas
  const deltas = INTENT_DELTAS[intent];
  if (deltas) {
    next = applyDelta(next, deltas);
  }

  // 3. Ghost penalty
  if (isGhosted) {
    next = applyDelta(next, GHOST_DELTAS);
  }

  // 4. Update timestamp
  next.updatedAt = new Date().toISOString();

  writeAffinityState(next);
  return next;
}

/**
 * Get the current affinity state (read from disk).
 */
export function getAffinity(): AffinityState {
  return readAffinityState();
}

/**
 * Get a brief Chinese context string for system prompt injection.
 * Example: "亲密度状态: 温暖 45, 信任 30, 亲密 20, 耐心 70, 张力 15"
 */
export function getAffinityContext(): string {
  const a = readAffinityState();
  return `亲密度状态: 温暖 ${a.warmth}, 信任 ${a.trust}, 亲密 ${a.intimacy}, 耐心 ${a.patience}, 张力 ${a.tension}`;
}
