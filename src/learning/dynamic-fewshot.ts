/**
 * Mio — Dynamic Few-Shot Learning
 *
 * Replaces the static BAD/GOOD examples in the soul/prompt with examples
 * that grow from real conversations. The bank starts empty — first ~20 turns
 * there's no dynamic data, static few-shot handles cold start.
 *
 * Architecture:
 *   collectFromFeedback()    ← called after each turn (fire-and-forget)
 *   getDynamicFewShot()      ← called during prompt assembly
 *   rotateBank()             ← called periodically to decay stale examples
 *
 * Persisted to data/fewshot-bank.json
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { getDataDir } from '../config.js';
import { readTranscript } from '../memory/transcript.js';
import type { FeedbackState } from './feedback.js';
import { writeFileSyncSafe } from '../memory/bank.js';

// ─── Types ───

export interface FewShotExample {
  id: string;
  type: 'good' | 'bad';
  userMessage: string;
  agentReply: string;
  context: string;
  source: string;
  timestamp: string;
  score: number;
  usageCount: number;
}

export interface FewShotBank {
  good: FewShotExample[];
  bad: FewShotExample[];
  updatedAt: string;
}

// ─── Defaults ───

const DEFAULT_BANK: FewShotBank = {
  good: [],
  bad: [],
  updatedAt: new Date().toISOString(),
};

const MAX_GOOD = 10;
const MAX_BAD = 5;

// ─── Persistence ───

function bankPath(): string {
  return `${getDataDir()}/fewshot-bank.json`;
}

function readBank(): FewShotBank {
  const p = bankPath();
  try {
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, 'utf-8')) as FewShotBank;
      return {
        good: parsed.good ?? [],
        bad: parsed.bad ?? [],
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    }
  } catch {
    // corrupt file — start fresh
  }
  return { ...DEFAULT_BANK, good: [], bad: [] };
}

function writeBank(bank: FewShotBank): void {
  const p = bankPath();
  writeFileSyncSafe(p, JSON.stringify(bank, null, 2));
}

// ─── Helpers ───

/**
 * Generate a short unique id for an example.
 */
function exampleId(): string {
  return `fs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Derive a human-readable context string from the feedback pattern.
 */
function deriveContext(pattern: string, type: 'good' | 'bad'): string {
  const goodLabels: Record<string, string> = {
    humor_worked: '简短幽默→他接着聊了',
    agreement: '接住他的话→他感觉被理解',
    understanding: '表现出懂他→他说"你怎么知道"',
    engagement: '留了话口→他主动继续',
    appreciation: '真诚回应→他表达了感谢',
    affection: '自然亲昵→他回应了',
    long_reply: '回复有内容→他认真回了一段',
  };

  const badLabels: Record<string, string> = {
    misunderstood: '没抓住重点→他说"不是这样"',
    too_intense: '反应太过了→他说"别这么说"',
    user_disengaged: '太说教→他说"算了不说了"',
    repetitive: '说过的话又说→他说"又来了"',
    too_much: '用力过猛→他觉得不自然',
  };

  if (type === 'good') return goodLabels[pattern] ?? '正面反馈→他喜欢这个回应';
  return badLabels[pattern] ?? '负面反馈→他反应冷淡';
}

/**
 * Score an example based on pattern count and signal strength.
 * Used for dedup: if an entry with the same userMessage snippet exists,
 * increment its score instead of creating a duplicate.
 */
function calculateScore(patternCount: number, signalStrength: number): number {
  // Base score from feedback count + a bonus for strong signal patterns
  return patternCount * 2 + (signalStrength >= 2 ? 3 : 0);
}

// ─── Core ───

/**
 * Post-turn: analyze feedback-state.json to extract few-shot examples
 * from real conversations.
 *
 * This is the LEARNING side — it reads what happened in feedback and
 * preserves user-msg / agent-reply pairs as learning examples.
 *
 * Designed to be called fire-and-forget (no blocking).
 */
export async function collectFromFeedback(): Promise<void> {
  try {
    const feedbackPath = `${getDataDir()}/feedback-state.json`;
    if (!existsSync(feedbackPath)) return;

    const raw = readFileSync(feedbackPath, 'utf-8');
    const feedback: FeedbackState = JSON.parse(raw);
    if (!feedback.recent || feedback.recent.length < 3) return;

    const bank = readBank();
    const now = new Date().toISOString();

    for (const entry of feedback.recent) {
      if (entry.signal === 'neutral') continue;

      const type: 'good' | 'bad' = entry.signal === 'positive' ? 'good' : 'bad';

      // Check for duplicate by userMessage snippet (first 20 chars)
      const snippet = entry.userMessage.slice(0, 20);
      const existingIdx = bank[type].findIndex((e) =>
        e.userMessage.startsWith(snippet),
      );

      if (existingIdx >= 0) {
        // Increment score — this pattern was reconfirmed
        bank[type][existingIdx].score += 2;
        bank[type][existingIdx].usageCount += 1;
        continue;
      }

      // Try to find the full user-msg / agent-reply pair from transcript
      // We look at the latest session transcript for context enrichment
      let context = deriveContext(entry.pattern, type);
      let userMsg = entry.userMessage;
      let agentReply = entry.agentReply;
      let source = 'feedback';

      // Try to find a richer pair in transcript if entry has a session hint
      const sessions = await findRecentSessions();
      for (const sessionId of sessions) {
        const entries = readTranscript(sessionId);
        for (let i = 0; i < entries.length - 1; i++) {
          const curr = entries[i];
          const next = entries[i + 1];
          if (
            curr.role === 'user' &&
            next.role === 'assistant' &&
            curr.content &&
            next.content &&
            curr.content.includes(entry.userMessage.slice(0, 30))
          ) {
            userMsg = curr.content.slice(0, 100);
            agentReply = next.content.slice(0, 100);
            source = sessionId;
            break;
          }
        }
      }

      const example: FewShotExample = {
        id: exampleId(),
        type,
        userMessage: userMsg,
        agentReply: agentReply,
        context,
        source,
        timestamp: now,
        score: calculateScore(entry.signal === 'positive' ? 1 : 1, 1),
        usageCount: 1,
      };

      if (type === 'good') {
        bank.good.push(example);
        if (bank.good.length > MAX_GOOD) {
          // Keep only the highest-scored
          bank.good.sort((a, b) => b.score - a.score);
          bank.good = bank.good.slice(0, MAX_GOOD);
        }
      } else {
        bank.bad.push(example);
        if (bank.bad.length > MAX_BAD) {
          bank.bad.sort((a, b) => b.score - a.score);
          bank.bad = bank.bad.slice(0, MAX_BAD);
        }
      }
    }

    bank.updatedAt = now;
    writeBank(bank);
  } catch {
    // Fire-and-forget — never crash the turn
  }
}

/**
 * Find recent session IDs we can read transcripts from.
 */
async function findRecentSessions(): Promise<string[]> {
  try {
    // Dynamic import to avoid circular dependency at module level
    const { transcriptsDir } = await import('../memory/paths.js');
    const dir = transcriptsDir();
    if (!existsSync(dir)) return [];
    const names = readdirSync(dir).filter((f: string) => f.endsWith('.jsonl'));
    return names.map((f: string) => f.replace(/\.jsonl$/, '')).slice(-5);
  } catch {
    return [];
  }
}

/**
 * Get the dynamic few-shot prompt fragment.
 *
 * Selects top 3 good + top 2 bad examples (rotated to avoid staleness),
 * increments usageCount.
 *
 * Returns null when the bank is too sparse or the feature hasn't
 * collected enough data yet (< 3 examples).
 *
 * This COMPLEMENTS the static FEWSHOT template, not replaces it.
 */
export function getDynamicFewShot(): string | null {
  const bank = readBank();

  // Cold start: need at least 3 examples before we inject anything
  if (bank.good.length + bank.bad.length < 3) return null;

  // Sort by score (descending), with rotation based on usageCount
  // to avoid always showing the same examples
  const goodRanked = [...bank.good].sort((a, b) => {
    // Lower usage count = higher priority (rotate to avoid staleness)
    const usageWeight = (b.usageCount - a.usageCount) * 0.3;
    return b.score - a.score + usageWeight;
  });

  const badRanked = [...bank.bad].sort((a, b) => {
    const usageWeight = (b.usageCount - a.usageCount) * 0.3;
    return b.score - a.score + usageWeight;
  });

  const topGood = goodRanked.slice(0, 3);
  const topBad = badRanked.slice(0, 2);

  // Increment usageCount for selected examples
  for (const eg of [...topGood, ...topBad]) {
    const targetList = eg.type === 'good' ? bank.good : bank.bad;
    const idx = targetList.findIndex((e) => e.id === eg.id);
    if (idx >= 0) {
      targetList[idx].usageCount += 1;
    }
  }
  writeBank(bank);

  // Format as Chinese prompt fragment
  const lines: string[] = [
    '## 从你们对话中学到的',
    '这些是从你们的真实对话中总结的——什么让他开心，什么让他冷淡。',
    '',
  ];

  if (topGood.length > 0) {
    lines.push('✅ 这样说他给了正面反馈:');
    for (const eg of topGood) {
      lines.push(`用户: "${eg.userMessage}"`);
      lines.push(`你: "${eg.agentReply}"`);
      lines.push(`→ ${eg.context}`);
      lines.push('');
    }
  }

  if (topBad.length > 0) {
    lines.push('❌ 避免这样说（他反应冷淡）:');
    for (const eg of topBad) {
      lines.push(`用户: "${eg.userMessage}"`);
      lines.push(`你: "${eg.agentReply}"`);
      lines.push(`→ ${eg.context}`);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

/**
 * Decay old examples — reduce score by 1 per call; remove if score < 2.
 * Call this periodically (e.g., on session end or at startup) to prevent
 * stagnation.
 */
export function rotateBank(): void {
  const bank = readBank();
  const now = new Date().toISOString();

  // Decay: reduce score by 1 for all examples
  bank.good = bank.good
    .map((e) => ({ ...e, score: e.score - 1 }))
    .filter((e) => e.score >= 2);

  bank.bad = bank.bad
    .map((e) => ({ ...e, score: e.score - 1 }))
    .filter((e) => e.score >= 2);

  bank.updatedAt = now;
  writeBank(bank);
}

/**
 * Get a quality score (0-1) for the dynamic few-shot bank.
 *
 * Quality factors:
 *   - Coverage: how many examples relative to max
 *   - Average score: how confident we are in the examples
 *   - Diversity: having both good and bad examples
 */
export function getFewShotQuality(): number {
  const bank = readBank();
  if (bank.good.length + bank.bad.length === 0) return 0;

  // Coverage score (0-0.4): how full the bank is
  const goodCoverage = bank.good.length / MAX_GOOD; // 0-1
  const badCoverage = bank.bad.length / MAX_BAD;    // 0-1
  const coverageScore = (goodCoverage + badCoverage) / 2 * 0.4;

  // Average score (0-0.4): confidence
  const allScores = [...bank.good, ...bank.bad].map((e) => e.score);
  const avgScore = allScores.length > 0
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : 0;
  // Score of 10+ is max confidence; scale linearly
  const scoreNormalized = Math.min(avgScore / 10, 1) * 0.4;

  // Diversity bonus (0-0.2): having both types
  const diversityBonus = bank.good.length > 0 && bank.bad.length > 0 ? 0.2 : 0;

  return Math.min(coverageScore + scoreNormalized + diversityBonus, 1);
}
