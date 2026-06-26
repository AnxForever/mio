/**
 * Mio — ContextEngine
 *
 * Type-safe section-based prompt assembly engine. Replaces the flat
 * string-concatenation pattern in buildSystemPrompt() with a priority-aware,
 * budget-controlled, condition-gated section pipeline.
 *
 * Sections are registered with a priority level and assembled by priority
 * order (critical > high > medium > low). When the assembled result exceeds
 * the token budget, low-priority sections are trimmed first, then medium.
 *
 * Usage:
 *   const engine = new ContextEngine();
 *   engine.register('core', { type: 'identity', content: CORE_IDENTITY, priority: 'critical', estimatedTokens: 50 });
 *   engine.register('soul', { type: 'persona', content: () => soulContent, priority: 'high', estimatedTokens: 800, condition: () => !!soulContent });
 *   const prompt = engine.assemble(4000);
 *   const budget = engine.getBudget();
 */

import { estimateTokens } from '../utils/prompt-budget.js';
import { logger } from '../utils/logger.js';

// ─── Types ───

export type SectionPriority = 'critical' | 'high' | 'medium' | 'low';

export interface ContextSection {
  /** Unique semantic type label (e.g. 'identity', 'persona', 'relationship'). */
  type: string;
  /** Section content: static string or lazy-evaluated factory. */
  content: string | (() => string);
  /** Priority level for ordering and trimming. */
  priority: SectionPriority;
  /**
   * Estimated token count. If 0 or omitted, computed on first access
   * via the heuristic token estimator.
   */
  estimatedTokens?: number;
  /**
   * Optional condition: section is only included when this returns true.
   * Evaluated fresh on each assemble() call.
   */
  condition?: () => boolean;
}

export interface BudgetLine {
  type: string;
  priority: SectionPriority;
  chars: number;
  tokens: number;
  percent: number;
  included: boolean;
}

export interface BudgetReport {
  lines: BudgetLine[];
  totalTokens: number;
  totalChars: number;
  usedTokens: number;
  maxTokens: number;
  trimmed: string[];  // section types that were trimmed due to budget
}

// ─── Priority ordering ───

const PRIORITY_ORDER: SectionPriority[] = ['critical', 'high', 'medium', 'low'];

const PRIORITY_RANK: Record<SectionPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ─── Token estimation (re-exported from prompt-budget) ───

export { estimateTokens };

// ─── ContextEngine ───

export class ContextEngine {
  private sections: Map<string, ContextSection> = new Map();
  private resolvedContent: Map<string, string> = new Map();
  private resolvedTokens: Map<string, number> = new Map();
  private trimmedSections: string[] = [];

  /**
   * Register a context section.
   *
   * If a section with the same `type` already exists, it is overwritten.
   * This allows dynamic re-registration without clearing the engine.
   */
  register(type: string, section: ContextSection): this {
    this.sections.set(type, section);
    return this;
  }

  /**
   * Remove a registered section by type.
   */
  unregister(type: string): this {
    this.sections.delete(type);
    this.resolvedContent.delete(type);
    this.resolvedTokens.delete(type);
    return this;
  }

  /**
   * Check if a section type is already registered.
   */
  has(type: string): boolean {
    return this.sections.has(type);
  }

  /**
   * Get a registered section by type. Returns undefined if not found.
   */
  get(type: string): ContextSection | undefined {
    return this.sections.get(type);
  }

  /**
   * Resolve the content of a section (evaluate lazy factories).
   */
  private resolve(section: ContextSection): string {
    const key = section.type;
    // Cache resolved content for this assemble cycle
    if (this.resolvedContent.has(key)) {
      return this.resolvedContent.get(key) ?? '';
    }
    const content = typeof section.content === 'function'
      ? (section.content as () => string)()
      : section.content;
    this.resolvedContent.set(key, content);
    if (section.estimatedTokens && section.estimatedTokens > 0) {
      this.resolvedTokens.set(key, section.estimatedTokens);
    } else {
      this.resolvedTokens.set(key, estimateTokens(content));
    }
    return content;
  }

  /**
   * Clear the resolved content cache (between assemble cycles).
   */
  private clearCache(): void {
    this.resolvedContent.clear();
    this.resolvedTokens.clear();
    this.trimmedSections = [];
  }

  /**
   * Assemble the system prompt by priority, respecting the token budget.
   *
   * Process:
   *  1. Evaluate conditions for all sections; skip those that fail.
   *  2. Sort by priority (critical first).
   *  3. Include sections in priority order, tracking accumulated tokens.
   *  4. If budget is exceeded, trim low-priority sections first, then medium.
   *  5. Sections within the same priority band are included in registration order.
   *
   * @param maxTokens Maximum allowed token count (default: 6000).
   * @returns The assembled prompt string, with sections joined by double newlines.
   */
  assemble(maxTokens: number = 6000): string {
    this.clearCache();

    // Phase 1: Evaluate conditions and resolve content for all sections
    const eligible: { type: string; section: ContextSection; content: string; tokens: number; rank: number }[] = [];

    let idx = 0;
    for (const [type, section] of this.sections) {
      // Check condition
      if (section.condition && !section.condition()) continue;

      // Resolve content (lazy eval on first access)
      const content = this.resolve(section);
      if (content.length === 0) continue;

      const tokens = this.resolvedTokens.get(type) ?? 0;
      const rank = PRIORITY_RANK[section.priority];

      eligible.push({ type, section, content, tokens, rank });
      idx++;
    }

    // Phase 2: Sort by priority (rank) then registration order (original idx)
    eligible.sort((a, b) => a.rank - b.rank);

    // Phase 3: Build the prompt within budget
    const parts: string[] = [];
    let totalTokens = 0;
    const included = new Set<string>();

    // First pass: include critical and high, then medium and low if budget allows
    for (const entry of eligible) {
      if (entry.rank <= 1) {
        // critical (0) or high (1) — always include
        parts.push(entry.content);
        totalTokens += entry.tokens;
        included.add(entry.type);
      } else if (entry.rank === 2) {
        // medium (2) — include if budget allows
        if (totalTokens + entry.tokens <= maxTokens) {
          parts.push(entry.content);
          totalTokens += entry.tokens;
          included.add(entry.type);
        } else {
          this.trimmedSections.push(entry.type);
        }
      } else {
        // low (3) — include only if there's ample room
        if (totalTokens + entry.tokens <= maxTokens) {
          parts.push(entry.content);
          totalTokens += entry.tokens;
          included.add(entry.type);
        } else {
          this.trimmedSections.push(entry.type);
        }
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Get the current budget report.
   *
   * Call after assemble() to see what was included and trimmed.
   */
  getBudget(): BudgetReport {
    let totalChars = 0;
    let totalTokens = 0;
    const lines: BudgetLine[] = [];

    for (const [type] of this.sections) {
      const content = this.resolvedContent.get(type) ?? '';
      const tokens = this.resolvedTokens.get(type) ?? 0;
      const section = this.sections.get(type);
      const chars = content.length;
      totalChars += chars;
      totalTokens += tokens;
      const included = !this.trimmedSections.includes(type) && content.length > 0;
      lines.push({
        type,
        priority: section?.priority ?? 'low',
        chars,
        tokens,
        percent: totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0,
        included,
      });
    }

    return {
      lines,
      totalTokens,
      totalChars,
      usedTokens: totalTokens,
      maxTokens: 6000,
      trimmed: [...this.trimmedSections],
    };
  }

  /**
   * Log the budget report to console.
   */
  logBudget(): void {
    const report = this.getBudget();
    logger.info(`\n[context-engine] ${report.usedTokens} tokens used, ${report.trimmed.length > 0 ? `${report.trimmed.length} sections trimmed` : 'all sections included'}`);
    if (report.trimmed.length > 0) {
      logger.info(`  trimmed: ${report.trimmed.join(', ')}`);
    }
    logger.info('─'.repeat(50));
    for (const line of report.lines) {
      if (!line.included && this.trimmedSections.includes(line.type)) continue; // skip trimmed in display
      const bar = '█'.repeat(Math.min(line.percent, 50));
      const mark = line.included ? '+' : '-';
      logger.info(`  ${mark} ${line.type.padEnd(18)} ${String(line.tokens).padStart(4)} tok ${String(line.percent).padStart(3)}% ${bar}`);
    }
    logger.info('─'.repeat(50));
  }

  /**
   * Get the list of section types that were trimmed in the last assemble() call.
   */
  getTrimmedSections(): string[] {
    return [...this.trimmedSections];
  }

  /**
   * Get the number of registered sections.
   */
  get sectionCount(): number {
    return this.sections.size;
  }

  /**
   * Get all registered section types.
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.sections.keys());
  }
}

// ─── Singleton factory ───

let _globalEngine: ContextEngine | null = null;

/**
 * Get or create the global ContextEngine singleton.
 *
 * Using a singleton is optional — callers can construct their own instances
 * for isolated prompt assembly (e.g., subagents). The global instance is
 * used by the main agent loop.
 */
export function getContextEngine(): ContextEngine {
  if (!_globalEngine) {
    _globalEngine = new ContextEngine();
  }
  return _globalEngine;
}

/**
 * Reset the global ContextEngine singleton (for testing).
 */
export function resetContextEngine(): void {
  _globalEngine = null;
}
