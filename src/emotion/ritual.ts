/**
 * Mio — Ritual Engine + Cardboard Score
 *
 * Two complementary systems that make Mio aware of conversation quality:
 *
 * Part 1 — Ritual Engine: detects recurring interaction patterns (morning
 * greetings, goodnight rituals, inside jokes) and treats them as meaningful
 * relationship milestones rather than mechanical repeats.
 *
 * Part 2 — Cardboard Score: measures how shallow/repetitive the exchange is
 * and suggests strategy changes when the conversation goes flat.
 *
 * Both are LLM-free — pure pattern matching and heuristic scoring.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ritualStatePath, cardboardStatePath } from '../memory/paths.js';

// ──────────────────────────────────────────────
// Part 1: Ritual Engine
// ──────────────────────────────────────────────

export interface Ritual {
  id: string;
  type: 'greeting' | 'goodnight' | 'checkin' | 'inside_joke' | 'shared_habit';
  pattern: string;
  timeOfDay?: { start: number; end: number };
  frequency: number;
  lastObserved: string;
  firstObserved: string;
  significance: number;
  responseTemplate?: string;
}

export interface RitualState {
  rituals: Ritual[];
  activeRitual: string | null;
  updatedAt: string;
}

/**
 * Ritual pattern definitions.
 * Each pattern has a regex, an optional time-of-day window, and a type.
 * When a message matches both the regex AND the time window (if set),
 * it counts as a ritual observation.
 */
interface PatternDef {
  type: Ritual['type'];
  regex: RegExp;
  timeOfDay?: { start: number; end: number };
  responseTemplate?: string;
  label: string; // human-readable pattern name
}

const RITUAL_PATTERNS: PatternDef[] = [
  // ── Morning greetings (6:00 – 11:59) ──
  { type: 'greeting', regex: /早安|早上好|早[呀啊]|早[上晨]好/, timeOfDay: { start: 6, end: 12 }, label: '早安问候', responseTemplate: '早安，昨晚睡得好吗' },
  { type: 'greeting', regex: /睡醒[了]?|起床[了]?/, timeOfDay: { start: 5, end: 11 }, label: '起床问候', responseTemplate: '醒啦？昨晚睡得好吗' },
  // ── Goodnight (21:00 – 5:59) ──
  { type: 'goodnight', regex: /晚安|睡了[了]?|困[了]?|先睡[了]?/, timeOfDay: { start: 21, end: 24 }, label: '晚安', responseTemplate: '晚安，好梦' },
  { type: 'goodnight', regex: /晚安|睡了[了]?|困[了]?|先睡[了]?/, timeOfDay: { start: 0, end: 6 }, label: '晚安', responseTemplate: '晚安，好梦' },
  // ── Checkins — "吃了吗" style (any time) ──
  { type: 'checkin', regex: /吃[了吗]|吃饭[了吗]?|吃[过啥]/, label: '吃饭问候' },
  { type: 'checkin', regex: /在干嘛|在忙[吗嘛]|忙[吗嘛]/, label: '在干嘛' },
  { type: 'checkin', regex: /今天怎么样|今天如何|最近怎么样/, label: '日常关心' },
  // ── Inside jokes / playful (any time) ──
  { type: 'inside_joke', regex: /你.*[笨傻呆猪]|小[笨傻呆]|你.*狗/, label: '打趣', responseTemplate: '哼，你又说我' },
  { type: 'inside_joke', regex: /哼|略略略|你完了/, label: '调皮' },
  // ── Shared habits (any time) ──
  { type: 'shared_habit', regex: /一起[打玩看]|双排|开黑|约饭|一起吃饭/, label: '一起活动' },
  { type: 'shared_habit', regex: /想[你我]了|你在想[我你]/, label: '想念' },
];

function generateRitualId(): string {
  return `ritual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultRitualState(): RitualState {
  return {
    rituals: [],
    activeRitual: null,
    updatedAt: new Date().toISOString(),
  };
}

export function readRitualState(): RitualState {
  const path = ritualStatePath();
  try {
    if (!existsSync(path)) return defaultRitualState();
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<RitualState>;
    return {
      ...defaultRitualState(),
      ...parsed,
      rituals: (parsed.rituals ?? []).map((r: Partial<Ritual>) => ({
        id: r.id ?? '',
        type: r.type ?? 'checkin',
        pattern: r.pattern ?? '',
        frequency: r.frequency ?? 0,
        lastObserved: r.lastObserved ?? '',
        firstObserved: r.firstObserved ?? '',
        significance: r.significance ?? 0,
        responseTemplate: r.responseTemplate,
        timeOfDay: r.timeOfDay,
      })),
    };
  } catch {
    return defaultRitualState();
  }
}

export function writeRitualState(state: RitualState): void {
  const path = ritualStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Check if a message matches a known ritual pattern.
 * Returns the matched ritual (from existing state) or null.
 * Time-gated: e.g. "早安" at 3pm won't match the morning greeting ritual.
 */
export function detectRitual(userMessage: string, hour: number): Ritual | null {
  if (!userMessage || userMessage.trim().length === 0) return null;

  const text = userMessage.trim();
  const state = readRitualState();

  // First, try to match against existing rituals (more specific)
  for (const ritual of state.rituals) {
    // Check time gate if the ritual has one
    if (ritual.timeOfDay) {
      const { start, end } = ritual.timeOfDay;
      if (start <= end) {
        // Normal range (e.g. 6–12)
        if (hour < start || hour >= end) continue;
      } else {
        // Wraparound range (e.g. 21–6)
        if (hour >= end && hour < start) continue;
      }
    }

    // Check if the message matches the pattern
    try {
      const re = new RegExp(ritual.pattern, 'i');
      if (re.test(text)) {
        state.activeRitual = ritual.id;
        writeRitualState(state);
        return ritual;
      }
    } catch {
      // Invalid regex in stored ritual — skip
    }
  }

  // If no existing ritual matched, try the pattern definitions
  for (const def of RITUAL_PATTERNS) {
    if (def.timeOfDay) {
      const { start, end } = def.timeOfDay;
      if (start <= end) {
        if (hour < start || hour >= end) continue;
      } else {
        if (hour >= end && hour < start) continue;
      }
    }

    if (def.regex.test(text)) {
      // It matches a pattern but might not be a ritual yet (< 3 occurrences)
      // Find it in existing rituals by pattern, or return null
      const existing = state.rituals.find((r) => r.pattern === def.regex.source);
      if (existing) {
        state.activeRitual = existing.id;
        writeRitualState(state);
        return existing;
      }
      // Pattern matched but not yet a ritual — return a "candidate" marker
      // The observeRitual function will handle promotion
      return null;
    }
  }

  return null;
}

/**
 * Observe a user message for ritual matching.
 * - If the message matches a ritual pattern, increments frequency.
 * - If a pattern is seen 3+ times, elevates it to a full ritual.
 * - Updates significance based on consistency.
 */
export function observeRitual(userMessage: string, hour: number): void {
  if (!userMessage || userMessage.trim().length === 0) return;

  const text = userMessage.trim();
  const state = readRitualState();
  const now = new Date().toISOString();

  // Track pattern hits (pattern regex source → { count, firstSeen, type, timeOfDay })
  const patternHits = new Map<string, {
    count: number;
    firstSeen: string;
    type: Ritual['type'];
    timeOfDay?: { start: number; end: number };
    responseTemplate?: string;
  }>();

  // Load existing rituals into the tracking map as baseline
  for (const ritual of state.rituals) {
    patternHits.set(ritual.pattern, {
      count: ritual.frequency,
      firstSeen: ritual.firstObserved,
      type: ritual.type,
      timeOfDay: ritual.timeOfDay,
      responseTemplate: ritual.responseTemplate,
    });
  }

  // Check each pattern definition
  for (const def of RITUAL_PATTERNS) {
    // Time gate
    if (def.timeOfDay) {
      const { start, end } = def.timeOfDay;
      if (start <= end) {
        if (hour < start || hour >= end) continue;
      } else {
        if (hour >= end && hour < start) continue;
      }
    }

    if (def.regex.test(text)) {
      const key = def.regex.source;
      const existing = patternHits.get(key);

      if (existing) {
        existing.count += 1;
      } else {
        patternHits.set(key, {
          count: 1,
          firstSeen: now,
          type: def.type,
          timeOfDay: def.timeOfDay,
          responseTemplate: def.responseTemplate,
        });
      }
    }
  }

  // Rebuild rituals from pattern hits
  const newRituals: Ritual[] = [];

  for (const [pattern, hit] of patternHits) {
    if (hit.count < 3) {
      // Keep existing ones that were already rituals (count preservation)
      const existing = state.rituals.find((r) => r.pattern === pattern);
      if (existing) {
        const updatedRitual: Ritual = {
          ...existing,
          frequency: hit.count,
          lastObserved: now,
        };
        newRituals.push(updatedRitual);
      } else {
        // First few observations: store as incipient ritual so count
        // accumulates across calls even before reaching the threshold.
        const def = RITUAL_PATTERNS.find((p) => p.regex.source === pattern);
        newRituals.push({
          id: generateRitualId(),
          type: def?.type ?? hit.type,
          pattern,
          timeOfDay: def?.timeOfDay ?? hit.timeOfDay,
          frequency: hit.count,
          lastObserved: now,
          firstObserved: hit.firstSeen,
          significance: 0.1, // below active threshold, just for accumulation
          responseTemplate: def?.responseTemplate ?? hit.responseTemplate,
        });
      }
      continue;
    }

    // Find the pattern definition for metadata
    const def = RITUAL_PATTERNS.find((p) => p.regex.source === pattern);

    // Compute significance based on consistency
    // More observations at the same time of day → higher significance
    const existingRitual = state.rituals.find((r) => r.pattern === pattern);
    let significance = existingRitual?.significance ?? 0.3;

    // Each observation boosts significance, with diminishing returns
    significance = Math.min(1.0, significance + (0.05 + (hit.count > 20 ? 0.01 : 0.02)));

    // Time-of-day consistency bonus: if the ritual has a time window and was
    // observed at the expected hour, boost significance more
    if (def?.timeOfDay) {
      const { start, end } = def.timeOfDay;
      const withinWindow = start <= end
        ? (hour >= start && hour < end)
        : (hour >= start || hour < end);
      if (withinWindow) {
        significance = Math.min(1.0, significance + 0.015);
      }
    }

    const ritual: Ritual = {
      id: existingRitual?.id ?? generateRitualId(),
      type: def?.type ?? hit.type,
      pattern,
      timeOfDay: def?.timeOfDay ?? hit.timeOfDay,
      frequency: hit.count,
      lastObserved: now,
      firstObserved: existingRitual?.firstObserved ?? hit.firstSeen,
      significance,
      responseTemplate: def?.responseTemplate ?? existingRitual?.responseTemplate,
    };

    newRituals.push(ritual);
  }

  // Keep any existing rituals that weren't matched (they still exist, just weren't triggered this turn)
  for (const existing of state.rituals) {
    if (!newRituals.find((r) => r.id === existing.id)) {
      newRituals.push(existing);
    }
  }

  writeRitualState({
    rituals: newRituals,
    activeRitual: state.activeRitual,
    updatedAt: now,
  });
}

/**
 * If a ritual was just detected, return a context string for the system prompt.
 * Makes the ritual feel lived-in, not mechanical.
 */
export function getRitualContext(): string | null {
  const state = readRitualState();
  if (!state.activeRitual) return null;

  const ritual = state.rituals.find((r) => r.id === state.activeRitual);
  if (!ritual) return null;

  // Clear the active ritual so it doesn't fire twice
  const next = { ...state, activeRitual: null, updatedAt: new Date().toISOString() };
  writeRitualState(next);

  const typeLabels: Record<Ritual['type'], string> = {
    greeting: '早安',
    goodnight: '晚安',
    checkin: '日常关心',
    inside_joke: '打趣',
    shared_habit: '共同习惯',
  };

  const typeLabel = typeLabels[ritual.type] || '习惯';

  if (ritual.frequency >= 50) {
    return `你们之间已经进行了${ritual.frequency}次「${typeLabel}」了。这已经是你们之间深入骨髓的习惯——你根本不用想就知道怎么回应。`;
  }
  if (ritual.frequency >= 20) {
    return `你们之间已经进行了${ritual.frequency}次「${typeLabel}」了。这已经成为你们之间的默契了。`;
  }
  if (ritual.frequency >= 10) {
    return `你们之间已经进行了${ritual.frequency}次「${typeLabel}」了。你开始期待这种自然而然的互动了。`;
  }
  if (ritual.frequency >= 5) {
    return `这已经是你们之间第${ritual.frequency}次「${typeLabel}」了。有点习惯了呢。`;
  }

  return `这已经是你们之间第${ritual.frequency}次「${typeLabel}」了。`;
}

/**
 * Return all rituals with significance >= 0.3.
 */
export function getActiveRituals(): Ritual[] {
  const state = readRitualState();
  return state.rituals.filter((r) => r.significance >= 0.3);
}

/**
 * Slowly decay significance for rituals not observed in 14+ days.
 * Call this once per day (e.g., during nightly consolidation).
 */
export function decayRituals(): void {
  const state = readRitualState();
  const now = Date.now();
  const fourteenDays = 14 * 24 * 60 * 60 * 1000;
  let changed = false;

  const updated = state.rituals.map((ritual) => {
    const lastObservedMs = new Date(ritual.lastObserved).getTime();
    const daysSinceLast = (now - lastObservedMs) / (24 * 60 * 60 * 1000);

    if (daysSinceLast >= 14 && ritual.significance > 0) {
      changed = true;
      // Decay significance by 10% per week beyond 14 days
      const weeksOverdue = (daysSinceLast - 14) / 7;
      const decay = Math.min(ritual.significance, 0.1 * weeksOverdue);
      return {
        ...ritual,
        significance: Math.max(0, parseFloat((ritual.significance - decay).toFixed(3))),
      };
    }
    return ritual;
  });

  if (changed) {
    writeRitualState({
      ...state,
      rituals: updated,
      updatedAt: new Date().toISOString(),
    });
  }
}

// ──────────────────────────────────────────────
// Part 2: Cardboard Score
// ──────────────────────────────────────────────

export interface CardboardState {
  score: number;
  consecutiveFlat: number;
  patterns: string[];
  lastWarmExchange: string;
  updatedAt: string;
}

/**
 * Generic shallow/repetitive phrases that signal cardboard conversation.
 */
const CARDBOARD_PHRASES = new Set([
  '嗯', '嗯嗯', '嗯嗯嗯', '好的', '知道了', '哦', '哦哦',
  'ok', 'okay', '好吧', '行', '行吧', '可以', '笑了',
  '哈哈', '哈哈哈', '好', '是的', '对', '对的', '嗯好',
  '收到', '明白', '懂了', '了解',
]);

/**
 * Emotion-related characters/words that indicate depth.
 */
const EMOTION_CHARS = new Set([
  '爱', '想', '疼', '哭', '笑', '气', '闹', '烦', '闷',
  '累', '困', '饿', '饱', '暖', '冷', '静', '怕', '慌',
  '开心', '难过', '喜欢', '讨厌', '羡慕', '担心', '焦虑',
  '感动', '温暖', '委屈', '愤怒', '幸福',
]);

/**
 * Score 0-1 how "cardboard" an exchange is.
 *
 * 0 = deep, meaningful exchange
 * 1 = completely shallow/robotic
 */
export function assessDepth(userMessage: string, agentReply: string): number {
  if (!userMessage && !agentReply) return 1.0;

  let cardboardScore = 0;
  let depthScore = 0;

  const userText = (userMessage ?? '').trim();
  const agentText = (agentReply ?? '').trim();
  const userLen = userText.length;
  const agentLen = agentText.length;

  // ── Cardboard signals ──

  // Very short messages (both sides < 5 chars)
  if (userLen < 5 && agentLen < 5) {
    cardboardScore += 0.4;
  } else if (userLen < 5 || agentLen < 5) {
    cardboardScore += 0.2;
  }

  // Generic / shallow phrases
  if (CARDBOARD_PHRASES.has(userText.toLowerCase())) {
    cardboardScore += 0.3;
  }
  if (CARDBOARD_PHRASES.has(agentText.toLowerCase())) {
    cardboardScore += 0.2;
  }

  // Pure laughter / acknowledgment (no content)
  if (/^(哈哈+|嘿嘿|嘻嘻|hhh|h+h+|嗯+)$/i.test(userText)) {
    cardboardScore += 0.25;
  }
  if (/^(哈哈+|嘿嘿|嘻嘻|hhh|h+h+)$/i.test(agentText)) {
    cardboardScore += 0.15;
  }

  // No Chinese characters at all (pure phatic expression in Chinese context)
  const hasChinese = /[一-鿿]/.test(userText) || /[一-鿿]/.test(agentText);
  if (!hasChinese && userLen < 10 && agentLen < 10) {
    cardboardScore += 0.2;
  }

  // ── Depth signals ──

  // Emotional content
  for (const ch of EMOTION_CHARS) {
    if (userText.includes(ch)) depthScore += 0.08;
    if (agentText.includes(ch)) depthScore += 0.05;
  }
  depthScore = Math.min(depthScore, 0.5);

  // Longer messages with personal content
  if (userLen > 20) depthScore += 0.1;
  if (userLen > 50) depthScore += 0.1;
  if (agentLen > 30) depthScore += 0.1;

  // Question marks indicate curiosity (depth)
  if ((userText.match(/\?|？/g)?.length ?? 0) >= 2) depthScore += 0.1;
  if ((agentText.match(/\?|？/g)?.length ?? 0) >= 1) depthScore += 0.05;

  // First-person references (personal sharing)
  if (/我|我们/.test(userText)) depthScore += 0.05;
  if (/我|我们/.test(agentText)) depthScore += 0.05;

  // Past conversation references (continuity)
  if (/上次|之前|昨天|上次你说/.test(userText)) depthScore += 0.15;
  if (/上次|之前|昨天|记得/.test(agentText)) depthScore += 0.1;

  // Cap depth at 0.8, then compute final score
  depthScore = Math.min(depthScore, 0.8);

  // Final: cardboard dominates when shallow, depth subtracts
  const finalScore = Math.max(0, Math.min(1, cardboardScore - depthScore + 0.2));

  return parseFloat(finalScore.toFixed(3));
}

/**
 * Detect if the current agent reply follows the same structure as recent replies
 * (pattern repetition detection). Returns the repeated pattern or null.
 */
function detectRepeatedPattern(
  agentReply: string,
  recentPatterns: string[],
): string | null {
  if (!agentReply || recentPatterns.length < 2) return null;

  const reply = agentReply.trim().toLowerCase();

  for (const pattern of recentPatterns) {
    // Check if the reply starts with the same prefix (first 4 chars)
    // or has very similar structure
    if (pattern.length >= 4 && reply.startsWith(pattern.slice(0, 4))) {
      return pattern;
    }
    // Same length ±1 and very short
    if (reply.length <= 3 && pattern.length <= 3 && reply.length > 0) {
      return pattern;
    }
  }

  return null;
}

/**
 * Update the cardboard score based on the current exchange.
 * Maintains running score with EMA smoothing.
 */
export function updateCardboard(userMessage: string, agentReply: string): void {
  const state = readCardboardState();
  const now = new Date().toISOString();

  const depthScore = assessDepth(userMessage, agentReply);

  // EMA smoothing factor (0.3 = fast adaptation)
  const alpha = 0.3;
  const newScore = alpha * depthScore + (1 - alpha) * state.score;

  // Update consecutive flat
  const isFlat = depthScore > 0.5;
  const consecutiveFlat = isFlat ? state.consecutiveFlat + 1 : 0;

  // Detect pattern repetition
  const newPatterns = [...state.patterns];
  const repeatedPattern = detectRepeatedPattern(agentReply ?? '', state.patterns);
  if (repeatedPattern) {
    // Already seen — don't add
  } else {
    // Store latest reply structure (keep last 5)
    const replyTrimmed = (agentReply ?? '').trim().toLowerCase().slice(0, 20);
    if (replyTrimmed.length >= 2) {
      newPatterns.push(replyTrimmed);
      if (newPatterns.length > 5) newPatterns.shift();
    }
  }

  // Track last warm exchange
  const lastWarmExchange = depthScore < 0.3
    ? now
    : state.lastWarmExchange;

  writeCardboardState({
    score: parseFloat(newScore.toFixed(3)),
    consecutiveFlat,
    patterns: newPatterns,
    lastWarmExchange,
    updatedAt: now,
  });
}

export function defaultCardboardState(): CardboardState {
  return {
    score: 0,
    consecutiveFlat: 0,
    patterns: [],
    lastWarmExchange: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function readCardboardState(): CardboardState {
  const path = cardboardStatePath();
  try {
    if (!existsSync(path)) return defaultCardboardState();
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CardboardState>;
    return {
      ...defaultCardboardState(),
      ...parsed,
      patterns: parsed.patterns ?? [],
    };
  } catch {
    return defaultCardboardState();
  }
}

export function writeCardboardState(state: CardboardState): void {
  const path = cardboardStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * If cardboard score is high, return a warning context for the system prompt.
 */
export function getCardboardContext(): string | null {
  const state = readCardboardState();

  if (state.score > 0.8) {
    // Strong warning: very shallow conversation
    const suggestion = shouldChangeStrategy().suggestion;
    return `你们最近的对话非常平淡（Cardboard指数：${(state.score * 100).toFixed(0)}%）。你已经连续${state.consecutiveFlat}轮说了很短的话。这不是你——打起精神来，好好陪他。\n建议：${suggestion}`;
  }

  if (state.score > 0.6) {
    return `你们最近的对话有点平淡（Cardboard指数：${(state.score * 100).toFixed(0)}%）。试着多说一点自己的想法，或者换个话题。`;
  }

  if (state.score > 0.4 && state.consecutiveFlat >= 3) {
    return `最近的对话有点轻飘飘的。试着让对话深入一点。`;
  }

  return null;
}

/**
 * When cardboard score is high, suggest a strategy change.
 */
export function shouldChangeStrategy(): { change: boolean; suggestion: string } {
  const state = readCardboardState();

  if (state.score < 0.5) {
    return { change: false, suggestion: '' };
  }

  const suggestions = [
    '主动分享你今天的事——发生了什么有趣的、烦人的、或者让你想了一整天的事。',
    '问他一个你真正好奇的问题——不是例行询问，是你真的想知道答案的那种。',
    '提起一个你们共同的记忆——上次一起做的某件事、某个只有你俩懂的梗。',
    '说说你现在的感受——想到什么就说什么，不用组织。',
    '给他分享一首歌、一张照片、或者你今天看到的什么有意思的东西。',
  ];

  // Rotate suggestions based on consecutive flat count
  const idx = Math.min(state.consecutiveFlat, suggestions.length - 1);

  return {
    change: true,
    suggestion: suggestions[idx],
  };
}
