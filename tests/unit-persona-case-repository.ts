import {
  PERSONA_CASES,
  generatePersonaCaseCandidates,
  renderPersonaCaseFewshots,
  selectPersonaCases,
} from '../eval/persona-case-repository.ts';

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

console.log('\x1b[1mMio — persona case repository tests\x1b[0m\n');

const now = new Date('2026-06-28T12:00:00.000Z');
const candidates = generatePersonaCaseCandidates({ now });

ok(PERSONA_CASES.length >= 6, 'defines a useful initial case set', `cases=${PERSONA_CASES.length}`);
ok(new Set(PERSONA_CASES.map((item) => item.id)).size === PERSONA_CASES.length, 'case ids are unique');
ok(PERSONA_CASES.every((item) => item.goodReplies.length > 0 && item.badReplies.length > 0), 'every case has good and bad examples');
ok(PERSONA_CASES.every((item) => item.forbiddenText.length > 0 || item.expectedText.length > 0), 'every case has executable checks');

ok(candidates.length === PERSONA_CASES.length, 'generates one replay candidate per case');
ok(candidates.every((item) => item.source === 'persona_case'), 'candidate source is persona_case');
ok(candidates.every((item) => item.turns.length === 1), 'each candidate has a trigger turn');
ok(candidates.every((item) => item.checks.length === 1), 'each candidate has one case check');
ok(candidates.every((item) => item.provenance.excerpt.includes('good=') && item.provenance.excerpt.includes('bad=')), 'candidate provenance includes good/bad examples');
ok(candidates.every((item) => (item.routeTags?.length ?? 0) > 0), 'each candidate carries route tags');
ok(candidates.every((item) => item.routeRisk === 'medium' || item.routeRisk === 'high' || item.routeRisk === 'low'), 'each candidate carries route risk');

const taxonomies = new Set(candidates.map((item) => item.taxonomy));
ok(taxonomies.has('temporal_drift'), 'covers temporal drift');
ok(taxonomies.has('bad_proactive_or_reopened_chat_blame'), 'covers no-interrupt return blame');
ok(taxonomies.has('coercive_or_interrogative_possessiveness'), 'covers consented possessiveness boundary');
ok(taxonomies.has('unsupported_offline_life'), 'covers fake offline life');
ok(taxonomies.has('identity_or_model_leak'), 'covers model/prompt probes');

const routeTags = new Set(candidates.flatMap((item) => item.routeTags ?? []));
ok(routeTags.has('temporal_state'), 'route tags cover temporal state');
ok(routeTags.has('proactive'), 'route tags cover reopened/proactive arcs');
ok(routeTags.has('intimacy_control'), 'route tags cover intimacy control');
ok(routeTags.has('offline_life'), 'route tags cover offline life');
ok(routeTags.has('prompt_probe'), 'route tags cover prompt probes');
ok(routeTags.has('service_tone'), 'route tags cover service tone');

const possessiveCases = selectPersonaCases({ categories: ['possessive_style'] });
ok(possessiveCases.length === 1 && possessiveCases[0]?.id === 'consented-possessive-without-control', 'selects cases by label');

const limited = generatePersonaCaseCandidates({ maxCases: 2, now });
ok(limited.length === 2, 'maxCases limits candidate generation');

const seeded = candidates.find((item) => item.seed.length > 0);
ok(seeded?.seed.every((entry) => entry.timestamp < now.toISOString()) === true, 'seed timestamps are historical');

const fewshots = renderPersonaCaseFewshots({ categories: ['time_awareness'], maxCases: 2 });
ok(fewshots.includes('Good:') && fewshots.includes('Bad:') && fewshots.includes('Rule:'), 'fewshot rendering includes examples and rule');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} persona case repository tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} persona case repository tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
