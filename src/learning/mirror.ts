/**
 * Mio — Conversation Mirror (语料镜像学习)
 *
 * Core insight: real people unconsciously mirror each other's speech patterns.
 * If the user says "草" a lot, their friends start saying "草" too. If the user
 * writes short punchy sentences, their partner matches that rhythm.
 *
 * This module tracks the user's vocabulary and style, then injects mirroring
 * hints into the system prompt so Mio gradually adopts the user's patterns.
 *
 * Design:
 *   - Zero LLM calls — pure statistics from transcript analysis
 *   - Weighted recency: recent words matter more than old ones
 *   - Gradual adoption: mirroring confidence builds slowly, avoids mimicry
 *   - Persisted to data/mirror-profile.json
 */

import { readFileSync, existsSync } from 'node:fs';
import { getDataDir } from '../config.js';
import { writeFileSyncSafe } from '../memory/bank.js';

// ─── Types ───

interface WordEntry {
  word: string;
  count: number;
  lastSeen: string;
  score: number;        // 0-1: how strongly Mio should adopt this
}

interface MirrorProfile {
  /** High-frequency user words Mio should consider using. */
  vocabulary: WordEntry[];
  /** Average user message length for length matching. */
  avgMsgLength: number;
  /** Common sentence-ending patterns (?, !, ~, 嘛, 啊, etc.). */
  endings: Record<string, number>;
  /** Observed punctuation style. */
  punctuationStyle: 'minimal' | 'normal' | 'expressive';
  /** How many exchanges have been analyzed. */
  totalAnalyzed: number;
  updatedAt: string;
}

// ─── Defaults ───

const DEFAULT_PROFILE: MirrorProfile = {
  vocabulary: [],
  avgMsgLength: 15,
  endings: {},
  punctuationStyle: 'normal',
  totalAnalyzed: 0,
  updatedAt: new Date().toISOString(),
};

// ─── Persistence ───

function profilePath(): string {
  return `${getDataDir()}/mirror-profile.json`;
}

function readProfile(): MirrorProfile {
  const p = profilePath();
  try {
    if (existsSync(p)) return { ...DEFAULT_PROFILE, ...JSON.parse(readFileSync(p, 'utf-8')) };
  } catch { /* corrupt */ }
  return { ...DEFAULT_PROFILE };
}

function writeProfile(profile: MirrorProfile): void {
  const p = profilePath();
  writeFileSyncSafe(p, JSON.stringify(profile, null, 2));
}

// ─── Analysis ───

const COMMON_WORDS = new Set([
  '的', '了', '是', '我', '不', '在', '有', '他', '你', '这', '就', '也', '都', '要', '会', '吗', '吧', '啊', '呢', '哦', '嗯',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'it',
]);

const SENTENCE_ENDS = /[！!？?。.～~…]+$/;
const PUNCTUATION_WORDS = /[啊啦嘛吧呢哦哈呀哇嘿呃]+/g;

/**
 * Analyze a user message and update the mirror profile.
 * Called after each user turn. Lightweight — O(n) on message length.
 */
export function analyzeUserMessage(text: string): void {
  const profile = readProfile();
  profile.totalAnalyzed++;
  profile.updatedAt = new Date().toISOString();

  // Update average message length (EMA)
  profile.avgMsgLength = Math.round(profile.avgMsgLength * 0.9 + text.length * 0.1);

  // Extract meaningful words (not stop words, >= 2 chars)
  const words = text.split(/[\s,，。！？、；：""''「」『』【】\n]+/).filter((w) => w.length >= 2 && !COMMON_WORDS.has(w));

  for (const word of words) {
    const existing = profile.vocabulary.find((e) => e.word === word);
    if (existing) {
      existing.count++;
      existing.lastSeen = new Date().toISOString();
      // Score = frequency × recency. Cap at 0.6 — Mio adopts but doesn't parrot.
      existing.score = Math.min(0.6, (existing.count / profile.totalAnalyzed) * 3);
    } else {
      profile.vocabulary.push({
        word,
        count: 1,
        lastSeen: new Date().toISOString(),
        score: 0.05,
      });
    }
  }

  // Track sentence endings
  const endings = text.match(SENTENCE_ENDS);
  if (endings) {
    for (const e of endings) {
      for (const ch of e) {
        profile.endings[ch] = (profile.endings[ch] ?? 0) + 1;
      }
    }
  }

  // Detect punctuation style
  const punctCount = (text.match(/[！!？?。.～~…]{2,}/g)?.length ?? 0);
  const punctRatio = punctCount / Math.max(1, text.length / 10);
  if (punctRatio > 0.3) profile.punctuationStyle = 'expressive';
  else if (punctRatio > 0.1) profile.punctuationStyle = 'normal';
  else profile.punctuationStyle = 'minimal';

  // Keep only top 30 vocabulary words
  profile.vocabulary.sort((a, b) => b.score - a.score);
  profile.vocabulary = profile.vocabulary.slice(0, 30);

  writeProfile(profile);
}

/**
 * Generate a mirroring hint for the system prompt.
 * Returns null if there's not enough data yet (less than 10 exchanges).
 */
export function getMirrorHint(): string | null {
  const profile = readProfile();
  if (profile.totalAnalyzed < 10) return null;

  const parts: string[] = [];

  // High-score vocabulary
  const topWords = profile.vocabulary.filter((w) => w.score >= 0.3);
  if (topWords.length > 0) {
    const words = topWords.slice(0, 8).map((w) => w.word).join('、');
    parts.push(`他最近经常说的词：${words}。你可以自然地在对话里用这些词——不是刻意模仿，是你们聊久了会不知不觉互相影响。`);
  }

  // Length hint
  if (profile.avgMsgLength < 8) {
    parts.push('他说话比较简短。你也不用回长篇——几个字能说清就几个字。');
  } else if (profile.avgMsgLength > 40) {
    parts.push('他说话比较长、比较认真。你也可以多说几句。');
  }

  // Ending style
  const topEndings = Object.entries(profile.endings)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([ch]) => ch);
  if (topEndings.length > 0 && !topEndings.every((ch) => '。！？'.includes(ch))) {
    parts.push(`他说话结尾喜欢用"${topEndings.join('、')}"——你也可以偶尔这样结尾。`);
  }

  return parts.length > 0 ? `## 关于他的说话习惯\n${parts.join('\n')}` : null;
}
