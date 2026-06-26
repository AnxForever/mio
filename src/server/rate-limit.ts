/**
 * Mio — In-memory rate limiter middleware
 *
 * Simple per-IP sliding-window rate limiter for Express.
 *
 * - Tracks request counts per IP using a Map with automatic cleanup of stale entries.
 * - Returns 429 with JSON error body when the limit is exceeded.
 * - Skips rate limiting for GET /health.
 * - Configurable via env vars:
 *     MIO_RATE_LIMIT_MAX        (default: 30)
 *     MIO_RATE_LIMIT_WINDOW_MS  (default: 60000)
 *
 * Design:
 *   - Pure in-memory — no external dependencies. Fine for a single-process agent.
 *   - Stale entries are cleaned by a periodic timer (every `cleanupIntervalMs`).
 *   - The `retryAfter` value in the 429 response tells clients when to retry.
 */

import type { Request, Response, NextFunction } from 'express';

// ─── Config ───

export interface RateLimiterOptions {
  /** Time window in milliseconds (default: 60_000 = 1 minute). */
  windowMs: number;
  /** Max requests per IP within the window (default: 30). */
  max: number;
}

function resolveOptions(opts?: Partial<RateLimiterOptions>): RateLimiterOptions {
  return {
    windowMs: parseInt(process.env.MIO_RATE_LIMIT_WINDOW_MS ?? '', 10) || opts?.windowMs || 60_000,
    max: parseInt(process.env.MIO_RATE_LIMIT_MAX ?? '', 10) || opts?.max || 30,
  };
}

// ─── Entry tracking ───

interface RateLimitEntry {
  /** Timestamps of requests within the current window. */
  timestamps: number[];
}

const clients = new Map<string, RateLimitEntry>();

// Periodic cleanup: every 60 seconds, purge entries whose last timestamp is
// more than `windowMs` old. This prevents unbounded memory growth.
const CLEANUP_INTERVAL_MS = 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(windowMs: number): void {
  if (cleanupTimer) return; // already running
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, entry] of clients) {
      // Remove all timestamps older than the window
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        clients.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow the process to exit even if the timer is still active.
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

// ─── Middleware ───

/**
 * Create an Express rate-limiting middleware.
 *
 * Returns a middleware function that:
 *   - Tracks requests by IP (X-Forwarded-For || req.ip).
 *   - Returns 429 with `{ error, retryAfter }` when exceeded.
 *   - Calls `next()` for allowed requests.
 */
export function createRateLimiter(opts?: Partial<RateLimiterOptions>) {
  const { windowMs, max } = resolveOptions(opts);
  startCleanup(windowMs);

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip rate limiting for health checks — liveness probes shouldn't be
    // blocked even under extreme load.
    if (req.path === '/health' && req.method === 'GET') {
      next();
      return;
    }

    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;

    let entry = clients.get(ip);
    if (!entry) {
      entry = { timestamps: [] };
      clients.set(ip, entry);
    }

    // Prune outdated timestamps on each request.
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= max) {
      // Calculate how long the client must wait before the oldest timestamp expires.
      const oldest = entry.timestamps[0]!;
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);

      res.status(429).json({
        error: 'Too many requests',
        retryAfter,
      });
      return;
    }

    entry.timestamps.push(now);
    next();
  };
}

/**
 * Reset the rate limiter state. Useful for tests.
 * Clears all tracked IPs and stops the cleanup timer.
 */
export function resetRateLimiter(): void {
  clients.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// ─── Stats (for observability / health checks) ───

export interface RateLimiterStats {
  trackedIps: number;
  windowMs: number;
  max: number;
}

export function getRateLimiterStats(opts?: Partial<RateLimiterOptions>): RateLimiterStats {
  const { windowMs, max } = resolveOptions(opts);
  return {
    trackedIps: clients.size,
    windowMs,
    max,
  };
}
