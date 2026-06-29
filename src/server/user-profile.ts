import { createHash } from 'node:crypto';
import { appendFileSyncSafe, ensureBankStructure, readFileSyncSafe, writeFileSyncSafe } from '../memory/bank.js';
import { userProfilePath } from '../memory/paths.js';

export interface UserProfileEntry {
  id: string;
  lineNumber: number;
  content: string;
  date?: string;
  raw: string;
}

export interface UserProfileSnapshot {
  raw: string;
  entries: UserProfileEntry[];
}

function entryId(line: string, index: number): string {
  return createHash('sha1').update(`${index}\u0000${line}`).digest('hex').slice(0, 16);
}

function cleanContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function formatLine(content: string, date = new Date().toISOString().slice(0, 10)): string {
  return `- [${date}] ${cleanContent(content)}`;
}

function parseEntry(line: string, index: number): UserProfileEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const withoutBullet = trimmed.replace(/^-\s*/, '');
  const dateMatch = withoutBullet.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/);
  const date = dateMatch?.[1];
  const content = cleanContent(dateMatch?.[2] ?? withoutBullet);
  if (!content) return null;

  return {
    id: entryId(line, index),
    lineNumber: index + 1,
    content,
    date,
    raw: line,
  };
}

function readLines(): { raw: string; lines: string[] } {
  ensureBankStructure();
  const raw = readFileSyncSafe(userProfilePath());
  return { raw, lines: raw.split(/\r?\n/) };
}

export function readUserProfileSnapshot(): UserProfileSnapshot {
  const { raw, lines } = readLines();
  return {
    raw,
    entries: lines.flatMap((line, index) => {
      const entry = parseEntry(line, index);
      return entry ? [entry] : [];
    }),
  };
}

export function appendUserProfileEntry(content: string): UserProfileEntry {
  const cleaned = cleanContent(content);
  if (!cleaned) throw new Error('Profile entry content is required');

  const snapshot = readUserProfileSnapshot();
  const existing = snapshot.entries.find((entry) => entry.content === cleaned);
  if (existing) return existing;

  const line = formatLine(cleaned);
  const prefix = snapshot.raw.length > 0 && !snapshot.raw.endsWith('\n') ? '\n' : '';
  appendFileSyncSafe(userProfilePath(), `${prefix}${line}\n`);

  const updated = readUserProfileSnapshot();
  const created = updated.entries.find((entry) => entry.raw.trim() === line);
  if (!created) throw new Error('Failed to append profile entry');
  return created;
}

export function updateUserProfileEntry(id: string, content: string): UserProfileEntry | null {
  const cleaned = cleanContent(content);
  if (!cleaned) throw new Error('Profile entry content is required');

  const { lines } = readLines();
  let nextEntry: UserProfileEntry | null = null;
  const next = lines.map((line, index) => {
    const entry = parseEntry(line, index);
    if (!entry || entry.id !== id) return line;
    const replacement = formatLine(cleaned, entry.date);
    nextEntry = parseEntry(replacement, index);
    return replacement;
  });

  if (!nextEntry) return null;
  writeFileSyncSafe(userProfilePath(), next.join('\n'));
  return nextEntry;
}

export function deleteUserProfileEntry(id: string): boolean {
  const { lines } = readLines();
  let changed = false;
  const next = lines.filter((line, index) => {
    const entry = parseEntry(line, index);
    if (!entry || entry.id !== id) return true;
    changed = true;
    return false;
  });

  if (!changed) return false;
  writeFileSyncSafe(userProfilePath(), next.join('\n'));
  return true;
}
