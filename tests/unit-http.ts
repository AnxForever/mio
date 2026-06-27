#!/usr/bin/env node
/**
 * Mio — HTTP client unit tests (timeout + retry/backoff)
 *
 * Exercises src/providers/http.ts::fetchWithRetry by replacing globalThis.fetch
 * with deterministic mocks (saved and restored around each test). Covers:
 *   - timeout via AbortController deadline
 *   - retry success on a transient 5xx (503 → 200)
 *   - retry exhaustion on a persistent 5xx
 *   - no retry on a non-429 4xx
 *   - retry on a thrown network error
 *   - retry on 429 (rate limit)
 *   - MIO_HTTP_MAX_RETRIES env override
 *   - caller AbortSignal cancels without retry
 *
 * Run (after build, since it imports the compiled module):
 *   npm run build && node --experimental-strip-types tests/unit-http.ts
 */

// Silence the logger's retry warnings so test output stays clean. Must be set
// before the dynamic import of http.js (logger reads the level at load time).
process.env.MIO_LOG_LEVEL = 'error';
// Make sure no stray env overrides leak into the option resolver.
delete process.env.MIO_HTTP_TIMEOUT_MS;
delete process.env.MIO_HTTP_MAX_RETRIES;
delete process.env.MIO_HTTP_RETRY_BASE_MS;

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

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(name, false, msg);
  }
}

type FetchFn = typeof fetch;

/** Swap in a mock fetch for the duration of fn, then restore the original. */
async function withMockFetch(mock: FetchFn, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** Build an AbortError matching what the runtime fetch throws on abort. */
function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — http (timeout + retry) tests\x1b[0m\n');

  const { fetchWithRetry } = await import('../dist/providers/http.js');

  // 1. Timeout: a never-resolving response is aborted by the deadline.
  await test('timeout: slow response aborts after timeoutMs', async () => {
    let sawAbort = false;
    const mock = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const slow = setTimeout(() => resolve(new Response('late', { status: 200 })), 10_000);
        signal?.addEventListener('abort', () => {
          sawAbort = true;
          clearTimeout(slow);
          reject(abortError());
        }, { once: true });
      })) as FetchFn;

    await withMockFetch(mock, async () => {
      let threw = false;
      try {
        await fetchWithRetry('https://x.test/slow', {}, { timeoutMs: 50, maxRetries: 0, baseDelayMs: 1 });
      } catch (err) {
        threw = true;
        const m = err instanceof Error ? err.message : String(err);
        assert(/timed out/i.test(m), `expected a timeout error, got: ${m}`);
      }
      assert(threw, 'should throw on timeout');
      assert(sawAbort, 'underlying request should receive the abort');
    });
  });

  // 2. Retry success: 503 then 200.
  await test('retry: 503 then 200 succeeds', async () => {
    let calls = 0;
    const mock = (() => {
      calls++;
      return Promise.resolve(new Response('body', { status: calls === 1 ? 503 : 200 }));
    }) as FetchFn;

    await withMockFetch(mock, async () => {
      const res = await fetchWithRetry('https://x.test/ok', {}, { maxRetries: 3, baseDelayMs: 1 });
      assertEq(res.status, 200, 'final status');
      assertEq(calls, 2, 'attempts');
    });
  });

  // 3. Retry exhaustion: persistent 500 stops after maxRetries + 1 attempts.
  //    The final 5xx is returned for the caller's own `!res.ok` throw.
  await test('retry: persistent 500 stops at the retry limit', async () => {
    let calls = 0;
    const mock = (() => {
      calls++;
      return Promise.resolve(new Response('err', { status: 500 }));
    }) as FetchFn;

    await withMockFetch(mock, async () => {
      const res = await fetchWithRetry('https://x.test/down', {}, { maxRetries: 2, baseDelayMs: 1 });
      assertEq(res.status, 500, 'final status returned to caller');
      assertEq(calls, 3, 'attempts = maxRetries + 1');
    });
  });

  // 4. No retry on a non-429 4xx.
  await test('retry: 400 is not retried', async () => {
    let calls = 0;
    const mock = (() => {
      calls++;
      return Promise.resolve(new Response('bad', { status: 400 }));
    }) as FetchFn;

    await withMockFetch(mock, async () => {
      const res = await fetchWithRetry('https://x.test/bad', {}, { maxRetries: 3, baseDelayMs: 1 });
      assertEq(res.status, 400, 'status');
      assertEq(calls, 1, 'no retries for 4xx');
    });
  });

  // 5. Network error is retried, then succeeds.
  await test('retry: network error then success', async () => {
    let calls = 0;
    const mock = (() => {
      calls++;
      if (calls === 1) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as FetchFn;

    await withMockFetch(mock, async () => {
      const res = await fetchWithRetry('https://x.test/flaky', {}, { maxRetries: 3, baseDelayMs: 1 });
      assertEq(res.status, 200, 'recovered');
      assertEq(calls, 2, 'one retry');
    });
  });

  // 6. 429 (rate limit) is retried like a 5xx.
  await test('retry: 429 then 200 succeeds', async () => {
    let calls = 0;
    const mock = (() => {
      calls++;
      return Promise.resolve(new Response('rl', { status: calls === 1 ? 429 : 200 }));
    }) as FetchFn;

    await withMockFetch(mock, async () => {
      const res = await fetchWithRetry('https://x.test/rl', {}, { maxRetries: 3, baseDelayMs: 1 });
      assertEq(res.status, 200, 'final status');
      assertEq(calls, 2, 'retried once');
    });
  });

  // 7. MIO_HTTP_MAX_RETRIES env var caps the retry budget.
  await test('env: MIO_HTTP_MAX_RETRIES overrides default', async () => {
    let calls = 0;
    const mock = (() => {
      calls++;
      return Promise.resolve(new Response('err', { status: 500 }));
    }) as FetchFn;

    process.env.MIO_HTTP_MAX_RETRIES = '0';
    process.env.MIO_HTTP_RETRY_BASE_MS = '1';
    try {
      await withMockFetch(mock, async () => {
        const res = await fetchWithRetry('https://x.test/down', {});
        assertEq(res.status, 500, 'status');
        assertEq(calls, 1, 'no retries when env caps to 0');
      });
    } finally {
      delete process.env.MIO_HTTP_MAX_RETRIES;
      delete process.env.MIO_HTTP_RETRY_BASE_MS;
    }
  });

  // 8. Caller AbortSignal is honoured and not retried.
  await test('abort: caller signal cancels without retry', async () => {
    let calls = 0;
    const mock = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        calls++;
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      })) as FetchFn;

    const controller = new AbortController();
    controller.abort();

    await withMockFetch(mock, async () => {
      let threw = false;
      try {
        await fetchWithRetry('https://x.test/cancel', { signal: controller.signal }, { maxRetries: 3, baseDelayMs: 1 });
      } catch {
        threw = true;
      }
      assert(threw, 'should throw when caller aborts');
      assertEq(calls, 1, 'no retry after caller cancel');
    });
  });

  // ─── Summary ───
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} http tests passed\x1b[0m`);
    process.exit(0);
  } else {
    console.log(`\x1b[31m✘ ${total - passed}/${total} failed\x1b[0m`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  process.exit(2);
});
