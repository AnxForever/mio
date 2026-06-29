import assert from 'node:assert';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildCompanionGateRecord,
  writeCompanionGateRecord,
} from '../scripts/wechat-bridge/write-companion-gate-record.mjs';

const dir = mkdtempSync(join(tmpdir(), 'mio-wechat-preflight-record-'));
const runtimeDir = join(dir, 'runtime');
const resultDir = join(dir, 'companion-gate');
mkdirSync(resultDir, { recursive: true });

writeFileSync(join(resultDir, 'summary.json'), JSON.stringify({
  ok: false,
  totals: { total: 12, passed: 11, failed: 1, skipped: 0 },
  promptAudit: { errors: 0, warnings: 2, info: 4 },
  replyRubric: { failed: 1, goodFailed: 0, badMissed: 1 },
  providers: [{
    provider: 'minimax',
    model: 'MiniMax-M3',
    ok: false,
    resultDir: join(resultDir, 'minimax-MiniMax-M3'),
    summaryPath: join(resultDir, 'minimax-MiniMax-M3', 'summary.json'),
    qualityGateSummaryPath: join(resultDir, 'minimax-MiniMax-M3', 'quality-gate', 'quality-summary.json'),
    qualityGateReportPath: join(resultDir, 'minimax-MiniMax-M3', 'quality-gate', 'quality-report.md'),
    failed: 1,
    qualityGateFailed: 3,
    promptAuditErrors: 0,
    replyRubricFailed: 1,
    scriptedFailed: 0,
  }],
}), 'utf-8');

const record = buildCompanionGateRecord({
  resultDir,
  mode: 'smoke',
  providers: 'mock,minimax',
  models: 'minimax:MiniMax-M3',
});

assert.equal(record.ok, false);
assert.deepEqual(record.providers, ['mock', 'minimax']);
assert.equal(record.models, 'minimax:MiniMax-M3');
assert.equal(record.resultDir, resolve(resultDir));
assert.equal(record.summaryPath, join(resolve(resultDir), 'summary.json'));
assert.equal(record.reportPath, join(resolve(resultDir), 'report.md'));
assert.equal(record.totals.failed, 1);
assert.equal(record.promptAudit.warnings, 2);
assert.equal(record.replyRubric.badMissed, 1);
assert.equal(record.providerReports[0].provider, 'minimax');
assert.equal(record.providerReports[0].qualityGateFailed, 3);
assert.equal(record.providerReports[0].qualityGateSummaryPath, join(resultDir, 'minimax-MiniMax-M3', 'quality-gate', 'quality-summary.json'));
assert.equal(record.providerReports[0].qualityGateReportPath, join(resultDir, 'minimax-MiniMax-M3', 'quality-gate', 'quality-report.md'));
assert.equal(record.providerReports[0].replyRubricFailed, 1);

const written = writeCompanionGateRecord({
  runtimeDir,
  resultDir,
  mode: 'full',
  providers: 'minimax',
  models: 'minimax:MiniMax-M3',
});

const stored = JSON.parse(readFileSync(written.recordPath, 'utf-8'));
assert.equal(stored.mode, 'full');
assert.equal(stored.reportPath, join(resolve(resultDir), 'report.md'));
assert.equal(readFileSync(written.txtPath, 'utf-8').trim(), resolve(resultDir));

console.log('✓ wechat companion preflight record');
