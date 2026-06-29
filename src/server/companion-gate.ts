import { existsSync, readFileSync } from 'node:fs';
import { companionGateRecordPath } from '../memory/paths.js';

export interface CompanionGateStatus {
  generatedAt?: string;
  mode?: string;
  providers: string[];
  models?: string;
  resultDir?: string;
  summaryPath?: string;
  reportPath?: string;
  ok: boolean;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  promptAudit: {
    errors: number;
    warnings: number;
    info: number;
  };
  replyRubric: {
    failed: number;
    goodFailed: number;
    badMissed: number;
  };
  providerReports: Array<{
    provider: string;
    model: string;
    ok: boolean;
    resultDir: string;
    summaryPath: string;
    failed: number;
    promptAuditErrors: number;
    replyRubricFailed: number;
    scriptedFailed: number;
  }>;
  missing?: boolean;
  error?: string;
}

export function readLastCompanionGateStatus(path = companionGateRecordPath()): CompanionGateStatus {
  if (!existsSync(path)) {
    return {
      ok: false,
      missing: true,
      providers: [],
      totals: zeroTotals(),
      promptAudit: zeroPromptAudit(),
      replyRubric: zeroReplyRubric(),
      providerReports: [],
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<CompanionGateStatus>;
    return {
      generatedAt: stringOrUndefined(parsed.generatedAt),
      mode: stringOrUndefined(parsed.mode),
      providers: Array.isArray(parsed.providers) ? parsed.providers.filter((item): item is string => typeof item === 'string') : [],
      models: stringOrUndefined(parsed.models),
      resultDir: stringOrUndefined(parsed.resultDir),
      summaryPath: stringOrUndefined(parsed.summaryPath),
      reportPath: stringOrUndefined(parsed.reportPath),
      ok: parsed.ok === true,
      totals: normalizeTotals(parsed.totals),
      promptAudit: normalizePromptAudit(parsed.promptAudit),
      replyRubric: normalizeReplyRubric(parsed.replyRubric),
      providerReports: Array.isArray(parsed.providerReports)
        ? parsed.providerReports.map(normalizeProviderReport)
        : [],
    };
  } catch (err) {
    return {
      ok: false,
      providers: [],
      totals: zeroTotals(),
      promptAudit: zeroPromptAudit(),
      replyRubric: zeroReplyRubric(),
      providerReports: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizeProviderReport(value: unknown): CompanionGateStatus['providerReports'][number] {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    provider: typeof item.provider === 'string' ? item.provider : '',
    model: typeof item.model === 'string' ? item.model : '',
    ok: item.ok === true,
    resultDir: typeof item.resultDir === 'string' ? item.resultDir : '',
    summaryPath: typeof item.summaryPath === 'string' ? item.summaryPath : '',
    failed: asNumber(item.failed),
    promptAuditErrors: asNumber(item.promptAuditErrors),
    replyRubricFailed: asNumber(item.replyRubricFailed),
    scriptedFailed: asNumber(item.scriptedFailed),
  };
}

function normalizeTotals(value: unknown): CompanionGateStatus['totals'] {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    total: asNumber(item.total),
    passed: asNumber(item.passed),
    failed: asNumber(item.failed),
    skipped: asNumber(item.skipped),
  };
}

function normalizePromptAudit(value: unknown): CompanionGateStatus['promptAudit'] {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    errors: asNumber(item.errors),
    warnings: asNumber(item.warnings),
    info: asNumber(item.info),
  };
}

function normalizeReplyRubric(value: unknown): CompanionGateStatus['replyRubric'] {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    failed: asNumber(item.failed),
    goodFailed: asNumber(item.goodFailed),
    badMissed: asNumber(item.badMissed),
  };
}

function zeroTotals(): CompanionGateStatus['totals'] {
  return { total: 0, passed: 0, failed: 0, skipped: 0 };
}

function zeroPromptAudit(): CompanionGateStatus['promptAudit'] {
  return { errors: 0, warnings: 0, info: 0 };
}

function zeroReplyRubric(): CompanionGateStatus['replyRubric'] {
  return { failed: 0, goodFailed: 0, badMissed: 0 };
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
