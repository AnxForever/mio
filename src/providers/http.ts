/**
 * Mio — resilient HTTP client for LLM providers
 *
 * Wraps the runtime's global `fetch` with two production guarantees the raw
 * provider calls lacked:
 *
 *   1. Timeout — every request is bounded by an AbortController deadline, so a
 *      hung upstream can never block a turn indefinitely. Default 30s,
 *      overridable per-call (`opts.timeoutMs`) or globally (`MIO_HTTP_TIMEOUT_MS`).
 *
 *   2. Retry with exponential backoff — transient failures (network errors,
 *      HTTP 429, HTTP 5xx) are retried with jittered exponential backoff.
 *      Non-retryable 4xx responses (other than 429) and caller cancellations
 *      are surfaced immediately. Default 3 retries, overridable per-call
 *      (`opts.maxRetries`) or globally (`MIO_HTTP_MAX_RETRIES`).
 *
 * The Response body is never buffered here — callers stream it (SSE) or parse
 * it themselves. On a retryable status the discarded response body is cancelled
 * to release the connection before the next attempt. A retryable status that
 * exhausts all retries is returned as-is, so callers keep building their own
 * provider-specific error messages from `!res.ok`.
 *
 * Zero dependencies: built on the runtime's global `fetch` / `AbortController`.
 */

import { logger } from '../utils/logger.js';

// Derive fetch's exact parameter types so this stays in lock-step with the
// runtime signature regardless of how the DOM / undici lib types are named.
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export interface FetchRetryOptions {
  /** Per-request timeout (ms). Falls back to MIO_HTTP_TIMEOUT_MS, then 30000. */
  timeoutMs?: number;
  /** Max retries beyond the first attempt. Falls back to MIO_HTTP_MAX_RETRIES, then 3. */
  maxRetries?: number;
  /** Base backoff delay (ms). Falls back to MIO_HTTP_RETRY_BASE_MS, then 500. */
  baseDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

/** Parse a non-negative integer env var, falling back when unset/invalid. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function resolveOptions(opts?: FetchRetryOptions): {
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
} {
  return {
    timeoutMs: opts?.timeoutMs ?? envInt('MIO_HTTP_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxRetries: opts?.maxRetries ?? envInt('MIO_HTTP_MAX_RETRIES', DEFAULT_MAX_RETRIES),
    baseDelayMs: opts?.baseDelayMs ?? envInt('MIO_HTTP_RETRY_BASE_MS', DEFAULT_BASE_DELAY_MS),
  };
}

/** 429 (rate limit) and 5xx (server) are transient and worth retrying. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Exponential backoff with additive jitter: base * 2^attempt + [0, base). */
function backoffDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `fetch()` with a timeout and exponential-backoff retries.
 *
 * Returns the Response WITHOUT reading its body, so streaming callers can
 * consume it. A final retryable status (e.g. a 5xx that exhausted retries) is
 * returned as-is for the caller's own `!res.ok` handling — this preserves the
 * provider-specific error messages the callers already build. Network / timeout
 * failures that exhaust retries are thrown.
 *
 * @param url   Request URL (or Request) — same as the first arg to `fetch()`.
 * @param init  Standard RequestInit. A caller-supplied `signal` is honoured:
 *              if it aborts, the request is cancelled and NOT retried.
 * @param opts  Timeout / retry overrides.
 */
export async function fetchWithRetry(
  url: FetchInput,
  init?: FetchInit,
  opts?: FetchRetryOptions,
): Promise<Response> {
  const { timeoutMs, maxRetries, baseDelayMs } = resolveOptions(opts);
  const callerSignal: AbortSignal | undefined = init?.signal ?? undefined;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    // Bridge a caller-supplied cancellation signal into our timeout controller
    // so a single signal drives the fetch, while still letting us tell a
    // caller-cancel apart from our own timeout below.
    let onCallerAbort: (() => void) | undefined;
    if (callerSignal) {
      if (callerSignal.aborted) {
        timeoutController.abort(callerSignal.reason);
      } else {
        onCallerAbort = () => timeoutController.abort(callerSignal.reason);
        callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    let res: Response | undefined;
    let caught: unknown;
    try {
      res = await globalThis.fetch(url, { ...init, signal: timeoutController.signal });
    } catch (err) {
      caught = err;
    } finally {
      clearTimeout(timer);
      if (onCallerAbort) {
        callerSignal?.removeEventListener('abort', onCallerAbort);
      }
    }

    // Caller cancelled — propagate immediately, never retry.
    if (callerSignal?.aborted) {
      throw caught ?? new Error('fetchWithRetry: request aborted by caller');
    }

    // Network or timeout failure.
    if (caught !== undefined) {
      lastError = caught;
      const timedOut = timeoutController.signal.aborted;
      if (attempt < maxRetries) {
        logger.warn('http request failed, backing off', {
          reason: timedOut ? `timeout after ${timeoutMs}ms` : errorMessage(caught),
          attempt: attempt + 1,
          maxRetries,
        });
        await sleep(backoffDelay(attempt, baseDelayMs));
        continue;
      }
      throw timedOut
        ? new Error(`HTTP request timed out after ${timeoutMs}ms`)
        : caught instanceof Error
          ? caught
          : new Error(String(caught));
    }

    const response = res as Response;

    // Transient HTTP status with retries left → discard body, back off, retry.
    if (isRetryableStatus(response.status) && attempt < maxRetries) {
      if (response.body) {
        await response.body.cancel().catch(() => { /* best-effort release */ });
      }
      lastError = new Error(`HTTP ${response.status}`);
      logger.warn('http retryable status, backing off', {
        status: response.status,
        attempt: attempt + 1,
        maxRetries,
      });
      await sleep(backoffDelay(attempt, baseDelayMs));
      continue;
    }

    // 2xx/3xx, a non-retryable 4xx, or a final retryable status → hand back the
    // untouched Response for the caller to read.
    return response;
  }

  // The loop always returns or throws above; this only satisfies the type
  // checker for the (unreachable) fall-through.
  throw lastError instanceof Error
    ? lastError
    : new Error('fetchWithRetry: retries exhausted');
}
