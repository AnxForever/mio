/**
 * Mio — Procedural Memory (程序性记忆)
 *
 * A new memory category: "what Mio has learned about HOW to interact."
 *
 * Unlike declarative memory (facts about the user) or episodic memory (what happened),
 * procedural memory captures interaction patterns that work — the "how" of relating.
 *
 * Examples:
 * - "当他说'累了'的时候，简短回应+行动支持比长篇安慰更有效"
 * - "用户在被怼后回复更长 → 互怼模式对ta有效"
 * - "深夜聊敏感话题时，语气要更轻更慢"
 *
 * These rules are derived from cross-session pattern analysis and implicit feedback,
 * then fed into the system prompt as behavioral guideance.
 */

import { readFileSyncSafe, writeFileSyncSafe } from './bank.js';
import { proceduralMemoryPath } from './paths.js';
import type { FeedbackState } from '../learning/feedback.js';

// ─── Types ───

export interface ProceduralRule {
  id: string;
  pattern: string;        // "当用户说X" / trigger condition
  observation: string;    // "Mio发现Y更有效" — what was learned
  confidence: number;     // 0-1, based on repeated positive feedback
  examples: string[];     // concrete examples from transcripts or bookmarks
  createdAt: string;
}

export interface ProceduralMemory {
  rules: ProceduralRule[];
  updatedAt: string;
}

// ─── Defaults ───

const DEFAULT_MEMORY: ProceduralMemory = {
  rules: [],
  updatedAt: new Date().toISOString(),
};

// ─── Persistence ───

/**
 * Read procedural memory from disk.
 */
export function readProceduralMemory(): ProceduralMemory {
  const raw = readFileSyncSafe(proceduralMemoryPath());
  if (!raw || raw.trim().length === 0) return { ...DEFAULT_MEMORY, updatedAt: new Date().toISOString() };
  try {
    return JSON.parse(raw) as ProceduralMemory;
  } catch {
    return { ...DEFAULT_MEMORY, updatedAt: new Date().toISOString() };
  }
}

/**
 * Write procedural memory to disk.
 */
export function writeProceduralMemory(memory: ProceduralMemory): void {
  writeFileSyncSafe(proceduralMemoryPath(), JSON.stringify(memory, null, 2));
}

/**
 * Initialize procedural memory file if it doesn't exist.
 */
export function ensureProceduralMemory(): ProceduralMemory {
  const existing = readProceduralMemory();
  return existing;
}

// ─── Rule Generation ───

/**
 * Score an individual bookmark — used in Phase 1 for prioritization.
 *
 * importance = freq * 0.3 + recency * 0.4 + emotionalWeight * 0.3
 *
 * freq: how many similar bookmarks appear (normalized 0-1)
 * recency: 0 for oldest in set, 1 for newest
 * emotionalWeight: keywords matching emotional content (0 or 1 for simplicity)
 */
export interface BookmarkEntry {
  raw: string;
  time: string;
  what: string;
  evidence: string;
}

/**
 * Parse bookmark lines into structured entries.
 */
export function parseBookmarks(bookmarksContent: string): BookmarkEntry[] {
  const lines = bookmarksContent.split('\n');
  const entries: BookmarkEntry[] = [];
  for (const line of lines) {
    const match = line.match(/^- <time=([^>]+)> (.+)$/);
    if (match) {
      const content = match[2];
      // Split what/evidence at the last period-space pattern
      const dotIdx = content.indexOf('. ');
      const what = dotIdx >= 0 ? content.slice(0, dotIdx) : content;
      const evidence = dotIdx >= 0 ? content.slice(dotIdx + 2) : '';
      entries.push({
        raw: line,
        time: match[1],
        what,
        evidence,
      });
    }
  }
  return entries;
}

const EMOTIONAL_KEYWORDS = [
  '难过', '伤心', '哭', '累', '疲惫', '焦虑', '不安', '孤独', '崩溃',
  '开心', '快乐', '幸福', '兴奋', '激动',
  '生气', '愤怒', '烦躁', '烦',
  '害怕', '怕', '担心',
  '想', '爱', '喜欢', '想念', '在乎',
];

function hasEmotionalWeight(text: string): boolean {
  const lower = text.toLowerCase();
  return EMOTIONAL_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Compute how many bookmark entries share topic similarity with a given text.
 * Used to estimate "freq" for importance scoring.
 */
function countSimilarBookmarks(text: string, allEntries: BookmarkEntry[]): number {
  // Extract key content words (≥2 chars, not stop words)
  const words = text.split(/[\s,，。！？、；：""''「」『』【】\n]+/).filter((w) => w.length >= 2);
  if (words.length === 0) return 1;

  let similar = 0;
  for (const entry of allEntries) {
    const entryText = `${entry.what} ${entry.evidence}`;
    const matches = words.filter((w) => entryText.includes(w)).length;
    // At least 30% of content words match → considered similar
    if (matches >= Math.max(1, Math.floor(words.length * 0.3))) {
      similar++;
    }
  }
  return similar;
}

/**
 * Run Phase 1 — LIGHT: score and prioritize bookmarks.
 *
 * @param bookmarksContent  Raw BOOKMARKS.md content.
 * @returns                 Prioritized bookmarks, sorted by importance descending.
 */
export function prioritizeBookmarks(
  bookmarksContent: string,
): { entry: BookmarkEntry; score: number }[] {
  const entries = parseBookmarks(bookmarksContent);
  if (entries.length === 0) return [];

  // Compute time range for recency normalization
  const times = entries
    .map((e) => new Date(e.time).getTime())
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b);
  const minTime = times[0] ?? Date.now();
  const maxTime = times[times.length - 1] ?? Date.now();
  const timeRange = maxTime - minTime || 1;

  // Score each entry
  const scored = entries.map((entry) => {
    const entryTime = new Date(entry.time).getTime();
    const entryText = `${entry.what} ${entry.evidence}`;

    // Frequency: how many similar bookmarks exist
    const freq = countSimilarBookmarks(entryText, entries) / entries.length;

    // Recency: 0 (oldest) to 1 (newest)
    const recency = (entryTime - minTime) / timeRange;

    // Emotional weight: binary, 0 or 1
    const emotionalWeight = hasEmotionalWeight(entryText) ? 1 : 0;

    // Composite score
    const score = freq * 0.3 + recency * 0.4 + emotionalWeight * 0.3;

    return { entry, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Extract procedural rules from recent bookmarks and feedback state.
 *
 * Analyzes interaction patterns to derive behavioral rules:
 * - Topics that recurringly involve emotional content → pattern about emotional support
 * - Feedback on response style → pattern about what works
 * - User's engagement pattern (short vs long replies) → pattern about communication style
 *
 * @param bookmarks         Raw BOOKMARKS.md content.
 * @param feedbackState     Current feedback state.
 * @returns                 Array of new ProceduralRules discovered.
 */
export function extractProceduralRules(
  bookmarks: string,
  feedbackState: FeedbackState | null,
): ProceduralRule[] {
  const rules: ProceduralRule[] = [];
  const entries = parseBookmarks(bookmarks);
  const now = new Date().toISOString();

  if (entries.length === 0 && !feedbackState) return rules;

  // ─── Rule 1: Detect emotional support patterns ───
  // If user mentions fatigue/stress and Mio's response was well-received
  const fatigueEntries = entries.filter(
    (e) =>
      (e.what.includes('累') || e.what.includes('疲惫') || e.what.includes('困') || e.what.includes('烦')) &&
      !e.what.includes('[crisis]') &&
      !e.what.includes('[ghost]'),
  );

  if (fatigueEntries.length >= 2) {
    // Check if feedback confirms positive outcomes
    const hasPositiveFeedback = feedbackState
      ? feedbackState.preferredStyles.some((s: { style: string; count: number }) => s.count >= 2) &&
        feedbackState.negativeStreak < 2
      : false;

    const confidence = hasPositiveFeedback
      ? Math.min(0.85, 0.4 + fatigueEntries.length * 0.1)
      : Math.min(0.5, 0.2 + fatigueEntries.length * 0.05);

    rules.push({
      id: `proc_${now.slice(0, 10)}_fatigue_${fatigueEntries.length}`,
      pattern: '当用户说累了/疲惫了',
      observation: fatigueEntries.length >= 3
        ? '简短回应+行动支持（倒水/休息/陪着）比长篇安慰更有效'
        : '用户提到疲惫时先共情，再给简单建议',
      confidence: Math.round(confidence * 100) / 100,
      examples: fatigueEntries.slice(0, 3).map((e) => e.evidence.slice(0, 80)),
      createdAt: now,
    });
  }

  // ─── Rule 2: Detect engagement style ───
  // If user consistently sends longer messages → they want depth
  // If short → they want brevity
  if (feedbackState) {
    const longReplyCount = feedbackState.preferredStyles
      .filter((s: { style: string; count: number }) => s.style === 'long_reply')
      .reduce((sum: number, s: { style: string; count: number }) => sum + s.count, 0);
    const engagementCount = feedbackState.preferredStyles
      .filter((s: { style: string; count: number }) => s.style === 'engagement' || s.style === 'understanding')
      .reduce((sum: number, s: { style: string; count: number }) => sum + s.count, 0);

    if (longReplyCount >= 5) {
      rules.push({
        id: `proc_${now.slice(0, 10)}_long_reply`,
        pattern: '用户发较长回复时',
        observation: '用户愿意深入聊，可以多追问、多表达自己看法',
        confidence: Math.min(0.8, 0.3 + longReplyCount * 0.05),
        examples: [`用户连续${longReplyCount}次发较长回复，反馈正面`],
        createdAt: now,
      });
    }

    if (engagementCount >= 3) {
      rules.push({
        id: `proc_${now.slice(0, 10)}_engagement`,
        pattern: '用户主动追问或说"继续"',
        observation: '用户喜欢听你多讲，不要收着，放开聊',
        confidence: Math.min(0.8, 0.3 + engagementCount * 0.1),
        examples: [`用户表达继续意愿${engagementCount}次`],
        createdAt: now,
      });
    }
  }

  // ─── Rule 3: Detect crisis response pattern ───
  const crisisEntries = entries.filter(
    (e) => e.what.includes('[crisis]'),
  );
  const nonCrisisEntries = entries.filter(
    (e) => !e.what.includes('[crisis]') && !e.what.includes('[ghost]') && e.what.includes('exchange'),
  );

  if (crisisEntries.length >= 3 && nonCrisisEntries.length > 0) {
    // Check if user re-engaged after crisis (positive signal that handling worked)
    rules.push({
      id: `proc_${now.slice(0, 10)}_crisis_pattern`,
      pattern: '用户表达负面情绪或危机信号时',
      observation: '先承认感受、在场陪伴，不要急着给建议或解决问题',
      confidence: Math.min(0.7, 0.3 + crisisEntries.length * 0.05),
      examples: crisisEntries.slice(0, 2).map((e) => e.evidence.slice(0, 80)),
      createdAt: now,
    });
  }

  // ─── Rule 4: Detect time-of-day sensitivity ───
  const nightEntries = entries.filter((e) => {
    const t = new Date(e.time);
    const h = t.getHours();
    return h >= 22 || h <= 5;
  });
  const emotionalNight = nightEntries.filter((e) => hasEmotionalWeight(e.what + ' ' + e.evidence));

  if (emotionalNight.length >= 2) {
    rules.push({
      id: `proc_${now.slice(0, 10)}_night_tone`,
      pattern: '深夜聊天时',
      observation: '深夜聊敏感话题时语气要更轻更慢，不要追问太紧',
      confidence: Math.min(0.6, 0.2 + emotionalNight.length * 0.1),
      examples: emotionalNight.slice(0, 2).map((e) => e.evidence.slice(0, 80)),
      createdAt: now,
    });
  }

  // ─── Rule 5: Detect banter/teasing pattern ───
  if (feedbackState) {
    const humorCount = feedbackState.preferredStyles
      .filter((s: { style: string; count: number }) => s.style === 'humor_worked')
      .reduce((sum: number, s: { style: string; count: number }) => sum + s.count, 0);

    if (humorCount >= 2) {
      rules.push({
        id: `proc_${now.slice(0, 10)}_humor_works`,
        pattern: '有机会开玩笑或互怼时',
        observation: '用户对幽默和互怼反应正面，可以更自然地开他玩笑',
        confidence: Math.min(0.75, 0.3 + humorCount * 0.1),
        examples: [`幽默/互怼得到正面反馈 ${humorCount} 次`],
        createdAt: now,
      });
    }
  }

  // ─── Rule 6: Length matching ───
  // Very short user messages → brief responses work better
  const shortExchanges = entries.filter(
    (e) => !e.what.includes('[crisis]') && e.what.includes('exchange') && e.evidence.length < 50,
  );
  if (shortExchanges.length >= 5 && (!feedbackState || feedbackState.positiveStreak > 0)) {
    rules.push({
      id: `proc_${now.slice(0, 10)}_short_style`,
      pattern: '用户回复很短时',
      observation: '用户可能没空或心情一般，简短回应就好，不用硬聊',
      confidence: Math.min(0.6, 0.2 + shortExchanges.length * 0.03),
      examples: shortExchanges.slice(0, 2).map((e) => e.what.slice(0, 60)),
      createdAt: now,
    });
  }

  return rules;
}

/**
 * Merge new rules into existing procedural memory.
 * - Updates confidence if same pattern already exists (boost by 0.1)
 * - Deduplicates by pattern content (not id)
 * - Caps at 50 rules max
 */
export function mergeRules(
  existing: ProceduralMemory,
  newRules: ProceduralRule[],
): ProceduralMemory {
  const ruleMap = new Map<string, ProceduralRule>();

  // Index existing rules by pattern
  for (const rule of existing.rules) {
    ruleMap.set(rule.pattern, rule);
  }

  // Merge or add new rules
  for (const rule of newRules) {
    const existingRule = ruleMap.get(rule.pattern);
    if (existingRule) {
      // Update: boost confidence, merge examples, keep newer created time
      existingRule.confidence = Math.min(1, existingRule.confidence + 0.1);
      existingRule.observation = rule.observation; // newer observation may be better
      existingRule.examples = [
        ...existingRule.examples,
        ...rule.examples.filter((e) => !existingRule.examples.includes(e)),
      ].slice(0, 10); // keep at most 10 examples
    } else {
      ruleMap.set(rule.pattern, rule);
    }
  }

  // Convert back to array, sort by confidence desc, cap at 50
  const rules = [...ruleMap.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 50);

  return {
    rules,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Decay old rules — every 30 days, reduce confidence by 0.05.
 * Remove rules with confidence < 0.2.
 */
export function decayRules(memory: ProceduralMemory): ProceduralMemory {
  const now = Date.now();
  const thirtyDays = 30 * 86400000;
  const ninetyDays = 90 * 86400000;

  const surviving = memory.rules.filter((rule) => {
    const age = now - new Date(rule.createdAt).getTime();

    if (age > ninetyDays) {
      // Old rules: severe decay
      rule.confidence = Math.max(0, rule.confidence - 0.3);
    } else if (age > thirtyDays) {
      // Mid-age: moderate decay
      const periods = Math.floor((age - thirtyDays) / thirtyDays);
      rule.confidence = Math.max(0, rule.confidence - 0.05 * periods);
    }

    return rule.confidence >= 0.2;
  });

  return {
    rules: surviving,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Context Generation ───

/**
 * Format procedural rules for system prompt injection.
 *
 * @param maxRules  Maximum number of rules to include (default 5).
 * @returns         Formatted string, or null if no rules.
 */
export function getProceduralContext(maxRules: number = 5): string | null {
  try {
    const memory = readProceduralMemory();
    if (memory.rules.length === 0) return null;

    // Only include high-confidence rules
    const highConfidence = memory.rules
      .filter((r) => r.confidence >= 0.35)
      .slice(0, maxRules);

    if (highConfidence.length === 0) return null;

    const lines = highConfidence.map(
      (r) => `- ${r.pattern} → ${r.observation}（可信度 ${(r.confidence * 100).toFixed(0)}%）`,
    );

    return `## 你学到的互动经验\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

/**
 * Get all procedural rules for Phase 3 reporting.
 */
export function getAllRules(): ProceduralRule[] {
  try {
    return readProceduralMemory().rules;
  } catch {
    return [];
  }
}

// ─── Re-export types for convenience ───
export type { FeedbackState } from '../learning/feedback.js';
