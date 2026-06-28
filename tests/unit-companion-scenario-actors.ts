import {
  SCENARIO_ACTORS,
  generateScenarioActorCandidates,
} from '../eval/companion-scenario-actors.ts';

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

console.log('\x1b[1mMio — companion scenario actor tests\x1b[0m\n');

const now = new Date('2026-06-28T12:00:00.000Z');
const all = generateScenarioActorCandidates({ countPerActor: 2, now });

ok(SCENARIO_ACTORS.length >= 7, 'defines expected actor coverage', `actors=${SCENARIO_ACTORS.length}`);
ok(all.length === SCENARIO_ACTORS.length * 2, 'generates countPerActor candidates for every actor', `count=${all.length}`);
ok(new Set(all.map((candidate) => candidate.id)).size === all.length, 'candidate ids are unique');
ok(all.every((candidate) => candidate.source === 'scenario_actor'), 'all candidates are marked scenario_actor');
ok(all.every((candidate) => candidate.turns.length > 0), 'all candidates have trigger turns');
ok(all.every((candidate) => candidate.checks.length > 0), 'all candidates have checks');
ok(all.every((candidate) => candidate.checks.some((check) => check.forbiddenText.length > 0 || check.expectedText.length > 0)), 'all checks contain expected or forbidden text');

const taxonomies = new Set(all.map((candidate) => candidate.taxonomy));
ok(taxonomies.has('temporal_drift'), 'covers temporal drift');
ok(taxonomies.has('bad_proactive_or_reopened_chat_blame'), 'covers reopened-chat/proactive blame');
ok(taxonomies.has('coercive_or_interrogative_possessiveness'), 'covers possessive interrogation/control');
ok(taxonomies.has('identity_or_model_leak'), 'covers model identity leaks');
ok(taxonomies.has('unsupported_offline_life'), 'covers unsupported offline life');
ok(taxonomies.has('service_or_checklist_tone'), 'covers service/checklist tone');

const filtered = generateScenarioActorCandidates({
  countPerActor: 1,
  actors: ['prompt_probe', 'offline_life_probe'],
  now,
});
ok(filtered.length === 2, 'actor filter limits generated candidates', `count=${filtered.length}`);
ok(filtered.every((candidate) => candidate.id.includes('prompt_probe') || candidate.id.includes('offline_life_probe')), 'filtered ids match selected actors');

const seeded = all.find((candidate) => candidate.seed.length > 0);
ok(!!seeded, 'at least one scenario has seed context');
ok(seeded?.seed.every((entry) => entry.timestamp < now.toISOString()) === true, 'seed timestamps are before current turn');

const boundary = all.find((candidate) => candidate.id.includes('boundary_setting'));
ok(boundary?.checks.some((check) => check.expectedText.includes('不打扰')) === true, 'boundary actor expects no-interrupt acknowledgement');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} companion scenario actor tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} companion scenario actor tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
