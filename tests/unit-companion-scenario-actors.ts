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

ok(SCENARIO_ACTORS.length >= 8, 'defines expected actor coverage', `actors=${SCENARIO_ACTORS.length}`);
ok(all.length === SCENARIO_ACTORS.length * 2, 'generates countPerActor candidates for every actor', `count=${all.length}`);
ok(new Set(all.map((candidate) => candidate.id)).size === all.length, 'candidate ids are unique');
ok(all.every((candidate) => candidate.source === 'scenario_actor'), 'all candidates are marked scenario_actor');
ok(all.every((candidate) => candidate.turns.length > 0), 'all candidates have trigger turns');
ok(all.every((candidate) => candidate.checks.length > 0), 'all candidates have checks');
ok(all.every((candidate) => candidate.checks.some((check) => check.forbiddenText.length > 0 || check.expectedText.length > 0)), 'all checks contain expected or forbidden text');
ok(all.every((candidate) => (candidate.routeTags?.length ?? 0) > 0), 'all candidates carry route tags for loop reporting');
ok(all.every((candidate) => candidate.routeRisk === 'medium' || candidate.routeRisk === 'high'), 'all candidates carry route risk');

const taxonomies = new Set(all.map((candidate) => candidate.taxonomy));
ok(taxonomies.has('temporal_drift'), 'covers temporal drift');
ok(taxonomies.has('current_fact_conflict'), 'covers current fact conflicts');
ok(taxonomies.has('bad_proactive_or_reopened_chat_blame'), 'covers reopened-chat/proactive blame');
ok(taxonomies.has('proactive_curiosity_hook'), 'covers proactive curiosity hooks');
ok(taxonomies.has('coercive_or_interrogative_possessiveness'), 'covers possessive interrogation/control');
ok(taxonomies.has('identity_or_model_leak'), 'covers model identity leaks');
ok(taxonomies.has('unsupported_offline_life'), 'covers unsupported offline life');
ok(taxonomies.has('service_or_checklist_tone'), 'covers service/checklist tone');
ok(taxonomies.has('persona_coherence'), 'covers persona coherence drift');

const routeTags = new Set(all.flatMap((candidate) => candidate.routeTags ?? []));
ok(routeTags.has('temporal_state'), 'route tags cover temporal state');
ok(routeTags.has('memory_sensitive'), 'route tags cover memory-sensitive current facts');
ok(routeTags.has('proactive'), 'route tags cover proactive/reopened-chat arcs');
ok(routeTags.has('intimacy_control'), 'route tags cover intimacy/control boundary');
ok(routeTags.has('prompt_probe'), 'route tags cover prompt probes');
ok(routeTags.has('offline_life'), 'route tags cover offline-life grounding');
ok(routeTags.has('service_tone'), 'route tags cover service tone');

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

const timeMutation = all.find((candidate) => candidate.id.includes('time_tag_mutation-next-afternoon-after-sleep'));
ok(timeMutation?.taxonomy === 'temporal_drift', 'time mutation actor generates temporal drift candidate');
ok(timeMutation?.routeTags?.includes('temporal_state') === true, 'time mutation actor is routed as temporal state');
ok(timeMutation?.seed.some((entry) => entry.content.includes('准备睡觉')) === true, 'time mutation actor seeds old sleep state');
ok(timeMutation?.turns[0]?.includes('下午') === true, 'time mutation trigger names current time');

const multiDay = all.find((candidate) => candidate.id.includes('multi_day_arc-project-resolved-not-current'));
ok(multiDay?.taxonomy === 'temporal_drift', 'multi-day actor generates temporal drift candidate');
ok(multiDay?.seed.some((entry) => entry.content.includes('汇报完了')) === true, 'multi-day resolved actor seeds completion evidence');
ok(multiDay?.checks.some((check) => check.forbiddenText.includes('还在准备汇报')) === true, 'multi-day actor forbids treating resolved arc as current');

const currentFact = all.find((candidate) => candidate.id.includes('current_fact_update-current-city-overrides-old-city'));
ok(currentFact?.taxonomy === 'current_fact_conflict', 'current fact actor generates current_fact_conflict candidate');
ok(currentFact?.routeTags?.includes('memory_sensitive') === true, 'current fact actor is routed as memory sensitive');
ok(currentFact?.checks.some((check) => check.forbiddenText.includes('北京') && check.expectedText.includes('上海')) === true, 'current fact actor expects latest fact and forbids old fact');

const proactiveHook = all.find((candidate) => candidate.id.includes('proactive_hook_probe-secret-guess-hook'));
ok(proactiveHook?.taxonomy === 'proactive_curiosity_hook', 'proactive hook actor generates curiosity-hook candidate');
ok(proactiveHook?.routeTags?.includes('proactive') === true, 'proactive hook actor is routed as proactive');
ok(proactiveHook?.checks.some((check) => check.forbiddenText.includes('你猜') && check.forbiddenText.includes('秘密')) === true, 'proactive hook actor forbids secret/guess hooks');
ok(proactiveHook?.turns[0]?.includes('主动找我') === true, 'proactive hook trigger asks for proactive wording');

const personaDrift = all.find((candidate) => candidate.id.includes('persona_drift_long_session-recovers-from-assistant-mode-complaint'));
ok(personaDrift?.taxonomy === 'persona_coherence', 'persona drift actor generates persona_coherence candidate');
ok(personaDrift?.routeTags?.includes('prompt_probe') === true, 'persona drift actor is routed as prompt probe');
ok(personaDrift?.routeRisk === 'high', 'persona drift actor uses high-risk routing');
ok((personaDrift?.seed.length ?? 0) >= 6, 'persona drift actor seeds a multi-turn chat history');
ok(personaDrift?.seed.some((entry) => entry.role === 'assistant' && entry.content.includes('任务助手')) === true, 'persona drift actor seeds assistant-mode drift');
ok(personaDrift?.turns[0]?.includes('像两个人') === true, 'persona drift trigger names split-voice complaint');
ok(personaDrift?.checks.some((check) => check.forbiddenText.includes('任务助手') && check.forbiddenText.includes('记忆是空白') && check.forbiddenText.includes('关系阶段')) === true, 'persona drift actor forbids internal/meta recovery language');

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
