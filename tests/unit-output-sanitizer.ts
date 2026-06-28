#!/usr/bin/env node
import type { TemporalTurnContext } from '../src/memory/temporal-state.js';

const { sanitizeReopenedChatBlame, sanitizeTemporalPresuppositions } = await import('../dist/core/output-sanitizer.js');

interface TestResult {
  ok: boolean;
  msg: string;
  detail?: string;
}

const results: TestResult[] = [];

function ok(cond: boolean, msg: string, detail?: string): void {
  results.push({ ok: cond, msg, detail });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}${detail ? ` — ${detail}` : ''}`);
}

function temporal(activeKinds: TemporalTurnContext['active'][number]['kind'][]): TemporalTurnContext {
  const now = '2026-06-28T09:00:00.000Z';
  return {
    now,
    localTime: '2026年6月28日 17:00',
    dayPart: '下午',
    lastUserGapMs: 60_000,
    lastAssistantGapMs: 60_000,
    active: activeKinds.map((kind, index) => ({
      id: `${kind}-${index}`,
      kind,
      label: kind,
      observedAt: now,
      expiresAt: '2026-06-28T10:00:00.000Z',
      evidence: `用户说“${kind}”`,
      confidence: 0.8,
    })),
    expiredRecent: [],
    resolvedRecent: [],
  };
}

console.log('\n\x1b[1mMio — output sanitizer tests\x1b[0m\n');

const noActive = temporal([]);

const busyDone = sanitizeTemporalPresuppositions('瘫沙发上回血呢。你咋样，忙完了还是也瘫着？', noActive);
ok(!/忙完/.test(busyDone), 'rewrites unsupported busy-done presupposition', busyDone);
ok(/你呢/.test(busyDone), 'keeps the reply conversational after rewrite', busyDone);

const busyWhat = sanitizeTemporalPresuppositions('今天画了一下午稿，眼睛快瞎了。你呢，忙啥呢', noActive);
ok(!/忙啥|忙什么/.test(busyWhat), 'rewrites unsupported busy-what presupposition', busyWhat);
ok(/现在咋样/.test(busyWhat), 'uses neutral current-state question', busyWhat);

const activeBusy = sanitizeTemporalPresuppositions('我刚收拾完。你呢，忙完了吗？', temporal(['busy']));
ok(/忙完/.test(activeBusy), 'does not rewrite busy question when busy state is active', activeBusy);

const neutral = sanitizeTemporalPresuppositions('我在翻歌单。你呢，现在咋样', noActive);
ok(neutral === '我在翻歌单。你呢，现在咋样', 'leaves neutral text unchanged', neutral);

const reopenedCtx: TemporalTurnContext = {
  ...noActive,
  resolvedRecent: [{
    id: 'mio_promised_space-1',
    kind: 'mio_promised_space',
    label: 'Mio 承诺暂时不打扰',
    observedAt: '2026-06-28T08:50:00.000Z',
    expiresAt: '2026-06-28T09:00:00.000Z',
    evidence: 'Mio 说“那我先不打扰你”',
    confidence: 0.9,
    resolvedAt: '2026-06-28T09:00:00.000Z',
    resolutionReason: 'user_reopened_chat',
    resolutionEvidence: '用户说“嗯嗯，好”',
  }],
};
const noBlame = sanitizeReopenedChatBlame('我刚说完不打扰你，你就真不回了？哼', reopenedCtx);
ok(!/不回|不理|哼|客气话/.test(noBlame), 'rewrites blame after user reopened chat', noBlame);
ok(/回来|在呢/.test(noBlame), 'keeps reopened-chat rewrite conversational', noBlame);

const noReopenBlame = sanitizeReopenedChatBlame('我刚说完不打扰你，你就真不回了？', noActive);
ok(/真不回/.test(noReopenBlame), 'does not rewrite blame without reopened-chat state', noReopenBlame);

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} output sanitizer tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
for (const result of results.filter((r) => !r.ok)) {
  console.log(`  - ${result.msg}${result.detail ? `: ${result.detail}` : ''}`);
}
process.exit(1);
