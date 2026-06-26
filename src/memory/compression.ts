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
}

export interface CompressionResult {
  /** The compressed message list (shorter than input). */
  messages: Message[];
  /** Summary of removed messages (for injection as system context). */
  summary: string;
  /** How many messages were removed. */
  removedCount: number;
}

// ─── Defaults ───

export const DEFAULT_COMPRESSION: CompressionConfig = {
  strategy: 'hybrid',
  maxTokens: 8000,   // trigger when estimated tokens exceed this
  keepRecent: 10,     // always keep last 10 messages
  keepOldest: 3,      // always keep first 3 messages
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
    return { messages, summary: '', removedCount: 0 };
  }
  const kept = messages.slice(-keepRecent);
  const removed = messages.slice(0, messages.length - keepRecent);
  return {
    messages: kept,
    summary: '',
    removedCount: removed.length,
  };
}

// ─── Hybrid ───

function hybrid(messages: Message[], keepOldest: number, keepRecent: number): CompressionResult {
  if (messages.length <= keepOldest + keepRecent) {
    return { messages, summary: '', removedCount: 0 };
  }

  const oldest = messages.slice(0, keepOldest);
  const recent = messages.slice(-keepRecent);
  const middle = messages.slice(keepOldest, messages.length - keepRecent);

  // Build a structured summary of the removed middle section
  const userMsgs = middle.filter((m) => m.role === 'user');
  const assistantMsgs = middle.filter((m) => m.role === 'assistant');

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

  const summary = summaryParts.join('\n');

  return {
    messages: [...oldest, ...recent],
    summary,
    removedCount: middle.length,
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
    return { messages, summary: '', removedCount: 0 };
  }

  switch (cfg.strategy) {
    case 'sliding_window':
      return slidingWindow(messages, cfg.keepRecent);
    case 'hybrid':
    default:
      return hybrid(messages, cfg.keepOldest, cfg.keepRecent);
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
