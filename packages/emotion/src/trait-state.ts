/**
 * Mio — Trait-State Separation Module
 *
 * Decouples emotional modeling into three timescales:
 *
 *   Trait Layer (slow: days-weeks):     OCEAN baseline — changes via nightly micro-shifts
 *   State Layer (fast: per-turn):       PAD 3D — changes every message
 *   Mood Layer (medium: per-session):   fusion = trait * 0.3 + state_rolling_avg * 0.7
 *
 * This is an ADDITIONAL layer on top of the existing PAD model. It does NOT
 * replace PAD; it wraps it with personality-aware blending for natural-language
 * mood output and system-prompt context.
 *
 * Key ideas:
 *   - Trait values are OCEAN personality scores that shift slowly (0.01-0.03
 *     per nightly consolidation pass). They are NOT updated per-turn.
 *   - The rolling average smooths per-turn PAD noise into a session-level signal.
 *   - computeMood() blends both to produce a single mood/energy label.
 *   - getTraitStateContext() produces a Chinese natural-language line like:
 *     "你是个外向温暖的人——这是你的底色。今天虽然有点低落，但底色还在。"
 *
 * There is NO circular dependency: pad.ts does NOT import trait-state.ts.
 * This file imports from pad.ts freely.
 */

import { readPADConfig, writePADConfig, getPADState, padToMood, type PADState, type PADConfig } from './pad.js';

// ─── Constants ───────────────────────────────────────────────────────────

/** Number of recent PAD snapshots to keep for the rolling average. */
const ROLLING_WINDOW_SIZE = 20;

/** Trait weight in the mood fusion formula. */
const TRAIT_WEIGHT = 0.3;

/** State rolling-average weight in the mood fusion formula. */
const STATE_WEIGHT = 0.7;

/** How much neuroticism can lower the effective pleasure floor (absolute value). */
const NEUROTICISM_PLEASURE_FLOOR_PENALTY = 0.25;

/** How much neuroticism amplifies PAD deltas during fusion (multiplier added on top of 1.0). */
const NEUROTICISM_DELTA_AMPLIFIER = 0.15;

/** How much extraversion or agreeableness raises the pleasure floor. */
const WARMTH_PLEASURE_FLOOR_BOOST = 0.1;

// ─── In-memory rolling window ───────────────────────────────────────────

/**
 * Ring buffer of recent PAD states for the rolling average.
 * Not persisted to disk — resets on process restart (acceptable because
 * the rolling window only needs the current session's data).
 */
const stateHistory: PADState[] = [];

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Get the current OCEAN trait values from PADConfig.
 *
 * These are the slow-moving personality baselines. They change only via
 * nightly consolidation micro-shifts (0.01-0.03 per adjustment).
 */
export function getTraitState(): PADConfig['personality'] {
  const cfg = readPADConfig();
  return {
    openness: cfg.personality.openness,
    conscientiousness: cfg.personality.conscientiousness,
    extraversion: cfg.personality.extraversion,
    agreeableness: cfg.personality.agreeableness,
    neuroticism: cfg.personality.neuroticism,
  };
}

/**
 * Apply tiny deltas to OCEAN trait values (called from nightly consolidation).
 *
 * Each delta should be in the range [-0.03, 0.03] — trait drift is intentionally
 * slow. Values are clamped to [0, 1].
 *
 * @param deltas  Partial set of OCEAN trait deltas to apply.
 */
export function updateTraitState(deltas: Partial<PADConfig['personality']>): void {
  const current = readPADConfig();
  const nextPersonality: PADConfig['personality'] = {
    openness: clamp01(current.personality.openness + (deltas.openness ?? 0)),
    conscientiousness: clamp01(current.personality.conscientiousness + (deltas.conscientiousness ?? 0)),
    extraversion: clamp01(current.personality.extraversion + (deltas.extraversion ?? 0)),
    agreeableness: clamp01(current.personality.agreeableness + (deltas.agreeableness ?? 0)),
    neuroticism: clamp01(current.personality.neuroticism + (deltas.neuroticism ?? 0)),
  };
  writePADConfig({ personality: nextPersonality });
}

/**
 * Record the current PAD state into the rolling history buffer.
 *
 * Call this once per turn (from emotion/tracker.ts after the PAD update).
 * Keeps at most ROLLING_WINDOW_SIZE entries.
 */
export function recordPADState(pad: PADState): void {
  stateHistory.push({ ...pad });
  while (stateHistory.length > ROLLING_WINDOW_SIZE) {
    stateHistory.shift();
  }
}

/**
 * Compute the average PAD over the last N recorded turns.
 *
 * Returns a simple average of pleasure/arousal/dominance across all stored
 * states. If the buffer is empty, returns the current PAD state.
 */
export function getStateRollingAvg(): PADState {
  if (stateHistory.length === 0) {
    return getPADState();
  }

  const n = stateHistory.length;
  let sumP = 0;
  let sumA = 0;
  let sumD = 0;

  for (const s of stateHistory) {
    sumP += s.pleasure;
    sumA += s.arousal;
    sumD += s.dominance;
  }

  return {
    pleasure: clamp(sumP / n, -1, 1),
    arousal: clamp(sumA / n, -1, 1),
    dominance: clamp(sumD / n, -1, 1),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Clear the rolling state history (e.g., on session end or mode switch).
 */
export function clearStateHistory(): void {
  stateHistory.length = 0;
}

/**
 * Compute the fused mood/energy from trait + state rolling average.
 *
 * Formula:
 *   fusedP = traitAdjustedBaselineP * TRAIT_WEIGHT + rollingAvg.pleasure * STATE_WEIGHT
 *   fusedA = traitAdjustedBaselineA * TRAIT_WEIGHT + rollingAvg.arousal * STATE_WEIGHT
 *   fusedD = traitAdjustedBaselineD * TRAIT_WEIGHT + rollingAvg.dominance * STATE_WEIGHT
 *
 * Trait-adjusted baselines incorporate personality modifiers:
 *   - extraversion raises baseline pleasure and arousal
 *   - agreeableness raises baseline pleasure
 *   - neuroticism lowers baseline pleasure and reduces the pleasure floor
 *   - high neuroticism amplifies responsiveness (wider mood swings)
 *   - high extraversion/agreeableness provide a "warm floor" that dampens negative dips
 *
 * Returns mood/energy labels matching the existing padToMood() interface.
 */
export function computeMood(): { myMood: string; energy: 'high' | 'mid' | 'low' } {
  const traits = getTraitState();
  const rollingAvg = getStateRollingAvg();
  const cfg = readPADConfig();

  // ── Trait-adjusted baseline ──
  const eBonusP = traits.extraversion * 0.2;
  const eBonusA = traits.extraversion * 0.15;
  const aBonusP = traits.agreeableness * 0.15;
  const nPenaltyP = traits.neuroticism * 0.15;

  const traitBaselineP = cfg.baseline.pleasure + eBonusP + aBonusP - nPenaltyP;
  const traitBaselineA = cfg.baseline.arousal + eBonusA;
  const traitBaselineD = cfg.baseline.dominance;

  // ── Warm floor: high extraversion/agreeableness raise the minimum pleasure ──
  const warmFloor = -(NEUROTICISM_PLEASURE_FLOOR_PENALTY * (1 - traits.agreeableness))
    + WARMTH_PLEASURE_FLOOR_BOOST * traits.extraversion
    + WARMTH_PLEASURE_FLOOR_BOOST * traits.agreeableness;

  // ── Neuroticism amplifies mood responsiveness ──
  const neuroticAmplifier = 1.0 + traits.neuroticism * NEUROTICISM_DELTA_AMPLIFIER;

  // ── Fuse trait + state ──
  let fusedP = traitBaselineP * TRAIT_WEIGHT + rollingAvg.pleasure * STATE_WEIGHT;
  let fusedA = traitBaselineA * TRAIT_WEIGHT + rollingAvg.arousal * STATE_WEIGHT;
  let fusedD = traitBaselineD * TRAIT_WEIGHT + rollingAvg.dominance * STATE_WEIGHT;

  // ── Apply warm floor (pleasure never goes below the floor) ──
  fusedP = Math.max(fusedP, warmFloor);

  // ── Apply neuroticism amplification (wider swings from baseline) ──
  const pDeviation = fusedP - traitBaselineP;
  const aDeviation = fusedA - traitBaselineA;
  const dDeviation = fusedD - traitBaselineD;

  fusedP = traitBaselineP + pDeviation * neuroticAmplifier;
  fusedA = traitBaselineA + aDeviation * neuroticAmplifier;
  fusedD = traitBaselineD + dDeviation * neuroticAmplifier;

  // ── Clamp to valid range ──
  fusedP = clamp(fusedP, -1, 1);
  fusedA = clamp(fusedA, -1, 1);
  fusedD = clamp(fusedD, -1, 1);

  // ── Convert to mood/energy using the existing PAD->mood converter ──
  const fused: PADState = {
    pleasure: fusedP,
    arousal: fusedA,
    dominance: fusedD,
    updatedAt: new Date().toISOString(),
  };

  const { myMood, energy } = padToMood(fused);
  return { myMood, energy };
}

/**
 * Generate a natural-language context line for system-prompt injection.
 *
 * Combines trait-level disposition (the "底色") with the current emotional
 * drift. Examples:
 *
 *   "你是个外向温暖的人——这是你的底色。今天虽然有点低落，但底色还在。"
 *   "你天性敏感细腻，容易多想。今天情绪还不错，不过你的底色就是这样——别想太多。"
 *   "你性格温和稳定，不太容易受外界影响。今天心情一般，但你撑得住。"
 *
 * Returns null when PAD is disabled.
 */
export function getTraitStateContext(): string | null {
  try {
    const traits = getTraitState();

    // Build the "底色" (trait disposition) description
    const dispositionParts: string[] = [];

    if (traits.extraversion > 0.6 && traits.agreeableness > 0.6) {
      dispositionParts.push('你是个外向温暖的人');
    } else if (traits.extraversion > 0.6) {
      dispositionParts.push('你性格外向');
    } else if (traits.agreeableness > 0.6) {
      dispositionParts.push('你性格温和');
    } else if (traits.neuroticism > 0.6) {
      dispositionParts.push('你天性敏感细腻');
    } else {
      dispositionParts.push('你性格稳定');
    }

    // Openness modifier
    if (traits.openness > 0.7 && traits.extraversion > 0.5) {
      dispositionParts.push('喜欢新鲜事物');
    } else if (traits.openness < 0.4) {
      dispositionParts.push('习惯按部就班');
    }

    if (traits.neuroticism > 0.6) {
      dispositionParts.push('容易多想');
    } else if (traits.neuroticism < 0.3) {
      dispositionParts.push('不太容易受外界影响');
    }

    // Conscientiousness note
    if (traits.conscientiousness > 0.7) {
      dispositionParts.push('做事有条理');
    } else if (traits.conscientiousness < 0.4) {
      dispositionParts.push('比较随性');
    }

    const disposition = dispositionParts.join('，');
    const exclamation = traits.neuroticism > 0.6
      ? '不过你的底色就是这样——别想太多。'
      : '但底色还在。';

    // Mood-based follow-up
    const mood = computeMood();
    let moodNote: string;
    switch (mood.myMood) {
      case '开心':
      case '温柔':
        moodNote = '今天情绪不错，';
        break;
      case '担心':
        moodNote = '今天有点不安，';
        break;
      case '心疼':
      case '在意':
        moodNote = '今天有点低落，';
        break;
      default:
        moodNote = '今天心情一般，';
        break;
    }

    return `${disposition}——这是你的底色。${moodNote}${exclamation}`;
  } catch {
    return null;
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
