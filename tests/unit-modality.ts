#!/usr/bin/env node
/**
 * Mio — provider modality gating tests.
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-modality.ts
 */
import { stripUnsupportedModality } from '../dist/providers/openai-compatible.js';
import type { ContentBlock } from '../dist/types.js';

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — modality gating tests\x1b[0m\n');

const txt: ContentBlock = { type: 'text', text: '你好' };
const img = { type: 'image' } as unknown as ContentBlock;

// vision-capable provider → unchanged
{
  const out = stripUnsupportedModality([txt, img], true);
  ok(out.length === 2 && out[1].type === 'image', 'vision provider keeps images');
}

// text-only provider → image replaced with text placeholder
{
  const out = stripUnsupportedModality([txt, img], false);
  ok(out.every((b) => b.type === 'text'), 'text-only provider strips images to text');
  const second = out[1] as { type: string; text?: string };
  ok(second.type === 'text' && !!second.text && second.text.includes('图片'), 'image replaced with placeholder');
}

// pure text → unaffected either way
{
  const out = stripUnsupportedModality([txt], false);
  ok(out.length === 1 && out[0].type === 'text', 'pure text unaffected');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} modality tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
