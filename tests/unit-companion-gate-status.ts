import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLastCompanionGateStatus } from '../dist/server/companion-gate.js';

interface TestResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function ok(cond: boolean, name: string, detail?: string): void {
  results.push({ name, ok: cond, detail });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('\x1b[1mMio — companion gate status tests\x1b[0m\n');

const dir = mkdtempSync(join(tmpdir(), 'mio-companion-gate-status-'));
const missing = readLastCompanionGateStatus(join(dir, 'missing.json'));
ok(missing.missing === true, 'missing record is explicit');
ok(missing.ok === false, 'missing record is not ok');
ok(missing.totals.total === 0, 'missing record has zero totals');

const validPath = join(dir, 'last-companion-gate.json');
mkdirSync(dir, { recursive: true });
writeFileSync(validPath, JSON.stringify({
  generatedAt: '2026-06-29T12:00:00.000Z',
  mode: 'full',
  providers: ['mock', 'minimax'],
  models: 'minimax:MiniMax-M3',
  resultDir: '/tmp/mio-gate',
  summaryPath: '/tmp/mio-gate/summary.json',
  reportPath: '/tmp/mio-gate/report.md',
  ok: true,
  totals: { total: 10, passed: 10, failed: 0, skipped: 0 },
  promptAudit: { errors: 0, warnings: 1, info: 4 },
  replyRubric: { failed: 0, goodFailed: 0, badMissed: 0 },
  providerReports: [{
    provider: 'minimax',
    model: 'MiniMax-M3',
    ok: true,
    resultDir: '/tmp/mio-gate/minimax',
    summaryPath: '/tmp/mio-gate/minimax/summary.json',
    failed: 0,
    promptAuditErrors: 0,
    replyRubricFailed: 0,
    scriptedFailed: 0,
  }],
}), 'utf-8');

const valid = readLastCompanionGateStatus(validPath);
ok(valid.ok === true, 'valid record preserves ok status');
ok(valid.providers.join(',') === 'mock,minimax', 'valid record preserves providers');
ok(valid.totals.total === 10 && valid.totals.failed === 0, 'valid record preserves totals');
ok(valid.promptAudit.warnings === 1, 'valid record preserves prompt audit warnings');
ok(valid.providerReports[0]?.provider === 'minimax', 'valid record preserves provider report');
ok(valid.reportPath === '/tmp/mio-gate/report.md', 'valid record exposes report path');

const corruptPath = join(dir, 'corrupt.json');
writeFileSync(corruptPath, '{ bad json', 'utf-8');
const corrupt = readLastCompanionGateStatus(corruptPath);
ok(corrupt.ok === false, 'corrupt record is not ok');
ok(typeof corrupt.error === 'string' && corrupt.error.length > 0, 'corrupt record exposes parse error');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} companion gate status tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} companion gate status tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
