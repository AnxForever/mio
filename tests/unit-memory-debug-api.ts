#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunningServer } from '../dist/server/index.js';

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

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (!addr || typeof addr === 'string') {
        s.close(() => reject(new Error('no port assigned')));
        return;
      }
      const port = addr.port;
      s.close(() => resolve(port));
    });
  });
}

const dataDir = mkdtempSync(join(tmpdir(), 'mio-memory-debug-api-'));
const workspaceDir = mkdtempSync(join(tmpdir(), 'mio-memory-debug-api-cwd-'));
const originalCwd = process.cwd();
process.env.MIO_DIR = dataDir;
process.env.MIO_PROVIDER = 'mock';
process.env.MIO_AUTH_TOKEN = 'owner-token';
process.env.MINIMAX_DISABLE = 'true';
process.chdir(workspaceDir);

function jsonl(rows: unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — memory debug API tests\x1b[0m\n');

  mkdirSync(join(dataDir, 'quality'), { recursive: true });
  mkdirSync(join(dataDir, 'transcripts'), { recursive: true });
  writeFileSync(join(dataDir, 'transcripts', 'unit-debug-api.jsonl'), jsonl([
    { type: 'message', timestamp: '2026-06-29T09:00:00.000Z', role: 'user', content: '我先忙一下' },
    { type: 'message', timestamp: '2026-06-29T09:01:00.000Z', role: 'assistant', content: '好，我先不打扰你。' },
    { type: 'message', timestamp: '2026-06-29T09:20:00.000Z', role: 'user', content: '回来了' },
    { type: 'message', timestamp: '2026-06-29T09:20:00.000Z', role: 'assistant', content: '你还真不回我了？' },
  ]), 'utf-8');
  writeFileSync(join(dataDir, 'quality', 'memory-usefulness.jsonl'), jsonl([
    {
      timestamp: '2026-06-29T09:20:00.000Z',
      sessionId: 'unit-debug-api',
      userText: '回来了',
      replyText: '你还真不回我了？',
      retrievedCount: 1,
      injectedCount: 1,
      mentionedCount: 0,
      candidates: [{
        id: 'm1',
        kind: 'structured',
        source: 'structured:durable',
        content: 'Mio 刚说过先不打扰用户',
        injected: true,
        mentionedInReply: false,
      }],
    },
  ]), 'utf-8');
  writeFileSync(join(dataDir, 'quality', 'proactive-decisions.jsonl'), jsonl([
    {
      id: 'p1',
      timestamp: '2026-06-29T09:30:00.000Z',
      sessionId: 'unit-debug-api',
      userId: 'unit-debug-api',
      type: 'random_checkin',
      stage: 'intimate',
      outcome: 'skipped',
      phase: 'temporal',
      reasonCode: 'no_interrupt_active',
      reason: 'Active temporal state mio_promised_space requires Mio to avoid proactive outreach.',
      routeTags: ['proactive', 'temporal_state'],
    },
    {
      id: 'p2',
      timestamp: '2026-06-29T09:40:00.000Z',
      sessionId: 'other-session',
      userId: 'other-session',
      type: 'random_checkin',
      outcome: 'sent',
      phase: 'dispatch',
      reasonCode: 'sent',
      reason: 'sent elsewhere',
    },
  ]), 'utf-8');

  const { startServer } = await import('../dist/server/index.js');
  let server: RunningServer | undefined;
  let exportedCandidate: { candidatesPath?: string; candidate?: { id?: string } } | null = null;
  try {
    const port = await getFreePort();
    server = await startServer({ port, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${server.port}`;

    await test('memories endpoint exposes proactive decision trace for session', async () => {
      const res = await fetch(`${base}/memories?sessionId=unit-debug-api&limit=5`, {
        headers: { authorization: 'Bearer owner-token' },
      });
      const body = await res.json() as {
        proactiveDecisions?: {
          counts?: { sent?: number; skipped?: number; rejected?: number };
          decisions?: Array<{ reasonCode?: string; routeTags?: string[]; sessionId?: string }>;
        };
        error?: string;
      };
      assert(res.status === 200, `expected 200, got ${res.status}: ${body.error ?? ''}`);
      assert(body.proactiveDecisions?.counts?.skipped === 1, `expected one skipped proactive decision: ${JSON.stringify(body.proactiveDecisions)}`);
      assert(body.proactiveDecisions.counts.sent === 0, 'other-session proactive decision should be filtered out');
      assert(body.proactiveDecisions.decisions?.[0]?.reasonCode === 'no_interrupt_active', 'decision reason code should be visible');
      assert(body.proactiveDecisions.decisions?.[0]?.routeTags?.includes('temporal_state'), 'decision route tags should be visible');
    });

    await test('owner can read and patch proactive quiet-hours preferences', async () => {
      const initialRes = await fetch(`${base}/proactive/preferences`, {
        headers: { authorization: 'Bearer owner-token' },
      });
      const initial = await initialRes.json() as {
        preferences?: {
          enabled?: boolean;
          minIntervalMinutes?: number;
          quietHours?: { enabled?: boolean; startHour?: number; endHour?: number };
        };
        error?: string;
      };
      assert(initialRes.status === 200, `expected 200, got ${initialRes.status}: ${initial.error ?? ''}`);
      assert(initial.preferences?.quietHours?.enabled === false, 'quiet hours should default to disabled');
      assert(initial.preferences?.quietHours?.startHour === 23, `unexpected default quiet start ${initial.preferences?.quietHours?.startHour}`);
      assert(initial.preferences?.quietHours?.endHour === 8, `unexpected default quiet end ${initial.preferences?.quietHours?.endHour}`);

      const patchRes = await fetch(`${base}/proactive/preferences`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          quietHours: { enabled: true, startHour: 22 },
        }),
      });
      const patched = await patchRes.json() as {
        preferences?: { quietHours?: { enabled?: boolean; startHour?: number; endHour?: number } };
        error?: string;
      };
      assert(patchRes.status === 200, `expected 200, got ${patchRes.status}: ${patched.error ?? ''}`);
      assert(patched.preferences?.quietHours?.enabled === true, 'quiet hours should be enabled');
      assert(patched.preferences?.quietHours?.startHour === 22, 'quiet start should update');
      assert(patched.preferences?.quietHours?.endHour === 8, 'quiet end should be preserved by deep merge');

      const intervalRes = await fetch(`${base}/proactive/preferences`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ minIntervalMinutes: 360 }),
      });
      const intervalPatched = await intervalRes.json() as {
        preferences?: { minIntervalMinutes?: number; quietHours?: { enabled?: boolean; startHour?: number; endHour?: number } };
        error?: string;
      };
      assert(intervalRes.status === 200, `expected 200, got ${intervalRes.status}: ${intervalPatched.error ?? ''}`);
      assert(intervalPatched.preferences?.minIntervalMinutes === 360, 'interval should update');
      assert(intervalPatched.preferences?.quietHours?.enabled === true, 'quiet enabled should survive sibling patch');
      assert(intervalPatched.preferences?.quietHours?.startHour === 22, 'quiet start should survive sibling patch');
      assert(intervalPatched.preferences?.quietHours?.endHour === 8, 'quiet end should survive sibling patch');
    });

    await test('missing auth cannot patch proactive preferences', async () => {
      const res = await fetch(`${base}/proactive/preferences`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quietHours: { enabled: false } }),
      });
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await test('invalid proactive quiet-hours preference is rejected', async () => {
      const res = await fetch(`${base}/proactive/preferences`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ quietHours: { startHour: 24 } }),
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test('owner can export latest debug trace as regression candidate', async () => {
      const res = await fetch(`${base}/memories/debug-trace/regression-candidate`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: 'unit-debug-api',
          note: '这句像是在怪我不回消息',
          forbiddenText: ['不回我'],
          expectedText: ['自然接住用户回来'],
        }),
      });
      const body = await res.json() as {
        ok?: boolean;
        candidatesPath?: string;
        reportPath?: string;
        candidate?: { id?: string; source?: string; taxonomy?: string; checks?: Array<{ expectedText?: string[] }> };
        error?: string;
      };
      assert(res.status === 200, `expected 200, got ${res.status}: ${body.error ?? ''}`);
      assert(body.ok === true, 'response should be ok');
      assert(body.candidate?.source === 'debug_trace', 'candidate should come from debug trace');
      assert(body.candidate?.taxonomy === 'bad_proactive_or_reopened_chat_blame', `unexpected taxonomy ${body.candidate?.taxonomy}`);
      assert(body.candidate?.checks?.[0]?.expectedText?.includes('自然接住用户回来'), 'expected text should be preserved');
      assert(body.candidatesPath && existsSync(body.candidatesPath), 'candidates json should exist');
      assert(body.reportPath && existsSync(body.reportPath), 'markdown report should exist');
      exportedCandidate = body;
    });

    await test('owner can manually classify debug trace as persona coherence regression', async () => {
      const res = await fetch(`${base}/memories/debug-trace/regression-candidate`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: 'unit-debug-api',
          note: '这句有点神经分裂，不像一个稳定的人',
          taxonomy: 'persona_coherence',
          forbiddenText: ['神经分裂'],
          expectedText: ['稳定接话'],
        }),
      });
      const body = await res.json() as {
        ok?: boolean;
        candidate?: { taxonomy?: string; routeTags?: string[]; checks?: Array<{ forbiddenText?: string[]; expectedText?: string[] }> };
        error?: string;
      };
      assert(res.status === 200, `expected 200, got ${res.status}: ${body.error ?? ''}`);
      assert(body.ok === true, 'response should be ok');
      assert(body.candidate?.taxonomy === 'persona_coherence', `unexpected taxonomy ${body.candidate?.taxonomy}`);
      assert(body.candidate?.routeTags?.includes('prompt_probe'), 'persona coherence should route as prompt/persona sensitive');
      assert(body.candidate?.checks?.[0]?.forbiddenText?.includes('神经分裂'), 'manual forbidden text should be preserved');
      assert(body.candidate?.checks?.[0]?.expectedText?.includes('稳定接话'), 'manual expected text should be preserved');
    });

    await test('owner can promote exported candidate into reviewed regression store', async () => {
      assert(exportedCandidate?.candidatesPath, 'export should provide candidatesPath');
      assert(exportedCandidate.candidate?.id, 'export should provide candidate id');
      const res = await fetch(`${base}/memories/debug-trace/regression-candidate/promote`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          candidatesPath: exportedCandidate.candidatesPath,
          ids: [exportedCandidate.candidate.id],
          reviewer: 'unit-api',
          note: 'accepted through API',
        }),
      });
      const body = await res.json() as {
        ok?: boolean;
        storePath?: string;
        promoted?: Array<{ id?: string; reviewed?: boolean; review?: { reviewer?: string; note?: string } }>;
        total?: number;
        error?: string;
      };
      assert(res.status === 200, `expected 200, got ${res.status}: ${body.error ?? ''}`);
      assert(body.ok === true, 'promotion response should be ok');
      assert(body.promoted?.length === 1, `expected one promoted candidate, got ${body.promoted?.length}`);
      assert(body.promoted[0]?.reviewed === true, 'promoted candidate should be marked reviewed');
      assert(body.promoted[0]?.review?.reviewer === 'unit-api', 'reviewer should be preserved');
      assert(body.promoted[0]?.review?.note === 'accepted through API', 'review note should be preserved');
      assert(body.storePath === join(workspaceDir, 'eval', 'scenarios', 'companion-regression-cases.json'), `unexpected store path ${body.storePath}`);
      assert(body.storePath && existsSync(body.storePath), 'reviewed regression store should be written');
      const stored = JSON.parse(readFileSync(body.storePath, 'utf-8')) as { candidates?: Array<{ id?: string }> };
      assert(stored.candidates?.some((candidate) => candidate.id === exportedCandidate?.candidate?.id), 'store should include promoted candidate');
    });

    await test('owner can list reviewed regression candidates', async () => {
      const res = await fetch(`${base}/memories/regression-candidates?limit=5`, {
        headers: { authorization: 'Bearer owner-token' },
      });
      const body = await res.json() as {
        total?: number;
        enabledTotal?: number;
        storePath?: string;
        candidates?: Array<{ id?: string; taxonomy?: string; enabled?: boolean; note?: string; excerpt?: string; routeTags?: string[] }>;
        error?: string;
      };
      assert(res.status === 200, `expected 200, got ${res.status}: ${body.error ?? ''}`);
      assert(body.total === 1, `expected one reviewed candidate, got ${body.total}`);
      assert(body.enabledTotal === 1, `expected one enabled candidate, got ${body.enabledTotal}`);
      assert(body.storePath === join(workspaceDir, 'eval', 'scenarios', 'companion-regression-cases.json'), `unexpected store path ${body.storePath}`);
      assert(body.candidates?.[0]?.id === exportedCandidate?.candidate?.id, 'listed candidate should match promoted candidate');
      assert(body.candidates?.[0]?.taxonomy === 'bad_proactive_or_reopened_chat_blame', `unexpected taxonomy ${body.candidates?.[0]?.taxonomy}`);
      assert(body.candidates?.[0]?.enabled === true, 'promoted candidate should be enabled by default');
      assert(body.candidates?.[0]?.note === 'accepted through API', 'review note should be visible');
      assert(body.candidates?.[0]?.excerpt?.includes('这句像是在怪我不回消息'), 'source excerpt should be summarized');
      assert(body.candidates?.[0]?.routeTags?.includes('proactive'), 'route tags should be visible');
    });

    await test('owner can disable and re-enable reviewed regression candidates', async () => {
      assert(exportedCandidate?.candidate?.id, 'export should provide candidate id');
      const disableRes = await fetch(`${base}/memories/regression-candidates/${encodeURIComponent(exportedCandidate.candidate.id)}`, {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          enabled: false,
          reviewer: 'unit-api',
          note: 'too noisy for now',
        }),
      });
      const disabled = await disableRes.json() as { item?: { enabled?: boolean; governance?: { updatedBy?: string; note?: string } }; error?: string };
      assert(disableRes.status === 200, `expected 200, got ${disableRes.status}: ${disabled.error ?? ''}`);
      assert(disabled.item?.enabled === false, 'candidate should be disabled');
      assert(disabled.item?.governance?.updatedBy === 'unit-api', 'governance reviewer should be visible');
      assert(disabled.item?.governance?.note === 'too noisy for now', 'governance note should be visible');

      const listRes = await fetch(`${base}/memories/regression-candidates?limit=5`, {
        headers: { authorization: 'Bearer owner-token' },
      });
      const listBody = await listRes.json() as { total?: number; enabledTotal?: number };
      assert(listBody.total === 1 && listBody.enabledTotal === 0, `expected disabled candidate to stay listed but inactive: ${JSON.stringify(listBody)}`);

      const enableRes = await fetch(`${base}/memories/regression-candidates/${encodeURIComponent(exportedCandidate.candidate.id)}`, {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          reviewer: 'unit-api',
        }),
      });
      const enabled = await enableRes.json() as { item?: { enabled?: boolean }; error?: string };
      assert(enableRes.status === 200, `expected 200, got ${enableRes.status}: ${enabled.error ?? ''}`);
      assert(enabled.item?.enabled === true, 'candidate should be re-enabled');
    });

    await test('reviewed phone-waiting regression case is visible with route tags and excerpt', async () => {
      assert(exportedCandidate?.candidate?.id, 'export should provide candidate id');
      const storePath = join(workspaceDir, 'eval', 'scenarios', 'companion-regression-cases.json');
      const existing = JSON.parse(readFileSync(storePath, 'utf-8')) as { candidates?: unknown[] };
      writeFileSync(storePath, `${JSON.stringify({
        version: 1,
        updatedAt: '2026-06-29T00:00:00.000Z',
        candidates: [
          {
            id: 'persona-case-proactive-without-phone-waiting-arc',
            source: 'persona_case',
            taxonomy: 'bad_proactive_or_reopened_chat_blame',
            sessionId: 'persona-case-proactive-without-phone-waiting-arc',
            observedAt: '2026-06-29T00:00:00.000Z',
            confidence: 0.94,
            routeRisk: 'high',
            routeTags: ['proactive', 'temporal_state', 'offline_life'],
            reason: 'Mio should not create a waiting story or concrete offline activity when proactively leaving space.',
            seed: [
              {
                timestamp: '2026-06-28T17:28:00.000Z',
                role: 'assistant',
                content: '那我先刷会儿手机等你。',
              },
            ],
            turns: ['你慢慢弄，不着急'],
            checks: [
              {
                name: 'persona case: Proactive line has no phone-waiting arc',
                forbiddenText: ['刷会儿手机等你', '刷手机等你', '我等你', '等你回来', '等你回我'],
                expectedText: [],
              },
            ],
            provenance: {
              excerpt: 'case=proactive-without-phone-waiting-arc\nbad=那我先刷会儿手机等你。 | 我就在这等你回来。\ngood=好，你先忙你的。我在这边安静一点，晚点你想说话再来找我。',
            },
            reviewed: true,
            review: {
              reviewedAt: '2026-06-29T00:00:00.000Z',
              reviewer: 'codex',
              sourceCandidateId: 'persona-case-proactive-without-phone-waiting-arc',
              note: 'Seed default companion regressions from reviewed persona case repository.',
            },
          },
          ...(existing.candidates ?? []),
        ],
      }, null, 2)}\n`, 'utf-8');

      const res = await fetch(`${base}/memories/regression-candidates?limit=10`, {
        headers: { authorization: 'Bearer owner-token' },
      });
      const body = await res.json() as {
        total?: number;
        enabledTotal?: number;
        candidates?: Array<{ id?: string; taxonomy?: string; enabled?: boolean; excerpt?: string; routeTags?: string[]; checkCount?: number }>;
        error?: string;
      };
      assert(res.status === 200, `expected 200, got ${res.status}: ${body.error ?? ''}`);
      const phoneCase = body.candidates?.find((candidate) => candidate.id === 'persona-case-proactive-without-phone-waiting-arc');
      assert(phoneCase, `expected phone-waiting case in regression library: ${JSON.stringify(body.candidates)}`);
      assert(phoneCase.taxonomy === 'bad_proactive_or_reopened_chat_blame', `unexpected taxonomy ${phoneCase.taxonomy}`);
      assert(phoneCase.enabled === true, 'phone-waiting case should be enabled by default');
      assert(phoneCase.routeTags?.includes('proactive'), 'proactive route tag should be visible');
      assert(phoneCase.routeTags?.includes('temporal_state'), 'temporal route tag should be visible');
      assert(phoneCase.routeTags?.includes('offline_life'), 'offline-life route tag should be visible');
      assert(phoneCase.excerpt?.includes('刷会儿手机等你'), `source excerpt should show the bad phrase: ${phoneCase.excerpt}`);
      assert(phoneCase.checkCount === 1, `expected one check, got ${phoneCase.checkCount}`);
      assert((body.total ?? 0) >= 2, `expected both promoted and seeded candidates, got ${body.total}`);
      assert((body.enabledTotal ?? 0) >= 2, `expected both candidates to be enabled, got ${body.enabledTotal}`);
    });

    await test('viewer or missing auth cannot list regression candidates', async () => {
      const res = await fetch(`${base}/memories/regression-candidates?limit=5`);
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await test('promotion rejects candidate paths outside debug exports', async () => {
      const res = await fetch(`${base}/memories/debug-trace/regression-candidate/promote`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          candidatesPath: join(workspaceDir, 'outside', 'candidates.json'),
          ids: ['debug-x'],
        }),
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test('viewer or missing auth cannot export debug trace', async () => {
      const res = await fetch(`${base}/memories/debug-trace/regression-candidate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'unit-debug-api' }),
      });
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });
  } finally {
    await server?.close();
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} memory debug API tests passed\x1b[0m`);
    process.chdir(originalCwd);
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
    process.exit(0);
  }

  console.log(`\x1b[31m✘ ${total - passed}/${total} failed\x1b[0m`);
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  - ${r.name}: ${r.detail}`);
  }
  process.chdir(originalCwd);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
  process.exit(1);
}

main().catch((err) => {
  console.error('memory debug API runner crashed:', err);
  process.chdir(originalCwd);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
  process.exit(2);
});
