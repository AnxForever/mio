import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCompanionLoopSteps,
  summarizeCompanionLoop,
} from '../eval/companion-loop.ts';

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

console.log('\x1b[1mMio — companion eval loop tests\x1b[0m\n');

const dir = mkdtempSync(join(tmpdir(), 'mio-companion-loop-'));
const steps = buildCompanionLoopSteps({
  resultDir: dir,
  provider: 'mock',
  actorCountPerActor: 1,
  actorMaxCandidates: 3,
  minedLimit: 4,
  minedMaxCandidates: 2,
  minConfidence: 0.7,
  skipBuild: true,
  skipActors: false,
  skipMining: false,
});

ok(steps.length === 4, 'builds actor + mining loop without build step', `steps=${steps.map((step) => step.id).join(',')}`);
ok(steps[0]?.id === 'actor_generate', 'first step generates actor candidates');
ok(steps.some((step) => step.id === 'actor_replay' && step.command.includes('--max-candidates=3')), 'actor replay uses max candidate limit');
ok(steps.some((step) => step.id === 'mine_failures' && step.command.includes('--limit=4')), 'failure miner uses mined limit');
ok(steps.some((step) => step.id === 'mined_replay' && step.command.includes('--min-confidence=0.7')), 'candidate replay uses confidence threshold');

const buildSteps = buildCompanionLoopSteps({
  resultDir: dir,
  provider: 'mock',
  actorCountPerActor: 1,
  minedLimit: 1,
  minConfidence: 0,
  skipBuild: false,
  skipActors: true,
  skipMining: true,
});
ok(buildSteps.length === 1 && buildSteps[0]?.id === 'build', 'skip flags can leave build-only plan');

mkdirSync(join(dir, 'actor-replay'), { recursive: true });
mkdirSync(join(dir, 'mined-replay'), { recursive: true });
writeFileSync(join(dir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 3,
  passed: 3,
  failed: 0,
  skipped: 0,
}), 'utf-8');
writeFileSync(join(dir, 'mined-replay', 'summary.json'), JSON.stringify({
  total: 2,
  passed: 1,
  failed: 1,
  skipped: 0,
}), 'utf-8');

const summary = summarizeCompanionLoop(dir, [
  {
    id: 'actor_replay',
    label: 'Actor replay',
    command: 'node actor',
    exitCode: 0,
    ok: true,
    stdout: '',
    stderr: '',
    durationMs: 12,
  },
  {
    id: 'mined_replay',
    label: 'Mined replay',
    command: 'node mined',
    exitCode: 0,
    ok: true,
    stdout: '',
    stderr: '',
    durationMs: 14,
  },
]);

ok(summary.totals.total === 5, 'summary totals replayed candidates', `total=${summary.totals.total}`);
ok(summary.totals.passed === 4, 'summary totals passed candidates', `passed=${summary.totals.passed}`);
ok(summary.totals.failed === 1, 'summary totals failed candidates', `failed=${summary.totals.failed}`);
ok(summary.ok === false, 'summary fails when any replay gate failed');

const cleanDir = mkdtempSync(join(tmpdir(), 'mio-companion-loop-clean-'));
mkdirSync(join(cleanDir, 'actor-replay'), { recursive: true });
writeFileSync(join(cleanDir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
}), 'utf-8');
const cleanSummary = summarizeCompanionLoop(cleanDir, []);
ok(cleanSummary.ok === true, 'summary passes when all available gates pass');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} companion eval loop tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} companion eval loop tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
