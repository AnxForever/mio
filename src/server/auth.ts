/**
 * Mio — Auth middleware
 *
 * Bearer token authentication for HTTP endpoints.
 *
 * Activated when MIO_AUTH_TOKEN env var (or config.authToken) is set.
 * When active:
 *   - All POST/PUT/DELETE endpoints require `Authorization: Bearer <token>`.
 *   - GET /health and GET /status are always public.
 *   - GET /avatar/state and GET /voice/capabilities are public by default
 *     (configurable via requireAuthForReads).
 *
 * WebSocket connections verify the token via a `?token=<value>` query parameter
 * during the upgrade handshake. Clients that fail auth receive a 401 and the
 * socket is destroyed.
 *
 * Design:
 *   - Constant-time comparison to prevent timing attacks.
 *   - Single token (no user concept in v0.1 — this is a personal agent).
 *   - Token stored in env var, never logged or returned in responses.
 */

import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import { getConfig } from '../config.js';
import {
  hasConsoleUsers,
  resolveConsoleSession,
  type AuthContext,
} from './user-auth.js';

export interface AuthFailure {
  status: 401;
  message: string;
  code: 'missing_authorization' | 'invalid_authorization_format' | 'invalid_api_key';
}

export type AuthenticatedRequest = Request & { auth?: AuthContext; authenticated?: boolean };

// ─── Token resolution ───

function getToken(): string | null {
  // env var takes precedence
  const envToken = process.env.MIO_AUTH_TOKEN;
  if (envToken && envToken.length > 0) return envToken;

  // then config file
  const config = getConfig();
  if (config.authToken && config.authToken.length > 0) return config.authToken;

  return null;
}

/**
 * Check whether auth is enabled for this process.
 */
export function isAuthEnabled(): boolean {
  return getToken() !== null || hasConsoleUsers();
}

// ─── Constant-time comparison ───

/**
 * Compare two strings in constant time.
 * Prevents timing side-channel attacks on the bearer token.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return a.length === b.length;
  if (a.length !== b.length) {
    // Still do a constant-time comparison to avoid leaking length
    let diff = a.length ^ b.length;
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      diff |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return diff === 0;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function parseBearer(authHeader: string | undefined): { token?: string; failure?: AuthFailure } {
  if (!authHeader) {
    return {
      failure: {
        status: 401,
        message: 'Missing Authorization header',
        code: 'missing_authorization',
      },
    };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return {
      failure: {
        status: 401,
        message: 'Invalid Authorization format. Use: Bearer <token>',
        code: 'invalid_authorization_format',
      },
    };
  }

  return { token: parts[1] };
}

export function resolveAuthContext(authHeader: string | undefined): { auth?: AuthContext; failure?: AuthFailure } {
  const legacyToken = getToken();
  const accountAuthEnabled = hasConsoleUsers();
  if (!legacyToken && !accountAuthEnabled) {
    return { auth: { kind: 'none', role: null, user: null } };
  }

  const parsed = parseBearer(authHeader);
  if (parsed.failure) return { failure: parsed.failure };
  const provided = parsed.token || '';

  if (legacyToken && constantTimeEqual(provided, legacyToken)) {
    return { auth: { kind: 'legacy', role: 'owner', user: null } };
  }

  if (accountAuthEnabled) {
    const session = resolveConsoleSession(provided);
    if (session) return { auth: session };
  }

  return {
    failure: {
      status: 401,
      message: 'Invalid token',
      code: 'invalid_api_key',
    },
  };
}

// ─── HTTP middleware ───

/**
 * Express middleware: require a valid Bearer token.
 *
 * Skips when auth is disabled (no token configured).
 * Responds 401 with a JSON error body when the token is missing or invalid.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const { auth, failure } = resolveAuthContext(req.headers.authorization);
  if (failure) {
    res.status(failure.status).json({ error: failure.message });
    return;
  }

  (req as AuthenticatedRequest).auth = auth;
  (req as AuthenticatedRequest).authenticated = true;
  next();
}

/**
 * Express middleware for OpenAI-compatible routes.
 *
 * Uses the same Mio bearer token as the native API, but returns an OpenAI-like
 * error object so generic clients can surface auth failures cleanly.
 */
export function requireOpenAIAuth(req: Request, res: Response, next: NextFunction): void {
  const { auth, failure } = resolveAuthContext(req.headers.authorization);
  if (failure) {
    res.status(failure.status).json({
      error: {
        message: failure.message,
        type: 'authentication_error',
        code: failure.code,
      },
    });
    return;
  }

  (req as AuthenticatedRequest).auth = auth;
  (req as AuthenticatedRequest).authenticated = true;
  next();
}

export function checkBearerAuth(authHeader: string | undefined): AuthFailure | null {
  return resolveAuthContext(authHeader).failure ?? null;
}

/**
 * Optional auth: if a token is configured, validate it. If no token is
 * configured, allow the request. Unlike requireAuth, this never returns 401 —
 * it just attaches an `authenticated` flag to the request for downstream use.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    (req as AuthenticatedRequest).authenticated = true;
    (req as AuthenticatedRequest).auth = { kind: 'none', role: null, user: null };
    next();
    return;
  }

  const { auth, failure } = resolveAuthContext(req.headers.authorization);
  if (!failure && auth) {
    (req as AuthenticatedRequest).authenticated = true;
    (req as AuthenticatedRequest).auth = auth;
  } else {
    (req as AuthenticatedRequest).authenticated = false;
  }
  next();
}

// ─── WebSocket auth ───

/**
 * Validate the WebSocket upgrade request.
 *
 * Extracts the token from `?token=<value>` query parameter.
 * Returns true if auth is disabled OR the token matches.
 * Returns false (→ destroy socket) if auth is enabled and the token is wrong.
 *
 * Usage in server/index.ts upgrade handler:
 *   if (!validateWsAuth(req)) { socket.destroy(); return; }
 */
export function validateWsAuth(req: IncomingMessage): boolean {
  if (!isAuthEnabled()) return true; // auth not configured

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const provided = url.searchParams.get('token');
  if (!provided) return false;

  return !resolveAuthContext(`Bearer ${provided}`).failure;
}
