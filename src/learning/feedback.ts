/**
 * Mio — Implicit Feedback Learning (隐式反馈学习)
 *
 * Users rarely say "that was a good response" or "that was bad." But they
 * constantly send IMPLICIT signals:
 *
 *   Positive:  "哈哈" "对对对" "说得好" long reply, follow-up question
 *   Negative:  "不是..." "你没懂" "别这么说" "算了" short reply, topic change
 *   Neutral:   "嗯" "哦" "好的" — user is polite but disengaged
 *
 * This module detects these signals and adjusts Mio's behavior accordingly.
 * It's a lightweight pattern matcher — no LLM calls, pure heuristics.
 *
 * Persisted to data/feedback-state.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getDataDir } from '../config.js';

// ─── Types ───

type FeedbackSignal = 'positive' | 'negative' | 'neutral';

interface FeedbackEntry {
  timestamp: string;
  signal: FeedbackSignal;
  userMessage: string;    // truncated to 100 chars
  agentReply: string;     // truncated to 100 chars
  pattern: string;        // which pattern triggered
}

export interface FeedbackState {
  recent: FeedbackEntry[];       // last 20 feedback events
  positiveStreak: number;
  negativeStreak: number;
  /** Patterns that got negative feedback — Mio should avoid these. */
  avoidedPatterns: { pattern: string; count: number }[];
  /** Response styles that got positive feedback. */
  preferredStyles: { style: string; count: number }[];
  updatedAt: string;
}

// ─── Defaults ───

const DEFAULT_STATE: FeedbackState = {
  recent: [],
  positiveStreak: 0,
  negativeStreak: 0,
  avoidedPatterns: [],
  preferredStyles: [],
  updatedAt: new Date().toISOString(),
};

// ─── Persistence ───

function statePath(): string {
  return `${getDataDir()}/feedback-state.json`;
}

function readState(): FeedbackState {
  const p = statePath();
  try {
    if (existsSync(p)) return { ...DEFAULT_STATE, ...JSON.parse(readFileSync(p, 'utf-8')) };
  } catch { /* corrupt */ }
  return { ...DEFAULT_STATE };
}

function writeState(state: FeedbackState): void {
  const p = statePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Signal detection ───

const POSITIVE_PATTERNS: { regex: RegExp; style: string }[] = [
  { regex: /^(哈{2,}|w{2,}|lol{2,}|笑死|草{2,}|笑死我了)/i, style: 'humor_worked' },
  { regex: /对对对|说得对|确实|没错|就是这样/, style: 'agreement' },
  { regex: /你好懂|你怎么知道|你居然记得/, style: 'understanding' },
  { regex: /继续|然后呢|后来呢|接着说/, style: 'engagement' },
  { regex: /谢谢你|多亏你|还好有你|有你真好/, style: 'appreciation' },
  { regex: /抱抱|贴贴|亲亲|mua|爱你/, style: 'affection' },
];

const NEGATIVE_PATTERNS: { regex: RegExp; pattern: string }[] = [
  { regex: /不是[，。！]|不对[，。！]|你没懂|你没理解|你误会了/, pattern: 'misunderstood' },
  { regex: /别这么说|不要这样|别这样|不用这样/, pattern: 'too_intense' },
  { regex: /算了[，。！]?$|不想说了|随便/, pattern: 'user_disengaged' },
  { regex: /你又来了|老一套|怎么又说这个|又是这句/, pattern: 'repetitive' },
  { regex: /你太.*了|你好.*啊/, pattern: 'too_much' },
];

const NEUTRAL_PATTERNS = [
  /^嗯+$/,
  /^哦+$/,
  /^好[的吧]*$/,
  /^行[了吧]*$/,
  /^知道了?$/,
];

/**
 * Detect feedback signal from the user's NEXT message.
 *
 * This is called when the user replies to Mio — we analyze whether their
 * reply signals approval, disapproval, or neutrality about Mio's last response.
 *
 * @param userMessage   The user's current message (reply to Mio's last response).
 * @param agentReply    Mio's last response (what the user is reacting to).
 * @returns             The detected signal.
 */
export function detectFeedback(userMessage: string, agentReply: string): FeedbackSignal {
  for (const { regex, pattern } of NEGATIVE_PATTERNS) {
    if (regex.test(userMessage)) {
      recordFeedback('negative', userMessage, agentReply, pattern);
      return 'negative';
    }
  }

  // Neutral check BEFORE positive — a short "嗯" shouldn't be over-interpreted
  for (const pattern of NEUTRAL_PATTERNS) {
    if (pattern.test(userMessage.trim())) {
      recordFeedback('neutral', userMessage, agentReply, 'short_reply');
      return 'neutral';
    }
  }

  for (const { regex, style } of POSITIVE_PATTERNS) {
    if (regex.test(userMessage)) {
      recordFeedback('positive', userMessage, agentReply, style);
      return 'positive';
    }
  }

  // Default: longer replies = positive engagement
  if (userMessage.trim().length > 20) {
    recordFeedback('positive', userMessage, agentReply, 'long_reply');
    return 'positive';
  }

  return 'neutral';
}

// ─── Recording ───

function recordFeedback(
  signal: FeedbackSignal,
  userMessage: string,
  agentReply: string,
  pattern: string,
): void {
  const state = readState();

  state.recent.push({
    timestamp: new Date().toISOString(),
    signal,
    userMessage: userMessage.slice(0, 100),
    agentReply: agentReply.slice(0, 100),
    pattern,
  });
  if (state.recent.length > 20) state.recent = state.recent.slice(-20);

  // Update streaks
  if (signal === 'positive') {
    state.positiveStreak++;
    state.negativeStreak = 0;
    // Record preferred style
    const existing = state.preferredStyles.find((s) => s.style === pattern);
    if (existing) existing.count++;
    else state.preferredStyles.push({ style: pattern, count: 1 });
  } else if (signal === 'negative') {
    state.negativeStreak++;
    state.positiveStreak = 0;
    const existing = state.avoidedPatterns.find((a) => a.pattern === pattern);
    if (existing) existing.count++;
    else state.avoidedPatterns.push({ pattern, count: 1 });
  }

  state.updatedAt = new Date().toISOString();
  writeState(state);
}

// ─── Context generation ───

/**
 * Get a feedback-informed hint for the system prompt.
 * Returns null if there's not enough data.
 */
export function getFeedbackHint(): string | null {
  const state = readState();
  if (state.recent.length < 5) return null;

  const parts: string[] = [];

  // Negative streak warning
  if (state.negativeStreak >= 2) {
    parts.push('他前两句回复都冷冷的——你换个方式说话，别继续刚才那个风格。');
  }

  // Top avoided patterns
  const topAvoided = state.avoidedPatterns
    .filter((a) => a.count >= 2)
    .slice(0, 3);
  if (topAvoided.length > 0) {
    const labels: Record<string, string> = {
      misunderstood: '他刚才觉得你没懂他。慢一点，先确认你听懂了再说。',
      too_intense: '你刚才的反应太过了。收一收。',
      repetitive: '你刚才的话他听过太多次了。换种说法，或者干脆不说。',
      too_much: '你刚才有点过了。自然一点，不用那么刻意。',
    };
    for (const a of topAvoided) {
      if (labels[a.pattern]) parts.push(labels[a.pattern]);
    }
  }

  // Preferred styles
  const topStyles = state.preferredStyles.sort((a, b) => b.count - a.count).slice(0, 2);
  if (topStyles.length > 0 && state.positiveStreak >= 2) {
    parts.push('他最近挺喜欢跟你聊的。保持现在这个感觉。');
  }

  return parts.length > 0 ? `## 关于刚才的对话\n${parts.join('\n')}` : null;
}

/**
 * Get the raw feedback state (for analytics).
 */
export function getFeedbackState(): FeedbackState {
  return readState();
}
