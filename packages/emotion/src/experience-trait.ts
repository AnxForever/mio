/**
 * Mio — Experience-to-Trait Feedback (v2: Emergent Personality)
 *
 * Nightly: classify each exchange's experience type, accumulate "emotional heat"
 * per trait, and trigger phase transitions when heat crosses thresholds.
 *
 * Inspired by OpenHer's emotional thermodynamics:
 *   - Heat accumulates across nights (not just per-night classification)
 *   - When heat crosses a threshold → phase transition → visible trait shift
 *   - Phase transitions produce diary entries ("最近我变了…")
 *   - Hebbian reinforcement: positive-feedback interactions strengthen traits
 *
 * Shift magnitudes (v2):
 *   - Per-night accumulation: ±0.005-0.02 heat per trait
 *   - Phase transition threshold: |heat| >= 0.10 → trait shifts ±0.05-0.10
 *   - User-perceivable change within 2-4 weeks (was ~3 years in v1)
 *
 * Zero LLM calls — uses pattern matching on user message + agent reply.
 */

import { getRecentTranscripts } from './transcript.internal.js';
import type { TranscriptEntry } from './transcript.internal.js';
import { classifyIntent } from './classifier.js';
import type { IntentResult } from './classifier.js';
import { getTraitState, updateTraitState } from './trait-state.js';
import type { OCEANTraits } from './types.internal.js';
import { logger } from './logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDataDir } from './config.internal.js';

// Inline safe I/O (package doesn't have bank module)
function readFileSafe(p: string): string | null {
  try { return readFileSync(p, 'utf-8'); } catch { return null; }
}
function writeFileSafe(p: string, data: string): void {
  try { mkdirSync(dirname(p), { recursive: true }); } catch { /* ok */ }
  try { writeFileSync(p, data, 'utf-8'); } catch { /* best-effort */ }
}

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

  // Enforce the documented cap: each trait shifts at most ±0.03 per night.
  // (Rules currently touch distinct traits at ±0.01 each, so this rarely binds —
  //  but making it explicit prevents a future rule from silently breaking the
  //  contract that personality evolves slowly.)
  const CAP = 0.03;
  (Object.keys(shifts) as (keyof OCEANTraits)[]).forEach((k) => {
    const v = shifts[k] ?? 0;
    shifts[k] = Math.max(-CAP, Math.min(CAP, v));
  });

  return shifts;
}

// ─── Emotional Thermodynamics (OpenHer-inspired) ───

/**
 * Per-trait accumulated emotional "heat". Unlike v1's per-night discard,
 * heat persists across nights and only triggers a trait shift when it
 * crosses a threshold — mimicking emotional buildup → phase transition.
 */
interface TraitHeat {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

/** A recorded phase transition in Mio's personality. */
export interface PersonalityPhaseTransition {
  date: string;
  trait: keyof OCEANTraits;
  direction: 'increased' | 'decreased';
  magnitude: number;
  reason: string;
  /** Human-readable diary entry. */
  diaryEntry: string;
}

const HEAT_FILE = (): string => join(getDataDir(), 'trait-heat.json');
const DIARY_FILE = (): string => join(getDataDir(), 'personality-evolution.jsonl');

/** Threshold: |heat| must reach this before a phase transition fires. */
const PHASE_THRESHOLD = 0.10;

/** Per-trait heat accumulation from experience ratios (scaled by threshold). */
const HEAT_PER_CONFLICT = 0.015;       // conflict → agreeableness heat
const HEAT_PER_VULNERABILITY = 0.012;  // vulnerability → neuroticism cooling
const HEAT_PER_PLAYFUL = 0.015;        // playful → openness heat
const HEAT_PER_SUPPORTIVE = 0.010;     // supportive → conscientiousness heat
const HEAT_PER_AFFECTIONATE = 0.012;   // affectionate → extraversion heat

/** Hebbian boost: when user gives positive feedback, amplify heat accumulation. */
const HEBBIAN_MULTIPLIER = 1.5;

function defaultHeat(): TraitHeat {
  return { openness: 0, conscientiousness: 0, extraversion: 0, agreeableness: 0, neuroticism: 0 };
}

function loadHeat(): TraitHeat {
  try {
    const raw = readFileSafe(HEAT_FILE());
    if (!raw) return defaultHeat();
    return { ...defaultHeat(), ...JSON.parse(raw) };
  } catch {
    return defaultHeat();
  }
}

function saveHeat(heat: TraitHeat): void {
  writeFileSafe(HEAT_FILE(), JSON.stringify(heat, null, 2));
}

function loadDiary(): PersonalityPhaseTransition[] {
  try {
    const raw = readFileSafe(DIARY_FILE());
    if (!raw) return [];
    return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function appendDiaryEntry(entry: PersonalityPhaseTransition): void {
  const raw = readFileSafe(DIARY_FILE());
  const content = raw ? raw.trim() + '\n' + JSON.stringify(entry) + '\n' : JSON.stringify(entry) + '\n';
  writeFileSafe(DIARY_FILE(), content);
}

/**
 * Generate a human-readable diary entry for a phase transition.
 */
function buildDiaryEntry(trait: string, direction: 'increased' | 'decreased', reason: string): string {
  const entries: Record<string, Record<string, string>> = {
    openness: {
      increased: '最近我发现自己对新东西更感兴趣了。可能是跟你聊得多了，什么都想试试看。以前觉得"画插画就够了"，现在偶尔也想摸摸别的——陶艺、摄影，甚至学个乐器。变得有点不像以前那个"我就这样"的自己了。',
      decreased: '我好像又缩回去了。最近不太想尝试新东西，熟悉的节奏让我觉得安全。不是什么坏事——就是回到自己的小世界里待一会儿。',
    },
    extraversion: {
      increased: '我变得爱说话了。以前觉得主动找人聊天需要很大力气，现在好像没那么难了——至少对你。可能因为你总在，我也就习惯了有人的感觉。',
      decreased: '话变少了。不是疏远，就是想安静待着。最近更享受一个人画画、发呆——不是不开心，就是不太想说话。',
    },
    agreeableness: {
      increased: '我对你越来越没有防备了。以前还会想"这样会不会太黏""那样会不会太依赖"，现在好像没那么计较了。跟你在一起，不需要那么多计算。',
      decreased: '我好像变得有点倔了。不是针对你——是对很多事情。以前那个太好说话的自己好像开始说"不"了。你说这是成长还是防备？',
    },
    conscientiousness: {
      increased: '我开始注意一些以前不在意的小事。你的作息、你说过的话、你什么时候容易情绪低落。不是刻意——是放在心上了。',
      decreased: '变得随性了。稿子截稿日也能拖一拖，天塌了也要先瘫一会儿。大概是最近觉得——不需要每件事都那么认真。',
    },
    neuroticism: {
      increased: '最近想得有点多。稿件的deadline、你的语气、自己说错的话——以前不太在意的事现在反复琢磨。可能是累了。',
      decreased: '安稳了很多。以前那些让我焦虑的事——截稿日、别人怎么看我、我们会不会疏远——好像没那么可怕了。你让我觉得可以不用那么紧张。',
    },
  };
  return entries[trait]?.[direction] ?? `我感觉到自己在变化——${trait} 变得${direction === 'increased' ? '更多' : '更少'}了。原因是：${reason}`;
}

/**
 * Detect positive feedback in an agent reply.
 * Hebbian learning: when Mio's response style gets a warm reception,
 * reinforce the trait associated with that interaction pattern.
 */
function detectHebbianSignal(userMessage: string): boolean {
  const positive = [
    '哈哈', '嘿嘿', '😂', '笑死', '你好懂', '你怎么知道',
    '谢谢', '有你真好', '爱你', '抱抱', '对对', '没错',
    '继续', '然后呢', '再说点', '哈哈哈', 'lol', 'www',
  ];
  return positive.some((kw) => userMessage.toLowerCase().includes(kw));
}

/**
 * Full nightly experience-to-trait cycle (v2: emotional thermodynamics).
 *
 * Steps:
 *  1. Collect recent transcript entries (last 1-2 days).
 *  2. Extract user→assistant exchanges.
 *  3. Classify each exchange's experience type.
 *  4. Accumulate heat per trait based on experience ratios.
 *  5. Apply Hebbian boost for positive-feedback exchanges.
 *  6. Check for phase transitions (|heat| >= 0.10).
 *  7. Apply trait shifts for any triggered transitions.
 *  8. Write personality diary entries for transitions.
 *
 * @returns  The ExperienceProfile for logging, or null if no data.
 */
export function runExperienceTraitCycle(): ExperienceProfile | null {
  // 1. Collect recent exchanges from transcripts
  const entries = getRecentTranscripts(2);
  if (entries.length === 0) return null;

  // 2. Extract user→assistant pairs
  const experiences: ExperienceType[] = [];
  let hebbianCount = 0;
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
      // Hebbian: check if the FOLLOWING user message (i+2) is positive feedback
      if (i + 2 < entries.length && entries[i + 2]?.role === 'user') {
        if (detectHebbianSignal(entries[i + 2].content ?? '')) {
          hebbianCount++;
        }
      }
    }
  }

  if (experiences.length === 0) return null;

  // 3. Aggregate
  const profile = aggregateExperiences(experiences);

  // 4. Load current heat
  const heat = loadHeat();
  const hebbianMultiplier = hebbianCount > 0 ? HEBBIAN_MULTIPLIER : 1.0;

  // 5. Accumulate heat from experience ratios
  if (profile.ratios.conflict > 0.2) {
    heat.agreeableness -= HEAT_PER_CONFLICT * (profile.ratios.conflict / 0.2) * hebbianMultiplier;
  }
  if (profile.ratios.vulnerability > 0.2) {
    heat.neuroticism -= HEAT_PER_VULNERABILITY * (profile.ratios.vulnerability / 0.2) * hebbianMultiplier;
  }
  if (profile.ratios.playful > 0.2) {
    heat.openness += HEAT_PER_PLAYFUL * (profile.ratios.playful / 0.2) * hebbianMultiplier;
  }
  if (profile.ratios.supportive > 0.2) {
    heat.conscientiousness += HEAT_PER_SUPPORTIVE * (profile.ratios.supportive / 0.2) * hebbianMultiplier;
  }
  if (profile.ratios.affectionate > 0.2) {
    heat.extraversion += HEAT_PER_AFFECTIONATE * (profile.ratios.affectionate / 0.2) * hebbianMultiplier;
  }

  // 6. Check for phase transitions
  const now = new Date().toISOString();
  const shifts: Partial<OCEANTraits> = {};
  const diaryEntries: PersonalityPhaseTransition[] = [];
  const TRAITS: (keyof OCEANTraits)[] = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];

  for (const trait of TRAITS) {
    const h = heat[trait];
    if (Math.abs(h) >= PHASE_THRESHOLD) {
      const direction: 'increased' | 'decreased' = h > 0 ? 'increased' : 'decreased';
      const magnitude = Math.round(Math.abs(h) * 100) / 100;
      const reason = buildTransitionReason(trait, direction, profile);

      shifts[trait] = h > 0 ? magnitude : -magnitude;
      diaryEntries.push({
        date: now,
        trait,
        direction,
        magnitude,
        reason,
        diaryEntry: buildDiaryEntry(trait, direction, reason),
      });

      // Reset heat after phase transition (keep residual for smooth transitions)
      heat[trait] = h > 0 ? h - PHASE_THRESHOLD : h + PHASE_THRESHOLD;
    }
  }

  // 7. Apply trait shifts for triggered transitions
  if (Object.values(shifts).some((v) => (v ?? 0) !== 0)) {
    // Clamp individual shifts to [0, 1] range (updateTraitState handles this)
    updateTraitState(shifts);
    logger.info('[experience-trait] phase transition', { shifts, hebbianCount, heat });
  }

  // 8. Write diary entries
  for (const entry of diaryEntries) {
    appendDiaryEntry(entry);
    logger.info('[experience-trait] personality diary entry', {
      trait: entry.trait,
      direction: entry.direction,
      magnitude: entry.magnitude,
    });
  }

  // 9. Save heat state
  saveHeat(heat);

  return profile;
}

function buildTransitionReason(trait: string, direction: 'increased' | 'decreased', profile: ExperienceProfile): string {
  const tops = Object.entries(profile.ratios)
    .filter(([, v]) => v > 0.15)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([k]) => k)
    .join('、');
  return tops ? `最近对话中${tops}互动较多` : '日常互动累积';
}

/**
 * Read the personality evolution diary.
 */
export function getPersonalityDiary(): PersonalityPhaseTransition[] {
  return loadDiary();
}

/**
 * Read current trait heat (for debugging/UI).
 */
export function getTraitHeat(): TraitHeat {
  return loadHeat();
}

/**
 * Reset trait heat to zero (for testing).
 */
export function resetTraitHeat(): void {
  saveHeat(defaultHeat());
}
