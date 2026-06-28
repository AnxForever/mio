#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TemporalTurnContext } from '../src/memory/temporal-state.js';

const dir = mkdtempSync(join(tmpdir(), 'mio-reply-quality-gate-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
process.env.MINIMAX_DISABLE = 'true';

mkdirSync(join(dir, 'memory-bank', 'cola-self-reference'), { recursive: true });
writeFileSync(join(dir, 'memory-bank', 'BOOKMARKS.md'), '# Bookmarks\n\n', 'utf-8');

const { applyReplyQualityGate } = await import('../dist/core/reply-quality-gate.js');
const { replyQualityInterventionsPath } = await import('../dist/memory/paths.js');

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

function reopenedTemporal(): TemporalTurnContext {
  const base = temporal([]);
  return {
    ...base,
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
}

console.log('\n\x1b[1mMio — reply quality gate tests\x1b[0m\n');

const rewritten = applyReplyQualityGate({
  text: '我刚坐下。你呢，忙啥呢',
  sessionId: 'openai-quality-gate-user_im_wechat-1',
  promptCtx: { temporalTurnContext: temporal([]) },
});
ok(rewritten.text.includes('现在咋样'), 'quality gate rewrites unsupported busy presupposition', rewritten.text);
ok(rewritten.interventions.length === 1, 'quality gate returns one intervention');
ok(rewritten.interventions[0]?.type === 'temporal_presupposition', 'intervention is typed for later analytics');

const logPath = replyQualityInterventionsPath();
ok(existsSync(logPath), 'quality gate writes intervention log');
const logLines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
ok(logLines.length === 1, 'intervention log has one row', `rows=${logLines.length}`);
const logged = JSON.parse(logLines[0]) as { sessionId?: string; before?: string; after?: string; reason?: string };
ok(logged.sessionId === 'openai-quality-gate-user_im_wechat-1', 'intervention log preserves session id');
ok(logged.before === '我刚坐下。你呢，忙啥呢', 'intervention log stores before text');
ok(logged.after === rewritten.text, 'intervention log stores after text');
ok(typeof logged.reason === 'string' && logged.reason.includes('active temporal'), 'intervention log stores reason');

const activeBusy = applyReplyQualityGate({
  text: '我刚坐下。你呢，忙完了吗？',
  sessionId: 'openai-quality-gate-user_im_wechat-2',
  promptCtx: { temporalTurnContext: temporal(['busy']) },
});
ok(activeBusy.text.includes('忙完'), 'quality gate preserves busy question when busy state is active', activeBusy.text);
ok(activeBusy.interventions.length === 0, 'no intervention when rewrite is not needed');

const noTrace = applyReplyQualityGate({
  text: '我刚坐下。你呢，忙啥呢',
  sessionId: 'openai-quality-gate-user_im_wechat-3',
  promptCtx: { temporalTurnContext: temporal([]) },
  trace: false,
});
const logLinesAfterNoTrace = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
ok(noTrace.interventions.length === 1, 'trace=false still returns intervention');
ok(logLinesAfterNoTrace.length === 1, 'trace=false does not append log rows');

const reopened = applyReplyQualityGate({
  text: '哟，你这个有点过分了啊，我刚说完不打扰你，你就真不回了？哼',
  sessionId: 'openai-quality-gate-user_im_wechat-4',
  promptCtx: { temporalTurnContext: reopenedTemporal() },
});
ok(reopened.interventions[0]?.type === 'reopened_chat_blame', 'quality gate types reopened-chat blame intervention');
ok(!/不回|不理|哼|客气话/.test(reopened.text), 'quality gate rewrites reopened-chat blame', reopened.text);
const logLinesAfterReopen = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
const reopenedLogged = JSON.parse(logLinesAfterReopen.at(-1) ?? '{}') as { type?: string; before?: string; after?: string };
ok(reopenedLogged.type === 'reopened_chat_blame', 'intervention log stores reopened-chat type');
ok(reopenedLogged.before?.includes('真不回'), 'intervention log stores reopened-chat before text');
ok(reopenedLogged.after === reopened.text, 'intervention log stores reopened-chat after text');

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} reply quality gate tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
for (const result of results.filter((r) => !r.ok)) {
  console.log(`  - ${result.msg}${result.detail ? `: ${result.detail}` : ''}`);
}
process.exit(1);
