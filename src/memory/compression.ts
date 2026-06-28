/**
 * Mio — Context compression
 *
 * When conversations grow longer than the model's effective context window,
 * older messages must be compressed into a summary. This module provides
 * the compression logic used by agent-loop.
 *
 * Strategies:
 *   - sliding_window  — Keep last N messages, drop the rest.
 *   - hybrid (default) — Keep first 3 + last 10, summarize the middle into
 *                        a single system-injected compaction note.
 *
 * Token estimation is approximate (no tokenizer dependency):
 *   - CJK: ~1.5 chars per token
 *   - Latin: ~4 chars per token (≈1.3 words per token)
 */

import type { Message } from '../types.js';

// ─── Types ───

export type CompressionStrategy = 'sliding_window' | 'hybrid';

export interface CompressionConfig {
  /** Strategy to use. */
  strategy: CompressionStrategy;
  /** Trigger compression when total estimated tokens exceed this. */
  maxTokens: number;
  /** Number of most recent messages to always keep. */
  keepRecent: number;
  /** Number of oldest messages to always keep (greeting / context-setting). */
  keepOldest: number;
  /**
   * Token budget for the recent window. When set, the recent section is kept
   * round-aware up to this many tokens (never splitting a turn, latest always
   * kept) instead of a fixed message count; `keepRecent` becomes the minimum.
   */
  keepRecentTokens?: number;
}

export interface CompressionResult {
  /** The compressed message list (shorter than input). */
  messages: Message[];
  /** Summary of removed messages (for injection as system context). */
  summary: string;
  /** Short searchable cues that can recall the compressed segment later. */
  recallCues: string[];
  /** How many messages were removed. */
  removedCount: number;
}

// ─── Defaults ───

export const DEFAULT_COMPRESSION: CompressionConfig = {
  strategy: 'hybrid',
  maxTokens: 8000,   // trigger when estimated tokens exceed this
  keepRecent: 10,     // minimum recent messages to keep
  keepOldest: 3,      // always keep first 3 messages
  keepRecentTokens: 2400, // round-aware token budget for the recent window
};

// ─── Token estimation ───

function estimateTokens(text: string): number {
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified
      (code >= 0x3400 && code <= 0x4DBF) || // CJK Extension A
      (code >= 0x3040 && code <= 0x309F) || // Hiragana
      (code >= 0x30A0 && code <= 0x30FF) || // Katakana
      (code >= 0xAC00 && code <= 0xD7AF)     // Hangul
    ) {
      cjk++;
    } else if (code > 127) {
      cjk++; // Other non-ASCII (emoji, etc.)
    } else if (ch !== ' ' && ch !== '\n' && ch !== '\t') {
      latin++;
    }
  }
  // CJK: ~1.5 chars/token, Latin: ~4 chars/token
  return Math.ceil(cjk / 1.5 + latin / 4);
}

function messageTokens(msg: Message): number {
  if (typeof msg.content === 'string') return estimateTokens(msg.content);
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((sum, b) => {
      if (b.type === 'text') return sum + estimateTokens(b.text);
      return sum + 100; // image ≈ 100 tokens
    }, 0);
  }
  return 0;
}

function totalTokens(msgs: Message[]): number {
  return msgs.reduce((sum, m) => sum + messageTokens(m), 0);
}

// ─── Sliding window ───

function slidingWindow(messages: Message[], keepRecent: number): CompressionResult {
  if (messages.length <= keepRecent) {
    return { messages, summary: '', recallCues: [], removedCount: 0 };
  }
  const kept = messages.slice(-keepRecent);
  const removed = messages.slice(0, messages.length - keepRecent);
  return {
    messages: kept,
    summary: '',
    recallCues: buildRecallCues(removed),
    removedCount: removed.length,
  };
}

// ─── Hybrid ───

/**
 * Keep the most recent messages within a token budget, round-aware: never split
 * a turn, never begin on an orphaned assistant message, always keep at least
 * `minKeep` messages and the latest one.
 */
function keepRecentRounds(messages: Message[], budgetTokens: number, minKeep: number): Message[] {
  if (messages.length === 0) return [];
  let used = 0;
  let startIdx = messages.length - 1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const keptCount = messages.length - i;
    const t = messageTokens(messages[i]);
    if (used + t > budgetTokens && keptCount > minKeep) break;
    used += t;
    startIdx = i;
  }
  // round-aware: don't begin on an assistant whose user turn was cut
  while (startIdx < messages.length - 1 && messages[startIdx].role === 'assistant') {
    startIdx++;
  }
  return messages.slice(startIdx);
}

/**
 * Fallback ladder: if the kept set still exceeds the budget, repeatedly drop the
 * older half of the recent window (always keeping oldest + the latest message).
 */
function truncateByHalving(msgs: Message[], maxTokens: number, keepOldestN: number): Message[] {
  const head = msgs.slice(0, keepOldestN);
  let recent = msgs.slice(keepOldestN);
  while (recent.length > 1 && totalTokens([...head, ...recent]) > maxTokens) {
    recent = recent.slice(Math.ceil(recent.length / 2));
  }
  return [...head, ...recent];
}

function textFromMessage(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ');
}

function normalizeCue(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function buildRecallCues(messages: Message[], limit = 6): string[] {
  const userTexts = messages
    .filter((m) => m.role === 'user')
    .map(textFromMessage)
    .map(normalizeCue)
    .filter((t) => t.length >= 4 && !t.startsWith('tool '));
  const cues: string[] = [];
  const seen = new Set<string>();

  for (const text of userTexts) {
    const cue = text.length > 42 ? text.slice(0, 42) : text;
    if (!cue || seen.has(cue)) continue;
    seen.add(cue);
    cues.push(cue);
    if (cues.length >= limit) return cues;
  }

  const allText = userTexts.join(' ');
  const terms = allText
    .split(/[^\p{Script=Han}a-zA-Z0-9_-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 18);
  for (const term of terms) {
    if (seen.has(term)) continue;
    seen.add(term);
    cues.push(term);
    if (cues.length >= limit) break;
  }
  return cues;
}

function hybrid(
  messages: Message[],
  keepOldest: number,
  keepRecent: number,
  maxTokens: number,
  keepRecentTokens?: number,
): CompressionResult {
  if (messages.length <= keepOldest + keepRecent) {
    return { messages, summary: '', recallCues: [], removedCount: 0 };
  }

  const oldest = messages.slice(0, keepOldest);
  const recentPool = messages.slice(keepOldest);
  const recent = keepRecentTokens
    ? keepRecentRounds(recentPool, keepRecentTokens, keepRecent)
    : recentPool.slice(-keepRecent);
  const middle = messages.slice(keepOldest, messages.length - recent.length);

  if (middle.length === 0) {
    return { messages, summary: '', recallCues: [], removedCount: 0 };
  }

  // Build a structured summary of the removed middle section
  const userMsgs = middle.filter((m) => m.role === 'user');

  const summaryParts: string[] = [];
  summaryParts.push(`[对话摘要 — ${middle.length} 条消息被压缩]`);

  // Extract key topics from user messages
  const userTexts = userMsgs
    .map((m) => (typeof m.content === 'string' ? m.content : '[非文本内容]'))
    .filter((t) => t.length > 0);

  if (userTexts.length > 0) {
    summaryParts.push('用户聊到了：');
    // Take a sample — first, middle-ish, last
    const sample = [
      userTexts[0],
      ...(userTexts.length > 3 ? [userTexts[Math.floor(userTexts.length / 2)]] : []),
      userTexts[userTexts.length - 1],
    ];
    for (const t of sample) {
      const short = t.length > 60 ? t.slice(0, 60) + '…' : t;
      summaryParts.push(`- ${short}`);
    }
  }

  // Note assistant tool usage
  const toolMsgs = middle.filter(
    (m) => m.role === 'user' && m.toolResults && m.toolResults.length > 0,
  );
  if (toolMsgs.length > 0) {
    summaryParts.push(`期间使用了 ${toolMsgs.length} 次工具。`);
  }

  const recallCues = buildRecallCues(middle);
  if (recallCues.length > 0) {
    summaryParts.push('召回线索：');
    for (const cue of recallCues) summaryParts.push(`- ${cue}`);
  }

  const summary = summaryParts.join('\n');

  // Fallback ladder: ensure oldest+recent fit the budget even if minKeep forced
  // more than the token budget allows.
  const kept = truncateByHalving([...oldest, ...recent], maxTokens, oldest.length);

  return {
    messages: kept,
    summary,
    recallCues,
    removedCount: messages.length - kept.length,
  };
}

// ─── Main API ───

/**
 * Check if compression is needed and compress if so.
 *
 * Returns the original messages if under the token threshold, or compressed
 * messages + a summary string if over.
 *
 * @param messages    Current message history.
 * @param config      Compression config (uses defaults if omitted).
 * @returns           Compression result (original messages if no compression needed).
 */
export function compressIfNeeded(
  messages: Message[],
  config: Partial<CompressionConfig> = {},
): CompressionResult {
  const cfg: CompressionConfig = { ...DEFAULT_COMPRESSION, ...config };
  const estimated = totalTokens(messages);

  if (estimated <= cfg.maxTokens) {
    return { messages, summary: '', recallCues: [], removedCount: 0 };
  }

  switch (cfg.strategy) {
    case 'sliding_window':
      return slidingWindow(messages, cfg.keepRecent);
    case 'hybrid':
    default:
      return hybrid(messages, cfg.keepOldest, cfg.keepRecent, cfg.maxTokens, cfg.keepRecentTokens);
  }
}

/**
 * Quick check: do these messages need compression?
 */
export function needsCompression(
  messages: Message[],
  maxTokens: number = DEFAULT_COMPRESSION.maxTokens,
): boolean {
  return totalTokens(messages) > maxTokens;
}

/**
 * Estimate total tokens for a message list.
 */
export { totalTokens as estimateTotalTokens };
