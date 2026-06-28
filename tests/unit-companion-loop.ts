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
  personaMaxCandidates: 2,
  minedLimit: 4,
  minedMaxCandidates: 2,
  minConfidence: 0.7,
  skipBuild: true,
  skipQualityGate: false,
  skipActors: false,
  skipPersonaCases: false,
  skipMining: false,
});

ok(steps.length === 7, 'builds quality gate + actor + persona case + mining loop without build step', `steps=${steps.map((step) => step.id).join(',')}`);
ok(steps[0]?.id === 'quality_gate', 'first step runs deterministic quality gate');
ok(steps[0]?.command.includes('--providers=mock'), 'quality gate is scoped to selected provider');
ok(steps[0]?.required === false, 'quality gate failures do not block later loop steps');
ok(steps[1]?.id === 'actor_generate', 'second step generates actor candidates');
ok(steps.some((step) => step.id === 'actor_replay' && step.command.includes('--max-candidates=3')), 'actor replay uses max candidate limit');
ok(steps.some((step) => step.id === 'persona_case_generate'), 'loop generates persona case candidates');
ok(steps.some((step) => step.id === 'persona_case_replay' && step.command.includes('--max-candidates=2')), 'persona case replay uses max candidate limit');
ok(steps.some((step) => step.id === 'mine_failures' && step.command.includes('--limit=4')), 'failure miner uses mined limit');
ok(steps.some((step) => step.id === 'mined_replay' && step.command.includes('--min-confidence=0.7')), 'candidate replay uses confidence threshold');

const buildSteps = buildCompanionLoopSteps({
  resultDir: dir,
  provider: 'mock',
  actorCountPerActor: 1,
  minedLimit: 1,
  minConfidence: 0,
  skipBuild: false,
  skipQualityGate: true,
  skipActors: true,
  skipPersonaCases: true,
  skipMining: true,
});
ok(buildSteps.length === 1 && buildSteps[0]?.id === 'build', 'skip flags can leave build-only plan');

mkdirSync(join(dir, 'actor-replay'), { recursive: true });
mkdirSync(join(dir, 'persona-case-replay'), { recursive: true });
mkdirSync(join(dir, 'mined-replay'), { recursive: true });
mkdirSync(join(dir, 'quality-gate'), { recursive: true });
writeFileSync(join(dir, 'quality-gate', 'quality-summary.json'), JSON.stringify({
  total: 18,
  runnable: 18,
  skipped: 0,
  passed: 18,
  averageScore: 1,
}), 'utf-8');
writeFileSync(join(dir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 3,
  passed: 3,
  failed: 0,
  skipped: 0,
  byRouteTag: { temporal_state: 2, proactive: 1 },
  failedByRouteTag: {},
}), 'utf-8');
writeFileSync(join(dir, 'persona-case-replay', 'summary.json'), JSON.stringify({
  total: 4,
  passed: 4,
  failed: 0,
  skipped: 0,
  byRouteTag: { prompt_probe: 2, intimacy_control: 1 },
  failedByRouteTag: {},
}), 'utf-8');
writeFileSync(join(dir, 'mined-replay', 'summary.json'), JSON.stringify({
  total: 2,
  passed: 1,
  failed: 1,
  skipped: 0,
  byRouteTag: { offline_life: 1, temporal_state: 1 },
  failedByRouteTag: { offline_life: 1 },
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

ok(summary.totals.total === 9, 'summary totals replayed candidates', `total=${summary.totals.total}`);
ok(summary.totals.passed === 8, 'summary totals passed candidates', `passed=${summary.totals.passed}`);
ok(summary.totals.failed === 1, 'summary totals failed candidates', `failed=${summary.totals.failed}`);
ok(summary.ok === false, 'summary fails when any replay gate failed');
ok(summary.qualityGate.runnable === 18, 'summary reads deterministic quality gate runnable count', `runnable=${summary.qualityGate.runnable}`);
ok(summary.qualityGate.failed === 0, 'summary reads deterministic quality gate as clean', `failed=${summary.qualityGate.failed}`);
ok(summary.routeTags.temporal_state === 3, 'summary aggregates route tags across replay gates', JSON.stringify(summary.routeTags));
ok(summary.routeTags.prompt_probe === 2, 'summary includes persona prompt-probe route tags', JSON.stringify(summary.routeTags));
ok(summary.failedRouteTags.offline_life === 1, 'summary aggregates failed route tags', JSON.stringify(summary.failedRouteTags));
ok(summary.recommendations.length === 1, 'summary creates route-specific recommendations');
ok(summary.recommendations[0]?.routeTag === 'offline_life', 'recommendation names failed route tag', summary.recommendations[0]?.routeTag);
ok(summary.recommendations[0]?.focus.includes('Own-life'), 'offline-life recommendation points at own-life grounding', summary.recommendations[0]?.focus);

const cleanDir = mkdtempSync(join(tmpdir(), 'mio-companion-loop-clean-'));
mkdirSync(join(cleanDir, 'actor-replay'), { recursive: true });
writeFileSync(join(cleanDir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
}), 'utf-8');
mkdirSync(join(cleanDir, 'quality-gate'), { recursive: true });
writeFileSync(join(cleanDir, 'quality-gate', 'quality-summary.json'), JSON.stringify({
  total: 2,
  runnable: 2,
  skipped: 0,
  passed: 1,
  averageScore: 0.5,
}), 'utf-8');
const cleanSummary = summarizeCompanionLoop(cleanDir, []);
ok(cleanSummary.ok === false, 'summary fails when deterministic quality gate fails');
ok(cleanSummary.qualityGate.failed === 1, 'summary computes quality gate failures');

const allCleanDir = mkdtempSync(join(tmpdir(), 'mio-companion-loop-all-clean-'));
mkdirSync(join(allCleanDir, 'actor-replay'), { recursive: true });
mkdirSync(join(allCleanDir, 'quality-gate'), { recursive: true });
writeFileSync(join(allCleanDir, 'actor-replay', 'summary.json'), JSON.stringify({
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
}), 'utf-8');
writeFileSync(join(allCleanDir, 'quality-gate', 'quality-summary.json'), JSON.stringify({
  total: 2,
  runnable: 2,
  skipped: 0,
  passed: 2,
  averageScore: 1,
}), 'utf-8');
const allCleanSummary = summarizeCompanionLoop(allCleanDir, []);
ok(allCleanSummary.ok === true, 'summary passes when replay and quality gates pass');
ok(cleanSummary.recommendations.length === 0, 'clean summary has no route recommendations');

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
