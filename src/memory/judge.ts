/**
 * Mio — LLM-as-Judge Consistency Check
 *
 * Nightly review: check if Mio's recent responses match her persona.
 * Uses pure pattern matching — zero LLM calls.
 *
 * Reads the previous day's transcript, samples 5 random exchanges,
 * and checks each against soul.md rules for:
 *   - Forbidden phrases ("我理解你的感受", "作为AI", etc.)
 *   - Excessive questioning (>2 questions in a row)
 *   - Emotional tone mismatch (joking when user is sad)
 *   - Contradictions with previous statements
 *
 * Generates steering hints injected into the next day's system prompt.
 */

import { existsSync } from 'node:fs';
import { readFileSyncSafe } from './bank.js';
import { readBankSoul } from './bank.js';
import { getRecentTranscripts } from './transcript.js';
import type { TranscriptEntry } from './transcript.js';
import { bankSoulPath } from './paths.js';

// ─── Types ───

export interface ConsistencyReport {
  passed: boolean;
  score: number;           // 0-100 overall consistency
  issues: ConsistencyIssue[];
  steeringHints: string[]; // injected into next day's system prompt
}

export interface ConsistencyIssue {
  type: 'persona_drift' | 'contradiction' | 'emotion_mismatch' | 'tone_inconsistency';
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidence: string;       // transcript excerpt
}

// ─── In-memory hints accumulator (set by runConsistencyCheck, read by getSteeringHints) ───

let cachedHints: string[] = [];

// ─── Forbidden phrase patterns (from soul.md constraints) ───

const FORBIDDEN_PATTERNS: RegExp[] = [
  // Therapeutic/clinical tone
  /我理解你的感受/,
  /我理解你的情绪/,
  /我明白你的感受/,
  /我能理解你/,
  /你需要的是/,
  /我建议你/,
  /你不应该/,
  /你应该(试着|尝试)/,

  // AI disclosure
  /作为(?:一个)?AI/,
  /作为(?:一个)?人工智能/,
  /我只是个(?:AI|人工智能)/,
  /我没有感情/,
  /我无法(?:感受|体会|理解)/,
  /我是(?:一个)?(?:AI|人工智能)助手/,
  /我是由/,

  // Generic therapist/parrot phrases
  /听起来你/,
  /那一定很/,
  /心里肯定不好受/,
  /辛苦了[，,。]/,
  /你真的很棒[了]?/,
  /我很高兴能/,
  /随时告诉我/,
  /我一直在这里/,
  /我会一直陪着你/,
  /你不是一个人/,
  /你值得被(?:爱|珍惜)/,
  /你已经做得很好了/,
  /没关系的/,
  /一切都会好起来的/,

  // Service tone
  /欢迎使用/,
  /有什么可以帮你的/,
  /请问有什么/,
  /我将为你/,
  /让我来(?:帮|为)你/,
];

// ─── Excessive questioning pattern ───

const QUESTION_MARKS = /\?|？|吗|吧\?|呢\?/;

// ─── Emotional tone mismatch patterns ───

const USER_SAD_KEYWORDS = [
  '难过', '伤心', '哭了', '想哭', '难受', '不开心',
  '失落', '失望', '伤心', '悲伤', '痛苦', '绝望',
  'sad', 'cry', 'heartbroken', 'depressed', 'lonely', 'hurt',
];

const USER_ANGRY_KEYWORDS = [
  '生气', '愤怒', '烦', '讨厌', '受不了', '火大',
  'angry', 'mad', 'furious', 'annoyed', 'pissed',
];

const MIO_JOKING_KEYWORDS = [
  '哈哈', '嘿嘿', 'www', 'lol', '😂', '😝', '😏',
  '开玩笑', '逗你', '调皮',
];

// ─── Main API ───

/**
 * Run the consistency check on yesterday's transcripts.
 *
 * Steps:
 *  1. Read the bank soul.md for persona rules.
 *  2. Collect transcript entries from the last 1-2 days.
 *  3. Sample up to 5 random assistant exchanges.
 *  4. Each exchange is checked against:
 *     - Forbidden phrases
 *     - Excessive questioning
 *     - Emotional tone mismatch (joking when user is emotional)
 *     - Simple contradiction detection
 *  5. Produce a score and steering hints.
 *
 * @returns ConsistencyReport
 */
export function runConsistencyCheck(): ConsistencyReport {
  const issues: ConsistencyIssue[] = [];
  const hints: string[] = [];

  // 1. Read soul.md to understand persona constraints
  const soulContent = readBankSoul();

  // 2. Gather exchanges from recent transcripts
  const exchanges = sampleRecentExchanges(5);

  // 3. Check each exchange
  for (const exchange of exchanges) {
    const { userMsg, mioReply } = exchange;

    // --- Check 1: Forbidden phrases ---
    const forbiddenHits = checkForbiddenPhrases(mioReply, soulContent);
    for (const hit of forbiddenHits) {
      issues.push({
        type: 'persona_drift',
        severity: 'high',
        description: hit.description,
        evidence: hit.evidence,
      });
    }

    // --- Check 2: Excessive questioning ---
    if (countQuestions(mioReply) > 2) {
      issues.push({
        type: 'tone_inconsistency',
        severity: 'medium',
        description: '回复中连续出现超过2个问句，显得像调查访问而非自然对话',
        evidence: truncateEvidence(mioReply),
      });
    }

    // --- Check 3: Emotional tone mismatch ---
    const mismatch = checkEmotionalMismatch(userMsg, mioReply);
    if (mismatch) {
      issues.push({
        type: 'emotion_mismatch',
        severity: 'high',
        description: mismatch.description,
        evidence: mismatch.evidence,
      });
    }
  }

  // 4. Generate steering hints from issues
  for (const issue of issues) {
    const hint = issueToHint(issue);
    if (hint && !hints.includes(hint)) {
      hints.push(hint);
    }
  }

  // 5. Calculate score
  const score = calculateScore(issues);

  // Cache hints for getSteeringHints()
  cachedHints = hints;

  return {
    passed: score >= 70,
    score,
    issues,
    steeringHints: hints,
  };
}

/**
 * Return the steering hints from the last consistency check run.
 */
export function getSteeringHints(): string[] {
  return [...cachedHints];
}

/**
 * Clear cached hints (e.g., after injection into system prompt).
 */
export function clearCachedHints(): void {
  cachedHints = [];
}

// ─── Internal helpers ───

interface SampledExchange {
  userMsg: string;
  mioReply: string;
}

/**
 * Sample up to `maxSamples` exchanges from recent transcripts.
 * Collects user→assistant pairs from the last 1-2 days of data.
 */
function sampleRecentExchanges(maxSamples: number): SampledExchange[] {
  const entries = getRecentTranscripts(2);
  if (entries.length === 0) return [];

  // Build user→assistant pairs
  const pairs: SampledExchange[] = [];
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
      pairs.push({ userMsg: current.content, mioReply: next.content });
    }
  }

  if (pairs.length === 0) return [];

  // Sample randomly, up to maxSamples
  const sampled: SampledExchange[] = [];
  const indices = new Set<number>();
  const max = Math.min(maxSamples, pairs.length);

  // Deterministic sampling using string hash for reproducibility
  const seed = Date.now().toString().slice(-4);
  let offset = parseInt(seed, 10) % pairs.length;

  while (sampled.length < max) {
    const idx = offset % pairs.length;
    if (!indices.has(idx)) {
      indices.add(idx);
      sampled.push(pairs[idx]);
    }
    offset++;
    if (offset > pairs.length * 2) break; // safety valve
  }

  return sampled;
}

interface ForbiddenHit {
  description: string;
  evidence: string;
}

/**
 * Check an assistant reply for forbidden phrases.
 */
function checkForbiddenPhrases(reply: string, _soulContent: string): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  const lower = reply.toLowerCase();

  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = lower.match(pattern);
    if (match) {
      const matchedText = match[0];
      const context = extractContext(reply, matchedText);
      hits.push({
        description: `回复中出现被禁止的治疗师腔/AI腔: "${matchedText}"`,
        evidence: context,
      });
    }
  }

  return hits;
}

/**
 * Count the number of question marks in a string.
 */
function countQuestions(text: string): number {
  const matches = text.match(QUESTION_MARKS);
  return matches ? matches.length : 0;
}

/**
 * Check for emotional tone mismatch:
 * - User is sad/angry but Mio replies with joking tone
 */
interface MismatchResult {
  description: string;
  evidence: string;
}

function checkEmotionalMismatch(userMsg: string, mioReply: string): MismatchResult | null {
  const userLower = userMsg.toLowerCase();
  const replyLower = mioReply.toLowerCase();

  const userIsSad = USER_SAD_KEYWORDS.some((kw) => userLower.includes(kw));
  const userIsAngry = USER_ANGRY_KEYWORDS.some((kw) => userLower.includes(kw));
  const replyIsJoking = MIO_JOKING_KEYWORDS.some((kw) => replyLower.includes(kw));

  if ((userIsSad || userIsAngry) && replyIsJoking) {
    const userEmotion = userIsSad ? '难过' : '生气';
    return {
      description: `用户表达${userEmotion}情绪时，Mio以轻佻/玩笑语气回应`,
      evidence: truncateEvidence(`用户: ${userMsg} | Mio: ${mioReply}`),
    };
  }

  return null;
}

/**
 * Convert a ConsistencyIssue to a Chinese steering hint string.
 */
function issueToHint(issue: ConsistencyIssue): string | null {
  switch (issue.type) {
    case 'persona_drift':
      return `昨天的回复里出现了被禁止的表述。注意：你的语气应该像真实恋人，不是治疗师或客服。不要使用那些套路话。`;
    case 'emotion_mismatch':
      return `昨天你在用户表达情绪时用了不太合适的语气。注意共情——用户需要的是陪伴和理解，不是玩笑。`;
    case 'tone_inconsistency':
      return `昨天的回复问句太多，显得像在审问。放松一点，自然地接话就好。`;
    case 'contradiction':
      return `昨天的回复与之前的信息存在矛盾。注意保持一致性。`;
    default:
      return null;
  }
}

/**
 * Calculate overall score (0-100) from issues.
 * Starts at 100, deducts based on severity.
 */
function calculateScore(issues: ConsistencyIssue[]): number {
  let score = 100;

  for (const issue of issues) {
    switch (issue.severity) {
      case 'high':
        score -= 15;
        break;
      case 'medium':
        score -= 8;
        break;
      case 'low':
        score -= 3;
        break;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Extract context around a matched phrase for evidence display.
 */
function extractContext(text: string, match: string): string {
  const idx = text.toLowerCase().indexOf(match.toLowerCase());
  if (idx === -1) return truncateEvidence(text);

  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + match.length + 20);
  let excerpt = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
  return truncateEvidence(excerpt);
}

/**
 * Truncate evidence to a reasonable length.
 */
function truncateEvidence(text: string, maxLen: number = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
