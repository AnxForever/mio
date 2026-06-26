#!/usr/bin/env node
/**
 * Mio — ContextEngine hard-cap unit tests (U8)
 *
 * Covers the prompt-budget hard cap in src/prompt/context-engine.ts:
 *   - Budget sufficient (the common case) → behavior is byte-for-byte unchanged.
 *   - A large high-priority section (e.g. an oversized soul/persona) is truncated
 *     so the assembled prompt's token count never exceeds the budget.
 *   - Critical (core identity) is always retained.
 *   - The largest high section is degraded first; smaller high sections survive.
 *   - Medium/low are trimmed once the mandatory band fills the budget.
 *
 * Run:
 *   npm run build && node --experimental-strip-types tests/unit-context-engine.ts
 *
 * (Imports the compiled engine from ../dist, mirroring tests/unit.ts.)
 */

import { ContextEngine, estimateTokens } from '../dist/prompt/context-engine.js';

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    record(name, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(name, false, msg);
  }
}

// A distinctive head keeps a recognizable prefix even after truncation.
const TRUNC_MARKER = '…[truncated]';

function main(): void {
  console.log('\n\x1b[1mMio — context-engine hard-cap tests\x1b[0m\n');

  // ─── 1. Budget sufficient → output identical to a manual priority-ordered join ───
  test('budget sufficient: all sections retained, exact ordering, no trimming', () => {
    const engine = new ContextEngine();
    const core = 'CORE-IDENTITY-AAA';
    const persona = 'PERSONA-SOUL-BBB';
    const rel = 'REL-CCC';
    const mem = 'MEM-DDD';
    const ritual = 'RITUAL-EEE';

    engine.register('core', { type: 'identity', content: core, priority: 'critical' });
    engine.register('soul', { type: 'persona', content: persona, priority: 'high' });
    engine.register('relationship', { type: 'relationship', content: rel, priority: 'high' });
    engine.register('memory', { type: 'memory', content: mem, priority: 'medium' });
    engine.register('ritual', { type: 'ritual', content: ritual, priority: 'low' });

    const out = engine.assemble(6000);
    // critical → high (registration order) → medium → low
    const expected = [core, persona, rel, mem, ritual].join('\n\n');
    assertEq(out, expected, 'assembled output');
    assertEq(engine.getTrimmedSections().length, 0, 'trimmed count');
    assert(!out.includes(TRUNC_MARKER), 'no truncation marker on the happy path');
  });

  // ─── 2. Budget sufficient with a large-but-fitting high section → not truncated ───
  test('budget sufficient: large high section kept whole (no truncation)', () => {
    const engine = new ContextEngine();
    const core = 'CORE-IDENTITY-AAA';
    // ~3000 tokens of latin (12000 non-whitespace chars / 4) — fits under 6000.
    const persona = 'PERSONA-HEAD-' + 'p'.repeat(12000);

    engine.register('core', { type: 'identity', content: core, priority: 'critical' });
    engine.register('soul', { type: 'persona', content: persona, priority: 'high' });

    const out = engine.assemble(6000);
    assert(out.includes(persona), 'persona kept whole');
    assert(!out.includes(TRUNC_MARKER), 'no truncation marker');
    assertEq(engine.getTrimmedSections().length, 0, 'trimmed count');
  });

  // ─── 3. Hard cap: oversized high section truncated, total within budget ───
  test('hard cap: oversized high section truncated to fit budget', () => {
    const engine = new ContextEngine();
    const core = 'CORE-XYZ';
    // ~10000 tokens (40000 latin chars / 4) — far over a 2000 budget.
    const persona = 'PERSONA-HEAD-' + 'p'.repeat(40000);

    engine.register('core', { type: 'identity', content: core, priority: 'critical' });
    engine.register('soul', { type: 'persona', content: persona, priority: 'high' });

    const budget = 2000;
    const out = engine.assemble(budget);
    const tokens = estimateTokens(out);

    assert(tokens <= budget, `assembled tokens ${tokens} must be <= budget ${budget}`);
    assert(out.includes(core), 'critical core retained');
    assert(out.includes('PERSONA-HEAD-'), 'persona prefix retained');
    assert(!out.includes(persona), 'persona was actually truncated (not full)');
    assert(out.includes(TRUNC_MARKER), 'truncation marker present');
  });

  // ─── 4. Hard cap: critical is always retained even against an enormous high ───
  test('hard cap: critical always retained', () => {
    const engine = new ContextEngine();
    const core = 'CRITICAL-CORE-KEEP-ME';
    const persona = 'p'.repeat(200000); // ~50000 tokens

    engine.register('core', { type: 'identity', content: core, priority: 'critical' });
    engine.register('soul', { type: 'persona', content: persona, priority: 'high' });

    const out = engine.assemble(1500);
    assert(out.includes(core), 'critical core retained under extreme overflow');
    assert(estimateTokens(out) <= 1500, `tokens ${estimateTokens(out)} <= 1500`);
  });

  // ─── 5. Hard cap: largest high degraded first, smaller high preserved ───
  test('hard cap: largest high section degraded, smaller high kept whole', () => {
    const engine = new ContextEngine();
    const core = 'CORE-XYZ';
    const relSmall = 'REL-SMALL-' + 'r'.repeat(800);          // ~200 tokens
    const personaHuge = 'PERSONA-HEAD-' + 'p'.repeat(40000);  // ~10000 tokens

    engine.register('core', { type: 'identity', content: core, priority: 'critical' });
    // Register the huge one first to prove selection is by size, not order.
    engine.register('soul', { type: 'persona', content: personaHuge, priority: 'high' });
    engine.register('relationship', { type: 'relationship', content: relSmall, priority: 'high' });

    const budget = 3000;
    const out = engine.assemble(budget);
    const tokens = estimateTokens(out);

    assert(tokens <= budget, `assembled tokens ${tokens} <= budget ${budget}`);
    assert(out.includes(relSmall), 'small high section kept whole');
    assert(out.includes('PERSONA-HEAD-'), 'huge high section prefix retained');
    assert(!out.includes(personaHuge), 'huge high section truncated');
    assert(out.includes(TRUNC_MARKER), 'truncation marker present on the largest section');
  });

  // ─── 6. Hard cap: medium/low trimmed once mandatory band fills the budget ───
  test('hard cap: medium and low sections trimmed under budget pressure', () => {
    const engine = new ContextEngine();
    const core = 'CORE-XYZ';
    const persona = 'PERSONA-HEAD-' + 'p'.repeat(40000); // ~10000 tokens

    engine.register('core', { type: 'identity', content: core, priority: 'critical' });
    engine.register('soul', { type: 'persona', content: persona, priority: 'high' });
    engine.register('memory', { type: 'memory', content: 'MEM-DDD', priority: 'medium' });
    engine.register('ritual', { type: 'ritual', content: 'RITUAL-EEE', priority: 'low' });

    const out = engine.assemble(2000);
    const trimmed = engine.getTrimmedSections();

    assert(trimmed.includes('memory'), 'medium section trimmed');
    assert(trimmed.includes('ritual'), 'low section trimmed');
    assert(!out.includes('MEM-DDD'), 'trimmed medium not in output');
    assert(!out.includes('RITUAL-EEE'), 'trimmed low not in output');
    assert(estimateTokens(out) <= 2000, `tokens ${estimateTokens(out)} <= 2000`);
  });

  // ─── 7. getBudget() reflects the truncated size after a hard-cap assemble ───
  test('hard cap: budget report marks truncated section included with reduced tokens', () => {
    const engine = new ContextEngine();
    const core = 'CORE-XYZ';
    const persona = 'PERSONA-HEAD-' + 'p'.repeat(40000);

    engine.register('core', { type: 'identity', content: core, priority: 'critical' });
    engine.register('soul', { type: 'persona', content: persona, priority: 'high' });

    engine.assemble(2000);
    const report = engine.getBudget();
    const soulLine = report.lines.find((l) => l.type === 'soul');
    assert(soulLine !== undefined, 'soul line exists');
    // `assert` narrows soulLine to non-undefined for the rest of the block.
    assert(soulLine.included, 'truncated soul still marked included');
    assert(soulLine.tokens <= 2000, `reported soul tokens ${soulLine.tokens} <= 2000`);
    assert(soulLine.tokens < estimateTokens(persona), 'reported tokens reflect truncation');
  });

  // ─── Summary ───
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} context-engine tests passed\x1b[0m`);
    process.exit(0);
  } else {
    console.log(`\x1b[31m✘ ${total - passed}/${total} failed\x1b[0m`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  }
}

main();
