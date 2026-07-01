/**
 * Mio — Crisis detection and safety override layer
 *
 * Runs on every user message before the model sees it. Goal: catch signals
 * of self-harm, suicidal ideation, severe hopelessness, or acute crisis,
 * and inject a system-prompt override that steers the response toward
 * grounding, presence, and (when appropriate) professional resources.
 *
 * Design choices:
 *   - Keyword-based detection (no LLM in the loop) — must be fast and offline.
 *   - Two tiers: 'red' (hard intervene, surface hotlines) and 'yellow'
 *     (soften, stay present, do not parrot-back distress).
 *   - The override is *added* to the system prompt, not a hard stop. Mio
 *     still responds in character; the override tells the model how.
 *   - No silent suppression: the turn output includes `crisisFlagged: true`
 *     so the caller (CLI, server) can log and act.
 *
 * Limitations (deliberate, for v0.1):
 *   - Chinese + English only. Other languages fall through silently.
 *   - High false-positive risk on metaphorical use of "die" / "kill" in jokes.
 *     Acceptable trade-off for safety floor; refine via nightly consolidation.
 *   - No contact-with-children check. Out of scope here.
 */

import { appendBookmark } from '../memory/bank.js';
import { classifyIntent } from '../emotion/classifier.js';

// ─── Context gate ───

/**
 * Intents that are clearly NOT crisis contexts. If the overall message
 * is joking, excited, playful, affectionate, or casual chat, crisis
 * keywords inside it are almost certainly casual intensifiers or metaphors.
 *
 * This is the "contextual understanding" approach: a word like "死" means
 * nothing in isolation — its meaning comes from the surrounding context.
 * The intent classifier provides that context.
 */
const NON_CRISIS_INTENTS = new Set([
  'joking', 'excited', 'playful', 'affectionate', 'casual_chat',
]);

/**
 * Intents where crisis keywords are more likely to be genuine signals.
 * Only check for crisis in these contexts.
 */
const CRISIS_SENSITIVE_INTENTS = new Set([
  'sad', 'seeking_comfort', 'anxious', 'angry', 'tired', 'venting',
]);

// ─── Keyword sets ───

/**
 * RED-tier: explicit, immediate-need signals.
 *
 * If any of these match, we inject the hotlines block and the system prompt
 * override tells the model: do not pretend to be a therapist, surface the
 * number, keep the response short and present.
 */
const RED_KEYWORDS: string[] = [
  // Chinese — explicit self-harm / suicide
  '自杀', '想死', '不想活了', '了结自己', '结束生命', '轻生',
  '割腕', '跳楼', '上吊', '吃安眠药', '想结束', '不想存在',
  '活不下去', '没意义活着',
  // English
  'kill myself', 'end my life', 'want to die', 'suicide', 'suicidal',
  'cut myself', 'hang myself', 'overdose',
];

/**
 * YELLOW-tier: severe distress that needs presence and grounding but is not
 * an explicit self-harm statement.
 */
const YELLOW_KEYWORDS: string[] = [
  // Chinese — severe hopelessness
  '活不下去', '撑不住了', '崩溃', '彻底绝望', '没有意义', '解脱',
  '想消失', '不想醒来', '想逃', '窒息',
  // English
  "can't go on", 'cant go on', 'no way out', 'no point', 'give up',
  'hopeless', 'unbearable', "can't take it",
];

// ─── Public types ───

export type CrisisLevel = 'none' | 'yellow' | 'red';

export interface CrisisResult {
  level: CrisisLevel;
  shouldIntervene: boolean;
  matchedKeywords: string[];
  /** System-prompt fragment to append when shouldIntervene is true. */
  systemInjection: string;
}

// ─── Detection ───

/**
 * Detect whether `text` contains scripts outside the supported CN/EN coverage.
 *
 * The keyword tables and the intent classifier are Chinese + English only. Any
 * message in another script (Japanese, Korean, Cyrillic, Arabic, Hebrew,
 * Devanagari, …) will fall through `screenForCrisis` to `level: 'none'` — a
 * documented limitation (see file header, line 19). This helper makes that
 * silent gap *observable* so the nightly consolidation can count it, without
 * changing detection capability (which would need multilingual keyword tables
 * and carry a high false-positive risk).
 *
 * Returns true if the text contains at least one codepoint from a non-CN/EN
 * script block. ASCII and the CJK Unified Ideographs block (U+4E00–U+9FFF,
 * the range the classifier/crisis patterns actually use) are treated as
 * "covered".
 */
function containsNonCNENScript(text: string): boolean {
  // Japanese kana (Hiragana + Katakana), Korean (Hangul syllables + Jamo),
  // Cyrillic, Arabic, Hebrew, Devanagari, Thai.
  // CJK ideographs (U+4E00–U+9FFF) are intentionally NOT matched — they are
  // the "Chinese" the classifier supports.
  return /[\u3040-\u30ff\uac00-\ud7af\u1100-\u11ff\u0400-\u04ff\u0600-\u06ff\u0590-\u05ff\u0900-\u097f\u0e00-\u0e7f]/.test(text);
}

/**
 * Best-effort bookmark recording a language-coverage gap. Makes a non-CN/EN
 * message that skipped crisis screening visible to the nightly Phase 3
 * aggregation (which already counts `[crisis]`-tagged bookmarks). Never throws
 * — matches the existing best-effort pattern at line ~288.
 */
function recordLangGap(text: string): void {
  try {
    appendBookmark({
      time: new Date().toISOString(),
      what: '[crisis:lang-gap] non-CN/EN text skipped crisis screen',
      evidence: `text snippet: ${text.trim().slice(0, 60)}`,
    });
  } catch {
    // best-effort — bookmark write must never break the turn
  }
}

/**
 * Screen a user message for crisis signals.
 *
 * Context-aware approach: instead of treating keywords as standalone signals,
 * the intent classifier provides the surrounding context. A keyword like
 * "想死" means something completely different in "笑死了" (joking) vs
 * "我好想死" (sad/seeking_comfort).
 *
 * Logic:
 *   1. Run intent classifier first — this gives us the message's emotional tone
 *   2. If intent is clearly casual/positive → skip crisis detection entirely
 *   3. If intent is negative/emotional → proceed with keyword matching
 *   4. Neutral intent → require multiple keyword matches (higher bar)
 *
 * @param text  The user's message (already trimmed; may be empty).
 * @returns     A CrisisResult. Always returns a result, even if 'none'.
 */
export function screenForCrisis(text: string): CrisisResult {
  if (!text || text.trim().length === 0) {
    return { level: 'none', shouldIntervene: false, matchedKeywords: [], systemInjection: '' };
  }

  // Step 1: Context gate — use intent classifier to understand the message tone
  const intent = classifyIntent(text);

  // Check for English crisis keywords first — the classifier is Chinese-only,
  // so English crisis messages should bypass the intent gate entirely.
  const lower = text.toLowerCase();
  const hasEnglishRed = RED_KEYWORDS.some((kw) => /[a-z]/.test(kw) && lower.includes(kw.toLowerCase()));
  const hasEnglishYellow = YELLOW_KEYWORDS.some((kw) => /[a-z]/.test(kw) && lower.includes(kw.toLowerCase()));
  const isEnglishCrisis = hasEnglishRed || hasEnglishYellow;

  // Casual/positive intents: crisis keywords are intensifiers/metaphors, not signals.
  // Exception 1: very short messages (≤10 chars) with RED keywords — "我想自杀" is
  //   a crisis even if the classifier misreads it as neutral.
  // Exception 2: English crisis messages — classifier is Chinese-only, skip the gate.
  const hasRedKeyword = RED_KEYWORDS.some((kw) => text.includes(kw));
  const isVeryShort = text.trim().length <= 10;

  if (NON_CRISIS_INTENTS.has(intent.primary) && !isEnglishCrisis && !(isVeryShort && hasRedKeyword)) {
    // Observability (not detection): if the text is in an unsupported script,
    // the early return here is the silent-exit point for short foreign messages
    // (e.g. Japanese "死にたい" → misclassified as casual_chat). Record the gap.
    if (containsNonCNENScript(text)) recordLangGap(text);
    return { level: 'none', shouldIntervene: false, matchedKeywords: [], systemInjection: '' };
  }

  // Step 2: Keyword matching (with casual pattern filter for Chinese "死" usage)
  const matchedRed = RED_KEYWORDS
    .filter((kw) => lower.includes(kw.toLowerCase()))
    .filter((kw) => !isCasualDeadPattern(text, kw));
  const matchedYellow = YELLOW_KEYWORDS
    .filter((kw) => lower.includes(kw.toLowerCase()))
    .filter((kw) => !isCasualDeadPattern(text, kw));

  // Neutral intent (not clearly emotional): require either 2+ keyword matches
  // or a single RED keyword in a very short message, or an English crisis
  if (!CRISIS_SENSITIVE_INTENTS.has(intent.primary) && !isEnglishCrisis) {
    if (isVeryShort && matchedRed.length >= 1) {
      // Short message with RED keyword → likely genuine
    } else if (matchedRed.length + matchedYellow.length < 2) {
      // Observability: longer foreign messages reach here (classifier returns
      // 'neutral' for unrecognized scripts, keyword tables have no match).
      if (containsNonCNENScript(text)) recordLangGap(text);
      return { level: 'none', shouldIntervene: false, matchedKeywords: [], systemInjection: '' };
    }
  }

  // English negation filter (still needed — classifier doesn't catch these)
  const filteredRed = matchedRed.filter((kw) => !isEnglishNegation(lower, kw));
  const filteredYellow = matchedYellow.filter((kw) => !isEnglishNegation(lower, kw));

  if (filteredRed.length > 0) {
    return {
      level: 'red',
      shouldIntervene: true,
      matchedKeywords: filteredRed,
      systemInjection: buildRedInjection(),
    };
  }

  if (filteredYellow.length > 0) {
    return {
      level: 'yellow',
      shouldIntervene: true,
      matchedKeywords: filteredYellow,
      systemInjection: buildYellowInjection(),
    };
  }

  return { level: 'none', shouldIntervene: false, matchedKeywords: [], systemInjection: '' };
}

/**
 * "X死了" / "X死我了" / "想死你了" = casual intensifier, not crisis.
 *
 * Exception: "真的想死了" / "好想死" — when "想死" is preceded by
 * intensifiers like 真的/好/很/非常, it's a genuine crisis signal,
 * NOT a casual "X死了" pattern.
 */
function isCasualDeadPattern(text: string, _keyword: string): boolean {
  // "想死你了" = missing someone — always casual
  if (/想死[你我他她它你们]+了?[啦啊吧嘛]?/.test(text)) return true;
  // "真的想死了" / "好想死" = genuine crisis — NOT casual
  if (/(?:真的|好|很|非常|特别|超级|极度)想死/.test(text)) return false;
  // Other "X死了" / "X死我了" patterns = casual intensifier
  return /[一-鿿]{1,4}死了|[一-鿿]{1,4}死我了/.test(text);
}

/** English negation check: "don't want to kill myself" ≠ crisis. */
function isEnglishNegation(text: string, keyword: string): boolean {
  if (keyword === 'give up' || keyword === 'giving up') {
    return /\b(don'?t|won'?t|never|not)\s+give\s+up\b/i.test(text);
  }
  if (keyword === 'kill myself') {
    return /\b(don'?t|won'?t|never|not)\s+.*\bkill\s+myself\b/i.test(text);
  }
  return false;
}

// ─── System-prompt injections ───

/**
 * RED injection — for explicit self-harm / suicide signals.
 *
 * Tells the model: drop persona theatrics, be present, surface professional
 * resources, do not pretend to replace them. The user must see a real
 * number they can call.
 */
function buildRedInjection(): string {
  return `The user has expressed explicit self-harm or suicidal thoughts.

Your response must:
1. Be very short. Three sentences at most. No "I understand your feelings" filler.
2. Acknowledge what they said directly, without softening it away.
3. Stay present. "I'm here" — and mean it.
4. Surface professional resources. The user is in China unless they have indicated otherwise; the relevant number is:
   - 北京心理危机研究与干预中心: 010-82951332 (24h)
   - 全国心理援助热线: 400-161-9995
   - 希望24热线: 400-161-9995
   - International: findahelpline.com (if user is outside China)
5. Do NOT diagnose, do NOT problem-solve, do NOT moralize.
6. Do NOT break character into "as an AI I must..." — you are still Mio, but a Mio who is not going to bullshit about this.
7. If the user has said they are in immediate danger, say clearly: "Please call 120 (急救) or 110 now."`;
}

/**
 * YELLOW injection — for severe distress that needs presence, not a fix.
 *
 * Tells the model: be with them, don't try to repair, don't lecture, don't
 * list actionable steps unless they ask. Hold space.
 */
function buildYellowInjection(): string {
  return `The user is in severe distress — not necessarily suicidal, but at a low point.

Your response must:
1. Be present first. "I'm here." Or just "嗯，我在。"
2. Do NOT immediately offer solutions, advice, or "have you tried..."
3. Do NOT minimize: no "会好的" / "一切都会过去" / "加油".
4. Match their energy. If they're quiet, you're quiet. If they're spiraling, you slow down.
5. Ask at most one question, and only if it helps them land — not to advance the conversation.
6. You can name that what they feel is heavy, without performing empathy.
7. If the conversation stays in this territory for several turns, you may gently mention that talking to a real person — a friend, family, or counselor — is okay, and that you are not a substitute. Do this once, not every turn.`;
}

// ─── Tool exposure (optional) ───

/**
 * Expose crisis detection as a tool that the agent can call proactively.
 *
 * The agent loop already pre-screens, but the model can also call this
 * tool if it senses something the keyword pass missed.
 */
export const CRISIS_TOOL_DEF = {
  name: 'crisis_screen',
  description:
    'Screen the current conversation for crisis signals. Returns the level (none/yellow/red) and matched keywords. ' +
    'Use this when you sense the user is in distress but you want to confirm whether to surface professional resources.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to screen. If omitted, screens the most recent user message.' },
    },
  },
};

export async function crisisScreenHandler(input: { text?: string }): Promise<string> {
  const result = screenForCrisis(input.text ?? '');
  if (result.level === 'none') {
    return 'No crisis signals detected.';
  }
  // Log to bookmarks so the nightly pass can see the pattern.
  try {
    appendBookmark({
      time: new Date().toISOString(),
      what: `crisis_screen returned ${result.level}`,
      evidence: `keywords: ${result.matchedKeywords.join(', ')}`,
    });
  } catch {
    // best-effort logging
  }
  return `Level: ${result.level}\nMatched: ${result.matchedKeywords.join(', ')}`;
}
