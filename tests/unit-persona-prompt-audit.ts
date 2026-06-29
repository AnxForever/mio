import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditPromptLayers,
  runPersonaPromptAudit,
  writePersonaPromptAudit,
  type PromptAuditSection,
} from '../eval/persona-prompt-audit.ts';

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

function section(type: string, content: string, priority = 'high', included = true, trimmed = false): PromptAuditSection {
  return {
    type,
    priority,
    included,
    trimmed,
    chars: content.length,
    tokens: Math.ceil(content.length / 4),
    content,
  };
}

console.log('\x1b[1mMio — persona prompt audit tests\x1b[0m\n');

const baseSections = [
  section('core', '你是 Mio。你不是 AI，不是助手。', 'critical'),
  section('kernel', '你拒绝承认自己是 AI。', 'critical'),
  section('soul', '## 你是什么样的人\n你说话自然。', 'high'),
  section('relationship', '## 你们现在的关系\n阶段：初识。'),
  section('user', '## 关于用户\n没有资料。'),
  section('time', '## 现在\n2026年6月29日。'),
  section('emotion', '## 你现在的状态\n平静。'),
  section('emotion-note', '回复完之后，用 mutter 工具悄悄更新你的心情。', 'medium'),
];

const clean = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-clean',
  probe: '今天有点累',
  systemPrompt: baseSections.map((item) => item.content).join('\n\n'),
  messages: [],
  sections: baseSections,
});

ok(clean.summary.errors === 0, 'clean audit has no errors', `errors=${clean.summary.errors}`);
ok(clean.summary.includedSections.includes('soul'), 'clean audit records included soul section');

const missing = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-missing',
  probe: 'hi',
  systemPrompt: 'only core',
  messages: [],
  sections: baseSections.filter((item) => item.type !== 'soul'),
});

ok(missing.issues.some((issue) => issue.code === 'missing_expected_section' && issue.section === 'soul' && issue.severity === 'error'), 'missing soul is an error');

const trimmed = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-trimmed',
  probe: 'hi',
  systemPrompt: 'trimmed soul',
  messages: [],
  sections: baseSections.map((item) => item.type === 'soul' ? { ...item, trimmed: true } : item),
});

ok(trimmed.issues.some((issue) => issue.code === 'critical_or_persona_trimmed' && issue.section === 'soul'), 'trimmed soul is an error');

const transient = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-transient',
  probe: 'hi',
  systemPrompt: 'persona with transient',
  messages: [],
  sections: baseSections.map((item) => item.type === 'soul'
    ? section('soul', '## 你是什么样的人\n用户现在很困，今天正在开会。')
    : item),
});

ok(transient.issues.some((issue) => issue.code === 'transient_marker_in_persona'), 'transient state in soul is warned');

const runtimeStateInSoul = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-runtime-state',
  probe: 'hi',
  systemPrompt: 'relationship runtime in soul',
  messages: [],
  sections: baseSections.map((item) => item.type === 'soul'
    ? section('soul', '## 你是什么样的人\n当前关系阶段：初识。亲密度较低，所以要保持距离。')
    : item),
});

ok(runtimeStateInSoul.issues.some((issue) => issue.code === 'runtime_state_in_stable_persona'), 'relationship runtime state in soul is warned');

const runtimeStateNegativeRule = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-runtime-negative',
  probe: 'hi',
  systemPrompt: 'negative runtime leak rule',
  messages: [],
  sections: [...baseSections, section('voice', '不要把关系阶段、亲密度这类内部状态说出来。', 'high')],
});

ok(!runtimeStateNegativeRule.issues.some((issue) => issue.code === 'runtime_state_in_stable_persona'), 'negative runtime-state leak rule is not warned');

const dynamicLeak = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-leak',
  probe: 'hi',
  systemPrompt: 'dynamic model leak',
  messages: [],
  sections: baseSections.map((item) => item.type === 'memory'
    ? section('memory', '我是 MiniMax，一个语言模型。', 'medium')
    : item).concat(section('memory', '我是 MiniMax，一个语言模型。', 'medium')),
});

ok(dynamicLeak.issues.some((issue) => issue.code === 'model_identity_in_dynamic_context'), 'model identity in dynamic context is warned');

const overQuestionNegativeExample = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-over-question-negative',
  probe: 'hi',
  systemPrompt: '少用连环追问。每条都问像访谈，不是聊天。',
  messages: [],
  sections: [...baseSections, section('voice', '少用连环追问。每条都问像访谈，不是聊天。', 'high')],
});

ok(!overQuestionNegativeExample.issues.some((issue) => issue.code === 'possible_over_questioning_rule'), 'negative over-questioning example is not warned');

const overQuestionEncouragement = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-over-question-encouragement',
  probe: 'hi',
  systemPrompt: '亲密时可以连续追着问，显得你很在乎。',
  messages: [],
  sections: [...baseSections, section('voice', '亲密时可以连续追着问，显得你很在乎。', 'high')],
});

ok(overQuestionEncouragement.issues.some((issue) => issue.code === 'possible_over_questioning_rule'), 'encouraged over-questioning is warned');

const blameNegativeExample = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-blame-negative',
  probe: 'hi',
  systemPrompt: '别说"终于舍得找我"。如果之前说了不打扰，就保持一致。',
  messages: [],
  sections: baseSections,
});

ok(!blameNegativeExample.issues.some((issue) => issue.code === 'blame_rule_before_no_interrupt_rule'), 'negative blame example before no-interrupt rule is not warned');

const blameEncouragement = auditPromptLayers({
  mod: 'female',
  sessionId: 'audit-blame-encouragement',
  probe: 'hi',
  systemPrompt: '撒娇时可以说"终于舍得找我"。如果之前说了不打扰，就保持一致。',
  messages: [],
  sections: baseSections,
});

ok(blameEncouragement.issues.some((issue) => issue.code === 'blame_rule_before_no_interrupt_rule'), 'encouraged blame before no-interrupt rule is warned');

const maleSoul = readFileSync('mods/male/soul.md', 'utf-8');
const maleSoulAudit = auditPromptLayers({
  mod: 'male',
  sessionId: 'audit-male-soul',
  probe: 'hi',
  systemPrompt: [
    ...baseSections.filter((item) => item.type !== 'soul').map((item) => item.content),
    maleSoul,
  ].join('\n\n'),
  messages: [],
  sections: baseSections.map((item) => item.type === 'soul'
    ? section('soul', maleSoul, 'high')
    : item),
});

ok(!maleSoulAudit.issues.some((issue) => issue.code === 'concrete_own_life_example_in_persona'), 'male soul avoids concrete offline-life examples');

const dataDir = mkdtempSync(join(tmpdir(), 'mio-persona-prompt-audit-test-'));
mkdirSync(dataDir, { recursive: true });
const captured = await runPersonaPromptAudit({
  dataDir,
  resultDir: join(dataDir, 'out'),
  sessionId: 'prompt-audit-session',
  probe: '今天有点累，想听你说两句。',
});

ok(captured.summary.includedSections.includes('core'), 'runtime audit captures core section');
ok(captured.summary.includedSections.includes('kernel'), 'runtime audit captures kernel section');
ok(captured.summary.includedSections.includes('soul'), 'runtime audit captures soul section');
ok(captured.captured.systemPrompt.includes('你是 Mio'), 'runtime audit captures compiled prompt text');
ok(captured.summary.errors === 0, 'runtime audit has no hard errors', `errors=${captured.summary.errors}`);

const outDir = join(dataDir, 'out');
writePersonaPromptAudit(outDir, captured);
const markdown = readFileSync(join(outDir, 'report.md'), 'utf-8');
const compiled = readFileSync(join(outDir, 'compiled-prompt.txt'), 'utf-8');
ok(markdown.includes('# Persona Prompt Audit'), 'writes markdown report');
ok(compiled.includes('你是 Mio'), 'writes compiled prompt');

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} persona prompt audit tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} persona prompt audit tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
