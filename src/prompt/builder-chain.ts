/**
 * Mio — Builder Chain
 *
 * Conditional prompt injection based on conversation state. An EvaluationGraph
 * pre-analyzes the user's message, then runs a prioritized chain of PromptBuilders
 * that each decide whether to inject their fragment.
 *
 * This decouples the "when to inject what" logic from the prompt assembly itself.
 * Each builder is a self-contained unit with a condition (checked against the
 * evaluation result) and a build() method that returns the fragment to inject.
 *
 * Usage:
 *   const graph = new EvaluationGraph();
 *   const result = graph.evaluate("I'm feeling really down today...");
 *
 *   const chain = new BuilderChain();
 *   chain.register({
 *     priority: 10,
 *     condition: (eval) => eval.emotionalIntensity === 'high',
 *     build: () => '## Comfort mode\nBe warm and gentle.',
 *   });
 *   const fragment = chain.assemble(result);
 */

import type { EmotionState } from '../types.js';

// ─── Evaluation result ───

export type IntentCategory =
  | 'casual'
  | 'emotional'
  | 'sharing'
  | 'asking'
  | 'joking'
  | 'silent';

export type EmotionalIntensity = 'low' | 'medium' | 'high';

export type HistoryNeed = 'none' | 'recent' | 'deep';

export interface EvaluationResult {
  /** Dominant conversational intent. */
  intent: IntentCategory;
  /** How emotionally charged the message is. */
  emotionalIntensity: EmotionalIntensity;
  /** How much conversation history the response needs. */
  needsHistory: HistoryNeed;
  /** Optional: secondary intents detected (e.g., ['asking', 'emotional']). */
  secondaryIntents?: IntentCategory[];
  /** Raw text for downstream builders that need it. */
  rawText?: string;
}

// ─── Intent detection keywords (Chinese-first, with English fallback) ───

const EMOTIONAL_PATTERNS = [
  /难过|伤心|难受|不开心|郁闷|焦虑|害怕|恐惧|绝望|孤独|寂寞|累|疲惫|辛苦|痛/i,
  /sad|hurt|depressed|anxious|scared|lonely|tired|exhausted|pain/i,
];

const HIGH_EMOTION_PATTERNS = [
  /崩溃|受不了|撑不住|想死|不想活|活不下去|绝望|完蛋|不行了/i,
  /崩溃|can't.*(take|bear)|overwhelmed|devastated|hopeless/i,
];

const SHARING_PATTERNS = [
  /今天|昨天|刚才|最近|早上|下午|晚上|昨天|今天.*了|刚.*了|发现|看到|听到|遇到|买了|吃了|去了|做了/i,
  /today|yesterday|just.*(saw|heard|found|bought|ate|went|did)|guess what|you know what/i,
];

const ASKING_PATTERNS = [
  /\?|？|吗$|呢$|吧$|什么|怎么|为什么|哪个|谁|哪|如何|有没有|是不是|能不能|会不会|该不该/i,
  /\?|what|how|why|where|when|who|which|can you|could you|do you|are you|will you/i,
];

const JOKING_PATTERNS = [
  /哈哈|呵呵|hhh|lol|笑死|搞笑|逗|开玩笑|好玩|有趣|整活|乐/i,
  /lol|lmao|rofl|haha|funny|hilarious|jk|just kidding/i,
];

const SILENT_PATTERNS = [
  /^\.\.\.+$/, /^。+$/, /^$/, /^(嗯|哦|噢|好|行|ok|好的|知道了|没事|没什么)$/i,
];

// ─── EvaluationGraph ───

export class EvaluationGraph {
  /**
   * Pre-analyze a user message and produce an EvaluationResult.
   *
   * Detects intent via keyword patterns, emotional intensity via
   * pattern matching, and history needs based on intent type.
   *
   * @param userMessage The raw user input text.
   * @returns An EvaluationResult with classified intent, emotional intensity, etc.
   */
  evaluate(userMessage: string): EvaluationResult {
    const text = userMessage?.trim() ?? '';
    const intents: IntentCategory[] = [];
    const secondaryIntents: IntentCategory[] = [];

    // Detect silence
    if (SILENT_PATTERNS.some((p) => p.test(text))) {
      return {
        intent: 'silent',
        emotionalIntensity: 'low',
        needsHistory: 'none',
        secondaryIntents: ['casual'],
        rawText: text,
      };
    }

    // Detect primary intent (first match wins for primary, subsequent become secondary)
    const checks: { pattern: RegExp[]; intent: IntentCategory }[] = [
      { pattern: HIGH_EMOTION_PATTERNS, intent: 'emotional' },
      { pattern: EMOTIONAL_PATTERNS, intent: 'emotional' },
      { pattern: JOKING_PATTERNS, intent: 'joking' },
      { pattern: ASKING_PATTERNS, intent: 'asking' },
      { pattern: SHARING_PATTERNS, intent: 'sharing' },
    ];

    for (const check of checks) {
      if (check.pattern.some((p) => p.test(text))) {
        if (intents.length === 0) {
          intents.push(check.intent);
        } else if (!secondaryIntents.includes(check.intent)) {
          secondaryIntents.push(check.intent);
        }
      }
    }

    // Fallback: casual
    const primaryIntent = intents.length > 0 ? intents[0] : 'casual';

    // Determine emotional intensity
    let emotionalIntensity: EmotionalIntensity = 'low';
    if (HIGH_EMOTION_PATTERNS.some((p) => p.test(text))) {
      emotionalIntensity = 'high';
    } else if (EMOTIONAL_PATTERNS.some((p) => p.test(text))) {
      emotionalIntensity = 'medium';
    } else if (primaryIntent === 'sharing' && text.length > 30) {
      emotionalIntensity = 'medium';
    }

    // Determine history needs
    let needsHistory: HistoryNeed = 'recent';
    if (primaryIntent === 'silent' || text.length < 3) {
      needsHistory = 'none';
    } else if (primaryIntent === 'emotional' || emotionalIntensity === 'high') {
      needsHistory = 'deep';
    } else if (primaryIntent === 'joking' && text.length < 20) {
      needsHistory = 'none';
    } else if (primaryIntent === 'casual') {
      needsHistory = 'recent';
    }

    return {
      intent: primaryIntent,
      emotionalIntensity,
      needsHistory,
      secondaryIntents: secondaryIntents.length > 0 ? secondaryIntents : undefined,
      rawText: text,
    };
  }

  /**
   * Create an EvaluationResult from emotion state for context-aware evaluation
   * when there's no user message (e.g., proactive messaging).
   */
  evaluateFromEmotion(emotion: EmotionState, hour: number): EvaluationResult {
    const intensity = emotion.affection > 60 ? 'medium' as const : emotion.affection > 30 ? 'low' as const : 'low' as const;
    return {
      intent: 'casual',
      emotionalIntensity: intensity,
      needsHistory: 'recent',
      rawText: '',
    };
  }
}

// ─── PromptBuilder ───

export interface PromptBuilder {
  /**
   * Priority determines assembly order (lower numbers = higher priority).
   * Builders are sorted by priority ascending before assembly.
   */
  priority: number;
  /**
   * Condition function: return true to include this builder's fragment.
   * Evaluated against the EvaluationResult from the current turn.
   */
  condition: (evalResult: EvaluationResult) => boolean;
  /**
   * Build the prompt fragment. Return null or empty string to skip injection.
   */
  build: () => string | null;
  /**
   * Optional: unique name for debugging/logging.
   */
  name?: string;
}

// ─── BuilderChain ───

export class BuilderChain {
  private builders: PromptBuilder[] = [];

  /**
   * Register a PromptBuilder. Builders are sorted by priority at assembly time.
   */
  register(builder: PromptBuilder): this {
    this.builders.push(builder);
    return this;
  }

  /**
   * Unregister a builder by name (if set).
   */
  unregister(name: string): this {
    this.builders = this.builders.filter((b) => b.name !== name);
    return this;
  }

  /**
   * Get all registered builders (sorted by priority).
   */
  getBuilders(): PromptBuilder[] {
    return [...this.builders].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Clear all registered builders.
   */
  clear(): this {
    this.builders = [];
    return this;
  }

  /**
   * Assemble prompt fragments from all builders whose condition passes.
   *
   * @param evalResult The evaluation result for the current turn.
   * @returns A string of concatenated fragments (joined by double newlines).
   */
  assemble(evalResult: EvaluationResult): string {
    const sorted = [...this.builders].sort((a, b) => a.priority - b.priority);
    const parts: string[] = [];

    for (const builder of sorted) {
      try {
        if (builder.condition(evalResult)) {
          const fragment = builder.build();
          if (fragment && fragment.trim().length > 0) {
            parts.push(fragment.trim());
          }
        }
      } catch {
        // A single builder error shouldn't break the chain
        continue;
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Get the count of registered builders.
   */
  get builderCount(): number {
    return this.builders.length;
  }
}

// ─── Singleton factory ───

let _globalGraph: EvaluationGraph | null = null;
let _globalChain: BuilderChain | null = null;

/**
 * Get or create the global EvaluationGraph singleton.
 */
export function getEvaluationGraph(): EvaluationGraph {
  if (!_globalGraph) {
    _globalGraph = new EvaluationGraph();
  }
  return _globalGraph;
}

/**
 * Get or create the global BuilderChain singleton.
 */
export function getBuilderChain(): BuilderChain {
  if (!_globalChain) {
    _globalChain = new BuilderChain();
  }
  return _globalChain;
}

/**
 * Reset singletons (for testing).
 */
export function resetBuilderEngine(): void {
  _globalGraph = null;
  _globalChain = null;
}
