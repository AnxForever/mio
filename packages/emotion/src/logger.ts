/**
 * Mio — Structured logger
 *
 * Minimal, zero-dependency logger with level-based filtering and optional
 * JSON output (structured logging for production) or human-readable output
 * (for development / REPL).
 *
 * Levels (RFC 5424):
 *   ERROR (0)  — something broke, needs attention
 *   WARN  (1)  — something unexpected but recoverable
 *   INFO  (2)  — normal operational events
 *   DEBUG (3)  — detailed trace for troubleshooting
 *
 * Configuration via env vars:
 *   MIO_LOG_LEVEL  = debug | info | warn | error  (default: info)
 *   MIO_LOG_FORMAT = json | text                  (default: text)
 *   MIO_LOG_FILE   = path to append logs to file  (default: stdout only)
 *
 * Usage:
 *   import { logger } from './logger.js';
 *   logger.info('server started', { port: 3000 });
 *   logger.error('failed to connect', { error: err.message });
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Types ───

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  ts: string;       // ISO 8601 timestamp
  level: LogLevel;
  msg: string;
  ctx?: Record<string, unknown>;
  reqId?: string;
}

// ─── Level config ───

const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function parseLevel(raw: string | undefined): LogLevel {
  const l = (raw ?? 'info').toLowerCase();
  if (l === 'error' || l === 'warn' || l === 'info' || l === 'debug') return l;
  return 'info';
}

const currentLevel: LogLevel = parseLevel(process.env.MIO_LOG_LEVEL);
const useJson: boolean = process.env.MIO_LOG_FORMAT === 'json';
const logFile: string | null = process.env.MIO_LOG_FILE || null;

// ─── File output ───

let fileReady = false;

function ensureFile(): void {
  if (!logFile || fileReady) return;
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    fileReady = true;
  } catch {
    // Can't create log dir — keep stdout-only
  }
}

function writeToFile(line: string): void {
  if (!logFile) return;
  ensureFile();
  if (!fileReady) return;
  try {
    appendFileSync(logFile, line + '\n');
  } catch {
    // Best-effort
  }
}

// ─── Formatter ───

function formatText(entry: LogEntry): string {
  const ctxStr = entry.ctx ? ' ' + Object.entries(entry.ctx)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ') : '';
  const reqStr = entry.reqId ? ` [${entry.reqId}]` : '';
  return `${entry.ts} ${entry.level.toUpperCase().padEnd(5)}${reqStr} ${entry.msg}${ctxStr}`;
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

// ─── Logger ───

let _reqId: string | undefined;

export const logger = {
  /** Attach a request ID for the current async context (best-effort, not async-local). */
  setRequestId(id: string): void {
    _reqId = id;
  },

  clearRequestId(): void {
    _reqId = undefined;
  },

  error(msg: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_RANK[currentLevel] < LEVEL_RANK.error) return;
    const entry: LogEntry = { ts: new Date().toISOString(), level: 'error', msg, ctx, reqId: _reqId };
    const line = useJson ? formatJson(entry) : formatText(entry);
    console.error(line);
    writeToFile(line);
  },

  warn(msg: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_RANK[currentLevel] < LEVEL_RANK.warn) return;
    const entry: LogEntry = { ts: new Date().toISOString(), level: 'warn', msg, ctx, reqId: _reqId };
    const line = useJson ? formatJson(entry) : formatText(entry);
    console.warn(line);
    writeToFile(line);
  },

  info(msg: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_RANK[currentLevel] < LEVEL_RANK.info) return;
    const entry: LogEntry = { ts: new Date().toISOString(), level: 'info', msg, ctx, reqId: _reqId };
    const line = useJson ? formatJson(entry) : formatText(entry);
    console.log(line);
    writeToFile(line);
  },

  debug(msg: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_RANK[currentLevel] < LEVEL_RANK.debug) return;
    const entry: LogEntry = { ts: new Date().toISOString(), level: 'debug', msg, ctx, reqId: _reqId };
    const line = useJson ? formatJson(entry) : formatText(entry);
    console.debug(line);
    writeToFile(line);
  },

  /** Log level of the current process. */
  get level(): LogLevel {
    return currentLevel;
  },
};
