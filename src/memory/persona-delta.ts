// memory/persona-delta.ts — L2 PersonaDelta + L3 UserPreferences 读写（per-user，本切片 default）
import { readdirSync } from 'node:fs';
import { readFileSyncSafe, writeFileSyncSafe } from './bank.js';
import { preferencesPath, personaDeltaPath, usersDir } from './paths.js';
import type { PersonaDelta, UserPreferences } from '../types.js';
import { logger } from '../utils/logger.js';

export function readPersonaDelta(userId = 'default'): PersonaDelta | null {
  const raw = readFileSyncSafe(personaDeltaPath(userId));
  if (!raw) return null;
  try { return JSON.parse(raw) as PersonaDelta; }
  catch (err) { logger.warn('persona-delta parse failed', { error: String(err) }); return null; }
}

export function writePersonaDelta(delta: PersonaDelta): void {
  writeFileSyncSafe(personaDeltaPath(delta.userId), JSON.stringify(delta, null, 2));
}

export function readPreferences(userId = 'default'): UserPreferences | null {
  const raw = readFileSyncSafe(preferencesPath(userId));
  if (!raw) return null;
  try { return JSON.parse(raw) as UserPreferences; }
  catch (err) { logger.warn('preferences parse failed', { error: String(err) }); return null; }
}

export function writePreferences(prefs: UserPreferences): void {
  writeFileSyncSafe(preferencesPath(prefs.userId), JSON.stringify(prefs, null, 2));
}

export function listUserPreferences(): UserPreferences[] {
  let entries: string[];
  try {
    entries = readdirSync(usersDir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  return entries
    .map((userId) => readPreferences(userId))
    .filter((prefs): prefs is UserPreferences => prefs !== null);
}

/** 显式偏好去重 upsert（捏人捕获用）。 */
export function upsertPreference(rule: string, source: string, userId = 'default'): void {
  const now = new Date().toISOString();
  const prefs = readPreferences(userId) ?? { userId, explicit: [], updatedAt: now };
  if (prefs.explicit.some((p) => p.rule === rule)) return;
  prefs.explicit.push({ rule, source, createdAt: now });
  prefs.updatedAt = now;
  writePreferences(prefs);
}

export function upsertWeClawTarget(userId: string, to: string, source: string): void {
  const trimmed = to.trim();
  if (!userId || !trimmed) return;

  const now = new Date().toISOString();
  const prefs = readPreferences(userId) ?? { userId, explicit: [], updatedAt: now };
  const current = prefs.channels?.weclaw;
  if (current?.to === trimmed && current.enabled) return;

  writePreferences({
    ...prefs,
    channels: {
      ...prefs.channels,
      weclaw: {
        to: trimmed,
        enabled: true,
        source,
        updatedAt: now,
      },
    },
    updatedAt: now,
  });
}

export function getWeClawTarget(userId: string | undefined): string | null {
  if (!userId) return null;
  const target = readPreferences(userId)?.channels?.weclaw;
  if (!target?.enabled || !target.to.trim()) return null;
  return target.to.trim();
}

export function userWantsProactiveChat(prefs: UserPreferences | null | undefined): boolean {
  let decision: boolean | null = null;
  for (const pref of prefs?.explicit ?? []) {
    if (isProactiveOptOut(pref.rule)) {
      decision = false;
    } else if (isProactiveOptIn(pref.rule)) {
      decision = true;
    }
  }
  return decision === true;
}

function isProactiveOptIn(rule: string): boolean {
  return /主动(?:找|联系)|多找我聊天|多主动/.test(rule);
}

function isProactiveOptOut(rule: string): boolean {
  return /(?:别|不要|不用|不想|不需要|取消|停止|先别).{0,16}(?:主动(?:找|联系)|多找我聊天|多主动)/.test(rule);
}

export function listUsersWithProactiveWeClawTargets(): Array<{ userId: string; to: string }> {
  return listUserPreferences()
    .filter(userWantsProactiveChat)
    .map((prefs) => ({ userId: prefs.userId, to: getWeClawTarget(prefs.userId) ?? '' }))
    .filter((target) => target.to.length > 0);
}

/** 合并式更新 PersonaDelta，并追加 history（捏人捕获用）。 */
export function patchPersonaDelta(patch: Partial<PersonaDelta>, source: string, userId = 'default'): void {
  const now = new Date().toISOString();
  const cur: PersonaDelta = readPersonaDelta(userId) ?? { userId, updatedAt: now, history: [] };
  const changes = Object.entries(patch)
    .filter(([k]) => k !== 'history' && k !== 'userId' && k !== 'updatedAt')
    .map(([field, value]) => ({ field, value: String(value), source, at: now }));
  writePersonaDelta({ ...cur, ...patch, userId, updatedAt: now, history: [...cur.history, ...changes] });
}
