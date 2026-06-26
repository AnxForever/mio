/**
 * Mio — Adaptive History AFM (Adaptive Fidelity Management)
 *
 * Three-fidelity conversation history management:
 *
 *   FULL (100%):       last 5 messages — always kept verbatim
 *   COMPRESSED (30%):  messages 6-15 — summarized to 1-2 lines each
 *   PLACEHOLDER (5%):  messages 16+ — "[...更早的对话，共N条]"
 *
 * Design principles:
 *   - No LLM calls. Everything is heuristic/text-based.
 *   - Importance scoring via classifyImportance() uses pattern matching +
 *     intent classification results to decide which messages survive.
 *   - The compressed representation avoids tokenizer dependencies; uses
 *     the same CJK/Latin estimation as compression.ts.
 *   - Adaptive History can run in ADDITION to the existing compression.ts
 *     (which handles the old sliding-window/hybrid compression for the
 *     pre-existing conversation-store feature). They are independent.
 *
 * Integration:
 *   - Called from agent-loop.ts during message-history construction.
 *   - Feature-gated by config.features.adaptiveHistory (default: false).
 *   - When enabled, replaces the simple `loadTranscriptWindow(N)` call with
 *     `compressHistory()` to manage up to ~500 messages efficiently.
 */

import type { Message } from '../types.js';
import type { IntentResult } from '../emotion/classifier.js';

// ─── Constants ───────────────────────────────────────────────────────────

/** Fidelity zone: always keep these many most-recent messages at FULL fidelity. */
const FULL_FIDELITY_COUNT = 5;

/** Fidelity zone: next N messages are COMPRESSED (1-2 line summary each). */
const COMPRESSED_ZONE_COUNT = 10;

/** Maximum length of a compressed message line (characters). */
const MAX_COMPRESSED_LINE_LENGTH = 50;

/**
 * Importance score weights.
 * These are the base weights; the actual score is base + (recency_bonus * recency_ratio).
 */
const IMPORTANCE_WEIGHTS = {
  /** Emotional content (sadness, excitement, anger, etc.). */
  EMOTIONAL_CONTENT: 0.3,
  /** User asked a question. */
  QUESTION_ASKED: 0.2,
  /** Personal information shared (self-disclosure). */
  PERSONAL_INFO: 0.3,
  /** Agent's key response (information provided, comfort given). */
  KEY_RESPONSE: 0.15,
  /** Recency bonus (multiplied by recency ratio, 0-1). */
  RECENCY: 0.1,
};

/** Maximum possible importance score. */
const MAX_IMPORTANCE = 1.0;

// ─── Types ───────────────────────────────────────────────────────────────

/** A single compressed message entry. */
export interface CompressedMessage {
  /** Original role. */
  role: 'user' | 'assistant' | 'system';
  /** Compressed representation. */
  summary: string;
  /** Importance score (0-1). */
  importance: number;
  /** Whether this was kept at FULL fidelity. */
  fullFidelity: boolean;
  /** Original timestamp. */
  timestamp?: string;
}

/** Result of compressHistory(). */
export interface CompressedHistory {
  /** Messages in FULL fidelity (last 5). */
  fullMessages: Message[];
  /** Messages in COMPRESSED fidelity (1-2 line summaries). */
  compressedMessages: CompressedMessage[];
  /** Placeholder info for older messages. */
  placeholder: {
    count: number;
    text: string; // e.g., "[...更早的对话，共42条]"
  };
  /** Total original message count. */
  originalCount: number;
  /** Estimated token savings vs keeping all FULL. */
  estimatedTokensSaved: number;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Score a message's importance (0-1) based on content and intent.
 *
 * Factors:
 *   - Emotional content (+0.3): detected via keywords in the message.
 *   - Question asked (+0.2): user message ends with question mark / question words.
 *   - Personal info shared (+0.3): self-disclosure patterns (我 + 情绪/状态/事实).
 *   - Key response (+0.15): assistant message with substantial info (>50 chars).
 *   - Recency bonus (+0.0..0.1): higher for more recent messages in the window.
 *
 * @param msg     The message to score.
 * @param intent  Pre-computed IntentResult (from classifier). If omitted,
 *                the function will use built-in heuristics.
 * @returns       Importance score between 0 and 1.
 */
export function classifyImportance(msg: Message, intent?: IntentResult): number {
  if (!msg || !msg.content) return 0;

  const text = typeof msg.content === 'string' ? msg.content : '';
  if (!text || text.trim().length === 0) return 0;

  let score = 0;

  // ── Emotional content (+0..0.3) ──
  const emotionalKeywords = [
    // Chinese emotional signals
    '难过', '开心', '生气', '焦虑', '紧张', '担心', '害怕', '兴奋',
    '激动', '感动', '委屈', '崩溃', '绝望', '幸福', '伤心', '愤怒',
    '失望', '失落', '寂寞', '孤独', '温暖', '心疼', '爱你', '想你',
    '烦死了', '气死', '受不了', '撑不住', '好累', '好烦', '无语',
    // English emotional signals
    'sad', 'angry', 'happy', 'excited', 'worried', 'scared', 'love',
    'miss', 'hate', 'tired', 'depressed', 'anxious',
  ];

  for (const kw of emotionalKeywords) {
    if (text.includes(kw)) {
      score += IMPORTANCE_WEIGHTS.EMOTIONAL_CONTENT;
      break; // one match is enough
    }
  }

  // ── Question asked (+0..0.2) ──
  if (msg.role === 'user') {
    // Pattern: ends with question mark or contains Chinese question words
    const questionPatterns = [
      /[?？]$/m,
      /什么|怎么|为什么|哪[里个]|谁|何时|怎样|是否|吗$|呢$|吧$/,
      /告诉我|说说|解释|怎么[样办]|如何/,
    ];
    for (const re of questionPatterns) {
      if (re.test(text)) {
        score += IMPORTANCE_WEIGHTS.QUESTION_ASKED;
        break;
      }
    }

    // ── Personal info shared (+0..0.3) ──
    // Self-disclosure patterns: 我 + [emotion/state/fact]
    const personalPatterns = [
      /我[是感觉觉得认为想有在]/,
      /我妈|我爸|我[家朋兄姐弟妹同][友事妹哥姐学]|我[老女男]朋友|我对象/,
      /我[的过得]/, // "我的...", "我过得..."
      /我[今年岁数]/,
      /我[在位于去]/, // location disclosure
      /我[做学工读]/, // activity disclosure
      /分享|告诉|坦白|秘密/,
      // Personal facts (dates, names, places)
      /\d{4}年|\d+岁|住在|本名|真名|我的名字/,
    ];
    for (const re of personalPatterns) {
      if (re.test(text)) {
        score += IMPORTANCE_WEIGHTS.PERSONAL_INFO;
        break;
      }
    }
  }

  // ── Key assistant response (+0..0.15) ──
  if (msg.role === 'assistant') {
    // Substantial, information-rich response
    if (text.length > 80) {
      score += IMPORTANCE_WEIGHTS.KEY_RESPONSE;
    }
  }

  // ── Intent-based boost (if provided) ──
  if (intent) {
    if (intent.tone === 'positive' || intent.tone === 'negative') {
      score += 0.1; // emotional messages matter more
    }
    if (intent.primary === 'seeking_comfort' || intent.primary === 'affectionate') {
      score += 0.15;
    }
  }

  return Math.min(score, MAX_IMPORTANCE);
}

/**
 * Compress a list of messages into three fidelity zones.
 *
 * Layout:
 *   - Last `FULL_FIDELITY_COUNT` messages → kept verbatim (FULL).
 *   - Messages 6 through `FULL_FIDELITY_COUNT + COMPRESSED_ZONE_COUNT`
 *     → summarized to 1-2 lines (COMPRESSED).
 *   - All older messages → single placeholder line (PLACEHOLDER).
 *
 * @param messages    The full message history (oldest first).
 * @param maxTokens   Optional token budget hint (not used directly — the
 *                    three-zone layout is fixed). Defaults not needed.
 * @returns           A CompressedHistory with the three zones.
 */
export function compressHistory(messages: Message[], maxTokens?: number): CompressedHistory {
  if (!messages || messages.length === 0) {
    return {
      fullMessages: [],
      compressedMessages: [],
      placeholder: { count: 0, text: '' },
      originalCount: 0,
      estimatedTokensSaved: 0,
    };
  }

  const totalCount = messages.length;

  // Split into zones
  const zoneStartIndex = Math.max(0, totalCount - FULL_FIDELITY_COUNT);
  const fullMessages = messages.slice(zoneStartIndex);

  // Messages before FULL zone that fall into COMPRESSED zone
  const compressedZoneEnd = zoneStartIndex;
  const compressedZoneStart = Math.max(0, compressedZoneEnd - COMPRESSED_ZONE_COUNT);
  const compressedSource = messages.slice(compressedZoneStart, compressedZoneEnd);

  // Everything before COMPRESSED zone → PLACEHOLDER
  const placeholderCount = compressedZoneStart;

  // Build compressed representations
  const compressedMessages: CompressedMessage[] = compressedSource.map((msg) => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    summary: summarizeMessage(msg),
    importance: classifyImportance(msg),
    fullFidelity: false,
    timestamp: msg.timestamp,
  }));

  // Build placeholder
  const placeholderText = placeholderCount > 0
    ? `[...更早的对话，共${placeholderCount + compressedSource.length}条]`
    : '';

  // Estimate token savings
  const savedTokens = estimateTokens(compressedSource) + estimateTokens(messages.slice(0, compressedZoneStart));

  return {
    fullMessages,
    compressedMessages,
    placeholder: {
      count: placeholderCount + compressedSource.length, // total compressed + placeholder
      text: placeholderText,
    },
    originalCount: totalCount,
    estimatedTokensSaved: savedTokens,
  };
}

/**
 * Render the compressed history into a string suitable for prompt injection.
 *
 * The output format:
 *
 * ```
 * ...更早的对话，共X条]
 *
 * [之前]
 * 用户: 摘要1...
 * Mio: 摘要2...
 * ...
 *
 * [最近]
 * 用户: 原文（完整）
 * Mio: 原文（完整）
 * ...
 * ```
 *
 * @param compressed  The result of compressHistory().
 * @returns           A formatted string for prompt injection.
 */
export function renderCompressedHistory(compressed: CompressedHistory): string {
  const parts: string[] = [];

  // Placeholder line
  if (compressed.placeholder.text) {
    parts.push(compressed.placeholder.text);
  }

  // Compressed zone
  if (compressed.compressedMessages.length > 0) {
    parts.push('');
    parts.push('[之前]');
    for (const cm of compressed.compressedMessages) {
      const roleLabel = cm.role === 'user' ? '用户' : cm.role === 'assistant' ? 'Mio' : '系统';
      parts.push(`${roleLabel}: ${cm.summary}`);
    }
  }

  // Full fidelity zone
  if (compressed.fullMessages.length > 0) {
    parts.push('');
    parts.push('[最近]');
    for (const msg of compressed.fullMessages) {
      const text = typeof msg.content === 'string' ? msg.content : '[非文本]';
      const roleLabel = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'Mio' : '系统';
      parts.push(`${roleLabel}: ${text}`);
    }
  }

  return parts.join('\n');
}

// ─── Internal helpers ────────────────────────────────────────────────────

/**
 * Heuristic message summarizer.
 *
 * Rules:
 *   - User messages: keep first MAX_COMPRESSED_LINE_LENGTH chars + "...".
 *     If the message contains key nouns (named entities, dates, topics),
 *     preserve them even if it means going slightly over the limit.
 *   - Assistant messages: keep the first MAX_COMPRESSED_LINE_LENGTH chars.
 *     Skip tool-related content (tool call notes, result dumps).
 *   - System messages: "系统提示".
 */
function summarizeMessage(msg: Message): string {
  const text = typeof msg.content === 'string' ? msg.content : '';

  if (!text || text.trim().length === 0) {
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      return `[调用了 ${msg.toolCalls.map((t) => t.name).join(', ')}]`;
    }
    return `[空消息]`;
  }

  const cleaned = text
    .replace(/tool\s+\w+:\s*[\s\S]*?(?=\n|$)/g, '') // remove tool result lines
    .replace(/^\[.*?\]/, '')
    .trim();

  if (cleaned.length <= MAX_COMPRESSED_LINE_LENGTH) {
    return cleaned;
  }

  // Try to find a natural break
  const truncated = cleaned.slice(0, MAX_COMPRESSED_LINE_LENGTH - 3);
  const breakAt = Math.max(
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('，'),
    truncated.lastIndexOf('？'),
    truncated.lastIndexOf('！'),
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf(','),
  );

  if (breakAt > MAX_COMPRESSED_LINE_LENGTH / 2) {
    // Natural break found — use it
    return cleaned.slice(0, breakAt + 1) + '…';
  }

  return truncated + '…';
}

/**
 * Token estimate matching compression.ts to ensure consistent savings calculation.
 */
function estimateTokens(messages: Message[]): number {
  let cjk = 0;
  let latin = 0;

  for (const msg of messages) {
    const text = typeof msg.content === 'string' ? msg.content : '';
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      if (
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3040 && code <= 0x309F) ||
        (code >= 0x30A0 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF)
      ) {
        cjk++;
      } else if (code > 127) {
        cjk++;
      } else if (ch !== ' ' && ch !== '\n' && ch !== '\t') {
        latin++;
      }
    }
  }

  return Math.ceil(cjk / 1.5 + latin / 4);
}
