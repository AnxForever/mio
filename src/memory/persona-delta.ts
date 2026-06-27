// memory/persona-delta.ts — L2 PersonaDelta + L3 UserPreferences 读写（per-user，本切片 default）
import { readFileSyncSafe, writeFileSyncSafe } from './bank.js';
import { personaDeltaPath, preferencesPath } from './paths.js';
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

/** 显式偏好去重 upsert（捏人捕获用）。 */
export function upsertPreference(rule: string, source: string, userId = 'default'): void {
  const now = new Date().toISOString();
  const prefs = readPreferences(userId) ?? { userId, explicit: [], updatedAt: now };
  if (prefs.explicit.some((p) => p.rule === rule)) return;
  prefs.explicit.push({ rule, source, createdAt: now });
  prefs.updatedAt = now;
  writePreferences(prefs);
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
