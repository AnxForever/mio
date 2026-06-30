#!/usr/bin/env node
/**
 * U-FALLBACK — Provider fallback chain (P2#7 wiring).
 *
 * FallbackChainProvider wraps a chain of providers so a recoverable failure
 * (network / 5xx / 429) on the primary transparently retries with the next
 * keyed provider. These tests pin the *build-chain* guarantees that make the
 * feature safe to enable by default on the main turn path:
 *
 *   - Single-key setup → chain has only the primary (no surprise switching).
 *   - Multi-key setup  → primary first, then keyed fallbacks in default order.
 *   - Primary without a key is dropped; a keyed fallback leads instead.
 *   - Zero-key setup    → chain degrades to MockProvider, never breaks startup.
 *   - mock preset is never wrapped even with enableFallback=true.
 *   - selectProvider(enableFallback) wraps real presets and leaves mock alone.
 *   - drainFallbackEvents is empty before any fallback and clears after drain.
 *
 * Runtime failover behaviour (401/403 vs recoverable, per-provider chat retry)
 * is NOT covered here: FallbackChainProvider builds its providers from presets
 * internally, so injecting a failing provider would require refactoring
 * buildChain / isRecoverableError into testable units. Left as a follow-up.
 *
 * Like unit-rerank.ts, runtime symbols are loaded from `dist/` via dynamic
 * import — static `src/*.js` imports do not resolve under
 * --experimental-strip-types, so the suite depends on `npm run build` first.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface TestResult { name: string; passed: boolean; detail?: string; }
const results: TestResult[] = [];

function record(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'mio-fallback-'));
process.env.MIO_DIR = dataDir;
// Explicit preset names are passed to every call, so resolveProvider never
// enters the auto-detect path — MIO_PROVIDER (mock under `npm test`) is inert.

// Runtime symbols come from the built dist/ (see header comment).
const {
  selectProvider,
  selectProviderWithFallback,
  drainFallbackEvents,
  resetFallbackCache,
  FallbackChainProvider,
} = await import('../dist/providers/index.js');

const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'ZHIPU_API_KEY',
  'MOONSHOT_API_KEY', 'MINIMAX_API_KEY', 'DASHSCOPE_API_KEY', 'DOUBAO_API_KEY',
  'SILICONFLOW_API_KEY',
];

function clearAllKeys(): void {
  for (const k of PROVIDER_KEYS) delete process.env[k];
}
function setKeys(...keys: string[]): void {
  clearAllKeys();
  for (const k of keys) process.env[k] = 'test-key';
}

await test('single-key chain contains only the primary', () => {
  resetFallbackCache();
  setKeys('ANTHROPIC_API_KEY');
  const chain = selectProviderWithFallback('anthropic');
  assert(chain.providerChain.length === 1, `expected length 1, got ${chain.providerChain.length}`);
  assert(chain.providerChain[0] === 'anthropic', `expected primary anthropic, got ${chain.providerChain[0]}`);
});

await test('multi-key chain: primary first, keyed fallbacks follow', () => {
  resetFallbackCache();
  setKeys('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY');
  const chain = selectProviderWithFallback('anthropic');
  assert(chain.providerChain[0] === 'anthropic', 'primary must be first');
  assert(chain.providerChain.length >= 2, `expected fallbacks, got ${chain.providerChain.length}`);
  assert(chain.providerChain.includes('openai'), 'openai fallback missing');
  assert(chain.providerChain.includes('deepseek'), 'deepseek fallback missing');
});

await test('keyless primary is dropped; a keyed fallback leads instead', () => {
  resetFallbackCache();
  // anthropic has no key here, but openai does — chain must not crash.
  setKeys('OPENAI_API_KEY');
  const chain = selectProviderWithFallback('anthropic');
  assert(chain.isAvailable, 'chain must stay available');
  assert(chain.providerChain.includes('openai'), 'openai should lead the chain');
  assert(!chain.providerChain.includes('anthropic'), 'keyless primary must be dropped');
});

await test('zero-key environment degrades to MockProvider, never breaks', () => {
  resetFallbackCache();
  clearAllKeys();
  const chain = selectProviderWithFallback('anthropic');
  assert(chain.isAvailable, 'chain must always be available');
  assert(chain.providerChain.includes('mock'), 'mock last-resort missing');
});

await test('mock preset is never wrapped even with enableFallback=true', () => {
  resetFallbackCache();
  setKeys('ANTHROPIC_API_KEY');
  const provider = selectProvider('mock', undefined, true);
  assert(!(provider instanceof FallbackChainProvider), 'mock must not be wrapped in fallback chain');
});

await test('selectProvider(enableFallback=true) wraps a real preset', () => {
  resetFallbackCache();
  setKeys('ANTHROPIC_API_KEY');
  const provider = selectProvider('anthropic', undefined, true);
  assert(provider instanceof FallbackChainProvider, 'expected FallbackChainProvider');
});

await test('selectProvider(enableFallback=false) returns a plain provider', () => {
  resetFallbackCache();
  setKeys('ANTHROPIC_API_KEY');
  const provider = selectProvider('anthropic', undefined, false);
  assert(!(provider instanceof FallbackChainProvider), 'plain provider must not be a fallback chain');
});

await test('drainFallbackEvents is empty before any fallback and clears after drain', () => {
  resetFallbackCache();
  const first = drainFallbackEvents();
  assert(first.length === 0, `expected 0 events, got ${first.length}`);
  const second = drainFallbackEvents();
  assert(second.length === 0, 'drain must clear the buffer');
});

// ─── Summary ───
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
rmSync(dataDir, { recursive: true, force: true });
if (failed.length > 0) {
  console.error('\x1b[31mFAILED:\x1b[0m');
  for (const f of failed) console.error(`  ✗ ${f.name}: ${f.detail}`);
  process.exit(1);
}
