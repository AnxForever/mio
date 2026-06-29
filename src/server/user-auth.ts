import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getConfig } from '../config.js';
import { authSessionsPath, authUsersPath } from '../memory/paths.js';

export type ConsoleRole = 'owner' | 'admin' | 'viewer';

type ConsoleUserRecord = {
  id: string;
  username: string;
  role: ConsoleRole;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  disabled?: boolean;
};

type ConsoleSessionRecord = {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
};

export type PublicConsoleUser = {
  id: string;
  username: string;
  role: ConsoleRole;
  createdAt: string;
  lastLoginAt?: string;
};

export type AuthContext =
  | { kind: 'none'; role: null; user: null }
  | { kind: 'legacy'; role: 'owner'; user: null }
  | { kind: 'session'; role: ConsoleRole; user: PublicConsoleUser };

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function publicUser(user: ConsoleUserRecord): PublicConsoleUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function readUsers(): ConsoleUserRecord[] {
  return readJson<ConsoleUserRecord[]>(authUsersPath(), [])
    .filter((user) => user && typeof user.id === 'string' && typeof user.username === 'string');
}

function writeUsers(users: ConsoleUserRecord[]): void {
  writeJson(authUsersPath(), users);
}

function readSessions(): ConsoleSessionRecord[] {
  const now = Date.now();
  return readJson<ConsoleSessionRecord[]>(authSessionsPath(), [])
    .filter((session) => session && typeof session.tokenHash === 'string' && typeof session.userId === 'string')
    .filter((session) => !session.revokedAt && Date.parse(session.expiresAt) > now);
}

function writeSessions(sessions: ConsoleSessionRecord[]): void {
  writeJson(authSessionsPath(), sessions);
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = Buffer.from(scryptSync(password, salt, 64).toString('base64url'));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function configuredSetupToken(): string | null {
  const envToken = process.env.MIO_AUTH_TOKEN;
  if (envToken && envToken.length > 0) return envToken;
  const configToken = getConfig().authToken;
  return configToken && configToken.length > 0 ? configToken : null;
}

function canUseSetupToken(provided?: string): boolean {
  const setupToken = configuredSetupToken();
  if (!setupToken) return true;
  return !!provided && constantTimeEqual(provided, setupToken);
}

export function hasConsoleUsers(): boolean {
  return readUsers().length > 0;
}

export function authSystemStatus(): Record<string, unknown> {
  const users = readUsers();
  return {
    usersConfigured: users.length > 0,
    userCount: users.length,
    legacyTokenEnabled: configuredSetupToken() !== null,
    bootstrapRequiresSetupToken: users.length === 0 && configuredSetupToken() !== null,
  };
}

export function listConsoleUsers(): PublicConsoleUser[] {
  return readUsers().map(publicUser);
}

export function createConsoleUser(input: { username: string; password: string; role: Exclude<ConsoleRole, 'owner'> }): PublicConsoleUser {
  const users = readUsers();
  const username = normalizeUsername(input.username);
  if (users.some((user) => normalizeUsername(user.username) === username)) {
    throw new Error('Username already exists');
  }

  const timestamp = nowIso();
  const user: ConsoleUserRecord = {
    id: randomBytes(12).toString('base64url'),
    username,
    role: input.role,
    passwordHash: hashPassword(input.password),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  users.push(user);
  writeUsers(users);
  return publicUser(user);
}

export function bootstrapOwner(input: { username: string; password: string; setupToken?: string }): { token: string; user: PublicConsoleUser } {
  if (hasConsoleUsers()) {
    throw new Error('Console users already exist');
  }
  if (!canUseSetupToken(input.setupToken)) {
    throw new Error('Invalid setup token');
  }

  const timestamp = nowIso();
  const user: ConsoleUserRecord = {
    id: randomBytes(12).toString('base64url'),
    username: normalizeUsername(input.username),
    role: 'owner',
    passwordHash: hashPassword(input.password),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: timestamp,
  };
  writeUsers([user]);
  return createSessionForUser(user);
}

export function loginConsoleUser(input: { username: string; password: string }): { token: string; user: PublicConsoleUser } {
  const username = normalizeUsername(input.username);
  const users = readUsers();
  const user = users.find((item) => normalizeUsername(item.username) === username && item.disabled !== true);
  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    throw new Error('Invalid username or password');
  }

  user.lastLoginAt = nowIso();
  user.updatedAt = user.updatedAt || user.lastLoginAt;
  writeUsers(users);
  return createSessionForUser(user);
}

function createSessionForUser(user: ConsoleUserRecord): { token: string; user: PublicConsoleUser } {
  const token = `mio_${randomBytes(32).toString('base64url')}`;
  const createdAt = nowIso();
  const sessions = readSessions();
  sessions.push({
    tokenHash: tokenHash(token),
    userId: user.id,
    createdAt,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  writeSessions(sessions);
  return { token, user: publicUser(user) };
}

export function resolveConsoleSession(token: string): AuthContext | null {
  const hash = tokenHash(token);
  const session = readSessions().find((item) => constantTimeEqual(item.tokenHash, hash));
  if (!session) return null;
  const user = readUsers().find((item) => item.id === session.userId && item.disabled !== true);
  if (!user) return null;
  return { kind: 'session', role: user.role, user: publicUser(user) };
}

export function revokeConsoleSession(token: string): void {
  const hash = tokenHash(token);
  const sessions = readJson<ConsoleSessionRecord[]>(authSessionsPath(), []);
  const timestamp = nowIso();
  for (const session of sessions) {
    if (constantTimeEqual(session.tokenHash, hash)) {
      session.revokedAt = timestamp;
    }
  }
  writeSessions(sessions);
}

export function isAdminRole(role: ConsoleRole): boolean {
  return role === 'owner' || role === 'admin';
}
