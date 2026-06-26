/**
 * Mio — PAD (Pleasure-Arousal-Dominance) Emotional Model
 *
 * Three-dimensional emotional model inspired by OpenFeelz, MATE (Zenodo v8),
 * and Chordia (HuggingFace).
 *
 * - Pleasure (-1..1): valence — unpleasant → pleasant
 * - Arousal (-1..1): intensity — calm → excited/alert
 * - Dominance (-1..1): control — submissive → dominant/in-control
 *
 * Features:
 *   Exponential decay back to baseline over time
 *   LLM-free pattern-based message classification with rule-based fallback
 *   OCEAN-inspired personality tweaks to baseline, decay rate, and response
 *   Conversion helpers for the legacy mood/energy system
 *
 * All PAD values are clamped to [-1, 1] range at every write.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { padStatePath } from '../memory/paths.js';
import { clamp } from '../utils/math.js';
import { writeFileSyncSafe } from '../memory/bank.js';

// ─── Types ───

export interface PADState {
  pleasure: number;    // -1.0 to 1.0 (unpleasant → pleasant)
  arousal: number;     // -1.0 to 1.0 (calm → excited/alert)
  dominance: number;   // -1.0 to 1.0 (submissive → dominant/in-control)
  updatedAt: string;
}

export interface PADConfig {
  /** Baseline PAD values (where emotions return to over time). */
  baseline: PADState;
  /** Decay rate per hour (how fast emotions return to baseline). */
  decayRate: number;
  /** OCEAN-inspired personality modifiers. */
  personality: {
    openness: number;          // 0-1: affects arousal variability
    conscientiousness: number; // 0-1: affects dominance stability
    extraversion: number;      // 0-1: affects baseline arousal + pleasure
    agreeableness: number;     // 0-1: affects baseline pleasure
    neuroticism: number;       // 0-1: affects arousal volatility + decay speed
  };
}

// ─── Default config ───

export const DEFAULT_PAD_CONFIG: PADConfig = {
  baseline: {
    pleasure: 0.3,
    arousal: 0.0,
    dominance: 0.2,
    updatedAt: '',
  },
  decayRate: 0.05, // 5% per hour toward baseline
  personality: {
    openness: 0.6,
    conscientiousness: 0.5,
    extraversion: 0.7,     // Mio is extroverted
    agreeableness: 0.8,    // Mio is warm/agreeable
    neuroticism: 0.3,      // Mio is emotionally stable
  },
};

// ─── Helpers ───

// clamp imported from ../utils/math.js — use clamp(v, -1, 1)

/** Read the MIO_PAD_ENABLED env var (defaults to 'true'). */
export function isPADEnabled(): boolean {
  return process.env.MIO_PAD_ENABLED !== 'false';
}

// ─── Default state ───

/**
 * Return the baseline-aligned default PAD state (no personality modifiers).
 */
export function defaultPADState(): PADState {
  const cfg = readPADConfig();
  return {
    ...cfg.baseline,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Config (in-memory, file-backed) ───

let cachedConfig: PADConfig | null = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Invalidate the PAD config cache (called after nightly trait updates). */
export function invalidatePADCache(): void {
  cachedConfig = null;
  configCacheTime = 0;
}

/** Path for PAD config file (next to the state file). */
function padConfigPath(): string {
  // Derive from padStatePath by replacing the filename
  const statePath = padStatePath();
  const dir = dirname(statePath);
  return `${dir}/pad-config.json`;
}

/**
 * Read PAD config from disk, merging with defaults.
 * Personality modifiers are applied to baseline values at read time.
 */
export function readPADConfig(): PADConfig {
  if (cachedConfig && (Date.now() - configCacheTime) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  const path = padConfigPath();
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PADConfig>;
      cachedConfig = {
        ...DEFAULT_PAD_CONFIG,
        ...parsed,
        personality: {
          ...DEFAULT_PAD_CONFIG.personality,
          ...(parsed.personality ?? {}),
        },
      };
      return cachedConfig!;
    }
  } catch {
    // Corrupt or missing — fall through to defaults
  }
  cachedConfig = { ...DEFAULT_PAD_CONFIG };
  return cachedConfig;
}

/**
 * Persist a PAD config to disk (partial merge with defaults).
 */
export function writePADConfig(patch: Partial<PADConfig>): PADConfig {
  const current = readPADConfig();
  const next: PADConfig = {
    ...current,
    ...patch,
    personality: {
      ...current.personality,
      ...(patch.personality ?? {}),
    },
  };
  cachedConfig = next;
  const path = padConfigPath();
  writeFileSyncSafe(path, JSON.stringify(next, null, 2));
  return next;
}

// ─── State read/write ───

/**
 * Read the current PAD state from disk.
 * Falls back to defaultPADState() if file is missing or corrupt.
 */
export function getPADState(): PADState {
  const path = padStatePath();
  try {
    if (!existsSync(path)) return defaultPADState();
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PADState>;
    return {
      ...defaultPADState(),
      ...parsed,
      pleasure: clamp(parsed.pleasure ?? defaultPADState().pleasure, -1, 1),
      arousal: clamp(parsed.arousal ?? defaultPADState().arousal, -1, 1),
      dominance: clamp(parsed.dominance ?? defaultPADState().dominance, -1, 1),
    };
  } catch {
    return defaultPADState();
  }
}

/**
 * Write a PAD state to disk (auto-creates dirs).
 */
export function writePADState(state: PADState): void {
  const path = padStatePath();
  writeFileSyncSafe(path, JSON.stringify(state, null, 2));
}

/**
 * Apply a delta to the current PAD state and persist.
 *
 * Deltas are clamped to [-1, 1] after application.
 * `updatedAt` is auto-set to now.
 */
export function updatePAD(delta: Partial<Pick<PADState, 'pleasure' | 'arousal' | 'dominance'>>): PADState {
  const current = getPADState();
  const next: PADState = {
    pleasure: delta.pleasure !== undefined ? clamp(current.pleasure + delta.pleasure, -1, 1) : current.pleasure,
    arousal: delta.arousal !== undefined ? clamp(current.arousal + delta.arousal, -1, 1) : current.arousal,
    dominance: delta.dominance !== undefined ? clamp(current.dominance + delta.dominance, -1, 1) : current.dominance,
    updatedAt: new Date().toISOString(),
  };
  writePADState(next);
  return next;
}

/**
 * Set PAD values directly (absolute set, not delta).
 */
export function setPADState(values: Partial<Pick<PADState, 'pleasure' | 'arousal' | 'dominance'>>): PADState {
  const state = getPADState();
  const next: PADState = {
    ...state,
    ...(values.pleasure !== undefined ? { pleasure: clamp(values.pleasure, -1, 1) } : {}),
    ...(values.arousal !== undefined ? { arousal: clamp(values.arousal, -1, 1) } : {}),
    ...(values.dominance !== undefined ? { dominance: clamp(values.dominance, -1, 1) } : {}),
    updatedAt: new Date().toISOString(),
  };
  writePADState(next);
  return next;
}

// ─── Decay ───

/**
 * Apply exponential decay toward baseline.
 *
 * Formula: newValue = baseline + (current - baseline) * e^(-decayRate * hours)
 *
 * The decay rate can be modified by personality.neuroticism:
 *   Low neuroticism → slower decay (more stable)
 *   High neuroticism → faster decay (more volatile)
 *
 * Call this at the start of every turn to account for elapsed time.
 *
 * @param now Optional timestamp (defaults to Date.now()).
 */
export function applyDecay(now?: Date): PADState {
  const state = getPADState();
  const cfg = readPADConfig();
  const t = now ?? new Date();

  const lastUpdate = new Date(state.updatedAt).getTime();
  const elapsedHours = (t.getTime() - lastUpdate) / 3_600_000;

  if (elapsedHours <= 0) return state;

  // Neuroticism modifies decay: low N → more stable (slower decay),
  // high N → more volatile (faster decay).
  // Range: decay modifier from 0.7 (low N) to 1.5 (high N).
  const neuroticismModifier = 0.7 + cfg.personality.neuroticism * 0.8;
  const effectiveDecay = cfg.decayRate * neuroticismModifier;

  // Exponential decay factor
  const factor = Math.exp(-effectiveDecay * elapsedHours);

  const next: PADState = {
    pleasure: clamp(cfg.baseline.pleasure + (state.pleasure - cfg.baseline.pleasure) * factor, -1, 1),
    arousal: clamp(cfg.baseline.arousal + (state.arousal - cfg.baseline.arousal) * factor, -1, 1),
    dominance: clamp(cfg.baseline.dominance + (state.dominance - cfg.baseline.dominance) * factor, -1, 1),
    updatedAt: t.toISOString(),
  };

  writePADState(next);
  return next;
}

// ─── Classification ───

/**
 * Pattern-based PAD classification for user messages.
 *
 * Returns a delta (change to apply) to the current PAD state.
 * Uses the intent classifier + additional heuristic patterns.
 *
 * This is the LLM-free replacement for an LLM-based classifier.
 * It runs entirely on pattern matching and keyword heuristics.
 */
export function classifyPAD(
  userMessage: string,
  agentReply?: string,
): Partial<Pick<PADState, 'pleasure' | 'arousal' | 'dominance'>> {
  if (!userMessage || userMessage.trim().length === 0) {
    // Ghost / empty message: small decay in pleasure and arousal
    return { pleasure: -0.05, arousal: -0.1, dominance: 0 };
  }

  const text = userMessage.trim();
  let deltaP = 0;
  let deltaA = 0;
  let deltaD = 0;

  // ── Strong positive signals ──

  // "想你了" / "想你" / missing you — affectionate recall
  if (/想你了|好想你|想我了吗/.test(text)) {
    deltaP += 0.3;
    deltaA += 0.15;
    deltaD -= 0.05; // slightly vulnerable (admitting missing)
  }

  // "哈哈哈哈哈" / lots of laughing
  if (/(哈哈){2,}|笑死|hhh|😂/.test(text)) {
    deltaP += 0.3;
    deltaA += 0.2;
  }

  // "爱你" / "喜欢" / "有你真好" — explicit affection
  if (/爱你|有你真好|最喜欢你了|好喜欢你/.test(text)) {
    deltaP += 0.35;
    deltaA += 0.1;
    deltaD += 0.05;
  }

  // "抱抱" / "亲亲" — physical affection signal
  if (/抱抱|亲亲|抱一下/.test(text)) {
    deltaP += 0.25;
    deltaA += 0.1;
    deltaD -= 0.05;
  }

  // "好开心" / "太棒了" / excitement
  if (/太开[心新]|通过了|中[了奖]|上岸|终于.*了/.test(text)) {
    deltaP += 0.35;
    deltaA += 0.3;
    deltaD += 0.1;
  }

  // "嘻嘻" / "嘿嘿" — playful
  if (/嘻嘻|嘿嘿|略略略/.test(text)) {
    deltaP += 0.2;
    deltaA += 0.15;
  }

  // ── Strong negative signals ──

  // "我分手了" / relationship loss
  if (/分手了|离婚|被甩/.test(text)) {
    deltaP -= 0.4;
    deltaA += 0.25;
    deltaD -= 0.2;
  }

  // "好难过" / "想哭" / deep sadness
  if (/好难过|想哭|撑不住了|好想.*[哭死]/.test(text)) {
    deltaP -= 0.35;
    deltaA += 0.15;
    deltaD -= 0.15;
  }

  // "烦死了" / "气死我了" — anger / frustration
  if (/烦死了|气死我了|真受不了|太气人了|我服了/.test(text)) {
    deltaP -= 0.3;
    deltaA += 0.35;
    deltaD += 0.1; // anger often comes with a sense of (reactive) control
  }

  // "好累" / "加班" — exhaustion
  if (/好累|累死了|加班.*[到完]|通宵|没睡/.test(text)) {
    deltaP -= 0.15;
    deltaA -= 0.2;
    deltaD -= 0.1;
  }

  // "焦虑" / "紧张" / "睡不着" — anxiety
  if (/焦虑|紧张|睡不着|担心.*死了|万一.*[怎么]/.test(text)) {
    deltaP -= 0.2;
    deltaA += 0.35;
    deltaD -= 0.2;
  }

  // "走了" / "离开了" / "去世" — loss
  if (/去世|离开了|走了.*[再不见]/.test(text)) {
    deltaP -= 0.4;
    deltaA += 0.2;
    deltaD -= 0.25;
  }

  // "发呆" / "无聊" — boredom / emptiness
  if (/发呆|无聊|没意思|好闲/.test(text)) {
    deltaP -= 0.1;
    deltaA -= 0.25;
    deltaD -= 0.05;
  }

  // ── Medium signals (smaller deltas, only if not already strongly triggered) ──

  // Compliments / praise
  if (/太好[了吧]|好厉害|真棒|优秀|牛.*|nice|太强/.test(text) &&
      deltaP < 0.2) { // only if not already strongly positive
    deltaP += 0.15;
    deltaA += 0.1;
    deltaD -= 0.05; // complimenting = granting power to other
  }

  // Gratitude
  if (/谢谢|麻烦了|辛苦了|感谢/.test(text) && deltaP < 0.2) {
    deltaP += 0.15;
    deltaA -= 0.05;
    deltaD -= 0.05;
  }

  // Apology
  if (/对不起|抱歉|我的错|不好意思/.test(text) && deltaP > -0.1) {
    deltaP -= 0.1;
    deltaA += 0.1;
    deltaD -= 0.1;
  }

  // "嗯" / short acknowledgment — low energy
  if ((text.length <= 2 && /^[嗯哦好是]$/.test(text)) || text === 'ok') {
    deltaP -= 0.02;
    deltaA -= 0.15;
  }

  // Silence / ghost indicator (very short, no content signal)
  if (text.length <= 1) {
    deltaP -= 0.05;
    deltaA -= 0.1;
  }

  // ── Agent reply reinforcement (optional) ──
  if (agentReply && agentReply.trim().length > 0) {
    // If the agent replied warmly and at length, small pleasure boost
    if (agentReply.length > 30 && /[开心疼爱喜欢温柔]/.test(agentReply)) {
      deltaP += 0.05;
    }
    // If the agent's reply is very short / dismissive, small pleasure dip
    if (agentReply.trim().length < 5 || /\^_^/.test(agentReply)) {
      deltaP -= 0.02;
    }
  }

  // Clamp the delta values to [-0.5, 0.5] per field to avoid
  // extreme swings from a single message.
  deltaP = Math.max(-0.5, Math.min(0.5, deltaP));
  deltaA = Math.max(-0.5, Math.min(0.5, deltaA));
  deltaD = Math.max(-0.5, Math.min(0.5, deltaD));

  return { pleasure: deltaP, arousal: deltaA, dominance: deltaD };
}

// ─── Mood conversion ───

/**
 * Convert PAD state to legacy mood/energy labels.
 *
 * Mapping:
 *   Pleasure > 0.3  → 开心 / 温柔
 *   Pleasure < -0.3 → 难过 / 心疼
 *   Otherwise       → 平静 / 在意
 *
 * Arousal drives energy:
 *   > 0.2  → high
 *   < -0.2 → low
 *   Otherwise → mid
 *
 * The specific mood string also incorporates dominance:
 *   High pleasure + high dominance → 开心
 *   High pleasure + low dominance  → 温柔
 *   Low pleasure + high dominance  → 担心 (vigilant)
 *   Low pleasure + low dominance   → 心疼
 */
export function padToMood(pad: PADState): { myMood: string; energy: 'high' | 'mid' | 'low' } {
  const { pleasure, arousal, dominance } = pad;

  // Energy from arousal
  const energy: 'high' | 'mid' | 'low' =
    arousal > 0.2 ? 'high' :
    arousal < -0.2 ? 'low' :
    'mid';

  // Mood from pleasure + dominance
  let myMood: string;
  if (pleasure > 0.3) {
    myMood = dominance > 0 ? '开心' : '温柔';
  } else if (pleasure < -0.3) {
    myMood = dominance > 0 ? '担心' : '心疼';
  } else if (pleasure > 0.1) {
    myMood = '平静';
  } else if (pleasure < -0.1) {
    myMood = '在意';
  } else {
    myMood = '平静';
  }

  return { myMood, energy };
}

// ─── Prompt context ───

/**
 * Generate a natural-language description of the current PAD emotional state
 * for injection into the system prompt.
 *
 * Example outputs:
 *   "你现在心情不错，比较放松，感觉很自在"
 *   "你有点低落，但还能撑住"
 *   "你有点烦躁，情绪比较激动，想要掌控局面"
 */
export function padToPromptContext(pad: PADState): string {
  const { pleasure, arousal, dominance } = pad;
  const parts: string[] = [];

  // Pleasure dimension
  if (pleasure > 0.5) {
    parts.push('你现在心情很好');
  } else if (pleasure > 0.15) {
    parts.push('你现在心情不错');
  } else if (pleasure > -0.15) {
    parts.push('你现在心情一般');
  } else if (pleasure > -0.5) {
    parts.push('你有点低落');
  } else {
    parts.push('你现在很难过');
  }

  // Arousal dimension
  if (arousal > 0.4) {
    parts.push('情绪比较激动');
  } else if (arousal > 0.15) {
    parts.push('有点兴奋');
  } else if (arousal > -0.15) {
    parts.push('比较放松');
  } else if (arousal > -0.4) {
    parts.push('有点疲惫');
  } else {
    parts.push('很没精神');
  }

  // Dominance dimension
  if (dominance > 0.3) {
    parts.push('感觉很自在');
  } else if (dominance > 0) {
    parts.push('还算从容');
  } else if (dominance > -0.3) {
    parts.push('有点不安');
  } else {
    parts.push('感觉很无力');
  }

  return parts.join('，');
}

// ─── Affection delta from PAD ───

/**
 * Derive an affection change from the current PAD state.
 *
 * High pleasure → affection grows faster.
 * Low pleasure → affection grows slower or stalls.
 * Very low pleasure → affection may decrease slightly.
 *
 * Dominance also plays a role: low dominance (vulnerability) paired with
 * moderate pleasure can actually increase affection (bonding through
 * vulnerability).
 *
 * @returns a delta in [-2, 5] to apply to affection.
 */
export function padAffectionDelta(pad: PADState): number {
  const { pleasure, arousal, dominance } = pad;

  // Base: map pleasure [-1, 1] → [1, 4]
  let delta = 2.5 + pleasure * 1.5;

  // Vulnerability bonus: if pleasure is moderate and dominance is low,
  // the agent feels vulnerable / trusting → bonding moment
  if (pleasure > -0.1 && pleasure < 0.4 && dominance < -0.1) {
    delta += 0.5;
  }

  // High arousal amplifies the effect (emotional moments matter more)
  if (Math.abs(arousal) > 0.3) {
    delta += 0.5;
  }

  // Very low pleasure can cause a small decrease
  if (pleasure < -0.6) {
    delta -= 1.5;
  }

  // Clamp to [-2, 5]
  return Math.max(-2, Math.min(5, Math.round(delta)));
}

// ─── Personality-adjusted baseline ───

/**
 * Get the personality-adjusted baseline PAD.
 *
 * Extraversion raises baseline pleasure and arousal.
 * Agreeableness raises baseline pleasure.
 * Neuroticism slightly lowers baseline pleasure and raises baseline arousal
 * volatility (not applied here — used in applyDecay).
 */
export function getPersonalityBaseline(): PADState {
  const cfg = readPADConfig();
  const { extraversion, agreeableness, neuroticism } = cfg.personality;

  // Extraversion: +0..0.2 to pleasure, +0..0.15 to arousal
  const eBonusP = extraversion * 0.2;
  const eBonusA = extraversion * 0.15;

  // Agreeableness: +0..0.15 to pleasure
  const aBonusP = agreeableness * 0.15;

  // Neuroticism: 0..-0.15 to pleasure
  const nPenaltyP = neuroticism * 0.15;

  return {
    pleasure: clamp(cfg.baseline.pleasure + eBonusP + aBonusP - nPenaltyP, -1, 1),
    arousal: clamp(cfg.baseline.arousal + eBonusA, -1, 1),
    dominance: cfg.baseline.dominance,
    updatedAt: new Date().toISOString(),
  };
}
