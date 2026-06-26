/**
 * Mio — Prompt budget monitor
 *
 * Inspired by pi-nano-context: tracks how many tokens each section of the
 * system prompt consumes. Helps prevent "上下文屎山" (context garbage mountain)
 * by making token allocation visible and auditable.
 *
 * Usage:
 *   const budget = new PromptBudget();
 *   budget.add('CORE_IDENTITY', coreIdentityText);
 *   budget.add('soul', soulContent);
 *   budget.add('relationship', relCtx);
 *   // ...
 *   budget.report(); // logs a breakdown
 */

import { logger } from './logger.js';

// ─── Types ───

export interface BudgetLine {
  section: string;
  chars: number;
  tokens: number;
  percent: number;
}

export interface BudgetReport {
  lines: BudgetLine[];
  totalTokens: number;
  totalChars: number;
  status: 'ok' | 'warn' | 'over';
}

// ─── Token estimation ───

/**
 * Fast token estimation without a tokenizer.
 * CJK ~1.5 chars/token, Latin ~4 chars/token, mixed ~3 chars/token.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 32) continue; // whitespace
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x3040 && code <= 0x30FF) ||
      (code >= 0xAC00 && code <= 0xD7AF)
    ) {
      cjk++;
    } else if (code < 128) {
      latin++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk / 1.5 + latin / 4 + other / 2);
}

// ─── Warn thresholds ───

const WARN_THRESHOLD = 4000;  // tokens — start warning
const OVER_THRESHOLD = 6000;  // tokens — budget exceeded

// ─── PromptBudget ───

export class PromptBudget {
  private sections: Map<string, string> = new Map();
  private sectionOrder: string[] = [];

  /** Add a section to the budget. Call in prompt assembly order. */
  add(name: string, text: string): this {
    this.sections.set(name, text);
    if (!this.sectionOrder.includes(name)) {
      this.sectionOrder.push(name);
    }
    return this;
  }

  /** Get the total estimated token count. */
  get totalTokens(): number {
    let total = 0;
    for (const text of this.sections.values()) {
      total += estimateTokens(text);
    }
    return total;
  }

  /** Generate a detailed breakdown. */
  report(): BudgetReport {
    const totalTokens = this.totalTokens;
    let totalChars = 0;
    const lines: BudgetLine[] = [];

    for (const name of this.sectionOrder) {
      const text = this.sections.get(name) ?? '';
      const chars = text.length;
      const tokens = estimateTokens(text);
      totalChars += chars;
      lines.push({
        section: name,
        chars,
        tokens,
        percent: totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0,
      });
    }

    let status: BudgetReport['status'] = 'ok';
    if (totalTokens > OVER_THRESHOLD) status = 'over';
    else if (totalTokens > WARN_THRESHOLD) status = 'warn';

    return { lines, totalTokens, totalChars, status };
  }

  /** Log the report to console. */
  log(): void {
    const r = this.report();
    const emoji = r.status === 'over' ? '🔴' : r.status === 'warn' ? '🟡' : '🟢';
    logger.info(`\n${emoji} [prompt-budget] ${r.totalTokens} tokens (${r.totalChars} chars) — ${r.status}`);
    logger.info('─'.repeat(50));
    for (const line of r.lines) {
      const bar = '█'.repeat(Math.min(line.percent, 50));
      logger.info(
        `  ${line.section.padEnd(16)} ${String(line.tokens).padStart(4)} tok ${String(line.percent).padStart(3)}% ${bar}`,
      );
    }
    logger.info('─'.repeat(50));
  }

  /** Get a compact one-line summary for status display. */
  compact(): string {
    const r = this.report();
    const emoji = r.status === 'over' ? '🔴' : r.status === 'warn' ? '🟡' : '🟢';
    return `${emoji} ${r.totalTokens} tok`;
  }

  /** Clear all sections for next turn. */
  clear(): void {
    this.sections.clear();
    this.sectionOrder = [];
  }
}
