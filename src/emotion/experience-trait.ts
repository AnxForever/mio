/**
 * Mio — Experience-to-Trait Feedback
 *
 * Nightly: classify each exchange's experience type, aggregate ratios,
 * and apply tiny OCEAN trait micro-shifts (0.01-0.02, capped at ±0.03/night).
 *
 * Zero LLM calls — uses pattern matching on user message + agent reply.
 *
 * Trait shift rules:
 *   - High conflict ratio + high agreeableness → agreeableness -= 0.01
 *     (Mio learns to be less accommodating when there's frequent friction)
 *   - High vulnerability + high neuroticism → neuroticism -= 0.01
 *     (user trusts Mio with vulnerability → Mio stabilizes emotionally)
 *   - High playful + low openness → openness += 0.01
 *     (playful exchanges encourage Mio to be more open)
 *   - High supportive + high conscientiousness → small positive reinforcement
 *   - All deltas are tiny (0.01-0.02), capped at ±0.03 per night per trait
 */

import { getRecentTranscripts } from '../memory/transcript.js';
import type { TranscriptEntry } from '../memory/transcript.js';
import { classifyIntent } from './classifier.js';
import type { IntentResult } from './classifier.js';
import { getTraitState, updateTraitState } from './trait-state.js';
import type { OCEANTraits } from '../types.js';
import { logger } from '../utils/logger.js';

// ─── Types ───

export type ExperienceType =
  | 'affectionate'
  | 'conflict'
  | 'vulnerability'
  | 'playful'
  | 'supportive'
  | 'neutral';

export interface ExperienceProfile {
  total: number;
  counts: Record<ExperienceType, number>;
  ratios: Record<ExperienceType, number>;
}

// ─── Pattern helpers ───

const CONFLICT_KEYWORDS = [
  '生气', '烦', '讨厌', '受不了', '不要', '不行', '别说了',
  'angry', 'mad', 'stop', 'don\'t', 'annoying', 'frustrated',
  '你(?:总是|从来不|每次)', '你(?:是不是|有没)',
  '争吵', '吵架', '争辩', '不满',
];

const VULNERABILITY_KEYWORDS = [
  '害怕', '担心', '不安', '焦虑', '紧张', '压力',
  '难过', '想哭', '脆弱', '懦弱', '没用', '失败',
  'afraid', 'scared', 'anxious', 'worried', 'insecure',
  'shared', 'secret', '从来没说过', '第一次跟人说',
  '只跟你说', '只有你知道',
];

const PLAYFUL_KEYWORDS = [
  '哈哈', '嘿嘿', 'www', 'lol', '😂', '😝', '😏', '😘',
  '开玩笑', '逗你', '调皮', '皮一下', '捉弄',
  'joking', 'lol', 'funny', 'cute',
  '小坏蛋', '讨厌啦', '哼', '傲娇',
];

const SUPPORTIVE_KEYWORDS = [
  '谢谢你', '谢谢', '有你真好', '感谢', '帮了我',
  'thank', 'thanks', 'appreciate', 'helpful',
  '听我说', '安慰', '鼓励', '支持', '开导',
];

const AFFECTIONATE_KEYWORDS = [
  '喜欢', '爱', '想你', '想念', 'miss', 'love',
  '亲爱的', '宝贝', 'honey', 'sweetie', 'darling',
  '抱抱', '亲亲', 'hug', 'kiss',
  '好喜欢你', '最爱', '想你了',
];

// ─── Main API ───

/**
 * Classify a single exchange's experience type based on user message + intent.
 *
 * @param userMessage  The user's message text
 * @param agentReply   Mio's reply text (used for context)
 * @param intent       The classified IntentResult (pre-classified intent)
 * @returns            The dominant ExperienceType
 */
export function classifyExperience(
  userMessage: string,
  agentReply: string,
  intent: IntentResult,
): ExperienceType {
  const userLower = userMessage.toLowerCase();
  const replyLower = agentReply.toLowerCase();
  const combined = `${userLower} ${replyLower}`;

  // Priority-based classification (first match wins)
  // 1. Conflict — user is angry or expressin frustration
  if (intent.primary === 'angry' || CONFLICT_KEYWORDS.some((kw) => combined.includes(kw))) {
    // But if user is also affectionate, it might be playful banter
    if (PLAYFUL_KEYWORDS.some((kw) => combined.includes(kw))) {
      return 'playful';
    }
    return 'conflict';
  }

  // 2. Vulnerability — user is sharing something vulnerable
  if (
    intent.primary === 'seeking_comfort' ||
    intent.primary === 'sad' ||
    intent.primary === 'anxious' ||
    VULNERABILITY_KEYWORDS.some((kw) => userLower.includes(kw))
  ) {
    return 'vulnerability';
  }

  // 3. Affectionate
  if (
    intent.primary === 'affectionate' ||
    AFFECTIONATE_KEYWORDS.some((kw) => userLower.includes(kw))
  ) {
    return 'affectionate';
  }

  // 4. Playful
  if (
    intent.primary === 'playful' ||
    intent.primary === 'joking' ||
    PLAYFUL_KEYWORDS.some((kw) => userLower.includes(kw))
  ) {
    return 'playful';
  }

  // 5. Supportive — user is expressing gratitude or Mio's reply is comforting
  if (
    SUPPORTIVE_KEYWORDS.some((kw) => userLower.includes(kw)) ||
    SUPPORTIVE_KEYWORDS.some((kw) => replyLower.includes(kw))
  ) {
    return 'supportive';
  }

  // 6. Neutral — everything else
  return 'neutral';
}

/**
 * Aggregate a list of experience classifications into an ExperienceProfile.
 *
 * @param experiences  Array of ExperienceType values from the night's exchanges
 * @returns           ExperienceProfile with counts and ratios
 */
export function aggregateExperiences(experiences: ExperienceType[]): ExperienceProfile {
  const counts: Record<ExperienceType, number> = {
    affectionate: 0,
    conflict: 0,
    vulnerability: 0,
    playful: 0,
    supportive: 0,
    neutral: 0,
  };

  for (const exp of experiences) {
    counts[exp]++;
  }

  const total = experiences.length;
  const ratios = {} as Record<ExperienceType, number>;

  for (const key of Object.keys(counts) as ExperienceType[]) {
    ratios[key] = total > 0 ? counts[key] / total : 0;
  }

  return { total, counts, ratios };
}

/**
 * Compute OCEAN trait micro-shifts from an ExperienceProfile.
 *
 * Rules (only fire when the ratio exceeds the threshold):
 *   - conflict ratio > 0.3 AND agreeableness > 0.5 → agreeableness -= 0.01
 *   - vulnerability ratio > 0.3 AND neuroticism > 0.5 → neuroticism -= 0.01
 *   - playful ratio > 0.3 AND openness < 0.6 → openness += 0.01
 *   - supportive ratio > 0.3 AND conscientiousness > 0.5 → conscientiousness += 0.01
 *   - affectionate ratio > 0.3 AND extraversion < 0.8 → extraversion += 0.01
 *
 * All deltas are capped at ±0.03 per night per trait (enforced by caller).
 *
 * @param profile  The experience profile for the night
 * @returns        Partial OCEANTraits with deltas (0 if no shift applicable)
 */
export function computeTraitShifts(profile: ExperienceProfile): Partial<OCEANTraits> {
  const shifts: Partial<OCEANTraits> = {
    openness: 0,
    conscientiousness: 0,
    extraversion: 0,
    agreeableness: 0,
    neuroticism: 0,
  };

  if (profile.total < 3) {
    // Not enough data to shift traits meaningfully
    return shifts;
  }

  const traits = getTraitState();

  // Rule 1: High conflict + high agreeableness → less accommodating
  if (profile.ratios.conflict > 0.3 && traits.agreeableness > 0.5) {
    shifts.agreeableness = -0.01;
  }

  // Rule 2: High vulnerability + high neuroticism → emotional stabilization
  if (profile.ratios.vulnerability > 0.3 && traits.neuroticism > 0.5) {
    shifts.neuroticism = -0.01;
  }

  // Rule 3: High playful + low openness → become more open
  if (profile.ratios.playful > 0.3 && traits.openness < 0.6) {
    shifts.openness = 0.01;
  }

  // Rule 4: High supportive + high conscientiousness → reinforce
  if (profile.ratios.supportive > 0.3 && traits.conscientiousness > 0.5) {
    shifts.conscientiousness = 0.01;
  }

  // Rule 5: High affectionate + low extraversion → warm up
  if (profile.ratios.affectionate > 0.3 && traits.extraversion < 0.8) {
    shifts.extraversion = 0.01;
  }

  return shifts;
}

/**
 * Full nightly experience-to-trait cycle.
 *
 * Steps:
 *  1. Collect recent transcript entries (last 1-2 days).
 *  2. Extract user→assistant exchanges.
 *  3. Classify each exchange's experience type.
 *  4. Aggregate into an ExperienceProfile.
 *  5. Compute trait micro-shifts.
 *  6. Apply shifts via updateTraitState().
 *
 * @returns  The ExperienceProfile for logging, or null if no data.
 */
export function runExperienceTraitCycle(): ExperienceProfile | null {
  // 1. Collect recent exchanges from transcripts
  const entries = getRecentTranscripts(2);
  if (entries.length === 0) return null;

  // 2. Extract user→assistant pairs
  const experiences: ExperienceType[] = [];
  for (let i = 0; i < entries.length - 1; i++) {
    const current = entries[i];
    const next = entries[i + 1];

    if (
      current.type === 'message' &&
      current.role === 'user' &&
      current.content &&
      next.type === 'message' &&
      next.role === 'assistant' &&
      next.content
    ) {
      const intent = classifyIntent(current.content);
      const expType = classifyExperience(current.content, next.content, intent);
      experiences.push(expType);
    }
  }

  if (experiences.length === 0) return null;

  // 3. Aggregate
  const profile = aggregateExperiences(experiences);

  // 4. Compute trait shifts
  const shifts = computeTraitShifts(profile);

  // 5. Apply shifts (capped at ±0.03 per trait per night — updateTraitState clamps to [0,1])
  const hasShift = Object.values(shifts).some((v) => v !== 0);
  if (hasShift) {
    updateTraitState(shifts);
    logger.info('[experience-trait] applied shifts', { shifts });
  }

  return profile;
}
