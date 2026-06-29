#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function buildCompanionGateRecord(input) {
  const resultDir = resolve(input.resultDir);
  const summaryPath = join(resultDir, 'summary.json');
  const reportPath = join(resultDir, 'report.md');
  const summary = readJson(summaryPath);
  const providers = splitList(input.providers);

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode || 'smoke',
    providers,
    models: input.models || '',
    resultDir,
    summaryPath,
    reportPath,
    ok: summary?.ok === true,
    totals: normalizeTotals(summary?.totals),
    promptAudit: normalizePromptAudit(summary?.promptAudit),
    replyRubric: normalizeReplyRubric(summary?.replyRubric),
    providerReports: Array.isArray(summary?.providers)
      ? summary.providers.map((provider) => ({
        provider: String(provider?.provider || ''),
        model: String(provider?.model || ''),
        ok: provider?.ok === true,
        resultDir: String(provider?.resultDir || ''),
        summaryPath: String(provider?.summaryPath || ''),
        qualityGateSummaryPath: String(provider?.qualityGateSummaryPath || ''),
        qualityGateReportPath: String(provider?.qualityGateReportPath || ''),
        failed: asNumber(provider?.failed),
        qualityGateFailed: asNumber(provider?.qualityGateFailed),
        promptAuditErrors: asNumber(provider?.promptAuditErrors),
        replyRubricFailed: asNumber(provider?.replyRubricFailed),
        scriptedFailed: asNumber(provider?.scriptedFailed),
      }))
      : [],
  };
}

export function writeCompanionGateRecord(input) {
  const runtimeDir = resolve(input.runtimeDir);
  mkdirSync(runtimeDir, { recursive: true });
  const record = buildCompanionGateRecord(input);
  const recordPath = join(runtimeDir, 'last-companion-gate.json');
  const txtPath = join(runtimeDir, 'last-companion-gate.txt');
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  writeFileSync(txtPath, `${record.resultDir}\n`, 'utf-8');
  return { record, recordPath, txtPath };
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function normalizeTotals(value) {
  return {
    total: asNumber(value?.total),
    passed: asNumber(value?.passed),
    failed: asNumber(value?.failed),
    skipped: asNumber(value?.skipped),
  };
}

function normalizePromptAudit(value) {
  return {
    errors: asNumber(value?.errors),
    warnings: asNumber(value?.warnings),
    info: asNumber(value?.info),
  };
}

function normalizeReplyRubric(value) {
  return {
    failed: asNumber(value?.failed),
    goodFailed: asNumber(value?.goodFailed),
    badMissed: asNumber(value?.badMissed),
  };
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const idx = arg.indexOf('=');
    if (!arg.startsWith('--') || idx <= 2) continue;
    args[arg.slice(2, idx)] = arg.slice(idx + 1);
  }
  return {
    runtimeDir: args['runtime-dir'],
    resultDir: args['result-dir'],
    mode: args.mode,
    providers: args.providers,
    models: args.models,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.runtimeDir || !args.resultDir) {
    console.error('Usage: write-companion-gate-record.mjs --runtime-dir=<dir> --result-dir=<dir> [--mode=smoke|full] [--providers=mock] [--models=provider:model]');
    process.exit(2);
  }
  const { recordPath, record } = writeCompanionGateRecord(args);
  console.log(`Companion gate record: ${recordPath}`);
  console.log(`Companion gate report: ${record.reportPath}`);
}
